// 결제 완료 화면(views/PaymentComplete.vue, PortOne 모바일 redirect)의 상태별 렌더링. 결제 확인은 POST /orders/confirm.
import { jest } from '@jest/globals'
import { button, byRole, click, compileSfc, deferred, flush, link, mount, stub, text } from './testing/sfc.mjs'

const confirmOrder = jest.fn()
let PaymentComplete

function open(search) {
  global.window = { location: { search } }
  return mount(PaymentComplete)
}

const order = {
  payment_id: 'order-7f3a9c2e', order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', status: 'PAID', total_krw: 1987000, item_count: 3, thumbnail_url: '',
  created_at: '2026-10-30T01:00:00Z', paid_at: '2026-10-30T01:01:00Z', cancelled_at: null, items: [], shipping: {},
}

beforeAll(async () => { PaymentComplete = await compileSfc('views/PaymentComplete.vue', { confirmOrder }) })
beforeEach(() => confirmOrder.mockReset())
afterEach(() => { delete global.window })

test('취소 코드가 있으면 결제를 확인하지 않고 PortOne 문구와 장바구니 링크를 보여 준다', async () => {
  const page = open('?paymentId=order-7f3a9c2e&code=FAILURE_TYPE_PG&message=%EA%B2%B0%EC%A0%9C%EB%A5%BC%20%EC%B7%A8%EC%86%8C%ED%96%88%EC%8A%B5%EB%8B%88%EB%8B%A4.')
  await flush()
  expect(confirmOrder).not.toHaveBeenCalled()
  expect(text(page.root)).toContain('결제를 완료하지 못했습니다')
  expect(text(byRole(page.root, 'alert')[0])).toBe('결제를 취소했습니다.')
  expect(byRole(page.root, 'status')).toHaveLength(0)
  expect(button(page.root, '다시 시도')).toBeNull()
  expect(link(page.root, '장바구니로').props.href).toBe('/cart')
  expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('orders')
})

test('PortOne 문구가 없는 취소는 다음 행동을 안내한다', async () => {
  const page = open('?code=FAILURE_TYPE_PG')
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toBe('결제가 취소되었거나 완료되지 않았습니다. 장바구니에서 다시 주문해 주세요.')
})

test('주소에서 온 실패 문구는 200자까지만 보여 준다', async () => {
  const page = open(`?code=X&message=${'가'.repeat(500)}`)
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toHaveLength(200)
})

test.each(['', '?paymentId=order%2F..%2Fadmin'])('paymentId 가 없거나 형식이 틀리면(%s) 결제 정보 없음과 장바구니·주문 내역 링크', async (search) => {
  const page = open(search)
  await flush()
  expect(confirmOrder).not.toHaveBeenCalled()
  expect(text(byRole(page.root, 'alert')[0])).toBe('결제 정보를 찾을 수 없습니다. 주문 내역에서 결제 상태를 확인하거나 장바구니에서 다시 주문해 주세요.')
  expect(button(page.root, '다시 시도')).toBeNull()
  expect(link(page.root, '장바구니로').props.href).toBe('/cart')
  expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
})

test('확인 중에는 진행 상태를, 확인되면 주문 완료와 주문 상세·주문 내역 링크를 보여 준다', async () => {
  const response = deferred()
  confirmOrder.mockReturnValue(response.promise)
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
  expect(text(page.root)).toContain('결제 확인 중')
  expect(text(byRole(page.root, 'status')[0])).toBe('결제 결과를 확인하고 있습니다...')
  expect(byRole(page.root, 'alert')).toHaveLength(0)
  expect(link(page.root, '주문 상세 보기')).toBeNull()
  response.resolve(order)
  await flush()
  expect(text(page.root)).toContain('주문이 완료되었습니다')
  expect(text(page.root)).toContain(order.order_name)
  expect(text(byRole(page.root, 'status')[0])).toContain('결제가 확인되었습니다.')
  expect(link(page.root, '주문 상세 보기').props.href).toBe('/orders/order-7f3a9c2e')
  expect(link(page.root, '주문 내역').props.href).toBe('/orders')
  expect(byRole(page.root, 'alert')).toHaveLength(0)
})

