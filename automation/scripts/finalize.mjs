#!/usr/bin/env node
/**
 * Upload(확정) / Drop(폐기) 처리.
 *
 * Upload 는 인스타그램 게시까지 이 스크립트 안에서 끝낸다. 게시(Graph API 호출)를
 * 먼저 시도하고, 성공했을 때만 후보 상태·처리 로그를 갱신한다 — 게시가 실패했는데
 * "업로드됨"으로 기록되는 일을 막기 위한 순서다 (실패하면 예외가 run() 까지 전파되어
 * 이 스크립트가 아무것도 쓰지 않은 채 종료되고, 워크플로의 커밋 스텝도 건너뛴다).
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_DECISION(uploaded|dropped),
 *          IG_ACCESS_TOKEN, IG_USER_ID (decision=uploaded 일 때만 필요)
 */

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canFinalize } from '../app/policy.js';
import { InstagramClient } from '../core/instagram.js';
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
    const imageUrl = `https://raw.githubusercontent.com/${requireEnv('GITHUB_REPOSITORY')}/${requireEnv('GITHUB_REF_NAME')}/output/cards/${candidate.slug}/card_01.png`;
    const captionPath = path.join(REPO_ROOT, 'output', 'cards', candidate.slug, 'caption.md');
    const caption = (await readFile(captionPath, 'utf8')).trim();

    const ig = new InstagramClient(requireEnv('IG_ACCESS_TOKEN'), requireEnv('IG_USER_ID'));
    const { permalink } = await ig.postImage({ imageUrl, caption });

    candidate.status = decision;
    await writeCandidates(REPO_ROOT, data);
    await appendProcessedLog(date, candidate);

    await bot.sendMessage({
      chat_id: chat,
      text: `🚀 인스타그램 게시 완료 — <code>${candidate.slug}</code>\n${permalink}`,
      parse_mode: 'HTML',
    });
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
