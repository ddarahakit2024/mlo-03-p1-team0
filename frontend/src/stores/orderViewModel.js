// 주문서·결제 완료·주문 내역 화면의 주소 읽기, 배송지·주문 상품 검증, 상태 계산, 주문 상태 이름, 오류 문구, 이동.
// Vue·axios 를 import 하지 않는다. 금액은 서버 응답(subtotal_krw, total_krw, total_amount)을 그대로 쓰고 서버로 보내지 않는다.
import { cartStockWarning } from './cartViewModel.js'
import { MAX_ITEM_QUANTITY } from './productViewModel.js'

export const ORDER_PAGE_SIZE = 10
// spec 정책: 주문 하나의 상품 종류는 1~20
export const MAX_ORDER_LINES = 20
export const MAX_REDIRECT_MESSAGE_LENGTH = 200
// 서버(app/schemas/order.py)의 Shipping 과 같은 규칙. 앞뒤 공백을 지운 뒤 검사한다.
export const PHONE_PATTERN = /^0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}$/
export const POSTAL_CODE_PATTERN = /^[0-9]{5}$/
export const SHIPPING_LIMITS = { recipientName: 50, address1: 200, address2: 200, deliveryMemo: 100 }
// 주문 번호(payment_id)는 서버가 만든 `order-<uuid hex>`. 주소에 들어갈 수 있는 글자만 받는다.
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/
const DIGITS = /^[0-9]+$/

export function isValidPaymentId(value) {
  return typeof value === 'string' && PAYMENT_ID_PATTERN.test(value)
}

/**
 * 주문서 주소를 읽는다. product·quantity 가 없으면 장바구니 전체({ mode: 'cart' }),
 * 있으면 바로 구매({ mode: 'buy-now', productId, quantity }), 값이 잘못되면 { mode: 'invalid' }.
 */
export function readCheckoutQuery(search = '') {
  const params = new URLSearchParams(search)
  if (!params.has('product') && !params.has('quantity')) return { mode: 'cart' }
  const productText = (params.get('product') || '').trim()
  const quantityText = (params.get('quantity') || '').trim()
  const productId = DIGITS.test(productText) ? Number(productText) : NaN
  const quantity = DIGITS.test(quantityText) ? Number(quantityText) : NaN
  if (!Number.isSafeInteger(productId) || productId < 1) return { mode: 'invalid' }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) return { mode: 'invalid' }
  return { mode: 'buy-now', productId, quantity }
}

/** 바로 구매 요약을 장바구니(Cart)와 같은 모양으로 만든다. 합계는 화면 표시용이고, 실제 결제 금액은 POST /orders 응답의 total_amount 다. */
export function buyNowSummary(product, quantity) {
  const subtotal = Number(product?.price_krw || 0) * quantity
  return {
    items: [{
      product_id: product.id, name: product.name, brand: product.brand, category: product.category,
      thumbnail_url: product.thumbnail_url || '', price_krw: product.price_krw, stock: product.stock, quantity, subtotal_krw: subtotal,
    }],
    item_count: quantity,
    total_krw: subtotal,
  }
}

/** 주문서에서 주문할 수 없는 이유. 문제가 없거나 상품이 없으면 ''. */
export function checkoutProblem(summary, { buyNow = false } = {}) {
  const items = summary?.items || []
  if (!items.length) return ''
  if (buyNow) {
    const stock = Math.max(0, Math.floor(Number(items[0].stock) || 0))
    if (stock === 0) return '품절된 상품입니다. 다른 상품을 선택해 주세요.'
    if (items[0].quantity > stock) return `재고가 ${stock}개 남았습니다. 상품 페이지에서 수량을 줄여 주세요.`
    return ''
  }
  return items.every((item) => !cartStockWarning(item)) ? '' : '품절되었거나 재고보다 많이 담은 상품이 있습니다. 장바구니에서 정리한 뒤 주문해 주세요.'
}

/** 주문서에 보여 준 상품 → POST /orders 의 items(상품 번호와 수량만). */
export function orderLines(summary) {
  return (summary?.items || []).map((item) => ({ productId: item.product_id, quantity: item.quantity }))
}

