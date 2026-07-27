#!/usr/bin/env node
/**
 * 그날의 후보 5개를 Telegram 으로 발송한다. (일일 크롤링 워크플로의 마지막 단계)
 *
 * 후보마다 메시지를 따로 보내는 이유: 버튼은 메시지에 붙기 때문에,
 * 한 메시지에 5개를 몰아넣으면 어떤 기사에 대한 Choose 인지 화면에서 헷갈린다.
 *
 *   node scripts/send-candidates.mjs [YYYY-MM-DD]
 */

import { readCandidates } from '../app/candidates.js';
import { candidateButtons } from '../app/actions.js';
import { singleRow } from '../core/keyboard.js';
import { packDate } from '../core/callback.js';
import { escapeHtml } from '../core/telegram.js';
import { REPO_ROOT, chatId, run, telegram, today } from './lib/runtime.mjs';

/** @param {import('../app/candidates.js').Candidate} candidate */
function renderCandidate(candidate) {
  const lines = [
    `<b>${candidate.index}. ${escapeHtml(candidate.title)}</b>`,
    '',
    `🗂 ${escapeHtml(candidate.topic)}  ·  🎯 ${escapeHtml(candidate.metric)}`,
    `🪝 ${escapeHtml(candidate.headlineType)}`,
    `📰 ${escapeHtml(candidate.feed)}  ·  ${escapeHtml(candidate.published)}`,
    '',
    escapeHtml(candidate.reason),
    '',
    `<a href="${escapeHtml(candidate.url)}">원문 보기</a>`,
  ];
  return lines.join('\n');
}

run(async () => {
  const date = process.argv[2] ?? today();
  const bot = telegram();
  const chat = chatId();

  const data = await readCandidates(REPO_ROOT, date);
  const packed = packDate(date);
  const pending = data.candidates.filter((item) => item.status === 'pending');

  if (pending.length === 0) {
    await bot.sendMessage({
      chat_id: chat,
      text: `📭 ${date} — 오늘은 조건을 통과한 후보가 없습니다.`,
    });
    return;
  }

  await bot.sendMessage({
    chat_id: chat,
    text: `🏄 <b>${date} 카드뉴스 후보 ${pending.length}건</b>\n제작할 기사의 Choose 를 눌러주세요.`,
    parse_mode: 'HTML',
  });

  for (const candidate of pending) {
    await bot.sendMessage({
      chat_id: chat,
      text: renderCandidate(candidate),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: singleRow(candidateButtons(packed, candidate.index)),
    });
  }

  console.log(`✔ ${date} 후보 ${pending.length}건 발송 완료`);
});
