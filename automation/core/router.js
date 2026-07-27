/**
 * Telegram 업데이트 라우터.
 *
 * 웹훅이 반드시 지켜야 하는 규칙을 한 곳에 강제한다:
 *
 *   ① 어떤 상황에서도 200 을 돌려준다.
 *      Telegram 은 non-2xx 를 받으면 같은 업데이트를 재전송한다.
 *      핸들러가 터졌는데 500 을 주면 같은 작업이 반복 실행된다.
 *
 *   ② 무거운 일을 하기 전에 answerCallbackQuery 를 먼저 호출한다.
 *      그래야 버튼의 로딩 스피너가 즉시 멈춘다.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

import { decodeCallback } from './callback.js';
import { extractContext } from './context.js';
import { isAuthorized } from './guard.js';

/**
 * @typedef {object} HandlerContext
 * @property {import('./telegram.js').TelegramClient} telegram
 * @property {object} update 원본 업데이트
 * @property {number} chatId
 * @property {number} [messageId] 버튼이 달려 있던 메시지 (콜백일 때만)
 * @property {(promise: Promise<any>) => void} background 응답 후에도 계속 실행할 작업 등록
 */

/**
 * @param {object} config
 * @param {Record<string, (args: string[], ctx: HandlerContext) => Promise<void>>} config.buttons
 *        버튼 액션 이름 → 핸들러
 * @param {Record<string, (text: string, args: string[], ctx: HandlerContext) => Promise<void>>} [config.replies]
 *        강제 답장 컨텍스트 액션 이름 → 핸들러
 * @param {(ctx: HandlerContext) => Promise<void>} [config.onUnknown] 처리할 수 없는 업데이트
 * @param {(error: Error, ctx: HandlerContext) => Promise<void>} [config.onError]
 */
export function createRouter(config) {
  const buttons = config.buttons ?? {};
  const replies = config.replies ?? {};

  /**
   * @param {object} update
   * @param {{telegram: import('./telegram.js').TelegramClient, policy: object, background: (p: Promise<any>) => void}} deps
   */
  return async function handle(update, deps) {
    const { telegram, policy, background } = deps;
    const callback = update.callback_query;
    const message = update.message;
    const source = callback?.message ?? message;

    /** @type {HandlerContext} */
    const ctx = {
      telegram,
      update,
      chatId: source?.chat?.id,
      messageId: callback?.message?.message_id,
      background,
    };

    if (!isAuthorized(update, policy)) {
      // 조용히 무시한다 — 제3자에게 "여기 봇이 있다"는 신호조차 주지 않기 위함.
      // 다만 버튼 클릭은 스피너가 계속 돌기 때문에 최소한의 응답은 준다.
      if (callback) {
        await telegram
          .answerCallbackQuery({ callback_query_id: callback.id, text: '권한이 없습니다' })
          .catch(() => {});
      }
      return { status: 'unauthorized' };
    }

    try {
      if (callback) {
        // ② 무거운 작업 전에 먼저 스피너를 멈춘다.
        await telegram
          .answerCallbackQuery({ callback_query_id: callback.id })
          .catch(() => {});

        const { action, args } = decodeCallback(callback.data ?? '');
        const handler = buttons[action];
        if (!handler) {
          await config.onUnknown?.(ctx);
          return { status: 'unknown-action', action };
        }
        await handler(args, ctx);
        return { status: 'ok', action };
      }

      if (message?.reply_to_message) {
        const parsed = extractContext(message.reply_to_message.text);
        const handler = parsed && replies[parsed.action];
        if (!handler) {
          await config.onUnknown?.(ctx);
          return { status: 'unknown-reply' };
        }
        await handler(message.text ?? '', parsed.args, ctx);
        return { status: 'ok', action: parsed.action };
      }

      await config.onUnknown?.(ctx);
      return { status: 'ignored' };
    } catch (error) {
      // ① 오류를 삼키지 않고 사용자에게 알리되, 200 은 유지한다.
      await config.onError?.(error, ctx);
      return { status: 'error', error: error.message };
    }
  };
}
