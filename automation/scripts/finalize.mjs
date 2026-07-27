#!/usr/bin/env node
/**
 * Upload(확정) / Drop(폐기) 처리.
 *
 * Upload 는 이 단계에서 **인스타그램에 실제로 올리지 않는다.**
 * IG 자동 게시는 비즈니스 계정 + Graph API 심사가 필요해 별도 작업이며,
 * 지금은 "확정됨" 상태를 기록하고 처리 로그를 남기는 데까지가 범위다.
 * 나중에 붙일 자리는 아래 TODO 주석에 표시해 두었다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_DECISION(uploaded|dropped)
 */

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canFinalize } from '../app/policy.js';
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

  candidate.status = decision;
  await writeCandidates(REPO_ROOT, data);

  if (decision === 'uploaded') {
    await appendProcessedLog(date, candidate);
    // TODO: 인스타그램 자동 게시를 붙인다면 여기 (Graph API 미디어 컨테이너 생성 → 게시).
    await bot.sendMessage({
      chat_id: chat,
      text: `🚀 확정 완료 — <code>${candidate.slug}</code>\n처리 로그에 기록했습니다. 이제 인스타그램에 올리시면 됩니다.`,
      parse_mode: 'HTML',
    });
  } else {
    await bot.sendMessage({
      chat_id: chat,
      text: `🗑 폐기했습니다 — <code>${candidate.slug ?? candidate.title}</code>\n처리 로그에 남기지 않으므로 나중에 다시 후보로 올라올 수 있습니다.`,
      parse_mode: 'HTML',
    });
  }

  await setOutputs({ changed: 'true' });
  console.log(`✔ ${decision} 처리 완료`);
});
