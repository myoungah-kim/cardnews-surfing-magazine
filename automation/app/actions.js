/**
 * 이 프로젝트의 버튼 액션 정의 — 재사용 코어와 카드뉴스 워크플로를 잇는 지점.
 *
 * 다른 프로젝트에 이 봇을 이식할 때 **바꿔야 하는 파일은 app/ 아래뿐**이고,
 * core/ 는 손대지 않는다.
 *
 * ── 식별자 설계 ──────────────────────────────────────────────
 * callback_data 는 64바이트뿐이라 기사 URL 이나 slug 를 넣을 수 없다.
 * 대신 후보를 `(날짜, 순번)` 으로 가리키고, 실제 정보는 실행기가
 * `output/candidates/YYYY-MM-DD.json` 에서 조회한다.
 * 이 파일이 곧 상태 저장소이며 git 에 커밋되어 영속된다 — 별도 DB 가 없는 이유.
 */

/** 버튼 액션 이름 (짧게 유지 — callback_data 예산 절약) */
export const ACTIONS = {
  /** 후보 채택 → 카드뉴스 제작 시작 */
  CHOOSE: 'ch',
  /** 완성본 확정 */
  UPLOAD: 'up',
  /** 수정 요청 (자유 텍스트 입력이 뒤따름) */
  RECREATE: 'rc',
  /** 폐기 */
  DROP: 'dr',
};

/** GitHub Actions 워크플로를 깨우는 이벤트 이름 */
export const EVENTS = {
  PRODUCE: 'produce-card',
  FINALIZE: 'finalize-card',
};

/** 후보 메시지에 붙는 버튼 */
export function candidateButtons(packedDate, index) {
  return [{ text: '✅ Choose — 이걸로 제작', action: ACTIONS.CHOOSE, args: [packedDate, index] }];
}

/** 완성본 메시지에 붙는 버튼 */
export function reviewButtons(packedDate, index) {
  return [
    { text: '🚀 Upload', action: ACTIONS.UPLOAD, args: [packedDate, index] },
    { text: '🔁 Recreate', action: ACTIONS.RECREATE, args: [packedDate, index] },
    { text: '🗑 Drop', action: ACTIONS.DROP, args: [packedDate, index] },
  ];
}
