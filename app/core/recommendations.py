"""상품 상세 추천 학습(Item-CF + 기본 점수). docs/specs/2026-11-03-product-recommendations.md "학습"

DB·MongoDB 를 모르는 순수 함수만 둔다. 이벤트 읽기는 app/core/event_store.py 의 EventStore.product_views,
저장·서빙은 app/core/recommendation_store.py 가 맡는다.

상품 i 에 대한 후보 j:
1. 행렬 X: 행 = 세션, 열 = 상품, 값 = 그 세션에서 봤으면 1(여러 번 봐도 1). scipy.sparse 행렬
2. 코사인 유사도: NearestNeighbors(metric="cosine", algorithm="brute") 를 Xᵀ(상품 × 세션)에 맞추고 상품마다 이웃
   NEIGHBORS 개(자기 자신 포함, 상품 수가 적으면 상품 수)를 찾는다. sim(i, j) = 1 − 거리. 이웃이 아니면 sim 0
3. 함께 본 세션 수 co(i, j) = XᵀX
4. 줄인 유사도 cf(i, j) = sim × co / (co + SHRINKAGE). 함께 본 세션이 적으면 믿지 않는다
5. 기본 점수: 같은 카테고리면 base = exp(−|ln(가격ⱼ ÷ 가격ᵢ)| ÷ PRICE_SCALE), 다른 카테고리면 0
6. score = cf + BASE_WEIGHT × base. 후보 = cf > 0 ∪ 같은 카테고리(자기 자신 제외). 점수 내림차순, 같으면 상품 id 오름차순 TOP_K 개
이벤트가 0건이어도 학습한다(모든 cf = 0 → 기본 점수 순위). 이때는 scikit-learn 을 부르지 않는다.
"""
import math
from collections.abc import Iterable
from dataclasses import dataclass, field

import numpy as np
from scipy import sparse

ALGORITHM = "itemcf-cosine"
VERSION_PREFIX = "itemcf-"
NEIGHBORS = 50  # 상품마다 찾는 이웃 수
SHRINKAGE = 20  # 줄임: co / (co + 20)
BASE_WEIGHT = 0.5  # 기본 점수 가중치
PRICE_SCALE = 0.25  # 가격 폭: 가격이 e^0.25 배(약 28%) 다르면 기본 점수가 1/e
TOP_K = 20  # 상품마다 저장하는 추천 수


def params() -> dict:
    """모델 기록의 params(학습할 때의 매개변수)."""
    return {
        "neighbors": NEIGHBORS, "shrinkage": SHRINKAGE, "base_weight": BASE_WEIGHT,
        "price_scale": PRICE_SCALE, "top_k": TOP_K,
    }


@dataclass(frozen=True)
class CatalogItem:
    """학습·기본 추천에 쓰는 상품 값(출시된 상품의 id·카테고리·판매가)."""

    id: int
    category: str
    price_krw: int


@dataclass
class TrainingResult:
    # 보고 있는 상품 id → 추천 행들(rank 순). 행: recommended_product_id, rank, score, cf_score, base_score, co_sessions
    recommendations: dict[int, list[dict]]
    event_count: int  # 쓴 상품 조회 이벤트 수(버린 것 제외, 같은 세션의 중복 조회 포함)
    session_count: int
    product_count: int  # 이벤트에 나온 상품 수
    pair_count: int  # 함께 본 상품 쌍 수(co > 0, 순서 없음)
    params: dict = field(default_factory=params)


def base_score(price_i: int, price_j: int) -> float:
    """같은 카테고리 상품 사이의 가격 가까움(0~1). 가격이 0 이하인 비정상 상품은 0."""
    if price_i <= 0 or price_j <= 0:
        return 0.0
    return math.exp(-abs(math.log(price_j / price_i)) / PRICE_SCALE)


def shrunk_similarity(sim: float, co: int) -> float:
    """cf = sim × co / (co + SHRINKAGE). 함께 본 세션이 없으면 0."""
    if co <= 0:
        return 0.0
    return sim * co / (co + SHRINKAGE)


def rank_candidates(
    source: CatalogItem,
    candidates: Iterable[CatalogItem],
    cf: dict[int, tuple[float, int]] | None = None,
    limit: int = TOP_K,
) -> list[dict]:
    """source 에 대한 후보들의 점수를 매겨 limit 개를 돌려준다(rank 1 부터).

    cf: 후보 id → (cf 점수, 함께 본 세션 수). 없으면 cf 0·co 0(기본 추천).
    후보 = cf > 0 이거나 같은 카테고리인 상품(자기 자신 제외). 그 밖의 후보는 버린다.
    """
    cf = cf or {}
    scored = []
    for item in candidates:
        if item.id == source.id:
            continue
        cf_score, co = cf.get(item.id, (0.0, 0))
        same_category = item.category == source.category
        if not same_category and cf_score <= 0:
            continue
        base = base_score(source.price_krw, item.price_krw) if same_category else 0.0
        scored.append((cf_score + BASE_WEIGHT * base, item.id, cf_score, base, co))
    scored.sort(key=lambda row: (-row[0], row[1]))
    return [
        {
            "recommended_product_id": product_id, "rank": rank, "score": score, "cf_score": cf_score,
            "base_score": base, "co_sessions": co,
        }
        for rank, (score, product_id, cf_score, base, co) in enumerate(scored[:limit], start=1)
    ]


