#!/usr/bin/env node
/**
 * 워크플로 실패 알림. `if: failure()` 스텝에서 호출한다.
 *
 * 실패를 Telegram 으로 알리지 않으면, 버튼을 누른 뒤 아무 응답이 없는
 * 상태가 되어 "봇이 죽었나?" 하고 다시 누르게 된다.
 *
 *   node scripts/notify.mjs "메시지"
 *
 * 환경변수 RUN_URL 이 있으면 로그 링크를 함께 보낸다.
 */

import { escapeHtml } from '../core/telegram.js';
import { chatId, run, telegram } from './lib/runtime.mjs';

run(async () => {
  const message = process.argv.slice(2).join(' ') || '워크플로가 실패했습니다.';
  const runUrl = process.env.RUN_URL;

  const text = [
    `⚠️ ${escapeHtml(message)}`,
    runUrl ? `\n<a href="${escapeHtml(runUrl)}">실행 로그 보기</a>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await telegram().sendMessage({
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});
