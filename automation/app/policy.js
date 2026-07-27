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
 * ⚠️ TODO — 여기를 채워주세요.
 *
 * Choose 버튼을 눌렀을 때 카드 제작을 시작할지 판단합니다.
 *
 * 고려할 점 (트레이드오프):
 *
 *  1. **후보의 나이** — `daysBetween(candidate.pubDate, today)` 로 계산됩니다.
 *     서핑 뉴스는 속보성이 강해 며칠 지나면 후킹이 죽습니다. 다만
 *     `ARTICLE_CANDIDATE_FILTER.md` 3-2 는 "제작까지 안 간 후보는 다음 날
 *     다시 후보에 오를 수 있다"고 했으니, 너무 짧게 막으면 그 규칙과 충돌합니다.
 *     막을 것인가, 경고만 하고 진행할 것인가?
 *
 *  2. **하루 제작 개수** — `producedToday` 로 그날 이미 만든 개수가 넘어옵니다.
 *     프로세스상 하루 2개를 고르실 계획이었죠. 3개째를 눌렀을 때
 *     막을 것인가, 아니면 그날 기분에 맡길 것인가?
 *
 *  3. **중복 클릭** — `candidate.status` 가 이미 'producing'/'review' 면
 *     같은 카드가 두 번 만들어집니다. (버튼은 클릭 후 제거되지만, 다른 기기에
 *     열려 있던 화면에서는 여전히 눌릴 수 있습니다.)
 *
 * @param {object} input
 * @param {import('./candidates.js').Candidate} input.candidate
 * @param {string} input.today YYYY-MM-DD
 * @param {number} input.producedToday 오늘 이미 제작에 들어간 후보 수
 * @returns {{allow: boolean, reason?: string}} 거부 시 reason 이 사용자에게 그대로 전송됩니다
 */
export function canProduce({ candidate, today, producedToday }) {
  // TODO: 위 3가지를 어떻게 다룰지 정해서 구현해주세요.
  //
  // 아래는 동작을 막지 않기 위한 임시 기본값입니다 — 중복 클릭만 막고
  // 나머지는 전부 통과시킵니다. 원하는 정책으로 교체하세요.
  if (TERMINAL.has(candidate.status)) {
    return { allow: false, reason: `이미 처리된 후보입니다 (상태: ${candidate.status})` };
  }
  if (candidate.status === 'producing') {
    return { allow: false, reason: '이미 제작이 진행 중입니다' };
  }
  return { allow: true };
}

/**
 * ⚠️ TODO — 여기도 채워주세요.
 *
 * Recreate 를 몇 번까지 허용할지 판단합니다.
 *
 * `candidate.attempts` 에 지금까지 제작한 횟수가 들어 있습니다(최초 제작 포함).
 * 무제한으로 두면 마음에 들 때까지 돌릴 수 있지만, 한 번에 Claude 실행 +
 * 스톡 이미지 검색 API 호출 + Actions 실행 시간이 소모됩니다.
 * 상한에 도달했을 때 아예 막을지, 아니면 경고만 하고 계속 허용할지도 선택지입니다.
 *
 * @param {object} input
 * @param {import('./candidates.js').Candidate} input.candidate
 * @returns {{allow: boolean, reason?: string}}
 */
export function canRecreate({ candidate }) {
  // TODO: 재생성 상한 정책을 정해주세요.
  //
  // 임시 기본값 — 상태만 확인하고 횟수는 제한하지 않습니다.
  if (TERMINAL.has(candidate.status)) {
    return { allow: false, reason: `이미 처리된 후보입니다 (상태: ${candidate.status})` };
  }
  if (!REVIEWABLE.has(candidate.status)) {
    return { allow: false, reason: '아직 검수할 카드가 없습니다' };
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
