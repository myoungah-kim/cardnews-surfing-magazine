#!/usr/bin/env bash
# 러너에서 산출물·상태 변경을 커밋하고 푸시한다.
#
#   automation/scripts/commit-push.sh "커밋 메시지" [경로...]
#
# 경로를 생략하면 output/ 전체를 대상으로 한다.
#
# 서로 다른 후보를 동시에 제작하면 같은 후보 JSON 을 두 러너가 고치게 되어
# 푸시가 non-fast-forward 로 튕긴다. rebase 후 재시도로 흡수한다.
set -euo pipefail

MESSAGE="${1:?커밋 메시지가 필요합니다}"
shift
PATHS=("$@")
if [ ${#PATHS[@]} -eq 0 ]; then PATHS=("output/"); fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -- "${PATHS[@]}"

if git diff --cached --quiet; then
  echo "변경 없음 — 커밋 생략"
  exit 0
fi

git commit -m "$MESSAGE"

for attempt in 1 2 3 4 5; do
  if git push; then
    echo "✔ 푸시 완료 (시도 ${attempt}회)"
    exit 0
  fi
  echo "푸시 실패 — 원격 변경을 반영하고 재시도합니다 (${attempt}/5)"
  # 남의 커밋을 덮어쓰지 않도록 반드시 rebase 로 얹는다.
  #
  # 서로 다른 후보(예: 같은 날짜의 인접한 두 인덱스)를 거의 동시에 처리하면
  # candidates JSON 의 같은 영역을 건드려 rebase 자체가 텍스트 충돌을 낼 수
  # 있다. 이 경우 rebase 를 중간 상태로 방치하면 다음에 이 저장소를 체크아웃할
  # 때까지 원인 파악이 어려운 크래시로 보이므로, 충돌이면 즉시 되돌리고
  # 명확한 이유와 함께 실패시킨다 — 호출부의 실패 복구 경로
  # (reset-status.mjs 등)가 "동시 경쟁으로 실패했으니 다시 시도하라"로
  # 깨끗하게 이어받을 수 있게 하기 위함.
  if ! git pull --rebase --autostash; then
    git rebase --abort 2>/dev/null || true
    echo "다른 실행이 같은 파일을 동시에 수정해 병합할 수 없었습니다 — 잠시 후 다시 시도해 주세요."
    exit 1
  fi
  sleep $((attempt * 3))
done

echo "5회 재시도 후에도 푸시하지 못했습니다."
exit 1
