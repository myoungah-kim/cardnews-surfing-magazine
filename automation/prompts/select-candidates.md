오늘 날짜는 ${TARGET_DATE} 입니다.

`ARTICLE_CANDIDATE_FILTER.md` 를 처음부터 끝까지 읽고, 그 지침 그대로 후보 선별을 수행하세요.
피드 목록·하드컷·스코어링·소재군 밸런싱·최종 확정 규칙을 임의로 바꾸지 말고 문서에 적힌 대로 적용합니다.
`output/cards/_processed_articles.csv` 에 이미 있는 URL 은 반드시 제외하세요.

산출물을 **두 개** 만들어야 합니다.

## 1. `output/candidates/${TARGET_DATE}.md`

`ARTICLE_CANDIDATE_FILTER.md` 4번 섹션의 마크다운 포맷 그대로 (사람이 읽는 용도).

## 2. `output/candidates/${TARGET_DATE}.json`

자동화가 읽는 기계용 파일입니다. 아래 스키마를 **정확히** 지키세요.

```json
{
  "date": "${TARGET_DATE}",
  "generatedAt": "<ISO8601 타임스탬프>",
  "candidates": [
    {
      "index": 1,
      "title": "기사 제목 (원문 그대로, 영문이면 영문)",
      "url": "원문 URL",
      "feed": "surfer.com",
      "published": "YYYY-MM-DD",
      "topic": "소재군 (3-5 표의 이름 그대로)",
      "headlineType": "헤드라인 유형 (반전/비교/수치충격/... 중 하나)",
      "metric": "조회수 | 저장 | 댓글 | 팔로우 중 하나",
      "reason": "선정 이유 2~3문장 (무엇이 후킹인지)",
      "status": "pending"
    }
  ]
}
```

규칙:
- `index` 는 1부터 순위 순서대로 붙입니다. 마크다운 표의 순위와 반드시 일치해야 합니다.
- `status` 는 전부 `"pending"` 으로 둡니다.
- 조건을 통과한 후보가 하나도 없으면 `candidates` 를 빈 배열로 두되, **파일은 반드시 생성**하세요.
- JSON 은 유효해야 합니다. 주석이나 트레일링 콤마를 넣지 마세요.
