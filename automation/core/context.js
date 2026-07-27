/**
 * 강제 답장(force_reply) 왕복을 위한 컨텍스트 태그.
 *
 * "Recreate — 어디를 고칠까요?" 처럼 자유 텍스트 입력이 필요한 액션은
 * 두 번의 업데이트에 걸쳐 일어난다:
 *
 *   1) 사용자가 버튼 클릭  → 봇이 force_reply 로 질문을 던짐
 *   2) 사용자가 답장 입력  → 봇은 "이게 무엇에 대한 답장인지" 알아야 함
 *
 * 이때 어떤 작업에 대한 답장인지 기억하려면 보통 세션 저장소(KV/DB)가
 * 필요하지만, **질문 메시지 본문에 식별자를 심어두면** Telegram 이
 * `reply_to_message` 로 그 본문을 그대로 돌려주므로 저장소 없이 해결된다.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

const OPEN = '〔#';
const CLOSE = '〕';
// 태그 안에는 액션과 인자만 들어간다 — 닫는 문자가 값에 섞이면 안 된다.
const TAG_PATTERN = /〔#([^〕]+)〕/;

/**
 * 메시지 본문 끝에 컨텍스트 태그를 붙인다.
 *
 * @param {string} text 사용자에게 보일 본문
 * @param {string} action 액션 이름
 * @param {(string|number)[]} [args]
 * @returns {string} 태그가 붙은 본문
 */
export function embedContext(text, action, args = []) {
  const payload = [action, ...args.map(String)].join(':');
  if (payload.includes(CLOSE)) {
    throw new Error(`embedContext: 값에 '${CLOSE}' 를 포함할 수 없습니다 — ${payload}`);
  }
  return `${text}\n\n${OPEN}${payload}${CLOSE}`;
}

/**
 * 답장 대상 메시지 본문에서 컨텍스트 태그를 되읽는다.
 *
 * @param {string|undefined} text `reply_to_message.text`
 * @returns {{action: string, args: string[]} | null} 태그가 없으면 null
 */
export function extractContext(text) {
  if (!text) return null;
  const match = TAG_PATTERN.exec(text);
  if (!match) return null;
  const [action, ...args] = match[1].split(':');
  return { action, args };
}
