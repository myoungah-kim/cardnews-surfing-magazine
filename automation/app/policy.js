/**
 * 운영 정책 — "이 요청을 받아줄 것인가"를 판단하는 곳.
 *
 * 이 파일만 고치면 파이프라인의 운영 성격이 바뀐다.
 * 실행 로직(워크플로·스크립트)은 여기 판단 결과를 따르기만 한다.
 *
 * 왜 정책을 따로 분리했는가:
 * 버튼은 Telegram 대화 이력에 영원히 남는다. 3일 전 후보 메시지를 스크롤해서
 * Choose 를 누르는 일이 실제로 일어나고, Recreate 는 누를 때마다 Claude 실행
 * 비용과 API 사용량을 소모한다. 실행기가 아무 요청이나 받아주면
 * "지난주 뉴스로 카드가 만들어지거나" "Recreate 무한 루프"가 생긴다.
 */

/** 카드 제작이 끝나 검수 대기 중인 상태들 */
const REVIEWABLE = new Set(['review']);

/** 이미 최종 처리가 끝나 더 손댈 수 없는 상태들 */
const TERMINAL = new Set(['uploaded', 'dropped']);

/**
 * 두 날짜(YYYY-MM-DD) 사이의 일수 차이.
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * 후보를 제작 대상으로 받아주는 최대 나이(일).
 *
 * `ARTICLE_CANDIDATE_FILTER.md` 3-1 이 "최초 실행 시 최근 7일" 을 수집 범위로
 * 잡고 있어 같은 값으로 맞췄다. 수집 범위와 제작 허용 범위가 어긋나면
 * "후보로는 올라오는데 누르면 거부되는" 구간이 생긴다.
 */
export const MAX_CANDIDATE_AGE_DAYS = 7;

/** 이 횟수부터 재생성 시 경고를 띄운다 (막지는 않는다) */
export const RECREATE_WARN_AFTER = 3;

/**
 * Choose 버튼을 눌렀을 때 카드 제작을 시작할지 판단한다.
 *
 * 정책:
 *  - 발행 7일 이내 기사만 받는다. 버튼은 대화 이력에 영원히 남아서
 *    한참 전 후보를 스크롤해 누르는 일이 실제로 생기는데, 서핑 뉴스는
 *    그쯤이면 후킹이 죽는다.
 *  - **하루 제작 개수는 제한하지 않는다.** 그날 몇 개를 만들지는 운영자 재량.
 *  - 중복 클릭만 막는다 (다른 기기에 열려 있던 화면에서 또 누를 수 있다).
 *
 * @param {object} input
 * @param {import('./candidates.js').Candidate} input.candidate
 * @param {string} input.today YYYY-MM-DD
 * @param {number} input.producedToday 오늘 이미 제작에 들어간 후보 수 (현재 미사용 — 제한 없음)
 * @returns {{allow: boolean, reason?: string, warn?: string}} 거부 시 reason 이 사용자에게 그대로 전송된다
 */
export function canProduce({ candidate, today }) {
  if (TERMINAL.has(candidate.status)) {
    return { allow: false, reason: `이미 처리된 후보입니다 (상태: ${candidate.status})` };
  }
  if (candidate.status === 'producing') {
    return { allow: false, reason: '이미 제작이 진행 중입니다' };
  }

  // published 가 비어 있거나 깨진 후보를 나이 때문에 막아버리면
  // 원인을 알기 어려운 거부가 된다 — 나이 검사만 건너뛰고 통과시킨다.
  const age = candidate.published ? daysBetween(candidate.published, today) : null;
  if (age !== null && Number.isFinite(age) && age > MAX_CANDIDATE_AGE_DAYS) {
    return {
      allow: false,
      reason:
        `발행한 지 ${age}일 된 기사라 제작하지 않았습니다 ` +
        `(상한 ${MAX_CANDIDATE_AGE_DAYS}일). 지금도 쓸 만하다면 워크플로를 수동 실행하세요.`,
    };
  }

  return { allow: true };
}

/**
 * Recreate 를 허용할지 판단한다.
 *
 * 정책: **횟수로 막지 않는다.** 마음에 들 때까지 돌릴 수 있어야 한다는
 * 판단. 다만 한 번에 Claude 실행 + 스톡 API 호출 + Actions 시간이 소모되므로
 * 일정 횟수부터는 경고를 함께 보낸다.
 *
 * @param {object} input
 * @param {import('./candidates.js').Candidate} input.candidate
 * @returns {{allow: boolean, reason?: string, warn?: string}}
 */
export function canRecreate({ candidate }) {
  if (TERMINAL.has(candidate.status)) {
    return { allow: false, reason: `이미 처리된 후보입니다 (상태: ${candidate.status})` };
  }
  if (!REVIEWABLE.has(candidate.status)) {
    return { allow: false, reason: '아직 검수할 카드가 없습니다' };
  }

  const attempts = candidate.attempts ?? 0;
  if (attempts >= RECREATE_WARN_AFTER) {
    return {
      allow: true,
      warn:
        `이번이 ${attempts + 1}회차 제작입니다. ` +
        '반복해도 잘 안 나온다면 기사 자체가 카드 한 장으로 안 잘리는 소재일 수 있습니다.',
    };
  }
  return { allow: true };
}

/**
 * Upload / Drop 은 검수 대기 상태에서만 의미가 있다.
 * 이건 취향이 아니라 상태 기계의 제약이므로 기본 구현을 그대로 둔다.
 *
 * @param {object} input
 * @param {import('./candidates.js').Candidate} input.candidate
 * @param {'uploaded'|'dropped'} input.target
 */
export function canFinalize({ candidate, target }) {
  if (candidate.status === target) {
    return { allow: false, reason: '이미 같은 처리가 완료되었습니다' };
  }
  if (TERMINAL.has(candidate.status)) {
    return { allow: false, reason: `이미 처리된 후보입니다 (상태: ${candidate.status})` };
  }
  // Drop 은 제작 전 후보에도 쓸 수 있게 열어둔다 (오늘은 이거 안 만들래).
  if (target === 'uploaded' && !REVIEWABLE.has(candidate.status)) {
    return { allow: false, reason: '아직 확정할 카드가 없습니다' };
  }
  return { allow: true };
}
