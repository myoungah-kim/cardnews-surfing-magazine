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

  /** Recreate 흐름의 force_reply 질문 — 최초 클릭과 "재입력 유도" 양쪽에서 재사용 */
  async function askForRecreateFeedback(ctx, packedDate, index) {
    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: embedContext(
        '🔁 어떤 부분을 고칠까요?\n\n이 메시지에 <b>답장</b>으로 적어주세요. 사진을 첨부하면 그 사진을 참고해서 다시 만듭니다.\n예: "헤드라인이 밋밋해요. 수치를 넣어 더 세게", "이 사진으로 배경을 바꿔줘" (사진 첨부)',
        ACTIONS.RECREATE,
        [packedDate, index],
      ),
      parse_mode: 'HTML',
      reply_markup: forceReply('수정 요청을 입력하세요 (사진 첨부 가능)'),
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
        await askForRecreateFeedback(ctx, packedDate, index);
      },
    },

    replies: {
      /** 위 force_reply 에 대한 답장 — 여기서 비로소 재생성을 건다 */
      async [ACTIONS.RECREATE]({ text, photo }, [packedDate, index], ctx) {
        const feedback = text.trim();
        if (!feedback && !photo) {
          // 버튼은 이미 사라진 상태이므로 "다시 눌러주세요"는 막다른 길이다.
          // 같은 태그를 심어 다시 물어보면, 사용자는 이 메시지에 답장만 하면 된다.
          await ctx.telegram.sendMessage({
            chat_id: ctx.chatId,
            text: '수정 요청 내용이 비어 있습니다. 아래 메시지에 다시 답장으로 적어주세요.',
          });
          await askForRecreateFeedback(ctx, packedDate, index);
          return;
        }

        const summary = feedback || '(사진만 참고)';
        await ctx.telegram.sendMessage({
          chat_id: ctx.chatId,
          text: `⏳ 요청을 반영해 다시 만들고 있습니다:\n<i>${escapeHtml(summary)}</i>${
            photo ? '\n📷 첨부한 사진을 참고합니다.' : ''
          }`,
          parse_mode: 'HTML',
        });
        await github.dispatch(
          EVENTS.PRODUCE,
          // client_payload 는 문자열만 안전하게 왕복한다 — 길이가 길면 잘릴 수 있으므로 제한.
          makeDispatchPayload(ctx, packedDate, index, {
            feedback: feedback.slice(0, 900),
            photoFileId: photo?.file_id ?? '',
            // 이 답장 자체의 message_id — 같은 웹훅 업데이트가 재전송되거나
            // (Telegram 은 non-200 응답에 재시도한다) 실수로 같은 메시지가
            // 두 번 처리되는 것을, 러너 쪽에서 이 값으로 걸러낼 수 있게 한다.
            replyMessageId: String(ctx.update.message.message_id),
          }),
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

    /**
     * 답장을 보낸 뒤 오타를 고치려고 "메시지 수정"을 쓰는 경우 — Telegram 은
     * 원본 메시지를 이미 처리한 뒤이므로, 수정본을 다시 처리하면 두 번 실행될
     * 위험이 있어 재처리하지 않는다. 대신 조용히 무시하지 않고 새로 답장하라고
     * 알려준다 (완전한 무응답은 "봇이 죽었다"는 오해를 부른다).
     */
    async onEditedMessage(ctx) {
      if (!ctx.chatId) return;
      await ctx.telegram
        .sendMessage({
          chat_id: ctx.chatId,
          text: '메시지를 수정해도 반영되지 않습니다. 수정한 내용으로 새 메시지를 다시 답장해주세요.',
        })
        .catch(() => {});
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
