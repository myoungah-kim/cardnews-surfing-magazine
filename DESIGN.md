# 카드뉴스 디자인 문서

레퍼런스: sports.daum 인스타그램 카드뉴스 스타일 (표지 슬라이드 + 본문 슬라이드) / CTA 슬라이드는 트립고잉(@_tripgoing) 팔로우 유도 카드뉴스 스타일 참고

> ⚠️ 이 문서 하나로 디자인 규칙과 실제 사용법을 모두 확인할 수 있습니다. 카드뉴스를 새로 만들 때마다
> 이 문서를 다시 해석해서 코드를 처음부터 새로 짜지 말고, 아래 0번 섹션 안내에 따라 `templates/` 폴더의
> 파일을 그대로 복사해 placeholder만 채우세요. 디자인 규칙 자체를 바꿔야 한다면 이 문서(1~10번 섹션)를
> 먼저 수정한 뒤 `templates/template.css`에 반영하세요.

---

## 0. 템플릿 사용 안내

`templates/` 폴더에는 아래 규칙들을 그대로 구현해 둔 **실행 가능한 HTML/CSS 템플릿**이 있습니다.
카드뉴스를 생성할 때는 이 폴더의 파일을 복사해서 placeholder만 채우는 방식으로 진행하세요.

### 파일 구성

| 파일 | 용도 |
|---|---|
| `templates/template.css` | 색상·폰트·여백·컴포넌트 스타일의 유일한 기준. 모든 슬라이드가 공유 |
| `templates/cover.html` | 표지 슬라이드 (캐러셀 1번째 장, 배지 있음) — 2-1번 섹션 |
| `templates/body.html` | 본문 슬라이드 (캐러셀 2~N번째 장, 필요한 만큼 복사해서 사용) — 2-2번 섹션 |
| `templates/cta.html` | CTA/팔로우 유도 슬라이드 (캐러셀 마지막 장, 유일하게 중앙 정렬) — 9번 섹션 |

각 `.html` 파일 상단에 HTML 주석으로 채워야 할 `{{PLACEHOLDER}}` 목록과 규칙(줄 수 제한, 정렬 등)이
적혀 있습니다. 실제로 편집할 때는 그 주석만 봐도 충분합니다.

### 사용 절차

1. 만들 슬라이드 수만큼 `cover.html` 1개 + `body.html` N개(복사) + `cta.html` 1개를 작업 폴더에 준비
2. 각 파일의 `{{...}}` placeholder를 실제 문구로 치환 (직접 편집하거나 스크립트로 치환)
3. `template.css`는 그대로 두고 함께 배치 (상대 경로 `<link rel="stylesheet" href="template.css">` 유지)
4. 아래 명령으로 1080x1350 PNG로 캡처

```bash
google-chrome --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1080,1350 \
  --screenshot="output/sample/card_01.png" "file://$(pwd)/cover.html"
```

파일마다 `--screenshot` 경로와 카드 번호만 바꿔서 반복 실행하면 됩니다.

### 배경(사진) 다루기

아직 실사 이미지가 없는 상태라, `template.css`에 4가지 프리셋 그라데이션이 미리 정의되어 있습니다:

- `bg-ocean-blue` / `bg-sunset` / `bg-dusk-red` / `bg-night-teal`

`<div class="slide {{BG_CLASS}}">`처럼 클래스명으로 지정합니다. **실제 사진이 생기면** 클래스 대신
아래처럼 인라인 스타일로 교체하세요 (그 경우 `.waves`, `.fin-deco` 같은 장식용 SVG는 지우는 것을 권장):

```html
<div class="slide" style="background-image:url('사진경로.jpg'); background-size:cover; background-position:center;">
```

### 지켜야 할 규칙 (템플릿 구조 자체가 이미 지키고 있는 것들)

- 색상·폰트·크기·여백은 `template.css`에서만 정의됩니다. 개별 슬라이드 HTML에서 새로 값을 만들지 마세요.
- 표지·본문 슬라이드는 좌측 정렬 고정, CTA 슬라이드만 중앙 정렬.
- 우측 상단 워터마크(`@surf.issue` + 로고)는 세 템플릿 모두에 이미 포함되어 있으므로 지우지 마세요.
- `template.css`를 수정해야 할 만큼 디자인을 바꾸고 싶다면, **먼저 이 문서(DESIGN.md)를 수정**하고 그 다음
  `templates/template.css`에 반영하세요 (문서와 실제 결과물이 어긋나지 않도록).
