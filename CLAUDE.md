# CLAUDE.md

## 1. 프로젝트 개요

서핑 뉴스 아티클 URL 하나만 주면, 정해진 디자인 시스템과 카피 규칙에 맞춰 인스타그램 카드뉴스(**표지 이미지 1장 + 캡션**)를 자동으로 생성하는 프로젝트입니다.
브랜드명 **서핑슈**(`@surf.issue`)의 인스타그램 계정용 콘텐츠를 만듭니다.

**(v2)** 예전에는 캐러셀 형태(표지+본문+CTA 여러 장)였지만, 지금은 **표지 슬라이드 1장만** 이미지로 만들고, 기사 정보·전개·CTA는 전부 **캡션(게시글 본문)**에 "미니 브리핑" 형태로 담습니다. 카드 한 장으로 시선을 멈추게 하고, 캡션으로 끝까지 읽고 저장·공유·팔로우하게 만드는 것이 목표입니다.

새 세션에서 작업할 때는 이 파일(`CLAUDE.md`) → `CARDNEWS.md` → `DESIGN.md` 순서로 읽으면 전체 맥락을 파악할 수 있습니다. 매일 여러 RSS 피드에서 후보 아티클을 뽑는 작업은 이보다 앞서 `ARTICLE_CANDIDATE_FILTER.md`를 따릅니다.

| 파일 | 역할 | 성격 |
|---|---|---|
| `ARTICLE_CANDIDATE_FILTER.md` | **어떤 아티클을 고를지** — 매일 RSS 피드에서 후보 5개를 뽑는 선정 기준·처리 로그 규칙 (이 파일보다 앞단계) | 선정 규칙 |
| `CLAUDE.md` (이 파일) | 프로젝트 전체 지도 + 작업 프로세스 | 오케스트레이션 |
| `CARDNEWS.md` | **무엇을 쓸지** — 카드 카피/캡션 브리핑 규칙, 톤, 금지사항 | 콘텐츠 규칙 |
| `DESIGN.md` | **어떻게 보일지** — 색상/폰트/레이아웃 규칙 + 템플릿 사용법 | 디자인 규칙 |
| `templates/` | 위 규칙을 실제로 구현한 실행 가능한 HTML/CSS | 구현체 |
| `.claude/skills/stock-image-search/` | **배경 사진을 어디서 구할지** — 스톡 API 4곳 검색·선택·크레딧 규칙 + 실행 스크립트 | 독립 스킬 |
| `.claude/skills/checking-korean-translation-tone/` | **번역투가 남았는지** — 캡션 문단의 대명사/반복 서술어/wh-질문 나열/수동태 직역 5가지 체크리스트 | 독립 스킬 |
| `ARCHITECTURE.md` | **어디서 무엇이 도는지** — 컴포넌트·흐름·인증 다이어그램 (자동 파이프라인을 손볼 때만 필요) | 인프라 |
| `automation/` | Telegram 승인 봇 · Cloudflare Worker · 러너 스크립트 ([전용 README](automation/README.md)) | 자동화 구현체 |

문서 하나만 보고 처음부터 다시 해석하지 말고, 항상 이 순서(ARTICLE_CANDIDATE_FILTER.md → CLAUDE.md → CARDNEWS.md → DESIGN.md → templates/)로 참고하세요.
**카드 내용을 만드는 작업이라면 `ARCHITECTURE.md`와 `automation/`은 읽지 않아도 됩니다** — 그쪽은 파이프라인 배관이지 콘텐츠 규칙이 아닙니다.

> `DESIGN.md`는 캐러셀 시절(표지/본문/CTA 3종 슬라이드)의 디자인 규칙을 그대로 담고 있으며 현재도 변경되지 않았습니다. 지금 실제로 쓰는 건 그중 **표지 슬라이드(2-1번 섹션) 규칙뿐**이고, 본문·CTA 규칙은 나중에 캐러셀 형식으로 돌아갈 경우를 위해 남아있는 것입니다.

