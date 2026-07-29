#!/usr/bin/env node
/**
 * 카드 PNG + 배경음악 → 인스타그램 릴즈용 15초 mp4.
 *
 *   node scripts/make-reel.mjs <카드.png> <배경음악.mp3> <출력.mp4>
 *
 * ── 왜 제작 단계에서 만드는가 ────────────────────────────────
 * 인스타그램 Graph API 는 파일을 업로드받지 않고 **공개 URL 을 주면 자기가
 * 가져간다**. 그래서 게시 시점(Upload)에 만들면 그 mp4 는 아직 어느 커밋에도
 * 없어 URL 이 404 가 된다. 카드 PNG 와 같은 시점에 만들어 함께 커밋해 두면
 * 이 문제가 사라지고, 검수 단계에서 영상을 미리 볼 수 있다는 이점도 생긴다.
 *
 * ── 화면 구성 ────────────────────────────────────────────
 * 카드는 1080x1350(4:5)인데 릴즈는 1080x1920(9:16)이라 위아래가 남는다.
 * 검은 레터박스 대신 **같은 이미지를 꽉 차게 키워 블러 처리한 배경**을 깔고
 * 그 위에 원본 카드를 선명하게 얹는다 (위아래 각 285px 가 블러 영역).
 *
 * FFMPEG_BIN 환경변수가 있으면 그걸 최우선으로 쓴다.
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { run } from './lib/runtime.mjs';

const execFileAsync = promisify(execFile);

/** 인스타그램 릴즈 규격 */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

/** 영상 길이(초). 인스타그램 릴즈는 3초~15분을 허용한다. */
export const REEL_SECONDS = 15;

/**
 * 배경음악에서 잘라 쓸 시작 지점(초).
 * 곡의 도입부가 밋밋하면 이 값만 올리면 된다.
 */
export const BGM_START_SECONDS = 0;

/** 블러 강도 — 뒤배경이 헤드라인 가독성을 해치지 않을 만큼만 흐린다. */
const BLUR_SIGMA = 40;

const CANDIDATES = {
  darwin: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
  linux: ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
  win32: ['C:\\ffmpeg\\bin\\ffmpeg.exe'],
};

export async function resolveFfmpeg() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;

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
    `ffmpeg 를 찾을 수 없습니다 (platform: ${process.platform}). ` +
      'FFMPEG_BIN 환경변수로 실행 파일 경로를 지정하세요.',
  );
}

/**
 * ffmpeg 인자 조립. 실제 인코딩과 분리해 둔 이유는 **인자 구성만 따로
 * 테스트**하기 위해서다 — 인코딩은 무거워서 단위 테스트로 돌리기 어렵다.
 *
 * @param {{card: string, bgm: string, output: string}} paths 절대경로
 * @returns {string[]}
 */
export function buildFfmpegArgs({ card, bgm, output }) {
  const fadeOutStart = Math.max(0, REEL_SECONDS - 1);

  return [
    '-y',
    // 정지 이미지를 영상 길이만큼 반복 입력
    '-loop', '1',
    '-i', card,
    // 음악은 필요한 구간부터 읽는다 (-ss 를 -i 앞에 두면 디코딩을 건너뛰어 빠르다)
    '-ss', String(BGM_START_SECONDS),
    '-i', bgm,
    '-filter_complex',
    [
      // 배경: 화면을 넘치게 키워 9:16 으로 자른 뒤 블러
      `[0:v]scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${REEL_WIDTH}:${REEL_HEIGHT},gblur=sigma=${BLUR_SIGMA}[bg]`,
      // 전경: 원본 카드를 가로 기준으로만 맞춘다(-2 는 짝수 높이 자동 계산)
      `[0:v]scale=${REEL_WIDTH}:-2[fg]`,
      // 전경을 정중앙에 얹고, 재생 호환성을 위해 yuv420p 로 고정
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
    ].join(';'),
    '-map', '[v]',
    '-map', '1:a',
    '-t', String(REEL_SECONDS),
    // 인스타그램 릴즈는 23~60fps 를 요구한다. 정지 이미지라 30이면 충분.
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    // 15초에서 음악이 뚝 끊기지 않도록 앞뒤로 페이드
    '-af', `afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=1`,
    // 스트리밍 재생을 위해 메타데이터를 파일 앞으로 (인스타그램이 요구)
    '-movflags', '+faststart',
    output,
  ];
}

// 커맨드로 직접 실행할 때만 돈다. 이 가드가 없으면 buildFfmpegArgs 를 테스트에서
// import 하는 것만으로 인코딩이 시작되고, 인자가 없어 곧바로 종료돼 버린다.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run(async () => {
    const [card, bgm, output] = process.argv.slice(2);
    if (!card || !bgm || !output) {
      throw new Error('사용법: node scripts/make-reel.mjs <카드.png> <배경음악.mp3> <출력.mp4>');
    }

    const ffmpeg = await resolveFfmpeg();
    const args = buildFfmpegArgs({
      card: path.resolve(card),
      bgm: path.resolve(bgm),
      output: path.resolve(output),
    });

    try {
      await execFileAsync(ffmpeg, args);
    } catch (cause) {
      // ffmpeg 는 실패 사유를 stderr 에 쓴다 — 이걸 버리면 원인 파악이 불가능해진다.
      throw new Error(`ffmpeg 실행 실패:\n${cause.stderr ?? cause.message}`, { cause });
    }

    console.log(
      `✔ 릴즈 생성 완료 — ${path.resolve(output)} ` +
        `(${REEL_WIDTH}x${REEL_HEIGHT}, ${REEL_SECONDS}초)`,
    );
  });
}
