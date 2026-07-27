#!/usr/bin/env python3
"""
스톡 이미지 검색/다운로드 — CARDNEWS.md 이미지 규칙 "방법 2" 구현

지원 제공처: Unsplash, Pexels, Pixabay (표준 라이브러리만 사용, 설치 불필요)

사용법:
    # 키가 있는 제공처를 모두 검색해서 가장 점수 높은 사진 선택 (기본값)
    python3 scripts/stock_image.py "big wave surfing storm" \
        --out output/cards/nazare-2026/bg.jpg

    # 후보만 훑어보기 (다운로드 없음)
    python3 scripts/stock_image.py "surfer barrel wave" --dry-run

    # 특정 제공처만 / 캐시 무시
    python3 scripts/stock_image.py "surfer barrel wave" --provider pixabay --no-cache

동작 순서:
    1. 각 제공처에서 세로 사진 후보 검색 → 공통 형식(normalize)으로 변환
    2. score_photo() 로 카드뉴스 표지 적합도를 점수화 → 1위 선택
    3. 다운로드 (Unsplash/Pexels 는 CDN에서 1080x1350 크롭, Pixabay 는 고정 크기)
    4. (Unsplash 한정) download_location 트리거 — API 가이드라인상 필수
    5. credit.json 저장 + 캡션에 넣을 크레딧 문구 출력

검색 응답은 .cache/ 에 24시간 보관합니다 (Pixabay 약관상 필수, 나머지는 한도 절약용).

제공처별 차이 (normalize_* 함수에서 흡수):
                    Unsplash            Pexels              Pixabay
    인증            Client-ID <key>     <key> 헤더          key= 쿼리 파라미터
    요청 한도       50/시간 (Demo)      200/시간            100/60초
    세로 지정       orientation=        orientation=        orientation=
                    portrait            portrait            vertical
    평균 색상       color               avg_color           없음 (None)
    좋아요          likes               없음 (None)         likes
    최대 해상도     원본                원본                1280px (승인 시 1920px)
    다운로드 핑     필수                불필요              불필요
    성인물 필터     content_filter=high 없음                safesearch=true
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_TTL = 24 * 3600  # Pixabay 약관: "requests must be cached for 24 hours"
PER_PAGE = 30
PROVIDERS = ("unsplash", "pexels", "pixabay", "openverse")


def find_project_root():
    """.env 나 CLAUDE.md 가 있는 가장 가까운 상위 디렉터리.

    이 스크립트는 .claude/skills/ 안에 있으므로 파일 위치로 프로젝트를 추정할 수 없습니다.
    실행 위치(cwd)에서 위로 올라가며 찾고, 못 찾으면 cwd 를 그대로 씁니다.
    """
    for d in (Path.cwd(), *Path.cwd().parents):
        if (d / ".env").exists() or (d / "CLAUDE.md").exists():
            return d
    return Path.cwd()


PROJECT_ROOT = find_project_root()
CACHE_DIR = PROJECT_ROOT / ".cache"

# --- 아래 값들은 프로젝트에 맞춰 CLI 플래그로 덮어쓸 수 있습니다 (configure 참조) ---
CANVAS_W, CANVAS_H = 1080, 1350  # DESIGN.md 캔버스 규격 (4:5)


# ---------------------------------------------------------------- 설정 로드

def load_env():
    """.env 를 읽어 os.environ 에 병합 (python-dotenv 없이 간단 파싱)."""
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def get_key(name):
    """키가 없거나 예시값 그대로면 None (해당 제공처는 건너뜀)."""
    value = os.environ.get(name, "").strip()
    return value if value and not value.startswith("your_") else None


# ---------------------------------------------------------------- HTTP 공통

USER_AGENT = "surf-issue-cardnews/1.0"


def http_get_json(url, headers, provider):
    """JSON API 호출. (응답, 남은 요청 수) 반환. 실패해도 예외 대신 None.

    User-Agent 를 반드시 넣습니다 — Pexels·Pixabay 앞단의 Cloudflare 가
    urllib 기본 UA(Python-urllib/3.x)를 봇으로 보고 403(error code 1010)을 냅니다.
    """
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            remaining = (res.headers.get("X-Ratelimit-Remaining")
                         or res.headers.get("X-RateLimit-Remaining"))
            return json.loads(res.read().decode("utf-8")), remaining
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        if e.code in (401, 403, 429):
            print(f"  ! {provider} 인증/한도 오류 {e.code} — 이 제공처는 건너뜁니다. {body}",
                  file=sys.stderr)
            return None, None
        print(f"  ! {provider} API 오류 {e.code}: {body}", file=sys.stderr)
        return None, None
    except urllib.error.URLError as e:
        print(f"  ! {provider} 연결 실패: {e.reason}", file=sys.stderr)
        return None, None


def cached_get_json(url, headers, provider, use_cache=True):
    """검색 응답을 24시간 캐시. 같은 키워드를 반복 검색해도 한도를 소모하지 않음."""
    # URL에 키가 들어가는 제공처(Pixabay)가 있으므로 파일명은 해시로만 만든다
    name = f"{provider}-{hashlib.sha256(url.encode()).hexdigest()[:16]}.json"
    path = CACHE_DIR / name

    if use_cache and path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL:
        age_h = (time.time() - path.stat().st_mtime) / 3600
        print(f"[{provider}] 캐시 사용 ({age_h:.1f}시간 전, 요청 소모 없음)")
        return json.loads(path.read_text(encoding="utf-8")), "cached"

    data, remaining = http_get_json(url, headers, provider)
    if data is not None:
        CACHE_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data, remaining


def add_query(url, params):
    """기존 쿼리 파라미터(Unsplash의 ixid 등)를 보존하면서 파라미터 추가."""
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query))
    query.update(params)
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def compute_upscale(avail_w, avail_h):
    """1080x1350 을 채우려면 몇 배 확대가 필요한지. 1.0 이면 확대 불필요(선명)."""
    return round(max(1.0, CANVAS_W / avail_w, CANVAS_H / avail_h), 2)


# ---------------------------------------------------------------- Unsplash

def search_unsplash(query, key, app_name, use_cache):
    url = "https://api.unsplash.com/search/photos?" + urllib.parse.urlencode({
        "query": query,
        "per_page": PER_PAGE,
        "orientation": "portrait",   # 캔버스가 4:5 세로라 가로 사진은 크롭 손실이 큼
        "content_filter": "high",    # 브랜드 계정이므로 안전 필터 최대
        "order_by": "relevant",
    })
    data, remaining = cached_get_json(
        url, {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"},
        "unsplash", use_cache)
    if not data:
        return []
    print(f"[unsplash] {data['total']}장 중 {len(data['results'])}장 (남은 요청: {remaining})")
    return [normalize_unsplash(p, app_name) for p in data["results"]]


def normalize_unsplash(p, app_name):
    utm = f"?utm_source={app_name}&utm_medium=referral"
    return {
        "provider": "unsplash",
        "id": p["id"],
        "width": p["width"],
        "height": p["height"],
        "upscale": compute_upscale(p["width"], p["height"]),
        "color": p["color"],
        "likes": p.get("likes"),
        "description": p.get("alt_description") or p.get("description") or "",
        # urls.raw 는 imgix 엔드포인트 — 파라미터로 CDN에서 크롭까지 처리
        "render_url": add_query(p["urls"]["raw"], {
            "w": str(CANVAS_W), "h": str(CANVAS_H),
            "fit": "crop", "crop": "entropy",  # 피사체 중심 자동 크롭
            "q": "85", "fm": "jpg",
        }),
        "photo_url": p["links"]["html"] + utm,
        "author": p["user"]["name"],
        "author_url": p["user"]["links"]["html"] + utm,
        "caption_line": f"Photo: {p['user']['name']} / Unsplash",
        "license": "Unsplash License",
        "download_ping": p["links"]["download_location"],  # 사용 시 반드시 호출
    }


# ---------------------------------------------------------------- Pexels

def search_pexels(query, key, use_cache):
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({
        "query": query,
        "per_page": PER_PAGE,
        "orientation": "portrait",
    })
    data, remaining = cached_get_json(url, {"Authorization": key}, "pexels", use_cache)
    if not data:
        return []
    print(f"[pexels] {data['total_results']}장 중 {len(data['photos'])}장 (남은 요청: {remaining})")
    return [normalize_pexels(p) for p in data["photos"]]


def normalize_pexels(p):
    return {
        "provider": "pexels",
        "id": str(p["id"]),
        "width": p["width"],
        "height": p["height"],
        "upscale": compute_upscale(p["width"], p["height"]),
        "color": p["avg_color"],
        "likes": None,  # Pexels 는 좋아요 수를 제공하지 않음
        "description": p.get("alt") or "",
        "render_url": add_query(p["src"]["original"], {
            "auto": "compress", "cs": "tinysrgb",
            "w": str(CANVAS_W), "h": str(CANVAS_H), "fit": "crop",
        }),
        "photo_url": p["url"],
        "author": p["photographer"],
        "author_url": p["photographer_url"],
        "caption_line": f"Photo: {p['photographer']} / Pexels",
        "license": "Pexels License",
        "download_ping": None,
    }


# ---------------------------------------------------------------- Pixabay

def search_pixabay(query, key, use_cache):
    url = "https://pixabay.com/api/?" + urllib.parse.urlencode({
        "key": key,                 # Pixabay 는 헤더가 아니라 쿼리 파라미터로 인증
        "q": query,
        "per_page": PER_PAGE,
        "image_type": "photo",      # 일러스트/벡터 제외
        "orientation": "vertical",
        "safesearch": "true",
        "order": "popular",
    })
    data, remaining = cached_get_json(url, {}, "pixabay", use_cache)
    if not data:
        return []
    print(f"[pixabay] {data['totalHits']}장 중 {len(data['hits'])}장 (남은 요청: {remaining})")
    return [normalize_pixabay(p) for p in data["hits"]]


def normalize_pixabay(p):
    """Pixabay 는 임의 리사이즈가 안 되고 고정 크기 URL만 제공.

    무료 등급의 largeImageURL 은 긴 변 1280px 이 상한이라, 세로 사진 기준
    가로가 1080px 에 못 미쳐 확대가 필요할 수 있습니다 (upscale 필드로 노출).
    fullHDURL(1920px)/imageURL(원본)은 Pixabay 승인(full API access) 계정만 응답에 포함됩니다.
    """
    if p.get("fullHDURL"):
        render_url, max_edge = p["fullHDURL"], 1920
    else:
        render_url, max_edge = p["largeImageURL"], 1280

    # 원본이 max_edge 로 축소되므로, 실제로 받을 수 있는 픽셀을 역산
    scale = min(1.0, max_edge / max(p["imageWidth"], p["imageHeight"]))
    avail_w, avail_h = round(p["imageWidth"] * scale), round(p["imageHeight"] * scale)

    return {
        "provider": "pixabay",
        "id": str(p["id"]),
        "width": p["imageWidth"],
        "height": p["imageHeight"],
        "upscale": compute_upscale(avail_w, avail_h),
        "color": None,  # Pixabay 는 평균 색상을 제공하지 않음 → hex_luminance 는 중립값 0.5
        "likes": p.get("likes"),
        "description": p.get("tags") or "",
        "render_url": render_url,
        "photo_url": p["pageURL"],
        "author": p["user"],
        "author_url": f"https://pixabay.com/users/{p['user']}-{p['user_id']}/",
        "caption_line": f"Photo: {p['user']} / Pixabay",
        "license": "Pixabay Content License",
        "download_ping": None,
    }


# ---------------------------------------------------------------- Openverse

# 상업적 이용 + 2차 변형(텍스트 얹기)이 모두 허용되는 라이선스만 사용합니다.
#   cc0 / pdm = 퍼블릭 도메인, by = 저작자 표시만 하면 됨
# by-sa 는 "동일조건 변경허락"이라 결과물(카드뉴스)에도 같은 라이선스가 따라붙을 수 있어 제외,
# nc(비영리)·nd(변형 금지) 는 브랜드 계정 특성상 애초에 사용 불가.
OPENVERSE_LICENSES = "cc0,pdm,by"

# Openverse 의 mature 플래그는 출처 메타데이터에 의존해 신뢰도가 낮습니다.
# 실측 결과 "Naked Beach Yoga" 가 mature=False, sensitivity=[] 로 통과했기 때문에
# 제목·태그 기반 차단 목록을 마지막 방어선으로 둡니다.
#
# 단어는 반드시 구체적으로 — 'breast' 처럼 일반적인 단어를 넣었더니
# "Kill The Breast Cancer" 캠페인에 참여한 빅웨이브 서퍼 사진 11장이 통째로 걸러졌습니다.
NSFW_WORDS = ("nude", "naked", "topless", "erotic", "lingerie", "boudoir",
              "sexy", "glamour girl", "porn")


def is_safe_openverse(p):
    """mature 플래그 → sensitivity 배열 → 제목/태그 키워드 순으로 확인.

    sensitivity 의 'sensitive_text' 는 메타데이터 문자열만 보고 판단해 오탐이 잦습니다
    (위 'breast cancer' 사례를 Openverse 분류기도 똑같이 걸러냄).
    그래서 이 값 하나만 있을 때는 즉시 제외하지 않고 키워드 검사에 맡기고,
    출처·사용자가 직접 신고한 나머지 민감도 신호는 그대로 신뢰합니다.
    """
    if p.get("mature"):
        return False
    if set(p.get("unstable__sensitivity") or []) - {"sensitive_text"}:
        return False
    tags = " ".join(t.get("name", "") for t in (p.get("tags") or []))
    text = f"{p.get('title', '')} {tags}".lower()
    return not any(w in text for w in NSFW_WORDS)


def search_openverse(query, use_cache):
    """Openverse 는 API 키가 필요 없습니다 (익명 20회/분, 200회/일)."""
    url = "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode({
        "q": query,
        "page_size": min(PER_PAGE, 20),  # 익명 요청은 20이 상한 (초과하면 401)
        "license": OPENVERSE_LICENSES,
        "aspect_ratio": "tall",   # 4:5 캔버스에 맞춰 세로 사진만
        "mature": "false",
        "filter_dead": "true",    # 원본이 사라진 링크 제외 (출처가 외부 사이트라 필수)
    })
    data, remaining = cached_get_json(url, {}, "openverse", use_cache)
    if not data:
        return []

    safe = [p for p in data["results"] if is_safe_openverse(p)]
    dropped = len(data["results"]) - len(safe)
    print(f"[openverse] {data['result_count']}장 중 {len(safe)}장 "
          f"(성인물 필터로 {dropped}장 제외, 남은 요청: {remaining})")
    return [normalize_openverse(p) for p in safe]


def normalize_openverse(p):
    """Openverse 는 원본 사이트(Flickr·Wikimedia 등) URL 을 그대로 돌려줍니다.

    리사이즈가 불가능하고 원본이 작은 경우가 많아 upscale 값이 높게 나오는 편입니다.
    CC BY 는 저작자 표시가 법적 의무이므로, API 가 만들어 준 attribution 문자열을
    그대로 캡션에 사용합니다 (다른 제공처보다 크레딧 문구가 깁니다).
    """
    tags = ", ".join(t.get("name", "") for t in (p.get("tags") or [])[:8])
    license_name = f"CC {p['license'].upper()} {p.get('license_version', '')}".strip()
    return {
        "provider": "openverse",
        "id": p["id"],
        "width": p["width"],
        "height": p["height"],
        "upscale": compute_upscale(p["width"], p["height"]),
        "color": None,       # Openverse 는 평균 색상을 제공하지 않음
        "likes": None,
        "description": f"{p.get('title', '')} {tags}".strip(),
        "render_url": p["url"],
        "photo_url": p["foreign_landing_url"],
        "author": p.get("creator") or "Unknown",
        "author_url": p.get("creator_url") or p["foreign_landing_url"],
        # CC 라이선스는 저작자·출처·라이선스 명시가 의무 → API 제공 문자열을 그대로 사용
        "caption_line": p.get("attribution") or
                        f"Photo: {p.get('creator')} / {p['source']} ({license_name})",
        "license": license_name,
        "download_ping": None,
    }


# ---------------------------------------------------- 후보 점수화 (사용자 구현 지점)

# 점수 가중치 — 취향 조정은 이 숫자들만 만지면 됩니다
W_UPSCALE = 5.0    # 확대 필요 = 화질 저하 (가장 강한 감점)
W_CROP = 2.0       # 4:5 로 자를 때 버려지는 비율
W_CONTRAST = 1.5   # 헤드라인 가독성 (평균 밝기)
W_SUBJECT = 1.0    # 설명/태그에 드러난 피사체

IDEAL_LUM = 0.35   # 하단 다크 그라데이션과 겹쳤을 때 헤드라인이 가장 잘 읽히는 평균 밝기

# 원하는 피사체인지 판별하는 단어 (Pixabay·Openverse 는 tags, 나머지는 alt 텍스트에서 찾음)
# 서핑 외의 주제로 재사용할 때는 --subject-words / --off-topic-words 로 교체하세요.
SUBJECT_WORDS = ("surf", "wave", "barrel", "swell", "ocean", "sea", "board", "storm")
OFF_TOPIC_WORDS = ("hotel", "pool", "chair", "yoga", "illustration", "render",
                   "studio", "3d", "vector")


def configure(args):
    """CLI 플래그로 프로젝트 의존 상수를 덮어씁니다 (기본값은 서핑슈 카드뉴스 기준)."""
    global CANVAS_W, CANVAS_H, IDEAL_LUM, SUBJECT_WORDS, OFF_TOPIC_WORDS
    if args.canvas:
        w, _, h = args.canvas.lower().partition("x")
        CANVAS_W, CANVAS_H = int(w), int(h)
    if args.ideal_lum is not None:
        IDEAL_LUM = args.ideal_lum
    if args.subject_words is not None:
        SUBJECT_WORDS = tuple(w.strip().lower() for w in args.subject_words.split(",") if w.strip())
    if args.off_topic_words is not None:
        OFF_TOPIC_WORDS = tuple(w.strip().lower() for w in args.off_topic_words.split(",") if w.strip())


def score_photo(photo):
    """카드뉴스 표지 배경으로 얼마나 적합한지 점수화. 높을수록 좋음.

    normalize_* 를 거친 공통 형식이라 제공처와 무관하게 같은 기준이 적용됩니다.
        photo["width"], photo["height"]  - 원본 픽셀
        photo["upscale"]                  - 캔버스를 채우려면 몇 배 확대해야 하는지
        photo["color"]                    - 평균 색상 헥스 (Pixabay 는 None)
        photo["description"]              - 사진 설명/태그 (없으면 빈 문자열)
        photo["likes"]                    - Unsplash·Pixabay 만 숫자, Pexels 는 None
        photo["provider"]                 - "unsplash" | "pexels" | "pixabay"

    설계 원칙 — "측정된 결함"만 감점하고 "모르는 값"은 감점하지 않습니다:
        - upscale 은 제공처 모두 계산되는 실제 화질 손실이므로 그대로 감점 (정당한 차별)
        - color 가 없는 Pixabay 는 hex_luminance 가 중립값 0.5 를 돌려주므로
          "평균적인 밝기의 사진"으로 취급됩니다. 어두운 사진에는 지고 밝은 사진은 이깁니다
          (`or 0` 으로 코딩했다면 '완전한 검정'으로 취급돼 Pixabay 가 늘 1위가 됐을 것)
        - likes 는 아예 쓰지 않습니다. Pexels 에 없어서 비교가 불가능하고,
          좋아요가 많은 사진 = 이미 많이 쓰인 사진이라 피드가 흔해 보이는 역효과도 있습니다
    """
    score = 0.0

    # 1. 확대 필요량 — 1080x1350 보다 작은 사진은 늘려야 해서 흐려짐
    score -= W_UPSCALE * (photo["upscale"] - 1.0)

    # 2. 크롭 손실 — 4:5 에서 멀수록 잘려나가는 영역이 커짐
    ratio = photo["width"] / photo["height"]
    target = CANVAS_W / CANVAS_H
    score -= W_CROP * (1 - min(ratio / target, target / ratio))

    # 3. 헤드라인 대비 — IDEAL_LUM 에 가까울수록 가점, 너무 밝으면 감점
    lum = hex_luminance(photo["color"])
    score += W_CONTRAST * (1 - abs(lum - IDEAL_LUM) / IDEAL_LUM)

    # 4. 피사체 — 서핑 장면이면 가점, 스톡 특유의 무관한 사진이면 감점
    text = photo["description"].lower()
    if any(w in text for w in SUBJECT_WORDS):
        score += W_SUBJECT
    if any(w in text for w in OFF_TOPIC_WORDS):
        score -= W_SUBJECT

    return score


def hex_luminance(hex_color):
    """'#0c2b3f' → 0.0(검정)~1.0(흰색) 밝기. None 이면 중립값 0.5."""
    if not hex_color:
        return 0.5
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def pick_best(photos):
    """점수 내림차순 정렬 후 1위 반환 (동점이면 API 관련도 순서 유지)."""
    if not photos:
        sys.exit("검색 결과가 없습니다. 키워드를 바꾸거나 API 키를 확인하세요.")

    ranked = sorted(enumerate(photos), key=lambda p: (-score_photo(p[1]), p[0]))
    print(f"\n후보 {len(photos)}장 중 상위 5장:")
    for rank, (_, p) in enumerate(ranked[:5], 1):
        print(f"  {rank}. [{p['provider']:8}] {p['width']}x{p['height']} "
              f"upscale={p['upscale']}x color={p['color']} likes={p['likes']} "
              f"score={score_photo(p):.2f}")
        print(f"     {p['description'][:60]}")
        print(f"     {p['photo_url']}")
    return ranked[0][1]


# ---------------------------------------------------------------- 다운로드

def save_image(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res, open(dest, "wb") as f:
        f.write(res.read())
    print(f"[save] {dest} ({dest.stat().st_size // 1024} KB)")


def trigger_download_ping(photo, keys):
    """Unsplash 가이드라인상 필수인 다운로드 트래킹 핑 (사진작가 통계 반영).

    캐시를 태우면 안 되는 호출이라 http_get_json 을 직접 씁니다.
    """
    if not photo["download_ping"]:
        return
    http_get_json(photo["download_ping"],
                  {"Authorization": f"Client-ID {keys['unsplash']}"}, "unsplash")
    print("[track] Unsplash download_location 트리거 완료")


# ---------------------------------------------------------------- 엔트리포인트

def main():
    parser = argparse.ArgumentParser(description="스톡 사이트에서 표지 배경 사진 가져오기")
    parser.add_argument("query", help="영문 검색 키워드 (예: 'big wave surfing storm')")
    parser.add_argument("--out", default="input/bg.jpg", help="저장 경로 (기본: input/bg.jpg)")
    parser.add_argument("--provider", choices=(*PROVIDERS, "all"), default="all",
                        help="검색할 제공처 (기본: all — 키가 있는 곳 전부)")
    parser.add_argument("--dry-run", action="store_true", help="후보만 출력하고 다운로드 안 함")
    parser.add_argument("--no-cache", action="store_true", help="24시간 캐시를 무시하고 새로 요청")
    parser.add_argument("--canvas", metavar="WxH",
                        help=f"캔버스 규격 (기본: {CANVAS_W}x{CANVAS_H})")
    parser.add_argument("--ideal-lum", type=float, metavar="0~1",
                        help=f"가장 읽기 좋은 평균 밝기 (기본: {IDEAL_LUM})")
    parser.add_argument("--subject-words", metavar="a,b,c",
                        help="가점할 피사체 키워드 (쉼표 구분, 기본은 서핑 관련어)")
    parser.add_argument("--off-topic-words", metavar="a,b,c",
                        help="감점할 키워드 (쉼표 구분)")
    args = parser.parse_args()

    configure(args)
    load_env()
    keys = {
        "unsplash": get_key("UNSPLASH_ACCESS_KEY"),
        "pexels": get_key("PEXELS_API_KEY"),
        "pixabay": get_key("PIXABAY_API_KEY"),
        "openverse": "anonymous",  # Openverse 는 키 없이 익명 호출 가능
    }
    wanted = PROVIDERS if args.provider == "all" else (args.provider,)
    use_cache = not args.no_cache

    if not any(keys[p] for p in wanted):
        sys.exit(
            f"API 키가 없습니다 ({', '.join(wanted)}).\n"
            "  cp .env.example .env  후 키를 채워주세요.\n"
            "  Unsplash: https://unsplash.com/oauth/applications\n"
            "  Pexels:   https://www.pexels.com/api/\n"
            "  Pixabay:  https://pixabay.com/api/docs/\n"
            "  (Openverse 는 키가 필요 없습니다: --provider openverse)"
        )

    photos = []
    for provider in wanted:
        if not keys[provider]:
            print(f"[{provider}] 키가 없어 건너뜁니다.")
        elif provider == "unsplash":
            photos += search_unsplash(
                args.query, keys["unsplash"],
                os.environ.get("UNSPLASH_APP_NAME", "surf_issue_cardnews"), use_cache)
        elif provider == "pexels":
            photos += search_pexels(args.query, keys["pexels"], use_cache)
        elif provider == "pixabay":
            photos += search_pixabay(args.query, keys["pixabay"], use_cache)
        else:
            photos += search_openverse(args.query, use_cache)

    best = pick_best(photos)
    if args.dry_run:
        return

    dest = Path(args.out)
    if not dest.is_absolute():
        dest = PROJECT_ROOT / dest

    print(f"\n선택: [{best['provider']}] {best['photo_url']}")
    if best["upscale"] > 1.0:
        print(f"  ! 이 사진은 캔버스를 채우려면 {best['upscale']}배 확대됩니다 (화질 저하 주의)")
    save_image(best["render_url"], dest)
    trigger_download_ping(best, keys)

    meta = {k: v for k, v in best.items() if k != "download_ping"}
    (dest.parent / "credit.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n캡션 출처란에 넣을 문구 → {meta['caption_line']}")


if __name__ == "__main__":
    main()