---

## 2. 폴더 구조

```
cardnews-surfing-magazine/
├── .claude/skills/
│   ├── stock-image-search/    # 스톡 사진 검색 스킬 (Unsplash·Pexels·Pixabay·Openverse)
│   │   ├── SKILL.md           #   언제 쓰는지 + 검색어/선택/라이선스 규칙
│   │   ├── scripts/stock_image.py  #   실행 스크립트 (표준 라이브러리만 사용)
│   │   └── references/providers.md #   제공처별 필드·한도·제약 상세
│   └── checking-korean-translation-tone/  # 번역투 검수 스킬
│       └── SKILL.md           #   대명사/반복 서술어/wh-질문/수동태 5가지 체크리스트
├── .github/workflows/     # 자동 파이프라인 (5종) — 상세는 ARCHITECTURE.md 4번
│   ├── daily-candidates.yml  #   매일 07:12 KST 후보 선별 → Telegram 발송
│   ├── produce-card.yml      #   Choose/Recreate 버튼 → 카드 제작
│   ├── finalize-card.yml     #   Upload/Drop 버튼 → 인스타그램 게시(Graph API)·확정·폐기
│   ├── resend-review.yml     #   버튼이 사라진 카드를 다시 발송 (복구용)
│   └── deploy-worker.yml     #   Cloudflare Worker 배포 + 시크릿 동기화
├── automation/            # Telegram 봇 구현 (자세한 건 automation/README.md)
│   ├── core/              #   프로젝트 무관 재사용 레이어 — 다른 프로젝트에 그대로 복사 가능
│   ├── app/               #   이 프로젝트 전용 — 액션·후보 상태·운영 정책(policy.js)
│   ├── worker/            #   Cloudflare Worker 엔트리
│   ├── scripts/           #   러너에서 도는 실행 스크립트 (발송·정책검사·렌더·복구)
│   ├── prompts/           #   Claude 에게 주는 지시서 (워크플로 YAML 과 분리)
│   └── test/              #   node --test 로 도는 단위·통합 테스트
├── .env                   # API 키 (gitignore 됨, .env.example 참고)
├── README.md              # 저장소 첫인상 — 무엇을 만드는 프로젝트인지
├── ARCHITECTURE.md        # 자동 파이프라인 구조·흐름·인증 다이어그램
├── CLAUDE.md              # 이 파일 — 프로젝트 지도 + 작업 프로세스
├── ARTICLE_CANDIDATE_FILTER.md  # 매일 RSS 피드에서 후보 아티클을 뽑는 선정 기준 (CLAUDE.md보다 앞단계)
├── CARDNEWS.md            # 카드뉴스 콘텐츠/카피 제작 지침 (타겟, 톤, 카드 구성 규칙, 캡션 규칙, 금지사항)
├── DESIGN.md              # 디자인 규칙 문서 + templates/ 사용법 (0번 섹션)
├── templates/             # 실제 사용하는 HTML/CSS 템플릿
│   ├── template.css       #   색상·폰트·여백·컴포넌트 스타일의 유일한 기준
│   ├── cover.html         #   ★ 현재 실제로 쓰는 템플릿 (표지: 배지+헤드라인+서브텍스트+태그)
│   ├── body.html          #   (v2에서 미사용) 본문 슬라이드 템플릿 — 캐러셀 형식으로 돌아가면 재사용
│   └── cta.html           #   (v2에서 미사용) CTA 슬라이드 템플릿 — 캐러셀 형식으로 돌아가면 재사용
├── input/                 # 실제 사진을 쓰게 되면 원본 이미지를 여기에 둘 것
│   ├── bgm/               #   릴즈 배경음악. 원본 mp3는 라이선스상 커밋 금지 —
│   │                      #   암호화본(bgm.mp3.gpg)만 커밋하고 암호는 BGM_PASSPHRASE 시크릿에 둔다
│   └── font/Paperlogy-1.000/  # 카드뉴스 한글 폰트 원본(ttf). template.css가 @font-face로 직접 로드
│                          #   (상세: DESIGN.md 0번/4번 섹션)
└── output/
    ├── sample/            # DESIGN.md/템플릿 검증용 고정 샘플 (캐러셀 5장짜리 디자인 회귀 테스트) — 건드리지 말 것
    │   └── card_01.png ~ card_05.png
    ├── candidates/        # ARTICLE_CANDIDATE_FILTER.md 실행 결과 (일자별 후보 목록)
    │   ├── YYYY-MM-DD.md     #   사람이 읽는 요약
    │   └── YYYY-MM-DD.json   #   ★ 자동화가 읽는 상태 파일 (이 파이프라인의 단일 상태 저장소)
    └── cards/             # 실제 아티클 기반으로 생성한 카드뉴스 결과물
        ├── _processed_articles.csv   # 이미 카드로 만든 아티클 URL 추적 로그 (ARTICLE_CANDIDATE_FILTER.md가 제외 판단에 사용)
        ├── card_01.png ~ card_05.png   # (나자레 대백상 아티클 — v1 캐러셀 시절 예시, 참고용으로 남겨둠)
        └── caption.md                 # (위와 동일 세트의 캡션 — v1 형식)
```

