#!/usr/bin/env node
/**
 * 카드 제작 워크플로의 첫 단계 — 정책 검사 + 제작 지시서 준비.
 *
 * 워커는 무상태라 "이 요청을 받아줘도 되는지" 판단할 수 없다.
 * 후보 파일이 있는 이 러너에서 비로소 판단한다.
 *
 * 거부되면 워크플로를 실패시키지 않고 `allowed=false` 를 출력한다 —
 * 정상적인 거절(중복 클릭 등)까지 빨간 X 로 남으면 진짜 장애를 놓치게 된다.
 *
 * 환경변수: EVENT_DATE, EVENT_INDEX, EVENT_FEEDBACK(선택), EVENT_PHOTO_FILE_ID(선택)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findCandidate, readCandidates, writeCandidates } from '../app/candidates.js';
import { canProduce, canRecreate, isDuplicateRecreateReply } from '../app/policy.js';
import { REPO_ROOT, chatId, requireEnv, run, setOutputs, telegram, today } from './lib/runtime.mjs';

/** 기사 제목에서 output/cards/<slug> 폴더명을 만든다 */
function makeSlug(date, title) {
  const compact = date.replaceAll('-', '');
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
  // 영문 단어가 하나도 안 나오는 제목(전부 한글 등)은 순번으로 대체한다.
  return `${compact}_${words || 'article'}`;
}

run(async () => {
  const date = requireEnv('EVENT_DATE');
  const index = requireEnv('EVENT_INDEX');
  const feedback = process.env.EVENT_FEEDBACK?.trim() ?? '';
  const photoFileId = process.env.EVENT_PHOTO_FILE_ID?.trim() ?? '';
  const replyMessageId = process.env.EVENT_REPLY_MESSAGE_ID?.trim() ?? '';
  // 사진만 첨부하고 문구 없이 답장한 경우도 재생성 요청이다 — feedback 유무만으로
  // 판단하면 canProduce(최초 제작용 나이·중복 검사)가 잘못 타서 거부될 수 있다.
  const isRecreate = Boolean(feedback || photoFileId);

  const data = await readCandidates(REPO_ROOT, date);
  const candidate = findCandidate(data, index);

  // 같은 Recreate 답장이 두 번 들어온 경우(웹훅 재전송, 실수로 중복 전송 등)
  // — 이미 처리한 답장의 message_id 와 같으면 Claude 실행·스톡 검색·렌더링을
  // 다시 돌리지 않는다. 서로 다른 메시지(다른 message_id)로 이어서 보낸 추가
  // 요청은 그대로 허용한다 — 이건 정당한 새 요청일 수 있다.
  if (isDuplicateRecreateReply({ candidate, replyMessageId })) {
    await telegram().sendMessage({
      chat_id: chatId(),
      text: '⏭ 이미 처리한 답장입니다 — 중복 요청이라 다시 만들지 않았습니다.',
    });
    await setOutputs({ allowed: 'false' });
    console.log(`중복 답장으로 건너뜀 (message_id=${replyMessageId})`);
    return;
  }

  const producedToday = data.candidates.filter((item) =>
    ['producing', 'review', 'uploaded'].includes(item.status),
  ).length;

  // 재생성은 검수 상태에서 출발하므로 나이·중복 검사가 아닌 별도 정책을 탄다.
  const verdict = isRecreate
    ? canRecreate({ candidate })
    : canProduce({ candidate, today: today(), producedToday });

  if (!verdict.allow) {
    await telegram().sendMessage({
      chat_id: chatId(),
      text: `⛔ 제작을 시작하지 않았습니다.\n${verdict.reason}`,
    });
    await setOutputs({ allowed: 'false' });
    console.log(`거부됨: ${verdict.reason}`);
    return;
  }

  // 막지는 않지만 알려둘 것이 있는 경우 (예: 재생성 횟수가 쌓였을 때)
  if (verdict.warn) {
    await telegram().sendMessage({ chat_id: chatId(), text: `ℹ️ ${verdict.warn}` });
    console.log(`경고: ${verdict.warn}`);
  }

  candidate.status = 'producing';
  candidate.attempts = (candidate.attempts ?? 0) + 1;
  candidate.slug ??= makeSlug(date, candidate.title);
  if (feedback) {
    candidate.feedback = [...(candidate.feedback ?? []), feedback];
  }
  if (replyMessageId) {
    candidate.lastRecreateMessageId = replyMessageId;
  }
  await writeCandidates(REPO_ROOT, data);

  // 사용자가 Recreate 답장에 사진을 첨부했다면, Claude 가 참조할 수 있도록
  // 카드 폴더 안에 미리 받아둔다 — Claude 는 file_id 를 모르고, 이 러너만 봇 토큰을 갖고 있다.
  let photoPath = '';
  if (photoFileId) {
    const { data: bytes, filePath } = await telegram().downloadFile(photoFileId);
    const ext = path.extname(filePath) || '.jpg';
    photoPath = `output/cards/${candidate.slug}/user_photo${ext}`;
    await mkdir(path.dirname(path.join(REPO_ROOT, photoPath)), { recursive: true });
    await writeFile(path.join(REPO_ROOT, photoPath), Buffer.from(bytes));
  }

  await setOutputs({
    allowed: 'true',
    slug: candidate.slug,
    url: candidate.url,
    title: candidate.title,
    attempts: String(candidate.attempts),
    feedback,
    photo_path: photoPath,
  });

  console.log(`✔ 제작 준비 완료 — ${candidate.slug} (시도 ${candidate.attempts}회차)`);
});
