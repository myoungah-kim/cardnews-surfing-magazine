#!/usr/bin/env node
/**
 * Upload(확정) / Drop(폐기) 처리.
 *
 * Upload 는 인스타그램 게시까지 이 스크립트 안에서 끝낸다. 게시할 것은 두 가지다:
 * **이미지 포스트**와 **릴즈**. 둘 다 성공해야 후보를 `uploaded` 로 확정한다.
 *
 * ── 되돌릴 수 없는 작업을 다루는 원칙 ──────────────────────
 * 인스타그램 게시는 파이프라인으로 취소할 수 없다. 그래서:
 *
 *  1) 한쪽이 성공하면 **즉시** permalink 를 candidate 에 적고 저장한다.
 *     그래야 Upload 를 다시 눌렀을 때 성공한 쪽은 건너뛰고 실패한 쪽만
 *     재시도되어, 같은 글이 두 번 올라가지 않는다.
 *  2) 하나라도 실패하면 status 를 `review` 로 남긴다 — 그래야 canFinalize 가
 *     재시도를 허용한다.
 *  3) 게시는 성공했는데 그 *뒤* 의 기록이 실패하면, 사용자가 "실패했다"는
 *     알림만 보고 Upload 를 다시 눌러 중복 게시하는 일이 생긴다. 그래서 기록보다
 *     **먼저** 성공을 알리고, 기록 실패 시엔 "다시 누르지 말라"고 명시한다.
 *
 * 이 기록이 살아남으려면 워크플로의 커밋 스텝이 `if: always()` 여야 한다 —
 * 실패 시 커밋을 건너뛰면 permalink 가 통째로 사라져 1) 이 무의미해진다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_DECISION(uploaded|dropped),
 *          IG_ACCESS_TOKEN, IG_USER_ID (decision=uploaded 일 때만 필요)
 */

import { access, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canFinalize } from '../app/policy.js';
import { reviewButtons } from '../app/actions.js';
import { packDate } from '../core/callback.js';
import { InstagramClient } from '../core/instagram.js';
import { singleRow } from '../core/keyboard.js';
import { escapeHtml } from '../core/telegram.js';
import { REPO_ROOT, chatId, requireEnv, run, setOutputs, telegram } from './lib/runtime.mjs';

const LOG_PATH = path.join(REPO_ROOT, 'output', 'cards', '_processed_articles.csv');

/**
 * ARTICLE_CANDIDATE_FILTER.md 2번 섹션의 처리 로그에 한 줄 추가한다.
 * 이 로그가 있어야 다음 날 크롤링이 같은 기사를 다시 후보로 올리지 않는다.
 */