**주의**:
- `output/sample/`은 디자인 시스템이 깨지지 않았는지 확인하는 용도의 고정 데모이므로, 실제 카드뉴스 생성 결과와 섞이면 안 됩니다.
- `output/cards/`의 기존 나자레 예시는 **캐러셀(5장) 시절 결과물**입니다. v2(표지 1장) 방식으로 새로 만들 때는 아래 4번 섹션의 출력 위치 규칙(주제별 하위 폴더, 카드 1장 + caption.md)을 따르세요.

---

## 2-1. 두 가지 실행 모드

아래 3번의 제작 프로세스는 **두 경로에서 똑같이 쓰입니다.** 규칙은 하나이고 실행 주체만 다릅니다.

| | 수동 모드 | 자동 모드 |
|---|---|---|
| 언제 | 사람이 Claude Code 세션에서 "이 URL로 만들어줘" | 매일 크론 + Telegram 버튼 |
| 아티클 선택 | 사람이 URL 지정 | `ARTICLE_CANDIDATE_FILTER.md`로 5건 선별 → Telegram에서 Choose |
| 실행 위치 | 로컬 (macOS) | GitHub Actions 러너 (Linux) |
| 검수 | 사람이 직접 확인 | 카드 + 릴즈 미리보기가 Telegram으로 오고 Upload/Recreate/Drop |
| 인스타그램 게시 | 사람이 인스타그램 앱에서 직접 업로드 | Upload 클릭 시 이미지 포스트 + 릴즈를 Instagram Graph API로 자동 게시 (`automation/core/instagram.js`) |
| 처리 로그 | 사람이 직접 기록 (Step 9) | 게시 성공 시 자동 기록 |

**자동 모드에서 달라지는 점은 아래 5가지뿐입니다:**

1. **렌더링 명령** — Step 6의 macOS 크롬 경로는 리눅스에서 동작하지 않습니다.
   `node automation/scripts/render-card.mjs <html> <png>`를 쓰면 플랫폼을 알아서 찾습니다.
   (수동 모드에서도 이 스크립트를 쓸 수 있고, 그 편이 안전합니다.)
2. **AI 이미지 생성 금지** — 무인 실행이라 비용 승인을 받을 수 없습니다.
   원문 이미지 → `stock-image-search` 스킬 → `template.css` 프리셋 배경 순으로만 폴백합니다.
3. **처리 로그를 건드리지 않음** — `_processed_articles.csv`는 사용자가 Upload를 눌러
   확정했을 때 `automation/scripts/finalize.mjs`가 기록합니다. 제작 단계에서 미리 쓰면
   폐기한 기사까지 "제작됨"으로 남아 다시 후보에 오르지 못합니다.
