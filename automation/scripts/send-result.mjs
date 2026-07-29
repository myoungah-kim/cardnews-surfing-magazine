#!/usr/bin/env node
/**
 * 완성된 카드뉴스를 검수용으로 발송한다. (제작 워크플로의 마지막 단계)
 *
 * 발송 순서: 카드 이미지 → 릴즈 영상 → 캡션 전문 → 검수 버튼.
 * 버튼은 마지막 메시지에 붙인다 — 캡션이 길어 여러 조각으로 나뉘어도
 * 버튼이 항상 대화 맨 아래에 오게 하기 위함.
 *
 * 릴즈를 여기서 함께 보내는 이유: Upload 를 누르면 이미지와 릴즈가 **둘 다**
 * 게시되는데, 영상은 한 번 올라가면 파이프라인으로 되돌릴 수 없다
 * (Recreate 는 카드를 다시 만들 뿐 게시물을 내리지 않는다). 음악·블러가
 * 어떻게 나왔는지 미리 보고 Upload 를 누를 수 있어야 한다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { reviewButtons } from '../app/actions.js';
import { singleRow } from '../core/keyboard.js';
import { packDate } from '../core/callback.js';
import { chunkText, escapeHtml } from '../core/telegram.js';
import { REPO_ROOT, chatId, requireEnv, run, telegram } from './lib/runtime.mjs';

/** `<pre>` + `</pre>` 로 감쌀 때 늘어나는 고정 길이 */
const PRE_WRAPPER_LENGTH = '<pre></pre>'.length;

/** 실제로 전송될 `<pre>${escapeHtml(chunk)}</pre>` 의 길이 — Telegram 4096자 상한 기준 */
function wrappedLength(chunk) {
  return escapeHtml(chunk).length + PRE_WRAPPER_LENGTH;
}

/** 카드 PNG 파일명이 프로젝트 이력상 card.png / card_01.png 두 가지로 존재한다 */
async function readCard(cardDir) {
  for (const name of ['card_01.png', 'card.png']) {
    try {
      return { data: await readFile(path.join(cardDir, name)), filename: name };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`카드 이미지를 찾을 수 없습니다: ${cardDir}/card_01.png`);
}

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');
  const bot = telegram();
  const chat = chatId();

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);
  const cardDir = path.join(REPO_ROOT, 'output', 'cards', candidate.slug);

  const card = await readCard(cardDir);
  const caption = await readFile(path.join(cardDir, 'caption.md'), 'utf8');

  // sendPhoto 는 Telegram 이 재압축하므로, 업로드용 원본은 document 로 보낸다.
  await bot.sendDocument(
    {
      chat_id: chat,
      caption: `🎴 <b>${escapeHtml(candidate.title)}</b>\n<code>${escapeHtml(candidate.slug)}</code> · ${candidate.attempts}회차`,
      parse_mode: 'HTML',
    },
    { data: card.data, filename: `${candidate.slug}.png`, contentType: 'image/png' },
  );

  // 릴즈 미리보기. 발송에 실패해도 검수 자체를 막지는 않는다 — 카드와 캡션만으로도
  // 판단할 수 있고, 여기서 예외를 던지면 워크플로가 실패해 후보가 producing 에 갇힌다.
  const reel = await readFile(path.join(cardDir, 'reel.mp4')).catch(() => null);
  if (reel) {
    await bot
      .sendVideo(
        {
          chat_id: chat,
          caption: '🎬 릴즈 미리보기 — Upload 를 누르면 이 영상도 함께 게시됩니다',
          width: 1080,
          height: 1920,
          duration: 15,
        },
        { data: reel, filename: `${candidate.slug}.mp4` },
      )
      .catch(async (error) => {
        console.error(`릴즈 미리보기 발송 실패: ${error.message}`);
        await bot
          .sendMessage({
            chat_id: chat,
            text: '⚠️ 릴즈 미리보기를 보내지 못했습니다. 영상 파일은 저장소에 있으며 Upload 시 게시는 정상 진행됩니다.',
          })
          .catch(() => {});
      });
  } else {
    await bot
      .sendMessage({
        chat_id: chat,
        text: '⚠️ 릴즈 영상이 없어 미리보기를 건너뜁니다. Upload 를 누르면 이미지 포스트만 게시됩니다.',
      })
      .catch(() => {});
  }

  // Telegram 하드 상한은 4096자 — 그 아래로 여유를 두고, escapeHtml + <pre>
  // 래핑까지 끝난 "실제 전송될" 길이 기준으로 자른다.
  const parts = chunkText(caption.trim(), { limit: 4000, measure: wrappedLength });
  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1;
    await bot.sendMessage({
      chat_id: chat,
      text: `<pre>${escapeHtml(parts[i])}</pre>`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      // 마지막 조각에만 버튼을 단다.
      reply_markup: isLast ? singleRow(reviewButtons(packDate(date), candidate.index)) : undefined,
    });
  }

  candidate.status = 'review';
  await writeCandidates(REPO_ROOT, data);

  console.log(`✔ 검수 요청 발송 완료 — ${candidate.slug}`);
});
