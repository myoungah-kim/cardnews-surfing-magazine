/**
 * core/instagram.js 단위 테스트 — 실제 Graph API 호출 없이 global.fetch 를 모킹한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InstagramClient, InstagramError } from '../core/instagram.js';

/**
 * 큐에 넣어둔 응답을 순서대로 돌려주는 fetch 모킹.
 * @param {Array<{status?: number, body?: object}>} responses
 */
function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('mockFetch: 큐가 비었는데 fetch 가 더 호출됨');
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
}

function withFetch(fetchImpl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('createImageContainer 는 image_url·caption·access_token 을 실어 보낸다', async () => {
  const fetchMock = mockFetch([{ body: { id: 'creation-1' } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    const result = await client.createImageContainer({ imageUrl: 'https://example.com/a.png', caption: '캡션' });

    assert.deepEqual(result, { id: 'creation-1' });
    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /\/ig-user-1\/media$/);
    const sentBody = new URLSearchParams(fetchMock.calls[0].init.body);
    assert.equal(sentBody.get('image_url'), 'https://example.com/a.png');
    assert.equal(sentBody.get('caption'), '캡션');
    assert.equal(sentBody.get('access_token'), 'token-abc');
  });
});

test('4xx 응답은 재시도 없이 즉시 던진다', async () => {
  const fetchMock = mockFetch([{ status: 401, body: { error: { message: '토큰 만료' } } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1', { retries: 2 });
    await assert.rejects(
      () => client.createImageContainer({ imageUrl: 'https://example.com/a.png', caption: 'c' }),
      (err) => {
        assert.ok(err instanceof InstagramError);
        assert.equal(err.permanent, true);
        assert.equal(err.status, 401);
        return true;
      },
    );
    assert.equal(fetchMock.calls.length, 1, '4xx 는 재시도하지 않아야 한다');
  });
});

test('5xx 응답은 재시도 횟수만큼 시도하다 실패한다', async () => {
  const fetchMock = mockFetch([
    { status: 500, body: { error: { message: '서버 오류' } } },
    { status: 500, body: { error: { message: '서버 오류' } } },
    { status: 500, body: { error: { message: '서버 오류' } } },
  ]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1', { retries: 2 });
    await assert.rejects(
      () => client.createImageContainer({ imageUrl: 'https://example.com/a.png', caption: 'c' }),
      (err) => {
        assert.ok(err instanceof InstagramError);
        assert.equal(err.permanent, false);
        return true;
      },
    );
    assert.equal(fetchMock.calls.length, 3, 'retries=2 면 최초 시도 + 재시도 2회 = 3번 호출되어야 한다');
  });
});

test('waitUntilFinished 는 FINISHED 가 나올 때까지 폴링하다 멈춘다', async () => {
  const fetchMock = mockFetch([
    { body: { status_code: 'IN_PROGRESS' } },
    { body: { status_code: 'IN_PROGRESS' } },
    { body: { status_code: 'FINISHED' } },
  ]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    await client.waitUntilFinished('creation-1', { intervalMs: 1, maxAttempts: 5 });
    assert.equal(fetchMock.calls.length, 3);
  });
});

test('waitUntilFinished 는 ERROR 상태에서 더 기다리지 않고 실패한다', async () => {
  const fetchMock = mockFetch([{ body: { status_code: 'ERROR' } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    await assert.rejects(
      () => client.waitUntilFinished('creation-1', { intervalMs: 1, maxAttempts: 5 }),
      /ERROR/,
    );
    assert.equal(fetchMock.calls.length, 1, 'ERROR 를 만나면 더 폴링하지 않아야 한다');
  });
});

test('postImage 는 컨테이너 생성 → 대기 → 게시 → permalink 조회 순서로 진행한다', async () => {
  const fetchMock = mockFetch([
    { body: { id: 'creation-1' } },
    { body: { status_code: 'FINISHED' } },
    { body: { id: 'media-1' } },
    { body: { permalink: 'https://instagram.com/p/xyz' } },
  ]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    const result = await client.postImage({ imageUrl: 'https://example.com/a.png', caption: '캡션' });

    assert.deepEqual(result, { mediaId: 'media-1', permalink: 'https://instagram.com/p/xyz' });
    assert.equal(fetchMock.calls.length, 4);
    assert.match(fetchMock.calls[0].url, /\/ig-user-1\/media$/);
    assert.match(fetchMock.calls[1].url, /\/creation-1\?/);
    assert.match(fetchMock.calls[2].url, /\/ig-user-1\/media_publish$/);
    assert.match(fetchMock.calls[3].url, /\/media-1\?/);
  });
});
