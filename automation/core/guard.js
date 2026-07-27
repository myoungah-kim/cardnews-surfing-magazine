/**
 * 웹훅 인증 — 이 봇을 누가 조종할 수 있는지 결정하는 곳.
 *
 * 봇 사용자명은 공개 정보이므로 아무나 봇에게 말을 걸 수 있다.
 * 저장소가 public 이면 웹훅 URL 도 코드에서 유추될 수 있다고 보고,
 * **두 겹**으로 막는다:
 *
 *   1) `X-Telegram-Bot-Api-Secret-Token` — 이 요청이 진짜 Telegram 에서 왔는가
 *   2) chat/user 허용 목록 — 그 안에서도 주인이 보낸 것인가
 *
 * 1번만 있으면 제3자가 봇에게 직접 말을 걸었을 때도 Telegram 이
 * 정상적으로 우리 웹훅을 호출하므로, 2번이 반드시 필요하다.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

/**
 * 타이밍 공격에 안전한 문자열 비교.
 * 길이가 다르면 즉시 실패하지만, 시크릿 길이는 비밀이 아니므로 문제되지 않는다.
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * setWebhook 시 등록한 시크릿 토큰이 요청 헤더와 일치하는지 확인한다.
 * @param {Request} request
 * @param {string} expectedSecret
 */
export function verifyWebhookSecret(request, expectedSecret) {
  if (!expectedSecret) {
    // 시크릿 미설정 상태로 배포되면 누구나 웹훅을 호출할 수 있으므로 열어두지 않는다.
    throw new Error('verifyWebhookSecret: TELEGRAM_WEBHOOK_SECRET 이 설정되지 않았습니다');
  }
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  return timingSafeEqual(provided, expectedSecret);
}

/**
 * Telegram 업데이트에서 발신자/대화 식별자를 뽑는다.
 * 업데이트 종류(메시지 / 버튼 클릭)마다 위치가 달라서 한 곳에 모아둔다.
 *
 * @param {object} update
 * @returns {{chatId: number|undefined, userId: number|undefined}}
 */
export function identify(update) {
  const message = update?.message ?? update?.edited_message ?? update?.callback_query?.message;
  return {
    chatId: message?.chat?.id,
    userId: update?.callback_query?.from?.id ?? update?.message?.from?.id,
  };
}

/**
 * 허용 목록 검사.
 *
 * @param {object} update
 * @param {{allowedChatIds?: (string|number)[], allowedUserIds?: (string|number)[]}} policy
 * @returns {boolean} 허용 목록이 비어 있으면 false — 기본 거부(fail closed)
 */
export function isAuthorized(update, policy) {
  const { chatId, userId } = identify(update);
  const chats = (policy.allowedChatIds ?? []).map(String);
  const users = (policy.allowedUserIds ?? []).map(String);

  if (chats.length === 0 && users.length === 0) return false;
  if (chats.length > 0 && !chats.includes(String(chatId))) return false;
  if (users.length > 0 && !users.includes(String(userId))) return false;
  return true;
}

/**
 * 쉼표로 구분된 환경변수를 ID 목록으로 파싱한다. (예: "123,456")
 * @param {string|undefined} value
 * @returns {string[]}
 */
export function parseIdList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
