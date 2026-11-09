// 상품 상세 "추천 상품"과 관리자 "추천 학습" 화면의 순수 함수(spec docs/specs/2026-11-03-product-recommendations.md).
// - 근거 배지: reason co_view "함께 본 상품", similar "비슷한 가격대"(색만으로 구분하지 않게 글자로 보여 준다)
// - 시각: 화면은 서울 시각(Asia/Seoul = UTC+9, 서머타임 없음)으로 보여 주고, 서버로는 시간대를 붙인 ISO 8601(+09:00)로 보낸다.
//   학습 기록의 server_time(가상 시계 지금)이 "이 시각 이후"의 기본값이다
// - 순위 비교: 현재 표의 칸마다 이전 표와 product_id 로 비교해 "▲n"·"▼n"·"새로"(글자)를 붙인다
// - 오류 문구: 401 로그인 만료, 403 관리자 아님, 409(학습 중)·422(since 형식·미래)·503(이벤트 저장소) 등은 서버 문구, 500·네트워크는 우리 문구
import { LOGIN_EXPIRED_MESSAGE } from './orderViewModel.js'

// 상품 상세 추천 칸 수(GET /products/{id}/recommendations?limit=). 데스크톱 3열 × 2줄
export const RECOMMENDATION_LIMIT = 6
// 관리자 순위 비교 표의 줄 수(GET /admin/recommendations/products/{id}?limit=, 서버 기본값과 같다)
export const RECOMMENDATION_COMPARE_LIMIT = 10
// 순위 비교의 처음 상품 번호(실습: 1번 라이젠5 5600)
export const DEFAULT_COMPARE_PRODUCT_ID = 1
export const SEOUL_OFFSET = '+09:00'
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000

export const RECOMMENDATION_REASONS = { co_view: '함께 본 상품', similar: '비슷한 가격대' }
export const DEFAULT_MODEL_LABEL = '기본 추천'
export const COMPARE_NOT_FOUND_MESSAGE = '상품을 찾을 수 없습니다. 번호를 확인해 주세요.'
export const ADMIN_ONLY_MESSAGE = '관리자만 쓸 수 있습니다. 관리자 계정으로 로그인했는지 확인해 주세요.'

const pad = (value, length = 2) => String(value).padStart(length, '0')

/** 근거 코드 → 배지 문구. 모르는 코드는 "추천". */
export function recommendationReason(code) {
  return RECOMMENDATION_REASONS[code] || '추천'
}

/** 모델 → 이름. 모델이 없으면(model null) 기본 추천(같은 카테고리·비슷한 가격). */
export function modelLabel(model) {
  return typeof model?.version === 'string' && model.version ? model.version : DEFAULT_MODEL_LABEL
}

/** 서버 시각 문자열 → Date. 시간대가 없는 값은 UTC 로 본다(서버는 UTC 로 저장한다). 읽을 수 없으면 null. */
export function parseRecommendationTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) || !text.includes('T') ? text : `${text}Z`
  const date = new Date(zoned)
  return Number.isNaN(date.getTime()) ? null : date
}

function seoulParts(value) {
  const date = parseRecommendationTime(value)
  if (!date) return null
  const shifted = new Date(date.getTime() + SEOUL_OFFSET_MS)
  return {
    date: `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`,
  }
}

/** 서버 시각 → datetime-local 입력 값(서울 시각, 초까지, "YYYY-MM-DDTHH:mm:ss"). 초 아래는 버린다(그 시각 이후를 빠짐없이 쓴다). */
export function toSeoulInputValue(value) {
  const parts = seoulParts(value)
  return parts ? `${parts.date}T${parts.time}` : ''
}

/** 서버 시각 → 화면 표시(서울 시각, "YYYY-MM-DD HH:mm:ss"). 없으면 ''. */
export function formatSeoulDateTime(value) {
  const parts = seoulParts(value)
  return parts ? `${parts.date} ${parts.time}` : ''
}

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/

