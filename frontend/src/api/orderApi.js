import axios from 'axios'
import { baseUrl } from './config.js'
import { ORDER_PAGE_SIZE, shippingBody, validateOrderItems, validateShipping } from '../stores/orderViewModel.js'
import { returnRequestBody, validateReturnRequest } from '../stores/returnViewModel.js'

// 주문·결제 확인은 로그인 사용자 전용이다. 모든 요청에 쿠키를 싣는다.
// 금액은 보내지 않는다. 서버가 DB 가격으로 합계를 계산한다(spec 정책).
const credentials = { withCredentials: true }

/**
 * POST /orders → PaymentRequest({ payment_id, order_name, total_amount, currency, store_id, channel_key, status, provider }).
 * provider 는 'portone' | 'mock'(모의 결제면 store_id·channel_key 가 빈 문자열). 예전 응답에는 없을 수 있다.
 */
export async function createOrder({ items, shipping }, { apiBaseUrl } = {}) {
  const error = validateOrderItems(items) || validateShipping(shipping)
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/orders`, {
    items: items.map(({ productId, quantity }) => ({ product_id: productId, quantity })),
    shipping: shippingBody(shipping),
  }, credentials)
  return response.data.result
}

/** POST /orders/confirm → OrderDetail. 이미 PAID 인 주문은 같은 결과를 돌려준다(멱등). */
export async function confirmOrder(paymentId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/orders/confirm`, { payment_id: paymentId }, credentials)
  return response.data.result
}

/** GET /orders → OrderPage(READY 제외, 최신순). */
export async function fetchOrders({ page = 1, pageSize = ORDER_PAGE_SIZE, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/orders`, { ...credentials, params: { page, page_size: pageSize } })
  return response.data.result
}

/** GET /orders/{payment_id} → OrderDetail. 없거나 남의 주문은 404. */
export async function fetchOrder(paymentId, { apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/orders/${encodeURIComponent(paymentId)}`, credentials)
  return response.data.result
}

/**
 * POST /orders/{payment_id}/returns → ReturnRequest(201). 본문 { reason, detail?, items: [{ product_id, quantity }] }.
 * 환불 금액은 서버가 계산해 돌려준다(보내지 않는다). 신청 가능 수량·기한을 넘으면 409, 남의 주문은 404.
 */
export async function createReturn(paymentId, { reason, detail = '', items = [] } = {}, { apiBaseUrl } = {}) {
  const error = validateReturnRequest({ reason, detail, items })
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/orders/${encodeURIComponent(paymentId)}/returns`, returnRequestBody({ reason, detail, items }), credentials)
  return response.data.result
}

/** POST /orders/{payment_id}/returns/{return_id}/withdraw → ReturnRequest(WITHDRAWN). REQUESTED 가 아니면 409. 본문 없음. */
export async function withdrawReturn(paymentId, returnId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/orders/${encodeURIComponent(paymentId)}/returns/${encodeURIComponent(returnId)}/withdraw`, null, credentials)
  return response.data.result
}
