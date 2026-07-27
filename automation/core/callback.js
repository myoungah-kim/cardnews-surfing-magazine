/**
 * 인라인 버튼의 callback_data 인코딩 / 파싱.
 *
 * Telegram 의 callback_data 는 **UTF-8 기준 64바이트** 상한이 있다.
 * 이걸 넘기면 버튼을 만들 때가 아니라 메시지를 보낼 때 400 이 나기 때문에
 * 원인을 찾기 어렵다 — 그래서 인코딩 시점에 즉시 검증한다.
 *
 * 그 결과 callback_data 에는 URL 같은 긴 값을 절대 넣을 수 없고,
 * **짧은 식별자만 넣고 실제 데이터는 실행기가 조회**하는 구조를 강제하게 된다.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

/** Telegram 이 정한 callback_data 최대 바이트 */
export const CALLBACK_DATA_MAX_BYTES = 64;

const SEPARATOR = ':';
const encoder = new TextEncoder();

/**
 * @param {string} action 액션 이름 (짧게 — 2~4자 권장)
 * @param {(string|number)[]} [args] 액션 인자. 구분자(:)를 포함할 수 없다.
 * @returns {string} callback_data 문자열
 */
export function encodeCallback(action, args = []) {
  if (!action) throw new Error('encodeCallback: action 이 비어 있습니다');

  const parts = [action, ...args.map(String)];
  for (const part of parts) {
    if (part.includes(SEPARATOR)) {
      throw new Error(`encodeCallback: 값에 구분자 '${SEPARATOR}' 를 포함할 수 없습니다 — ${part}`);
    }
  }

  const data = parts.join(SEPARATOR);
  const bytes = encoder.encode(data).length;
  if (bytes > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(
      `encodeCallback: callback_data 가 ${bytes}바이트로 상한(${CALLBACK_DATA_MAX_BYTES})을 넘었습니다 — ` +
        `'${data}'. 긴 값 대신 짧은 식별자를 쓰세요.`,
    );
  }
  return data;
}

/**
 * @param {string} data Telegram 이 돌려준 callback_data
 * @returns {{action: string, args: string[]}}
 */
export function decodeCallback(data) {
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('decodeCallback: callback_data 가 비어 있습니다');
  }
  const [action, ...args] = data.split(SEPARATOR);
  return { action, args };
}

/**
 * 날짜를 callback_data 용으로 압축한다 (2026-07-27 → 260727).
 * 64바이트 예산을 아끼기 위한 것.
 * @param {string} isoDate YYYY-MM-DD
 */
export function packDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`packDate: YYYY-MM-DD 형식이 아닙니다 — ${isoDate}`);
  return `${match[1].slice(2)}${match[2]}${match[3]}`;
}

/**
 * packDate 의 역함수 (260727 → 2026-07-27).
 * 20xx 년대를 가정한다.
 * @param {string} packed YYMMDD
 */
export function unpackDate(packed) {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(packed);
  if (!match) throw new Error(`unpackDate: YYMMDD 형식이 아닙니다 — ${packed}`);
  return `20${match[1]}-${match[2]}-${match[3]}`;
}
