"""이미 있는 테이블의 인덱스를 모델 정의에 맞춘다: 빠진 인덱스를 만들고, 모델에서 뺀 인덱스를 지운다.

앱은 시작할 때 없는 테이블만 만들고(create_all) 기존 테이블의 인덱스는 바꾸지 않는다. 그래서 모델의 인덱스를 바꾸면
이미 테이블이 있는 DB(운영 RDS, 로컬 Docker 볼륨)에는 이 스크립트로 맞춘다. docs/specs/2026-10-31-db-indexes-pool.md

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_indexes          # 미리보기: 실행할 DDL 만 출력, 아무것도 바꾸지 않는다
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_indexes --yes    # 실행
    docker compose exec backend python -m app.scripts.sync_indexes [--yes]   # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- 순서는 언제나 "모두 만들기 → 지우기". 외래 키 열의 예전 단일 인덱스는 그 열로 시작하는 새 인덱스가 생긴 뒤에야
  지울 수 있다(MariaDB 오류 1553).
- 모델에 없는 그 밖의 인덱스(외래 키 자동 인덱스, UNIQUE 제약 등)는 건드리지 않는다. 지우는 것은 OBSOLETE_INDEXES 뿐이다.
- 이름은 같은데 컬럼이 다르면 그 인덱스를 바꾸지 않고, 그 테이블의 지우기도 하지 않는다. 종료 코드 1 로 사람에게 알린다.
- DDL 하나가 실패하면 거기서 멈춘다(종료 코드 1). 이미 실행한 DDL 은 남고, 다시 실행하면 남은 것만 한다.
"""
import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import Column, Engine, Index, Integer, MetaData, Table, inspect
from sqlalchemy.engine import Dialect
from sqlalchemy.schema import CreateIndex, DropIndex

from app import models  # noqa: F401 - 모든 모델을 Base.metadata 에 등록한다
from app.db.database import Base, script_engine

# 모델에서 뺀 인덱스(테이블, 이름). 앞부분이 다른 인덱스와 겹쳐 쓸모가 없다(같은 값을 두 번 갱신만 한다).
OBSOLETE_INDEXES = (
    ("product_orders", "ix_product_orders_buyer_subject"),  # → ix_product_orders_buyer_created
    ("product_price_history", "ix_product_price_history_product_id"),  # → ix_..._product_source_recorded
    ("product_reviews", "ix_product_reviews_product_id"),  # → ix_..._product_created, UNIQUE(product_id, author_subject)
    ("question_answers", "ix_question_answers_question_id"),  # → ix_question_answers_question_created
    ("cart_items", "ix_cart_items_owner_subject"),  # → UNIQUE(owner_subject, product_id)
    ("users", "ix_users_id"),  # 기본 키(id)와 같다
)


@dataclass
class TablePlan:
    table: str
    create: list[Index] = field(default_factory=list)
    drop: list[tuple[str, list[str]]] = field(default_factory=list)  # (이름, DB 의 컬럼)
    mismatched: list[tuple[str, list[str], list[str]]] = field(default_factory=list)  # (이름, DB 컬럼, 모델 컬럼)


def create_ddl(index: Index, dialect: Dialect) -> str:
    return str(CreateIndex(index).compile(dialect=dialect)).strip()


def drop_ddl(table_name: str, index_name: str, columns: list[str], dialect: Dialect) -> str:
    # MariaDB 는 "DROP INDEX 이름 ON 테이블" 이라 테이블이 붙은 Index 객체가 필요하다. 이름과 컬럼만 가진 임시 표로 만든다.
    table = Table(table_name, MetaData(), *(Column(name, Integer) for name in columns))
    return str(DropIndex(Index(index_name, *(table.c[name] for name in columns))).compile(dialect=dialect)).strip()


def execute_ddl(engine: Engine, ddl: str) -> None:
    # MariaDB 에서 DDL 은 문장마다 바로 커밋된다. 문장마다 따로 실행해 실패 지점을 정확히 알린다.
    with engine.begin() as connection:
        connection.exec_driver_sql(ddl)


def plan(engine: Engine, metadata: MetaData = Base.metadata) -> tuple[list[TablePlan], list[str]]:
    """(바꿀 테이블들의 계획, DB 에 없는 테이블 이름들)."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    obsolete: dict[str, list[str]] = {}
    for table_name, index_name in OBSOLETE_INDEXES:
        obsolete.setdefault(table_name, []).append(index_name)

    plans, missing = [], []
    for table_name in sorted(set(metadata.tables) | set(obsolete)):
        if table_name not in existing:
            missing.append(table_name)
            continue
        found = {item["name"]: list(item["column_names"]) for item in inspector.get_indexes(table_name)}
        table_plan = TablePlan(table_name)
        model_table = metadata.tables.get(table_name)
        for index in sorted(model_table.indexes if model_table is not None else (), key=lambda item: item.name):
            wanted = [column.name for column in index.columns]
            if index.name not in found:
                table_plan.create.append(index)
            elif found[index.name] != wanted:
                table_plan.mismatched.append((index.name, found[index.name], wanted))
        if not table_plan.mismatched:  # 대신할 인덱스가 맞지 않으면 예전 인덱스를 지우지 않는다
            table_plan.drop = [(name, found[name]) for name in obsolete.get(table_name, ()) if name in found]
        if table_plan.create or table_plan.drop or table_plan.mismatched:
            plans.append(table_plan)
    return plans, missing


def run(engine: Engine, yes: bool = False, out=print) -> int:
    """종료 코드: 0 성공(미리보기 포함), 1 이름은 같은데 컬럼이 다른 인덱스가 있거나 DDL 이 실패함."""
    plans, missing = plan(engine)
    for table_name in missing:
        out(f"- {table_name}: 테이블 없음, 건너뜀(앱 시작 때 create_all 이 인덱스와 함께 만든다)")
    if not plans:
        out("맞출 인덱스가 없습니다.")
        return 0

    dialect = engine.dialect
    creates, drops, mismatched = [], [], False
    for table_plan in plans:
        out(f"- {table_plan.table}")
        for name, in_db, in_model in table_plan.mismatched:
            mismatched = True
            out(f"  ! {name}: 이름은 같지만 컬럼이 다릅니다(DB {in_db}, 모델 {in_model}). "
                "바꾸지 않고, 이 테이블의 예전 인덱스도 지우지 않습니다. 사람이 확인해 주세요.")
        for index in table_plan.create:
            creates.append(create_ddl(index, dialect))
            out(f"  + {creates[-1]}")
        for name, columns in table_plan.drop:
            drops.append(drop_ddl(table_plan.table, name, columns, dialect))
            out(f"  - {drops[-1]}")

    if not yes:
        out("미리보기입니다. 아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
        return 1 if mismatched else 0

    for ddl in creates + drops:  # 모두 만든 뒤에 지운다
        try:
            execute_ddl(engine, ddl)
        except Exception as exc:
            out(f"실패: {ddl}")
            out(f"  {type(exc).__name__}: {exc}")
            out("여기서 멈췄습니다. 이미 실행한 DDL 은 남아 있습니다. 원인을 고친 뒤 다시 실행하면 남은 것만 합니다.")
            return 1
        out(f"실행: {ddl}")
    out("완료." if not mismatched else "완료(컬럼이 다른 인덱스는 그대로 두었습니다).")
    return 1 if mismatched else 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.sync_indexes",
        description="이미 있는 테이블의 인덱스를 모델 정의에 맞춥니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="실제로 CREATE INDEX / DROP INDEX 를 실행한다")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, out=out)


if __name__ == "__main__":
    sys.exit(main())
