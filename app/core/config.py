"""앱 설정. 환경변수는 이 파일에서만 읽는다(app/AGENTS.md). 새 변수는 .env.example 에 예시값과 함께 더한다.

- 모듈을 처음 import 할 때 한 번 읽는다. .env 는 이미 있는 환경변수를 덮어쓰지 않는다(load_dotenv 기본 동작).
- 테스트는 tests/conftest.py 가 일부 변수를 비운 뒤 import 하고, 필요하면 monkeypatch 로 이 모듈의 값을 바꾼다.
- 읽는 규칙은 아래 세 도우미로 통일한다.
  _env_str : 앞뒤 공백을 지우고, 없거나 비었으면 기본값(경로·주소·이름)
  _env_raw : 적힌 그대로, 없을 때만 기본값(비밀번호·키, 빈 값에 뜻이 있는 값)
  _env_int : 정수. 비었으면 기본값, 정수가 아니면 변수 이름을 담은 ValueError 로 앱 시작을 멈춘다
"""
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass

from dotenv import load_dotenv
from sqlalchemy.engine import URL, make_url

load_dotenv()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- 읽기 도우미

def _env_str(name: str, default: str = "", environ: Mapping[str, str] = os.environ) -> str:
    """앞뒤 공백을 지운 값. 변수가 없거나 비었으면 default."""
    return (environ.get(name) or "").strip() or default


def _env_raw(name: str, default: str = "", environ: Mapping[str, str] = os.environ) -> str:
    """적힌 그대로의 값(공백을 지우지 않는다). 변수가 없을 때만 default. 비밀번호·키, 빈 값에 뜻이 있는 값에 쓴다."""
    return environ.get(name, default)