/** 서버로 보내기 전 검사(서버와 같은 규칙: 1~20종류, 정수 id, 수량 1~10, 같은 상품 중복 없음). 문제가 없으면 ''. */
export function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '주문할 상품이 없습니다. 장바구니에 상품을 담아 주세요.'
  if (items.length > MAX_ORDER_LINES) return `한 번에 ${MAX_ORDER_LINES}종류까지 주문할 수 있습니다. 장바구니에서 상품을 줄여 주세요.`
  const seen = new Set()
  for (const item of items) {
    if (!Number.isSafeInteger(item?.productId) || item.productId < 1) return '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) return `수량은 상품마다 1~${MAX_ITEM_QUANTITY}개로 선택해 주세요.`
    if (seen.has(item.productId)) return '같은 상품이 두 번 들어 있습니다. 장바구니를 확인해 주세요.'
    seen.add(item.productId)
  }
  return ''
}

export function emptyShipping() {
  return { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryMemo: '' }
}

const clean = (value) => String(value ?? '').trim()
// 서버(파이썬)는 글자 수를 코드 포인트로 센다. 이모지가 2글자로 세어지지 않게 맞춘다.
const length = (value) => [...value].length

/** 배송지 입력 칸별 오류 문구. 문제가 없는 칸은 빠진다(모두 맞으면 {}). */
export function validateShippingFields(shipping = {}) {
  const errors = {}
  const name = clean(shipping.recipientName)
  if (!name) errors.recipientName = '받는 분 이름을 입력해 주세요.'
  else if (length(name) > SHIPPING_LIMITS.recipientName) errors.recipientName = `받는 분 이름은 ${SHIPPING_LIMITS.recipientName}자까지 입력할 수 있습니다.`
  const phone = clean(shipping.phone)
  if (!phone) errors.phone = '연락처를 입력해 주세요.'
  else if (!PHONE_PATTERN.test(phone)) errors.phone = '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.'
  const postalCode = clean(shipping.postalCode)
  if (!postalCode) errors.postalCode = '우편번호를 입력해 주세요.'
  else if (!POSTAL_CODE_PATTERN.test(postalCode)) errors.postalCode = '우편번호는 숫자 5자리로 입력해 주세요.'
  const address1 = clean(shipping.address1)
  if (!address1) errors.address1 = '주소를 입력해 주세요.'
  else if (length(address1) > SHIPPING_LIMITS.address1) errors.address1 = `주소는 ${SHIPPING_LIMITS.address1}자까지 입력할 수 있습니다.`
  if (length(clean(shipping.address2)) > SHIPPING_LIMITS.address2) errors.address2 = `상세 주소는 ${SHIPPING_LIMITS.address2}자까지 입력할 수 있습니다.`
  if (length(clean(shipping.deliveryMemo)) > SHIPPING_LIMITS.deliveryMemo) errors.deliveryMemo = `배송 메모는 ${SHIPPING_LIMITS.deliveryMemo}자까지 입력할 수 있습니다.`
  return errors
}

/** 첫 번째 배송지 오류 문구. 문제가 없으면 ''. */
export function validateShipping(shipping) {
  return Object.values(validateShippingFields(shipping))[0] || ''
}

/** 서버로 보낼 배송지(Shipping). 앞뒤 공백을 지우고, 선택 칸이 비어 있으면 ""(null 은 422). */
export function shippingBody(shipping = {}) {
  return {
    recipient_name: clean(shipping.recipientName),
    phone: clean(shipping.phone),
    postal_code: clean(shipping.postalCode),
    address1: clean(shipping.address1),
    address2: clean(shipping.address2),
    delivery_memo: clean(shipping.deliveryMemo),
  }
}

/** 'invalid' | 'loading' | 'guest' | 'missing' | 'error' | 'empty' | 'unavailable' | 'ready' */
export function getCheckoutPageState({ invalid = false, loading = false, needsLogin = false, missing = false, error = '', summary = null, problem = '' } = {}) {
  if (invalid) return 'invalid'
  if (loading) return 'loading'
  if (needsLogin) return 'guest'
  if (missing) return 'missing'
  if (error) return 'error'
  if (!summary?.items?.length) return 'empty'
  return problem ? 'unavailable' : 'ready'
}

