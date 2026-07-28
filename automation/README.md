# automation — Telegram 승인 워크플로 봇

매일 아침 후보 기사를 Telegram 으로 받아, 버튼 한 번으로 카드뉴스를 만들고
검수까지 끝내는 파이프라인입니다. **로컬 컴퓨터가 꺼져 있어도 동작합니다.**

---

## 1. 구조

```
Telegram 버튼 클릭
      │  (수백 ms)
      ▼
Cloudflare Worker  ── 인증 → 즉시 응답 → GitHub 깨우기
      │  repository_dispatch
      ▼
GitHub Actions     ── Claude 실행 → 카드 렌더링 → 커밋 → Telegram 발송
      │
      ▼
git 저장소가 곧 아카이브 (output/cards/<slug>/)
```

왜 이렇게 나눴는가:

- **Telegram 은 웹훅이 몇 초 안에 200 을 안 주면 같은 업데이트를 재전송합니다.**
  카드 제작은 수 분이 걸리므로 웹훅에서 직접 하면 카드가 여러 장 만들어집니다.
- **서버리스 웹훅은 헤드리스 크롬을 못 돌립니다.** 렌더링에는 러너가 필요합니다.
- **워커를 무상태로 유지하려고** 상태 저장소(KV·DB)를 쓰지 않았습니다.
  후보 정보는 `output/candidates/YYYY-MM-DD.json` 에 있고 git 에 커밋됩니다.

### 폴더

| 경로 | 성격 |
|---|---|
| `core/` | **프로젝트 무관 · 그대로 복사해 재사용** — Telegram 클라이언트, 버튼 인코딩, 라우터, 인증, GitHub dispatch |
| `app/` | 이 프로젝트 전용 — 액션 정의, 후보 상태 파일, 운영 정책 |
| `worker/` | Cloudflare Worker 엔트리 (core + app 배선) |
| `scripts/` | GitHub Actions 러너에서 도는 실행 스크립트 |
| `prompts/` | Claude 에게 주는 지시서 (워크플로 YAML 과 분리) |
| `test/` | `node --test` 단위·통합 테스트 |

---

## 2. 설치

### 2-1. Telegram 봇 만들기

