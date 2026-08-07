#!/usr/bin/env node
/**
 * 릴즈만 인스타그램에 게시한다 (이미지 포스트 없음).
 *
 *   SLUG=20260807_the-gamification-of-wave-pools node automation/scripts/post-reel.mjs
 *
 * ── finalize.mjs 와 무엇이 다른가 ────────────────────────────
 * finalize.mjs 의 Upload 는 **이미지 포스트와 릴즈를 둘 다** 올리고, 성공하면
 * 후보 상태를 `uploaded` 로 확정하고 처리 로그(_processed_articles.csv)에도 적는다.
 * 이 스크립트는 그중 릴즈 하나만 올리고 **상태는 아무것도 건드리지 않는다**.
 *
 * 그래서 여기서는 일부러 하지 않는 일이 있다:
 *   - 후보 JSON 의 status/permalink 를 쓰지 않는다
 *   - _processed_articles.csv 에 적지 않는다
 * 릴즈만 올린 기사를 "처리 완료"로 적어버리면 다음 날 후보 선별에서 빠져
 * 이미지 포스트를 영영 올릴 수 없게 되기 때문이다. 즉 이 스크립트를 쓴 뒤에도
 * 그 기사는 여전히 정상적인 Upload 대상으로 남는다.
 *
 * ── 중복 게시 방지 ──────────────────────────────────────────
 * 인스타그램 게시는 되돌릴 수 없다. 이 저장소에는 실제로 같은 글이 두 번
 * 올라간 사고가 있었다(2026-07-31, finalize-card.yml 주석 참고).
 * 그래서 성공하면 카드 폴더에 `reel_post.json` 을 남기고, 그 파일이 이미 있으면
 * 게시하지 않고 즉시 멈춘다. 정말 다시 올려야 하면 FORCE=true 로 실행한다.
 * (이 표식이 살아남으려면 워크플로의 커밋 스텝이 `if: always()` 여야 한다)
 *
 * 환경변수:
 *   SLUG            (필수) output/cards/<SLUG>/ 폴더 이름
 *   IG_ACCESS_TOKEN (필수) 장기 액세스 토큰
 *   IG_USER_ID      (필수) 인스타그램 비즈니스 계정 ID
 *   GITHUB_REPOSITORY, GITHUB_SHA (필수) raw URL 조립용 — 러너가 자동으로 넣어준다
 *   SHARE_TO_FEED   (선택) 'true' 면 프로필 그리드에도 노출. 기본은 릴즈 탭에만
 *   FORCE           (선택) 'true' 면 이미 게시된 표식이 있어도 다시 올린다
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (선택) 있으면 결과를 알린다
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InstagramClient } from '../core/instagram.js';
import { TelegramClient, escapeHtml } from '../core/telegram.js';
import { REPO_ROOT, requireEnv, run, setOutputs } from './lib/runtime.mjs';

const exists = (p) => access(p).then(() => true, () => false);

/**
 * 텔레그램은 있으면 쓰고 없으면 조용히 넘어간다.
 * 이 스크립트는 사람이 직접 돌리는 용도라 알림이 필수는 아니고,
 * 알림 실패 때문에 "게시는 됐는데 워크플로는 빨간불"이 되면 안 된다.
 */
async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await new TelegramClient(token)
    .sendMessage({ chat_id: chat, text, parse_mode: 'HTML' })
    .catch((error) => console.error(`텔레그램 알림 실패(무시): ${error.message}`));
}

