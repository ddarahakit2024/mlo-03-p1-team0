// 반품·환불(spec docs/specs/2026-11-01-returns-refunds.md)의 순수 함수: 사유·상태 이름, 기한, 신청서 줄·검증·본문, 관리자 화면 주소·상태, 오류 문구, 이벤트 값.
// 환불 금액·신청 가능 수량은 서버 값을 그대로 쓰는지(계산하지 않는지)도 본다.
import { jest } from '@jest/globals'
import {
  ADMIN_RETURN_TABS, CHANGED_MIND_NOTICE, MAX_REJECT_REASON_LENGTH, MAX_RETURN_DETAIL_LENGTH, REFUND_FAILED_MESSAGE, RETURN_REASONS, RETURN_STATUS_CODES,
  adminReturnError, adminReturnTabName, formatReturnDeadline, getAdminReturnsPageState, getReturnFormState, isReturnWindowOpen, normalizeReturnStatus,
  parseServerTime, paymentProviderName, readAdminReturnsQuery, replaceAdminReturnsQuery, returnError, returnLines, returnQuantityOptions, returnReasonName,
  returnRequestBody, returnRequestEventProps, returnSelection, returnStatus, selectedReturnQuantity, upsertReturn, validateRejectReason, validateReturnRequest,
} from './stores/returnViewModel.js'
import { MAX_PROP_LIST_LENGTH } from './stores/tracking.js'
import { isAdminReturnsRoute, resolveRouteName } from './router/index.js'

