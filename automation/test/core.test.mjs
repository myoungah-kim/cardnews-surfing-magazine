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
import { canFinalize } from '../app/policy.js';

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
