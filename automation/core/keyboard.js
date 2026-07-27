/**
 * 인라인 키보드 빌더 + 클릭 후 버튼 비활성화 헬퍼.
 *
 * 이 파일은 프로젝트에 종속되지 않는다.
 */

import { encodeCallback } from './callback.js';

/**
 * 버튼 행들을 인라인 키보드로 만든다.
 *
 * @param {Array<Array<{text: string, action: string, args?: (string|number)[], url?: string}>>} rows
 * @returns {{inline_keyboard: Array<Array<object>>}}
 */
export function inlineKeyboard(rows) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => {
        if (button.url) return { text: button.text, url: button.url };
        return { text: button.text, callback_data: encodeCallback(button.action, button.args) };
      }),
    ),
  };
}

/**
 * 버튼 한 줄짜리 키보드 (가장 흔한 형태) 단축 함수.
 * @param {Array<{text: string, action: string, args?: (string|number)[], url?: string}>} buttons
 */
export function singleRow(buttons) {
  return inlineKeyboard([buttons]);
}

/**
 * 버튼을 눌러 처리가 끝난 메시지에서 키보드를 제거한다.
 *
 * 같은 버튼을 두 번 눌러 작업이 중복 실행되는 것을 막는 1차 방어선이다.
 * (2차 방어선은 실행기 쪽의 멱등성 검사 — 버튼 제거는 이미 열려 있던
 *  다른 기기의 화면까지 즉시 갱신해주지는 않기 때문)
 */
export const EMPTY_KEYBOARD = { inline_keyboard: [] };

/**
 * 사용자에게 텍스트 입력을 요구하는 강제 답장 마크업.
 * Recreate 처럼 "무엇을 고칠지" 자유 입력이 필요한 액션에 쓴다.
 * @param {string} [placeholder]
 */
export function forceReply(placeholder) {
  return {
    force_reply: true,
    input_field_placeholder: placeholder,
    selective: true,
  };
}
