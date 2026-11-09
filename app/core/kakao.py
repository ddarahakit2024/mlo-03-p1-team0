import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import KAKAO_CLIENT_SECRET, KAKAO_REDIRECT_URI, KAKAO_REST_API_KEY

TOKEN_URL = "https://kauth.kakao.com/oauth/token"
USER_INFO_URL = "https://kapi.kakao.com/v2/user/me"


class KakaoTokenError(Exception):
    """Kakao rejected the authorization code or returned unusable account data."""


class KakaoServiceError(Exception):
    """Kakao could not be reached or returned a server error."""


def fetch_kakao_profile(code: str) -> tuple[str, str]:
    if not KAKAO_REST_API_KEY:
        raise KakaoServiceError("Kakao REST API key is not configured")

    form = {
        "grant_type": "authorization_code",
        "client_id": KAKAO_REST_API_KEY,
        "redirect_uri": KAKAO_REDIRECT_URI,
        "code": code,
    }
    if KAKAO_CLIENT_SECRET:
        form["client_secret"] = KAKAO_CLIENT_SECRET

    token_data = _request_json(TOKEN_URL, urlencode(form).encode("utf-8"))
    access_token = token_data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise KakaoTokenError("Kakao did not return an access token")

    user_request = Request(
        USER_INFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    profile_data = _request_json(user_request)
    kakao_id = profile_data.get("id")
    kakao_account = profile_data.get("kakao_account")
    profile = kakao_account.get("profile", {}) if isinstance(kakao_account, dict) else {}
    nickname = profile.get("nickname") if isinstance(profile, dict) else None
    if kakao_id is None or not isinstance(nickname, str) or not nickname.strip():
        raise KakaoTokenError("Kakao profile is missing an ID or nickname")

    return str(kakao_id), nickname.strip()


def _request_json(url_or_request, data: bytes | None = None) -> dict:
    request = url_or_request
    if isinstance(url_or_request, str):
        request = Request(
            url_or_request,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"},
            method="POST",
        )
    try:
        with urlopen(request, timeout=8) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if 400 <= exc.code < 500:
            raise KakaoTokenError("Kakao rejected the login request") from exc
        raise KakaoServiceError("Kakao returned a server error") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise KakaoServiceError("Kakao could not be reached") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KakaoServiceError("Kakao returned an invalid response") from exc
    if not isinstance(body, dict):
        raise KakaoServiceError("Kakao returned an invalid response")
    return body
