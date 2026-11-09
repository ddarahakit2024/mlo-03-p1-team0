import axios from 'axios'
import { baseUrl } from './config.js'
import { PRICE_HISTORY_DAYS } from '../stores/priceHistoryViewModel.js'
import { PRODUCT_PAGE_SIZE } from '../stores/productViewModel.js'
import { RECOMMENDATION_LIMIT } from '../stores/recommendationViewModel.js'

// 상품 조회는 로그인 없이 쓰는 공개 API 라 쿠키를 싣지 않는다.

/**
 * GET /products. 서버는 빈 query 값을 422 로 거절하므로 빈 category·search(앞뒤 공백 제거 후)·sort·brand 와
 * 값이 없는(null) min_price·max_price 는 빼고 보낸다. 가격 추세 필터(dropping: 30일 하락 중, near_low: 1년 최저가 근접,
 * store_lowest: MOA 가 최저가)는 켰을 때만 true 로 보낸다. 정렬 drop_desc 는 30일 하락폭 큰 순.
 */
export async function fetchProducts({ category = '', search = '', sort = 'recommended', page = 1, pageSize = PRODUCT_PAGE_SIZE, brand = '', minPrice = null, maxPrice = null, dropping = false, nearLow = false, storeLowest = false, apiBaseUrl } = {}) {
  const params = { page, page_size: pageSize }
  if (sort) params.sort = sort
  if (category) params.category = category
  if (search.trim()) params.search = search.trim()
  if (brand) params.brand = brand
  if (minPrice != null && minPrice !== '') params.min_price = minPrice
  if (maxPrice != null && maxPrice !== '') params.max_price = maxPrice
  if (dropping) params.dropping = true
  if (nearLow) params.near_low = true
  if (storeLowest) params.store_lowest = true
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products`, { params })
  return response.data.result
}

/** GET /products/price-summary → { product_count, dropping_count(30일 1% 이상 하락), lowest_1y_count(지금 1년 최저가) } */
export async function fetchPriceSummary({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/price-summary`)
  return response.data.result
}

/** GET /products/facets → Facets({ brands: [{ name, count }], price_min, price_max }). category 를 주면 그 카테고리 안에서. */
export async function fetchProductFacets({ category = '', apiBaseUrl } = {}) {
  const params = {}
  if (category) params.category = category
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/facets`, { params })
  return response.data.result
}

/** GET /products/{product_id} */
export async function fetchProduct(productId, { apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}`)
  return response.data.result
}

/** GET /products/{product_id}/price-history → PriceHistory({ items(오래된 순), lowest_price_krw, highest_price_krw }). days 7~365. */
export async function fetchPriceHistory(productId, { days = PRICE_HISTORY_DAYS, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/price-history`, { params: { days } })
  return response.data.result
}

/**
 * GET /products/{product_id}/recommendations?limit= (spec docs/specs/2026-11-03-product-recommendations.md, 공개 API)
 * → { product_id, model: { version, trained_at } | null(기본 추천), items: [{ rank, reason(co_view·similar), ...ProductSummary }] }.
 * limit 은 1~20(상세 화면은 6).
 */
export async function fetchProductRecommendations(productId, { limit = RECOMMENDATION_LIMIT, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/recommendations`, { params: { limit } })
  return response.data.result
}

/**
 * POST /products/{product_id}/price-match → { id, product_id, store_price_krw, external_source, external_price_krw, status, created_at }.
 * 다른 쇼핑몰이 더 쌀 때 최저가 매칭을 요청한다(로그인 필요. 이미 요청했으면 서버가 같은 요청을 200 으로 돌려준다).
 */
export async function requestPriceMatch(productId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/price-match`, null, { withCredentials: true })
  return response.data.result
}