const order = {
  payment_id: 'order-7f3a9c2e',
  status: 'PAID',
  paid_at: '2026-10-30T01:13:00Z',
  return_deadline: '2026-11-06T01:13:00Z',
  items: [
    { product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', unit_price_krw: 899000, quantity: 2, subtotal_krw: 1798000, build_id: 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6' },
    { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', unit_price_krw: 189000, quantity: 1, subtotal_krw: 189000, build_id: null },
  ],
  returnable: [{ product_id: 3, quantity: 1 }, { product_id: 12, quantity: 1 }],
  returns: [],
}
const BEFORE = Date.parse('2026-11-01T00:00:00Z')
const AFTER = Date.parse('2026-11-06T01:13:00Z')

describe('사유·상태 이름', () => {
  test('사유는 spec 의 5개(코드 순서 그대로)', () => {
    expect(RETURN_REASONS.map((reason) => [reason.code, reason.name])).toEqual([
      ['defective', '불량'], ['incompatible', '호환 안 됨'], ['not_as_described', '설명과 다름'], ['wrong_item', '오배송'], ['changed_mind', '단순 변심'],
    ])
    expect(CHANGED_MIND_NOTICE).toBe('단순 변심은 왕복 배송비 6,000원을 빼고 환불합니다.')
  })

  test.each([
    ['incompatible', '호환 안 됨'], ['changed_mind', '단순 변심'], ['unknown_code', 'unknown_code'], [null, ''],
  ])('사유 %p → %p', (code, name) => expect(returnReasonName(code)).toBe(name))

  test.each([
    ['REQUESTED', '신청됨', ''],
    ['APPROVED', '승인됨·환불 대기', 'shop-order-status--warning'],
    ['REFUNDED', '환불 완료', 'shop-order-status--paid'],
    ['REJECTED', '거절됨', 'shop-order-status--cancelled'],
    ['WITHDRAWN', '철회함', 'shop-order-status--muted'],
    ['SOMETHING', '확인 중', ''],
  ])('상태 %s → 배지 글자 %p', (status, label, className) => expect(returnStatus(status)).toEqual({ label, className }))

  test('관리자 상태 탭: 전체·신청·환불 대기·환불 완료·거절·철회', () => {
    expect(ADMIN_RETURN_TABS.map((tab) => [tab.status, tab.name])).toEqual([
      [null, '전체'], ['REQUESTED', '신청'], ['APPROVED', '환불 대기'], ['REFUNDED', '환불 완료'], ['REJECTED', '거절'], ['WITHDRAWN', '철회'],
    ])
    expect(RETURN_STATUS_CODES).toEqual(['REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED', 'WITHDRAWN'])
    expect(adminReturnTabName('APPROVED')).toBe('환불 대기')
    expect(adminReturnTabName(null)).toBe('전체')
  })

  test.each([['mock', '모의 결제'], ['portone', 'PortOne'], ['kakao', 'kakao'], [null, '-']])('결제 방식 %p → %p', (provider, name) => {
    expect(paymentProviderName(provider)).toBe(name)
  })
})

describe('신청 기한', () => {
  test.each([
    ['2026-11-06T01:13:00Z', '2026년 11월 6일 10:13 까지'],
    ['2026-11-06T01:13:00', '2026년 11월 6일 10:13 까지'],
    ['2026-11-06T15:05:00+00:00', '2026년 11월 7일 00:05 까지'],
    ['2026-12-31T14:59:00Z', '2026년 12월 31일 23:59 까지'],
    [null, ''],
    ['not-a-date', ''],
  ])('기한 %p 를 한국 시간 24시간제로 → %p', (value, text) => expect(formatReturnDeadline(value)).toBe(text))

  test('시간대가 없는 서버 시각은 UTC 로 읽는다', () => {
    expect(parseServerTime('2026-11-06T01:13:00')?.toISOString()).toBe('2026-11-06T01:13:00.000Z')
    expect(parseServerTime(42)).toBeNull()
  })

  test.each([
    ['기한 전', '2026-11-06T01:13:00Z', BEFORE, true],
    ['기한과 같은 시각(지남)', '2026-11-06T01:13:00Z', AFTER, false],
    ['기한 없음', null, BEFORE, false],
  ])('%s → %p', (_name, deadline, now, open) => expect(isReturnWindowOpen(deadline, now)).toBe(open))
})

describe('주문 상세의 반품 신청 영역', () => {
  test('신청서 줄: 서버 returnable(신청 가능 수량) 그대로 + 주문 줄의 이름·단가', () => {
    expect(returnLines(order)).toEqual([
      { product_id: 3, quantity: 1, product_name: '지포스 RTX 4070 SUPER 12GB', unit_price_krw: 899000 },
      { product_id: 12, quantity: 1, product_name: 'FOCUS GX-850 GOLD 850W', unit_price_krw: 189000 },
    ])
    expect(returnLines({ ...order, returnable: [{ product_id: 99, quantity: 2 }, { product_id: 3, quantity: 0 }] })).toEqual([
      { product_id: 99, quantity: 2, product_name: '상품 99', unit_price_krw: null },
    ])
    expect(returnLines({ ...order, returnable: undefined })).toEqual([])
    expect(returnLines(null)).toEqual([])
  })

  test.each([
    ['PAID·신청 가능·기한 전', order, BEFORE, 'open'],
    ['기한 지남', order, AFTER, 'expired'],
    ['기한 없음(PAID 인데 null)', { ...order, return_deadline: null }, BEFORE, 'expired'],
    ['모두 신청함(returnable 빈 배열)', { ...order, returnable: [] }, BEFORE, 'hidden'],
    ['결제 대기', { ...order, status: 'READY', return_deadline: null }, BEFORE, 'hidden'],
    ['취소됨', { ...order, status: 'CANCELLED', return_deadline: null }, BEFORE, 'hidden'],
    ['예전 응답(반품 필드 없음)', { payment_id: 'order-1', status: 'PAID', items: order.items }, BEFORE, 'hidden'],
  ])('%s → %s', (_name, value, now, state) => expect(getReturnFormState(value, now)).toBe(state))

  test.each([[2, [0, 1, 2]], [1, [0, 1]], [0, [0]], [undefined, [0]]])('신청 가능 %p개 → 수량 선택지 %p', (max, options) => {
    expect(returnQuantityOptions(max)).toEqual(options)
  })

  test('고른 수량 → 요청 items(0 은 빼고 줄 순서), 합계는 지금 줄의 값만 센다', () => {
    const lines = returnLines(order)
    expect(returnSelection({ 12: 1, 3: 0 }, lines)).toEqual([{ productId: 12, quantity: 1 }])
    expect(returnSelection({ 12: '1', 3: 1 }, lines)).toEqual([{ productId: 3, quantity: 1 }, { productId: 12, quantity: 1 }])
    expect(selectedReturnQuantity({ 3: 1, 12: 1, 99: 5 }, lines)).toBe(2)
    expect(selectedReturnQuantity({}, lines)).toBe(0)
  })
})

describe('반품 신청 검증·본문', () => {
  const lines = returnLines(order)
  const valid = { reason: 'incompatible', detail: '', items: [{ productId: 3, quantity: 1 }] }

  test.each([
    ['상품 없음', { ...valid, items: [] }, '반품할 상품의 수량을 골라 주세요.'],
    ['상품 번호가 문자', { ...valid, items: [{ productId: '3', quantity: 1 }] }, '상품 정보가 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 골라 주세요.'],
    ['수량 0', { ...valid, items: [{ productId: 3, quantity: 0 }] }, '반품 수량을 다시 골라 주세요.'],
    ['같은 상품 두 줄', { ...valid, items: [{ productId: 3, quantity: 1 }, { productId: 3, quantity: 1 }] }, '같은 상품이 두 번 들어 있습니다. 페이지를 새로고침한 뒤 다시 골라 주세요.'],
    ['사유 없음', { ...valid, reason: '' }, '반품 사유를 골라 주세요.'],
    ['모르는 사유', { ...valid, reason: 'too_expensive' }, '반품 사유를 골라 주세요.'],
    ['자세한 내용 501자', { ...valid, detail: '가'.repeat(MAX_RETURN_DETAIL_LENGTH + 1) }, '자세한 내용은 500자까지 입력할 수 있습니다.'],
    ['자세한 내용 500자(이모지도 1글자)', { ...valid, detail: '😀'.repeat(MAX_RETURN_DETAIL_LENGTH) }, ''],
    ['올바른 신청', valid, ''],
  ])('%s → %p', (_name, input, message) => expect(validateReturnRequest(input)).toBe(message))

  test('신청서 줄을 넘기면 서버가 준 신청 가능 수량을 넘거나 줄에 없는 상품을 막는다', () => {
    expect(validateReturnRequest({ ...valid, items: [{ productId: 3, quantity: 2 }] }, lines)).toBe('신청할 수 있는 수량보다 많습니다. 수량을 다시 골라 주세요.')
    expect(validateReturnRequest({ ...valid, items: [{ productId: 99, quantity: 1 }] }, lines)).toBe('신청할 수 있는 수량보다 많습니다. 수량을 다시 골라 주세요.')
    expect(validateReturnRequest(valid, lines)).toBe('')
  })

  test('본문은 사유·items(snake_case)·앞뒤 공백을 지운 자세한 내용. 비어 있으면 detail 을 빼고, 금액은 넣지 않는다', () => {
    expect(returnRequestBody({ reason: 'defective', detail: '  전원이 켜지지 않습니다. ', items: [{ productId: 3, quantity: 1 }, { productId: 12, quantity: 1 }] })).toEqual({
      reason: 'defective', detail: '전원이 켜지지 않습니다.', items: [{ product_id: 3, quantity: 1 }, { product_id: 12, quantity: 1 }],
    })
    const body = returnRequestBody({ reason: 'changed_mind', detail: '   ', items: [{ productId: 3, quantity: 1 }] })
    expect(body).toEqual({ reason: 'changed_mind', items: [{ product_id: 3, quantity: 1 }] })
    expect(JSON.stringify(body)).not.toMatch(/krw|amount|price|refund/)
  })

  test.each([
    ['', '거절 사유를 입력해 주세요.'],
    ['   ', '거절 사유를 입력해 주세요.'],
    ['가'.repeat(MAX_REJECT_REASON_LENGTH + 1), '거절 사유는 200자까지 입력할 수 있습니다.'],
    ['가'.repeat(MAX_REJECT_REASON_LENGTH), ''],
    ['사용 흔적이 있어 반품할 수 없습니다.', ''],
  ])('거절 사유 %p → %p', (reason, message) => expect(validateRejectReason(reason)).toBe(message))
})

describe('오류 문구', () => {
  const fallback = '반품을 신청하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  test.each([
    [{ response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    [{ response: { status: 403, data: { message: '허용되지 않은 출처입니다.' } } }, '요청을 확인하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'],
    [{ response: { status: 409, data: { message: '반품 신청 기간(결제 후 7일)이 지났습니다.' } } }, '반품 신청 기간(결제 후 7일)이 지났습니다.'],
    [{ response: { status: 404, data: { message: '주문을 찾을 수 없습니다.' } } }, '주문을 찾을 수 없습니다.'],
    [{ response: { status: 422, data: {} } }, fallback],
    [{ response: { status: 500, data: { message: 'Internal Server Error' } } }, fallback],
    [{ isAxiosError: true }, fallback],
  ])('구매자 %#', (error, message) => expect(returnError(error, fallback)).toBe(message))

  const adminFallback = '반품 신청 목록을 불러오지 못했습니다. 다시 시도해 주세요.'
  test.each([
    [{ response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    [{ response: { status: 403 } }, '관리자만 처리할 수 있습니다. 관리자 계정으로 로그인했는지 확인해 주세요.'],
    [{ response: { status: 502, data: { message: '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.' } } }, '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.'],
    [{ response: { status: 502, data: {} } }, REFUND_FAILED_MESSAGE],
    [{ response: { status: 409, data: { message: '이미 처리한 반품 신청입니다.' } } }, '이미 처리한 반품 신청입니다.'],
    [{ response: { status: 500 } }, adminFallback],
    [{}, adminFallback],
  ])('관리자 %#', (error, message) => expect(adminReturnError(error, adminFallback)).toBe(message))
})

describe('관리자 화면 상태·주소', () => {
  test.each([
    [{ loading: true, needsLogin: true }, 'loading'],
    [{ needsLogin: true }, 'guest'],
    [{ forbidden: true, error: '오류' }, 'forbidden'],
    [{ error: '오류' }, 'error'],
    [{ items: [] }, 'empty'],
    [{ items: [{ id: 1 }] }, 'ready'],
  ])('%o → %s', (input, state) => expect(getAdminReturnsPageState(input)).toBe(state))

  test.each([
    ['?status=REQUESTED', 'REQUESTED'], ['?status=approved', 'APPROVED'], ['?status=DELETED', null], ['', null], ['?page=2', null],
  ])('주소 %p → status %p', (search, status) => expect(readAdminReturnsQuery(search)).toEqual({ status }))

  test.each([['REFUNDED', 'REFUNDED'], [' withdrawn ', 'WITHDRAWN'], ['', null], [null, null], ['ALL', null]])('상태 %p → %p', (value, code) => {
    expect(normalizeReturnStatus(value)).toBe(code)
  })

  test('탭을 고르면 replaceState 로 주소만 바꾼다(전체는 query 없음)', () => {
    const history = { replaceState: jest.fn() }
    replaceAdminReturnsQuery('APPROVED', history)
    replaceAdminReturnsQuery(null, history)
    replaceAdminReturnsQuery('UNKNOWN', history)
    expect(history.replaceState.mock.calls.map((call) => call[2])).toEqual(['/admin/returns?status=APPROVED', '/admin/returns', '/admin/returns'])
  })

  test.each([
    ['/admin/returns', true], ['/admin/returns/', true], ['/admin/returns/3', false], ['/admin', false], ['/admin/orders', false],
  ])('경로 %s → 관리자 반품 관리 %s', (pathname, expected) => expect(isAdminReturnsRoute(pathname)).toBe(expected))

  test.each([['/admin/returns', 'admin-returns'], ['/admin/returns/', 'admin-returns'], ['/admin', 'products']])('화면 이름(page_view route) %s → %s', (pathname, name) => {
    expect(resolveRouteName(pathname)).toBe(name)
  })
})

describe('return_request 이벤트 값', () => {
  const created = {
    id: 41, payment_id: 'order-7f3a9c2e', status: 'REQUESTED', reason: 'changed_mind', detail: '마음이 바뀌었습니다.',
    items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }, { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', quantity: 1, unit_price_krw: 189000 }],
    items_total_krw: 1088000, shipping_deduction_krw: 6000, refund_amount_krw: 1082000,
    requested_at: '2026-11-01T02:00:00Z', decided_at: null, reject_reason: null, refunded_at: null,
  }

  test('서버 응답 그대로(환불 금액·사유·상품), 줄 수·수량 합, 반품한 상품의 주문 줄 build_id. 자세한 내용은 넣지 않는다', () => {
    const props = returnRequestEventProps(created, order)
    expect(props).toEqual({
      payment_id: 'order-7f3a9c2e', return_id: 41, reason: 'changed_mind', item_count: 2, quantity: 2, product_ids: [3, 12],
      refund_amount_krw: 1082000, build_ids: ['b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6'],
    })
    expect(JSON.stringify(props)).not.toContain(created.detail)
  })

  test('build_id 가 없는 줄만 반품하면 build_ids 는 빈 배열', () => {
    const only = { ...created, items: [created.items[1]], refund_amount_krw: 183000 }
    expect(returnRequestEventProps(only, order)).toMatchObject({ item_count: 1, quantity: 1, product_ids: [12], build_ids: [] })
  })

  test('목록은 추적기 한도(20개)로 자른다', () => {
    const many = { ...created, items: Array.from({ length: 25 }, (_, index) => ({ product_id: index + 1, quantity: 1 })) }
    expect(returnRequestEventProps(many, order).product_ids).toHaveLength(MAX_PROP_LIST_LENGTH)
  })

  test('반품 내역 갱신: 같은 id 는 바꾸고 없으면 끝에 더한다', () => {
    const first = { id: 1, status: 'REQUESTED' }
    expect(upsertReturn([first], { id: 1, status: 'WITHDRAWN' })).toEqual([{ id: 1, status: 'WITHDRAWN' }])
    expect(upsertReturn([first], { id: 2, status: 'REQUESTED' })).toEqual([first, { id: 2, status: 'REQUESTED' }])
    expect(upsertReturn(undefined, { id: 3 })).toEqual([{ id: 3 }])
    expect(upsertReturn([first], null)).toEqual([first])
  })
})