def baseline_ranking(source: CatalogItem, candidates: Iterable[CatalogItem], limit: int = TOP_K) -> list[dict]:
    """기본 추천(같은 카테고리·비슷한 가격). 모델이 없거나 모델 순위가 모자랄 때 그 자리에서 계산한다.

    출시 전·재고 0 상품은 부르는 쪽이 candidates 에서 미리 뺀다(이 함수는 자기 자신·다른 카테고리만 뺀다)."""
    return rank_candidates(source, candidates, None, limit)


def _view_matrix(
    views: Iterable[tuple[str, int]], catalog: dict[int, CatalogItem],
) -> tuple[sparse.csr_matrix, list[int], int]:
    """(세션 × 상품 0/1 행렬, 열 순서의 상품 id, 쓴 이벤트 수). 목록에 없는 상품의 이벤트는 버린다."""
    sessions: dict[str, int] = {}
    columns: dict[int, int] = {}
    rows, cols = [], []
    for session_id, product_id in views:
        if product_id not in catalog:
            continue
        rows.append(sessions.setdefault(session_id, len(sessions)))
        cols.append(columns.setdefault(product_id, len(columns)))
    matrix = sparse.csr_matrix(
        (np.ones(len(rows), dtype=np.float64), (np.array(rows, dtype=np.int64), np.array(cols, dtype=np.int64))),
        shape=(len(sessions), len(columns)),
    )
    matrix.sum_duplicates()
    matrix.data[:] = 1.0  # 여러 번 봐도 1
    return matrix, list(columns), len(rows)


def _neighbor_similarities(item_matrix: sparse.csr_matrix) -> list[dict[int, float]]:
    """상품(행)마다 코사인 이웃 → {이웃 열 번호: sim}. 자기 자신은 뺀다."""
    from sklearn.neighbors import NearestNeighbors  # 학습할 때만 불러온다(앱 시작을 무겁게 하지 않는다)

    count = item_matrix.shape[0]
    model = NearestNeighbors(metric="cosine", algorithm="brute").fit(item_matrix)
    distances, neighbors = model.kneighbors(item_matrix, n_neighbors=min(NEIGHBORS, count))
    result = []
    for row, (row_distances, row_neighbors) in enumerate(zip(distances, neighbors)):
        similar = {}
        for distance, column in zip(row_distances, row_neighbors):
            if column != row:
                similar[int(column)] = min(1.0, max(0.0, 1.0 - float(distance)))
        result.append(similar)
    return result


def train(views: Iterable[tuple[str, int]], products: Iterable[CatalogItem | tuple[int, str, int]]) -> TrainingResult:
    """상품 조회 (session_id, product_id) 들과 출시된 상품들로 상품마다 추천 TOP_K 개를 만든다."""
    catalog: dict[int, CatalogItem] = {}
    for product in products:
        item = product if isinstance(product, CatalogItem) else CatalogItem(*product)
        catalog[item.id] = item
    matrix, column_ids, event_count = _view_matrix(views, catalog)
    session_count, product_count = matrix.shape

    cf_by_product: dict[int, dict[int, tuple[float, int]]] = {}
    pair_count = 0
    if product_count > 1:
        item_matrix = matrix.T.tocsr()  # 상품 × 세션
        co = (item_matrix @ matrix).tocsr()  # XᵀX: 함께 본 세션 수
        pair_count = int(sparse.triu(co, k=1).count_nonzero())
        similarities = _neighbor_similarities(item_matrix)
        for row, product_id in enumerate(column_ids):
            start, end = co.indptr[row], co.indptr[row + 1]
            co_row = {
                int(column): int(round(value)) for column, value in zip(co.indices[start:end], co.data[start:end])
            }
            scores = {}
            for column, count in co_row.items():
                if column == row:
                    continue
                cf = shrunk_similarity(similarities[row].get(column, 0.0), count)
                scores[column_ids[column]] = (cf, count)
            cf_by_product[product_id] = scores

    by_category: dict[str, list[CatalogItem]] = {}
    for item in catalog.values():
        by_category.setdefault(item.category, []).append(item)
    recommendations = {}
    for product_id, source in catalog.items():
        cf = cf_by_product.get(product_id, {})
        # 후보 = 같은 카테고리 ∪ cf > 0 인 다른 카테고리 상품(rank_candidates 가 다시 거른다)
        others = [
            catalog[other_id] for other_id, (score, _co) in cf.items()
            if score > 0 and catalog[other_id].category != source.category
        ]
        recommendations[product_id] = rank_candidates(source, by_category[source.category] + others, cf)
    return TrainingResult(
        recommendations=recommendations, event_count=event_count, session_count=session_count,
        product_count=product_count, pair_count=pair_count,
    )
