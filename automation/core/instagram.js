/**
 * Instagram Graph API 얇은 클라이언트 — 의존성 없음.
 *
 * core/telegram.js 와 같은 자리에 두는 이유도 같다: Node 20+ 러너에서
 * 전역 fetch 만으로 동작하고, 이 파일은 프로젝트에 종속되지 않는다.
 * 다른 프로젝트에 그대로 복사해 쓸 것.
 *
 * 게시 흐름 (Graph API 문서 기준):
 *   1. POST /{ig-user-id}/media        — 이미지 컨테이너 생성 (비동기 처리 시작)
 *   2. GET  /{container-id}?fields=status_code  — FINISHED 될 때까지 대기
 *   3. POST /{ig-user-id}/media_publish — 컨테이너를 실제 게시물로 전환
 *   4. GET  /{media-id}?fields=permalink — 게시된 글 링크 조회
 */

const DEFAULT_API_VERSION = 'v21.0';

/** Graph API 가 재시도해도 소용없다고 보는 HTTP 상태 (잘못된 토큰·권한·파라미터) */
const NON_RETRYABLE = new Set([400, 401, 403, 404]);

export class InstagramError extends Error {
  /**
   * @param {string} endpoint 호출한 Graph API 엔드포인트
   * @param {number} status HTTP 상태 코드
   * @param {object} body 파싱된 응답 본문 (Graph API 는 `error.message` 에 사유를 담는다)
   */
  constructor(endpoint, status, body) {
    super(`Instagram Graph API ${endpoint} 실패 (${status}): ${body?.error?.message ?? '알 수 없는 오류'}`);
    this.name = 'InstagramError';
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
    /** 재시도해도 결과가 달라지지 않는 오류인지 */
    this.permanent = NON_RETRYABLE.has(status);
  }
}

export class InstagramClient {
  /**
   * @param {string} accessToken 장기(long-lived) 액세스 토큰
   * @param {string} igUserId Instagram 비즈니스 계정 ID
   * @param {{retries?: number, timeoutMs?: number, apiVersion?: string}} [options]
   */
  constructor(accessToken, igUserId, options = {}) {
    if (!accessToken) throw new Error('InstagramClient: 액세스 토큰이 비어 있습니다');
    if (!igUserId) throw new Error('InstagramClient: IG 사용자 ID가 비어 있습니다');
    this.accessToken = accessToken;
    this.igUserId = igUserId;
    this.retries = options.retries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.apiRoot = `https://graph.facebook.com/${options.apiVersion ?? DEFAULT_API_VERSION}`;
  }

