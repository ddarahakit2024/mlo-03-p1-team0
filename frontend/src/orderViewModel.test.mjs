// 주문 view model(src/stores/orderViewModel.js)과 주문서·주문 경로(src/router/index.js).
import { jest } from '@jest/globals'
import {
  buyNowSummary,
  canRetryConfirm,
  checkoutProblem,
  confirmError,
  confirmedPaymentResult,
  formatOrderDate,
  formatOrderDateTime,
  getCheckoutPageState,
  getOrderPageState,
  getOrderStatus,
  getPaymentResultView,
  goToOrder,
  initialPaymentState,
  isMockPayment,
  isPaymentFailed,
  isValidPaymentId,
  orderError,
  orderLines,
  orderPath,
  orderStatusName,
  paymentFailureDetail,
  paymentFailureMessage,
  paymentWindowResult,
  readCheckoutQuery,
  readPaymentRedirect,
  shippingBody,
  validateOrderItems,
  validateShipping,
  validateShippingFields,
} from './stores/orderViewModel.js'
import { isCheckoutRoute, isPaymentCompleteRoute, resolveOrderRoute, resolveRouteName } from './router/index.js'

const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍' }
const shipping = { recipientName: '김철수', phone: '010-1234-5678', postalCode: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '', deliveryMemo: '' }

describe('주문서 주소', () => {
  test.each([
    ['', { mode: 'cart' }],
    ['?from=cart', { mode: 'cart' }],
    ['?product=3&quantity=2', { mode: 'buy-now', productId: 3, quantity: 2 }],
    ['?product=3&quantity=10', { mode: 'buy-now', productId: 3, quantity: 10 }],
    ['?product=3', { mode: 'invalid' }],
    ['?quantity=2', { mode: 'invalid' }],
    ['?product=&quantity=1', { mode: 'invalid' }],
    ['?product=0&quantity=1', { mode: 'invalid' }],
    ['?product=-3&quantity=1', { mode: 'invalid' }],
    ['?product=abc&quantity=1', { mode: 'invalid' }],
    ['?product=3.5&quantity=1', { mode: 'invalid' }],
    ['?product=99999999999999999999&quantity=1', { mode: 'invalid' }],
    ['?product=3&quantity=0', { mode: 'invalid' }],
    ['?product=3&quantity=11', { mode: 'invalid' }],
    ['?product=3&quantity=1.5', { mode: 'invalid' }],
  ])('%s → %o', (search, expected) => expect(readCheckoutQuery(search)).toEqual(expected))
})

