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
검수 (🚀 Upload / 🔁 Recreate / 🗑 Drop)
      │  Upload
      ▼
Instagram Graph API ── 실제 @surf.issue 계정에 게시
      │
      ▼
git 저장소가 곧 아카이브 (output/cards/<slug>/)
```

> 컴포넌트·데이터 흐름·인증·상태 기계를 그림으로 본 것은 [../ARCHITECTURE.md](../ARCHITECTURE.md)에 있습니다.

왜 이렇게 나눴는가:

- **Telegram 은 웹훅이 몇 초 안에 200 을 안 주면 같은 업데이트를 재전송합니다.**
  카드 제작은 수 분이 걸리므로 웹훅에서 직접 하면 카드가 여러 장 만들어집니다.
- **서버리스 웹훅은 헤드리스 크롬을 못 돌립니다.** 렌더링에는 러너가 필요합니다.
- **워커를 무상태로 유지하려고** 상태 저장소(KV·DB)를 쓰지 않았습니다.
  후보 정보는 `output/candidates/YYYY-MM-DD.json` 에 있고 git 에 커밋됩니다.

### 폴더

| 경로 | 성격 |
|---|---|
| `core/` | **프로젝트 무관 · 그대로 복사해 재사용** — Telegram 클라이언트, Instagram Graph API 클라이언트, 버튼 인코딩, 라우터, 인증, GitHub dispatch |
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
| `IG_ACCESS_TOKEN` | 2-6 에서 발급한 장기 액세스 토큰 |
| `IG_USER_ID` | 2-6 에서 확인한 Instagram 비즈니스 계정 ID |

```bash
# 값은 화면에 표시되지 않게 입력됩니다.
gh secret set CLAUDE_CODE_OAUTH_TOKEN
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
gh secret set REPO_DISPATCH_TOKEN
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set IG_ACCESS_TOKEN
gh secret set IG_USER_ID

# 웹훅 시크릿은 즉석에서 만들어 넣습니다.
openssl rand -hex 32 | gh secret set TELEGRAM_WEBHOOK_SECRET
```

> `wrangler.toml` 의 `GITHUB_REPO` 값이 실제 저장소와 맞는지 확인하세요.

### 2-6. Instagram Graph API 설정 (자동 게시용)

`🚀 Upload` 를 누르면 `automation/scripts/finalize.mjs` 가 이 자격으로 실제
`@surf.issue` 계정에 게시합니다 ([../core/instagram.js](../core/instagram.js)).
아래는 1회성 설정이며, 사람이 Meta/Facebook 화면에서 직접 해야 합니다.

1. `@surf.issue` 인스타그램 계정을 **비즈니스 또는 크리에이터 계정**으로 전환하고,
   **Facebook 페이지**에 연결합니다 (인스타그램 앱 → 설정 → 계정 유형 전환,
   또는 Meta Business Suite → 설정 → 계정에서 연결해도 동일합니다).
2. [developers.facebook.com](https://developers.facebook.com) 에서 Meta 앱을 만들고
   **Instagram API 유스케이스**를 추가합니다. 화면에 "Instagram API with Facebook Login"과
   "Instagram API with Instagram Login" 두 갈래가 보이면, 반드시 **Facebook Login** 쪽을
   선택합니다 (Instagram Login 쪽은 페이지 연결 없는 별도 방식이라 이 구조에 안 맞습니다).
   이 앱은 Business Suite 의 비즈니스 포트폴리오에 연결되어 있어야 합니다.
3. 해당 유스케이스의 "Permissions and features" 에서 아래 5개 권한을 각각 **Add**:
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`, `business_management`.
   자기 계정에만 게시하는 용도라 **App Review 는 필요 없습니다** ("Ready for testing" 상태로 충분).
