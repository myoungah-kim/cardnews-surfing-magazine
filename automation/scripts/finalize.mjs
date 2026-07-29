#!/usr/bin/env node
/**
 * Upload(확정) / Drop(폐기) 처리.
 *
 * Upload 는 인스타그램 게시까지 이 스크립트 안에서 끝낸다. 게시(Graph API 호출)를
 * 먼저 시도하고, 성공했을 때만 후보 상태·처리 로그를 갱신한다 — 게시가 실패했는데
 * "업로드됨"으로 기록되는 일을 막기 위한 순서다 (실패하면 예외가 run() 까지 전파되어
 * 이 스크립트가 아무것도 쓰지 않은 채 종료되고, 워크플로의 커밋 스텝도 건너뛴다).
 *
 * 반대 방향도 있다: 게시(Graph API 호출)는 성공했는데 그 *뒤* 의 상태 기록이
 * 실패하는 경우 — 이땐 "실패했다"는 알림만 보고 Upload 를 다시 누르면 이미
 * 올라간 글이 인스타그램에 중복 게시된다. 그래서 게시 성공 직후, 기록을
 * 시도하기 *전에* 먼저 "게시 완료"를 알리고, 기록이 실패하면 별도로
 * "다시 누르지 말라"고 명시한다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_DECISION(uploaded|dropped),
 *          IG_ACCESS_TOKEN, IG_USER_ID (decision=uploaded 일 때만 필요)
 */

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canFinalize } from '../app/policy.js';
import { InstagramClient } from '../core/instagram.js';
import { escapeHtml } from '../core/telegram.js';
import { REPO_ROOT, chatId, requireEnv, run, setOutputs, telegram } from './lib/runtime.mjs';

const LOG_PATH = path.join(REPO_ROOT, 'output', 'cards', '_processed_articles.csv');

/**
 * ARTICLE_CANDIDATE_FILTER.md 2번 섹션의 처리 로그에 한 줄 추가한다.
 * 이 로그가 있어야 다음 날 크롤링이 같은 기사를 다시 후보로 올리지 않는다.
 */
async function appendProcessedLog(date, candidate) {
  const existing = await readFile(LOG_PATH, 'utf8').catch(() => '');
  if (existing.includes(candidate.url)) return false;
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const row = [date, candidate.feed, candidate.url, candidate.slug, 'produced'].join(',');
  await appendFile(LOG_PATH, `${needsNewline ? '\n' : ''}${row}\n`, 'utf8');
  return true;
}

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');
  const decision = requireEnv('EVENT_DECISION');

  if (!['uploaded', 'dropped'].includes(decision)) {
    throw new Error(`알 수 없는 결정: ${decision}`);
  }

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);
  const bot = telegram();
  const chat = chatId();

  const verdict = canFinalize({ candidate, target: decision });
  if (!verdict.allow) {
    await bot.sendMessage({ chat_id: chat, text: `⛔ ${verdict.reason}` });
    await setOutputs({ changed: 'false' });
    return;
  }

  if (decision === 'uploaded') {
    // GITHUB_REF_NAME(브랜치명) 대신 커밋 SHA 를 쓴다 — raw.githubusercontent.com 은
    // 브랜치명 URL을 수 분간 CDN 캐시하므로, 방금 Recreate 한 새 카드를 바로
    // Upload 하면 캐시된 이전 버전이 게시될 수 있다. 커밋 SHA 로 주소를 고정하면
    // 그 내용이 절대 바뀌지 않으므로 캐시가 있어도 항상 정확한 버전이 나온다.
    const imageUrl = `https://raw.githubusercontent.com/${requireEnv('GITHUB_REPOSITORY')}/${requireEnv('GITHUB_SHA')}/output/cards/${candidate.slug}/card_01.png`;
    const captionPath = path.join(REPO_ROOT, 'output', 'cards', candidate.slug, 'caption.md');
    const caption = (await readFile(captionPath, 'utf8')).trim();

    const ig = new InstagramClient(requireEnv('IG_ACCESS_TOKEN'), requireEnv('IG_USER_ID'));
    const { permalink } = await ig.postImage({ imageUrl, caption });

    // 게시는 이미 끝났다 — 이 아래에서 상태 기록이 실패하더라도 사용자에게
    // "성공"을 먼저 알려야, 뒤이은 실패 알림을 보고 Upload 를 다시 눌러
    // 인스타그램에 같은 글이 중복 게시되는 일을 막을 수 있다.
    await bot.sendMessage({
      chat_id: chat,
      text: `🚀 인스타그램 게시 완료 — <code>${escapeHtml(candidate.slug)}</code>\n${permalink}`,
      parse_mode: 'HTML',
    });

    try {
      candidate.status = decision;
      await writeCandidates(REPO_ROOT, data);
      await appendProcessedLog(date, candidate);
    } catch (recordError) {
      await bot.sendMessage({
        chat_id: chat,
        text:
          `⚠️ 게시는 성공했지만 상태 기록에 실패했습니다.\n` +
          `<b>Upload 를 다시 누르지 마세요</b> — 이미 게시된 글이 중복으로 올라갑니다. ` +
          `output/candidates 파일을 직접 확인해 상태를 review 로 되돌리거나 수동으로 uploaded 로 맞춰주세요.\n` +
          `<code>${escapeHtml(recordError.message)}</code>`,
        parse_mode: 'HTML',
      });
      throw recordError;
    }
  } else {
    candidate.status = decision;
    await writeCandidates(REPO_ROOT, data);

    await bot.sendMessage({
      chat_id: chat,
      text: `🗑 폐기했습니다 — <code>${candidate.slug ?? candidate.title}</code>\n처리 로그에 남기지 않으므로 나중에 다시 후보로 올라올 수 있습니다.`,
      parse_mode: 'HTML',
    });
  }

  await setOutputs({ changed: 'true' });
  console.log(`✔ ${decision} 처리 완료`);
});
