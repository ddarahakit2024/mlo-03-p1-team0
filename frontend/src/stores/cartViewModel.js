// 장바구니 화면의 상태 계산, 수량 검증, 재고 경고, 담은 뒤 가격 변동·타몰 대비 절약 문구, 오류 문구, 주문서 이동.
// Vue·axios 를 import 하지 않는다. 금액(subtotal_krw, total_krw, price_change_krw, external_saving_krw)은 서버 응답을 그대로 쓰고
// 여기서 계산하지 않는다(글자만 만든다).
import { MAX_ITEM_QUANTITY, formatPrice, maxOrderQuantity } from './productViewModel.js'
import { communityPostPath } from './communityViewModel.js'

export const LOGIN_REQUIRED_MESSAGE = '로그인 후 이용할 수 있습니다.'
// 장바구니 구성으로 견적 의견 받기: 견적 요청 글쓰기가 from=cart 를 보고 장바구니 부품으로 내용을 채운다
export const CART_QUOTE_PATH = '/community/build/new?from=cart'
// 다른 화면(비교 등)에서 장바구니에 담았을 때 토스트 문구
export const CART_TOASTS = {
  added: '장바구니에 담았어요',
  login: '로그인이 필요해요',
  failed: '장바구니에 담지 못했어요. 다시 시도해 주세요.',
}
// 견적 담기(POST /cart/builds, spec docs/specs/2026-11-01-build-id-purpose.md)에서 뺀 부품의 이유(skipped[].reason) → 표시 이름. 문구도 이 순서다
export const BUILD_SKIP_REASONS = [
  { code: 'sold_out', label: '품절' },
  { code: 'unavailable', label: '판매 안 함' },
  { code: 'limit', label: '최대 수량' },
]
// 장바구니 줄에서 그 줄이 견적에서 담겼다는 표시(cart item 의 build)
export const BUILD_SOURCE_LABEL = '견적에서 담음'
export const BUILD_ADD_FAILED_MESSAGE = '견적을 장바구니에 담지 못했습니다. 다시 시도해 주세요.'
// 이벤트 props 배열의 최대 길이(tracking.js 의 MAX_PROP_LIST_LENGTH 와 같다)
const MAX_EVENT_LIST_LENGTH = 20

/** 'loading' | 'guest' | 'error' | 'empty' | 'ready' */
export function getCartPageState({ loading = false, needsLogin = false, error = '', cart = null } = {}) {
  if (loading) return 'loading'
  if (needsLogin) return 'guest'
  if (error) return 'error'
  return cart?.items?.length ? 'ready' : 'empty'
}

/** 서버로 보내기 전 검사(서버와 같은 규칙: 정수 1~10). 문제가 없으면 ''. */
export function validateCartQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) return '수량은 1개 이상 선택해 주세요.'
  if (quantity > MAX_ITEM_QUANTITY) return `한 상품은 ${MAX_ITEM_QUANTITY}개까지 담을 수 있습니다.`
  return ''
}

export function validateCartItem({ productId, quantity } = {}) {
  if (!Number.isSafeInteger(productId) || productId < 1) return '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'
  return validateCartQuantity(quantity)
}

/** 견적 담기 전 검사(서버와 같은 규칙: comment_id 는 1 이상의 정수). 문제가 없으면 ''. */
export function validateBuildComment(commentId) {
  if (!Number.isSafeInteger(commentId) || commentId < 1) return '견적 정보가 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.'
  return ''
}

const listOf = (value) => (Array.isArray(value) ? value : [])

/** 견적 담기 성공 문구. N 은 이번에 더한 부품 줄 수(서버 응답 added 의 길이). */
export function buildAddedMessage(result) {
  return `부품 ${listOf(result?.added).length}개를 장바구니에 담았습니다.`
}

/** 뺀 부품 요약 '(품절 1개, 최대 수량 1개 제외)'. 뺀 것이 없으면 ''. 모르는 이유는 '기타'로 센다. */
export function buildSkippedSummary(result) {
  const skipped = listOf(result?.skipped)
  if (!skipped.length) return ''
  const count = (code) => skipped.filter((item) => item?.reason === code).length
  const parts = BUILD_SKIP_REASONS.filter(({ code }) => count(code)).map(({ code, label }) => `${label} ${count(code)}개`)
  const known = BUILD_SKIP_REASONS.reduce((sum, { code }) => sum + count(code), 0)
  if (skipped.length > known) parts.push(`기타 ${skipped.length - known}개`)
  return `(${parts.join(', ')} 제외)`
}

/** 견적 담기 결과 한 줄: '부품 1개를 장바구니에 담았습니다. (품절 1개, 최대 수량 1개 제외)'. 뺀 것이 없으면 앞 문장만. */
export function buildResultMessage(result) {
  return [buildAddedMessage(result), buildSkippedSummary(result)].filter(Boolean).join(' ')
}

