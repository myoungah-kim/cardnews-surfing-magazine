#!/usr/bin/env node
/**
 * 제작이 실패했을 때 후보 상태를 되돌린다.
 *
 * 이게 없으면 후보가 'producing' 에 갇혀서, 정책 검사가 "이미 제작 중"
 * 이라며 이후 모든 재시도를 거부한다 — 한 번 실패하면 영원히 못 만드는 상태.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX
 */

import { readCandidates, findCandidate, writeCandidates } from '../app/candidates.js';
import { REPO_ROOT, requireEnv, run } from './lib/runtime.mjs';

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);

  if (candidate.status !== 'producing') {
    console.log(`상태가 '${candidate.status}' 이므로 되돌리지 않습니다.`);
    return;
  }

  // 이전에 성공한 결과물이 있으면 검수 대기로, 없으면 후보로 되돌린다.
  candidate.status = candidate.attempts > 1 ? 'review' : 'pending';
  await writeCandidates(REPO_ROOT, data);
  console.log(`✔ 상태를 '${candidate.status}' 로 되돌렸습니다.`);
});