async function appendProcessedLog(date, candidate) {
  const existing = await readFile(LOG_PATH, 'utf8').catch(() => '');
  if (existing.includes(candidate.url)) return false;
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const row = [date, candidate.feed, candidate.url, candidate.slug, 'produced'].join(',');
  await appendFile(LOG_PATH, `${needsNewline ? '\n' : ''}${row}\n`, 'utf8');
  return true;
}

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');
  const decision = requireEnv('EVENT_DECISION');

  if (!['uploaded', 'dropped'].includes(decision)) {
    throw new Error(`알 수 없는 결정: ${decision}`);
  }

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);
  const bot = telegram();
  const chat = chatId();

  const verdict = canFinalize({ candidate, target: decision });
  if (!verdict.allow) {
    await bot.sendMessage({ chat_id: chat, text: `⛔ ${verdict.reason}` });
    await setOutputs({ changed: 'false' });
    return;
  }

  if (decision === 'uploaded') {
    // GITHUB_REF_NAME(브랜치명) 대신 커밋 SHA 를 쓴다 — raw.githubusercontent.com 은
    // 브랜치명 URL을 수 분간 CDN 캐시하므로, 방금 Recreate 한 새 카드를 바로
    // Upload 하면 캐시된 이전 버전이 게시될 수 있다. 커밋 SHA 로 주소를 고정하면
    // 그 내용이 절대 바뀌지 않으므로 캐시가 있어도 항상 정확한 버전이 나온다.
    const rawBase = `https://raw.githubusercontent.com/${requireEnv('GITHUB_REPOSITORY')}/${requireEnv('GITHUB_SHA')}/output/cards/${candidate.slug}`;
    const captionPath = path.join(REPO_ROOT, 'output', 'cards', candidate.slug, 'caption.md');
    const caption = (await readFile(captionPath, 'utf8')).trim();
    const reelPath = path.join(REPO_ROOT, 'output', 'cards', candidate.slug, 'reel.mp4');
    const hasReel = await access(reelPath).then(() => true, () => false);

    const ig = new InstagramClient(requireEnv('IG_ACCESS_TOKEN'), requireEnv('IG_USER_ID'));

    /**
     * 이미지와 릴즈를 각각 게시한다.
     *
     * 한쪽이 실패해도 이미 올라간 다른 쪽은 되돌릴 수 없으므로, **성공한 즉시
     * permalink 를 candidate 에 기록하고 저장**한다. 그래야 Upload 를 다시
     * 눌렀을 때 성공한 쪽은 건너뛰고 실패한 쪽만 재시도되어, 같은 글이 두 번
     * 올라가지 않는다. (이 저장이 커밋되도록 워크플로의 커밋 스텝은
     * `if: always()` 로 걸려 있다 — 그러지 않으면 실패 시 기록이 통째로 사라진다.)
     */
    const publishStep = async (label, key, emoji, action) => {
      if (candidate[key]) {
        console.log(`${label}: 이미 게시됨 — 건너뜀 (${candidate[key]})`);
        return { skipped: true };
      }
      try {
        const { permalink } = await action();
        candidate[key] = permalink;
        await writeCandidates(REPO_ROOT, data).catch((error) => {
          // 저장이 실패해도 게시는 이미 끝났다 — 알림만은 반드시 나가게 둔다.
          console.error(`${label} permalink 저장 실패: ${error.message}`);
        });
        await bot
          .sendMessage({
            chat_id: chat,
            text: `${emoji} ${label} 게시 완료 — <code>${escapeHtml(candidate.slug)}</code>\n${permalink}`,
            parse_mode: 'HTML',
          })
          .catch(() => {});
        return { permalink };
      } catch (error) {
        await bot
          .sendMessage({
            chat_id: chat,
            text:
              `⚠️ ${label} 게시에 실패했습니다.\n` +
              `<code>${escapeHtml(error.message)}</code>\n` +
              '다시 🚀 Upload 를 누르면 <b>이미 게시된 것은 건너뛰고 실패한 것만</b> 재시도합니다.',
            parse_mode: 'HTML',
            // 버튼 클릭 시 원본 메시지의 키보드는 이미 지워진 뒤다(중복 클릭 방지).
            // 재시도할 버튼이 아예 없는 채로 남지 않도록, 실패 알림에 새 버튼을 붙여 보낸다.
            reply_markup: singleRow(reviewButtons(packDate(date), candidate.index)),
          })
          .catch(() => {});
        return { error };
      }
    };

    const imageResult = await publishStep('이미지 포스트', 'imagePermalink', '🚀', () =>
      ig.postImage({ imageUrl: `${rawBase}/card_01.png`, caption }),
    );

    // 영상 파일이 없는 예전 카드는 릴즈 없이 이미지만 올린다 (기능 도입 전 산출물 호환).
    const reelResult = hasReel
      ? await publishStep('릴즈', 'reelPermalink', '🎬', () =>
          ig.postReel({ videoUrl: `${rawBase}/reel.mp4`, caption, shareToFeed: false }),
        )
      : { skipped: true, missing: true };

    if (reelResult.missing) {
      await bot
        .sendMessage({
          chat_id: chat,
          text: 'ℹ️ 이 카드에는 릴즈 영상이 없어 이미지 포스트만 게시했습니다.',
        })
        .catch(() => {});
    }

    // 하나라도 실패했으면 status 를 uploaded 로 바꾸지 않는다 — review 로 남아야
    // Upload 를 다시 눌러 실패한 쪽만 재시도할 수 있다 (canFinalize 가 review 만 허용).
    const failed = [imageResult, reelResult].filter((r) => r.error);
    if (failed.length > 0) {
      await writeCandidates(REPO_ROOT, data);
      await setOutputs({ changed: 'true' });
      throw new Error(`${failed.length}건의 게시가 실패했습니다 — 상태는 review 로 유지됩니다`);
    }

    candidate.status = decision;
    try {
      await writeCandidates(REPO_ROOT, data);
      await appendProcessedLog(date, candidate);
    } catch (recordError) {
      await bot.sendMessage({
        chat_id: chat,
        text:
          `⚠️ 게시는 성공했지만 상태 기록에 실패했습니다.\n` +
          `<b>Upload 를 다시 누르지 마세요</b> — 이미 게시된 글이 중복으로 올라갑니다. ` +
          `output/candidates 파일을 직접 확인해 상태를 review 로 되돌리거나 수동으로 uploaded 로 맞춰주세요.\n` +
          `<code>${escapeHtml(recordError.message)}</code>`,
        parse_mode: 'HTML',
      });
      throw recordError;
    }
  } else {
    candidate.status = decision;
    await writeCandidates(REPO_ROOT, data);

    await bot.sendMessage({
      chat_id: chat,
      text: `🗑 폐기했습니다 — <code>${candidate.slug ?? candidate.title}</code>\n처리 로그에 남기지 않으므로 나중에 다시 후보로 올라올 수 있습니다.`,
      parse_mode: 'HTML',
    });
  }

  await setOutputs({ changed: 'true' });
  console.log(`✔ ${decision} 처리 완료`);
});
