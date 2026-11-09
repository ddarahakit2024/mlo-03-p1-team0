import axios from 'axios'
import { baseUrl } from './config.js'
import { RECOMMENDATION_COMPARE_LIMIT, isZonedIso } from '../stores/recommendationViewModel.js'
import { normalizeReturnStatus, validateRejectReason } from '../stores/returnViewModel.js'

// 관리자 API(spec docs/specs/2026-11-01-returns-refunds.md). 관리자(user_profiles.role == "admin")만 부를 수 있다:
// 비로그인 401, 관리자 아님 403. 모든 요청에 쿠키를 싣는다. 금액은 보내지 않는다(환불 금액은 서버가 신청할 때 저장한 값).
const credentials = { withCredentials: true }

/**
 * GET /admin/returns → { items: AdminReturn[], total, page }(쪽당 20, 신청 최근 순).
 * status 가 없거나 모르는 값이면 보내지 않는다(= 전체). 쪽은 1 이상.
 */
export async function fetchAdminReturns({ status = null, page = 1, apiBaseUrl } = {}) {
  const code = normalizeReturnStatus(status)
  const params = { page: Number.isSafeInteger(page) && page > 0 ? page : 1 }
  if (code) params.status = code
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/admin/returns`, { ...credentials, params })
  return response.data.result
}

/**
 * POST /admin/returns/{return_id}/approve → AdminReturn(REFUNDED). 본문 없음.
 * REQUESTED·APPROVED(환불 실패 뒤 다시 승인)만 받는다(아니면 409). 환불이 실패하면 502(상태는 APPROVED + refund_error).
 */
export async function approveReturn(returnId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/admin/returns/${encodeURIComponent(returnId)}/approve`, null, credentials)
  return response.data.result
}

/** POST /admin/returns/{return_id}/reject → AdminReturn(REJECTED). 본문 { reason }(1~200자, 앞뒤 공백 제거). REQUESTED 가 아니면 409. */
export async function rejectReturn(returnId, { reason = '' } = {}, { apiBaseUrl } = {}) {
  const error = validateRejectReason(reason)
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/admin/returns/${encodeURIComponent(returnId)}/reject`, { reason: String(reason).trim() }, credentials)
  return response.data.result
}

// 추천 학습(spec docs/specs/2026-11-03-product-recommendations.md "API 계약"). 관리자만: 비로그인 401, 관리자 아님 403.

/**
 * POST /admin/recommendations/train → 201 모델 기록({ id, version, algorithm, trained_at, events_since, event_count, session_count,
 * product_count, pair_count, params, duration_ms }). 본문 { since }: 시간대를 붙인 ISO 8601 또는 null(전체 이벤트).
 * since 에 시간대가 없으면 보내지 않고 던진다(서버는 422). 이미 학습 중이면 409, 이벤트 저장소가 없거나 연결 실패면 503.
 */
export async function trainRecommendations({ since = null } = {}, { apiBaseUrl } = {}) {
  if (since !== null && !isZonedIso(since)) throw new Error('학습 시작 시각에 시간대가 없습니다. 날짜와 시각을 다시 입력해 주세요.')
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/admin/recommendations/train`, { since }, credentials)
  return response.data.result
}

/** GET /admin/recommendations/models → { server_time(가상 시계 지금), items: 최근 모델 5개(최신 먼저, 학습 응답과 같은 모양) }. */
export async function fetchRecommendationModels({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/admin/recommendations/models`, credentials)
  return response.data.result
}

/**
 * GET /admin/recommendations/products/{product_id}?limit= → { product: { id, name, category, price_krw },
 * current: { model, items }, previous: { model, items } | null }. items: { rank, product_id, name, price_krw, score, cf_score, base_score, co_sessions, reason }.
 * limit 은 1~20(기본 10). 없는 상품 404.
 */
export async function fetchRecommendationComparison(productId, { limit = RECOMMENDATION_COMPARE_LIMIT, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/admin/recommendations/products/${encodeURIComponent(productId)}`, { ...credentials, params: { limit } })
  return response.data.result
}
