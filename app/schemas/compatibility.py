"""부품 호환성 확인(POST /compatibility/check) 요청·응답. docs/specs/2026-11-01-compatibility-rules.md "API 계약"."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.product import MAX_ID

MAX_COMPATIBILITY_LINES = 30
MAX_COMPATIBILITY_QUANTITY = 10


class CompatibilityLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int = Field(ge=1, le=MAX_ID, strict=True)
    quantity: int = Field(ge=1, le=MAX_COMPATIBILITY_QUANTITY, strict=True)


class CompatibilityCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CompatibilityLine] = Field(min_length=1, max_length=MAX_COMPATIBILITY_LINES)

    @field_validator("items")
    @classmethod
    def unique_products(cls, items: list[CompatibilityLine]) -> list[CompatibilityLine]:
        if len({item.product_id for item in items}) != len(items):
            raise ValueError("Duplicate product_id")
        return items


class CompatibilityIssue(BaseModel):
    code: str
    level: Literal["error", "warning", "info"]
    message: str
    product_ids: list[int]


class CompatibilityBalance(BaseModel):
    score: float
    label: Literal["balanced", "cpu_bound", "gpu_bound"]


class CompatibilityPower(BaseModel):
    estimated_w: int
    psu_w: int | None


class CompatibilityResult(BaseModel):
    status: Literal["ok", "warning", "error"]
    issues: list[CompatibilityIssue]
    balance: CompatibilityBalance | None
    power: CompatibilityPower | None
    categories: list[str]


class CompatibilityCheckResponse(BaseModel):
    code: int
    message: str
    result: CompatibilityResult
