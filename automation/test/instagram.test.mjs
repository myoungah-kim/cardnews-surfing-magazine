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

// ── 릴즈 ────────────────────────────────────────────────────────────────

test('createReelContainer 는 media_type=REELS 와 video_url 을 보낸다', async () => {
  const fetchMock = mockFetch([{ body: { id: 'creation-r' } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    await client.createReelContainer({ videoUrl: 'https://example.com/r.mp4', caption: '캡션' });

    const sentBody = new URLSearchParams(fetchMock.calls[0].init.body);
    assert.equal(sentBody.get('media_type'), 'REELS');
    assert.equal(sentBody.get('video_url'), 'https://example.com/r.mp4');
    assert.equal(sentBody.get('caption'), '캡션');
  });
});

test('릴즈는 기본적으로 그리드(피드)에 노출하지 않는다', async () => {
  // 같은 내용의 이미지 포스트를 따로 올리므로, 릴즈까지 그리드에 뜨면 중복 노출된다.
  const fetchMock = mockFetch([{ body: { id: 'creation-r' } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    await client.createReelContainer({ videoUrl: 'https://example.com/r.mp4', caption: 'c' });

    const sentBody = new URLSearchParams(fetchMock.calls[0].init.body);
    // Graph API 는 폼 값을 문자열로 받는다 — boolean 을 그대로 넣으면 안 된다.
    assert.equal(sentBody.get('share_to_feed'), 'false');
  });
});

test('shareToFeed:true 를 주면 피드에도 노출한다', async () => {
  const fetchMock = mockFetch([{ body: { id: 'creation-r' } }]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    await client.createReelContainer({
      videoUrl: 'https://example.com/r.mp4',
      caption: 'c',
      shareToFeed: true,
    });

    assert.equal(new URLSearchParams(fetchMock.calls[0].init.body).get('share_to_feed'), 'true');
  });
});

test('postReel 은 영상 트랜스코딩을 기다렸다가 게시한다', async () => {
  // 영상은 이미지와 달리 IN_PROGRESS 가 여러 번 나온다 — 그동안 계속 기다려야 한다.
  const fetchMock = mockFetch([
    { body: { id: 'creation-r' } },
    { body: { status_code: 'IN_PROGRESS' } },
    { body: { status_code: 'IN_PROGRESS' } },
    { body: { status_code: 'FINISHED' } },
    { body: { id: 'media-r' } },
    { body: { permalink: 'https://instagram.com/reel/abc' } },
  ]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    // 실제 폴링 간격(5초)으로 돌리면 테스트가 15초 걸리므로 대기를 없앤다.
    client.waitUntilFinished = (id) =>
      InstagramClient.prototype.waitUntilFinished.call(client, id, {
        intervalMs: 1,
        maxAttempts: 60,
      });

    const result = await client.postReel({ videoUrl: 'https://example.com/r.mp4', caption: 'c' });

    assert.deepEqual(result, { mediaId: 'media-r', permalink: 'https://instagram.com/reel/abc' });
    assert.match(fetchMock.calls.at(-2).url, /\/ig-user-1\/media_publish$/);
  });
});

test('릴즈 대기 한도는 이미지보다 넉넉해야 한다', async () => {
  // 이미지 기본값(3초x10회=30초)으로는 영상 트랜스코딩이 거의 항상 시간 초과된다.
  // postReel 이 자체 옵션을 넘기는지 확인한다.
  const seen = [];
  const fetchMock = mockFetch([
    { body: { id: 'creation-r' } },
    { body: { status_code: 'FINISHED' } },
    { body: { id: 'media-r' } },
    { body: { permalink: 'https://instagram.com/reel/abc' } },
  ]);
  await withFetch(fetchMock, async () => {
    const client = new InstagramClient('token-abc', 'ig-user-1');
    const original = client.waitUntilFinished.bind(client);
    client.waitUntilFinished = (id, opts) => {
      seen.push(opts);
      return original(id, { ...opts, intervalMs: 1 });
    };

    await client.postReel({ videoUrl: 'https://example.com/r.mp4', caption: 'c' });
  });

  assert.equal(seen.length, 1);
  assert.ok(
    seen[0].intervalMs * seen[0].maxAttempts >= 300_000,
    `릴즈 대기 한도가 ${seen[0].intervalMs * seen[0].maxAttempts}ms 로 5분 미만이다`,
  );
});
