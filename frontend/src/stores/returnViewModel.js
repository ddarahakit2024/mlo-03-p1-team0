// 반품·환불(spec docs/specs/2026-11-01-returns-refunds.md): 사유·상태 이름, 신청 기한, 신청서 줄·검증·본문, 관리자 화면 주소·상태 계산, 오류 문구, 이벤트 값.
// Vue·axios 를 import 하지 않는다. 환불 금액·신청 가능 수량은 서버 응답(refund_amount_krw, items_total_krw, shipping_deduction_krw, returnable)을
// 그대로 쓰고 화면에서 계산하거나 서버로 보내지 않는다.
import { MAX_PROP_LIST_LENGTH } from './tracking.js'

// 서버(ReturnRequest)와 같은 제한: 자세한 내용 500자, 거절 사유 1~200자, 관리자 목록 쪽당 20개
export const MAX_RETURN_DETAIL_LENGTH = 500
export const MAX_REJECT_REASON_LENGTH = 200
export const ADMIN_RETURN_PAGE_SIZE = 20
// 안내 문구(표시만 한다. 차감은 서버가 신청할 때 계산해 shipping_deduction_krw 로 돌려준다)
export const CHANGED_MIND_NOTICE = '단순 변심은 왕복 배송비 6,000원을 빼고 환불합니다.'
export const REFUND_FAILED_MESSAGE = '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.'
const LOGIN_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'

// 사유 코드(spec 정책 순서)
export const RETURN_REASONS = [
  { code: 'defective', name: '불량' },
  { code: 'incompatible', name: '호환 안 됨' },
  { code: 'not_as_described', name: '설명과 다름' },
  { code: 'wrong_item', name: '오배송' },
  { code: 'changed_mind', name: '단순 변심' },
]
const REASON_CODES = RETURN_REASONS.map((reason) => reason.code)

// 상태 배지: 글자로 구분하고(색만으로 구분하지 않는다) 색은 shop.css 의 shop-order-status 변형을 쓴다
const RETURN_STATUSES = {
  REQUESTED: { label: '신청됨', className: '' },
  APPROVED: { label: '승인됨·환불 대기', className: 'shop-order-status--warning' },
  REFUNDED: { label: '환불 완료', className: 'shop-order-status--paid' },
  REJECTED: { label: '거절됨', className: 'shop-order-status--cancelled' },
  WITHDRAWN: { label: '철회함', className: 'shop-order-status--muted' },
}
export const RETURN_STATUS_CODES = Object.keys(RETURN_STATUSES)

// 관리자 화면의 상태 탭(주소 ?status=). status null = 전체
export const ADMIN_RETURN_TABS = [
  { status: null, name: '전체' },
  { status: 'REQUESTED', name: '신청' },
  { status: 'APPROVED', name: '환불 대기' },
  { status: 'REFUNDED', name: '환불 완료' },
  { status: 'REJECTED', name: '거절' },
  { status: 'WITHDRAWN', name: '철회' },
]

const PAYMENT_PROVIDERS = { mock: '모의 결제', portone: 'PortOne' }
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const clean = (value) => String(value ?? '').trim()
// 서버(파이썬)는 글자 수를 코드 포인트로 센다
export const textLength = (value) => [...String(value ?? '')].length

/** 사유 코드 → 이름. 모르는 코드는 코드 그대로(없으면 ''). */
export function returnReasonName(code) {
  return RETURN_REASONS.find((reason) => reason.code === code)?.name || code || ''
}

/** 상태 코드 → { label, className }. 모르는 상태는 '확인 중'. */
export function returnStatus(status) {
  return RETURN_STATUSES[status] || { label: '확인 중', className: '' }
}

/** 결제 방식 이름(관리자 화면). */
export function paymentProviderName(provider) {
  return PAYMENT_PROVIDERS[provider] || provider || '-'
}

/** 지금 시각(ms). 화면 테스트는 compileSfc deps 로 바꿔 넣는다. */
export function currentTime() {
  return Date.now()
}