1. Telegram 에서 [@BotFather](https://t.me/BotFather) 에게 `/newbot`
2. 이름과 사용자명을 정하면 **봇 토큰**을 줍니다 (`123456789:AA...`)
3. 만든 봇과 1:1 대화를 시작하고 아무 메시지나 보냅니다
4. 내 **chat id** 확인:

   ```bash
   curl -s "https://api.telegram.org/bot<봇토큰>/getUpdates" \
     | grep -o '"chat":{"id":[0-9-]*' | head -1
   ```

### 2-2. Claude 구독 토큰 발급

```bash
claude setup-token
```

출력된 토큰을 `CLAUDE_CODE_OAUTH_TOKEN` 으로 씁니다.

### 2-3. GitHub PAT (워커가 워크플로를 깨우는 용도)

[fine-grained token](https://github.com/settings/personal-access-tokens/new) 을 만들고
이 저장소에만 **Contents: Read and write** 권한을 줍니다.

### 2-4. Cloudflare API 토큰

[API 토큰 발급](https://dash.cloudflare.com/profile/api-tokens) → **Edit Cloudflare Workers** 템플릿.
계정 ID 는 Cloudflare 대시보드 오른쪽 사이드바에서 확인합니다.

### 2-5. GitHub Secrets 등록

**모든 비밀값은 GitHub Secrets 한 곳에만 둡니다.** 워커 시크릿은 배포 워크플로가
여기서 읽어 Cloudflare 로 동기화하므로, 대시보드에서 따로 관리하지 않습니다.

| 이름 | 값 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 2-2 에서 발급한 토큰 |
| `TELEGRAM_BOT_TOKEN` | BotFather 토큰 |
| `TELEGRAM_CHAT_ID` | 내 chat id |
| `TELEGRAM_WEBHOOK_SECRET` | 아무 긴 랜덤 문자열 (`openssl rand -hex 32`) |
| `REPO_DISPATCH_TOKEN` | 2-3 의 PAT — GitHub 이 `GITHUB_` 접두사를 금지해 이 이름을 씁니다 |
| `CLOUDFLARE_API_TOKEN` | 2-4 의 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 ID |
| `UNSPLASH_ACCESS_KEY` | (선택) 스톡 사진용 |
| `PEXELS_API_KEY` | (선택) |
| `PIXABAY_API_KEY` | (선택) |

```bash
# 값은 화면에 표시되지 않게 입력됩니다.
gh secret set CLAUDE_CODE_OAUTH_TOKEN
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
gh secret set REPO_DISPATCH_TOKEN
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID

# 웹훅 시크릿은 즉석에서 만들어 넣습니다.
openssl rand -hex 32 | gh secret set TELEGRAM_WEBHOOK_SECRET
```

> `wrangler.toml` 의 `GITHUB_REPO` 값이 실제 저장소와 맞는지 확인하세요.

### 2-6. 배포

```bash
gh workflow run "웹훅 배포"
gh run watch
```

이 워크플로가 한 번에 처리합니다:

1. Cloudflare Worker 배포
2. 워커 시크릿을 GitHub Secrets 기준으로 동기화
3. Telegram 웹훅 등록 + 상태 출력

이후 `automation/worker/`·`core/`·`app/` 을 수정해 push 하면 자동 재배포됩니다.

> 로컬에 wrangler 를 설치할 필요가 없습니다. wrangler 4 는 Node 22 이상을 요구하는데,
> 러너에서 돌리면 로컬 Node 버전과 무관하게 동작합니다.

---

## 3. 사용

1. 매일 **07:12 KST** 에 후보 5개가 Telegram 으로 옵니다.
2. 만들고 싶은 기사의 **✅ Choose** 를 누릅니다.
3. 수 분 뒤 카드 PNG + 캡션이 옵니다.
4. **🚀 Upload** / **🔁 Recreate** / **🗑 Drop** 중 선택.
   - Recreate 는 "어디를 고칠지" 되묻습니다. 그 메시지에 **답장**으로 적으세요.
   - Upload 는 `_processed_articles.csv` 에 기록해 다음 날 중복 추천을 막습니다.

수동 실행:

```bash
gh workflow run "일일 후보 선별"
gh workflow run "카드뉴스 제작" -f date=2026-07-27 -f index=2
```

---

## 4. 다른 프로젝트에서 재사용하기

`core/` 는 이 프로젝트를 전혀 모릅니다. 그대로 복사한 뒤 `app/` 만 새로 쓰면 됩니다.

```js
import { TelegramClient } from './core/telegram.js';
import { createRouter } from './core/router.js';
import { GitHubDispatcher } from './core/dispatch.js';

const router = createRouter({
  buttons: {
    async approve([id], ctx) { /* … */ },
  },
  replies: {
    async approve(text, [id], ctx) { /* 자유 입력 처리 */ },
  },
});
```

바꿔야 할 것은 세 곳뿐입니다:

1. `app/actions.js` — 버튼과 이벤트 이름
2. `app/policy.js` — 무엇을 허용할지
3. `worker/index.js` — 위 둘을 배선하는 부분

`core/` 가 대신 처리해주는 것들:

- callback_data **64바이트 상한** 검사 (넘기면 전송 시점에 400 이 나서 원인 찾기 어려움)
- 버튼 클릭에 **먼저 응답**해 로딩 스피너 정지
- 오류가 나도 **항상 200** 반환 (Telegram 재전송으로 인한 중복 실행 방지)
- 시크릿 헤더 + 허용목록 **이중 인증** (기본 거부)
- 자유 입력이 필요한 액션의 **강제 답장 왕복** (저장소 없이)

---

## 5. 테스트

```bash
cd automation
node --test test/
```

실제 Telegram 호출 없이 워커 전체 흐름을 검증합니다.

---

## 6. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 버튼을 눌러도 반응 없음 | `TELEGRAM_BOT_TOKEN=... node scripts/set-webhook.mjs --info` 의 `last_error_message` |
| "권한이 없습니다" | `TELEGRAM_CHAT_ID` 시크릿이 내 chat id 와 일치하는지 (워커의 허용목록으로 동기화됩니다) |
| 워커는 되는데 워크플로가 안 돌음 | `REPO_DISPATCH_TOKEN` 권한(Contents: write), `wrangler.toml` 의 `GITHUB_REPO` |
| 시크릿을 바꿨는데 반영이 안 됨 | 워커 시크릿은 배포 시에만 동기화됩니다. `gh workflow run "웹훅 배포"` |
| 카드가 계속 "제작 중"에서 멈춤 | Actions 로그 확인. 실패 시 상태는 자동 복구되고 알림이 옵니다 |
| 후보 JSON 이 없다는 오류 | 그날 크롤링이 안 돈 것. `gh workflow run "일일 후보 선별"` |
