/**
 * "Telegram 후보 메시지 → 최종 업로드" 전체 파이프라인에서, 캡션/사진 버그
 * (router 가 message.text 만 읽어 photo caption 을 놓치던 문제)와 같은 종류의
 * 실패 — Telegram 업데이트의 예상 밖 모양, 상태 전이 사이의 빈틈, 되묻는
 * 메시지가 실제 상황과 안 맞는 경우 — 를 잡기 위한 회귀/문서화 테스트.
 *
 * 이 파일의 테스트는 두 종류다:
 *   - "현재 안전함"을 확인하는 회귀 가드 (초록으로 유지되어야 함)
 *   - "현재 이렇게 동작한다"를 문서화하는 갭 테스트 (의도적으로 현재 동작을
 *     assert 한다 — 실패하지 않지만, 주석에 왜 위험한지 적어 둔다).
 *     이 파일만 보고 고칠지 말지 판단할 수 있게 하는 것이 목적이다.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { chunkText, escapeHtml } from '../core/telegram.js';
import { isAuthorized } from '../core/guard.js';
import { canProduce, isDuplicateRecreateReply } from '../app/policy.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const finalizeSource = () => readFileSync(path.join(ROOT, 'scripts', 'finalize.mjs'), 'utf8');
const produceWorkflowSource = () =>
  readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'produce-card.yml'), 'utf8');

// ── 워커 통합 테스트용 공통 하네스 (worker.test.mjs 와 동일한 패턴) ──────────

const ENV = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  TELEGRAM_ALLOWED_CHAT_IDS: '777',
  GITHUB_TOKEN: 'gh-token',
  GITHUB_REPO: 'owner/repo',
};

/** @type {{url: string, body: any}[]} */
let calls = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url: String(url), body });
    if (String(url).includes('api.github.com')) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ctx = { waitUntil: () => {} };

function post(update) {
  return worker.fetch(
    new Request('https://worker.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify(update),
    }),
    ENV,
    ctx,
  );
}

const telegramCalls = (method) => calls.filter((c) => c.url.endsWith(`/${method}`));
const githubCalls = () => calls.filter((c) => c.url.includes('api.github.com'));

// ── 1. 답장을 "수정"하면 조용히 무시된다 ────────────────────────────────

test('[수정됨] Recreate 답장을 보낸 뒤 수정하면(edited_message) 재실행 없이 안내가 나간다', async () => {
  // 오타를 고치려고 텔레그램의 "메시지 수정"을 쓰면, Telegram 은 이 업데이트를
  // message 가 아니라 edited_message 로 보낸다. 예전엔 router 가 update.message 만
  // 읽어 chatId 조차 못 정해 완전 무응답이었다 — 이제 edited_message 로도
  // 채팅방을 찾고, onEditedMessage 로 명확히 안내한다. 수정본을 다시 dispatch
  // 하지는 않는다 — 원본 메시지가 이미 처리됐을 수 있어 중복 실행 위험이 있다.
  await post({
    edited_message: {
      message_id: 70,
      from: { id: 777 },
      chat: { id: 777 },
      text: '헤드라인을 더 세게 (오타 고침)',
      reply_to_message: { text: '🔁 어떤 부분을 고칠까요?\n\n〔#rc:260727:1〕' },
    },
  });

  assert.equal(githubCalls().length, 0, '수정본을 다시 dispatch 하면 원본과 중복 실행될 수 있다');
  const reply = telegramCalls('sendMessage').at(-1);
  assert.match(reply.body.text, /새 메시지를 다시 답장/);
});

// ── 2. 사진이 아니라 "파일"로 보내면 사진이 조용히 사라진다 ─────────────────

test('[수정됨] 사진을 파일(document)로 첨부해도 이미지면 photo 로 인식한다', async () => {
  // Telegram 클라이언트에서 "압축 안 함/파일로 보내기"를 고르면 photo 가 아니라
  // document 로 온다. mime_type 이 image/* 면 photo 와 동일하게 취급해야
  // 사용자가 실제로 보낸 사진이 조용히 사라지지 않는다.
  await post({
    message: {
      message_id: 71,
      from: { id: 777 },
      chat: { id: 777 },
      caption: '이 사진으로 배경을 바꿔줘',
      document: { file_id: 'doc-1', file_name: 'photo.jpg', mime_type: 'image/jpeg' },
      reply_to_message: { text: '〔#rc:260727:1〕' },
    },
  });

  const dispatch = githubCalls()[0];
  assert.equal(dispatch.body.client_payload.feedback, '이 사진으로 배경을 바꿔줘');
  assert.equal(dispatch.body.client_payload.photoFileId, 'doc-1');
  const progress = telegramCalls('sendMessage').at(-1);
  assert.match(progress.body.text, /첨부한 사진을 참고합니다/);
});

