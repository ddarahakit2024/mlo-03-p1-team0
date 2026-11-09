// 주문 API(src/api/orderApi.js)와 PortOne 결제 요청(src/api/portonePayment.js)의 요청 모양.
// spec API 계약: POST /orders, POST /orders/confirm, GET /orders, GET /orders/{payment_id},
// 반품(docs/specs/2026-11-01-returns-refunds.md): POST /orders/{payment_id}/returns, POST /orders/{payment_id}/returns/{return_id}/withdraw
import axios from 'axios'
import { jest } from '@jest/globals'
import { confirmOrder, createOrder, createReturn, fetchOrder, fetchOrders, withdrawReturn } from './api/orderApi.js'
import { createPortOnePaymentRequest } from './api/portonePayment.js'

afterEach(() => jest.restoreAllMocks())

const shipping = { recipientName: '  김철수 ', phone: '010-1234-5678', postalCode: ' 06236', address1: '서울특별시 강남구 테헤란로 123 ', address2: '', deliveryMemo: '  ' }
const paymentRequest = { payment_id: 'order-7f3a9c2e', order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', total_amount: 1987000, currency: 'KRW', store_id: 'store-test', channel_key: 'channel-key-test', status: 'READY' }
const detail = { payment_id: 'order-7f3a9c2e', status: 'PAID', total_krw: 1987000, items: [], shipping: {} }

test('주문 생성은 상품 번호·수량과 공백을 지운 배송지만 보낸다(금액은 보내지 않는다)', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 201, message: '주문을 생성했습니다.', result: paymentRequest } })
  await expect(createOrder({ items: [{ productId: 3, quantity: 2 }, { productId: 12, quantity: 1 }], shipping }, { apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(paymentRequest)
  expect(post).toHaveBeenCalledWith('https://api.example.test/orders', {
    items: [{ product_id: 3, quantity: 2 }, { product_id: 12, quantity: 1 }],
    shipping: { recipient_name: '김철수', phone: '010-1234-5678', postal_code: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '', delivery_memo: '' },
  }, { withCredentials: true })
  const body = post.mock.calls[0][1]
  expect(JSON.stringify(body)).not.toMatch(/price|amount|total/)
})

test('선택 칸이 없거나 null 이면 null 대신 "" 를 보낸다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: paymentRequest } })
  await createOrder({ items: [{ productId: 3, quantity: 1 }], shipping: { recipientName: '김철수', phone: '01012345678', postalCode: '06236', address1: '서울', address2: null } })
  expect(post.mock.calls[0][0]).toBe('http://127.0.0.1:8000/orders')
  expect(post.mock.calls[0][1].shipping).toEqual({ recipient_name: '김철수', phone: '01012345678', postal_code: '06236', address1: '서울', address2: '', delivery_memo: '' })
})

test.each([
  [{ items: [], shipping }, '주문할 상품이 없습니다. 장바구니에 상품을 담아 주세요.'],
  [{ items: [{ productId: '3', quantity: 1 }], shipping }, '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
  [{ items: [{ productId: 3, quantity: 11 }], shipping }, '수량은 상품마다 1~10개로 선택해 주세요.'],
  [{ items: [{ productId: 3, quantity: 1 }], shipping: { ...shipping, phone: '010-12-5678' } }, '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.'],
  [{ items: [{ productId: 3, quantity: 1 }], shipping: { ...shipping, postalCode: '1234' } }, '우편번호는 숫자 5자리로 입력해 주세요.'],
])('주문 입력이 잘못되면(%#) 요청을 보내지 않는다', async (input, message) => {
  const post = jest.spyOn(axios, 'post')
  await expect(createOrder(input)).rejects.toThrow(message)
  expect(post).not.toHaveBeenCalled()
})

test('결제 확인은 payment_id 만 쿠키와 함께 보내고 OrderDetail 을 돌려준다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 200, message: '결제가 확인되었습니다.', result: detail } })
  await expect(confirmOrder('order-7f3a9c2e')).resolves.toEqual(detail)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/orders/confirm', { payment_id: 'order-7f3a9c2e' }, { withCredentials: true })
})

test('주문 내역은 쿠키와 페이지 값을 보낸다(기본 10개)', async () => {
  const page = { items: [], total: 0, page: 2, page_size: 10 }
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await expect(fetchOrders({ page: 2, apiBaseUrl: 'https://api.example.test' })).resolves.toEqual(page)
  expect(get).toHaveBeenCalledWith('https://api.example.test/orders', { withCredentials: true, params: { page: 2, page_size: 10 } })
})

test('주문 상세는 주문 번호를 경로에 안전하게 넣는다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: detail } })
  await expect(fetchOrder('order-7f3a9c2e')).resolves.toEqual(detail)
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/orders/order-7f3a9c2e', { withCredentials: true })
  await fetchOrder('a/b?c')
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/orders/a%2Fb%3Fc', { withCredentials: true })
})