- `template.css`는 `@font-face`로 `input/font/Paperlogy-1.000/`의 ttf 파일을 상대경로(`../../../`)로
  직접 로드합니다. 이 경로는 렌더링 시점에 `template.css`가 항상 `output/cards/<주제-slug>/`
  (레포 루트에서 3단계 아래)에 있다는 전제를 깔고 있으므로, `templates/` 폴더 안에서 이 파일을
  직접 렌더링하면 폰트가 폴백으로 표시됩니다 — 반드시 복사한 뒤 렌더링하세요.

### 검증 이력

`output/sample/card_01.png` ~ `card_05.png`는 이 템플릿에 실제 콘텐츠를 채워 넣어 렌더링한 결과이며,
템플릿과 결과물이 1:1로 일치함을 확인했습니다.

---

## 1. 캔버스 규격

| 항목 | 값 |
|---|---|
| 비율 | 4:5 (세로형) |
| 사이즈 | 1080 x 1350px |
| 슬라이드 구성 | 표지 1장 + 본문 N장 + CTA(팔로우 유도) 1장 |

---

## 2. 레이아웃 구조

### 2-1. 표지 슬라이드 (커버)
```
┌─────────────────────────┐
│                         │
│      사진 (전체 배경)      │
│                         │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← 하단 다크 그라데이션
│ [배지: 카테고리]          │   (사진 위에 직접 오버레이,
│ 헤드라인 1줄               │    별도 블록/solid 배경 없음)
│ 헤드라인 2줄               │
│ 서브텍스트                │
│ (태그)                   │
└─────────────────────────┘
```
- **(v3) 별도 텍스트 블록을 사용하지 않는다.** 사진이 캔버스 전체(100%)를 채우고, 본문 슬라이드와 동일한 하단 다크 그라데이션(`.overlay-gradient`, 3번 섹션 참고)을 그 위에 얹어 가독성을 확보한다 (기존 v2의 검정 solid 텍스트 블록 방식은 폐기)
- 배지·헤드라인·서브텍스트·태그는 모두 그라데이션 위에 직접 배치하며, 본문 슬라이드와 동일하게 하단 기준 `bottom: 60px`에 앵커링한다
- 배지는 텍스트 그룹 맨 위(헤드라인 바로 위)에 위치 — 표지 슬라이드에만 존재하며, 본문 슬라이드와 구분되는 유일한 차이점
- 서브텍스트는 가급적 1줄 유지 (부가 설명은 간결하게 압축, 상세 내용은 본문 슬라이드에서 전달)

### 2-2. 본문 슬라이드
```
┌─────────────────────────┐
│                         │
│      사진 (전체 배경)      │
│                         │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← 하단 다크 그라데이션
│ 헤드라인                  │   (사진 위에 직접 오버레이)
│ 서브 문장(선택)            │
└─────────────────────────┘
```
- 별도 텍스트 블록 없이, 사진 하단에 그라데이션을 깔고 그 위에 바로 텍스트
- 배지 없음 (배지는 표지 전용)
- **서브 문장은 보통 이미지 출처 표기용으로 쓰이므로**, 헤드라인은 표준 크기(64~72px)를 유지하되 서브 문장만 훨씬 작은 캡션 크기로 표시 (4번 타이포그래피 표 참고)

### 2-3. CTA(팔로우 유도) 슬라이드 — 마지막 페이지
```
┌─────────────────────────┐
│      [워드마크 로고]       │ ← 중앙 정렬
│                         │
│                         │
│     서브 헤드라인 1줄       │ ← 중앙 정렬
│   '브랜드명' 를 팔로우하세요  │   (브랜드명 강조 하이라이트)
│                         │
│  ╭─────────────────────╮ │
│  │ (◎) @handle  [팔로우] │ │ ← 흰색 필(pill) 카드, 콘텐츠 너비만큼만
│  ╰─────────────────────╯ │
│                         │
│   - 서브 안내 문구 -       │ ← 중앙 정렬
│                         │
│      [워터마크 로고]       │ ← 하단 중앙, 반투명
└─────────────────────────┘
```
- 유일하게 **중앙 정렬**을 사용하는 슬라이드 (표지/본문은 좌측 정렬 고정, CTA는 예외)
- 배경은 사진 전체에 균일한 반투명 검정 딤(dim) 처리 (본문 슬라이드처럼 하단 그라데이션만 까는 것이 아니라 전체 프레임에 적용)
- 핵심 요소는 실제 인스타그램 프로필 팔로우 버튼을 모사한 **팔로우 칩(pill) UI**: 그라데이션 링 프로필 아바타 + `@handle` + 파란색 팔로우 버튼(+커서 아이콘)으로 구성되며, 콘텐츠 길이에 맞춰 폭이 자동으로 줄어드는 **fit-content 방식**을 사용 (고정 폭으로 늘리면 좌우 여백이 불균형해짐)
- 상세 스펙은 9번 섹션 참고