def _env_int(
    name: str, default: int, *, minimum: int = 1, clamp: bool = False, environ: Mapping[str, str] = os.environ,
) -> int:
    """정수 설정. 비었으면 default, 정수가 아니면 변수 이름을 담은 ValueError(앱 시작을 멈춘다).

    minimum 보다 작으면 clamp=True 는 minimum 으로 올리고(0 이 '무제한'처럼 동작하지 않게), 아니면 ValueError.
    """
    raw = (environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is not None and value < minimum and clamp:
        return minimum
    if value is None or value < minimum:
        raise ValueError(f"{name} 는 {minimum} 이상의 정수여야 합니다(지금 값: {raw[:20]!r}).")
    return value


# ---------------------------------------------------------------- DB(MariaDB)

# PyMySQL 로 MariaDB·MySQL 에 붙는 드라이버 이름. charset 기본값(config)과 접속 옵션(app/db/database.py)이 함께 쓴다.
MYSQL_PYMYSQL_DRIVERS = frozenset({"mariadb+pymysql", "mysql+pymysql"})
MYSQL_CHARSET = "utf8mb4"


def build_database_url(environ: Mapping[str, str] = os.environ) -> URL:
    """DB 접속 주소. DATABASE_URL 이 있으면 그것을, 없으면 DB_HOST·DB_PORT·DB_NAME·DB_USER·DB_PASSWORD 로 MariaDB 주소를 만든다.

    PyMySQL 주소에 charset 이 없으면 utf8mb4 를 붙인다. 개별 값으로 만들면 비밀번호의 특수문자를 따로 인코딩하지 않아도 된다.
    """
    override = _env_str("DATABASE_URL", environ=environ)
    if override:
        url = make_url(override)
        if url.drivername in MYSQL_PYMYSQL_DRIVERS and "charset" not in url.query:
            url = url.update_query_dict({"charset": MYSQL_CHARSET})
        return url

    return URL.create(
        "mariadb+pymysql",
        username=_env_str("DB_USER", "app", environ),
        password=_env_raw("DB_PASSWORD", "", environ),
        host=_env_str("DB_HOST", "127.0.0.1", environ),
        port=_env_int("DB_PORT", 3306, environ=environ),
        database=_env_str("DB_NAME", "app", environ),
        query={"charset": MYSQL_CHARSET},
    )


@dataclass(frozen=True)
class PoolSettings:
    """SQLAlchemy 커넥션 풀(MariaDB). 최대 연결 = size + max_overflow. docs/specs/2026-10-31-db-indexes-pool.md"""

    size: int = 10  # 늘 유지하는 연결 수
    max_overflow: int = 10  # 몰릴 때 잠깐 더 여는 연결 수
    timeout: int = 10  # 연결을 기다리는 최대 초. 넘으면 sqlalchemy.exc.TimeoutError → 503
    recycle: int = 1800  # 이 초보다 오래된 연결은 다시 연다(RDS wait_timeout 보다 짧게)


def load_pool_settings(environ: Mapping[str, str] = os.environ) -> PoolSettings:
    """DB_POOL_SIZE·DB_MAX_OVERFLOW(0 허용)·DB_POOL_TIMEOUT·DB_POOL_RECYCLE. 틀린 값은 앱 시작을 멈춘다."""
    defaults = PoolSettings()
    return PoolSettings(
        size=_env_int("DB_POOL_SIZE", defaults.size, environ=environ),
        max_overflow=_env_int("DB_MAX_OVERFLOW", defaults.max_overflow, minimum=0, environ=environ),
        timeout=_env_int("DB_POOL_TIMEOUT", defaults.timeout, environ=environ),
        recycle=_env_int("DB_POOL_RECYCLE", defaults.recycle, environ=environ),
    )


DATABASE_URL = build_database_url()
# RDS CA 묶음 파일 경로. 있으면 MariaDB 접속에 TLS 인증서 확인을 켠다(app/db/database.py).
DB_SSL_CA = _env_str("DB_SSL_CA")
DB_POOL = load_pool_settings()


# ---------------------------------------------------------------- 로그인(JWT·쿠키)

JWT_SECRET_KEY = _env_raw("JWT_SECRET_KEY", "development-only-change-me-use-env-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = _env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 30)
# 빈 값 = API 호스트에만 붙는 쿠키(.env.example). 그래서 비었을 때 기본값으로 바꾸지 않는다. 공백은 app/core/session.py 가 지운다.
ACCESS_TOKEN_COOKIE_DOMAIN = _env_raw("ACCESS_TOKEN_COOKIE_DOMAIN", "mlops.kro.kr")

# 브라우저 화면(프런트) 주소. CORS 허용 목록이다(app/main.py). 환경변수가 아니라 코드로 정한다.
FRONTEND_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "https://www.mlops.kro.kr")
# 쿠키로 인증하는 상태 변경 요청(POST/PATCH/DELETE)이 받는 Origin(app/api/deps.py). API 호스트 자신(문서 화면)도 받는다.
ALLOWED_ORIGINS = frozenset({*FRONTEND_ORIGINS, "https://api.mlops.kro.kr"})


# ---------------------------------------------------------------- 외부 연동(카카오·PortOne·S3)

KAKAO_REST_API_KEY = _env_raw("KAKAO_REST_API_KEY")
KAKAO_CLIENT_SECRET = _env_raw("KAKAO_CLIENT_SECRET")
KAKAO_REDIRECT_URI = _env_str("KAKAO_REDIRECT_URI", "http://localhost:5173/login/kakao/callback")
PORTONE_STORE_ID = _env_raw("PORTONE_STORE_ID")
PORTONE_CHANNEL_KEY = _env_raw("PORTONE_CHANNEL_KEY")
PORTONE_API_SECRET = _env_raw("PORTONE_API_SECRET")
S3_BUCKET_NAME = _env_str("S3_BUCKET_NAME")
AWS_REGION = _env_str("AWS_REGION", "ap-northeast-2")


# ---------------------------------------------------------------- 로그·이벤트

# 로그 폴더. 있으면 access.jsonl(요청 로그), uvicorn-access.log, uvicorn-error.log,
# events-fallback.jsonl(MongoDB 대체 저장)을 쓴다. 매일 UTC 자정 회전, LOG_RETENTION_DAYS 개 보관.
# 비어 있으면 파일 없이 표준 출력만 쓴다(app/core/log_files.py).
LOG_DIR = _env_str("LOG_DIR")
LOG_RETENTION_DAYS = _env_int("LOG_RETENTION_DAYS", 30, clamp=True)
# 이 주소(쉼표 구분 IP·CIDR)에서 직접 접속한 요청만 X-Forwarded-For·X-Request-ID 를 믿는다.
# 빈 값 = 프록시 없음(uvicorn 이 직접 받는 지금 운영). app/core/trusted_proxy.py
TRUSTED_PROXY_IPS = _env_str("TRUSTED_PROXY_IPS")
# 사용자 이벤트(POST /events) 저장소. MONGODB_URI 가 비어 있으면 MongoDB 를 쓰지 않고 대체 저장한다(app/core/event_store.py).
MONGODB_URI = _env_str("MONGODB_URI")
MONGODB_DB = _env_str("MONGODB_DB", "moa")
MONGODB_TIMEOUT_MS = _env_int("MONGODB_TIMEOUT_MS", 2000, clamp=True)


# ---------------------------------------------------------------- 로컬 시뮬레이션 전용. 운영 .env 에는 넣지 않는다
# docs/specs/2026-10-30-persona-simulator.md, docs/specs/2026-11-01-virtual-clock.md

PAYMENT_MODE_PORTONE = "portone"
PAYMENT_MODE_MOCK = "mock"
DEFAULT_MOCK_PAYMENT_EMAIL_DOMAIN = "sim.moa.test"


def parse_payment_mode(raw: str | None) -> str:
    """앞뒤 공백·대소문자를 무시하고 "mock" 이면 mock, 비었거나 "portone" 이면 portone.

    그 밖의 값은 잘못 적은 것으로 보고 portone(실제 결제)으로 되돌리며 경고 로그를 남긴다.
    """
    value = (raw or "").strip().lower()
    if value in ("", PAYMENT_MODE_PORTONE):
        return PAYMENT_MODE_PORTONE
    if value == PAYMENT_MODE_MOCK:
        return PAYMENT_MODE_MOCK
    logger.warning("Unknown PAYMENT_MODE %r; using %r.", (raw or "")[:40], PAYMENT_MODE_PORTONE)
    return PAYMENT_MODE_PORTONE


# mock 이면 이메일이 @MOCK_PAYMENT_EMAIL_DOMAIN 으로 끝나는 이메일 회원만 PortOne 없이 모의 결제한다(app/core/mock_payment.py).
PAYMENT_MODE = parse_payment_mode(os.environ.get("PAYMENT_MODE"))
MOCK_PAYMENT_EMAIL_DOMAIN = _env_str("MOCK_PAYMENT_EMAIL_DOMAIN", DEFAULT_MOCK_PAYMENT_EMAIL_DOMAIN)
if PAYMENT_MODE == PAYMENT_MODE_MOCK:
    # 운영에 잘못 들어갔을 때 바로 알 수 있게 시작할 때마다 남긴다.
    logger.warning(
        "PAYMENT_MODE=mock: @%s accounts pay without PortOne. Never use this in production.",
        MOCK_PAYMENT_EMAIL_DOMAIN,
    )
# "1" 일 때만 시장 도구(python -m app.scripts.market_tick)가 DB 를 바꾼다. 웹 서버에는 넣지 않는다.
SIMULATION_ENV = _env_str("SIMULATION_ENV")
# 가상 시계 파일. 있으면 app/core/clock.py 가 "지금"을 이 파일의 offset 만큼 옮긴다(로컬 docker-compose 전용).
SIM_CLOCK_FILE = _env_str("SIM_CLOCK_FILE")