4. **Upload = 실제 게시** — 자동 모드의 Upload는 확정 기록뿐 아니라 Instagram Graph API로
   `@surf.issue`에 실제로 게시까지 끝냅니다 (게시 실패 시 상태는 `review`로 남아 재시도 가능).
   API 자격은 이미 설정되어 있고 2026-07-29에 실제 게시로 검증까지 끝났습니다.
   토큰 갱신 절차·다음 만료 시점은 `automation/README.md` 2-6절 참고.

5. **릴즈도 함께 만든다** — 카드 PNG를 만든 뒤 `automation/scripts/make-reel.mjs`가
   같은 이미지를 15초 영상(1080x1920, 블러 배경 + 배경음악)으로 만들어
   `output/cards/<slug>/reel.mp4`에 저장하고, 검수 때 미리보기로 함께 보냅니다.
   Upload를 누르면 이미지 포스트와 릴즈가 **둘 다** 게시됩니다(릴즈는 그리드에
   노출하지 않음). 이 단계는 자동 모드 전용이며, 수동 모드에서는 만들지 않습니다.

자동 모드의 구조·인증·상태 기계는 [ARCHITECTURE.md](ARCHITECTURE.md)에 있습니다.
파이프라인 자체를 손볼 게 아니라면 읽지 않아도 됩니다.

---

## 3. 카드뉴스 제작 프로세스 (단계별, v2: 표지 1장 + 캡션)

### Step 0. 지침 확인
- `CARDNEWS.md`에서 타겟/브랜드명/IG 아이디/카드 구성 규칙/캡션 규칙/텍스트 규칙/금지사항을 확인
- `DESIGN.md`의 0번 섹션(`templates/` 사용 안내) + 2-1번 섹션(표지 슬라이드 규칙)을 확인

### Step 1. 아티클 확보
0. **먼저 확인**: 이 아티클을 `ARTICLE_CANDIDATE_FILTER.md`의 RSS 피드 목록에서 가져왔다면, 그 피드의 원본 XML에 본문 전문이 있는지 확인하세요(피드마다 `content:encoded` 또는 `description` 필드 — 상세는 `ARTICLE_CANDIDATE_FILTER.md` 1번 섹션 표 참고). 있다면 원문 사이트가 403으로 막혀도 그걸로 바로 사실관계·인용문을 확보할 수 있습니다(실전 확인됨). 단 Stab Mag처럼 `premium` 태그나 허브형 포스트인 경우 본문이 있어도 실제 기사가 아닐 수 있으니 1번 섹션의 주의사항을 먼저 확인하세요. 이 경우 아래 1~3번을 건너뛰어도 됩니다. 본문 전문이 없는 피드라면 아래 절차를 그대로 따르세요.
1. `WebFetch`로 원문 URL을 직접 시도
2. 403/차단 등으로 실패하면 `WebSearch`로 같은 기사의 미러/재게재 사이트(예: Yahoo News 등 대형 아그리게이터)를 찾아 `WebFetch`로 재시도
3. 그래도 막히면 `WebSearch` 결과 스니펫만으로 핵심 사실을 취합
4. **여러 출처가 있다면 교차 확인**해서 사실관계(날짜, 장소, 수치, 인용문)를 검증할 것. 인용문은 반드시 원문 그대로 사용하고, 확인되지 않은 사실을 단정적으로 바꿔 쓰지 말 것 (예: "~가능성이 있다"는 인용은 그대로 유지)

### Step 2. 핵심 포인트 추출 & 역할 분리
아티클에서 확보한 사실들을 두 곳에 나눠 담을 것을 염두에 두고 정리합니다:
- **카드(표지) 몫**: 기사 전체를 관통하는 단 하나의 후킹 헤드라인 + 짧은 서브텍스트. `CARDNEWS.md`의 카드(표지) 구성 규칙 적용 — 공감/경고/반전/현실폭로/비교/결과암시/궁금증 중 최소 1개, "그래서 뭐인데?" 유발
- **캡션 몫**: 나머지 모든 정보(육하원칙, 인용문, 의미/맥락) — `CARDNEWS.md`의 캡션 문구 규칙(미니 브리핑 포맷)에 맞춰 정리

