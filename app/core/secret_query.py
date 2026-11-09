"""query 의 비밀값 키 판별과 값 지우기. 요청 로그·uvicorn 접근 로그·사용자 이벤트가 같은 규칙을 쓴다.

이 이름의 키는 값을 남기지 않는다(대소문자 무시): code, state, token, password.
이름에 token·password·secret 이 들어가도(access_token, new_password, client_secret) 비밀값으로 본다.
"""
from urllib.parse import unquote_plus

SECRET_QUERY_KEYS = frozenset({"code", "state", "token", "password"})
_SECRET_KEY_PARTS = ("token", "password", "secret")


def is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in SECRET_QUERY_KEYS or any(part in lowered for part in _SECRET_KEY_PARTS)


def _redact_pairs(query: str) -> str:
    parts = []
    for part in query.split("&"):
        key, equals, _value = part.partition("=")
        parts.append(f"{key}=" if equals and is_secret_key(unquote_plus(key)) else part)
    return "&".join(parts)


def redact_secret_query(target: str) -> str:
    """경로·URL 의 query 에서 비밀값 키의 값만 지운다. 나머지 글자는 그대로 둔다.

    `/login/kakao/callback?code=abc&page=2` → `/login/kakao/callback?code=&page=2`.
    `#` 뒤도 같은 규칙을 쓴다(해시 라우터 `/#/cb?code=..`, `#access_token=..`).
    """
    base, hash_mark, fragment = target.partition("#")
    path, question, query = base.partition("?")
    if question:
        query = _redact_pairs(query)
    if hash_mark:
        fragment = redact_secret_query(fragment) if "?" in fragment else _redact_pairs(fragment)
    return f"{path}{question}{query}{hash_mark}{fragment}"