/** 주문 목록·상세: 'invalid' | 'loading' | 'guest' | 'missing' | 'error' | 'empty' | 'ready' */
export function getOrderPageState({ invalid = false, loading = false, needsLogin = false, missing = false, error = '', orders = [], order = null, detail = false } = {}) {
  if (invalid) return 'invalid'
  if (loading) return 'loading'
  if (needsLogin) return 'guest'
  if (missing) return 'missing'
  if (error) return 'error'
  if (detail) return order ? 'ready' : 'missing'
  return orders?.length ? 'ready' : 'empty'
}

const ORDER_STATUSES = {
  READY: { label: '결제 대기', tone: 'ready' },
  PAID: { label: '결제 완료', tone: 'paid' },
  CANCELLED: { label: '취소됨', tone: 'cancelled' },
}

/** 주문 상태 코드 → 이름과 색(tone). */
export function getOrderStatus(status) {
  return ORDER_STATUSES[status] || { label: '확인 중', tone: 'ready' }
}

export function orderStatusName(status) {
  return getOrderStatus(status).label
}

function toDate(value) {
  if (!value) return null
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 서버의 UTC 시각("...Z")을 한국 시간 날짜로: '2026년 10월 30일'. */
export function formatOrderDate(value) {
  const date = toDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date)
}

/** 서버의 UTC 시각을 한국 시간 날짜·시각으로: '2026년 10월 30일 오전 10:12'. */
export function formatOrderDateTime(value) {
  const date = toDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul',
  }).format(date)
}

export const LOGIN_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'

/**
 * 주문 요청 실패 문구.
 * 401 은 로그인 만료, 500·네트워크는 fallback, 그 밖(404·409 재고 부족·422·502·503)은 서버 message 를 그대로 보여 준다.
 */