test('오류는 잡지 않고 그대로 던진다(문구는 화면이 만든다)', async () => {
  const failure = { response: { status: 409, data: { message: "'라이젠 7 7800X3D' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다." } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(createOrder({ items: [{ productId: 1, quantity: 2 }], shipping })).rejects.toBe(failure)
})

test('PortOne 결제 요청은 서버가 준 주문 번호·이름·금액을 쓰고 결제 후 /payments/complete 로 돌아온다', () => {
  expect(createPortOnePaymentRequest(paymentRequest, 'http://127.0.0.1:5173')).toEqual({
    storeId: 'store-test',
    channelKey: 'channel-key-test',
    paymentId: 'order-7f3a9c2e',
    orderName: '지포스 RTX 4070 SUPER 12GB 외 1건',
    totalAmount: 1987000,
    currency: 'KRW',
    payMethod: 'CARD',
    locale: 'KO_KR',
    redirectUrl: 'http://127.0.0.1:5173/payments/complete',
  })
})

describe('반품 신청·철회', () => {
  const returnRequest = {
    id: 41, payment_id: 'order-7f3a9c2e', status: 'REQUESTED', reason: 'changed_mind', detail: '',
    items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }],
    items_total_krw: 899000, shipping_deduction_krw: 6000, refund_amount_krw: 893000,
    requested_at: '2026-11-01T02:00:00Z', decided_at: null, reject_reason: null, refunded_at: null,
  }

  test('반품 신청은 사유·상품별 수량·자세한 내용(공백 제거)만 쿠키와 함께 보내고 ReturnRequest 를 돌려준다(금액은 보내지 않는다)', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 201, message: '반품을 신청했습니다.', result: returnRequest } })
    const input = { reason: 'defective', detail: '  팬이 돌지 않습니다. ', items: [{ productId: 3, quantity: 1 }, { productId: 12, quantity: 1 }] }
    await expect(createReturn('order-7f3a9c2e', input, { apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(returnRequest)
    expect(post).toHaveBeenCalledWith('https://api.example.test/orders/order-7f3a9c2e/returns', {
      reason: 'defective', detail: '팬이 돌지 않습니다.', items: [{ product_id: 3, quantity: 1 }, { product_id: 12, quantity: 1 }],
    }, { withCredentials: true })
    expect(JSON.stringify(post.mock.calls[0][1])).not.toMatch(/krw|amount|price|refund/)
  })

  test('자세한 내용이 비어 있으면 detail 을 보내지 않고, 주문 번호는 경로에 안전하게 넣는다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: returnRequest } })
    await createReturn('a/b?c', { reason: 'changed_mind', detail: '   ', items: [{ productId: 3, quantity: 1 }] })
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/orders/a%2Fb%3Fc/returns', { reason: 'changed_mind', items: [{ product_id: 3, quantity: 1 }] }, { withCredentials: true })
  })

  test.each([
    [{ reason: 'defective', items: [] }, '반품할 상품의 수량을 골라 주세요.'],
    [{ reason: '', items: [{ productId: 3, quantity: 1 }] }, '반품 사유를 골라 주세요.'],
    [{ reason: 'defective', items: [{ productId: 3, quantity: 0 }] }, '반품 수량을 다시 골라 주세요.'],
    [{ reason: 'defective', detail: '가'.repeat(501), items: [{ productId: 3, quantity: 1 }] }, '자세한 내용은 500자까지 입력할 수 있습니다.'],
  ])('반품 입력이 잘못되면(%#) 요청을 보내지 않는다', async (input, message) => {
    const post = jest.spyOn(axios, 'post')
    await expect(createReturn('order-7f3a9c2e', input)).rejects.toThrow(message)
    expect(post).not.toHaveBeenCalled()
  })

  test('신청 철회는 본문 없이 쿠키와 함께 보내고 WITHDRAWN 신청을 돌려준다(경로 값은 인코딩)', async () => {
    const withdrawn = { ...returnRequest, status: 'WITHDRAWN' }
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 200, message: '반품 신청을 철회했습니다.', result: withdrawn } })
    await expect(withdrawReturn('order-7f3a9c2e', 41)).resolves.toEqual(withdrawn)
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/orders/order-7f3a9c2e/returns/41/withdraw', null, { withCredentials: true })
    await withdrawReturn('a/b', 'x/1', { apiBaseUrl: 'https://api.example.test/' })
    expect(post).toHaveBeenLastCalledWith('https://api.example.test/orders/a%2Fb/returns/x%2F1/withdraw', null, { withCredentials: true })
  })

  test('반품 신청·철회의 오류(409 등)는 잡지 않고 그대로 던진다', async () => {
    const failure = { response: { status: 409, data: { message: '반품 신청 기간(결제 후 7일)이 지났습니다.' } } }
    jest.spyOn(axios, 'post').mockRejectedValue(failure)
    await expect(createReturn('order-7f3a9c2e', { reason: 'defective', items: [{ productId: 3, quantity: 1 }] })).rejects.toBe(failure)
    await expect(withdrawReturn('order-7f3a9c2e', 41)).rejects.toBe(failure)
  })
})