---

## 3. 컬러 팔레트

> 가독성 개선(v2): 국내 인기 인스타그램 뉴스 카드뉴스 계정(방송사 뉴스·뉴스레터 계열)들이 공통으로 쓰는 "굵은 고딕 + 저채도 사진 대비 확보" 원칙을 반영해 서브텍스트 명도와 오버레이 대비를 상향했습니다.

| 용도 | 컬러 코드 | 비고 |
|---|---|---|
| 하단 오버레이 (표지 + 본문 공통) | `rgba(0,0,0,0) → rgba(0,0,0,0.5) 40% → rgba(0,0,0,0.92) 100%` | 3-stop 세로 그라데이션, 사진 하단 55~60% 구간까지 확장. **(v3) 표지 슬라이드도 별도 solid 블록 대신 이 오버레이를 그대로 재사용** |
| 헤드라인 텍스트 | `#FFFFFF` | + text-shadow로 사진 위 대비 보강 |
| 서브텍스트 | `#EDEDED` | 기존 `#D8D8D8` 대비 명도 상향 (회색이 흐려 보이는 문제 개선) |
| 배지 배경 | `#4A6CF7` (선명한 블루) | pill 형태 |
| 배지 텍스트 | `#FFFFFF` | |
| 텍스트 그림자 | `0 2px 12px rgba(0,0,0,0.55)` | 헤드라인/서브텍스트 공통, 밝은 사진 배경에서도 가독성 확보 |

---

## 4. 타이포그래피

> 가독성 개선(v2): 국내 주요 뉴스/뉴스레터 카드뉴스 계정들은 공통적으로 (1) 헤드라인에 굵은 굵기, (2) 최소 30px 이상의 서브텍스트, (3) 사진 위에서도 눈에 띄는 고대비 색상을 사용합니다. 기존 스펙 대비 굵기·크기·대비를 한 단계씩 상향했습니다.
> (v4) Pretendard 기준으로 잡았던 Black(900)/SemiBold(600)이 Paperlogy에서는 같은 숫자 굵기에서도
> 훨씬 두껍게 보여, 헤드라인 Bold(700)·서브텍스트 Medium(500)으로 한 단계씩 낮췄습니다.
> (폰트마다 같은 숫자 굵기라도 실제 획 두께는 다릅니다 — 굵기를 바꿀 때는 항상 렌더링해서 눈으로 확인할 것)

| 요소 | 폰트 굵기 | 크기 | 비고 |
|---|---|---|---|
| 헤드라인 | Bold (700) 고정 (v4: Paperlogy 적용 후 Black 900에서 하향) | 97px (v4: 모바일 가독성 개선, 기존 64~72px 범위에서 상향 — 68→76→92→97px. 2줄이 기본이지만 이 크기에서는 문장에 따라 3줄까지 갈 수 있음, 3번째 줄까지는 허용) | 좌측 정렬, line-height 1.25, text-shadow 적용 |
| 서브텍스트 | Medium (500, v4: Paperlogy 적용 후 SemiBold~Bold에서 하향) | 30~34px | line-height 1.5, text-shadow 적용 |
| 배지 텍스트 | Bold (700) | 24px | padding 10px 22px, border-radius 999px |
| **서브 문장 (이미지 출처 캡션)** — 본문 슬라이드 전용 | Medium (500) | 16~20px | color `rgba(237,237,237,0.7)`, line-height 1.5, text-shadow 적용. 헤드라인은 표준 크기 그대로 유지 |

