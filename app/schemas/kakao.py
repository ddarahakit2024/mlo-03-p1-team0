from pydantic import BaseModel, Field


class KakaoLoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=4096)
