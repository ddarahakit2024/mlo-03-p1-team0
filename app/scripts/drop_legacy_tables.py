"""이전 주제(온라인 강의 판매)의 옛 테이블 `payment_orders`, `courses` 를 백업한 뒤 지운다.

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.drop_legacy_tables          # 미리보기: 있는지와 행 수만 출력, 아무것도 바꾸지 않는다
    .\\.venv\\Scripts\\python.exe -m app.scripts.drop_legacy_tables --yes    # 백업 후 DROP

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- --yes: 먼저 행을 backups/legacy-tables-<UTC 시각>/<테이블>.json 에 저장하고 다시 읽어 행 수를 확인한 뒤,
  payment_orders → courses 순서로 DROP 한다(없는 테이블은 건너뛴다). 백업에 실패하면 아무것도 지우지 않는다.
- backups/ 는 사용자 데이터가 들어 있어 .gitignore 대상이다.
"""
import argparse
import base64
import json
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Engine, column, func, inspect, select, table, text
from sqlalchemy.sql.expression import TableClause

from app.core import clock
from app.db.database import script_engine

# DROP 순서. payment_orders 가 courses 를 참조할 수 있어 먼저 지운다.
LEGACY_TABLES = ("payment_orders", "courses")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BACKUP_ROOT = PROJECT_ROOT / "backups"


class BackupError(RuntimeError):
    pass


def _json_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def existing_tables(engine: Engine) -> list[str]:
    names = set(inspect(engine).get_table_names())
    return [name for name in LEGACY_TABLES if name in names]


def _table(engine: Engine, table_name: str) -> TableClause:
    # 외래 키가 가리키는 테이블까지 따라가 반영(reflect)하지 않도록 컬럼 이름과 타입만 읽는다.
    columns = inspect(engine).get_columns(table_name)
    return table(table_name, *(column(item["name"], item["type"]) for item in columns))


def row_count(engine: Engine, table_name: str) -> int:
    with engine.connect() as connection:
        return connection.scalar(select(func.count()).select_from(table(table_name)))


def backup_table(engine: Engine, table_name: str, directory: Path) -> int:
    """행을 JSON 으로 저장하고 다시 읽어 행 수가 맞는지 확인한다. 저장한 행 수를 돌려준다."""
    legacy = _table(engine, table_name)
    with engine.connect() as connection:
        rows = [dict(row) for row in connection.execute(select(legacy)).mappings()]
    path = directory / f"{table_name}.json"
    payload = {
        "table": table_name,
        "exported_at": clock.utc_now().isoformat().replace("+00:00", "Z"),
        "columns": [item.name for item in legacy.columns],
        "row_count": len(rows),
        "rows": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=_json_value), encoding="utf-8")
    saved = json.loads(path.read_text(encoding="utf-8"))
    if saved.get("row_count") != len(rows) or len(saved.get("rows", [])) != len(rows):
        raise BackupError(f"{path} 의 행 수가 원본과 다릅니다.")
    return len(rows)


def drop_table(engine: Engine, table_name: str) -> None:
    if table_name not in LEGACY_TABLES:  # 이 스크립트는 옛 테이블 두 개만 지운다
        raise ValueError(f"{table_name} is not a legacy table")
    quoted = engine.dialect.identifier_preparer.quote(table_name)
    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE {quoted}"))


def preview(engine: Engine, out=print) -> list[str]:
    found = existing_tables(engine)
    for name in LEGACY_TABLES:
        if name in found:
            out(f"- {name}: 있음, {row_count(engine, name)}행")
        else:
            out(f"- {name}: 없음")
    return found


def run(engine: Engine, yes: bool = False, backup_root: Path = DEFAULT_BACKUP_ROOT, out=print) -> int:
    """종료 코드: 0 성공(미리보기 포함), 1 백업 실패로 중단."""
    out("옛 테이블(payment_orders, courses) 확인:")
    found = preview(engine, out)
    if not yes:
        out("미리보기입니다. 아무것도 바꾸지 않았습니다. 백업 후 지우려면 --yes 를 붙여 다시 실행하세요.")
        return 0
    if not found:
        out("지울 테이블이 없습니다.")
        return 0

    stamp = clock.utc_now().strftime("%Y%m%dT%H%M%SZ")
    directory = Path(backup_root) / f"legacy-tables-{stamp}"
    try:
        directory.mkdir(parents=True, exist_ok=False)
        for name in found:
            saved = backup_table(engine, name, directory)
            out(f"백업: {directory / (name + '.json')} ({saved}행)")
    except Exception as exc:  # 백업이 하나라도 실패하면 지우지 않는다
        out(f"백업에 실패해 아무것도 지우지 않았습니다: {type(exc).__name__}: {exc}")
        return 1

    for name in found:
        drop_table(engine, name)
        out(f"삭제: {name}")
    out(f"완료. 백업 폴더: {directory}")
    return 0


def main(argv: list[str] | None = None, engine: Engine | None = None, backup_root: Path = DEFAULT_BACKUP_ROOT) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.drop_legacy_tables",
        description="옛 테이블(payment_orders, courses)을 JSON 으로 백업한 뒤 지웁니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="백업 후 실제로 DROP 한다")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, backup_root=backup_root)


if __name__ == "__main__":
    sys.exit(main())
