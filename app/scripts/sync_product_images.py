"""이미 있는 DB 의 빈 상품 이미지(thumbnail_url)를 카탈로그 사진 경로로 채운다. docs/specs/2026-11-01-community-dark-theme.md

시드(app/scripts/seed_products.py)는 products 가 비어 있을 때만 상품을 넣는다. 그래서 시드에 이미지 경로를 넣기 전에 시드한 DB
(운영 RDS, 로컬 Docker 볼륨)는 thumbnail_url 이 빈 값으로 남아 있다. 이 스크립트로 채운다.
상품 이름과 사진은 카탈로그(app/catalog/*.json, docs/specs/2026-11-01-product-catalog.md)에서 읽는다. 카탈로그 전체를 맞추는
것(사진 포함)은 `python -m app.scripts.import_catalog` 이고, 이 스크립트는 빈 사진만 채운다.

실행(저장소 루트에서):
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_product_images          # 미리보기: 채울 상품만 출력, 아무것도 바꾸지 않는다
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_product_images --yes    # 실행
    .\\.venv\\Scripts\\python.exe -m app.scripts.sync_product_images --catalog-dir <폴더>   # 다른 카탈로그 폴더(기본 app/catalog)
    docker compose exec backend python -m app.scripts.sync_product_images [--yes]   # 로컬 Docker

- 접속 대상은 앱과 같은 설정(DATABASE_URL 또는 DB_*). 운영 RDS 에는 사람이 실행한다.
- 이름이 카탈로그 상품과 글자 그대로 같고 thumbnail_url 이 빈 값("")인 상품만 채운다. 이미 값이 있으면(사람이 바꾼 이미지
  포함) 그대로 둔다. 카탈로그에 없는 상품도 건드리지 않는다.
- 다시 실행하면 할 일이 없다("채울 상품 이미지가 없습니다."). 종료 코드는 0, 카탈로그가 틀리면 아무것도 바꾸지 않고 2
  (인자가 틀려도 argparse 의 2).
"""
import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Engine, inspect, select, update
from sqlalchemy.orm import Session

from app.core.catalog_schema import CATALOG_DIR, CatalogError
from app.db.database import script_engine
from app.scripts.import_catalog import EXIT_INVALID, load_validated_catalog
from app.models import Product

NOTHING_TO_DO = "채울 상품 이미지가 없습니다."


@dataclass(frozen=True)
class Target:
    product_id: int
    name: str
    thumbnail_url: str


def catalog_images(catalog_dir: Path = CATALOG_DIR) -> dict[str, str]:
    """카탈로그 상품 이름 → 이미지 경로(프런트 주소 기준 /images/products/<파일>.webp). 카탈로그가 틀리면 CatalogError."""
    return {item.name: item.thumbnail_url for item in load_validated_catalog(catalog_dir)}


def plan(db: Session, images: dict[str, str]) -> list[Target]:
    """채울 상품(id 순). 이름 비교는 파이썬에서 글자 그대로 한다(MariaDB 의 대소문자 무시 비교에 기대지 않는다)."""
    rows = db.execute(select(Product.id, Product.name).where(Product.thumbnail_url == "").order_by(Product.id)).all()
    return [Target(product_id, name, images[name]) for product_id, name in rows if name in images]


def run(engine: Engine, yes: bool = False, out=print, catalog_dir: Path = CATALOG_DIR) -> int:
    try:
        images = catalog_images(catalog_dir)
    except CatalogError as error:
        out(f"카탈로그({catalog_dir})에 문제가 있습니다({len(error.problems)}개). 아무것도 바꾸지 않았습니다:")
        for problem in error.problems:
            out(f"- {problem}")
        return EXIT_INVALID
    if not inspect(engine).has_table(Product.__tablename__):
        out(f"- products: 테이블 없음. {NOTHING_TO_DO}")
        return 0
    with Session(engine) as db:
        targets = plan(db, images)
        if not targets:
            out(NOTHING_TO_DO)
            return 0
        for target in targets:
            out(f"- {target.product_id} {target.name}: (빈 값) → {target.thumbnail_url}")
        if not yes:
            out(f"미리보기입니다({len(targets)}개). 아무것도 바꾸지 않았습니다. 실행하려면 --yes 를 붙여 다시 실행하세요.")
            return 0
        filled = 0
        for target in targets:
            # 읽은 뒤 누가 값을 넣었으면 덮어쓰지 않도록 빈 값일 때만 바꾼다.
            filled += db.execute(
                update(Product)
                .where(Product.id == target.product_id, Product.thumbnail_url == "")
                .values(thumbnail_url=target.thumbnail_url),
                execution_options={"synchronize_session": False},
            ).rowcount
        db.commit()
    out(f"상품 이미지 {filled}개를 채웠습니다.")
    return 0


def main(argv: list[str] | None = None, engine: Engine | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.scripts.sync_product_images",
        description="카탈로그 상품의 빈 thumbnail_url 을 카탈로그 사진 경로로 채웁니다. 인자 없이 실행하면 미리보기만 합니다.",
    )
    parser.add_argument("--yes", action="store_true", help="실제로 thumbnail_url 을 채운다")
    parser.add_argument("--catalog-dir", type=Path, default=CATALOG_DIR, help="카탈로그 폴더(기본 app/catalog)")
    args = parser.parse_args(argv)
    engine = script_engine(engine)  # 테스트가 넘긴 엔진, 없으면 앱과 같은 접속 설정
    return run(engine, yes=args.yes, out=out, catalog_dir=args.catalog_dir)


if __name__ == "__main__":
    sys.exit(main())
