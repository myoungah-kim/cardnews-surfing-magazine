`CLAUDE.md` 의 카드뉴스 제작 프로세스(v2: 표지 1장 + 캡션)를 Step 0 부터 Step 8 까지 실행하세요.
`CARDNEWS.md` 와 `DESIGN.md` 도 반드시 먼저 읽고 규칙을 적용합니다.

## 대상 아티클

- 제목: ${ARTICLE_TITLE}
- URL: ${ARTICLE_URL}
- 출력 폴더: `output/cards/${CARD_SLUG}/`
- 시도 회차: ${ATTEMPT}

## 수정 요청

${FEEDBACK:-없음 (최초 제작)}

수정 요청이 "없음" 이 아니라면, 기존 결과물의 어떤 점이 문제인지로 읽고
그 부분을 확실히 바꾸세요. 요청과 무관한 부분까지 뒤집지는 마세요.

## 이 실행에서 반드시 지킬 것

1. **비용이 드는 이미지 생성(AI 생성)을 절대 쓰지 마세요.** 이 실행은 무인이라
   사용자에게 승인을 받을 수 없습니다. 이미지 소싱은 다음 순서로만 진행합니다:
   원문 이미지(저작권 안전 시) → `stock-image-search` 스킬 → `template.css` 프리셋 배경.
   스톡 검색이 실패하면 망설이지 말고 프리셋 배경으로 폴백하세요.

2. **렌더링은 반드시** `node automation/scripts/render-card.mjs <html> <png>` 로 하세요.
   `CLAUDE.md` Step 6 에 적힌 macOS 크롬 경로는 이 환경(리눅스)에서 동작하지 않습니다.

3. 결과물 파일명은 `output/cards/${CARD_SLUG}/card_01.png` 와
   `output/cards/${CARD_SLUG}/caption.md` 로 고정합니다.

4. `output/cards/_processed_articles.csv` 는 **건드리지 마세요.**
   이 로그는 사용자가 Upload 를 눌러 확정했을 때 자동화가 따로 기록합니다.

5. Step 8 검수를 반드시 수행하세요 — 렌더링된 PNG 를 `Read` 로 열어
   좌측 정렬·안전 영역·워터마크·헤드라인 2줄 이내를 확인하고,
   문제가 있으면 문장을 줄여 다시 렌더링하세요.

6. 스톡 사진을 썼다면 `credit.json` 의 `caption_line` 을 `caption.md` 출처란에
   기사 출처와 함께 반드시 표기하세요 (Unsplash API 가이드라인상 필수).