/** 서버 시각 문자열 → Date. 시간대 표시가 없으면 UTC 로 본다. 읽을 수 없으면 null. */
export function parseServerTime(value) {
  if (!value || typeof value !== 'string') return null
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 반품 신청 기한(UTC)을 한국 시간으로: '2026년 11월 6일 10:13 까지'(24시간제). 읽을 수 없으면 ''. */
export function formatReturnDeadline(value) {
  const date = parseServerTime(value)
  if (!date) return ''
  const kst = new Date(date.getTime() + KST_OFFSET_MS)
  const pad = (number) => String(number).padStart(2, '0')
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())} 까지`
}

/** 기한(return_deadline)이 지금보다 뒤인지. 기한이 없거나 읽을 수 없으면 false. */
export function isReturnWindowOpen(deadline, now = currentTime()) {
  const date = parseServerTime(deadline)
  return Boolean(date) && now < date.getTime()
}

/**
 * 반품 신청서의 줄: 서버가 준 returnable(신청 가능 수량, 0 인 상품은 서버가 뺀다)에 주문 줄의 이름·단가를 붙인다.
 * 수량은 서버 값 그대로이고 계산하지 않는다.
 */
export function returnLines(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  return (Array.isArray(order?.returnable) ? order.returnable : [])
    .filter((line) => Number.isSafeInteger(line?.product_id) && Number.isInteger(line?.quantity) && line.quantity > 0)
    .map((line) => {
      const item = items.find((candidate) => candidate.product_id === line.product_id)
      return {
        product_id: line.product_id,
        quantity: line.quantity,
        product_name: item?.product_name || `상품 ${line.product_id}`,
        unit_price_krw: item?.unit_price_krw ?? null,
      }
    })
}

/**
 * 주문 상세의 반품 신청 영역: 'hidden'(PAID 아님·신청 가능한 상품 없음) | 'expired'(기한 지남) | 'open'.
 * spec: PAID 이고 returnable 이 있고 기한 전일 때만 신청서를 보여 준다.
 */
export function getReturnFormState(order, now = currentTime()) {
  if (order?.status !== 'PAID' || !returnLines(order).length) return 'hidden'
  return isReturnWindowOpen(order.return_deadline, now) ? 'open' : 'expired'
}

/** 반품 수량 select 의 선택지: 0~신청 가능 수량. */
export function returnQuantityOptions(max) {
  const count = Number.isInteger(max) && max > 0 ? max : 0
  return Array.from({ length: count + 1 }, (_, index) => index)
}

/** 고른 수량({ [product_id]: 수량 }) → 요청 items([{ productId, quantity }], 수량 0 은 뺀다). 줄 순서를 지킨다. */
export function returnSelection(quantities, lines) {
  return (lines || [])
    .map((line) => ({ productId: line.product_id, quantity: Number(quantities?.[line.product_id]) || 0 }))
    .filter((item) => item.quantity > 0)
}

/** 지금 신청서 줄에서 고른 수량의 합(반품 신청 버튼을 켤지 정한다). 줄에 없는 상품의 값은 세지 않는다. */
export function selectedReturnQuantity(quantities, lines) {
  return returnSelection(quantities, lines).reduce((sum, item) => sum + item.quantity, 0)
}

/**
 * 반품 신청 검증(서버와 같은 규칙: 상품 1개 이상·중복 없음·수량 1 이상, 사유 5개 중 하나, 자세한 내용 500자).
 * lines(신청서 줄)를 넘기면 서버가 준 신청 가능 수량을 넘는지도 본다. 문제가 없으면 ''.
 */
export function validateReturnRequest({ reason = '', detail = '', items = [] } = {}, lines = null) {
  if (!Array.isArray(items) || !items.length) return '반품할 상품의 수량을 골라 주세요.'
  const seen = new Set()
  for (const item of items) {
    if (!Number.isSafeInteger(item?.productId) || item.productId < 1) return '상품 정보가 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 골라 주세요.'
    if (!Number.isInteger(item.quantity) || item.quantity < 1) return '반품 수량을 다시 골라 주세요.'
    if (seen.has(item.productId)) return '같은 상품이 두 번 들어 있습니다. 페이지를 새로고침한 뒤 다시 골라 주세요.'
    seen.add(item.productId)
    if (lines) {
      const line = lines.find((candidate) => candidate.product_id === item.productId)
      if (!line || item.quantity > line.quantity) return '신청할 수 있는 수량보다 많습니다. 수량을 다시 골라 주세요.'
    }
  }
  if (!REASON_CODES.includes(reason)) return '반품 사유를 골라 주세요.'
  if (textLength(clean(detail)) > MAX_RETURN_DETAIL_LENGTH) return `자세한 내용은 ${MAX_RETURN_DETAIL_LENGTH}자까지 입력할 수 있습니다.`
  return ''
}

/** POST /orders/{payment_id}/returns 본문. 자세한 내용은 앞뒤 공백을 지우고, 비어 있으면 보내지 않는다(선택 칸). 금액은 보내지 않는다. */
export function returnRequestBody({ reason, detail = '', items = [] } = {}) {
  const text = clean(detail)
  return {
    reason,
    ...(text ? { detail: text } : {}),
    items: items.map(({ productId, quantity }) => ({ product_id: productId, quantity })),
  }
}

/** 거절 사유 검증(1~200자). 문제가 없으면 ''. */
export function validateRejectReason(reason) {
  const text = clean(reason)
  if (!text) return '거절 사유를 입력해 주세요.'
  if (textLength(text) > MAX_REJECT_REASON_LENGTH) return `거절 사유는 ${MAX_REJECT_REASON_LENGTH}자까지 입력할 수 있습니다.`
  return ''
}

/** 구매자의 반품 신청·철회 실패 문구. 401 은 로그인 만료, 403(Origin)은 새로고침 안내, 409·404·422 는 서버 문구, 500·네트워크는 fallback. */
export function returnError(error, fallback) {
  const status = error?.response?.status
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (status === 403) return '요청을 확인하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
  if (!status || status === 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}

/** 관리자 반품 목록·승인·거절 실패 문구. 403 은 관리자 아님, 502 는 환불 실패(서버 문구, 없으면 spec 문구). */
export function adminReturnError(error, fallback) {
  const status = error?.response?.status
  const message = typeof error?.response?.data?.message === 'string' ? error.response.data.message : ''
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (status === 403) return '관리자만 처리할 수 있습니다. 관리자 계정으로 로그인했는지 확인해 주세요.'
  if (status === 502) return message || REFUND_FAILED_MESSAGE
  if (!status || status === 500) return fallback
  return message || fallback
}

/** 관리자 반품 관리 화면: 'loading' | 'guest'(401) | 'forbidden'(403) | 'error' | 'empty' | 'ready' */
export function getAdminReturnsPageState({ loading = false, needsLogin = false, forbidden = false, error = '', items = [] } = {}) {
  if (loading) return 'loading'
  if (needsLogin) return 'guest'
  if (forbidden) return 'forbidden'
  if (error) return 'error'
  return items?.length ? 'ready' : 'empty'
}

/** 상태 코드가 계약의 5개 중 하나면 그대로, 아니면 null(전체). */
export function normalizeReturnStatus(value) {
  const code = clean(value).toUpperCase()
  return RETURN_STATUS_CODES.includes(code) ? code : null
}

/** 관리자 화면 주소의 ?status= 를 읽는다(모르는 값은 전체). */
export function readAdminReturnsQuery(search = window.location.search) {
  return { status: normalizeReturnStatus(new URLSearchParams(search || '').get('status')) }
}

/** 고른 상태 탭을 주소에 남긴다(새로고침·공유). 탭을 누를 때마다 뒤로 가기 기록이 쌓이지 않게 replaceState 를 쓴다. */
export function replaceAdminReturnsQuery(status, history = window.history) {
  const code = normalizeReturnStatus(status)
  history.replaceState({}, '', `/admin/returns${code ? `?status=${code}` : ''}`)
}

/** 상태 탭 이름(빈 목록 문구). */
export function adminReturnTabName(status) {
  return ADMIN_RETURN_TABS.find((tab) => tab.status === (status || null))?.name || '전체'
}

/**
 * return_request 이벤트 props(spec "이벤트"). 값은 서버 응답(ReturnRequest) 그대로이고, build_ids 는 반품한 상품의 주문 줄 build_id(없으면 빈 배열).
 * 자세한 내용(detail)은 넣지 않는다(개인정보 규칙).
 */
export function returnRequestEventProps(created, order) {
  const items = Array.isArray(created?.items) ? created.items : []
  const productIds = items.map((item) => item.product_id)
  const buildIds = [...new Set((Array.isArray(order?.items) ? order.items : [])
    .filter((item) => productIds.includes(item.product_id))
    .map((item) => item.build_id)
    .filter((id) => typeof id === 'string' && id))]
  return {
    payment_id: created?.payment_id || order?.payment_id || null,
    return_id: created?.id ?? null,
    reason: created?.reason ?? null,
    item_count: items.length,
    quantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    product_ids: productIds.slice(0, MAX_PROP_LIST_LENGTH),
    refund_amount_krw: created?.refund_amount_krw ?? null,
    build_ids: buildIds.slice(0, MAX_PROP_LIST_LENGTH),
  }
}

/** 반품 내역에서 신청 하나를 서버가 돌려준 값으로 바꾼다(없으면 끝에 더한다). 신청 순서를 지킨다. */
export function upsertReturn(returns, updated) {
  const list = Array.isArray(returns) ? returns : []
  if (!updated) return list
  return list.some((item) => item.id === updated.id)
    ? list.map((item) => (item.id === updated.id ? updated : item))
    : [...list, updated]
}
