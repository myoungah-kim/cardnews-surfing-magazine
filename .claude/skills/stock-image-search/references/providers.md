# 제공처별 상세 비교

`scripts/stock_image.py` 의 `normalize_*` 함수가 아래 차이를 흡수해서 공통 형식으로 바꿉니다.
새 제공처를 추가하거나 점수 기준을 손볼 때 참고하세요.

## 한눈에 보기

| | Unsplash | Pexels | Pixabay | Openverse |
|---|---|---|---|---|
| API 키 | 필요 | 필요 | 필요 | **불필요** |
| 인증 방식 | `Authorization: Client-ID <key>` | `Authorization: <key>` | `key=` 쿼리 파라미터 | 없음 (익명) |
| 요청 한도 | 50/시간 (Demo)<br>1,000/시간 (승인 후) | 200/시간<br>20,000/월 | 100/60초 | 20/분, 200/일 |
| 최대 해상도 | 원본 | 원본 | **1280px**<br>(승인 시 1920px) | 원본 (대체로 ≤1024px) |
| 서버 크롭 | O (imgix) | O (imgix) | X (고정 크기) | X (원본 URL) |
| 평균 색상 | `color` | `avg_color` | **없음** | **없음** |
| 좋아요 | `likes` | **없음** | `likes` | **없음** |
| 세로 필터 | `orientation=portrait` | `orientation=portrait` | `orientation=vertical` | `aspect_ratio=tall` |
| 성인물 필터 | `content_filter=high` | 없음 | `safesearch=true` | `mature=false` (신뢰도 낮음) |
| 다운로드 핑 | **필수** | 불필요 | 불필요 | 불필요 |
| 페이지 크기 상한 | 30 | 80 | 200 | **20** (익명) |

## 제공처별 주의사항

### Unsplash
- 사진을 사용할 때마다 `links.download_location` 에 GET 을 보내야 합니다 (사진작가 통계 반영).
  누락하면 API 접근이 취소될 수 있습니다. 이 호출도 시간당 한도를 소모합니다.
- `urls.raw` 는 imgix 엔드포인트라 `?w=&h=&fit=crop&crop=entropy` 로 CDN에서 크롭됩니다.
- **`ixid` 파라미터를 지우면 안 됩니다.** 그래서 URL을 문자열로 이어 붙이지 않고
  쿼리를 파싱해 병합합니다 (`add_query`).
- 검색 결과가 밝은 사진 쪽으로 치우치는 경향이 있습니다 (실측 밝기 중앙값 0.75).

### Pexels
- **Cloudflare 뒤에 있습니다.** `User-Agent` 를 안 보내면 urllib 기본값
  (`Python-urllib/3.x`)이 봇으로 걸려 403 `error code: 1010` 이 납니다.
- 좋아요 수를 제공하지 않아 인기도 비교가 불가능합니다.
- 이미지 URL은 imgix 파라미터(`?auto=compress&cs=tinysrgb&w=&h=&fit=crop`)를 받습니다.

### Pixabay
- **API 약관상 검색 응답을 24시간 캐시해야 합니다.** `.cache/` 가 그 역할을 합니다.
- **영구적인 핫링크가 금지**되어 있습니다. 반드시 다운로드해서 쓰세요
  (Unsplash 가 핫링크를 *요구*하는 것과 정반대).
- 무료 등급은 `largeImageURL` 이 긴 변 1280px 상한이라, 세로 사진은 가로가 1080px 에
  못 미쳐 확대가 필요합니다 (실측 1.05~1.27배). `fullHDURL`(1920px)·`imageURL`(원본)은
  full API access 승인 계정에만 응답에 포함되며, 승인받으면 확대 문제가 대부분 해소됩니다.

### Openverse
- 키가 없어도 되지만 **익명은 `page_size` 상한이 20** 입니다. 넘기면 401.
- Flickr·Wikimedia 등 원본 사이트 URL을 그대로 돌려주므로 리사이즈가 불가능하고
  링크가 죽어있을 수 있습니다 (`filter_dead=true` 필수).
- **성인물 필터를 신뢰하면 안 됩니다.** 서핑 검색에서 `mature=false` 로도
  선정적인 사진이 통과했고, 그중 하나는 `unstable__sensitivity` 도 비어 있었습니다.
  그래서 제목·태그 기반 차단 목록(`NSFW_WORDS`)을 마지막 방어선으로 둡니다.
- 반대로 **차단 목록이 과하면 멀쩡한 사진이 대량으로 걸러집니다.** `breast` 를 넣었더니
  "Kill The Breast Cancer" 캠페인에 참여한 빅웨이브 서퍼 사진 11장이 통째로 사라졌습니다.
  Openverse 자체 `sensitive_text` 분류기도 같은 오탐을 내기 때문에, 이 신호 하나만
  있을 때는 즉시 제외하지 않고 키워드 검사에 맡깁니다.
- 라이선스를 반드시 좁혀야 합니다 (`cc0,pdm,by`). 다른 3곳과 달리 색인 전체가
  상업적 이용 가능한 것이 아닙니다.

## 점수 계산

`score_photo()` 의 설계 원칙은 **"측정된 결함만 감점하고, 모르는 값은 감점하지 않는다"** 입니다.

| 항목 | 가중치 | 근거 |
|---|---|---|
| `upscale` | -5.0 | 실제 화질 손실. 4곳 모두 계산되므로 정당한 비교 |
| 크롭 손실 | -2.0 | 캔버스 비율에서 멀수록 잘려나감 |
| 밝기 | ±1.5 | `IDEAL_LUM` 에 가까울수록 헤드라인이 잘 읽힘 |
| 피사체 키워드 | ±1.0 | 설명·태그에 원하는 장면이 있는지 |

- `likes` 는 **쓰지 않습니다.** Pexels·Openverse 에 없어 비교가 불가능하고,
  좋아요가 많은 사진 = 이미 많이 쓰인 사진이라 피드가 흔해 보이는 역효과도 있습니다.
- `color` 가 없는 Pixabay·Openverse 는 `hex_luminance` 가 중립값 0.5 를 돌려주므로
  "평균 밝기의 사진"으로 취급됩니다. `or 0` 으로 처리했다면 '완전한 검정'이 되어
  해당 제공처가 늘 1위를 차지했을 것입니다.

### 알려진 한계
평균 색상은 **이미지 전체** 통계입니다. 실제 제약은 헤드라인이 놓이는 **하단 40%** 의
밝기이므로, 피사체와 흰 포말이 하단에 몰린 사진이 높은 점수를 받을 수 있습니다.
정확히 하려면 후보 상위 몇 장의 축소본을 받아 하단 1/3 밝기를 직접 재야 합니다
(Unsplash·Pexels 는 imgix 로 작은 PNG 를 만들 수 있고, PNG 디코딩은 `zlib` 만으로 가능).