test('확인에 실패하면(502) 서버 문구와 다시 시도를 보여 주고, 다시 시도하면 같은 결제를 다시 확인한다', async () => {
  confirmOrder
    .mockRejectedValueOnce({ response: { status: 502, data: { message: '포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } })
    .mockResolvedValueOnce(order)
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  expect(text(page.root)).toContain('결제를 확인하지 못했습니다')
  expect(text(byRole(page.root, 'alert')[0])).toBe('포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  expect(text(page.root)).toContain('중복으로 결제되지 않습니다')
  expect(link(page.root, '새 탭에서 다시 로그인')).toBeNull()
  expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
  await click(button(page.root, '다시 시도'))
  expect(confirmOrder).toHaveBeenCalledTimes(2)
  expect(confirmOrder).toHaveBeenLastCalledWith('order-7f3a9c2e')
  expect(text(page.root)).toContain('주문이 완료되었습니다')
  expect(byRole(page.root, 'alert')).toHaveLength(0)
})

test('네트워크 오류도 다시 시도할 수 있다', async () => {
  confirmOrder.mockRejectedValue({ isAxiosError: true, code: 'ERR_NETWORK' })
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toBe('서버에 연결하지 못해 결제를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
  expect(button(page.root, '다시 시도')).not.toBeNull()
})

test('다시 시도 중에는 버튼을 숨겨 두 번 확인하지 않는다', async () => {
  const retry = deferred()
  confirmOrder.mockRejectedValueOnce({ response: { status: 500 } }).mockReturnValueOnce(retry.promise)
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  const retryButton = button(page.root, '다시 시도')
  retryButton.props.onClick()
  retryButton.props.onClick()
  await flush()
  expect(confirmOrder).toHaveBeenCalledTimes(2)
  expect(button(page.root, '다시 시도')).toBeNull()
  expect(text(byRole(page.root, 'status')[0])).toBe('결제 결과를 확인하고 있습니다...')
  retry.resolve(order)
  await flush()
  expect(text(page.root)).toContain('주문이 완료되었습니다')
})

test('로그인이 만료되면(401) 새 탭 로그인 링크와 다시 시도를 함께 준다', async () => {
  confirmOrder.mockRejectedValue({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } })
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toContain('새 탭에서 다시 로그인한 뒤 다시 시도해 주세요.')
  expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
  expect(button(page.root, '다시 시도')).not.toBeNull()
})

test('주문이 없으면(404) 다시 시도 없이 주문 내역 링크만 준다', async () => {
  confirmOrder.mockRejectedValue({ response: { status: 404, data: { message: '주문을 찾을 수 없습니다.' } } })
  const page = open('?paymentId=order-other')
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toBe('주문을 찾을 수 없습니다. 결제할 때 사용한 계정으로 로그인했는지 확인해 주세요.')
  expect(button(page.root, '다시 시도')).toBeNull()
  expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
  expect(link(page.root, '장바구니로')).toBeNull()
})

test.each([
  ['재고 부족으로 취소', '재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.'],
  ['결제 미완료·금액 불일치', '결제가 완료되지 않았거나 결제 금액이 주문과 일치하지 않습니다.'],
])('409(%s)는 서버 문구를 보여 주고 다시 시도 없이 주문 내역·장바구니 링크를 준다', async (_name, message) => {
  confirmOrder.mockRejectedValue({ response: { status: 409, data: { message } } })
  const page = open('?paymentId=order-7f3a9c2e')
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toBe(message)
  expect(button(page.root, '다시 시도')).toBeNull()
  expect(text(page.root)).not.toContain('중복으로 결제되지 않습니다')
  expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
  expect(link(page.root, '장바구니로').props.href).toBe('/cart')
})