run(async () => {
  const slug = requireEnv('SLUG').trim();
  const force = process.env.FORCE === 'true';
  const shareToFeed = process.env.SHARE_TO_FEED === 'true';

  // slug 는 그대로 경로와 URL 에 들어간다. `../` 가 섞이면 카드 폴더 밖을
  // 가리키게 되므로 폴더 이름에 실제로 쓰는 문자만 허용한다.
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) {
    throw new Error(`SLUG 형식이 올바르지 않습니다: ${slug}\n영문/숫자/._- 만 쓸 수 있습니다.`);
  }

  const cardDir = path.join(REPO_ROOT, 'output', 'cards', slug);
  const reelPath = path.join(cardDir, 'reel.mp4');
  const captionPath = path.join(cardDir, 'caption.md');
  const markerPath = path.join(cardDir, 'reel_post.json');

  if (!(await exists(cardDir))) {
    throw new Error(`카드 폴더가 없습니다: output/cards/${slug}`);
  }

  // ── 중복 게시 가드 ────────────────────────────────────────
  if (await exists(markerPath)) {
    const prev = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!force) {
      // 여기서 실패로 끝내지 않는 이유: 이건 오류가 아니라 "이미 끝난 일"이다.
      // 실패로 만들면 실패 알림이 나가고 사람이 다시 누르게 된다.
      console.log(`이미 릴즈가 게시된 카드입니다 — 건너뜁니다.\n  ${prev.permalink}`);
      await setOutputs({ posted: 'false', skipped: 'true', permalink: prev.permalink ?? '' });
      await notify(
        `ℹ️ <code>${escapeHtml(slug)}</code> 는 이미 릴즈가 게시되어 있어 건너뛰었습니다.\n` +
          `${escapeHtml(prev.permalink ?? '')}\n` +
          '정말 다시 올리려면 FORCE=true 로 실행하세요.',
      );
      return;
    }
    console.log(`⚠️ 이미 게시된 카드지만 FORCE=true 라 다시 올립니다 (기존: ${prev.permalink})`);
  }

  if (!(await exists(reelPath))) throw new Error(`릴즈 영상이 없습니다: ${reelPath}`);
  if (!(await exists(captionPath))) throw new Error(`캡션이 없습니다: ${captionPath}`);

  const caption = (await readFile(captionPath, 'utf8')).trim();
  if (!caption) throw new Error('caption.md 가 비어 있습니다');

  // 브랜치명이 아니라 커밋 SHA 로 주소를 고정한다 — raw.githubusercontent.com 은
  // 브랜치 URL 을 수 분간 CDN 캐시해서, 방금 갱신한 영상을 올려도 이전 버전이
  // 게시될 수 있다 (finalize.mjs 와 같은 이유).
  const videoUrl =
    `https://raw.githubusercontent.com/${requireEnv('GITHUB_REPOSITORY')}` +
    `/${requireEnv('GITHUB_SHA')}/output/cards/${slug}/reel.mp4`;

  // 인스타그램이 가져갈 수 있는 주소인지 먼저 확인한다. 이걸 건너뛰면 Graph API 가
  // "미디어를 가져올 수 없다" 같은 두루뭉술한 오류만 돌려줘서 원인 파악이 어렵다.
  // (아직 푸시되지 않은 커밋, 오타난 slug, 비공개 저장소가 여기서 걸린다)
  const head = await fetch(videoUrl, { method: 'HEAD' });
  if (!head.ok) {
    throw new Error(
      `릴즈 영상을 공개 주소에서 가져올 수 없습니다 (HTTP ${head.status}).\n  ${videoUrl}\n` +
        '이 커밋이 아직 푸시되지 않았거나, 저장소가 비공개일 수 있습니다.',
    );
  }
  console.log(`✔ 영상 확인 — ${head.headers.get('content-length')} bytes\n  ${videoUrl}`);

  const ig = new InstagramClient(requireEnv('IG_ACCESS_TOKEN'), requireEnv('IG_USER_ID'));

  console.log('릴즈 게시 중… (인스타그램 트랜스코딩까지 최대 5분)');
  const { mediaId, permalink } = await ig.postReel({ videoUrl, caption, shareToFeed });

  // 게시는 끝났다. 이 뒤로는 무슨 일이 있어도 표식을 남기는 게 최우선이다 —
  // 표식이 없으면 다음 실행이 중복 게시한다.
  await writeFile(
    markerPath,
    `${JSON.stringify({ slug, mediaId, permalink, videoUrl, shareToFeed, postedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  console.log(`✔ 릴즈 게시 완료 — ${permalink}`);
  await setOutputs({ posted: 'true', skipped: 'false', permalink });
  await notify(
    `🎬 릴즈 게시 완료 — <code>${escapeHtml(slug)}</code>\n${escapeHtml(permalink)}\n\n` +
      '이미지 포스트는 올리지 않았고 후보 상태도 그대로입니다.',
  );
});
