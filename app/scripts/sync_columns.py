"""이미 있는 테이블에 모델의 새 컬럼과 그 인덱스·외래 키를 더한다(추가만).

앱은 시작할 때 없는 테이블만 만들고(create_all) 이미 있는 테이블에는 컬럼을 더하지 않는다. 그래서 모델에 컬럼을 더하면
이미 테이블이 있는 DB(운영 RDS, 로컬 Docker 볼륨)에는 이 스크립트로 더한다. docs/specs/2026-11-01-build-id-purpose.md

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_columns          # 미리보기: 실행할 DDL 만 출력, 아무것도 바꾸지 않는다
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_columns --yes    # 실행
    docker compose exec backend python -m app.scripts.sync_columns [--yes]   # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- 더하는 것은 ADDED_COLUMNS 의 컬럼과 모델이 그 컬럼에 정의한 인덱스·외래 키뿐이다. 지우거나 바꾸지 않는다.
- 새 버전의 앱은 이 컬럼을 읽으므로 새 버전을 시작하기 전(늦어도 시작한 바로 뒤)에 실행한다. app.scripts.sync_indexes 보다 먼저
  실행한다(새 컬럼의 인덱스는 이 스크립트가 만든다. 컬럼이 없으면 sync_indexes 의 CREATE INDEX 가 실패한다).
- 컬럼마다 순서는 "컬럼 → 인덱스 → 외래 키". MariaDB 는 외래 키 열로 시작하는 인덱스가 없으면 외래 키 이름으로 인덱스를
  따로 만들므로 모델의 인덱스를 먼저 만든다. 외래 키가 가리키는 테이블(builds)이 아직 없으면(새 버전 앱을 시작하기 전)
  모델 정의대로 맨 먼저 만든다(앱 시작의 create_all 이 만드는 것과 같다).
- SQLite 는 ALTER TABLE ... ADD CONSTRAINT 가 없어 외래 키를 ADD COLUMN 문에 함께 쓴다(REFERENCES). 그래서 이미 있는
  컬럼에는 외래 키를 더할 수 없다. 그런 컬럼은 바꾸지 않고 종료 코드 1 로 사람에게 알린다.
- 이미 있는 것은 건너뛴다. 다시 실행하면 "더할 컬럼이 없습니다."가 나온다. 테이블이 없으면 건너뛴다(앱 시작 때
  create_all 이 컬럼과 함께 만든다).
- DDL 하나가 실패하면 거기서 멈춘다(종료 코드 1). 이미 실행한 DDL 은 남고, 다시 실행하면 남은 것만 한다.
"""
import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import Column, Engine, ForeignKey, MetaData, Table, inspect
from sqlalchemy.engine import Dialect
from sqlalchemy.schema import AddConstraint, CreateTable

from app import models  # noqa: F401 - 모든 모델을 Base.metadata 에 등록한다
from app.db.database import Base, script_engine
from app.scripts.sync_indexes import create_ddl, execute_ddl

# 모델에 더한 컬럼(테이블, 컬럼). 기존 행에 값이 없으므로 NULL 을 허용하는 컬럼만 넣는다.
ADDED_COLUMNS = (
    ("cart_items", "build_id"),  # docs/specs/2026-11-01-build-id-purpose.md
    ("product_order_items", "build_id"),
    ("user_profiles", "role"),  # docs/specs/2026-11-01-returns-refunds.md(외래 키·인덱스 없음)
    ("product_price_history", "origin"),  # docs/specs/2026-11-01-market-model.md(외래 키·인덱스 없음)
    # MOA Parts 개편(2026-11-05)
    ("questions", "product_id"),  # 외래 키 products.id, 인덱스 ix_questions_product_id
    ("questions", "view_count"),
    ("questions", "accepted_answer_id"),  # 외래 키 없음
    ("community_posts", "monitor_resolution"),
    ("community_posts", "preferences"),
    ("cart_items", "added_price_krw"),
)


@dataclass
class Step:
    title: str
    ddl: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _one_line(ddl: str) -> str:
    return " ".join(ddl.split())


def add_column_ddl(column: Column, dialect: Dialect, inline_foreign_keys: bool = False) -> str:
    """ALTER TABLE <표> ADD COLUMN <모델의 컬럼 정의>. inline_foreign_keys 면 외래 키를 REFERENCES 로 함께 쓴다(SQLite)."""
    preparer = dialect.identifier_preparer
    spec = dialect.ddl_compiler(dialect, None).get_column_specification(column)
    ddl = f"ALTER TABLE {preparer.format_table(column.table)} ADD COLUMN {spec}"
    if inline_foreign_keys:
        for foreign_key in sorted(column.foreign_keys, key=lambda item: item.target_fullname):
            name = foreign_key.constraint.name
            prefix = f"CONSTRAINT {preparer.quote(name)} " if name else ""
            target = foreign_key.column
            ddl += f" {prefix}REFERENCES {preparer.format_table(target.table)} ({preparer.quote(target.name)})"
    return ddl


