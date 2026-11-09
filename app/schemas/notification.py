"""알림함(/notifications) 응답."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

NotificationKind = Literal["price_target", "price_low", "answer", "quote"]


class NotificationItem(BaseModel):
    id: int
    kind: NotificationKind
    title: str
    body: str
    product_id: int | None  # price_target·price_low
    question_id: int | None  # answer
    post_id: int | None  # quote
    created_at: datetime
    read: bool


class NotificationResponse(BaseModel):
    code: int
    message: str
    result: NotificationItem


class NotificationPage(BaseModel):
    items: list[NotificationItem]  # 최신순
    total: int
    unread_count: int
    page: int
    page_size: int


class NotificationPageResponse(BaseModel):
    code: int
    message: str
    result: NotificationPage


class UnreadCount(BaseModel):
    unread_count: int


class UnreadCountResponse(BaseModel):
    code: int
    message: str
    result: UnreadCount