test('[회귀] 이미지가 아닌 파일(PDF 등)은 photo 로 취급하지 않는다', async () => {
  await post({
    message: {
      message_id: 71.5,
      from: { id: 777 },
      chat: { id: 777 },
      caption: '이 자료 참고해줘',
      document: { file_id: 'doc-2', file_name: 'notes.pdf', mime_type: 'application/pdf' },
      reply_to_message: { text: '〔#rc:260727:1〕' },
    },
  });

  const dispatch = githubCalls()[0];
  assert.equal(dispatch.body.client_payload.photoFileId, '');
});

// ── 3. 같은 force-reply 에 두 번 답장하면 두 번 dispatch 된다 ───────────────

test('[수정됨] 같은 메시지가 웹훅 재전송 등으로 두 번 들어오면 dispatch 자체는 매번 걸리지만, 러너가 message_id 로 중복을 걸러낸다', async () => {
  // 워커는 무상태라(의도적으로) 여기서 dispatch 를 막지 않는다 — 대신 이번
  // 답장의 message_id 를 payload 에 실어 보내고, 실제 중복 판단은 후보 상태를
  // 볼 수 있는 러너(prepare-produce.mjs → isDuplicateRecreateReply)가 한다.
  const reply = () =>
    post({
      message: {
        message_id: 72,
        from: { id: 777 },
        chat: { id: 777 },
        text: '배경을 더 어둡게',
        reply_to_message: { text: '〔#rc:260727:1〕' },
      },
    });

  await reply();
  await reply(); // 실수로 두 번 보내거나, 네트워크 지연으로 재전송한 경우

  const dispatches = githubCalls();
  assert.equal(dispatches.length, 2);
  // 두 dispatch 모두 같은 replyMessageId 를 실어 보내므로, 러너 쪽에서
  // isDuplicateRecreateReply 로 두 번째를 걸러낼 수 있다 (아래 단위 테스트).
  assert.equal(dispatches[0].body.client_payload.replyMessageId, '72');
  assert.equal(dispatches[1].body.client_payload.replyMessageId, '72');
});

test('[수정됨] isDuplicateRecreateReply 가 같은 message_id 의 재실행을 막는다', () => {
  const candidate = { status: 'review', lastRecreateMessageId: '72' };
  assert.equal(isDuplicateRecreateReply({ candidate, replyMessageId: '72' }), true);
});

test('[회귀] 다른 message_id 로 이어 보낸 추가 요청은 중복으로 보지 않는다', () => {
  const candidate = { status: 'review', lastRecreateMessageId: '72' };
  assert.equal(isDuplicateRecreateReply({ candidate, replyMessageId: '73' }), false);
});

// ── 4. 검수 대기 카드도 Choose 로 다시 제작할 수 있었다 ─────────────────────

test('[수정됨] canProduce 는 이미 review 상태인 후보의 재-Choose 를 막는다', () => {
  // 버튼은 클릭 즉시 제거되지만(markPending), 다른 기기에 열려 있던 화면이나
  // 스크롤로 올라간 오래된 Choose 를 다시 누르는 경우가 있다 — 이미 카드가
  // 나와 검수 중인 후보라면 재-Choose 를 막고 Recreate 를 쓰라고 안내한다.
  const candidate = { status: 'review', published: '2026-07-28', attempts: 1 };
  const verdict = canProduce({ candidate, today: '2026-07-29', producedToday: 0 });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /Recreate/);
});

// ── 5. 캡션을 이스케이프+래핑한 뒤에도 4096자 상한을 지키는가 ───────────────

const wrap = (s) => `<pre>${escapeHtml(s)}</pre>`;
const wrappedLen = (s) => wrap(s).length;

test('[수정됨] escapeHtml + <pre> 래핑 후에도 chunkText 가 4096자 상한을 지킨다', () => {
  // 예전엔 "원문" 길이만 보고 3800자에서 잘랐다. 캡션에 &, <, > 가 많으면
  // (예: 인용문에 부등호나 앤퍼샌드가 많은 기사) escapeHtml 이 한 글자를 최대
  // 5글자로 부풀려 최종 길이가 Telegram 4096자 상한을 넘을 수 있었다.
  // 이제는 measure 로 "실제 전송될 길이"를 넘겨 그 기준으로 자른다.
  const adversarial = '<'.repeat(5000); // 원문만으론 훨씬 더 길어야 문제가 재현된다
  const parts = chunkText(adversarial, { limit: 4000, measure: wrappedLen });

  assert.ok(parts.length > 1, '자르긴 잘라야 의미가 있다');
  for (const part of parts) {
    assert.ok(wrappedLen(part) <= 4096, `조각 하나가 래핑 후 ${wrappedLen(part)}자로 상한을 넘었다`);
  }
  // 조각을 다 이어붙이면 원문이 그대로 복원돼야 한다 (내용 유실 없음).
  assert.equal(parts.join(''), adversarial);
});