- 폰트: **Paperlogy** (v4부터 사용, `input/font/Paperlogy-1.000/`에서 `template.css`가 `@font-face`로 직접 로드 — 시스템에 설치되어 있지 않아도 렌더링됨). Bold(700)를 헤드라인·배지에, Medium(500)을 서브텍스트에, SemiBold(600)를 태그·워터마크에 사용. `@font-face` 로드가 실패하는 예외 상황을 대비한 폴백: Pretendard → Noto Sans KR → Apple SD Gothic Neo → 시스템 sans-serif
- 정렬: 표지·본문 슬라이드는 좌측 정렬 고정 (중앙 정렬 사용 안 함). **단, CTA(팔로우 유도) 슬라이드는 예외적으로 중앙 정렬** (9번 섹션 참고)
- 얇은 폰트(Regular/Light)는 사진 배경 위에서 가독성이 떨어지므로 사용하지 않음

---

## 5. 여백 & 간격

| 항목 | 값 |
|---|---|
| 좌우 마진 | 60px |
| 텍스트 그룹 하단 앵커 | `bottom: 60px` (표지·본문 공통. **(v3)** 표지도 별도 블록 padding 없이 본문과 동일하게 하단 60px 지점에 텍스트 그룹을 앵커링) |
| 배지 - 헤드라인 간격 | 24px (폰트 확대에 맞춰 기존 20px에서 상향) |
| 헤드라인 - 서브텍스트 간격 | 20px (폰트 확대에 맞춰 기존 16px에서 상향) |

---

## 6. 이미지 처리 가이드
- 인물/피사체가 사진 중앙~중상단에 오도록 크롭 (하단 텍스트 영역과 안 겹치게)
- 명암 대비가 뚜렷한 사진 선호 (텍스트 가독성 확보)
- **(v3) 표지·본문 슬라이드 모두** 사진 하단 55~60% 구간에 반드시 다크 그라데이션 적용 (표지도 더 이상 solid 블록에 의존하지 않으므로 그라데이션 대비가 특히 중요)

---

## 7. 슬라이드별 텍스트 구성 템플릿

### 표지 슬라이드
```
배지: [카테고리명]
헤드라인 (2줄 기본, 최대 3줄): 핵심 주제
서브텍스트 (1줄): 부가 설명
```

### 본문 슬라이드
```
헤드라인 (1~2줄): 핵심 문장 / 인물명 + 핵심 소식
서브텍스트 (선택, 1~2줄): 부연 설명
```

### CTA 슬라이드
```
워드마크: [브랜드 로고]
서브 헤드라인 (1줄, 가는 글씨): 채널의 핵심 가치 제안
메인 헤드라인 (1줄, 굵은 글씨): '브랜드명(국문 표기)'를 팔로우하세요
팔로우 칩: @handle (영문 계정명) + 팔로우 버튼
서브 안내 문구 (1줄): - 팔로우 시 받을 수 있는 혜택 -
```

---

## 8. HTML/CSS 구현 힌트

```css
.slide {
  width: 1080px;
  height: 1350px;
  position: relative;
  background-size: cover;
  background-position: center top;
  font-family: 'Paperlogy', 'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif;
}

/* v2: 55% -> 60%로 확장, 2-stop -> 3-stop, 종단 대비 0.85 -> 0.92로 강화 */
/* v3: 표지 슬라이드도 별도 solid 블록 없이 이 오버레이를 그대로 재사용 (badge만 추가) */
.overlay-gradient {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 60%;
  background: linear-gradient(
    to top,
    rgba(0,0,0,0.92) 0%,
    rgba(0,0,0,0.5) 40%,
    rgba(0,0,0,0) 100%
  );
}

.badge {
  display: inline-block;
  background: #4A6CF7;
  color: #fff;
  font-weight: 700;
  font-size: 24px;
  padding: 10px 22px;
  border-radius: 999px;
}

.headline {
  color: #fff;
  font-weight: 700; /* Bold. v4: Paperlogy 적용 후 900(Black)에서 하향 (같은 숫자 굵기라도 폰트마다 두께가 다름) */
  font-size: 97px;  /* v4: 모바일 가독성 개선을 위해 68px → 76px → 92px → 97px 순으로 상향.
                        헤드라인이 2줄 안에 들어가는 최대치에 가까워서, 문장에 따라 3줄까지 갈 수 있음(3줄까지는 허용) */
  line-height: 1.25;
  text-shadow: 0 2px 12px rgba(0,0,0,0.55);
}

.subtext {
  color: #EDEDED;   /* 기존 #D8D8D8에서 명도 상향 */
  font-weight: 500; /* Medium. v4: Paperlogy 적용 후 600(SemiBold)에서 하향 */
  font-size: 32px;  /* 기존 28px에서 상향 (범위 30~34px) */
  line-height: 1.5;
  text-shadow: 0 2px 12px rgba(0,0,0,0.55);
}
```