4. [Graph API Explorer](https://developers.facebook.com/tools/explorer/) 에서 방금 만든 앱을 선택하고
   **"Get User Access Token"** 으로 토큰을 발급합니다 (Get App Token 이나 Get Page Access Token 아님).
   권한 동의 화면 다음에 **어떤 페이지를 허용할지 선택하는 화면이 따로 뜨는데, 여기서
   반드시 페이지를 선택**해야 합니다 — 건너뛰면 이후 `/me/accounts` 호출이 빈 배열을 반환합니다.
5. 발급된 토큰을 장기 토큰으로 교환하고, 연결된 페이지·IG 계정 ID를 확인합니다:

   ```bash
   # 1) 장기(60일) 사용자 토큰으로 교환 (App ID·Secret 은 앱 대시보드 → Settings → Basic)
   curl -s "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<위에서 발급받은 토큰>"

   # 2) 관리 중인 페이지 목록 (access_token 이 곧 IG_ACCESS_TOKEN — 페이지 토큰은 만료되지 않음)
   curl -s "https://graph.facebook.com/v21.0/me/accounts?access_token=<장기 사용자 토큰>"

   # 3) 그 페이지에 연결된 IG 계정 ID (instagram_business_account.id 가 곧 IG_USER_ID)
   curl -s "https://graph.facebook.com/v21.0/<페이지 ID>?fields=instagram_business_account&access_token=<페이지 access_token>"
   ```

6. 위에서 얻은 페이지 access_token과 IG 계정 ID를 2-5 의 `IG_ACCESS_TOKEN`, `IG_USER_ID` 로 등록합니다.

> **60일마다 만료됩니다.** 자동 갱신은 구현하지 않았으므로, 만료 전에 4~6번 과정을
> 반복해 토큰을 다시 발급·등록해야 합니다. 만료된 채로 Upload 를 누르면 게시가
> 실패하고 후보는 `review` 상태로 남아 재시도할 수 있습니다 (아래 3번 섹션 참고).
>
> 현재 등록된 토큰은 **2026-07-29** 에 발급했습니다 — **2026-09-27** 전에 갱신하세요
> (실제로 이 날짜에 카드 한 장을 진짜로 게시해 전체 흐름을 검증했습니다).

### 2-7. 배포

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
   - Recreate 는 "어디를 고칠지" 되묻습니다. 그 메시지에 **답장**으로 적으세요
     (일반 메시지로 보내면 어떤 카드에 대한 요청인지 알 수 없어 무시됩니다).
     참고할 사진이 있으면 답장에 사진을 첨부해도 됩니다 — 문구(캡션)와 사진 둘 다
     읽고, 첨부한 사진은 배경 이미지로 최우선 사용됩니다. 문구만 있어도, 사진만
     있어도, 둘 다 있어도 됩니다. 빈 답장(문구도 사진도 없음)을 보내면 버튼을
     다시 찾을 필요 없이 봇이 같은 질문을 다시 보내주니 그 메시지에 답장하면 됩니다.
   - Upload 는 실제로 `@surf.issue` 에 게시한 뒤 `_processed_articles.csv` 에 기록해
     다음 날 중복 추천을 막습니다. 게시가 실패하면 아무것도 기록되지 않고 후보는
     `review` 상태 그대로 남습니다 — 다시 Upload 를 시도할 수 있습니다.
   - 재생성 횟수에 제한은 없습니다. 3회차부터 안내 메시지가 함께 옵니다.

> **버튼은 한 번 누르면 사라집니다** (중복 실행 방지). 실수로 눌렀거나 요청이 거부되어
> 버튼만 잃었다면 「검수 재발송」으로 되살립니다.

수동 실행:

```bash
gh workflow run "일일 후보 선별"
gh workflow run "카드뉴스 제작" -f date=2026-07-28 -f index=2
gh workflow run "카드뉴스 제작" -f date=2026-07-28 -f index=2 -f feedback="헤드라인을 더 세게"
gh workflow run "확정 / 폐기" -f date=2026-07-28 -f index=2 -f decision=uploaded
gh workflow run "검수 재발송" -f date=2026-07-28 -f index=2
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
| Upload 눌렀는데 게시 실패 알림 | `IG_ACCESS_TOKEN` 만료(60일) 여부 먼저 확인 — 2-6 을 다시 진행해 재발급 |