### Step 3. 카피라이팅

**작성은 반드시 2단계로 진행합니다.** 한 번에 최종 문장을 쓰면 원문 구조가 그대로 남습니다.

**1차 — 사실 정리 (직역 수준 OK)**
아티클에서 확보한 사실을 육하원칙대로 나열합니다. 이 단계는 정확성이 우선이고 자연스러움은 신경 쓰지 않습니다.

**2차 — 리라이트 (여기서 번역투를 제거)**
1차 결과를 보지 않고 다시 쓴다는 마음으로, "이 사건을 한 번도 원문으로 안 보고 취재한 한국 스포츠 기자가 처음부터 한국어로 썼다면 어떻게 썼을까"를 기준으로 전체 문장을 재구성합니다. 이때 아래 3가지를 반드시 점검하세요 (`CARDNEWS.md` 번역 톤 항목 참고):
- 대명사(그/그녀/그것)를 실명·구체명사로 바꿨는가
- 영어식 wh-질문 나열을 한국어 압축 질문으로 바꿨는가 (예: "어디서, 누가" → "주최는?")
- 인용/설명 문장이 실제 사람이 말하듯 자연스러운가, 아니면 원문 문장 구조를 그대로 옮긴 대조문인가

**카드 카피** (`cover.html` 하나만 채움):
- 배지(`ISSUE` 등 1~3단어) + 헤드라인(2줄 기본, 안 들어가면 최대 3줄까지 허용) + 서브텍스트(1줄, 간결하게 압축) + 태그
- `CARDNEWS.md` 텍스트 규칙 적용: 짧고 강한 문장, 단정형, 약한 표현 금지(원문 인용구는 예외), 문단형 금지, 과한 이모지/광고 문구 금지
- 헤드라인은 위 2단계 리라이트 대상에서 제외 가능 — 헤드라인 유형 10가지의 의도적 대조/선언 리듬은 유지해도 됩니다.
- 카드 안에 팔로우 유도 문구나 계정 아이디를 억지로 넣지 않음 (워터마크로 충분)

