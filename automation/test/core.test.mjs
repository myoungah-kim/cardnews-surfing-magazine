/**
 * 코어 로직 단위 테스트 — 의존성 없이 `node --test` 로 돌린다.
 *
 * 여기서 검증하는 것들은 전부 "조용히 깨지는" 종류의 버그다:
 * callback_data 64바이트 초과, 컨텍스트 태그 유실, 허용목록 우회.
 * 실제 Telegram 호출 없이 확인할 수 있어야 배포 전에 잡을 수 있다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeCallback,
  decodeCallback,
  packDate,
  unpackDate,
  CALLBACK_DATA_MAX_BYTES,
} from '../core/callback.js';
import { embedContext, extractContext } from '../core/context.js';
import { isAuthorized, parseIdList, timingSafeEqual } from '../core/guard.js';
import { inlineKeyboard } from '../core/keyboard.js';
import { findCandidate } from '../app/candidates.js';
import {
  canFinalize,
  canProduce,
  canRecreate,
  daysBetween,
  MAX_CANDIDATE_AGE_DAYS,
  RECREATE_WARN_AFTER,
} from '../app/policy.js';

test('callback_data 왕복', () => {
  const data = encodeCallback('ch', ['260727', 3]);
  assert.equal(data, 'ch:260727:3');
  assert.deepEqual(decodeCallback(data), { action: 'ch', args: ['260727', '3'] });
});

test('callback_data 64바이트 초과 시 즉시 실패', () => {
  const long = 'x'.repeat(CALLBACK_DATA_MAX_BYTES);
  assert.throws(() => encodeCallback('ch', [long]), /상한/);
});

test('callback_data 에 구분자가 섞이면 실패', () => {
  assert.throws(() => encodeCallback('ch', ['a:b']), /구분자/);
});

test('날짜 압축 왕복', () => {
  assert.equal(packDate('2026-07-27'), '260727');
  assert.equal(unpackDate('260727'), '2026-07-27');
  assert.throws(() => packDate('26-07-27'), /형식/);
});

test('컨텍스트 태그 왕복', () => {
  const text = embedContext('어떤 부분을 고칠까요?', 'rc', ['260727', 2]);
  assert.match(text, /어떤 부분을 고칠까요\?/);
  assert.deepEqual(extractContext(text), { action: 'rc', args: ['260727', '2'] });
});

test('태그가 없는 답장은 null', () => {
  assert.equal(extractContext('그냥 아무 말'), null);
  assert.equal(extractContext(undefined), null);
});

test('허용목록이 비어 있으면 기본 거부', () => {
  const update = { callback_query: { from: { id: 1 }, message: { chat: { id: 1 } } } };
  assert.equal(isAuthorized(update, {}), false);
});

test('허용된 chat 만 통과', () => {
  const mine = { callback_query: { from: { id: 7 }, message: { chat: { id: 7 } } } };
  const other = { callback_query: { from: { id: 9 }, message: { chat: { id: 9 } } } };
  const policy = { allowedChatIds: ['7'] };
  assert.equal(isAuthorized(mine, policy), true);
  assert.equal(isAuthorized(other, policy), false);
});

test('일반 메시지도 식별된다', () => {
  const update = { message: { from: { id: 7 }, chat: { id: 7 }, text: '안녕' } };
  assert.equal(isAuthorized(update, { allowedChatIds: ['7'] }), true);
});

test('ID 목록 파싱', () => {
  assert.deepEqual(parseIdList('1, 2 ,3'), ['1', '2', '3']);
  assert.deepEqual(parseIdList(''), []);
  assert.deepEqual(parseIdList(undefined), []);
});

test('시크릿 비교', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
});

test('인라인 키보드 생성', () => {
  const kb = inlineKeyboard([[{ text: 'Choose', action: 'ch', args: ['260727', 1] }]]);
  assert.deepEqual(kb, {
    inline_keyboard: [[{ text: 'Choose', callback_data: 'ch:260727:1' }]],
  });
});

test('없는 후보를 찾으면 있는 순번을 알려준다', () => {
  const data = { date: '2026-07-27', candidates: [{ index: 1 }, { index: 2 }] };
  assert.equal(findCandidate(data, '2').index, 2);
  assert.throws(() => findCandidate(data, 9), /있는 순번: 1, 2/);
});

test('검수 대기가 아니면 확정할 수 없다', () => {
  assert.equal(canFinalize({ candidate: { status: 'pending' }, target: 'uploaded' }).allow, false);
  assert.equal(canFinalize({ candidate: { status: 'review' }, target: 'uploaded' }).allow, true);
  // 폐기는 제작 전에도 가능해야 한다.
  assert.equal(canFinalize({ candidate: { status: 'pending' }, target: 'dropped' }).allow, true);
});

test('이미 처리된 후보는 다시 확정할 수 없다', () => {
  assert.equal(canFinalize({ candidate: { status: 'uploaded' }, target: 'uploaded' }).allow, false);
  assert.equal(canFinalize({ candidate: { status: 'dropped' }, target: 'uploaded' }).allow, false);
});

test('날짜 차이 계산', () => {
  assert.equal(daysBetween('2026-07-21', '2026-07-28'), 7);
  assert.equal(daysBetween('2026-07-28', '2026-07-28'), 0);
  // 서머타임이 있는 지역이어도 UTC 고정이라 어긋나지 않아야 한다.
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
});

test('7일 이내 후보는 제작을 허용한다', () => {
  const at = (published) => canProduce({ candidate: { status: 'pending', published }, today: '2026-07-28' });
  assert.equal(at('2026-07-28').allow, true);
  assert.equal(at('2026-07-21').allow, true, '경계값 7일은 허용되어야 한다');
});

test('7일을 넘긴 후보는 거부하고 이유를 알려준다', () => {
  const verdict = canProduce({
    candidate: { status: 'pending', published: '2026-07-20' },
    today: '2026-07-28',
  });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, new RegExp(`8일.*상한 ${MAX_CANDIDATE_AGE_DAYS}일`));
});

test('발행일이 없으면 나이를 이유로 막지 않는다', () => {
  assert.equal(canProduce({ candidate: { status: 'pending' }, today: '2026-07-28' }).allow, true);
  assert.equal(
    canProduce({ candidate: { status: 'pending', published: '알수없음' }, today: '2026-07-28' }).allow,
    true,
  );
});

test('하루 제작 개수는 제한하지 않는다', () => {
  const verdict = canProduce({
    candidate: { status: 'pending', published: '2026-07-28' },
    today: '2026-07-28',
    producedToday: 99,
  });
  assert.equal(verdict.allow, true);
});

test('재생성은 횟수로 막지 않되 누적되면 경고한다', () => {
  const at = (attempts) => canRecreate({ candidate: { status: 'review', attempts } });
  assert.equal(at(1).allow, true);
  assert.equal(at(1).warn, undefined);

  const warned = at(RECREATE_WARN_AFTER);
  assert.equal(warned.allow, true, '경고 이후에도 계속 허용되어야 한다');
  assert.match(warned.warn, /회차/);

  // 훨씬 더 쌓여도 여전히 허용
  assert.equal(at(20).allow, true);
});

test('검수 대기가 아니면 재생성할 수 없다', () => {
  assert.equal(canRecreate({ candidate: { status: 'pending' } }).allow, false);
  assert.equal(canRecreate({ candidate: { status: 'uploaded' } }).allow, false);
});