/** build_add_to_cart 이벤트 props. 값은 서버 응답 그대로이고 목록은 20개까지 자른다. */
export function buildAddEventProps(result) {
  const added = listOf(result?.added)
  const skipped = listOf(result?.skipped)
  return {
    build_id: result?.build_id ?? null,
    post_id: result?.post_id ?? null,
    comment_id: result?.comment_id ?? null,
    added_count: added.length,
    skipped_count: skipped.length,
    product_ids: added.slice(0, MAX_EVENT_LIST_LENGTH).map((item) => item?.product_id ?? null),
    skipped_reasons: skipped.slice(0, MAX_EVENT_LIST_LENGTH).map((item) => item?.reason ?? null),
  }
}

/**
 * 장바구니 줄의 "견적에서 담음" 표시. 견적에서 담은 줄이 아니면(build 가 null) null.
 * 견적 글(post_id)이 있으면 { label, href: '/community/posts/{post_id}' }, post_id 가 null 이면 href ''(글자만).
 */
export function cartBuildSource(item) {
  const build = item?.build
  if (!build || typeof build !== 'object') return null
  const postId = build.post_id
  return { label: BUILD_SOURCE_LABEL, href: Number.isSafeInteger(postId) && postId > 0 ? communityPostPath(postId) : '' }
}

/** 장바구니 행의 재고 경고. 주문할 수 없는 상태면 문구, 아니면 ''. */
export function cartStockWarning(item) {
  const stock = Math.max(0, Number(item?.stock) || 0)
  if (stock === 0) return '품절된 상품입니다. 삭제한 뒤 주문해 주세요.'
  if (Number(item?.quantity) > stock) return `재고가 ${stock}개 남았습니다. 수량을 줄여 주세요.`
  return ''
}

function amount(value) {
  return value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
}

/**
 * 담은 뒤 가격 변동 줄(서버 price_change_krw = 지금 가격 - 담을 때 가격, 한 개 기준): { text, tone, arrow }.
 * 내려감 → '담았을 때보다 N원 내려갔어요'(down ▼), 오름 → '담았을 때보다 N원 올랐어요'(up ▲), 같음 → '담은 뒤 가격 변동 없음'(flat).
 * 담을 때 가격을 모르는 줄(added_price_krw null, 기능 전에 담은 줄)은 null(줄을 보여 주지 않는다).
 */
export function priceChangeLine(item) {
  const change = amount(item?.price_change_krw)
  if (amount(item?.added_price_krw) === null || change === null) return null
  if (change < 0) return { text: `담았을 때보다 ${formatPrice(-change)} 내려갔어요`, tone: 'down', arrow: '▼' }
  if (change > 0) return { text: `담았을 때보다 ${formatPrice(change)} 올랐어요`, tone: 'up', arrow: '▲' }
  return { text: '담은 뒤 가격 변동 없음', tone: 'flat', arrow: '' }
}

/** 요약의 "타몰 최저가 대비" 금액 '−12,000원'(서버 external_saving_krw). 0 이하·값 없음이면 ''(줄을 숨긴다). */
export function externalSavingText(cart) {
  const saving = amount(cart?.external_saving_krw)
  return saving !== null && saving > 0 ? `−${formatPrice(saving)}` : ''
}

/**
 * 수량 −/+ 버튼이 보낼 수량. 보낼 수 없으면 null(버튼을 막는다).
 * 1개 아래로는 줄이지 않고(빼려면 삭제), + 는 한 상품 최대 수량·재고(maxOrderQuantity)를 넘지 않는다.
 * 재고보다 많이 담긴 줄도 − 로 한 개씩 줄일 수 있다.
 */
export function steppedQuantity(item, delta) {
  const current = item?.quantity
  if (!Number.isInteger(current) || !Number.isInteger(delta) || delta === 0) return null
  const next = current + delta
  if (next < 1 || next > MAX_ITEM_QUANTITY) return null
  if (delta > 0 && next > maxOrderQuantity(item?.stock)) return null
  return next
}

/** 다른 화면에서 장바구니 담기에 실패했을 때 토스트: 401 은 '로그인이 필요해요', 그 밖은 cartError(서버 문구 또는 기본 문구). */
export function cartAddFailureToast(error) {
  return error?.response?.status === 401 ? CART_TOASTS.login : cartError(error, CART_TOASTS.failed)
}

/** 상품이 있고 모든 행이 재고 안에 있어야 주문서로 갈 수 있다(최종 확인은 서버가 한다). */
export function canCheckout(cart) {
  const items = cart?.items || []
  return items.length > 0 && items.every((item) => !cartStockWarning(item))
}

/**
 * 장바구니·주문 요청 실패 문구.
 * 401 은 로그인 만료, 5xx·네트워크는 fallback, 그 밖(404·409 재고 부족·422)은 서버 message 를 그대로 보여 준다.
 */
export function cartError(error, fallback) {
  const status = error?.response?.status
  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'
  if (!status || status >= 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}

/**
 * 주문서 주소. 인자가 없으면 장바구니 전체(/checkout),
 * 상품과 수량을 주면 그 상품만 바로 구매(/checkout?product={id}&quantity={n}).
 */
export function checkoutPath({ productId, quantity } = {}) {
  if (productId == null) return '/checkout'
  const params = new URLSearchParams({ product: String(productId), quantity: String(quantity ?? 1) })
  return `/checkout?${params.toString()}`
}

export function goToCheckout(options = {}, location = window.location) {
  location.assign(checkoutPath(options))
}
