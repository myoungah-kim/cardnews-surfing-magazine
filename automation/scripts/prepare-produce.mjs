#!/usr/bin/env node
/**
 * 카드 제작 워크플로의 첫 단계 — 정책 검사 + 제작 지시서 준비.
 *
 * 워커는 무상태라 "이 요청을 받아줘도 되는지" 판단할 수 없다.
 * 후보 파일이 있는 이 러너에서 비로소 판단한다.
 *
 * 거부되면 워크플로를 실패시키지 않고 `allowed=false` 를 출력한다 —
 * 정상적인 거절(중복 클릭 등)까지 빨간 X 로 남으면 진짜 장애를 놓치게 된다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_FEEDBACK(선택)
 */

import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canProduce, canRecreate } from '../app/policy.js';
import { REPO_ROOT, chatId, requireEnv, run, setOutputs, telegram, today } from './lib/runtime.mjs';

/** 기사 제목에서 output/cards/<slug> 폴더명을 만든다 */
function makeSlug(date, title) {
  const compact = date.replaceAll('-', '');
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
  // 영문 단어가 하나도 안 나오는 제목(전부 한글 등)은 순번으로 대체한다.
  return `${compact}_${words || 'article'}`;
}

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');
  const feedback = process.env.EVENT_FEEDBACK?.trim() ?? '';

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);

  const producedToday = data.candidates.filter((item) =>
    ['producing', 'review', 'uploaded'].includes(item.status),
  ).length;

  // 재생성은 검수 상태에서 출발하므로 나이·중복 검사가 아닌 별도 정책을 탄다.
  const verdict = feedback
    ? canRecreate({ candidate })
    : canProduce({ candidate, today: today(), producedToday });

  if (!verdict.allow) {
    await telegram().sendMessage({
      chat_id: chatId(),
      text: `⛔ 제작을 시작하지 않았습니다.\n${verdict.reason}`,
    });
    await setOutputs({ allowed: 'false' });
    console.log(`거부됨: ${verdict.reason}`);
    return;
  }

  // 막지는 않지만 알려둘 것이 있는 경우 (예: 재생성 횟수가 쌓였을 때)
  if (verdict.warn) {
    await telegram().sendMessage({ chat_id: chatId(), text: `ℹ️ ${verdict.warn}` });
    console.log(`경고: ${verdict.warn}`);
  }

  candidate.status = 'producing';
  candidate.attempts = (candidate.attempts ?? 0) + 1;
  candidate.slug ??= makeSlug(date, candidate.title);
  if (feedback) {
    candidate.feedback = [...(candidate.feedback ?? []), feedback];
  }
  await writeCandidates(REPO_ROOT, data);

  await setOutputs({
    allowed: 'true',
    slug: candidate.slug,
    url: candidate.url,
    title: candidate.title,
    attempts: String(candidate.attempts),
    feedback,
  });

  console.log(`✔ 제작 준비 완료 — ${candidate.slug} (시도 ${candidate.attempts}회차)`);
});
