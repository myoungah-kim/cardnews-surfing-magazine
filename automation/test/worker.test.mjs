/**
 * 워커 통합 테스트 — fetch 를 가로채 Telegram·GitHub 호출을 기록한다.
 *
 * 여기서 잡으려는 것은 배포 후에야 드러나는 배선 오류다:
 * 인증 우회, 스피너가 안 멈추는 문제, 잘못된 이벤트 이름으로 dispatch,
 * 그리고 무엇보다 **오류가 나도 200 을 돌려주는가** (아니면 Telegram 이
 * 같은 업데이트를 재전송해 카드가 여러 장 만들어진다).
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

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

function post(update, { secret = 'test-secret' } = {}) {
  return worker.fetch(
    new Request('https://worker.test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(update),
    }),
    ENV,
    ctx,
  );
}

/** 내 계정이 Choose 를 누른 상황 */
function chooseUpdate(chatId = 777) {
  return {
    callback_query: {
      id: 'cb-1',
      data: 'ch:260727:2',
      from: { id: chatId },
      message: { message_id: 55, chat: { id: chatId } },
    },
  };
}

const telegramCalls = (method) => calls.filter((c) => c.url.endsWith(`/${method}`));
const githubCalls = () => calls.filter((c) => c.url.includes('api.github.com'));

test('시크릿이 틀리면 403 이고 아무것도 호출하지 않는다', async () => {
  const response = await post(chooseUpdate(), { secret: 'wrong' });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('허용되지 않은 chat 은 워크플로를 트리거하지 못한다', async () => {
  const response = await post(chooseUpdate(999));
  assert.equal(response.status, 200);
  assert.equal(await response.json().then((r) => r.status), 'unauthorized');
  assert.equal(githubCalls().length, 0);
});

test('Choose 는 스피너를 먼저 멈추고 produce-card 를 트리거한다', async () => {
  const response = await post(chooseUpdate());
  assert.equal(response.status, 200);

  // 스피너 정지가 GitHub 호출보다 먼저 일어나야 한다.
  const answerIndex = calls.findIndex((c) => c.url.endsWith('/answerCallbackQuery'));
  const dispatchIndex = calls.findIndex((c) => c.url.includes('api.github.com'));
  assert.ok(answerIndex >= 0, 'answerCallbackQuery 가 호출되지 않았습니다');
  assert.ok(answerIndex < dispatchIndex, 'answerCallbackQuery 가 dispatch 보다 늦습니다');

  // 중복 클릭 방지를 위해 버튼을 제거했는가
  assert.equal(telegramCalls('editMessageReplyMarkup').length, 1);

  const dispatch = githubCalls()[0];
  assert.equal(dispatch.body.event_type, 'produce-card');
  assert.deepEqual(dispatch.body.client_payload, {
    date: '2026-07-27',
    index: '2',
    chat_id: '777',
  });
});

test('Upload / Drop 은 finalize-card 를 결정값과 함께 트리거한다', async () => {
  for (const [action, decision] of [
    ['up', 'uploaded'],
    ['dr', 'dropped'],
  ]) {
    calls = [];
    await post({
      callback_query: {
        id: 'cb',
        data: `${action}:260727:1`,
        from: { id: 777 },
        message: { message_id: 60, chat: { id: 777 } },
      },
    });
    const dispatch = githubCalls()[0];
    assert.equal(dispatch.body.event_type, 'finalize-card');
    assert.equal(dispatch.body.client_payload.decision, decision);
  }
});

test('Recreate 는 곧바로 제작하지 않고 되묻는다', async () => {
  await post({
    callback_query: {
      id: 'cb',
      data: 'rc:260727:1',
      from: { id: 777 },
      message: { message_id: 61, chat: { id: 777 } },
    },
  });

  // 텍스트를 받기 전이므로 워크플로를 트리거하면 안 된다.
  assert.equal(githubCalls().length, 0);

  const asked = telegramCalls('sendMessage')[0];
  assert.equal(asked.body.reply_markup.force_reply, true);
  // 답장을 되받았을 때 무엇에 대한 것인지 알 수 있도록 태그가 심겨 있어야 한다.
  assert.match(asked.body.text, /〔#rc:260727:1〕/);
});

test('수정 요청 답장이 오면 feedback 과 함께 재제작을 건다', async () => {
  await post({
    message: {
      message_id: 62,
      from: { id: 777 },
      chat: { id: 777 },
      text: '헤드라인을 더 세게',
      reply_to_message: { text: '🔁 어떤 부분을 고칠까요?\n\n〔#rc:260727:1〕' },
    },
  });

  const dispatch = githubCalls()[0];
  assert.equal(dispatch.body.event_type, 'produce-card');
  assert.equal(dispatch.body.client_payload.feedback, '헤드라인을 더 세게');
  assert.equal(dispatch.body.client_payload.index, '1');
});

test('빈 답장은 재제작을 걸지 않는다', async () => {
  await post({
    message: {
      message_id: 63,
      from: { id: 777 },
      chat: { id: 777 },
      text: '   ',
      reply_to_message: { text: '〔#rc:260727:1〕' },
    },
  });
  assert.equal(githubCalls().length, 0);
});

test('핸들러가 터져도 200 을 유지하고 사용자에게 알린다', async () => {
  // GitHub 호출만 실패시킨다.
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.github.com')) {
      calls.push({ url: String(url), body: null });
      return new Response('boom', { status: 500 });
    }
    return base(url, init);
  };

  const response = await post(chooseUpdate());
  // 여기서 500 을 주면 Telegram 이 재전송해 카드가 중복 생성된다.
  assert.equal(response.status, 200);
  assert.equal(await response.json().then((r) => r.status), 'error');

  const notice = telegramCalls('sendMessage').at(-1);
  assert.match(notice.body.text, /오류가 발생했습니다/);
});

test('POST 가 아니면 헬스체크 응답', async () => {
  const response = await worker.fetch(new Request('https://worker.test/'), ENV, ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /alive/);
});
