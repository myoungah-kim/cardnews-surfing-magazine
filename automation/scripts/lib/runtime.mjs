/**
 * 러너(GitHub Actions) 쪽 스크립트가 공통으로 쓰는 유틸.
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient } from '../../core/telegram.js';

/** automation/scripts/lib → 저장소 루트 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * 필수 환경변수를 읽는다. 없으면 즉시 실패시켜서
 * "왜 아무 일도 안 일어나지" 상태를 만들지 않는다.
 * @param {string} name
 */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name} 가 설정되지 않았습니다`);
  return value;
}

export function telegram() {
  return new TelegramClient(requireEnv('TELEGRAM_BOT_TOKEN'));
}

export function chatId() {
  return requireEnv('TELEGRAM_CHAT_ID');
}

/**
 * 오늘 날짜를 YYYY-MM-DD 로. 러너는 UTC 라서 한국 기준 날짜와
 * 어긋나는 걸 막기 위해 타임존을 명시한다.
 * @param {string} [timeZone]
 */
export function today(timeZone = process.env.PIPELINE_TIMEZONE ?? 'Asia/Seoul') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * 후속 스텝이 쓸 수 있도록 GITHUB_OUTPUT 에 값을 기록한다.
 * 여러 줄 값도 안전하도록 heredoc 구분자를 쓴다.
 * @param {Record<string, string>} values
 */
export async function setOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log('[outputs]', values);
    return;
  }
  const lines = Object.entries(values).map(([key, value]) => {
    const delimiter = `__EOF_${key}_${Math.random().toString(36).slice(2)}__`;
    return `${key}<<${delimiter}\n${value ?? ''}\n${delimiter}`;
  });
  await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * 스크립트를 실행하고 오류를 사람이 읽을 수 있게 종료시킨다.
 * @param {() => Promise<void>} main
 */
export function run(main) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}`);
    if (process.env.RUNNER_DEBUG === '1') console.error(error.stack);
    process.exit(1);
  });
}