---

## 9. CTA(팔로우 유도) 슬라이드 — 상세 스펙

캐러셀 마지막 장 전용 레이아웃. 표지/본문과 달리 **콘텐츠 전달이 아니라 팔로우 전환이 목적**이므로 구조와 정렬 규칙이 다르다. 실제 인스타그램 프로필의 "팔로우" 버튼을 모사한 흰색 필(pill) 카드를 화면 중앙에 배치하는 것이 핵심.

### 9-1. 배경
| 항목 | 값 |
|---|---|
| 베이스 배경 | 본문 슬라이드와 동일한 사진/그라데이션 배경 재사용 가능 |
| 딤(dim) 처리 | `rgba(0,0,0,0.5)` 전체 프레임 균일 오버레이 (본문 슬라이드의 하단 그라데이션과 달리 사진 전체를 덮음) |

### 9-2. 구성 요소별 스펙

| 요소 | 스타일 | 위치 |
|---|---|---|
| 워드마크 로고 | 강조 배지(`#4A6CF7` bg, 흰색, 800weight, 22px, padding 6px 14px, radius 8px) + 브랜드명 텍스트(흰색, 700weight, 26px, letter-spacing 1px), 두 요소 gap 8px | 상단 중앙, top 70px |
| 서브 헤드라인 (1줄) | `rgba(255,255,255,0.85)`, 500weight, 32px | 헤드라인 블록 상단, 중앙 정렬 |
| 메인 헤드라인 (1줄) | 흰색, 800weight, 48px, line-height 1.3, 서브 헤드라인과 14px 간격 | 서브 헤드라인 바로 아래, 중앙 정렬 |
| 브랜드명 하이라이트 | 메인 헤드라인 내 브랜드명(국문 표기)에만 적용: 배경 `rgba(74,108,247,0.35)`, padding 2px 10px, radius 6px. 여는/닫는 따옴표는 하이라이트 박스와 3px 여백을 둬서 붙어 보이지 않게 함 | 메인 헤드라인 인라인 |
| 팔로우 칩 | 흰색(`#FFFFFF`) bg, radius 999px, box-shadow `0 18px 40px rgba(0,0,0,0.35)`, height 150px. **폭은 고정값이 아니라 `display:inline-flex` + `left:50%; transform:translateX(-50%)`로 콘텐츠 길이에 맞춰 자동 조정** (고정 폭 사용 시 좌우 여백이 불균형해지므로 금지) | 화면 정중앙, 헤드라인 하단 약 200px 지점 |
| ㄴ 아바타 링 | 지름 96px 원형, `conic-gradient(from 200deg, #4A6CF7, #7f6bf0, #ff8f6b, #4A6CF7)` (인스타그램 스토리 링을 브랜드 컬러로 재해석) | 칩 좌측 |
| ㄴ 아바타 내부 | 지름 84px 원형, bg `#0a2436`, 브랜드 심볼 아이콘(44px) 중앙 배치 | 링 내부 |
| ㄴ 계정 핸들 | `@handle` 형태(영문), 800weight, 34px, color `#101418` | 아바타 우측, gap 26px |
| ㄴ 팔로우 버튼 | bg `#4A6CF7`, 흰색 800weight 26px, padding 16px 36px, radius 999px + 우하단에 커서 아이콘(38px, 흰색 채우기/`#101418` 테두리)을 살짝 겹치게 배치해 "클릭 유도" 느낌 강조 | 칩 우측 |
| 서브 안내 문구 | `rgba(255,255,255,0.75)`, 500weight, 26px, `- 문구 -` 형태로 대시로 감싸기 | 팔로우 칩 하단 약 40px |
| 하단 워터마크 | 브랜드 심볼 아이콘만 단독 사용, 48px, opacity 0.45 | 캔버스 하단 중앙 |