/** datetime-local 값(서울 시각) → 시간대를 붙인 ISO 8601("…+09:00"). 형식이 틀리거나 없는 날짜면 null. */
export function seoulInputToIso(text) {
  const match = INPUT_PATTERN.exec(String(text ?? '').trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second = '00'] = match
  const numbers = [year, month, day, hour, minute, second].map(Number)
  const utc = new Date(Date.UTC(numbers[0], numbers[1] - 1, numbers[2], numbers[3], numbers[4], numbers[5]))
  const same = utc.getUTCFullYear() === numbers[0] && utc.getUTCMonth() === numbers[1] - 1 && utc.getUTCDate() === numbers[2]
    && utc.getUTCHours() === numbers[3] && utc.getUTCMinutes() === numbers[4] && utc.getUTCSeconds() === numbers[5]
  if (!same) return null
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${SEOUL_OFFSET}`
}

/** 시간대가 붙은 ISO 8601 문자열인지(POST /admin/recommendations/train 의 since). */
export function isZonedIso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && parseRecommendationTime(value) !== null
}

/**
 * 학습 요청의 since. scope 'all' 은 null(전체), 'since' 는 입력한 서울 시각에 시간대를 붙인 값.
 * → { since, error }. 입력이 비었거나 틀리면 error 문구(요청을 보내지 않는다).
 */
export function trainingSince({ scope = 'all', sinceText = '' } = {}) {
  if (scope !== 'since') return { since: null, error: '' }
  if (!String(sinceText ?? '').trim()) return { since: null, error: '학습에 쓸 이벤트의 시작 시각을 입력해 주세요.' }
  const since = seoulInputToIso(sinceText)
  if (!since) return { since: null, error: '시작 시각 형식이 올바르지 않습니다. 날짜와 시각을 다시 입력해 주세요.' }
  return { since, error: '' }
}

/** 학습 기록의 이벤트 기간: events_since 가 없으면 "전체", 있으면 "<서울 시각> 이후". */
export function eventPeriodLabel(eventsSince) {
  const text = formatSeoulDateTime(eventsSince)
  return text ? `${text} 이후` : '전체'
}

/** 개수 → "1,234". 숫자가 아니면 "0". */
export function formatCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('ko-KR') : '0'
}

/** 걸린 시간(ms) → "0.2초"(1분 미만은 소수 1자리), "1분 5초". 값이 없으면 "-". */
export function formatDuration(ms) {
  const value = Number(ms)
  if (ms === null || ms === undefined || !Number.isFinite(value) || value < 0) return '-'
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}초`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}분 ${whole % 60}초`
}

/** 점수(score·cf_score·base_score) → 소수 3자리. 값이 없으면 "-". */
export function formatRecommendationScore(value) {
  const number = Number(value)
  return value === null || value === undefined || !Number.isFinite(number) ? '-' : number.toFixed(3)
}

/** 학습 성공 문구: "itemcf-4 를 학습했습니다. 상품 조회 이벤트 24건 · 세션 6개 · 0.2초" (값은 서버 응답 그대로). */
export function trainingSuccessMessage(model) {
  return `${model?.version || '추천 모델'} 를 학습했습니다. 상품 조회 이벤트 ${formatCount(model?.event_count)}건 · 세션 ${formatCount(model?.session_count)}개 · ${formatDuration(model?.duration_ms)}`
}

/**
 * 현재 표의 칸 하나를 이전 표와 비교한다(product_id 기준). 이전 순위가 없으면(previous null) null.
 * → { text: '▲2' | '▼1' | '새로' | '-', label: 스크린리더 문구, tone: 'up' | 'down' | 'new' | 'same' }
 */
export function rankChange(item, previousItems) {
  if (!Array.isArray(previousItems)) return null
  const before = previousItems.find((candidate) => candidate?.product_id === item?.product_id)
  if (!before) return { text: '새로', label: '이전 순위에 없던 상품', tone: 'new' }
  const diff = Number(before.rank) - Number(item?.rank)
  if (diff > 0) return { text: `▲${diff}`, label: `이전보다 ${diff}계단 오름`, tone: 'up' }
  if (diff < 0) return { text: `▼${-diff}`, label: `이전보다 ${-diff}계단 내림`, tone: 'down' }
  return { text: '-', label: '이전과 같은 순위', tone: 'same' }
}

/** 현재 표 전체의 순위 변화(칸 순서대로). 이전 순위가 없으면 모두 null. */
export function rankChanges(currentItems, previousItems) {
  return (Array.isArray(currentItems) ? currentItems : []).map((item) => rankChange(item, previousItems))
}

/** "상품 번호" 입력 → 1 이상의 정수 또는 null. */
export function parseProductNumber(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** "상품 번호" 검증 문구('' = 통과). */
export function validateProductNumber(value) {
  return parseProductNumber(value) === null ? '상품 번호를 1 이상의 정수로 입력해 주세요.' : ''
}

/**
 * 추천 API 오류 문구. 401 로그인 만료, 403 관리자 아님, 500·네트워크는 fallback,
 * 그 밖(404·409 학습 중·422 since 형식·미래·503 이벤트 저장소 없음)은 서버 message 를 그대로 보여 준다.
 */
export function recommendationError(error, fallback) {
  const status = error?.response?.status
  const message = typeof error?.response?.data?.message === 'string' ? error.response.data.message : ''
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (status === 403) return ADMIN_ONLY_MESSAGE
  if (!status || (status >= 500 && status !== 503)) return fallback
  return message || fallback
}

/** 관리자 추천 학습 화면: 'loading' | 'guest'(401) | 'forbidden'(403) | 'error' | 'empty'(모델 0개) | 'ready' */
export function getRecommendationsPageState({ loading = false, needsLogin = false, forbidden = false, error = '', items = [] } = {}) {
  if (loading) return 'loading'
  if (needsLogin) return 'guest'
  if (forbidden) return 'forbidden'
  if (error) return 'error'
  return items?.length ? 'ready' : 'empty'
}

/** 상품별 순위 비교 영역: 'idle'(아직 부르지 않음) | 'loading' | 'missing'(404) | 'error' | 'ready' */
export function getComparisonState({ loading = false, missing = false, error = '', comparison = null } = {}) {
  if (loading) return 'loading'
  if (missing) return 'missing'
  if (error) return 'error'
  return comparison ? 'ready' : 'idle'
}

/**
 * 추천 칸 노출·클릭 추적기의 start() 값(spec "이벤트", schema_version 5): page 1, 보고 있는 상품(source_product_id),
 * 모델 버전(model_version, 기본 추천이면 null). 값은 서버 응답 그대로다.
 */
export function recommendationListContext(data, productId = null) {
  const version = data?.model?.version
  return {
    page: 1,
    source_product_id: Number.isSafeInteger(data?.product_id) ? data.product_id : productId,
    model_version: typeof version === 'string' && version ? version : null,
  }
}
