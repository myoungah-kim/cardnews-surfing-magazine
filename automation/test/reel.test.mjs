/**
 * 릴즈 파이프라인 테스트.
 *
 * 실제 인코딩은 무겁고 러너에만 ffmpeg 가 있으므로, 여기서는
 *   ① ffmpeg 인자 조립이 규격(1080x1920·15초·오디오 포함)을 지키는지
 *   ② 되돌릴 수 없는 게시를 다루는 배선이 워크플로/스크립트에 살아 있는지
 * 를 검사한다. ②는 단위 테스트로 재현하기 어려운 종류라 소스 텍스트를 본다
 * (workflow-order.test.mjs 와 같은 접근).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BGM_START_SECONDS,
  REEL_HEIGHT,
  REEL_SECONDS,
  REEL_WIDTH,
  buildFfmpegArgs,
} from '../scripts/make-reel.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const workflow = (name) => read('..', '.github', 'workflows', name);

const args = () => buildFfmpegArgs({ card: '/c.png', bgm: '/b.mp3', output: '/o.mp4' });
/** 인자 배열에서 특정 플래그의 값을 꺼낸다 */
const valueOf = (list, flag) => list[list.indexOf(flag) + 1];

// ── ① ffmpeg 인자 ──────────────────────────────────────────────────────

test('릴즈는 인스타그램 세로 규격(1080x1920)으로 만든다', () => {
  const filter = valueOf(args(), '-filter_complex');
  // 배경을 넘치게 키워 9:16 으로 자른다 — 레터박스 대신 블러 배경을 쓰기 위함.
  assert.match(filter, new RegExp(`scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=increase`));
  assert.match(filter, new RegExp(`crop=${REEL_WIDTH}:${REEL_HEIGHT}`));
  assert.equal(REEL_WIDTH, 1080);
  assert.equal(REEL_HEIGHT, 1920);
});

test('원본 카드는 블러 배경 위에 정중앙으로 얹는다', () => {
  const filter = valueOf(args(), '-filter_complex');
  assert.match(filter, /gblur=sigma=\d+\[bg\]/, '배경에 블러가 걸려야 한다');
  assert.match(filter, /\[bg\]\[fg\]overlay=\(W-w\)\/2:\(H-h\)\/2/, '전경이 정중앙에 놓여야 한다');
  // 전경은 가로만 맞추고 세로는 비율대로 둔다(-2 = 짝수로 자동 계산).
  assert.match(filter, new RegExp(`\\[0:v\\]scale=${REEL_WIDTH}:-2\\[fg\\]`));
});

test('길이는 15초이고 음악 시작 지점을 바꿀 수 있다', () => {
  const list = args();
  assert.equal(REEL_SECONDS, 15);
  assert.equal(valueOf(list, '-t'), '15');
  // -ss 는 입력(-i) 앞에 와야 디코딩을 건너뛴다.
  assert.ok(list.indexOf('-ss') < list.lastIndexOf('-i'));
  assert.equal(valueOf(list, '-ss'), String(BGM_START_SECONDS));
});

test('오디오 트랙을 반드시 싣는다 — 음악이 릴즈의 핵심이다', () => {
  const list = args();
  assert.ok(list.includes('-map') && list.includes('1:a'), '두 번째 입력(음악)을 매핑해야 한다');
  assert.equal(valueOf(list, '-c:a'), 'aac');
});

test('15초에서 음악이 뚝 끊기지 않도록 페이드를 넣는다', () => {
  const af = valueOf(args(), '-af');
  assert.match(af, /afade=t=in:st=0/);
  // 페이드아웃은 끝나기 전에 시작해야 의미가 있다.
  const outStart = Number(/afade=t=out:st=(\d+)/.exec(af)[1]);
  assert.ok(outStart < REEL_SECONDS && outStart > 0);
});

test('인스타그램 재생 호환을 위한 픽셀 포맷·faststart·fps 를 지킨다', () => {
  const list = args();
  // yuv420p 가 아니면 일부 플레이어에서 재생되지 않는다.
  assert.match(valueOf(list, '-filter_complex'), /format=yuv420p/);
  // 메타데이터가 파일 뒤에 있으면 인스타그램이 스트리밍으로 읽지 못한다.
  assert.equal(valueOf(list, '-movflags'), '+faststart');
  // 릴즈 허용 범위는 23~60fps.
  const fps = Number(valueOf(list, '-r'));
  assert.ok(fps >= 23 && fps <= 60, `fps ${fps} 가 릴즈 허용 범위(23~60) 밖이다`);
});

test('출력 경로가 마지막 인자여야 한다', () => {
  assert.equal(args().at(-1), '/o.mp4');
});

// ── ② 되돌릴 수 없는 게시를 다루는 배선 ─────────────────────────────────

test('릴즈는 카드 커밋 전에 만들어져야 한다 — 인스타그램이 URL로 가져가기 때문', () => {
  // 게시 시점에 만들면 그 mp4 는 아직 어느 커밋에도 없어 raw URL 이 404 가 된다.
  const source = workflow('produce-card.yml');
  const at = (step) => {
    const i = source.indexOf(`- name: ${step}`);
    assert.notEqual(i, -1, `'${step}' 스텝이 없습니다`);
    return i;
  };
  assert.ok(at('릴즈 영상 생성') < at('산출물 커밋'));
  assert.ok(at('배경음악 복호화') < at('릴즈 영상 생성'));
});

test('산출물 검증이 릴즈 규격과 오디오 유무를 확인한다', () => {
  const source = workflow('produce-card.yml');
  assert.match(source, /1080x1920/);
  assert.match(source, /오디오 트랙이 없습니다/);
});

test('부분 실패 기록이 살아남도록 확정 워크플로가 always() 로 커밋한다', () => {
  // 이게 없으면 "이미지만 성공" 상태에서 permalink 기록이 사라져,
  // 재시도 시 이미 올라간 이미지가 중복 게시된다.
  const source = workflow('finalize-card.yml');
  assert.match(source, /if:\s*always\(\)\s*&&\s*steps\.run\.outputs\.changed == 'true'/);
});

test('finalize 는 이미 게시된 것을 건너뛰고 실패한 것만 재시도한다', () => {
  const source = read('scripts', 'finalize.mjs');
  assert.match(source, /imagePermalink/);
  assert.match(source, /reelPermalink/);
  // 이미 permalink 가 있으면 건너뛴다는 분기가 있어야 한다.
  assert.match(source, /if \(candidate\[key\]\)/);
  // 하나라도 실패하면 uploaded 로 확정하지 않는다.
  assert.match(source, /상태는 review 로 유지됩니다/);
});

test('음원 원본은 저장소에 커밋될 수 없고 암호화본만 허용된다', () => {
  const gitignore = read('..', '.gitignore');
  // 디렉터리를 통째로 무시하면 git 이 안으로 들어가지 않아 ! 예외가 먹지 않는다.
  assert.match(gitignore, /^input\/bgm\/\*$/m);
  assert.match(gitignore, /^!input\/bgm\/\*\.gpg$/m);
});