### 9-3. 정렬 및 배치 원칙
- 이 슬라이드는 **모든 텍스트/컴포넌트를 중앙 정렬**한다 (표지·본문의 좌측 정렬 규칙과 다른 유일한 예외)
- 헤드라인은 "가벼운 훅(서브 헤드라인) → 브랜드 강조 CTA 문장(메인 헤드라인)" 2단 구조를 따른다
- 메인 헤드라인에는 실제 계정 핸들이 아닌 **국문 브랜드명**을 사용하고, 팔로우 칩에는 **실제 영문 `@handle`**을 사용해 서로 역할을 분리한다 (예: 헤드라인 `'서핑슈'`, 칩 `@surf.issue`)
- 팔로우 칩 폭은 항상 콘텐츠에 맞춰 줄어드는 fit-content 방식 유지 — 좌우 여백이 넓어지는 고정폭/스트레치 레이아웃 금지

### 9-4. HTML/CSS 구현 힌트

```css
.dim {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.5);
}

.headline-cta .sub {
  color: rgba(255,255,255,0.85);
  font-weight: 500;
  font-size: 32px;
  text-align: center;
}
.headline-cta .main {
  margin-top: 14px;
  color: #fff;
  font-weight: 800;
  font-size: 48px;
  line-height: 1.3;
  text-align: center;
}
.headline-cta .main em {
  font-style: normal;
  background: rgba(74,108,247,0.35);
  padding: 2px 10px;
  border-radius: 6px;
}

/* 핵심: 고정 폭이 아니라 콘텐츠 길이에 맞춰 자동으로 줄어드는 fit-content 방식 */
.follow-chip {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 26px;
  padding: 0 32px;
  height: 150px;
  white-space: nowrap;
  background: #fff;
  border-radius: 999px;
  box-shadow: 0 18px 40px rgba(0,0,0,0.35);
}

.avatar-ring {
  width: 96px; height: 96px; border-radius: 50%;
  background: conic-gradient(from 200deg, #4A6CF7, #7f6bf0, #ff8f6b, #4A6CF7);
  display: flex; align-items: center; justify-content: center;
}
.handle {
  font-weight: 800;
  font-size: 34px;
  color: #101418;
}
.follow-btn {
  position: relative;
  background: #4A6CF7;
  color: #fff;
  font-weight: 800;
  font-size: 26px;
  padding: 16px 36px;
  border-radius: 999px;
}
```

---

## 10. 워터마크 (전 슬라이드 공통)

표지·본문·CTA를 포함한 **모든 슬라이드 우측 상단**에 로고 아이콘 + 계정 핸들을 작게 배치해 캡처/재게시되어도 출처가 남도록 한다. 콘텐츠 요소(배지·헤드라인 등)와 겹치지 않는 여백 영역에 위치하므로 슬라이드 타입에 관계없이 동일한 스펙을 그대로 적용한다.

| 항목 | 값 |
|---|---|
| 위치 | 우측 상단, `top: 52px`, `right: 60px` (좌우 마진 60px 규칙과 동일 선상) |
| 구성 | 로고 아이콘(상어 지느러미 심볼) + `@surf.issue` 텍스트, 가로 배치 |
| 아이콘 크기 | 30x30px, `drop-shadow(0 2px 6px rgba(0,0,0,0.45))` |
| 아이콘-텍스트 간격 | 10px |
| 텍스트 스타일 | `rgba(255,255,255,0.92)`, 600weight, 22px, letter-spacing 0.2px, text-shadow `0 2px 8px rgba(0,0,0,0.5)` |
| CTA 슬라이드에서의 예외 | CTA 슬라이드는 상단 중앙에 별도의 큰 워드마크(9번 섹션)가 이미 있으므로, 우측 상단 워터마크는 더 작고 보조적인 "출처 표기" 역할로 공존시킨다 (두 요소가 겹치지 않도록 워터마크는 항상 우측, 메인 워드마크는 항상 중앙) |

### CSS
```css
.watermark {
  position: absolute;
  top: 52px;
  right: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.watermark svg {
  width: 30px;
  height: 30px;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45));
}
.watermark span {
  color: rgba(255,255,255,0.92);
  font-weight: 600;
  font-size: 22px;
  letter-spacing: 0.2px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
```
