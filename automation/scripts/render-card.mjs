#!/usr/bin/env node
/**
 * 카드 HTML → 1080x1350 PNG 렌더링 (크로스 플랫폼).
 *
 * `CLAUDE.md` Step 6 의 명령은 macOS 크롬 경로가 박혀 있어 리눅스 러너에서
 * 그대로 쓸 수 없다. 이 스크립트가 플랫폼별 경로를 대신 찾아준다.
 *
 *   node scripts/render-card.mjs <입력.html> <출력.png>
 *
 * CHROME_BIN 환경변수가 있으면 그걸 최우선으로 쓴다.
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { run } from './lib/runtime.mjs';

const execFileAsync = promisify(execFile);

/** 인스타그램 세로 카드 규격 — DESIGN.md 기준 */
const WIDTH = 1080;
const HEIGHT = 1350;

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

async function resolveChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  const list = CANDIDATES[process.platform] ?? [];
  for (const candidate of list) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 다음 후보로
    }
  }
  throw new Error(
    `크롬을 찾을 수 없습니다 (platform: ${process.platform}). ` +
      'CHROME_BIN 환경변수로 실행 파일 경로를 지정하세요.',
  );
}

run(async () => {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error('사용법: node scripts/render-card.mjs <입력.html> <출력.png>');
  }

  const chrome = await resolveChrome();
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);

  await execFileAsync(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    // 러너는 샌드박스 권한이 제한된 컨테이너라 이 옵션 없이는 크롬이 뜨지 않는다.
    '--no-sandbox',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${outputPath}`,
    `file://${inputPath}`,
  ]);

  console.log(`✔ 렌더링 완료 — ${outputPath} (${WIDTH}x${HEIGHT})`);
});
