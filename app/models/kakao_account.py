from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class KakaoAccount(Base):
    __tablename__ = "kakao_accounts"

    kakao_user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    nickname: Mapped[str] = mapped_column(String(100), nullable=False)
