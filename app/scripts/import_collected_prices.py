"""브라우저로 모은 네이버 쇼핑 가격(tools/price_collect/collect.mjs 의 CSV)을 가격 이력에 넣고, 수집 대상 목록을 만든다.

기준: docs/specs/2026-11-01-market-model.md "브라우저 수집 도구"

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_collected_prices --targets 60 --out targets.json   # 수집 대상(JSON)
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_collected_prices <csv>          # 미리보기: 넣을 가격, 건너뛸 가격
    .\\.venv\\Scripts\\python.exe -m app.scripts.import_collected_prices <csv> --yes    # 실행
    docker compose exec backend python -m app.scripts.import_collected_prices ...       # 로컬 Docker(파일은 docker compose cp 로)

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- --targets N: 출시된 상품 중 origin=collected 네이버 이력이 가장 오래된 상품부터(없는 상품이 먼저, 같으면 id 순서) N 개를
  JSON 배열로 쓴다. 한 줄 = {product_id, name, category, brand, query, model_code, attributes, last_collected_at}.
  query 는 카탈로그(app/catalog)의 search_query(이름이 같은 상품), 없으면 상품 이름이다. --out 이 없으면 표준 출력(ASCII JSON).
- CSV: 머리 줄이 CSV_COLUMNS 와 같아야 한다. accepted=true 행만 source=naver, origin=collected, recorded_at=collected_at 으로
  넣는다(가상 시계가 아니라 실제 관측 시각이다). 같은 상품·같은 날짜(collected_at 의 서울 날짜)의 네이버 collected 이력이
  DB 나 같은 파일 앞쪽에 있으면 건너뛴다.
- 검증이 먼저다. 머리 줄, 상품 번호, accepted, 채택 행의 가격(1,000~100,000,000원)·시각(시간대 필수, 미래 아님)·DB 상품 존재를
  모두 확인해 하나라도 틀리면 아무것도 넣지 않고 종료 코드 2. product_price_history.origin 컬럼이 없어도 2(app.scripts.sync_columns 먼저).
- 종료 코드: 0 성공(미리보기·대상 목록 포함), 2 파일·DB 문제(인자가 틀려도 argparse 의 2). 실패하면 아무것도 커밋하지 않는다.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import Engine, func, inspect, select
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATALOG_DIR, CATEGORIES
from app.core import clock
from app.core.pricing import MAX_PRICE_KRW, record_external_price
from app.core.product_release import released
from app.db.database import script_engine
from app.models import Product, ProductAttributes, ProductPriceHistory
from app.models.product_price_history import PRICE_ORIGIN_COLLECTED, PRICE_SOURCE_NAVER

CSV_COLUMNS = ("product_id", "query", "accepted", "price_krw", "seller_title", "reason", "collected_at")
EXIT_INVALID = 2
MIN_PRICE_KRW = 1_000
MAX_ROWS = 50_000
MAX_TARGETS = 1_000
FUTURE_SLACK = timedelta(minutes=10)  # 수집 PC 와 서버 시계 차이
NOTHING_TO_DO = "넣을 가격이 없습니다."
NO_ORIGIN = ("product_price_history.origin 컬럼이 없습니다. 먼저 python -m app.scripts.sync_columns 로 확인한 뒤 --yes 로 더하세요"
             "(docs/specs/2026-11-01-market-model.md).")


@dataclass(frozen=True)
class CollectedRow:
    line: int
    product_id: int
    price_krw: int
    collected_at: datetime  # UTC

    @property
    def day(self) -> date:
        return self.collected_at.astimezone(clock.SEOUL).date()


@dataclass
class Plan:
    rows: int = 0
    accepted: list[CollectedRow] = field(default_factory=list)
    inserts: list[CollectedRow] = field(default_factory=list)
    skipped: list[tuple[CollectedRow, str]] = field(default_factory=list)


# ---------------------------------------------------------------- 공통

def _check_origin_column(engine: Engine) -> list[str]:
    tables = inspect(engine)
    names = set(tables.get_table_names())
    if Product.__tablename__ not in names or ProductPriceHistory.__tablename__ not in names:
        return ["products·product_price_history 테이블이 없습니다. 앱을 한 번 시작하거나 시드를 넣은 뒤 다시 실행하세요."]
    if "origin" not in {column["name"] for column in tables.get_columns(ProductPriceHistory.__tablename__)}:
        return [NO_ORIGIN]
    return []


def _report(out, title: str, problems: list[str]) -> int:
    out(f"{title}({len(problems)}개). 아무것도 바꾸지 않았습니다:")
    for problem in problems:
        out(f"- {problem}")
    return EXIT_INVALID


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return clock.as_utc(value).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------------------------------------------------------------- CSV 읽기·검증

def _digits(text: str) -> int | None:
    """ASCII 숫자만 있는 칸 → 정수(최대 10자리). 아니면 None."""
    return int(text) if re.fullmatch(r"[0-9]{1,10}", text) else None


def parse_collected_at(text: str) -> datetime:
    """ISO 8601 시각(시간대 필수) → UTC. 틀리면 ValueError."""
    value = datetime.fromisoformat(text.strip())
    if value.tzinfo is None:
        raise ValueError("time zone is required")
    return value.astimezone(timezone.utc)


def read_csv(path: Path) -> tuple[int, list[CollectedRow], list[str]]:
    """(행 수, 채택 행, 문제 목록). 채택 행의 상품 존재는 따로(DB) 확인한다."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return 0, [], [f"파일이 없습니다: {path}"]
    except UnicodeDecodeError:
        return 0, [], ["UTF-8 CSV 가 아닙니다."]
    lines = list(csv.reader(text.splitlines()))
    if not lines:
        return 0, [], ["빈 파일입니다."]
    header = tuple(cell.strip() for cell in lines[0])
    if header != CSV_COLUMNS:
        return 0, [], [f"머리 줄이 {','.join(CSV_COLUMNS)} 이어야 합니다(지금: {','.join(header)[:200]})."]
    body = [(number, cells) for number, cells in enumerate(lines[1:], start=2) if any(cell.strip() for cell in cells)]
    if len(body) > MAX_ROWS:
        return len(body), [], [f"행이 너무 많습니다({len(body)}개, 최대 {MAX_ROWS}개)."]
    latest = clock.real_utc_now() + FUTURE_SLACK
    problems: list[str] = []
    accepted: list[CollectedRow] = []
    for number, cells in body:
        if len(cells) != len(CSV_COLUMNS):
            problems.append(f"{number}번째 줄: 칸이 {len(cells)}개입니다({len(CSV_COLUMNS)}개여야 합니다).")
            continue
        row = dict(zip(CSV_COLUMNS, (cell.strip() for cell in cells)))
        line_problems = []
        product_id = _digits(row["product_id"]) or 0
        if not 1 <= product_id <= 2_147_483_647:
            line_problems.append(f"product_id {row['product_id']!r} 가 양의 정수가 아닙니다")
        flag = row["accepted"].lower()
        if flag not in ("true", "false"):
            line_problems.append(f"accepted 는 true/false 여야 합니다(지금 {row['accepted']!r})")
        try:
            at = parse_collected_at(row["collected_at"])
            if at > latest:
                line_problems.append(f"collected_at {row['collected_at']} 이 미래입니다")
        except ValueError:
            at = None
            line_problems.append(f"collected_at {row['collected_at']!r} 이 시간대가 있는 ISO 8601 시각이 아닙니다")
        price = _digits(row["price_krw"])
        if flag == "true" and (price is None or not MIN_PRICE_KRW <= price <= MAX_PRICE_KRW):
            line_problems.append(f"채택 행의 price_krw {row['price_krw']!r} 가 {MIN_PRICE_KRW:,}~{MAX_PRICE_KRW:,} 원이 아닙니다")
        if line_problems:
            problems.append(f"{number}번째 줄: {'; '.join(line_problems)}")
        elif flag == "true":
            accepted.append(CollectedRow(number, product_id, price, at))
    return len(body), accepted, problems


