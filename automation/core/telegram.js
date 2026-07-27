/**
 * Telegram Bot API 얇은 클라이언트 — 의존성 없음.
 *
 * Cloudflare Workers 와 Node 20+ 양쪽에서 그대로 동작한다
 * (둘 다 전역 fetch / FormData / Blob 를 제공).
 *
 * 이 파일은 프로젝트에 종속되지 않는다. 다른 프로젝트에 그대로 복사해 쓸 것.
 */

const API_ROOT = 'https://api.telegram.org';

/** Telegram 이 클라이언트 오류로 간주해 재시도해도 소용없는 코드 */
const NON_RETRYABLE = new Set([400, 401, 403, 404]);

export class TelegramError extends Error {
  /**
   * @param {string} method 호출한 Bot API 메서드
   * @param {number} status HTTP 상태 코드
   * @param {object} body 파싱된 응답 본문
   */
  constructor(method, status, body) {
    super(`Telegram ${method} 실패 (${status}): ${body?.description ?? '알 수 없는 오류'}`);
    this.name = 'TelegramError';
    this.method = method;
    this.status = status;
    this.body = body;
    /** 재시도해도 결과가 달라지지 않는 오류인지 */
    this.permanent = NON_RETRYABLE.has(status);
  }
}

export class TelegramClient {
  /**
   * @param {string} token @BotFather 가 발급한 봇 토큰
   * @param {{retries?: number, timeoutMs?: number}} [options]
   */
  constructor(token, options = {}) {
    if (!token) throw new Error('TelegramClient: 봇 토큰이 비어 있습니다');
    this.token = token;
    this.retries = options.retries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Bot API 메서드를 JSON 으로 호출한다.
   *
   * 429(rate limit)와 5xx 는 재시도하고, 4xx 는 즉시 던진다 —
   * 잘못된 chat_id 를 반복 호출해봐야 결과가 같기 때문.
   *
   * @param {string} method 예: 'sendMessage'
   * @param {object} [payload]
   * @returns {Promise<any>} API 응답의 result 필드
   */
  async call(method, payload = {}) {
    return this.#request(method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * 파일 업로드가 필요한 메서드용 multipart 호출.
   *
   * @param {string} method 예: 'sendPhoto'
   * @param {Record<string, unknown>} fields 일반 필드
   * @param {Record<string, {data: Uint8Array|ArrayBuffer, filename: string, contentType?: string}>} files
   */
  async upload(method, fields, files) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    for (const [key, file] of Object.entries(files)) {
      const blob = new Blob([file.data], { type: file.contentType ?? 'application/octet-stream' });
      form.append(key, blob, file.filename);
    }
    return this.#request(method, { method: 'POST', body: form });
  }

  async #request(method, init) {
    const url = `${API_ROOT}/bot${this.token}/${method}`;
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      let response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (cause) {
        // 네트워크 오류·타임아웃은 재시도 대상
        lastError = new Error(`Telegram ${method} 네트워크 오류: ${cause.message}`, { cause });
        await this.#backoff(attempt);
        continue;
      }

      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) return body.result;

      const error = new TelegramError(method, response.status, body);
      if (error.permanent) throw error;

      lastError = error;
      // 429 는 Telegram 이 알려준 대기 시간을 존중한다
      const retryAfter = body?.parameters?.retry_after;
      await this.#backoff(attempt, retryAfter ? retryAfter * 1000 : undefined);
    }

    throw lastError;
  }

  #backoff(attempt, overrideMs) {
    const delay = overrideMs ?? Math.min(2 ** attempt * 500, 5_000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  // ── 자주 쓰는 메서드 편의 래퍼 ────────────────────────────────

  /** @param {{chat_id: string|number, text: string, reply_markup?: object, parse_mode?: string, disable_web_page_preview?: boolean, reply_to_message_id?: number}} params */
  sendMessage(params) {
    return this.call('sendMessage', params);
  }

  /**
   * 버튼 클릭에 대한 즉시 응답. Telegram 은 이걸 받아야 버튼의 로딩
   * 스피너를 멈추므로, 무거운 작업 전에 가장 먼저 호출해야 한다.
   * @param {{callback_query_id: string, text?: string, show_alert?: boolean}} params
   */
  answerCallbackQuery(params) {
    return this.call('answerCallbackQuery', params);
  }

  /** @param {{chat_id: string|number, message_id: number, text: string, reply_markup?: object, parse_mode?: string}} params */
  editMessageText(params) {
    return this.call('editMessageText', params);
  }

  /** @param {{chat_id: string|number, message_id: number, reply_markup?: object}} params */
  editMessageReplyMarkup(params) {
    return this.call('editMessageReplyMarkup', params);
  }

  /**
   * 이미지 전송. Telegram 은 sendPhoto 로 보낸 이미지를 재압축하므로,
   * 원본 화질이 중요하면 sendDocument 를 쓸 것.
   * @param {{chat_id: string|number, caption?: string, parse_mode?: string, reply_markup?: object}} fields
   * @param {{data: Uint8Array, filename: string, contentType?: string}} photo
   */
  sendPhoto(fields, photo) {
    return this.upload('sendPhoto', fields, { photo: { contentType: 'image/png', ...photo } });
  }

  /**
   * 무손실 파일 전송. 카드뉴스 PNG 는 화질 보존이 중요하므로 이쪽을 쓴다.
   * @param {{chat_id: string|number, caption?: string, parse_mode?: string, reply_markup?: object}} fields
   * @param {{data: Uint8Array, filename: string, contentType?: string}} document
   */
  sendDocument(fields, document) {
    return this.upload('sendDocument', fields, { document });
  }
}

/**
 * Telegram MarkdownV2 는 예약문자가 많아 이스케이프를 빠뜨리면 400 이 난다.
 * 사용자 입력이나 기사 제목을 그대로 넣을 때 반드시 통과시킬 것.
 * @param {string} text
 */
export function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (ch) => `\\${ch}`);
}

/**
 * HTML parse_mode 용 이스케이프. MarkdownV2 보다 예약문자가 적어
 * 본문에 기사 제목·인용문이 섞일 때 더 안전하다.
 * @param {string} text
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