  /**
   * 이미지 미디어 컨테이너를 생성한다. 반환된 id 는 아직 게시된 게 아니라
   * publish() 로 넘겨야 실제 피드에 올라간다.
   * @param {{imageUrl: string, caption: string}} params
   * @returns {Promise<{id: string}>} creation_id
   */
  createImageContainer({ imageUrl, caption }) {
    return this.#call(`/${this.igUserId}/media`, {
      image_url: imageUrl,
      caption,
    });
  }

  /**
   * 컨테이너 처리 상태를 조회한다.
   * @param {string} creationId
   * @returns {Promise<{status_code: 'IN_PROGRESS'|'FINISHED'|'ERROR'|'EXPIRED', status?: string}>}
   */
  getContainerStatus(creationId) {
    return this.#call(`/${creationId}`, { fields: 'status_code' }, 'GET');
  }

  /**
   * 컨테이너가 FINISHED 상태가 될 때까지 기다린다.
   * 'ERROR'/'EXPIRED' 는 더 기다려도 소용없으므로 즉시 실패시킨다.
   *
   * @param {string} creationId
   * @param {{intervalMs?: number, maxAttempts?: number}} [opts]
   * @returns {Promise<void>}
   */
  async waitUntilFinished(creationId, { intervalMs = 3000, maxAttempts = 10 } = {}) {
    for (let i = 0; i < maxAttempts; i += 1) {
      const { status_code } = await this.getContainerStatus(creationId);
      if (status_code === 'FINISHED') return;
      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`Instagram 컨테이너 처리 실패: ${status_code}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Instagram 컨테이너가 시간 내에 준비되지 않았습니다');
  }

  /**
   * 컨테이너를 실제 게시물로 전환한다.
   * @param {string} creationId
   * @returns {Promise<{id: string}>} 게시된 미디어 id
   */
  publish(creationId) {
    return this.#call(`/${this.igUserId}/media_publish`, { creation_id: creationId });
  }

  /**
   * 게시된 글의 공개 링크를 조회한다.
   * @param {string} mediaId
   * @returns {Promise<string>}
   */
  async getPermalink(mediaId) {
    const { permalink } = await this.#call(`/${mediaId}`, { fields: 'permalink' }, 'GET');
    return permalink;
  }

  /**
   * 이미지 게시 전체 흐름을 순서대로 실행하는 편의 메서드.
   * @param {{imageUrl: string, caption: string}} params
   * @returns {Promise<{mediaId: string, permalink: string}>}
   */
  async postImage({ imageUrl, caption }) {
    const { id: creationId } = await this.createImageContainer({ imageUrl, caption });
    await this.waitUntilFinished(creationId);
    const { id: mediaId } = await this.publish(creationId);
    const permalink = await this.getPermalink(mediaId);
    return { mediaId, permalink };
  }

  /**
   * 릴즈(동영상) 미디어 컨테이너를 생성한다.
   *
   * `share_to_feed=false` 면 릴즈 탭에만 올라가고 프로필 그리드에는 뜨지 않는다 —
   * 같은 내용의 이미지 포스트를 따로 올리는 운영이라, 그리드에 중복 노출되는 것을 막는다.
   *
   * @param {{videoUrl: string, caption: string, shareToFeed?: boolean}} params
   * @returns {Promise<{id: string}>} creation_id
   */
  createReelContainer({ videoUrl, caption, shareToFeed = false }) {
    return this.#call(`/${this.igUserId}/media`, {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      // Graph API 는 폼 값을 문자열로 받으므로 boolean 을 그대로 넘기면 안 된다.
      share_to_feed: shareToFeed ? 'true' : 'false',
    });
  }

  /**
   * 릴즈 게시 전체 흐름.
   *
   * 이미지와 달리 **영상은 인스타그램 쪽 트랜스코딩에 훨씬 오래 걸린다**
   * (수십 초~수 분). postImage 가 쓰는 기본 대기(3초x10회=30초)로는 거의 항상
   * 시간 초과가 나므로, 여기서는 5초x60회(최대 5분)로 늘려 기다린다.
   *
   * @param {{videoUrl: string, caption: string, shareToFeed?: boolean}} params
   * @returns {Promise<{mediaId: string, permalink: string}>}
   */
  async postReel({ videoUrl, caption, shareToFeed = false }) {
    const { id: creationId } = await this.createReelContainer({ videoUrl, caption, shareToFeed });
    await this.waitUntilFinished(creationId, { intervalMs: 5000, maxAttempts: 60 });
    const { id: mediaId } = await this.publish(creationId);
    const permalink = await this.getPermalink(mediaId);
    return { mediaId, permalink };
  }

  /**
   * @param {string} endpoint `/` 로 시작하는 경로
   * @param {Record<string, string>} params
   * @param {'GET'|'POST'} [method]
   */
  async #call(endpoint, params, method = 'POST') {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const url = new URL(`${this.apiRoot}${endpoint}`);
      const init = { method, signal: AbortSignal.timeout(this.timeoutMs) };

      if (method === 'GET') {
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        url.searchParams.set('access_token', this.accessToken);
      } else {
        const body = new URLSearchParams({ ...params, access_token: this.accessToken });
        init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
        init.body = body;
      }

      let response;
      try {
        response = await fetch(url, init);
      } catch (cause) {
        lastError = new Error(`Instagram Graph API ${endpoint} 네트워크 오류: ${cause.message}`, { cause });
        await this.#backoff(attempt);
        continue;
      }

      const body = await response.json().catch(() => ({}));
      if (response.ok && !body.error) return body;

      const error = new InstagramError(endpoint, response.status, body);
      if (error.permanent) throw error;

      lastError = error;
      await this.#backoff(attempt);
    }

    throw lastError;
  }

  #backoff(attempt) {
    const delay = Math.min(2 ** attempt * 500, 5_000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
