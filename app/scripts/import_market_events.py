"""시장 일정 파일(app/market_events.json)을 market_events 테이블에 맞춘다. docs/specs/2026-11-01-market-model.md

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_market_events          # 미리보기: 새 일정, 바뀔 일정, 파일에 없는 일정
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_market_events --yes    # 실행
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_market_events --file <파일>   # 다른 일정 파일(기본 app/market_events.json)
    docker compose exec backend python -m app.scripts.import_market_events [--yes]   # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 시장 도구(app.scripts.market_tick)는 이 테이블만 읽는다.
- 검증이 먼저다. 파일 전체를 확인해(JSON 배열, 필드·종류·날짜 순서·카테고리·판매처·비율 범위, code 중복) 하나라도 틀리면
  아무것도 바꾸지 않고 종료 코드 2.
- code 가 같은 일정은 값을 맞추고, 새 code 는 넣는다. 파일에 없는 DB 일정은 지우지 않고 목록만 출력한다.
- 바꿀 것이 없으면 "바꿀 것이 없습니다."(같은 파일로 두 번째 실행). 종료 코드: 0 성공(미리보기 포함), 2 파일 문제
  (인자가 틀려도 argparse 의 2).
- --yes 는 market_events 테이블이 없으면 만든다(앱을 새 버전으로 아직 띄우지 않은 DB). 미리보기는 없는 테이블을 빈 것으로 본다.
  실패하면 아무것도 커밋하지 않는다.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, ValidationError, model_validator
from sqlalchemy import Engine, inspect, select
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATEGORIES
from app.db.database import script_engine
from app.core.market_model import EVENT_DEMAND, EVENT_LAUNCH, EVENT_SALE, SOURCES, ScheduledEvent
from app.models import MarketEvent

EVENTS_FILE = Path(__file__).resolve().parents[1] / "market_events.json"
EXIT_INVALID = 2
NOTHING_TO_DO = "바꿀 것이 없습니다."
FIELDS = ("name", "kind", "starts_on", "ends_on", "categories", "sources", "min_pct", "max_pct", "note")
# 종류별 비율 범위(%): sale 할인율, demand 최고 상승률. launch 는 가격 영향이 없어 0 이어야 한다
PCT_LIMITS = {EVENT_SALE: 50.0, EVENT_DEMAND: 100.0}

Number = StrictInt | StrictFloat


class EventFile(BaseModel):
    """일정 파일 한 줄."""

    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")]
    name: Annotated[str, Field(min_length=1, max_length=100)]
    kind: Literal[EVENT_SALE, EVENT_LAUNCH, EVENT_DEMAND]  # type: ignore[valid-type]
    starts_on: date
    ends_on: date
    categories: list[Literal[CATEGORIES]]  # type: ignore[valid-type]
    sources: list[Literal[SOURCES]]  # type: ignore[valid-type]
    min_pct: Number
    max_pct: Number
    note: Annotated[str, Field(min_length=1, max_length=300)]

    @model_validator(mode="after")
    def consistent(self):
        if self.ends_on < self.starts_on:
            raise ValueError("ends_on is before starts_on")
        if len(set(self.categories)) != len(self.categories) or len(set(self.sources)) != len(self.sources):
            raise ValueError("categories and sources must not repeat")
        if self.kind == EVENT_LAUNCH:
            if self.min_pct != 0 or self.max_pct != 0:
                raise ValueError("launch has no price effect: min_pct and max_pct must be 0")
        elif not 0 < self.min_pct <= self.max_pct <= PCT_LIMITS[self.kind]:
            raise ValueError(f"{self.kind} needs 0 < min_pct <= max_pct <= {PCT_LIMITS[self.kind]:g}")
        return self

    def values(self) -> dict:
        return {
            "name": self.name, "kind": self.kind, "starts_on": self.starts_on, "ends_on": self.ends_on,
            "categories": list(self.categories), "sources": list(self.sources),
            "min_pct": float(self.min_pct), "max_pct": float(self.max_pct), "note": self.note,
        }


class EventFileError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__(f"{len(problems)} market event problem(s):\n" + "\n".join(problems[:50]))


def load_events(path: Path = EVENTS_FILE) -> list[EventFile]:
    """일정 파일을 읽고 검증해 파일 순서대로 돌려준다. 틀린 곳을 모두 모아 EventFileError 하나로 알린다."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise EventFileError([f"missing file {path}"]) from None
    except json.JSONDecodeError as error:
        raise EventFileError([f"not JSON ({error})"]) from None
    if not isinstance(raw, list):
        raise EventFileError(["the file must be a JSON array"])
    problems: list[str] = []
    events: list[EventFile] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        label = f"[{index}] {item.get('code', '?') if isinstance(item, dict) else '?'}"
        try:
            event = EventFile.model_validate(item)
        except ValidationError as error:
            details = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'event'}: {e['msg']}" for e in error.errors())
            problems.append(f"{label}: {details}")
            continue
        if event.code in seen:
            problems.append(f"{label}: duplicate code {event.code!r}")
        seen.add(event.code)
        events.append(event)
    if problems:
        raise EventFileError(problems)
    return events


