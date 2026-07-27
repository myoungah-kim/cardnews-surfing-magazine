/**
 * 후보 상태 파일 읽기/쓰기.
 *
 * `output/candidates/YYYY-MM-DD.json` 이 이 파이프라인의 **단일 상태 저장소**다.
 * 버튼 클릭 → 제작 → 검수 → 확정까지 모든 단계가 이 파일의 한 항목을 갱신한다.
 * git 에 커밋되므로 이력이 그대로 남고, 별도 DB 나 KV 가 필요 없다.
 *
 * 마크다운(`YYYY-MM-DD.md`)은 사람이 읽는 용도로 따로 유지한다 —
 * 서식이 조금 달라져도 자동화가 깨지지 않도록 기계용 계약을 분리한 것.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} Candidate
 * @property {number} index 1부터 시작하는 순번 (callback_data 에 실린다)
 * @property {string} title 기사 제목
 * @property {string} url 원문 URL
 * @property {string} feed 출처 피드 (surfer.com 등)
 * @property {string} published 발행일 YYYY-MM-DD
 * @property {string} topic 소재군
 * @property {string} headlineType 헤드라인 유형
 * @property {string} metric 목표 지표
 * @property {string} reason 선정 이유
 * @property {'pending'|'producing'|'review'|'uploaded'|'dropped'} status
 * @property {string} [slug] 제작 후 output/cards/<slug>
 * @property {number} [attempts] 제작 시도 횟수 (Recreate 포함)
 * @property {string[]} [feedback] Recreate 로 받은 수정 요청 이력
 */

/**
 * @typedef {object} CandidateFile
 * @property {string} date YYYY-MM-DD
 * @property {string} generatedAt ISO8601
 * @property {Candidate[]} candidates
 */

/** @param {string} repoRoot @param {string} date */
export function candidatesPath(repoRoot, date) {
  return path.join(repoRoot, 'output', 'candidates', `${date}.json`);
}

/**
 * @param {string} repoRoot
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<CandidateFile>}
 */
export async function readCandidates(repoRoot, date) {
  const file = candidatesPath(repoRoot, date);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw new Error(`후보 파일이 없습니다: ${file} — 해당 날짜의 크롤링이 돌지 않았을 수 있습니다`);
    }
    throw cause;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.candidates)) {
    throw new Error(`후보 파일 형식이 올바르지 않습니다: ${file}`);
  }
  return parsed;
}

/**
 * @param {string} repoRoot
 * @param {CandidateFile} data
 */
export async function writeCandidates(repoRoot, data) {
  const file = candidatesPath(repoRoot, data.date);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * 후보 하나를 찾는다.
 * @param {CandidateFile} data
 * @param {number|string} index
 * @returns {Candidate}
 */
export function findCandidate(data, index) {
  const wanted = Number(index);
  const found = data.candidates.find((item) => item.index === wanted);
  if (!found) {
    throw new Error(
      `${data.date} 후보 중 ${wanted}번을 찾을 수 없습니다 (있는 순번: ${data.candidates.map((c) => c.index).join(', ')})`,
    );
  }
  return found;
}

/**
 * 후보 하나의 상태를 갱신하고 파일에 기록한다.
 *
 * @param {string} repoRoot
 * @param {string} date
 * @param {number|string} index
 * @param {(candidate: Candidate) => void} mutate 후보를 제자리에서 수정하는 함수
 * @returns {Promise<Candidate>}
 */
export async function updateCandidate(repoRoot, date, index, mutate) {
  const data = await readCandidates(repoRoot, date);
  const candidate = findCandidate(data, index);
  mutate(candidate);
  await writeCandidates(repoRoot, data);
  return candidate;
}