def make_plan(db: Session, total: int, accepted: list[CollectedRow]) -> tuple[Plan, dict[int, str], list[str]]:
    """(계획, 상품 이름, 문제 목록)."""
    plan = Plan(rows=total, accepted=accepted)
    ids = sorted({row.product_id for row in accepted})
    names = dict(db.execute(select(Product.id, Product.name).where(Product.id.in_(ids))).all()) if ids else {}
    problems = [f"{row.line}번째 줄: 상품 {row.product_id} 이 DB 에 없습니다" for row in accepted if row.product_id not in names]
    if problems:
        return plan, names, problems
    existing: set[tuple[int, date]] = set()
    if ids:
        for product_id, at in db.execute(
            select(ProductPriceHistory.product_id, ProductPriceHistory.recorded_at).where(
                ProductPriceHistory.product_id.in_(ids),
                ProductPriceHistory.source == PRICE_SOURCE_NAVER,
                ProductPriceHistory.origin == PRICE_ORIGIN_COLLECTED,
            )
        ):
            existing.add((product_id, clock.as_utc(at).astimezone(clock.SEOUL).date()))
    seen: set[tuple[int, date]] = set()
    for row in accepted:
        key = (row.product_id, row.day)
        if key in existing:
            plan.skipped.append((row, "그날 수집 가격이 이미 DB 에 있습니다"))
        elif key in seen:
            plan.skipped.append((row, "같은 파일 앞쪽에 그날 가격이 있습니다"))
        else:
            seen.add(key)
            plan.inserts.append(row)
    return plan, names, []