test('[회귀] 특수문자가 적은 일반적인 캡션은 이스케이프 후에도 상한 안에 들어온다', () => {
  const normalCaption = '한국 서핑 이야기.\n\n'.repeat(300);
  const parts = chunkText(normalCaption, { limit: 4000, measure: wrappedLen });
  for (const part of parts) {
    assert.ok(wrappedLen(part) <= 4096);
  }
});

test('[회귀] chat 허용목록만 있을 때 edited_message 도 인증 자체는 통과한다', () => {
  // guard.identify() 는 edited_message 의 chat 은 정확히 읽는다 — 문제는
  // 인증이 아니라 router 가 그 업데이트 모양을 처리하지 못하는 것이다 (테스트 1).
  const update = {
    edited_message: { from: { id: 777 }, chat: { id: 777 }, text: '고침' },
  };
  assert.equal(isAuthorized(update, { allowedChatIds: ['777'] }), true);
});

// ── A/B. finalize.mjs: 게시 성공 후 안전장치 + 캐시버스팅 (소스 텍스트 검사) ──
//
// finalize.mjs 는 top-level 에서 run()을 실행해 import 만 해도 실제 Telegram/IG
// 호출과 process.exit 를 유발하므로, workflow-order.test.mjs 와 같은 방식으로
// 소스 자체를 검사한다.

test('[수정됨] finalize.mjs 는 캐시가 절대 stale 할 수 없는 GITHUB_SHA 로 이미지 URL을 만든다', () => {
  // 브랜치명(GITHUB_REF_NAME) URL은 raw.githubusercontent.com 에 수 분간 캐시된다.
  // Recreate 직후 바로 Upload 하면 캐시된 이전 카드가 게시될 수 있었다.
  const source = finalizeSource();
  assert.match(source, /requireEnv\('GITHUB_SHA'\)/);
  assert.doesNotMatch(
    source,
    /requireEnv\('GITHUB_REF_NAME'\)/,
    'GITHUB_REF_NAME 은 캐시 stale 위험이 있어 제거했다',
  );
});

test('[수정됨] finalize.mjs 는 게시 성공 즉시 permalink 를 남기고 알린 뒤에야 확정한다', () => {
  // 게시는 파이프라인으로 취소할 수 없다. 그래서 성공한 즉시 permalink 를 적어야
  // 재시도가 그걸 건너뛸 수 있고, 기록보다 알림이 먼저여야 "실패했다"는 메시지만
  // 보고 Upload 를 다시 눌러 중복 게시하는 일을 막을 수 있다.
  const source = finalizeSource();
  const recordPermalink = source.indexOf('candidate[key] = permalink');
  const notifySuccess = source.indexOf('게시 완료 —');
  const confirmUploaded = source.indexOf('candidate.status = decision;');

  assert.notEqual(recordPermalink, -1);
  assert.notEqual(notifySuccess, -1);
  assert.notEqual(confirmUploaded, -1);
  assert.ok(recordPermalink < notifySuccess, 'permalink 기록이 알림보다 먼저여야 한다');
  assert.ok(notifySuccess < confirmUploaded, '개별 게시 알림이 최종 확정보다 먼저여야 한다');
});

test('[수정됨] finalize.mjs 는 상태 기록 실패 시 "다시 누르지 말라"고 명시적으로 경고한다', () => {
  const source = finalizeSource();
  assert.match(source, /다시 누르지 마세요/);
});

// ── C. produce-card.yml: 실패 안내가 이미 사라진 버튼을 가리키지 않는다 ──────

test('[수정됨] produce-card.yml 실패 알림은 이미 사라진 버튼 대신 실행 가능한 재시도 방법을 알려준다', () => {
  // Choose/Recreate 버튼은 클릭 즉시 제거되므로, 실패 시점엔 "다시 눌러주세요"가
  // 가리키는 버튼이 항상 이미 없다 — 이건 이번 세션에서 고친 원래 버그와
  // 정확히 같은 유형(사라진 버튼을 가리키는 안내)이다.
  const source = produceWorkflowSource();
  assert.doesNotMatch(
    source,
    /다시 Choose 를 눌러 재시도할 수 있습니다/,
    '이 문구는 항상 이미 사라진 버튼을 가리킨다',
  );
  assert.match(source, /gh workflow run/, '항상 유효한 수동 재시도 명령을 안내해야 한다');
  assert.match(source, /검수 재발송/, 'Recreate 실패에는 버튼을 되살리는 경로도 안내해야 한다');
});

// ── D. produce-card.yml: 인스타그램 캡션 길이 사전검증 ──────────────────────

test('[수정됨] produce-card.yml 산출물 검증에 인스타그램 캡션 2200자 상한 검사가 있다', () => {
  // 이게 없으면 캡션이 길어도 검수까지 통과했다가 Upload 시점에야 Graph API
  // 400 으로 실패한다 — Claude 가 그 실행 안에서 바로 손볼 수 있을 때 잡는 게 낫다.
  const source = produceWorkflowSource();
  assert.match(source, /2200/);
});