def add_foreign_key_ddl(foreign_key: ForeignKey, dialect: Dialect) -> str:
    # AddConstraint 는 만들 때 모델의 제약 객체를 "CREATE TABLE 에 쓰지 않음"으로 바꾼다(isolate_from_table 기본값).
    # 모델 메타데이터는 프로세스 전체가 같이 쓰므로(앱의 create_all, 테스트) DDL 문자열만 만들고 원래대로 돌려 둔다.
    # isolate_from_table=False 는 SQLAlchemy 2.0.39 부터라 requirements(>=2.0)의 모든 버전에서 되도록 이렇게 한다.
    constraint = foreign_key.constraint
    create_rule = constraint._create_rule
    try:
        return _one_line(str(AddConstraint(constraint).compile(dialect=dialect)))
    finally:
        constraint._create_rule = create_rule


def create_table_ddl(table: Table, dialect: Dialect) -> list[str]:
    """CREATE TABLE 과 그 테이블의 인덱스(create_all 과 같은 순서)."""
    return [
        _one_line(str(CreateTable(table).compile(dialect=dialect))),
        *(create_ddl(index, dialect) for index in sorted(table.indexes, key=lambda item: item.name)),
    ]


def _has_foreign_key(found: list[dict], column_name: str, foreign_key: ForeignKey) -> bool:
    # 이름은 보지 않는다(SQLite 는 ADD COLUMN 의 REFERENCES 이름을 돌려주지 않는다). 열과 가리키는 테이블로 찾는다.
    return any(
        item["constrained_columns"] == [column_name] and item["referred_table"] == foreign_key.column.table.name
        for item in found
    )


def plan(
    engine: Engine, metadata: MetaData = Base.metadata, dialect: Dialect | None = None,
) -> tuple[list[Step], list[str]]:
    """(실행할 단계들, 건너뛴 테이블 안내). dialect 는 DDL 을 만들 방언이다(기본: engine 의 방언)."""
    dialect = engine.dialect if dialect is None else dialect
    inline_foreign_keys = dialect.name == "sqlite"
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    steps: list[Step] = []
    skipped: list[str] = []
    referred_tables: list[Table] = []  # 외래 키가 가리키는데 아직 없는 테이블(먼저 만든다)

    for table_name, column_name in ADDED_COLUMNS:
        if table_name not in existing:
            skipped.append(f"- {table_name}: 테이블 없음, 건너뜀(앱 시작 때 create_all 이 {column_name} 과 함께 만든다)")
            continue
        table = metadata.tables[table_name]
        column = table.c[column_name]
        has_column = column_name in {item["name"] for item in inspector.get_columns(table_name)}
        found_indexes = {item["name"] for item in inspector.get_indexes(table_name)}
        found_foreign_keys = inspector.get_foreign_keys(table_name) if has_column else []
        step = Step(f"- {table_name}.{column_name}")

        missing_foreign_keys = [
            foreign_key for foreign_key in sorted(column.foreign_keys, key=lambda item: item.target_fullname)
            if not _has_foreign_key(found_foreign_keys, column_name, foreign_key)
        ]
        if not has_column:
            step.ddl.append(add_column_ddl(column, dialect, inline_foreign_keys=inline_foreign_keys))
        for index in sorted(table.indexes, key=lambda item: item.name):
            if column_name in index.columns and index.name not in found_indexes:
                step.ddl.append(create_ddl(index, dialect))
        for foreign_key in missing_foreign_keys:
            if inline_foreign_keys and has_column:
                step.warnings.append(
                    f"! {foreign_key.constraint.name or column_name}: SQLite 는 이미 있는 컬럼에 외래 키를 더할 수 없어 "
                    "건너뜁니다. 사람이 확인해 주세요."
                )
                continue
            if not inline_foreign_keys:
                step.ddl.append(add_foreign_key_ddl(foreign_key, dialect))
            target = foreign_key.column.table
            if target.name not in existing and target not in referred_tables:
                referred_tables.append(target)
        if step.ddl or step.warnings:
            steps.append(step)

    creates = [
        Step(f"- {table.name}: 테이블 없음, 외래 키가 가리키므로 먼저 만든다", ddl=create_table_ddl(table, dialect))
        for table in referred_tables
    ]
    return creates + steps, skipped


def run(engine: Engine, yes: bool = False, out=print) -> int:
    """종료 코드: 0 성공(미리보기 포함), 1 더하지 못한 외래 키가 있거나 DDL 이 실패함."""
    steps, skipped = plan(engine)
    for line in skipped:
        out(line)
    if not steps:
        out("더할 컬럼이 없습니다.")
        return 0

    statements, warned = [], False
    for step in steps:
        out(step.title)
        for warning in step.warnings:
            warned = True
            out(f"  {warning}")
        for ddl in step.ddl:
            statements.append(ddl)
            out(f"  + {ddl}")

    if not yes:
        out("미리보기입니다. 아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
        return 1 if warned else 0

    for ddl in statements:
        try:
            execute_ddl(engine, ddl)
        except Exception as exc:
            out(f"실패: {ddl}")
            out(f"  {type(exc).__name__}: {exc}")
            out("여기서 멈췄습니다. 이미 실행한 DDL 은 남아 있습니다. 원인을 고친 뒤 다시 실행하면 남은 것만 합니다.")
            return 1
        out(f"실행: {ddl}")
    out("완료." if not warned else "완료(외래 키를 더하지 못한 컬럼은 그대로 두었습니다).")
    return 1 if warned else 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.sync_columns",
        description="이미 있는 테이블에 모델의 새 컬럼(과 그 인덱스·외래 키)을 더합니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="실제로 ALTER TABLE / CREATE INDEX 를 실행한다")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, out=out)


if __name__ == "__main__":
    sys.exit(main())
