#!/usr/bin/env node
/**
 * Telegram 웹훅 등록 / 조회 / 해제 — 최초 1회 실행하는 설정 스크립트.
 *
 *   node scripts/set-webhook.mjs            # 등록
 *   node scripts/set-webhook.mjs --info     # 현재 상태 확인
 *   node scripts/set-webhook.mjs --delete   # 해제
 *
 * 필요한 환경변수:
 *   TELEGRAM_BOT_TOKEN      @BotFather 토큰
 *   TELEGRAM_WEBHOOK_URL    배포된 Worker URL (예: https://xxx.workers.dev)
 *   TELEGRAM_WEBHOOK_SECRET Worker 에 등록한 것과 동일한 시크릿
 */

import { TelegramClient } from '../core/telegram.js';
import { requireEnv, run } from './lib/runtime.mjs';

run(async () => {
  const bot = new TelegramClient(requireEnv('TELEGRAM_BOT_TOKEN'));
  const mode = process.argv[2];

  if (mode === '--info') {
    const info = await bot.call('getWebhookInfo');
    console.log(JSON.stringify(info, null, 2));
    // 웹훅이 실패하고 있으면 여기 last_error_message 에 이유가 남는다 — 첫 디버깅 지점.
    if (info.last_error_message) {
      console.log(`\n⚠️ 최근 오류: ${info.last_error_message}`);
    }
    return;
  }

  if (mode === '--delete') {
    await bot.call('deleteWebhook', { drop_pending_updates: true });
    console.log('✔ 웹훅을 해제했습니다.');
    return;
  }

  const url = new URL('/', requireEnv('TELEGRAM_WEBHOOK_URL')).toString();
  await bot.call('setWebhook', {
    url,
    secret_token: requireEnv('TELEGRAM_WEBHOOK_SECRET'),
    // 버튼 클릭과 (재생성 답장용) 메시지만 받는다. 나머지는 받지 않아 트래픽을 줄인다.
    allowed_updates: ['message', 'callback_query'],
    // 등록 전에 쌓여 있던 오래된 업데이트를 흘려보낸다.
    drop_pending_updates: true,
  });

  const me = await bot.call('getMe');
  console.log(`✔ 웹훅 등록 완료\n  봇: @${me.username}\n  URL: ${url}`);
});
