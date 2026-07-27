---
name: stock-image-search
description: 무료 라이선스 스톡 사진 API(Unsplash·Pexels·Pixabay·Openverse)에서 카드뉴스·소셜 콘텐츠용 배경 사진을 검색·선택·다운로드하고 크레딧 정보를 정리한다. 아티클 원문 이미지를 저작권 때문에 못 쓸 때, 카드 배경 사진이 필요할 때, 스톡 사진의 라이선스·저작자 표시 의무를 확인해야 할 때 사용.
---

# 스톡 이미지 검색 (Stock Image Search)

무료 라이선스 스톡 사진 4곳을 한 번에 검색해서, 카드 배경으로 가장 적합한 사진을
점수순으로 고르고 다운로드까지 끝냅니다. 표준 라이브러리만 쓰므로 설치가 필요 없습니다.

## 언제 쓰는가

아티클 원문 이미지를 저작권 문제로 쓸 수 없을 때의 **첫 번째 대안**입니다.
AI 이미지 생성(유료)보다 먼저 시도하세요.

## 사용법

```bash
# 후보 먼저 확인 (다운로드 없음) — 항상 이걸 먼저 실행할 것
python3 .claude/skills/stock-image-search/scripts/stock_image.py "big wave surfing nazare" --dry-run

# 마음에 드는 결과가 나오면 저장
python3 .claude/skills/stock-image-search/scripts/stock_image.py "big wave surfing nazare" \
    --out output/cards/<주제-slug>/bg.jpg
```

`bg.jpg` 옆에 `credit.json` 이 함께 저장되고, 캡션에 넣을 크레딧 문구가 출력됩니다.

주요 옵션: `--provider unsplash|pexels|pixabay|openverse` (기본은 4곳 전부),
`--no-cache` (24시간 캐시 무시).

## 검색어 만들기

**반드시 영문 키워드 2~4개.** 한글 검색은 결과가 거의 없습니다.
헤드라인을 번역하지 말고 **사진에 담겨야 할 장면**으로 바꾸세요.

> "나자레에서 20m 파도를 탄 서퍼" → `big wave surfing nazare` (O)
> "역대급 기록을 세운 서퍼의 도전" → `record challenge surfer` (X — 추상어라 결과가 엉뚱함)

결과가 시원찮으면 키워드를 바꿔 재시도하되, 요청 한도가 있으니 무한정 반복하지 마세요.
같은 키워드 재검색은 24시간 캐시에서 나오므로 한도를 쓰지 않습니다.

## 결과 읽는 법

`--dry-run` 이 후보 상위 5장을 점수와 함께 출력합니다.

- **`upscale` 이 1.0 이면 무손실**, 1.0 을 넘으면 그만큼 확대해야 해서 흐려집니다.
  1.0 초과 후보는 웬만하면 거르세요.
- **점수는 화질(확대 필요량) → 크롭 손실 → 밝기 → 피사체 키워드** 순으로 가중됩니다.
- 실전에서 1위는 대부분 **Unsplash·Pexels** 에서 나옵니다. Pixabay(무료 등급 1280px 상한)와
  Openverse(원본 대부분 1024px 이하)는 해상도 때문에 밀립니다.

**점수만 믿지 말고 실제 사진을 눈으로 확인하세요.** 평균 밝기는 이미지 전체 통계라,
피사체와 밝은 영역이 하단(헤드라인이 놓이는 자리)에 몰린 사진을 걸러내지 못합니다.

## 제공처 선택

| 상황 | 쓸 곳 |
|---|---|
| 일반적인 배경 사진 (대부분의 경우) | Unsplash, Pexels |
| 위에서 못 찾았을 때 | Pixabay |
| 역사적·기록적 사진, 특정 사건/장소 (상업 스톡에 없는 것) | Openverse (Wikimedia·Flickr의 CC 사진) |

제공처별 필드·한도·제약 상세는 `references/providers.md` 참조.

## 라이선스와 크레딧 (필수)

- **크레딧 표기는 선택이 아닙니다.** Unsplash·Pexels 는 API 가이드라인상 요구사항이고,
  Openverse 의 CC BY 사진은 **법적 의무**입니다.
- `credit.json` 의 `caption_line` 을 그대로 캡션 출처란에 넣으세요.
  CC 사진은 문구가 길지만 **줄이지 마세요** (저작자·출처·라이선스가 모두 필요).
- Openverse 는 상업적 이용과 2차 변형이 모두 허용되는 라이선스(`cc0`/`pdm`/`by`)만
  검색하도록 제한되어 있습니다. NC(비영리)·ND(변형 금지)·SA(동일조건)는 제외됩니다.
- Unsplash 는 사진을 쓸 때마다 다운로드 트래킹 핑을 보내야 하며, 스크립트가 자동 처리합니다.

## API 키

`.env` 에 넣습니다 (`.env.example` 참조). **하나만 있어도 동작하고**, 없는 제공처는
자동으로 건너뜁니다. **Openverse 는 키가 필요 없습니다.**

```
UNSPLASH_ACCESS_KEY=...    # https://unsplash.com/oauth/applications (Demo 50회/시간)
UNSPLASH_APP_NAME=...      # 크레딧 UTM 파라미터용 앱 이름
PEXELS_API_KEY=...         # https://www.pexels.com/api/ (200회/시간)
PIXABAY_API_KEY=...        # https://pixabay.com/api/docs/ (100회/60초)
```

## 다른 프로젝트에서 쓰기

기본값은 서핑 카드뉴스(1080x1350) 기준입니다. 플래그로 바꿀 수 있습니다:

```bash
--canvas 1080x1080 --ideal-lum 0.4 \
--subject-words "coffee,cafe,espresso" --off-topic-words "illustration,3d"
```

`--ideal-lum` 은 텍스트가 얹히는 영역의 어두운 오버레이 세기에 맞춰 정하세요.
오버레이가 약하면 더 어두운 사진(낮은 값)이 필요합니다.

## 주의

스톡 사진은 **분위기용**입니다. 기사 속 인물·장소·대회를 그대로 찍은 사진처럼
보이게 쓰거나, 캡션에서 그 사진을 실제 사건 장면인 것처럼 설명하지 마세요.