def import_prices(engine: Engine, path: Path, yes: bool = False, out=print) -> int:
    problems = _check_origin_column(engine)
    if problems:
        return _report(out, "DB 를 먼저 맞춰야 합니다", problems)
    total, accepted, problems = read_csv(path)
    if problems:
        return _report(out, f"수집 기록({path})에 문제가 있습니다", problems)
    with Session(engine) as db:
        plan, names, problems = make_plan(db, total, accepted)
        if problems:
            return _report(out, f"수집 기록({path})을 DB 상품과 맞출 수 없습니다", problems)
        out(f"수집 기록 확인: 행 {plan.rows}개, 채택 {len(plan.accepted)}개")
        for row in plan.inserts:
            out(f"+ {row.product_id} {names[row.product_id]}: 네이버 {row.price_krw:,}원 ({_iso(row.collected_at)})")
        for row, reason in plan.skipped:
            out(f"= {row.product_id} {names[row.product_id]}: {row.day.isoformat()} {reason}. 건너뜁니다.")
        if not plan.inserts:
            out(NOTHING_TO_DO)
            return 0
        if not yes:
            out(f"미리보기입니다(넣을 가격 {len(plan.inserts)}개, 건너뜀 {len(plan.skipped)}개). "
                "아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
            return 0
        try:
            for row in plan.inserts:
                record_external_price(db, row.product_id, PRICE_SOURCE_NAVER, row.price_krw,
                                      recorded_at=row.collected_at, origin=PRICE_ORIGIN_COLLECTED)
            db.commit()
        except Exception:
            db.rollback()
            raise
    out(f"네이버 수집 가격 {len(plan.inserts)}개를 넣었습니다(건너뜀 {len(plan.skipped)}개).")
    return 0


# ---------------------------------------------------------------- 수집 대상

def catalog_queries(directory: Path = CATALOG_DIR) -> dict[str, str]:
    """카탈로그 상품 이름 → 검색어(search_query). 파일이 없으면 빈 값(상품 이름으로 검색한다)."""
    queries: dict[str, str] = {}
    for category in CATEGORIES:
        path = directory / f"{category}.json"
        if path.is_file():
            for item in json.loads(path.read_text(encoding="utf-8")):
                if isinstance(item, dict) and item.get("search_query"):
                    queries[item["name"]] = item["search_query"]
    return queries


def collection_targets(db: Session, limit: int, queries: dict[str, str] | None = None) -> list[dict]:
    """출시된 상품 중 네이버 collected 이력이 가장 오래된 상품부터 limit 개."""
    queries = catalog_queries() if queries is None else queries
    products = list(db.scalars(select(Product).where(released()).order_by(Product.id)))
    latest = dict(db.execute(
        select(ProductPriceHistory.product_id, func.max(ProductPriceHistory.recorded_at))
        .where(ProductPriceHistory.source == PRICE_SOURCE_NAVER, ProductPriceHistory.origin == PRICE_ORIGIN_COLLECTED)
        .group_by(ProductPriceHistory.product_id)
    ).all())
    bind = db.get_bind()
    attributes = {}
    if ProductAttributes.__tablename__ in inspect(bind).get_table_names():
        attributes = {row.product_id: row for row in db.scalars(select(ProductAttributes))}
    oldest = datetime.min

    def order(product: Product):
        last = latest.get(product.id)
        return (last is not None, clock.as_utc(last).replace(tzinfo=None) if last else oldest, product.id)

    targets = []
    for product in sorted(products, key=order)[:limit]:
        extra = attributes.get(product.id)
        targets.append({
            "product_id": product.id, "name": product.name, "category": product.category, "brand": product.brand,
            "query": queries.get(product.name, product.name),
            "model_code": extra.model_code if extra else None,
            "attributes": extra.attributes if extra else {},
            "last_collected_at": _iso(latest.get(product.id)),
        })
    return targets


def write_targets(engine: Engine, limit: int, out_path: Path | None, out=print) -> int:
    problems = _check_origin_column(engine)
    if problems:
        return _report(out, "DB 를 먼저 맞춰야 합니다", problems)
    with Session(engine) as db:
        targets = collection_targets(db, limit)
    if out_path is None:
        out(json.dumps(targets, ensure_ascii=True, indent=1))
    else:
        out_path.write_text(json.dumps(targets, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        out(f"수집 대상 {len(targets)}개를 {out_path} 에 썼습니다.")
    return 0


def _positive_targets(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} is not an integer") from None
    if not 1 <= value <= MAX_TARGETS:
        raise argparse.ArgumentTypeError(f"must be between 1 and {MAX_TARGETS}")
    return value


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.import_collected_prices",
        description="브라우저로 모은 네이버 가격 CSV 를 가격 이력에 넣거나(미리보기 → --yes), 수집 대상 목록을 만든다(--targets).",
    )
    parser.add_argument("csv", nargs="?", type=Path, help="tools/price_collect/collect.mjs 가 쓴 CSV")
    parser.add_argument("--yes", action="store_true", help="실제로 가격 이력을 넣는다")
    parser.add_argument("--targets", type=_positive_targets, metavar="N", help="수집 대상 N 개를 JSON 으로 쓴다")
    parser.add_argument("--out", type=Path, help="--targets 의 JSON 을 쓸 파일(UTF-8). 없으면 표준 출력")
    args = parser.parse_args(argv)
    if (args.csv is None) == (args.targets is None):
        parser.error("CSV 파일과 --targets 중 하나만 주세요")
    if args.targets is not None and args.yes:
        parser.error("--yes 는 CSV 를 넣을 때만 씁니다")
    if args.csv is not None and args.out is not None:
        parser.error("--out 은 --targets 와 함께만 씁니다")
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    if args.targets is not None:
        return write_targets(engine, args.targets, args.out, out=out)
    return import_prices(engine, args.csv, yes=args.yes, out=out)


if __name__ == "__main__":
    sys.exit(main())