def scheduled(row: MarketEvent | EventFile) -> ScheduledEvent:
    """DB 행이나 파일 한 줄 → 시장 모델의 일정."""
    return ScheduledEvent(
        code=row.code, kind=row.kind, starts_on=row.starts_on, ends_on=row.ends_on,
        categories=tuple(row.categories or ()), sources=tuple(row.sources or ()),
        min_pct=float(row.min_pct), max_pct=float(row.max_pct),
    )


# ---------------------------------------------------------------- 계획·실행

@dataclass
class Plan:
    events: list[EventFile]
    inserts: list[EventFile] = field(default_factory=list)
    updates: list[tuple[MarketEvent, EventFile, list[str]]] = field(default_factory=list)
    missing: list[MarketEvent] = field(default_factory=list)  # 파일에 없는 DB 일정(지우지 않는다)

    @property
    def has_changes(self) -> bool:
        return bool(self.inserts or self.updates)


def make_plan(db: Session, events: list[EventFile], table_exists: bool) -> Plan:
    plan = Plan(events)
    rows = list(db.scalars(select(MarketEvent).order_by(MarketEvent.id))) if table_exists else []
    by_code = {row.code: row for row in rows}
    for event in events:
        row = by_code.get(event.code)
        if row is None:
            plan.inserts.append(event)
            continue
        wanted = event.values()
        changed = [name for name in FIELDS if getattr(row, name) != wanted[name]]
        if changed:
            plan.updates.append((row, event, changed))
    codes = {event.code for event in events}
    plan.missing = [row for row in rows if row.code not in codes]
    return plan


def apply(db: Session, plan: Plan) -> None:
    """계획대로 바꾼다. commit 은 부르는 쪽이 한다."""
    for row, event, changed in plan.updates:
        wanted = event.values()
        for name in changed:
            setattr(row, name, wanted[name])
    for event in plan.inserts:
        db.add(MarketEvent(code=event.code, **event.values()))


def _span(event: EventFile) -> str:
    return f"{event.kind}, {event.starts_on.isoformat()}~{event.ends_on.isoformat()}"


def run(engine: Engine, yes: bool = False, path: Path = EVENTS_FILE, out=print) -> int:
    """종료 코드: 0 성공(미리보기 포함), 2 일정 파일 문제(아무것도 바꾸지 않음)."""
    try:
        events = load_events(path)
    except EventFileError as error:
        out(f"일정 파일({path})에 문제가 있습니다({len(error.problems)}개). 아무것도 바꾸지 않았습니다:")
        for problem in error.problems:
            out(f"- {problem}")
        return EXIT_INVALID
    if yes:
        MarketEvent.__table__.create(bind=engine, checkfirst=True)
    table_exists = MarketEvent.__tablename__ in inspect(engine).get_table_names()
    if not table_exists:
        out(f"- {MarketEvent.__tablename__}: 테이블 없음(--yes 로 실행할 때 만듭니다)")

    kinds: dict[str, int] = {}
    for event in events:
        kinds[event.kind] = kinds.get(event.kind, 0) + 1
    with Session(engine) as db:
        plan = make_plan(db, events, table_exists)
        out(f"일정 파일 확인: 일정 {len(events)}개 ({', '.join(f'{kind} {count}' for kind, count in kinds.items())})")
        for event in plan.inserts:
            out(f"+ {event.code}: {event.name} ({_span(event)})")
        for row, event, changed in plan.updates:
            out(f"~ {row.code}: {', '.join(changed)}")
        for row in plan.missing:
            out(f"? {row.code}: 일정 파일에 없습니다. 지우지 않습니다.")
        if not plan.has_changes:
            out(NOTHING_TO_DO)
            return 0
        if not yes:
            out(f"미리보기입니다(새 일정 {len(plan.inserts)}개, 바뀔 일정 {len(plan.updates)}개). "
                "아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
            return 0
        try:
            apply(db, plan)
            db.commit()
        except Exception:
            db.rollback()
            raise
    out(f"새 일정 {len(plan.inserts)}개를 넣고 기존 일정 {len(plan.updates)}개를 맞췄습니다.")
    return 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.import_market_events",
        description="시장 일정 파일(app/market_events.json)을 market_events 에 맞춥니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="실제로 일정을 넣고 바꾼다")
    parser.add_argument("--file", type=Path, default=EVENTS_FILE, help="일정 파일(기본 app/market_events.json)")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, path=args.file, out=out)


if __name__ == "__main__":
    sys.exit(main())
