"""호환성·병목 규칙 엔진(순수 함수, DB 없음). docs/specs/2026-11-01-compatibility-rules.md "규칙"

check_compatibility(parts) → API 의 result 와 같은 dict:
    {"status", "issues": [{"code", "level", "message", "product_ids"}], "balance", "power", "categories"}

- 한 번의 확인은 PC 한 대로 본다. 규칙은 필요한 부품이 모두 있을 때만 판단한다(CPU 만 있으면 소켓 규칙 없음).
- 값은 product_attributes.attributes(카테고리별 형식: app/core/catalog_schema.py)와 product_benchmarks 에서 온다.
  attributes 가 없는 상품은 NO_SPEC_DATA 로 알리고 값이 필요한 규칙에서 뺀다. 카테고리로만 보는 규칙
  (DUPLICATE_PART, MISSING_PARTS, NO_DISPLAY_OUTPUT·NO_CPU_COOLER 의 "그래픽카드·쿨러가 있는지")에는 그대로 센다.
  키가 빠졌거나 형식이 틀린 값(예: cudimm 을 넣기 전에 가져온 메모리)은 그 값이 필요한 규칙만 판단하지 않는다.
- 같은 카테고리 부품이 여럿이면(DUPLICATE_PART 상황) 짝 규칙은 짝마다 판단한다.
- product_ids 는 카탈로그 카테고리 순서, 같은 카테고리 안에서는 요청 순서다.
- 문제 순서: 수준(error → warning → info), 같은 수준에서는 spec 표의 순서, 같은 코드는 만든 순서.
- 문구는 화면에 그대로 보여 줄 존댓말 한 문장이다. 상품 이름 대신 값(소켓·길이·W)을 넣는다.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.core.catalog_schema import CATEGORIES

ERROR, WARNING, INFO = "error", "warning", "info"
LEVEL_RANK = {ERROR: 0, WARNING: 1, INFO: 2}

# spec 규칙 표의 순서(같은 수준 안의 순서)
RULES: tuple[tuple[str, str], ...] = (
    ("SOCKET_MISMATCH", ERROR),
    ("MEMORY_TYPE_MISMATCH", ERROR),
    ("MEMORY_SLOTS_EXCEEDED", ERROR),
    ("MEMORY_CAPACITY_EXCEEDED", ERROR),
    ("BOARD_FORM_FACTOR", ERROR),
    ("GPU_TOO_LONG", ERROR),
    ("COOLER_TOO_TALL", ERROR),
    ("RADIATOR_TOO_BIG", ERROR),
    ("COOLER_SOCKET", ERROR),
    ("PSU_TOO_WEAK", ERROR),
    ("PSU_TIGHT", WARNING),
    ("GPU_POWER_ADAPTER", WARNING),
    ("NO_DISPLAY_OUTPUT", WARNING),
    ("NO_CPU_COOLER", WARNING),
    ("CUDIMM_LIMITED", WARNING),
    ("CPU_BOTTLENECK", WARNING),
    ("GPU_BOTTLENECK", WARNING),
    ("DUPLICATE_PART", WARNING),
    ("MISSING_PARTS", INFO),
    ("NO_SPEC_DATA", INFO),
)
RULE_LEVEL = dict(RULES)
RULE_INDEX = {code: index for index, (code, _level) in enumerate(RULES)}

# 예상 전력 = CPU tdp_w + Σ(그래픽카드 board_power_w × 수량) + 100(메인보드·메모리·저장장치·팬)
BASE_POWER_W = 100
# 파워 여유: 예상 전력 × 1.3. 소수 오차가 없게 정수 13/10 으로 계산한다
PSU_MARGIN_NUMERATOR, PSU_MARGIN_DENOMINATOR = 13, 10
# 균형 점수 기준값(2026-11 카탈로그 중앙값: CPU Mark 34,228 → 34,000, G3D 23,330 → 23,000)
CPU_MARK_REFERENCE = 34_000
G3D_MARK_REFERENCE = 23_000
CPU_MARK, G3D_MARK = "passmark_cpu_mark", "passmark_g3d_mark"
BALANCE_LIMIT = 1.0
CUDIMM_SOCKET = "LGA1851"
# 16핀 전원(12VHPWR·12V-2x6) 표기. 카탈로그는 "16-pin" 으로 적는다
SIXTEEN_PIN_MARKERS = ("16-pin", "16 pin", "16pin", "16핀", "12vhpwr", "12v-2x6", "12v-2×6")

ONE_PER_PC = {"cpu": "CPU 가", "mainboard": "메인보드가", "psu": "파워가", "case": "케이스가", "cooler": "CPU 쿨러가"}
COMPLETE_PC_PARTS = (("memory", "메모리"), ("storage", "저장장치"), ("psu", "파워"), ("case", "케이스"))


@dataclass(frozen=True)
class Part:
    """확인할 부품 한 줄. attributes 가 None(또는 빈 dict)이면 카탈로그 밖 상품이다."""

    product_id: int
    category: str
    quantity: int = 1
    attributes: Mapping[str, Any] | None = None
    benchmarks: Mapping[str, float] = field(default_factory=dict)


# ---------------------------------------------------------------- 값 읽기(형식이 틀리면 None)

def _has_spec(part: Part) -> bool:
    return isinstance(part.attributes, Mapping) and len(part.attributes) > 0


def _value(part: Part, key: str) -> Any:
    return part.attributes.get(key) if _has_spec(part) else None


def _int(part: Part, key: str) -> int | None:
    value = _value(part, key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _text(part: Part, key: str) -> str | None:
    value = _value(part, key)
    return value if isinstance(value, str) and value else None


def _flag(part: Part, key: str) -> bool | None:
    value = _value(part, key)
    return value if isinstance(value, bool) else None


def _texts(part: Part, key: str) -> list[str] | None:
    """문자열 목록. 비었거나 형식이 틀리면 None(판단하지 않는다)."""
    value = _value(part, key)
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        return None
    return value


def _benchmark(part: Part, name: str) -> float | None:
    value = part.benchmarks.get(name) if isinstance(part.benchmarks, Mapping) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def _is_sixteen_pin(connector: str) -> bool:
    lowered = connector.lower()
    return any(marker in lowered for marker in SIXTEEN_PIN_MARKERS)


def _category_rank(category: str) -> int:
    return CATEGORIES.index(category) if category in CATEGORIES else len(CATEGORIES)


# ---------------------------------------------------------------- 공식

def estimate_power_w(cpus: Sequence[Part], gpus: Sequence[Part]) -> int | None:
    """예상 소비 전력(W). CPU tdp_w 나 그래픽카드 board_power_w 를 하나도 모르면 None.

    한 PC 에는 CPU 가 하나이므로 CPU 가 여럿(DUPLICATE_PART)이면 가장 큰 tdp_w 하나만 더한다.
    값을 모르는 부품(attributes 없음)은 0 으로 본다(NO_SPEC_DATA 가 따로 알린다).
    """
    cpu_tdps = [tdp for tdp in (_int(cpu, "tdp_w") for cpu in cpus) if tdp is not None]
    gpu_powers = [(watts, gpu.quantity) for gpu in gpus if (watts := _int(gpu, "board_power_w")) is not None]
    if not cpu_tdps and not gpu_powers:
        return None
    return max(cpu_tdps, default=0) + sum(watts * quantity for watts, quantity in gpu_powers) + BASE_POWER_W


def balance_score(cpu_mark: float, g3d_mark: float) -> float:
    """log2((G3D ÷ 23000) ÷ (CPU Mark ÷ 34000)), 소수 둘째 자리 반올림. 양수 = 그래픽카드가 상대적으로 강하다."""
    score = round(math.log2((g3d_mark / G3D_MARK_REFERENCE) / (cpu_mark / CPU_MARK_REFERENCE)), 2)
    return score + 0.0  # -0.0 → 0.0


def balance_label(score: float) -> str:
    if score > BALANCE_LIMIT:
        return "cpu_bound"
    if score < -BALANCE_LIMIT:
        return "gpu_bound"
    return "balanced"


# ---------------------------------------------------------------- 규칙 엔진

def check_compatibility(parts: Sequence[Part]) -> dict:
    """부품 목록 → {status, issues, balance, power, categories}(spec "API 계약"의 result)."""
    ordered = [part for _index, part in sorted(enumerate(parts), key=lambda p: (_category_rank(p[1].category), p[0]))]
    position: dict[int, int] = {}
    for index, part in enumerate(ordered):
        position.setdefault(part.product_id, index)
    by_category: dict[str, list[Part]] = {category: [] for category in CATEGORIES}
    for part in ordered:
        by_category.setdefault(part.category, []).append(part)
    cpus, boards, memories, gpus = (by_category[c] for c in ("cpu", "mainboard", "memory", "gpu"))
    psus, cases, coolers = (by_category[c] for c in ("psu", "case", "cooler"))

    issues: list[dict] = []

    def add(code: str, message: str, involved: Sequence[Part] = ()) -> None:
        ids = sorted({part.product_id for part in involved}, key=lambda product_id: position[product_id])
        issues.append({"code": code, "level": RULE_LEVEL[code], "message": message, "product_ids": ids})

    # SOCKET_MISMATCH: CPU socket ≠ 메인보드 socket
    for cpu in cpus:
        cpu_socket = _text(cpu, "socket")
        for board in boards:
            board_socket = _text(board, "socket")
            if cpu_socket and board_socket and cpu_socket != board_socket:
                add("SOCKET_MISMATCH", f"CPU({cpu_socket})와 메인보드({board_socket})의 소켓이 다릅니다.", [cpu, board])

    # MEMORY_TYPE_MISMATCH: 메인보드와 종류가 다르면 메인보드 문구. 메인보드가 맞을(없을) 때만 CPU 지원 여부를 본다
    for memory in memories:
        memory_type = _text(memory, "memory_type")
        if not memory_type:
            continue
        board_conflict = False
        for board in boards:
            board_type = _text(board, "memory_type")
            if board_type and board_type != memory_type:
                board_conflict = True
                add("MEMORY_TYPE_MISMATCH", f"{memory_type} 메모리는 이 메인보드({board_type})에 꽂을 수 없습니다.",
                    [board, memory])
        if board_conflict:
            continue
        for cpu in cpus:
            cpu_type = _text(cpu, "memory_type")
            if cpu_type and memory_type not in cpu_type.split("/"):
                add("MEMORY_TYPE_MISMATCH", f"{memory_type} 메모리는 이 CPU({cpu_type} 지원)에서 쓸 수 없습니다.",
                    [cpu, memory])

    # MEMORY_SLOTS_EXCEEDED / MEMORY_CAPACITY_EXCEEDED: 메모리 합계(× 수량)와 메인보드 한도
    module_parts = [m for m in memories if _int(m, "modules") is not None]
    total_modules = sum(_int(m, "modules") * m.quantity for m in module_parts)
    capacity_parts = [m for m in memories if _int(m, "capacity_gb") is not None]
    total_capacity = sum(_int(m, "capacity_gb") * m.quantity for m in capacity_parts)
    for board in boards:
        slots = _int(board, "memory_slots")
        if module_parts and slots is not None and total_modules > slots:
            add("MEMORY_SLOTS_EXCEEDED", f"메모리 {total_modules}개가 메인보드 슬롯 {slots}개보다 많습니다.",
                [board, *module_parts])
    for board in boards:
        max_memory = _int(board, "max_memory_gb")
        if capacity_parts and max_memory is not None and total_capacity > max_memory:
            add("MEMORY_CAPACITY_EXCEEDED", f"메모리 {total_capacity}GB 가 메인보드 최대 {max_memory}GB 를 넘습니다.",
                [board, *capacity_parts])

    # BOARD_FORM_FACTOR: 메인보드 form_factor ∉ 케이스 motherboard_support
    for board in boards:
        form_factor = _text(board, "form_factor")
        for case in cases:
            supported = _texts(case, "motherboard_support")
            if form_factor and supported and form_factor not in supported:
                add("BOARD_FORM_FACTOR",
                    f"{form_factor} 메인보드는 이 케이스({', '.join(supported)})에 들어가지 않습니다.", [board, case])

    # GPU_TOO_LONG: 그래픽카드 length_mm > 케이스 max_gpu_length_mm
    for gpu in gpus:
        length = _int(gpu, "length_mm")
        for case in cases:
            limit = _int(case, "max_gpu_length_mm")
            if length is not None and limit is not None and length > limit:
                add("GPU_TOO_LONG", f"그래픽카드({length}mm)가 케이스 장착 길이({limit}mm)보다 깁니다.", [gpu, case])

    # COOLER_TOO_TALL(공랭) / RADIATOR_TOO_BIG(수랭)
    for cooler in coolers:
        if _text(cooler, "cooler_type") != "air":
            continue
        height = _int(cooler, "height_mm")
        for case in cases:
            limit = _int(case, "max_cpu_cooler_height_mm")
            if height is not None and limit is not None and height > limit:
                add("COOLER_TOO_TALL", f"CPU 쿨러({height}mm)가 케이스 장착 높이({limit}mm)보다 높습니다.",
                    [case, cooler])
    for cooler in coolers:
        if _text(cooler, "cooler_type") != "liquid":
            continue
        radiator = _int(cooler, "radiator_mm")
        for case in cases:
            limit = _int(case, "max_radiator_mm")
            if radiator is None or limit is None or radiator <= limit:
                continue
            if limit == 0:
                add("RADIATOR_TOO_BIG", f"이 케이스에는 수랭 라디에이터({radiator}mm)를 달 수 없습니다.", [case, cooler])
            else:
                add("RADIATOR_TOO_BIG", f"수랭 라디에이터({radiator}mm)가 케이스 최대 장착 크기({limit}mm)보다 큽니다.",
                    [case, cooler])

    # COOLER_SOCKET: CPU socket ∉ 쿨러 sockets
    for cpu in cpus:
        cpu_socket = _text(cpu, "socket")
        for cooler in coolers:
            sockets = _texts(cooler, "sockets")
            if cpu_socket and sockets and cpu_socket not in sockets:
                add("COOLER_SOCKET", f"쿨러({', '.join(sockets)})가 CPU 소켓({cpu_socket})을 지원하지 않습니다.",
                    [cpu, cooler])

    # 전력: PSU_TOO_WEAK(error) / PSU_TIGHT(warning, 부족하지 않을 때만)
    estimated_w = estimate_power_w(cpus, gpus)
    consumers = [p for p in cpus if _int(p, "tdp_w") is not None]
    consumers += [p for p in gpus if _int(p, "board_power_w") is not None]
    recommended = [(watts, gpu) for gpu in gpus if (watts := _int(gpu, "recommended_psu_w")) is not None]
    recommended_w = max((watts for watts, _gpu in recommended), default=None)
    psu_values = [(psu, watts) for psu in psus if (watts := _int(psu, "wattage_w")) is not None]
    if estimated_w is not None:
        margin_w = -(-estimated_w * PSU_MARGIN_NUMERATOR // PSU_MARGIN_DENOMINATOR)  # 올림(정수 비교와 같다)
        needed_w = max(margin_w, recommended_w or 0)
        for psu, watts in psu_values:
            if watts < estimated_w:
                add("PSU_TOO_WEAK", f"예상 소비 전력 {estimated_w}W 가 파워 {watts}W 보다 큽니다.", [*consumers, psu])
            elif watts < needed_w:
                if recommended_w is not None and recommended_w >= margin_w:
                    add("PSU_TIGHT", f"파워 {watts}W 가 그래픽카드 권장 파워 {recommended_w}W 보다 작습니다.",
                        [*(gpu for w, gpu in recommended if w == recommended_w), psu])
                else:
                    add("PSU_TIGHT",
                        f"파워 {watts}W 가 예상 소비 전력 {estimated_w}W 의 1.3배({margin_w}W)보다 작아 여유가 적습니다.",
                        [*consumers, psu])

    # GPU_POWER_ADAPTER: 16핀 그래픽카드 + 16핀 케이블이 없는 파워
    for gpu in gpus:
        connector = _text(gpu, "power_connector")
        if not connector or not _is_sixteen_pin(connector):
            continue
        for psu in psus:
            if _flag(psu, "has_12v_2x6") is False:
                add("GPU_POWER_ADAPTER", f"파워에 16핀 전원 케이블이 없어 그래픽카드({connector})에 변환 케이블이 필요합니다.",
                    [gpu, psu])

    # NO_DISPLAY_OUTPUT / NO_CPU_COOLER: CPU·메인보드가 있을 때만
    if cpus and boards:
        if not gpus:
            for cpu in cpus:
                if _flag(cpu, "integrated_graphics") is False:
                    add("NO_DISPLAY_OUTPUT", "CPU 에 내장 그래픽이 없어 화면을 보려면 그래픽카드가 필요합니다.", [cpu])
        if not coolers:
            for cpu in cpus:
                if _flag(cpu, "cooler_included") is False:
                    add("NO_CPU_COOLER", "CPU 에 기본 쿨러가 없어 쿨러가 따로 필요합니다.", [cpu])

    # CUDIMM_LIMITED: CUDIMM 메모리 + LGA1851 이 아닌 메인보드
    for memory in memories:
        if _flag(memory, "cudimm") is not True:
            continue
        for board in boards:
            board_socket = _text(board, "socket")
            if board_socket and board_socket != CUDIMM_SOCKET:
                add("CUDIMM_LIMITED", f"CUDIMM 메모리는 이 메인보드({board_socket})에서 정격 속도로 동작하지 않을 수 있습니다.",
                    [board, memory])

    # 균형: CPU 와 그래픽카드가 하나씩(수량 합 1) 있고 PassMark 가 둘 다 있을 때만
    balance = None
    if sum(p.quantity for p in cpus) == 1 and sum(p.quantity for p in gpus) == 1:
        cpu, gpu = cpus[0], gpus[0]
        cpu_mark, g3d_mark = _benchmark(cpu, CPU_MARK), _benchmark(gpu, G3D_MARK)
        if cpu_mark is not None and g3d_mark is not None:
            score = balance_score(cpu_mark, g3d_mark)
            balance = {"score": score, "label": balance_label(score)}
            if score > BALANCE_LIMIT:
                add("CPU_BOTTLENECK", "CPU 가 그래픽카드 성능을 다 끌어내지 못할 수 있습니다.", [cpu, gpu])
            elif score < -BALANCE_LIMIT:
                add("GPU_BOTTLENECK", "CPU 에 비해 그래픽카드 성능이 낮습니다.", [cpu, gpu])

    # DUPLICATE_PART: 한 PC 에 하나만 들어가는 부품이 종류 또는 수량으로 2개 이상
    for category in CATEGORIES:
        if category in ONE_PER_PC and sum(p.quantity for p in by_category[category]) >= 2:
            add("DUPLICATE_PART", f"한 PC 에는 {ONE_PER_PC[category]} 하나만 들어갑니다.", by_category[category])

    # MISSING_PARTS: CPU·메인보드가 있는데 완성 PC 에 필요한 부품이 빠짐
    if cpus and boards:
        missing = [label for category, label in COMPLETE_PC_PARTS if not by_category[category]]
        if missing:
            add("MISSING_PARTS", f"완성 PC 에 필요한 {', '.join(missing)}가 없습니다.")

    # NO_SPEC_DATA: attributes 가 없는 상품(카탈로그 밖 상품)
    unknown = [part for part in ordered if not _has_spec(part)]
    if unknown:
        add("NO_SPEC_DATA", f"규칙을 확인할 수 없는 상품이 {len(unknown)}개 있습니다.", unknown)

    issues.sort(key=lambda issue: (LEVEL_RANK[issue["level"]], RULE_INDEX[issue["code"]]))
    levels = {issue["level"] for issue in issues}
    status = ERROR if ERROR in levels else WARNING if WARNING in levels else "ok"
    power = None
    if estimated_w is not None:
        power = {"estimated_w": estimated_w, "psu_w": psu_values[0][1] if psu_values else None}
    categories = sorted({part.category for part in ordered}, key=lambda c: (_category_rank(c), c))
    return {"status": status, "issues": issues, "balance": balance, "power": power, "categories": categories}
