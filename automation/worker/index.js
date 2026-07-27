/**
 * Cloudflare Worker — Telegram 웹훅 수신부.
 *
 * ── 이 워커가 하는 일과 하지 않는 일 ──────────────────────────
 *
 * 하는 일: 인증 → 즉시 응답 → GitHub Actions 깨우기. 전부 수백 ms 안에 끝난다.
 *
 * 하지 않는 일: **판단과 제작**. 워커는 후보 파일(git 안에 있음)을 볼 수 없고,
 * 헤드리스 크롬도 못 돌린다. 그래서 정책 검사(policy.js)조차 러너에서 수행하고,
 * 워커는 "요청이 들어왔다"는 사실만 전달한다.
 * 덕분에 워커는 완전히 무상태(stateless)이고 — KV·DB 가 필요 없다.
 *
 * 거부 사유(기간 만료, 중복 클릭 등)는 러너가 판단해서 Telegram 으로 직접 알린다.
 */

import { TelegramClient, escapeHtml } from '../core/telegram.js';
import { createRouter } from '../core/router.js';
import { GitHubDispatcher } from '../core/dispatch.js';
import { verifyWebhookSecret, parseIdList } from '../core/guard.js';
import { EMPTY_KEYBOARD, forceReply } from '../core/keyboard.js';
import { embedContext } from '../core/context.js';
import { unpackDate } from '../core/callback.js';
import { ACTIONS, EVENTS } from '../app/actions.js';

/**
 * 버튼 클릭을 GitHub 워크플로 트리거로 옮긴다.
 * chat_id / message_id 를 함께 넘겨야 러너가 같은 대화로 결과를 돌려보낼 수 있다.
 */
function makeDispatchPayload(ctx, packedDate, index, extra = {}) {
  return {
    date: unpackDate(packedDate),
    index: String(index),
    chat_id: String(ctx.chatId),
    ...extra,
  };
}

function buildRouter(env) {
  const github = new GitHubDispatcher({
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPO,
    userAgent: 'surf-issue-cardnews-bot',
  });

  /** 클릭한 메시지의 버튼을 지우고 진행 상태를 덧붙인다 (중복 클릭 1차 방어) */
  async function markPending(ctx, note) {
    if (!ctx.messageId) return;
    await ctx.telegram
      .editMessageReplyMarkup({
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        reply_markup: EMPTY_KEYBOARD,
      })
      .catch(() => {});
    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: note,
      reply_to_message_id: ctx.messageId,
    });
  }

  return createRouter({
    buttons: {
      /** 후보 채택 → 카드 제작 워크플로 실행 */
      async [ACTIONS.CHOOSE]([packedDate, index], ctx) {
        await markPending(ctx, '⏳ 카드뉴스 제작을 시작합니다. 완료되면 여기로 보내드릴게요.');
        await github.dispatch(EVENTS.PRODUCE, makeDispatchPayload(ctx, packedDate, index));
      },

      /** 확정 */
      async [ACTIONS.UPLOAD]([packedDate, index], ctx) {
        await markPending(ctx, '🚀 업로드 확정 처리 중…');
        await github.dispatch(
          EVENTS.FINALIZE,
          makeDispatchPayload(ctx, packedDate, index, { decision: 'uploaded' }),
        );
      },

      /** 폐기 */
      async [ACTIONS.DROP]([packedDate, index], ctx) {
        await markPending(ctx, '🗑 폐기 처리 중…');
        await github.dispatch(
          EVENTS.FINALIZE,
          makeDispatchPayload(ctx, packedDate, index, { decision: 'dropped' }),
        );
      },

      /**
       * 재생성 — 수정 요청 텍스트가 필요하므로 여기서 바로 실행하지 않고
       * 강제 답장으로 되묻는다. 실제 실행은 아래 replies 핸들러에서.
       */
      async [ACTIONS.RECREATE]([packedDate, index], ctx) {
        if (ctx.messageId) {
          await ctx.telegram
            .editMessageReplyMarkup({
              chat_id: ctx.chatId,
              message_id: ctx.messageId,
              reply_markup: EMPTY_KEYBOARD,
            })
            .catch(() => {});
        }
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: embedContext(
            '🔁 어떤 부분을 고칠까요?\n\n이 메시지에 <b>답장</b>으로 적어주세요.\n예: "헤드라인이 밋밋해요. 수치를 넣어 더 세게", "배경 사진을 더 어두운 걸로"',
            ACTIONS.RECREATE,
            [packedDate, index],
          ),
          parse_mode: 'HTML',
          reply_markup: forceReply('수정 요청을 입력하세요'),
        });
      },
    },

    replies: {
      /** 위 force_reply 에 대한 답장 — 여기서 비로소 재생성을 건다 */
      async [ACTIONS.RECREATE](text, [packedDate, index], ctx) {
        const feedback = text.trim();
        if (!feedback) {
          await ctx.telegram.sendMessage({
            chat_id: ctx.chatId,
            text: '수정 요청 내용이 비어 있어 재생성을 취소했습니다. Recreate 를 다시 눌러주세요.',
          });
          return;
        }
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: `⏳ 요청을 반영해 다시 만들고 있습니다:\n<i>${escapeHtml(feedback)}</i>`,
          parse_mode: 'HTML',
        });
        await github.dispatch(
          EVENTS.PRODUCE,
          // client_payload 는 문자열만 안전하게 왕복한다 — 길이가 길면 잘릴 수 있으므로 제한.
          makeDispatchPayload(ctx, packedDate, index, { feedback: feedback.slice(0, 900) }),
        );
      },
    },

    async onUnknown(ctx) {
      // 봇에게 그냥 말을 건 경우. 조용히 두면 고장난 줄 알기 때문에 안내만 한다.
      if (ctx.chatId && !ctx.messageId) {
        await ctx.telegram
          .sendMessage({
            chat_id: ctx.chatId,
            text: '이 봇은 매일 올라오는 후보 메시지의 버튼으로만 조작합니다.',
          })
          .catch(() => {});
      }
    },

    async onError(error, ctx) {
      // 워커에서 실패하면 러너까지 가지 못하므로, 여기서 알리지 않으면 조용히 사라진다.
      if (!ctx.chatId) return;
      await ctx.telegram
        .sendMessage({
          chat_id: ctx.chatId,
          text: `⚠️ 요청 처리 중 오류가 발생했습니다.\n<code>${escapeHtml(error.message)}</code>`,
          parse_mode: 'HTML',
        })
        .catch(() => {});
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   * @param {{waitUntil: (p: Promise<any>) => void}} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      // 헬스체크용 — 배포가 살아있는지 브라우저로 확인할 때 쓴다.
      return new Response('cardnews telegram webhook: alive', { status: 200 });
    }

    if (!verifyWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) {
      // 여기서만 non-200 을 준다. Telegram 이 보낸 게 아니므로 재전송 걱정이 없다.
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('bad request', { status: 400 });
    }

    const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
    const router = buildRouter(env);

    const result = await router(update, {
      telegram,
      policy: {
        allowedChatIds: parseIdList(env.TELEGRAM_ALLOWED_CHAT_IDS),
        allowedUserIds: parseIdList(env.TELEGRAM_ALLOWED_USER_IDS),
      },
      background: (promise) => ctx.waitUntil(promise),
    });

    // 처리 결과와 무관하게 200 — 그래야 Telegram 이 같은 업데이트를 재전송하지 않는다.
    return Response.json(result, { status: 200 });
  },
};
