"""상품 카탈로그(app/catalog/<category>.json)의 형식·검증·성능 지수. docs/specs/2026-11-01-product-catalog.md

- load_catalog(): 8개 파일을 모두 읽고 검증한다. 틀린 곳을 모두 모아 CatalogError 하나로 알린다(하나라도 틀리면 쓰지 않는다).
- require_complete=False 는 작성 중인 카탈로그용이다(가격·개수·사진 파일을 아직 확인하지 않는다).
- performance_score(): 카테고리별 공식(spec "벤치마크와 성능 지수"). 결과는 1~100000.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, ValidationError, field_validator, model_validator

CATALOG_DIR = Path(__file__).resolve().parents[1] / "catalog"
CATEGORIES = ("cpu", "mainboard", "memory", "gpu", "storage", "psu", "case", "cooler")
# 카테고리당 상품 수. 목표는 55개이고, 새 상품으로 팔리지 않아 가격을 모으지 못한 상품은 빼므로 50개까지 허용한다
# (사용자 결정: 카테고리당 50개 이상. docs/specs/2026-11-01-product-catalog.md)
PRODUCTS_PER_CATEGORY = 55
MIN_PRODUCTS_PER_CATEGORY = 50
MIN_SCORE, MAX_SCORE = 1, 100_000
REQUIRED_BENCHMARKS = {"cpu": "passmark_cpu_mark", "gpu": "passmark_g3d_mark"}
SOCKETS = Literal["AM4", "AM5", "LGA1700", "LGA1851"]

Text = Annotated[str, Field(min_length=1)]
PositiveInt = Annotated[StrictInt, Field(gt=0)]
NonNegativeInt = Annotated[StrictInt, Field(ge=0)]
PositiveFloat = Annotated[float, Field(gt=0)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- 카테고리별 attributes

class CpuAttributes(_Strict):
    socket: SOCKETS
    cores: PositiveInt
    threads: PositiveInt
    base_clock_ghz: PositiveFloat
    boost_clock_ghz: PositiveFloat
    tdp_w: PositiveInt
    memory_type: Literal["DDR4", "DDR5", "DDR4/DDR5"]
    integrated_graphics: StrictBool
    generation: Text
    cooler_included: StrictBool


MAINBOARD_CHIPSET_BASE = {
    **dict.fromkeys(("A520", "A620", "H610", "H810"), 10_000),
    **dict.fromkeys(("B550", "B650", "B760", "B840", "B850", "B860"), 20_000),
    **dict.fromkeys(("X570", "X670", "X870", "Z790", "Z890"), 30_000),
    **dict.fromkeys(("X670E", "X870E"), 35_000),
}


class MainboardAttributes(_Strict):
    socket: SOCKETS
    chipset: Literal[tuple(MAINBOARD_CHIPSET_BASE)]  # type: ignore[valid-type]
    form_factor: Literal["ATX", "Micro-ATX", "Mini-ITX", "E-ATX"]
    memory_type: Literal["DDR4", "DDR5"]
    memory_slots: Literal[2, 4, 8]
    max_memory_gb: PositiveInt
    m2_slots: Annotated[StrictInt, Field(ge=0, le=8)]
    wifi: StrictBool
    pcie_gen: Literal[3, 4, 5]


class MemoryAttributes(_Strict):
    memory_type: Literal["DDR4", "DDR5"]
    capacity_gb: PositiveInt
    modules: Annotated[StrictInt, Field(ge=1, le=8)]
    speed_mts: PositiveInt
    cas_latency: PositiveInt
    rgb: StrictBool
    # CUDIMM(클록 드라이버 내장) 모듈. 정격 속도는 LGA1851 메인보드에서만 보장된다(호환성 규칙 CUDIMM_LIMITED)
    cudimm: StrictBool


class GpuAttributes(_Strict):
    chip_maker: Literal["NVIDIA", "AMD", "Intel"]
    gpu_chip: Text
    vram_gb: PositiveInt
    memory_type: Literal["GDDR6", "GDDR6X", "GDDR7"]
    board_power_w: PositiveInt
    length_mm: PositiveInt
    power_connector: Text
    recommended_psu_w: PositiveInt


class StorageAttributes(_Strict):
    interface: Literal["PCIe 3.0", "PCIe 4.0", "PCIe 5.0", "SATA"]
    form_factor: Literal["M.2 2280", "2.5형"]
    capacity_gb: PositiveInt
    seq_read_mbs: PositiveInt
    seq_write_mbs: PositiveInt
    tbw: PositiveInt
    dram_cache: StrictBool


PSU_EFFICIENCY_FACTOR = {
    "80PLUS STANDARD": 1.00, "80PLUS BRONZE": 1.03, "80PLUS SILVER": 1.05,
    "80PLUS GOLD": 1.08, "80PLUS PLATINUM": 1.12, "80PLUS TITANIUM": 1.15,
}


class PsuAttributes(_Strict):
    wattage_w: PositiveInt
    efficiency: Literal[tuple(PSU_EFFICIENCY_FACTOR)]  # type: ignore[valid-type]
    modular: Literal["full", "semi", "none"]
    form_factor: Literal["ATX", "SFX", "SFX-L"]
    atx_version: Text
    has_12v_2x6: StrictBool


class CaseAttributes(_Strict):
    case_type: Literal["미들타워", "빅타워", "미니타워", "미니ITX"]
    motherboard_support: Annotated[list[Literal["E-ATX", "ATX", "Micro-ATX", "Mini-ITX"]], Field(min_length=1)]
    max_gpu_length_mm: PositiveInt
    max_cpu_cooler_height_mm: PositiveInt
    max_radiator_mm: NonNegativeInt
    included_fans: NonNegativeInt


class CoolerAttributes(_Strict):
    cooler_type: Literal["air", "liquid"]
    sockets: Annotated[list[Text], Field(min_length=1)]
    fan_count: NonNegativeInt
    height_mm: PositiveInt | None
    radiator_mm: Literal[120, 140, 240, 280, 360, 420, 480] | None
    tdp_rating_w: PositiveInt | None

    @model_validator(mode="after")
    def shape_matches_type(self):
        if self.cooler_type == "air" and (self.height_mm is None or self.radiator_mm is not None):
            raise ValueError("air cooler needs height_mm and radiator_mm null")
        if self.cooler_type == "liquid" and (self.radiator_mm is None or self.height_mm is not None):
            raise ValueError("liquid cooler needs radiator_mm and height_mm null")
        return self


ATTRIBUTE_MODELS: dict[str, type[_Strict]] = {
    "cpu": CpuAttributes, "mainboard": MainboardAttributes, "memory": MemoryAttributes, "gpu": GpuAttributes,
    "storage": StorageAttributes, "psu": PsuAttributes, "case": CaseAttributes, "cooler": CoolerAttributes,
}


# ---------------------------------------------------------------- 상품 한 줄

class SpecLine(_Strict):
    label: Annotated[str, Field(min_length=1, max_length=30)]
    value: Annotated[str, Field(min_length=1, max_length=120)]


class Benchmark(_Strict):
    name: Annotated[str, Field(pattern=r"^[a-z0-9_]{3,50}$")]
    score: PositiveFloat
    source_url: Annotated[str, Field(pattern=r"^https?://", max_length=500)]


class PriceSource(_Strict):
    site: Literal["naver", "coupang"]
    krw: Annotated[StrictInt, Field(ge=1000, le=100_000_000)]
    title: Annotated[str, Field(min_length=1, max_length=300)]
    url: Annotated[str, Field(pattern=r"^https?://", max_length=2000)]


class CatalogPrice(_Strict):
    krw: Annotated[StrictInt, Field(ge=1000, le=100_000_000)]
    collected_at: date
    sources: Annotated[list[PriceSource], Field(min_length=1, max_length=2)]

    @model_validator(mode="after")
    def one_line_per_site(self):
        if len({source.site for source in self.sources}) != len(self.sources):
            raise ValueError("price.sources: one entry per site")
        return self


class CatalogImage(_Strict):
    file: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]*\.webp$", max_length=120)]
    source_url: Annotated[str, Field(pattern=r"^https?://", max_length=2000)] | None = None


class CatalogProduct(_Strict):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    brand: Annotated[str, Field(min_length=1, max_length=100)]
    category: Literal[CATEGORIES]  # type: ignore[valid-type]
    model_code: Annotated[str, Field(min_length=1, max_length=100)]
    series: Annotated[str, Field(min_length=1, max_length=100)]
    released_on: date
    summary: Annotated[str, Field(min_length=1, max_length=500)]
    description: Annotated[str, Field(min_length=1, max_length=2000)]
    specs: Annotated[list[SpecLine], Field(min_length=3, max_length=8)]
    attributes: dict[str, Any]
    benchmarks: list[Benchmark] = Field(default_factory=list)
    price: CatalogPrice | None = None
    search_query: Annotated[str, Field(min_length=1, max_length=100)]
    image: CatalogImage

    @field_validator("benchmarks")
    @classmethod
    def unique_benchmarks(cls, benchmarks: list[Benchmark]) -> list[Benchmark]:
        if len({item.name for item in benchmarks}) != len(benchmarks):
            raise ValueError("benchmark names must be unique")
        return benchmarks

    @model_validator(mode="after")
    def attributes_match_category(self):
        model = ATTRIBUTE_MODELS[self.category]
        self.attributes = model.model_validate(self.attributes).model_dump()
        required = REQUIRED_BENCHMARKS.get(self.category)
        if required and required not in {item.name for item in self.benchmarks}:
            raise ValueError(f"{self.category} needs benchmark {required}")
        return self

    @property
    def thumbnail_url(self) -> str:
        return f"/images/products/{self.image.file}"

    def benchmark(self, name: str) -> float | None:
        return next((item.score for item in self.benchmarks if item.name == name), None)


# ---------------------------------------------------------------- 성능 지수

def _clamp(value: float) -> int:
    return max(MIN_SCORE, min(MAX_SCORE, round(value)))


def performance_score(product: CatalogProduct) -> int:
    """같은 카테고리 안에서만 비교하는 성능 지수(spec 의 공식)."""
    a = product.attributes
    match product.category:
        case "cpu" | "gpu":
            return _clamp(product.benchmark(REQUIRED_BENCHMARKS[product.category]))
        case "memory":
            return _clamp(a["capacity_gb"] * a["speed_mts"] / a["cas_latency"] * 5)
        case "storage":
            return _clamp(a["capacity_gb"] * a["seq_read_mbs"] / 1000)
        case "psu":
            return _clamp(a["wattage_w"] * PSU_EFFICIENCY_FACTOR[a["efficiency"]] * 10)
        case "mainboard":
            return _clamp(MAINBOARD_CHIPSET_BASE[a["chipset"]] + a["m2_slots"] * 2000 + (3000 if a["wifi"] else 0)
                          + a["memory_slots"] * 500)
        case "case":
            return _clamp(a["max_gpu_length_mm"] * 10 + a["max_radiator_mm"] * 20 + a["included_fans"] * 1000)
        case "cooler":
            if a["cooler_type"] == "liquid":
                return _clamp(a["radiator_mm"] * 50)
            return _clamp(a["fan_count"] * 4000 + a["height_mm"] * 50)
    raise ValueError(f"unknown category {product.category}")


# ---------------------------------------------------------------- 파일 읽기·검증

class CatalogError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__(f"{len(problems)} catalog problem(s):\n" + "\n".join(problems[:50]))


def load_catalog(
    directory: Path = CATALOG_DIR, *, today: date, require_complete: bool = True, images_dir: Path | None = None,
    categories: tuple[str, ...] = CATEGORIES,
) -> dict[str, list[CatalogProduct]]:
    """카테고리 → 상품 목록. 틀린 곳이 하나라도 있으면 모두 모아 CatalogError."""
    problems: list[str] = []
    catalog: dict[str, list[CatalogProduct]] = {}
    for category in categories:
        path = directory / f"{category}.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            problems.append(f"{category}: missing file {path.name}")
            continue
        except json.JSONDecodeError as error:
            problems.append(f"{category}: not JSON ({error})")
            continue
        if not isinstance(raw, list):
            problems.append(f"{category}: the file must be a JSON array")
            continue
        products = []
        for index, item in enumerate(raw):
            label = f"{category}[{index}] {item.get('name', '?') if isinstance(item, dict) else '?'}"
            try:
                product = CatalogProduct.model_validate(item)
            except ValidationError as error:
                details = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors())
                problems.append(f"{label}: {details}")
                continue
            if product.category != category:
                problems.append(f"{label}: category {product.category} is in {category}.json")
            if product.released_on > today:
                problems.append(f"{label}: released_on {product.released_on} is after {today}")
            if require_complete and product.price is None:
                problems.append(f"{label}: price is missing")
            if images_dir is not None and not (images_dir / product.image.file).is_file():
                problems.append(f"{label}: image file {product.image.file} is missing")
            products.append(product)
        if require_complete and not MIN_PRODUCTS_PER_CATEGORY <= len(raw) <= PRODUCTS_PER_CATEGORY:
            problems.append(
                f"{category}: {len(raw)} products (needs {MIN_PRODUCTS_PER_CATEGORY}~{PRODUCTS_PER_CATEGORY})")
        catalog[category] = products
    everything = [product for products in catalog.values() for product in products]
    for field, value_of in (("name", lambda p: p.name), ("model_code", lambda p: p.model_code),
                            ("image.file", lambda p: p.image.file)):
        seen: dict[str, str] = {}
        for product in everything:
            value = value_of(product)
            if value in seen:
                problems.append(f"duplicate {field} {value!r}: {seen[value]} and {product.category}")
            seen[value] = product.category
    if problems:
        raise CatalogError(problems)
    return catalog
