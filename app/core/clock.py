"""현재 시각과 오늘 날짜를 얻는 유일한 곳.

테스트는 `monkeypatch.setattr(clock, "utc_now", lambda: ...)` 로 시각을 바꾼다.
그래서 다른 모듈은 `from app.core import clock` 후 `clock.utc_now()` 처럼 모듈 속성으로 부른다.

가상 시계(docs/specs/2026-11-01-virtual-clock.md): 로컬 시뮬레이션에서만 "지금"을 옮긴다.
- SIM_CLOCK_FILE(app/core/config.py)이 있을 때만 켜진다. 로컬 docker-compose 에만 있고, 그 밖에는 언제나 실제 시각이다.
- 가상 시각 = 실제 시각 + 파일의 offset_seconds. 파일은 시뮬레이터 도구(python -m simulator clock)가 쓴다.
- 파일이 없으면 offset 0, 형식이 틀리면 SimClockError(틀린 시각으로 조용히 기록하지 않는다).
- 프로세스마다 1초에 한 번까지만 다시 읽는다.
- 로그인 토큰·S3 업로드 만료처럼 실제 시각이어야 하는 곳은 이 모듈의 utc_now 를 쓰지 않는다.
"""
import json
import logging
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from app.core.config import SIM_CLOCK_FILE

# 한국은 1988년 이후 일광 절약 시간이 없어 UTC+9 고정이다.
# Windows 에는 IANA 시간대 DB 가 없어(tzdata 패키지 필요) zoneinfo 대신 고정 오프셋을 쓴다.
SEOUL = timezone(timedelta(hours=9), "Asia/Seoul")

MAX_OFFSET_SECONDS = 20 * 366 * 24 * 60 * 60  # ±20년
RELOAD_SECONDS = 1.0  # 시계 파일을 다시 읽는 최소 간격

logger = logging.getLogger(__name__)


class SimClockError(RuntimeError):
    """가상 시계 파일의 형식이 틀렸다."""


def parse_offset(text: str) -> int:
    """시계 파일 내용 → offset_seconds. 정수(bool 아님)이고 ±20년 이내여야 한다."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise SimClockError(f"sim clock file is not JSON: {error}") from None
    if not isinstance(data, dict):
        raise SimClockError("sim clock file must be a JSON object")
    offset = data.get("offset_seconds")
    if type(offset) is not int or abs(offset) > MAX_OFFSET_SECONDS:
        raise SimClockError("offset_seconds must be an integer within ±20 years")
    return offset


def sim_clock_path(raw: str | None) -> Path | None:
    """가상 시계 파일 경로(SIM_CLOCK_FILE). 비어 있으면 None(꺼짐). 켜지면 운영에 잘못 들어갔을 때 바로 알 수 있게 경고를 남긴다."""
    raw = (raw or "").strip()
    if not raw:
        return None
    logger.warning("SIM_CLOCK_FILE=%s: virtual clock enabled for local simulation. Never use this in production.", raw)
    return Path(raw)


class SimClock:
    """시계 파일의 offset 을 RELOAD_SECONDS 동안 기억한다. path 가 None 이면 언제나 0."""

    def __init__(self, path: Path | None, monotonic: Callable[[], float] = time.monotonic):
        self.path = path
        self._monotonic = monotonic
        self._cached: tuple[int, float] | None = None  # (offset, 읽은 때). 스레드끼리 통째로 바꾼다

    def offset_seconds(self) -> int:
        if self.path is None:
            return 0
        now = self._monotonic()
        cached = self._cached
        if cached is not None and now - cached[1] < RELOAD_SECONDS:
            return cached[0]
        try:
            offset = parse_offset(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            offset = 0
        self._cached = (offset, now)
        return offset


_sim_clock = SimClock(sim_clock_path(SIM_CLOCK_FILE))


def configure(path: Path | None, monotonic: Callable[[], float] = time.monotonic) -> None:
    """가상 시계 파일을 바꾼다(테스트용). None 이면 끈다."""
    global _sim_clock
    _sim_clock = SimClock(path, monotonic)


def offset_seconds() -> int:
    """지금의 가상 시계 offset(초). 꺼져 있으면 0."""
    return _sim_clock.offset_seconds()


def real_utc_now() -> datetime:
    """가상 시계와 관계없는 실제 UTC 시각."""
    return datetime.now(timezone.utc)


def utc_now() -> datetime:
    """시간대가 붙은 현재 UTC 시각. 가상 시계가 켜져 있으면 실제 시각 + offset."""
    offset = _sim_clock.offset_seconds()
    now = real_utc_now()
    return now + timedelta(seconds=offset) if offset else now


def real_seoul_today() -> date:
    """가상 시계와 관계없는 실제 Asia/Seoul 날짜(카탈로그의 "아직 없는 상품" 검사처럼 현실 기준이어야 하는 곳)."""
    return real_utc_now().astimezone(SEOUL).date()


def seoul_today() -> date:
    """Asia/Seoul 기준 오늘 날짜. utc_now() 에서 계산하므로 utc_now 만 바꾸면 함께 바뀐다."""
    return utc_now().astimezone(SEOUL).date()


def as_utc(value: datetime | None) -> datetime | None:
    """DB 에서 읽은 시각에 UTC 를 붙인다(SQLite·MariaDB 는 시간대 없이 돌려준다. 저장 값은 UTC 다)."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)
