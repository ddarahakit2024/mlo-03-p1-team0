"""신뢰 프록시(TRUSTED_PROXY_IPS)에서 온 요청만 X-Forwarded-For·X-Request-ID 를 믿는다.

- 요청의 직접 접속 주소(ASGI scope 의 client)가 목록(IP·CIDR)에 있을 때만 두 헤더를 쓴다.
  아니면 접속 주소와 서버가 만든 요청 ID 를 쓴다. 클라이언트가 헤더로 IP·요청 ID 를 위조할 수 없다.
- X-Forwarded-For 는 오른쪽(가장 가까운 프록시가 붙인 값)부터 신뢰 프록시를 건너뛴 첫 주소가 클라이언트다.
  그 사이에 형식이 틀린 값이 있으면 헤더를 무시하고 접속 주소를 쓴다. 모두 신뢰 프록시면 가장 왼쪽 주소.
- 목록의 형식이 틀린 항목은 경고만 남기고 뺀다(빠질수록 덜 믿으므로 안전한 쪽).

주의: uvicorn 의 --proxy-headers(기본 켜짐, 127.0.0.1·::1 신뢰)는 앱보다 먼저 scope client 를 바꾼다.
같은 서버의 nginx 뒤에서 이 모듈로 판단하려면 uvicorn 을 --no-proxy-headers 로 실행한다.
"""
import ipaddress
import logging
from functools import lru_cache

from app.core import config

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

logger = logging.getLogger(__name__)


@lru_cache(maxsize=8)
def parse_trusted_proxies(value: str) -> tuple[IPNetwork, ...]:
    """'127.0.0.1, 10.0.0.0/8, ::1' → 네트워크 목록. 형식이 틀린 항목은 뺀다."""
    networks = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_IPS entry: %r", item)
    return tuple(networks)


def trusted_networks() -> tuple[IPNetwork, ...]:
    return parse_trusted_proxies(config.TRUSTED_PROXY_IPS)


def parse_ip(value: str | None) -> IPAddress | None:
    """IP 주소면 객체(IPv4 가 매핑된 IPv6 는 IPv4 로), 아니면 None. 포트가 붙은 값도 None."""
    if not value:
        return None
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def is_trusted(address: IPAddress | None, networks: tuple[IPNetwork, ...]) -> bool:
    return address is not None and any(
        network.version == address.version and address in network for network in networks
    )


def peer_host(scope) -> str | None:
    client = scope.get("client")
    return client[0] if client else None


def is_trusted_peer(scope, networks: tuple[IPNetwork, ...] | None = None) -> bool:
    """직접 접속 주소가 신뢰 프록시 목록에 있는가."""
    return is_trusted(parse_ip(peer_host(scope)), trusted_networks() if networks is None else networks)


def forwarded_client(forwarded_for: str, networks: tuple[IPNetwork, ...]) -> str | None:
    """X-Forwarded-For 에서 오른쪽부터 신뢰 프록시를 건너뛴 첫 주소. 형식이 틀린 값을 만나면 None."""
    address = None
    for item in reversed(forwarded_for.split(",")):
        address = parse_ip(item)
        if address is None:
            return None
        if not is_trusted(address, networks):
            return str(address)
    return None if address is None else str(address)


def client_address(scope, headers) -> str | None:
    """로그에 남길 클라이언트 주소. 신뢰 프록시에서 온 요청만 X-Forwarded-For(여러 줄이면 이어 붙임)를 본다."""
    host = peer_host(scope)
    networks = trusted_networks()
    if networks and is_trusted_peer(scope, networks):
        forwarded = ",".join(headers.getlist("x-forwarded-for"))
        if forwarded.strip():
            client = forwarded_client(forwarded, networks)
            if client is not None:
                return client
    return host