**캡션 카피** (`caption.md`, 미니 브리핑 포맷 — `CARDNEWS.md` 캡션 문구 규칙 그대로):
1. 첫 줄: 카드 헤드라인을 대괄호로 감싸 그대로 삽입 (예: `[캐나다 최초 웨이브풀 2027년 완공 예정 - 7 에이커 규모, 시간당 파도 최대 1000개]`)
2. 둘째 줄: 궁금증 유발, 헤드라인과 자연스럽게 이어지는 도입
3. 브리핑 본문: **3문단 이내, 한 문단 2~3줄 이내**로 압축. 육하원칙 중 기사에 실제 있는 것만, 짧은 줄 단위로, 인용문은 원문 그대로 + 출처, 의미/이례성 한두 줄 요약. **이 부분이 2차 리라이트의 핵심 적용 대상입니다** — 소제목/질문은 압축형으로, 인물은 실명으로.
4. 마지막 줄: 댓글 유도·저장 유도 없이 고정 문구 `최신 서핑 뉴스를 전달해드립니다 @surf.issue 📰`
5. 출처: 원문 기사 매체명 & 날짜 (예: `Surfer Magazine, 2026.07.23`)
6. 해시태그: 대형(#서핑 #surfing) → 니치 → 브랜드(#서핑슈) 순서

(고정 Footer는 더 이상 사용하지 않음 — `CARDNEWS.md`에서 제거됨)

### Step 4. 이미지 소싱 (표지 카드 1장분)
`CARDNEWS.md`가 지정한 우선순위: (0) 사용자가 직접 첨부한 사진(있을 때만) → (1) 아티클 자체 이미지(저작권 안전 시) → (2) 무료 스톡 사진(Unsplash/Pexels 등) → (3) AI 이미지 생성(`gemini-imagen` MCP).
실전에서 확인된 현실적 제약과 대응:

| 방법 | 실전 결과 | 대응 |
|---|---|---|
| 0. 사용자 첨부 사진 | 자동 모드에서 Telegram Recreate 답장에 사진을 첨부하면, 러너가 `output/cards/<주제-slug>/user_photo.*`로 미리 받아둔다(`prepare-produce.mjs`) | 이 파일이 있으면 저작권 걱정이 없으므로 **무조건 최우선 사용** — 스톡 검색이나 프리셋으로 대체하지 말 것 |
| 1. 원문 이미지 다운로드 | 뉴스 사이트가 크롤링을 막는 경우가 많음 (403) | 안 되면 바로 2번으로 |
| 2. 무료 스톡 사진 검색 | **`stock-image-search` 스킬**을 호출한다. Unsplash·Pexels·Pixabay·Openverse 4곳을 한 번에 검색해서 점수순으로 고르고, 다운로드와 크레딧(`credit.json`) 정리까지 끝낸다. 제공처별 한도·라이선스 제약·검색어 만드는 법은 전부 스킬 문서에 있으므로 여기서 반복하지 않는다 | 결과물은 `output/cards/<주제-slug>/bg.jpg` + `credit.json`. `--dry-run`으로 후보를 먼저 확인하고, 점수만 믿지 말고 실제 사진을 눈으로 볼 것. 마땅한 사진이 없으면 3번 또는 4번으로 |
| 3. AI 이미지 생성 (`gemini-imagen` MCP, 또는 연결 안 돼 있으면 Higgsfield `generate_image`) | 세션에 MCP가 연결 안 돼 있거나(`ListMcpResourcesTool`로 확인), Higgsfield는 유료 크레딧 소모 — 플랜 제한이나 크레딧 0으로 실패할 수 있음 | 생성 전 비용을 먼저 확인하고, **비용이 드는 생성은 사용자에게 반드시 먼저 물어보고 승인받은 뒤 진행** (자동 진행 금지) |
| 4. (기본 폴백) `templates/template.css`의 프리셋 배경 | 무료, 즉시 사용 가능, 이미 브랜드 톤으로 검증됨 | 위 1~3이 막히거나 사용자가 원치 않으면 이 방식으로 진행. `bg-ocean-blue` / `bg-sunset` / `bg-dusk-red` / `bg-night-teal` 중 헤드라인 분위기에 맞게 선택 |

**이미지 소싱 방법을 바꿔야 하는 상황(MCP 미연결, 플랜 제한, 크레딧 부족, 검색 실패 등)이 생기면 임의로 다음 방법으로 넘어가지 말고, 반드시 `AskUserQuestion`으로 사용자에게 확인**하세요.

### Step 5. 템플릿에 콘텐츠 채우기
1. `templates/cover.html`, `templates/template.css`만 작업 디렉토리에 복사 (`body.html`, `cta.html`은 v2에서 사용하지 않음)
2. 아래와 같이 Python으로 `{{PLACEHOLDER}}` 치환:

```python
def fill(path, mapping, out):
    s = open(path, encoding='utf-8').read()
    for k, v in mapping.items():
        s = s.replace('{{'+k+'}}', v)
    open(out, 'w', encoding='utf-8').write(s)

fill('cover.html', {
    'BG_CLASS': 'bg-ocean-blue',
    'BADGE': 'ISSUE',
    'HEADLINE': '헤드라인 1줄<br>헤드라인 2줄',
    'SUBTEXT': '서브텍스트 한 줄',
    'TAGS': '#surfing&nbsp;&nbsp;#news',
}, 'card_01.html')
```

`cover.html` 상단 HTML 주석에 채워야 할 placeholder 목록과 규칙이 적혀 있으니 그대로 따르면 됩니다.

**실제 사진(스톡/AI 생성)을 배경으로 쓸 때**는 프리셋 클래스 대신 인라인 스타일로 바꾸고, 사진과 겹치는 장식 SVG(`fin-deco`, `waves`)를 삭제합니다. 사진은 렌더링할 html과 같은 폴더에 두고 상대경로로 참조:

```python
s = open('cover.html', encoding='utf-8').read()
s = s.replace('class="slide {{BG_CLASS}}"',
              'class="slide" style="background-image:url(\'bg.jpg\');'
              'background-size:cover; background-position:center;"')
import re
s = re.sub(r'<!-- 장식용.*?</svg>\n', '', s, flags=re.S)  # fin-deco / waves 제거
```

`.overlay-gradient`(하단 60% 다크 그라데이션)는 사진 위에서도 그대로 두어야 헤드라인 가독성이 유지됩니다. 사진이 밝아 텍스트가 묻히면 폰트가 아니라 사진을 바꾸세요.

스톡 사진을 썼다면 `credit.json`의 `caption_line`(예: `Photo: Jeff Sheldon / Unsplash`)을 `caption.md` 출처란에 기사 출처와 함께 표기합니다 — Unsplash API 가이드라인상 필수입니다.

### Step 6. 1080x1350 PNG로 렌더링 (1장)
`template.css`는 채워 넣은 html과 같은 폴더에 두고(상대경로 `<link>` 유지):

```bash
node automation/scripts/render-card.mjs card_01.html output/cards/<주제-slug>/card_01.png
```

이 스크립트가 플랫폼별 크롬 경로를 알아서 찾고, 규격(1080x1350)과 필요한 플래그를 고정합니다.
`CHROME_BIN` 환경변수가 있으면 그걸 최우선으로 씁니다.

크롬을 직접 부르고 싶다면 아래와 같지만, **경로가 OS마다 다르므로 위 스크립트를 권장합니다**
(자동 모드의 리눅스 러너에서는 아래 macOS 경로가 동작하지 않습니다):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1080,1350 \
  --screenshot="output/cards/<주제-slug>/card_01.png" "file://$(pwd)/card_01.html"
```

### Step 7. 캡션 작성
`output/cards/<주제-slug>/caption.md`에 Step 3의 "캡션 카피" 규칙대로 작성.

### Step 8. 검수
`Read` 도구로 렌더링된 PNG를 열어 다음을 확인:
- 좌측 정렬이 지켜졌는지 (표지는 항상 좌측 정렬)
- 텍스트가 안전 영역(좌우 60px) 밖으로 넘치지 않는지
- 우측 상단 워터마크(`@surf.issue`)가 있는지
- 헤드라인이 3줄을 넘기지 않는지 (2줄이 기본, 안 들어갈 때만 3줄까지 허용 — 그래도 넘치면 폰트를 줄이지 말고 문장을 줄일 것. `DESIGN.md` 원칙)
- `caption.md`가 미니 브리핑 포맷([헤드라인] → 도입 → 브리핑 본문(3문단 이내) → 고정 마무리 문구 → 출처 → 해시태그)을 갖추고 있는지

**번역투 자가 점검 — 눈으로 훑지 말고 반드시 `checking-korean-translation-tone` 스킬을 호출할 것.**
캡션 문단마다 대명사→실명 치환, "~라고 말했다" 반복, 영어식 wh-질문 나열, 수동태 직역 등
5가지를 점검하는 체크리스트가 그 스킬 안에 있다 (`CARDNEWS.md` 번역 톤 항목의 실행판).
하나라도 걸리면 그 문장만 국소적으로 고치지 말고, Step 3의 2차 리라이트를 그 문단에 한해
다시 수행할 것 (부분 수정은 앞뒤 문장과 톤이 어긋나기 쉬움).

### Step 9. 처리 로그 갱신
`ARTICLE_CANDIDATE_FILTER.md`가 매일 후보를 뽑을 때 "이미 카드 생성된 아티클"을 걸러내려면 아래 로그가 최신 상태여야 합니다. 카드 완성 직후 `output/cards/_processed_articles.csv`에 한 줄을 추가하세요 (컬럼: `date_produced,feed_source,article_url,slug,status`, `status`는 항상 `produced`). 후보로만 뽑히고 제작까지 안 간 아티클은 여기에 적지 않습니다.

> **자동 모드에서는 이 단계를 직접 하지 마세요.** 사용자가 Telegram에서 `🚀 Upload`를 누르면
> `automation/scripts/finalize.mjs`가 Instagram Graph API로 실제 게시한 뒤, **게시가
> 성공했을 때만** 기록합니다. 제작 시점에 미리 적으면 검수에서 폐기(`🗑 Drop`)한
> 기사까지 "제작됨"으로 남아 다시 후보에 오르지 못합니다.
> 즉 **"만들었다"가 아니라 "실제로 게시됐다"가 기록 시점**입니다.

---

## 4. 새로운 주제/아티클로 카드뉴스를 만들 때

다음 세션에서 아래처럼만 요청받으면, 이 문서의 프로세스를 그대로 실행하면 됩니다:

> "다음 URL 아티클로 카드뉴스 만들어줘: `<새 아티클 URL>`"

**고정값 (매번 다시 묻지 않아도 됨, `CARDNEWS.md` 기본 조건에 명시됨):**
- 타겟: 서핑을 취미로 하는 20-50대 한국인 남녀
- 브랜드명: 서핑슈 / 인스타그램: `@surf.issue`
- 카드 구성: 표지 슬라이드 1장만 (본문/CTA 슬라이드 없음)
- 디자인: `DESIGN.md` 중 표지 슬라이드 규칙 + `templates/cover.html` + `template.css` 그대로 사용

**매번 새로 결정해야 하는 것:**
- 아티클에서 카드 헤드라인 1개 + 캡션 브리핑 내용 전체
- 배경 프리셋 선택 (4종 중 분위기에 맞게, 또는 실제 이미지/AI 생성 여부는 Step 4 절차대로 사용자 확인)

**체크리스트:**
1. [ ] `CARDNEWS.md`, `DESIGN.md` 재확인 (규칙이 바뀌었을 수 있으니 매번 최신 버전 확인)
2. [ ] 아티클 fetch (Step 1 절차, 막히면 미러 사이트 → 검색 스니펫 순으로 폴백)
3. [ ] 카드 헤드라인 / 캡션 브리핑 내용 분리 정리 (Step 2)
4. [ ] 카드 카피 + 캡션 카피 작성 (Step 3)
5. [ ] 이미지 소싱 — 비용이 드는 방법(AI 생성)은 반드시 사용자 확인 후 진행 (Step 4)
6. [ ] `templates/cover.html` + `template.css` 복사 + placeholder 치환 (Step 5)
7. [ ] 헤드리스 크롬으로 렌더링 (Step 6)
8. [ ] `output/cards/<주제-slug>/`에 결과물 저장 — **주제별 하위 폴더를 만들어 이전 주제 결과물을 덮어쓰지 말 것**
9. [ ] `caption.md` 작성 (Step 7)
10. [ ] 렌더링 결과 + 캡션 육안 검수 (Step 8)
11. [ ] `output/cards/_processed_articles.csv`에 완료 건 기록 (Step 9)

**출력 위치 규칙:**
- 카드 이미지: `output/cards/<주제-slug>/card_01.png` (1장만)
- 캡션: `output/cards/<주제-slug>/caption.md`
- 릴즈 영상: `output/cards/<주제-slug>/reel.mp4` (자동 모드에서만 생성)
- 매일 후보 선정 결과(`ARTICLE_CANDIDATE_FILTER.md` 실행 산출물): `output/candidates/YYYY-MM-DD.md`
