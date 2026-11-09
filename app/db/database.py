"""DB 엔진·세션과 FastAPI 의존성(get_db), MariaDB 잠금 충돌 판별.

접속 설정은 app/core/config.py(DATABASE_URL·DB_SSL_CA·DB_POOL)에서만 읽는다. 엔진을 만들어도 바로 접속하지는 않는다.
"""
from collections.abc import Callable, Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import DATABASE_URL, DB_POOL, DB_SSL_CA, MYSQL_PYMYSQL_DRIVERS, PoolSettings

# 접속을 기다리는 최대 초(MariaDB). 풀에서 연결을 기다리는 시간(DB_POOL_TIMEOUT)과는 다르다.
MARIADB_CONNECT_TIMEOUT_SECONDS = 10
# MariaDB 세션 시간대를 UTC 로 고정한다. server_default=func.now()(NOW()) 는 세션 시간대로 저장되는데,
# 앱은 DB 시각을 모두 UTC 로 읽는다(clock.as_utc). 서버 time_zone 이 SYSTEM·Asia/Seoul 이어도 어긋나지 않게 한다.
MARIADB_UTC_INIT_COMMAND = "SET time_zone = '+00:00'"
# MariaDB 잠금 충돌 오류 코드
ER_CHECKREAD = 1020  # 스냅샷 격리 충돌: 스냅샷을 연 뒤 다른 트랜잭션이 바꾸고 커밋한 행을 잠그려 함(innodb_snapshot_isolation)
ER_LOCK_WAIT_TIMEOUT = 1205  # 잠금 대기 시간 초과(innodb_lock_wait_timeout, 기본 50초)
ER_LOCK_DEADLOCK = 1213  # 교착 상태(트랜잭션 전체가 롤백됨)
# 롤백한 뒤 새 트랜잭션으로 바로 다시 하면 되는 충돌. 1205 는 이미 오래 기다린 뒤라 곧바로 다시 하지 않는다.
RETRYABLE_CONFLICT_ERROR_CODES = frozenset({ER_CHECKREAD, ER_LOCK_DEADLOCK})
LOCK_CONFLICT_ERROR_CODES = RETRYABLE_CONFLICT_ERROR_CODES | {ER_LOCK_WAIT_TIMEOUT}


class Base(DeclarativeBase):
    pass


def _mariadb_connect_args(ssl_ca: str) -> dict:
    """PyMySQL 접속 옵션: 접속 대기 시간, 세션 시간대 UTC, (CA 파일이 있으면) 인증서·호스트 이름 확인."""
    connect_args = {"connect_timeout": MARIADB_CONNECT_TIMEOUT_SECONDS, "init_command": MARIADB_UTC_INIT_COMMAND}
    if ssl_ca:
        connect_args.update(ssl_ca=ssl_ca, ssl_verify_cert=True, ssl_verify_identity=True)
    return connect_args


def build_engine(
    database_url: str | URL | None = None, ssl_ca: str | None = None, pool: PoolSettings | None = None,
) -> Engine:
    """SQLAlchemy 엔진. 인자를 주지 않으면 설정(DATABASE_URL·DB_SSL_CA·DB_POOL)을 쓴다.

    모든 엔진: 빌려줄 때 연결 확인(pool_pre_ping), pool.recycle 초보다 오래된 연결은 다시 연다.
    SQLite(테스트·로컬 도구): 스레드 검사를 끈다. 풀 크기·대기 시간은 주지 않는다(SingletonThreadPool 은 받지 않는다).
    그 밖(MariaDB): 풀 크기·넘침·대기 시간을 주고, PyMySQL 이면 접속 옵션(_mariadb_connect_args)을 더한다.
    """
    url = make_url(DATABASE_URL if database_url is None else database_url)
    ssl_ca = DB_SSL_CA if ssl_ca is None else ssl_ca
    pool = DB_POOL if pool is None else pool
    options = {"pool_pre_ping": True, "pool_recycle": pool.recycle}
    if url.get_backend_name() == "sqlite":
        return create_engine(url, connect_args={"check_same_thread": False}, **options)

    connect_args = _mariadb_connect_args(ssl_ca) if url.drivername in MYSQL_PYMYSQL_DRIVERS else {}
    return create_engine(
        url,
        connect_args=connect_args,
        pool_size=pool.size,
        max_overflow=pool.max_overflow,
        pool_timeout=pool.timeout,
        **options,
    )


def _driver_error_code(exc: DBAPIError) -> int | None:
    args = getattr(getattr(exc, "orig", None), "args", ())
    return args[0] if args and isinstance(args[0], int) else None


def is_lock_conflict(exc: DBAPIError) -> bool:
    """MariaDB 가 잠금 충돌(스냅샷 충돌·교착·잠금 대기 초과)로 문장을 거부했는지. 다시 시도하면 될 수 있는 오류다."""
    return _driver_error_code(exc) in LOCK_CONFLICT_ERROR_CODES


def is_retryable_conflict(exc: DBAPIError) -> bool:
    """롤백한 뒤 새 트랜잭션으로 곧바로 한 번 더 하면 되는 충돌(1020 스냅샷 충돌, 1213 교착)인지."""
    return _driver_error_code(exc) in RETRYABLE_CONFLICT_ERROR_CODES


def end_read_snapshot(db: Session) -> None:
    """지금 트랜잭션을 끝내 일반 SELECT(인증 등)가 연 읽기 스냅샷을 닫는다. 행을 잠그는 문장 앞에서 부른다.

    잠그는 문장: 조건부 UPDATE·DELETE, SELECT ... FOR UPDATE / LOCK IN SHARE MODE, 외래 키가 있는 INSERT(부모 행을
    공유 잠금으로 확인한다). MariaDB 11.6+ 기본값(innodb_snapshot_isolation=ON, REPEATABLE READ)에서는 스냅샷을 연
    트랜잭션이 그 뒤 다른 트랜잭션이 바꾸고 커밋한 행을 잠그면 1020(ER_CHECKREAD)으로 거부된다. 잠그는 읽기는 스냅샷을
    열지 않으므로, 이 뒤에는 잠그는 문장부터 하면 늘 최신 행을 잠근다. 읽어 둔 ORM 객체는 만료되어 다음 접근 때 다시 읽힌다.
    연결도 풀로 돌아간다(다음 문장 때 다시 빌린다).
    """
    db.rollback()


# 앱과 관리 스크립트가 함께 쓰는 엔진·세션 공장(설정 그대로).
engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def session_dependency(session_factory: sessionmaker) -> Callable[[], Iterator[Session]]:
    """요청마다 session_factory 로 세션을 열고, 응답이 끝나면(오류여도) 닫는 FastAPI 의존성을 만든다."""

    def get_db() -> Iterator[Session]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    return get_db


# 경로 함수가 Depends(get_db) 로 쓰는 의존성. create_app(session_factory=...) 는 이것을 같은 방식의 다른 공장으로 바꿔 끼운다.
get_db = session_dependency(SessionLocal)


def script_engine(override: Engine | None = None) -> Engine:
    """관리 스크립트(python -m app.scripts.sync_columns 등)가 쓸 엔진: 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정의 엔진."""
    return engine if override is None else override