describe('주문서 상품', () => {
  test('바로 구매는 장바구니와 같은 모양의 요약을 만든다(합계는 표시용)', () => {
    expect(buyNowSummary(gpu, 2)).toEqual({
      items: [{ product_id: 3, name: gpu.name, brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }],
      item_count: 2,
      total_krw: 1798000,
    })
  })

  const row = (stock, quantity) => ({ items: [{ product_id: 3, stock, quantity }] })
  test.each([
    [null, false, ''],
    [{ items: [] }, false, ''],
    [row(7, 2), false, ''],
    [row(0, 1), false, '품절되었거나 재고보다 많이 담은 상품이 있습니다. 장바구니에서 정리한 뒤 주문해 주세요.'],
    [row(1, 2), false, '품절되었거나 재고보다 많이 담은 상품이 있습니다. 장바구니에서 정리한 뒤 주문해 주세요.'],
    [row(7, 2), true, ''],
    [row(0, 1), true, '품절된 상품입니다. 다른 상품을 선택해 주세요.'],
    [row(3, 5), true, '재고가 3개 남았습니다. 상품 페이지에서 수량을 줄여 주세요.'],
  ])('주문할 수 없는 이유 %o (바로 구매 %s) → %p', (summary, buyNow, message) => expect(checkoutProblem(summary, { buyNow })).toBe(message))

  test('주문서 상품을 POST /orders 의 items(번호와 수량)로 바꾼다', () => {
    expect(orderLines({ items: [{ product_id: 3, quantity: 2, price_krw: 899000 }, { product_id: 12, quantity: 1 }] })).toEqual([{ productId: 3, quantity: 2 }, { productId: 12, quantity: 1 }])
    expect(orderLines(null)).toEqual([])
  })

  const lines = (count) => Array.from({ length: count }, (_, index) => ({ productId: index + 1, quantity: 1 }))
  test.each([
    [[{ productId: 3, quantity: 1 }], ''],
    [lines(20), ''],
    [[], '주문할 상품이 없습니다. 장바구니에 상품을 담아 주세요.'],
    [null, '주문할 상품이 없습니다. 장바구니에 상품을 담아 주세요.'],
    [lines(21), '한 번에 20종류까지 주문할 수 있습니다. 장바구니에서 상품을 줄여 주세요.'],
    [[{ productId: 0, quantity: 1 }], '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
    [[{ productId: '3', quantity: 1 }], '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
    [[{ productId: 3, quantity: 0 }], '수량은 상품마다 1~10개로 선택해 주세요.'],
    [[{ productId: 3, quantity: '2' }], '수량은 상품마다 1~10개로 선택해 주세요.'],
    [[{ productId: 3, quantity: 11 }], '수량은 상품마다 1~10개로 선택해 주세요.'],
    [[{ productId: 3, quantity: 1 }, { productId: 3, quantity: 2 }], '같은 상품이 두 번 들어 있습니다. 장바구니를 확인해 주세요.'],
  ])('주문 상품 %#', (items, message) => expect(validateOrderItems(items)).toBe(message))
})

describe('배송지 검증(서버 규칙과 같다)', () => {
  test.each([
    [{}, {}],
    [{ phone: '01012345678' }, {}],
    [{ phone: '02-123-4567' }, {}],
    [{ phone: ' 031-1234-5678 ' }, {}],
    [{ postalCode: ' 06236 ' }, {}],
    [{ recipientName: '가'.repeat(50), address1: '가'.repeat(200), address2: '가'.repeat(200), deliveryMemo: '가'.repeat(100) }, {}],
    [{ recipientName: '😀'.repeat(50) }, {}],
    [{ recipientName: '   ' }, { recipientName: '받는 분 이름을 입력해 주세요.' }],
    [{ recipientName: '가'.repeat(51) }, { recipientName: '받는 분 이름은 50자까지 입력할 수 있습니다.' }],
    [{ phone: '' }, { phone: '연락처를 입력해 주세요.' }],
    [{ phone: '1012345678' }, { phone: '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.' }],
    [{ phone: '010 1234 5678' }, { phone: '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.' }],
    [{ phone: '010-12345-678' }, { phone: '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.' }],
    [{ phone: '010-1234-５６７８' }, { phone: '연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.' }],
    [{ postalCode: '' }, { postalCode: '우편번호를 입력해 주세요.' }],
    [{ postalCode: '1234' }, { postalCode: '우편번호는 숫자 5자리로 입력해 주세요.' }],
    [{ postalCode: '06-236' }, { postalCode: '우편번호는 숫자 5자리로 입력해 주세요.' }],
    [{ address1: ' ' }, { address1: '주소를 입력해 주세요.' }],
    [{ address1: '가'.repeat(201) }, { address1: '주소는 200자까지 입력할 수 있습니다.' }],
    [{ address2: '가'.repeat(201) }, { address2: '상세 주소는 200자까지 입력할 수 있습니다.' }],
    [{ deliveryMemo: '가'.repeat(101) }, { deliveryMemo: '배송 메모는 100자까지 입력할 수 있습니다.' }],
    [{ address2: null, deliveryMemo: undefined }, {}],
  ])('%o → %o', (change, errors) => expect(validateShippingFields({ ...shipping, ...change })).toEqual(errors))

  test('빈 배송지는 필수 칸 4개가 모두 오류이고, 첫 오류 문구를 돌려준다', () => {
    expect(Object.keys(validateShippingFields({}))).toEqual(['recipientName', 'phone', 'postalCode', 'address1'])
    expect(validateShipping({})).toBe('받는 분 이름을 입력해 주세요.')
    expect(validateShipping(shipping)).toBe('')
  })

  test('서버로 보낼 배송지는 snake_case, 앞뒤 공백 제거, 선택 칸은 ""', () => {
    expect(shippingBody({ recipientName: ' 김철수 ', phone: '010-1234-5678 ', postalCode: '06236', address1: ' 서울 ', address2: null })).toEqual({
      recipient_name: '김철수', phone: '010-1234-5678', postal_code: '06236', address1: '서울', address2: '', delivery_memo: '',
    })
  })
})

describe('화면 상태', () => {
  const summary = { items: [{ product_id: 3 }], item_count: 1, total_krw: 899000 }
  test.each([
    [{ invalid: true, loading: true }, 'invalid'],
    [{ loading: true }, 'loading'],
    [{ needsLogin: true }, 'guest'],
    [{ missing: true }, 'missing'],
    [{ error: '실패' }, 'error'],
    [{ summary: null }, 'empty'],
    [{ summary: { items: [], item_count: 0, total_krw: 0 } }, 'empty'],
    [{ summary, problem: '품절된 상품입니다.' }, 'unavailable'],
    [{ summary }, 'ready'],
  ])('주문서 %o → %s', (data, state) => expect(getCheckoutPageState(data)).toBe(state))

  test.each([
    [{ invalid: true }, 'invalid'],
    [{ loading: true }, 'loading'],
    [{ needsLogin: true }, 'guest'],
    [{ missing: true }, 'missing'],
    [{ error: '실패' }, 'error'],
    [{ orders: [] }, 'empty'],
    [{ orders: [{ payment_id: 'order-1' }] }, 'ready'],
    [{ detail: true, order: null }, 'missing'],
    [{ detail: true, order: { payment_id: 'order-1' } }, 'ready'],
  ])('주문 목록·상세 %o → %s', (data, state) => expect(getOrderPageState(data)).toBe(state))
})

describe('주문 상태와 날짜', () => {
  test.each([
    ['READY', '결제 대기', 'ready'],
    ['PAID', '결제 완료', 'paid'],
    ['CANCELLED', '취소됨', 'cancelled'],
    ['SOMETHING', '확인 중', 'ready'],
    [undefined, '확인 중', 'ready'],
  ])('%s → %s', (status, label, tone) => {
    expect(getOrderStatus(status)).toEqual({ label, tone })
    expect(orderStatusName(status)).toBe(label)
  })

  test.each([
    ['2026-10-30T01:12:00Z', '2026년 10월 30일', '2026년 10월 30일 오전 10:12'],
    ['2026-10-30T16:05:00Z', '2026년 10월 31일', '2026년 10월 31일 오전 1:05'],
    ['2026-10-30T01:12:00+00:00', '2026년 10월 30일', '2026년 10월 30일 오전 10:12'],
    ['2026-10-30T01:12:00', '2026년 10월 30일', '2026년 10월 30일 오전 10:12'],
    [null, '', ''],
    ['not-a-date', '', ''],
  ])('UTC %s → 한국 시간 %s', (value, date, dateTime) => {
    expect(formatOrderDate(value)).toBe(date)
    expect(formatOrderDateTime(value)).toBe(dateTime)
  })
})

describe('주문 오류 문구', () => {
  const fallback = '주문 내역을 불러오지 못했습니다. 다시 시도해 주세요.'
  test.each([
    ['401 은 로그인 만료', { response: { status: 401, data: { message: 'Authentication required.' } } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    ['409 재고 부족은 서버 문구(상품 이름 포함)', { response: { status: 409, data: { message: "'라이젠 7 7800X3D' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다." } } }, "'라이젠 7 7800X3D' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다."],
    ['404 는 서버 문구', { response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } }, '상품을 찾을 수 없습니다.'],
    ['503 결제 설정 없음은 서버 문구', { response: { status: 503, data: { message: '결제 연동 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.' } } }, '결제 연동 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.'],
    ['500 은 우리 문구', { response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } }, fallback],
    ['HTML 오류 응답은 우리 문구', { response: { status: 502, data: '<html>Bad Gateway</html>' } }, fallback],
    ['네트워크 오류는 우리 문구', { isAxiosError: true, code: 'ERR_NETWORK' }, fallback],
  ])('%s', (_name, error, message) => expect(orderError(error, fallback)).toBe(message))

  test.each([
    ['401 로그인 만료', { response: { status: 401, data: { message: 'Authentication required.' } } }, '로그인이 만료되어 결제를 확인하지 못했습니다. 새 탭에서 다시 로그인한 뒤 다시 시도해 주세요.', true],
    ['404 주문 없음', { response: { status: 404, data: { message: '주문을 찾을 수 없습니다.' } } }, '주문을 찾을 수 없습니다. 결제할 때 사용한 계정으로 로그인했는지 확인해 주세요.', false],
    ['409 금액 불일치', { response: { status: 409, data: { message: '결제가 완료되지 않았거나 결제 금액이 주문과 일치하지 않습니다.' } } }, '결제가 완료되지 않았거나 결제 금액이 주문과 일치하지 않습니다.', false],
    ['409 재고 부족 취소', { response: { status: 409, data: { message: '재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.' } } }, '재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.', false],
    ['409 취소된 주문', { response: { status: 409, data: { message: '취소된 주문입니다.' } } }, '취소된 주문입니다.', false],
    ['502 PortOne 조회 실패', { response: { status: 502, data: { message: '포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } }, '포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', true],
    ['502 재고 부족인데 취소 실패', { response: { status: 502, data: { message: '재고가 부족하지만 결제 취소에 실패했습니다. 고객센터로 문의해 주세요.' } } }, '재고가 부족하지만 결제 취소에 실패했습니다. 고객센터로 문의해 주세요.', true],
    ['503 결제 설정 없음', { response: { status: 503, data: { message: '결제 연동 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.' } } }, '결제 연동 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.', true],
    ['500 서버 오류', { response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } }, '결제 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', true],
    ['HTML 502 응답', { response: { status: 502, data: '<html>Bad Gateway</html>' } }, '결제 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', true],
    ['서버 연결 실패', { isAxiosError: true, code: 'ERR_NETWORK' }, '서버에 연결하지 못해 결제를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', true],
  ])('결제 확인 실패: %s', (_name, error, message, retry) => {
    expect(confirmError(error)).toBe(message)
    expect(canRetryConfirm(error)).toBe(retry)
  })
})

describe('결제 방식(POST /orders 응답의 provider)', () => {
  test.each([
    ['mock', { payment_id: 'order-1', provider: 'mock', store_id: '', channel_key: '' }, true],
    ['portone', { payment_id: 'order-1', provider: 'portone', store_id: 'store-test', channel_key: 'channel-key-test' }, false],
    ['provider 없음(예전 응답)', { payment_id: 'order-1', store_id: 'store-test', channel_key: 'channel-key-test' }, false],
    ['대문자 MOCK(계약 밖 값)', { payment_id: 'order-1', provider: 'MOCK' }, false],
    ['응답 없음', undefined, false],
  ])('%s → 모의 결제 %s', (_name, order, mock) => expect(isMockPayment(order)).toBe(mock))
})

describe('PortOne 결제창 결과', () => {
  test.each([
    [{ paymentId: 'order-1', transactionType: 'PAYMENT', txId: 'tx-1' }, false],
    [undefined, false],
    [{ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다.' }, true],
    [{ code: '', message: '' }, true],
  ])('%o → 실패 %s', (response, failed) => expect(isPaymentFailed(response)).toBe(failed))

  test.each([
    [{ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다.' }, '사용자가 결제를 취소했습니다. 다시 결제하려면 결제하기를 눌러 주세요.'],
    [{ code: 'FAILURE_TYPE_PG' }, '결제가 취소되었거나 완료되지 않았습니다. 다시 결제하려면 결제하기를 눌러 주세요.'],
  ])('안내 문구 %o', (response, message) => expect(paymentFailureMessage(response)).toBe(message))

  test('PortOne 문구는 200자까지만 쓴다', () => {
    expect(paymentFailureMessage({ code: 'X', message: '가'.repeat(500) })).toBe(`${'가'.repeat(200)} 다시 결제하려면 결제하기를 눌러 주세요.`)
  })
})

describe('결제 완료 주소(PortOne redirect)', () => {
  test.each([
    ['?paymentId=order-7f3a9c2e', { paymentId: 'order-7f3a9c2e', failureCode: '', failureMessage: '' }, 'confirming'],
    ['?paymentId=order-7f3a9c2e&code=FAILURE_TYPE_PG&message=%EA%B2%B0%EC%A0%9C%EB%A5%BC%20%EC%B7%A8%EC%86%8C%ED%96%88%EC%8A%B5%EB%8B%88%EB%8B%A4.', { paymentId: 'order-7f3a9c2e', failureCode: 'FAILURE_TYPE_PG', failureMessage: '결제를 취소했습니다.' }, 'cancelled'],
    ['?code=FAILURE_TYPE_PG', { paymentId: '', failureCode: 'FAILURE_TYPE_PG', failureMessage: '' }, 'cancelled'],
    ['', { paymentId: '', failureCode: '', failureMessage: '' }, 'missing'],
    ['?paymentId=%20%20', { paymentId: '', failureCode: '', failureMessage: '' }, 'missing'],
    ['?paymentId=order%2F..%2Fadmin', { paymentId: '', failureCode: '', failureMessage: '' }, 'missing'],
  ])('%s', (search, redirect, state) => {
    expect(readPaymentRedirect(search)).toEqual(redirect)
    expect(initialPaymentState(redirect)).toBe(state)
  })

  test('주소에서 온 실패 문구는 200자까지만 쓴다', () => {
    expect(readPaymentRedirect(`?code=X&message=${'가'.repeat(500)}`).failureMessage).toHaveLength(200)
  })

  test.each([
    ['confirming', '결제 확인 중', false],
    ['paid', '주문이 완료되었습니다', false],
    ['cancelled', '결제를 완료하지 못했습니다', true],
    ['missing', '결제를 완료하지 못했습니다', true],
    ['failed', '결제를 확인하지 못했습니다', true],
    ['unknown', '결제를 확인하지 못했습니다', true],
  ])('%s → %s', (state, heading, failed) => expect(getPaymentResultView(state)).toMatchObject({ heading, failed }))

  test('취소·정보 없음은 다음 행동을 안내하는 기본 문구가 있다', () => {
    expect(getPaymentResultView('cancelled').message).toBe('결제가 취소되었거나 완료되지 않았습니다. 장바구니에서 다시 주문해 주세요.')
    expect(getPaymentResultView('missing').message).toBe('결제 정보를 찾을 수 없습니다. 주문 내역에서 결제 상태를 확인하거나 장바구니에서 다시 주문해 주세요.')
  })
})

describe('주문 번호와 이동', () => {
  test.each([
    ['order-7f3a9c2e0b1d4e5f', true],
    ['ORDER_1', true],
    ['a'.repeat(100), true],
    ['a'.repeat(101), false],
    ['', false],
    ['order 1', false],
    ['order/1', false],
    ['order%2F1', false],
    [null, false],
  ])('%p → %s', (value, valid) => expect(isValidPaymentId(value)).toBe(valid))

  test('주문 상세 주소로 이동한다', () => {
    const location = { assign: jest.fn() }
    expect(orderPath('order-1')).toBe('/orders/order-1')
    goToOrder('order-1', location)
    expect(location.assign).toHaveBeenCalledWith('/orders/order-1')
  })

  test.each([
    ['/orders', { name: 'orders' }],
    ['/orders/', { name: 'orders' }],
    ['/orders/order-7f3a9c2e', { name: 'order-detail', paymentId: 'order-7f3a9c2e' }],
    ['/orders/order-7f3a9c2e/', { name: 'order-detail', paymentId: 'order-7f3a9c2e' }],
    ['/orders/order%201', { name: 'order-detail', paymentId: null }],
    ['/orders/a/b', { name: 'order-detail', paymentId: null }],
    ['/orders/<script>', { name: 'order-detail', paymentId: null }],
    ['/ordersx', null],
    ['/products/3', null],
  ])('경로 %s → %o', (pathname, route) => expect(resolveOrderRoute(pathname)).toEqual(route))

  test.each([
    ['/checkout', true], ['/checkout/', true], ['/checkout/1', false], ['/checkouts', false],
  ])('주문서 경로 %s → %s', (pathname, expected) => expect(isCheckoutRoute(pathname)).toBe(expected))

  test.each([
    ['/payments/complete', true], ['/payments', false],
  ])('결제 완료 경로 %s → %s', (pathname, expected) => expect(isPaymentCompleteRoute(pathname)).toBe(expected))
})

describe('결제 결과 이벤트(payment_result) 값', () => {
  test.each([
    ['사용자가 닫음(pgCode)', { code: 'FAILURE_TYPE_PG', pgCode: 'PAY_PROCESS_CANCELED', message: '사용자가 결제를 중단했습니다.' }, 'cancelled'],
    ['취소 문구', { code: 'FAILURE_TYPE_PG', message: '결제를 취소했습니다.' }, 'cancelled'],
    ['취소 코드', { code: 'USER_CANCEL' }, 'cancelled'],
    ['카드 거절', { code: 'FAILURE_TYPE_PG', message: '카드 한도를 초과했습니다.' }, 'failed'],
    ['코드만 있음', { code: 'FAILURE_TYPE_PROCESS' }, 'failed'],
    ['값이 없음', null, 'failed'],
  ])('결제창 결과 %s → %s', (_name, response, result) => expect(paymentWindowResult(response)).toBe(result))

  test.each([
    [{ status: 'PAID' }, 'paid'],
    [{ status: 'CANCELLED' }, 'cancelled'],
    [{ status: 'READY' }, 'failed'],
    [{}, 'paid'],
    [undefined, 'paid'],
  ])('결제 확인 응답 %j → %s', (order, result) => expect(confirmedPaymentResult(order)).toBe(result))

  test.each([
    ['409', { response: { status: 409, data: { message: '결제가 완료되지 않았습니다.' } } }, { status: 409 }],
    ['axios 502', { isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 502 } }, { status: 502, error_code: 'ERR_BAD_RESPONSE' }],
    ['네트워크', { isAxiosError: true, code: 'ERR_NETWORK' }, { error_code: 'ERR_NETWORK' }],
    ['알 수 없음', new Error('boom'), {}],
    ['없음', undefined, {}],
  ])('실패 정보 %s → %j (서버 문구는 넣지 않는다)', (_name, error, detail) => expect(paymentFailureDetail(error)).toEqual(detail))
})

describe('화면 이름(page_view 의 route)', () => {
  test.each([
    ['/', 'products'],
    ['/products', 'products'],
    ['/products/3', 'product-detail'],
    ['/unknown/path', 'products'],
    ['/cart', 'cart'],
    ['/checkout', 'checkout'],
    ['/payments/complete', 'payment-complete'],
    ['/orders', 'orders'],
    ['/orders/order-7f3a9c2e', 'order-detail'],
    ['/questions', 'questions'],
    ['/questions/new', 'question-new'],
    ['/questions/7', 'question-detail'],
    ['/questions/7/edit', 'question-edit'],
    ['/login', 'login'],
    ['/login/kakao/callback', 'login'],
  ])('%s → %s', (pathname, name) => expect(resolveRouteName(pathname)).toBe(name))
})
