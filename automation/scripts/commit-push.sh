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
  git pull --rebase --autostash
  sleep $((attempt * 3))
done

echo "5회 재시도 후에도 푸시하지 못했습니다."
exit 1