export function orderError(error, fallback) {
  const status = error?.response?.status
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (!status || status === 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}

/** POST /orders/confirm 실패 문구. 409(결제 미완료·금액 불일치·취소된 주문·재고 부족 취소)와 502·503 은 서버 message 를 그대로 쓴다. */
export function confirmError(error) {
  const status = error?.response?.status
  if (status === 401) return '로그인이 만료되어 결제를 확인하지 못했습니다. 새 탭에서 다시 로그인한 뒤 다시 시도해 주세요.'
  if (status === 404) return '주문을 찾을 수 없습니다. 결제할 때 사용한 계정으로 로그인했는지 확인해 주세요.'
  if (error?.isAxiosError && !error.response) return '서버에 연결하지 못해 결제를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  const message = error?.response?.data?.message
  if (status !== 500 && typeof message === 'string' && message) return message
  return '결제 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

/**
 * 결제 확인은 다시 불러도 안전하다: 서버는 이미 PAID 인 주문을 그대로 돌려주고, 아니면 PortOne 결제를 조회만 한다.
 * 404(주문 없음)와 409(결제 미완료·취소된 주문·재고 부족으로 취소함)는 다시 불러도 결과가 같으므로 다시 시도를 주지 않는다.
 */
export function canRetryConfirm(error) {
  const status = error?.response?.status
  return status !== 404 && status !== 409
}

/**
 * POST /orders 응답(PaymentRequest)의 provider 가 'mock' 이면 모의 결제(로컬 시뮬레이션 계정 전용)다.
 * PortOne 결제창 없이 바로 결제를 확인한다. provider 가 'portone' 이거나 없으면(예전 응답) PortOne 결제다.
 */
export function isMockPayment(order) {
  return order?.provider === 'mock'
}

/** PortOne 결제창 결과: code 가 있으면 사용자가 취소했거나 결제가 실패한 것이다. */
export function isPaymentFailed(response) {
  return response?.code != null
}

/**
 * payment_result 이벤트의 result: PortOne 결제창이 code 를 돌려준 경우 사용자가 닫았으면 'cancelled', 그 밖은 'failed'.
 * PortOne 은 취소를 따로 표시하지 않아 code·pgCode 에 CANCEL 이 있거나 문구에 '취소'가 있으면 취소로 본다.
 */
export function paymentWindowResult(response) {
  const codes = [response?.code, response?.pgCode].filter((value) => typeof value === 'string')
  const message = typeof response?.message === 'string' ? response.message : ''
  return codes.some((value) => /CANCEL/i.test(value)) || message.includes('취소') ? 'cancelled' : 'failed'
}

/** POST /orders/confirm 이 돌려준 주문 상태 → payment_result 의 result. 상태가 없거나 PAID 면 'paid'. */
export function confirmedPaymentResult(order) {
  if (order?.status === 'CANCELLED') return 'cancelled'
  return order?.status && order.status !== 'PAID' ? 'failed' : 'paid'
}

/** 결제 확인·결제창 실패의 HTTP 상태(status)와 오류 코드(error_code). 있는 것만 담는다(이벤트 props 용). */
export function paymentFailureDetail(error) {
  const detail = {}
  const status = error?.response?.status
  if (Number.isInteger(status)) detail.status = status
  if (typeof error?.code === 'string' && error.code) detail.error_code = error.code.slice(0, MAX_REDIRECT_MESSAGE_LENGTH)
  return detail
}

/** 결제창 취소·실패 안내. PortOne 문구가 있으면 그것을 쓰고(200자까지), 다음 행동을 덧붙인다. */
export function paymentFailureMessage(response) {
  const message = typeof response?.message === 'string' ? response.message.trim().slice(0, MAX_REDIRECT_MESSAGE_LENGTH) : ''
  return `${message || '결제가 취소되었거나 완료되지 않았습니다.'} 다시 결제하려면 결제하기를 눌러 주세요.`
}

/**
 * PortOne 이 결제 후 돌려보낸 주소(?paymentId=&code=&message=)를 읽는다.
 * code 가 있으면 결제가 취소·실패한 것이다. message 는 주소에서 온 글이라 길이를 자른다. 형식이 틀린 paymentId 는 버린다.
 */
export function readPaymentRedirect(search = '') {
  const params = new URLSearchParams(search)
  const paymentId = (params.get('paymentId') || '').trim()
  return {
    paymentId: isValidPaymentId(paymentId) ? paymentId : '',
    failureCode: (params.get('code') || '').trim(),
    failureMessage: (params.get('message') || '').trim().slice(0, MAX_REDIRECT_MESSAGE_LENGTH),
  }
}

/** 결제 완료 화면에 들어왔을 때의 상태: 'cancelled' | 'missing' | 'confirming' */
export function initialPaymentState({ paymentId = '', failureCode = '' } = {}) {
  if (failureCode) return 'cancelled'
  if (!paymentId) return 'missing'
  return 'confirming'
}

const RESULT_VIEWS = {
  confirming: { mark: '…', eyebrow: 'PAYMENT CHECK', heading: '결제 확인 중', failed: false },
  paid: { mark: '✓', eyebrow: 'ORDER COMPLETE', heading: '주문이 완료되었습니다', failed: false },
  cancelled: { mark: '!', eyebrow: 'PAYMENT UPDATE', heading: '결제를 완료하지 못했습니다', failed: true, message: '결제가 취소되었거나 완료되지 않았습니다. 장바구니에서 다시 주문해 주세요.' },
  missing: { mark: '!', eyebrow: 'PAYMENT UPDATE', heading: '결제를 완료하지 못했습니다', failed: true, message: '결제 정보를 찾을 수 없습니다. 주문 내역에서 결제 상태를 확인하거나 장바구니에서 다시 주문해 주세요.' },
  failed: { mark: '!', eyebrow: 'PAYMENT CHECK', heading: '결제를 확인하지 못했습니다', failed: true },
}

/** 결제 완료 화면의 상태별 표시(기호, 머리말, 제목, 실패 여부, 기본 문구). */
export function getPaymentResultView(state) {
  return RESULT_VIEWS[state] || RESULT_VIEWS.failed
}

export function orderPath(paymentId) {
  return `/orders/${encodeURIComponent(paymentId)}`
}

export function goToOrder(paymentId, location = window.location) {
  location.assign(orderPath(paymentId))
}
