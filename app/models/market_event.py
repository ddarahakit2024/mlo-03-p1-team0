"""시장 일정(할인 행사·신제품 발표·수요 이슈). docs/specs/2026-11-01-market-model.md "데이터 변경"

값은 일정 파일 app/market_events.json 을 가져오는 도구(python -m app.scripts.import_market_events)만 쓴다.
시장 도구(python -m app.scripts.market_tick)가 읽어 모의 시장 가격(app/core/market_model.py)의 cycle·event 요소로 쓴다.
"""
from datetime import date
from typing import Any

from sqlalchemy import JSON, Date, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class MarketEvent(Base):
    __tablename__ = "market_events"
    __table_args__ = (UniqueConstraint("code", name="uq_market_events_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False)  # 예: black-friday-2026
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # sale / launch / demand
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)  # 이날까지(포함)
    categories: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)  # 빈 배열 = 모든 카테고리
    sources: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)  # 빈 배열 = 모든 판매처
    # sale: 할인율 %, demand: 최고 상승률 %, launch: 0. FLOAT(53)(MariaDB DOUBLE)이라 소수 값이 다시 가져올 때 바뀌지 않는다
    min_pct: Mapped[float] = mapped_column(Float(53), nullable=False, default=0.0)
    max_pct: Mapped[float] = mapped_column(Float(53), nullable=False, default=0.0)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
