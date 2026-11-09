// 주문서 화면(views/CheckoutPage.vue)의 상태별 렌더링과 결제 흐름(POST /orders → PortOne 결제창 → POST /orders/confirm → 주문 상세 이동).
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const fetchCart = jest.fn()
const fetchProduct = jest.fn()
const fetchCurrentUser = jest.fn()
const createOrder = jest.fn()
const launchPortOnePayment = jest.fn()
const confirmOrder = jest.fn()
const goToOrder = jest.fn()
// 헤더의 장바구니 수량(장바구니 주문서는 받은 장바구니의 item_count 로 맞춘다)
const siteStatus = { setCartCount: jest.fn(), showToast: jest.fn() }
const mocks = [fetchCart, fetchProduct, fetchCurrentUser, createOrder, launchPortOnePayment, confirmOrder, goToOrder, siteStatus.setCartCount, siteStatus.showToast]
// 로그인 확인은 공용 로그인 상태(authSession)가 fetchCurrentUser 로 한다
const authSession = createAuthSession({ fetchCurrentUser })
let CheckoutPage

const gpu = { product_id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }
const psu = { product_id: 12, name: 'FOCUS GX-850 GOLD 850W', brand: 'Seasonic', category: 'psu', thumbnail_url: '', price_krw: 189000, stock: 4, quantity: 1, subtotal_krw: 189000 }
const cart = { items: [gpu, psu], item_count: 3, total_krw: 1987000 }
const product = { id: 3, name: gpu.name, brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍', description: '', specs: [] }
const member = { id: 1, name: '김학습', email: 'learner@example.com' }
const paymentRequest = { payment_id: 'order-7f3a9c2e', order_name: `${gpu.name} 외 1건`, total_amount: 1987000, currency: 'KRW', store_id: 'store-test', channel_key: 'channel-key-test', status: 'READY' }
const paidOrder = { payment_id: 'order-7f3a9c2e', order_name: paymentRequest.order_name, status: 'PAID', total_krw: 1987000, item_count: 3, thumbnail_url: '', created_at: '2026-10-30T01:00:00Z', paid_at: '2026-10-30T01:01:00Z', items: [], shipping: {}, cancelled_at: null }
const input = { 'shipping-recipient': ' 김철수 ', 'shipping-phone': '010-1234-5678', 'shipping-postal-code': '06236', 'shipping-address1': '서울특별시 강남구 테헤란로 123', 'shipping-address2': '4층', 'shipping-memo': '' }
const shipping = { recipientName: ' 김철수 ', phone: '010-1234-5678', postalCode: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '4층', deliveryMemo: '' }

function open(search = '') {
  global.window = { location: { search } }
  return mount(CheckoutPage)
}

async function fill(page, values = input) {
  for (const [id, value] of Object.entries(values)) await setValue(byId(page.root, id), value)
}

const fieldset = (page) => find(page.root, (node) => node.type === 'fieldset')
const payButton = (page) => find(page.root, (node) => node.type === 'button' && node.props.type === 'submit')
const alertText = (page) => byRole(page.root, 'alert').map(text).join(' ')
// 응답을 붙잡아 둔 채 제출만 한다(submit 은 처리가 끝날 때까지 기다린다)
const startSubmit = (page) => find(page.root, (node) => node.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} })

async function openFilledCart() {
  fetchCart.mockResolvedValue(cart)
  const page = open()
  await flush()
  await fill(page)
  return page
}

beforeAll(async () => {
  CheckoutPage = await compileSfc('views/CheckoutPage.vue', { fetchCart, fetchProduct, authSession, createOrder, launchPortOnePayment, confirmOrder, goToOrder, siteStatus })
})
beforeEach(() => {
  mocks.forEach((mock) => mock.mockReset())
  authSession.reset()
})
afterEach(() => { delete global.window })

describe('주문서 상태', () => {
  test('로딩 → 장바구니 상품 요약(서버 금액 그대로)과 배송지 폼', async () => {
    const response = deferred()
    fetchCart.mockReturnValue(response.promise)
    const page = open()
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('주문할 상품을 불러오는 중입니다...')
    response.resolve(cart)
    await flush()
    const content = text(page.root)
    expect(content).toContain('주문 상품 2종')
    expect(content).toContain('그래픽카드 · MSI')
    expect(content).toContain('899,000원 · 2개')
    expect(content).toContain('1,798,000원')
    expect(content).toContain('3개')
    expect(content).toContain('1,987,000원')
    expect(link(page.root, gpu.name).props.href).toBe('/products/3')
    expect(fetchProduct).not.toHaveBeenCalled()
    expect(fetchCurrentUser).not.toHaveBeenCalled()
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('cart')
    // 배송지: label·필수/선택 표시
    for (const [id, label] of [['shipping-recipient', '받는 분'], ['shipping-phone', '연락처'], ['shipping-postal-code', '우편번호'], ['shipping-address1', '주소']]) {
      const labelNode = find(page.root, (node) => node.type === 'label' && node.props.for === id)
      expect(text(labelNode)).toBe(`${label} 필수`)
      expect(byId(page.root, id).props.required).toBe(true)
    }
    expect(text(find(page.root, (node) => node.type === 'label' && node.props.for === 'shipping-memo'))).toBe('배송 메모 선택')
    expect(text(payButton(page))).toBe('결제하기')
    expect(siteStatus.setCartCount).toHaveBeenCalledWith(3)
  })

  test('바로 구매는 로그인을 확인하고 그 상품만 보여 준다(장바구니를 부르지 않는다)', async () => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockResolvedValue(product)
    const page = open('?product=3&quantity=2')
    await flush()
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
    expect(fetchProduct).toHaveBeenCalledWith(3)
    expect(fetchCart).not.toHaveBeenCalled()
    expect(siteStatus.setCartCount).not.toHaveBeenCalled()
    const content = text(page.root)
    expect(content).toContain('주문 상품 1종')
    expect(content).toContain(gpu.name)
    expect(content).toContain('899,000원 · 2개')
    expect(content).toContain('1,798,000원')
    expect(content).toContain('현재 판매 가격으로 다시 확인합니다.')
  })

  test.each([
    ['장바구니', '', fetchCart],
    ['바로 구매', '?product=3&quantity=1', fetchCurrentUser],
  ])('%s 비로그인(401)이면 로그인 안내와 로그인 링크, 다시 확인 버튼', async (_name, search, request) => {
    request.mockRejectedValueOnce({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } })
    fetchCart.mockResolvedValue(cart)
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockResolvedValue(product)
    const page = open(search)
    await flush()
    expect(text(page.root)).toContain('로그인 후 이용할 수 있습니다.')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(find(page.root, (node) => node.type === 'form')).toBeNull()
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(request).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain(gpu.name)
  })

  test('서버 오류면 오류와 다시 시도', async () => {
    fetchCart.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(cart)
    const page = open()
    await flush()
    expect(alertText(page)).toContain('장바구니를 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchCart).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain('결제하기')
  })

  test('장바구니가 비어 있으면 안내와 장바구니·상품 링크', async () => {
    fetchCart.mockResolvedValue({ items: [], item_count: 0, total_krw: 0 })
    const page = open()
    await flush()
    expect(text(page.root)).toContain('주문할 상품이 없습니다.')
    expect(link(page.root, '장바구니로').props.href).toBe('/cart')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    expect(find(page.root, (node) => node.type === 'form')).toBeNull()
  })

  test.each(['?product=abc&quantity=1', '?product=3&quantity=11', '?product=3'])('잘못된 바로 구매 주소(%s)는 API 를 부르지 않는다', async (search) => {
    const page = open(search)
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('올바르지 않은 주문 주소입니다.')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    mocks.forEach((mock) => expect(mock).not.toHaveBeenCalled())
  })

  test('바로 구매 상품이 없으면(404) 상품 목록 링크', async () => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockRejectedValue({ response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } })
    const page = open('?product=404&quantity=1')
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('주문할 상품을 찾을 수 없습니다.')
    expect(link(page.root, '상품 목록 보기').props.href).toBe('/products')
    expect(button(page.root, '다시 시도')).toBeNull()
  })

  test.each([
    ['품절', 0, 1, '품절된 상품입니다. 다른 상품을 선택해 주세요.'],
    ['재고 부족', 3, 5, '재고가 3개 남았습니다. 상품 페이지에서 수량을 줄여 주세요.'],
  ])('바로 구매 상품이 %s이면 결제 폼 대신 안내와 상품 페이지 링크', async (_name, stock, quantity, message) => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockResolvedValue({ ...product, id: 9, stock })
    const page = open(`?product=9&quantity=${quantity}`)
    await flush()
    expect(alertText(page)).toContain('주문할 수 없는 상품입니다.')
    expect(alertText(page)).toContain(message)
    expect(link(page.root, '상품 페이지로').props.href).toBe('/products/9')
    expect(find(page.root, (node) => node.type === 'form')).toBeNull()
  })

  test('장바구니에 품절·재고 초과 상품이 있으면 장바구니에서 정리하도록 안내한다', async () => {
    fetchCart.mockResolvedValue({ ...cart, items: [gpu, { ...psu, stock: 0 }] })
    const page = open()
    await flush()
    expect(alertText(page)).toContain('주문할 수 없는 상품이 있습니다.')
    expect(link(page.root, '장바구니로').props.href).toBe('/cart')
    expect(find(page.root, (node) => node.type === 'form')).toBeNull()
  })
})

describe('배송지 검증', () => {
  test('빈 칸으로 결제하면 칸마다 오류를 보여 주고 요청하지 않는다. 고치면 오류가 사라진다', async () => {
    fetchCart.mockResolvedValue(cart)
    const page = open()
    await flush()
    await submit(page.root)
    expect(createOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toContain('배송지에 고칠 칸이 있습니다.')
    expect(text(page.root)).toContain('받는 분 이름을 입력해 주세요.')
    expect(text(page.root)).toContain('연락처를 입력해 주세요.')
    expect(text(page.root)).toContain('우편번호를 입력해 주세요.')
    expect(text(page.root)).toContain('주소를 입력해 주세요.')
    expect(byId(page.root, 'shipping-phone').props).toMatchObject({ 'aria-invalid': 'true', 'aria-describedby': 'shipping-phone-error' })
    expect(text(byId(page.root, 'shipping-phone-error'))).toBe('연락처를 입력해 주세요.')
    await fill(page, { ...input, 'shipping-phone': '010-12-34', 'shipping-postal-code': '0623' })
    expect(text(page.root)).toContain('연락처는 010-1234-5678 처럼 숫자와 하이픈(-)으로 입력해 주세요.')
    expect(text(page.root)).toContain('우편번호는 숫자 5자리로 입력해 주세요.')
    expect(text(page.root)).not.toContain('받는 분 이름을 입력해 주세요.')
    await fill(page, { 'shipping-phone': '01012345678', 'shipping-postal-code': '06236' })
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(byId(page.root, 'shipping-phone').props['aria-invalid']).toBeUndefined()
    expect(createOrder).not.toHaveBeenCalled()
  })
})

describe('결제 흐름', () => {
  test('주문 생성 → 결제창 → 결제 확인 → 주문 상세로 이동. 진행 중에는 폼을 막고 두 번 제출하지 않는다', async () => {
    const created = deferred()
    createOrder.mockReturnValue(created.promise)
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e', transactionType: 'PAYMENT', txId: 'tx-1' })
    confirmOrder.mockResolvedValue(paidOrder)
    const page = await openFilledCart()
    startSubmit(page)
    startSubmit(page)
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith({ items: [{ productId: 3, quantity: 2 }, { productId: 12, quantity: 1 }], shipping })
    expect(fieldset(page).props.disabled).toBe(true)
    expect(text(byRole(page.root, 'status')[0])).toBe('결제를 진행하는 중입니다...')
    expect(payButton(page).props.disabled).toBe(true)
    expect(text(payButton(page))).toBe('결제 진행 중...')
    created.resolve(paymentRequest)
    await flush()
    expect(launchPortOnePayment).toHaveBeenCalledWith(paymentRequest)
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    const order = [createOrder, launchPortOnePayment, confirmOrder, goToOrder].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // 이동하는 동안에도 다시 누를 수 없다
    expect(payButton(page).props.disabled).toBe(true)
    expect(byRole(page.root, 'alert')).toHaveLength(0)
  })

  test('바로 구매는 그 상품과 수량만 주문한다', async () => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockResolvedValue(product)
    createOrder.mockResolvedValue({ ...paymentRequest, order_name: gpu.name, total_amount: 1798000 })
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockResolvedValue(paidOrder)
    const page = open('?product=3&quantity=2')
    await flush()
    await fill(page)
    await submit(page.root)
    expect(createOrder).toHaveBeenCalledWith({ items: [{ productId: 3, quantity: 2 }], shipping })
    expect(launchPortOnePayment).toHaveBeenCalledWith(expect.objectContaining({ total_amount: 1798000 }))
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(fetchCart).not.toHaveBeenCalled()
  })

  test('결제창에서 취소하면 확인하지 않고 주문서에 남아 안내하며 입력을 유지한다', async () => {
    createOrder.mockResolvedValue(paymentRequest)
    launchPortOnePayment.mockResolvedValue({ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다.', paymentId: 'order-7f3a9c2e' })
    const page = await openFilledCart()
    await submit(page.root)
    expect(launchPortOnePayment).toHaveBeenCalledTimes(1)
    expect(confirmOrder).not.toHaveBeenCalled()
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe('사용자가 결제를 취소했습니다. 다시 결제하려면 결제하기를 눌러 주세요.')
    expect(byId(page.root, 'shipping-recipient').value).toBe(' 김철수 ')
    expect(byId(page.root, 'shipping-address2').value).toBe('4층')
    expect(fieldset(page).props.disabled).toBe(false)
    expect(payButton(page).props.disabled).toBe(false)
    // 다시 결제하면 새 주문을 만든다
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockResolvedValue(paidOrder)
    await submit(page.root)
    expect(createOrder).toHaveBeenCalledTimes(2)
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
  })

  test('결제창을 열지 못하면 안내하고 다시 결제할 수 있다', async () => {
    createOrder.mockResolvedValue(paymentRequest)
    launchPortOnePayment.mockRejectedValue(new Error('SDK load failed'))
    const page = await openFilledCart()
    await submit(page.root)
    expect(alertText(page)).toBe('결제창을 열지 못했습니다. 잠시 후 다시 결제하기를 눌러 주세요.')
    expect(confirmOrder).not.toHaveBeenCalled()
    expect(payButton(page).props.disabled).toBe(false)
  })

  test('주문 생성이 재고 부족(409)이면 서버 문구와 장바구니 링크를 보여 주고 결제창을 열지 않는다', async () => {
    const message = "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다."
    createOrder.mockRejectedValue({ response: { status: 409, data: { message } } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(alertText(page)).toContain(message)
    expect(link(page.root, '장바구니에서 수량 조정하기').props.href).toBe('/cart')
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(byId(page.root, 'shipping-recipient').value).toBe(' 김철수 ')
    expect(payButton(page).props.disabled).toBe(false)
  })

  test('주문 생성 중 로그인이 만료되면(401) 새 탭 로그인 링크를 주고 입력을 유지한다', async () => {
    createOrder.mockRejectedValue({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(alertText(page)).toContain('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
    expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(byId(page.root, 'shipping-address1').value).toBe('서울특별시 강남구 테헤란로 123')
  })

  test('주문 생성 서버 오류(500)는 우리 문구로 안내한다', async () => {
    createOrder.mockRejectedValue({ response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(alertText(page)).toBe('주문을 만들지 못했습니다. 입력한 내용은 그대로 있으니 다시 시도해 주세요.')
  })

  test('결제 확인이 409(재고 부족으로 취소)면 서버 문구를 보여 주고 이동하지 않으며 다시 결제할 수 있다', async () => {
    createOrder.mockResolvedValue(paymentRequest)
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.' } } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe('재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.')
    expect(button(page.root, '결제 확인 다시 시도')).toBeNull()
    expect(payButton(page).props.disabled).toBe(false)
    expect(fieldset(page).props.disabled).toBe(false)
  })

  test('결제 확인이 502 면 새로 결제하지 않고 같은 주문의 확인만 다시 시도한다', async () => {
    createOrder.mockResolvedValue(paymentRequest)
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder
      .mockRejectedValueOnce({ response: { status: 502, data: { message: '포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } })
      .mockResolvedValueOnce(paidOrder)
    const page = await openFilledCart()
    await submit(page.root)
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe('포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(text(page.root)).toContain('중복으로 결제되지 않습니다')
    expect(payButton(page)).toBeNull()
    expect(fieldset(page).props.disabled).toBe(true)
    expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
    await submit(page.root) // 결제하기가 없으므로 새 주문을 만들지 않는다
    await click(button(page.root, '결제 확인 다시 시도'))
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(launchPortOnePayment).toHaveBeenCalledTimes(1)
    expect(confirmOrder).toHaveBeenCalledTimes(2)
    expect(confirmOrder).toHaveBeenLastCalledWith('order-7f3a9c2e')
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
  })

  test('결제 확인 중 로그인이 만료되면(401) 새 탭 로그인 링크와 확인 다시 시도를 준다', async () => {
    createOrder.mockResolvedValue(paymentRequest)
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockRejectedValue({ response: { status: 401 } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(alertText(page)).toContain('새 탭에서 다시 로그인한 뒤 다시 시도해 주세요.')
    expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(button(page.root, '결제 확인 다시 시도')).not.toBeNull()
  })
})

// spec 2026-10-30-persona-simulator.md: POST /orders 응답의 provider 가 'mock'(시뮬레이션 계정 전용)이면
// PortOne 결제창 없이 바로 POST /orders/confirm → 주문 상세. provider 가 'portone' 이거나 없으면 지금과 같다.
describe('모의 결제(provider mock)', () => {
  const mockPaymentRequest = { ...paymentRequest, store_id: '', channel_key: '', provider: 'mock' }

  test('PortOne 결제창을 열지 않고 바로 결제 확인 → 주문 상세로 이동. 확인하는 동안 폼을 막는다', async () => {
    const confirmed = deferred()
    createOrder.mockResolvedValue(mockPaymentRequest)
    confirmOrder.mockReturnValue(confirmed.promise)
    const page = await openFilledCart()
    startSubmit(page)
    await flush()
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(fieldset(page).props.disabled).toBe(true)
    expect(text(byRole(page.root, 'status')[0])).toBe('결제를 진행하는 중입니다...')
    expect(text(payButton(page))).toBe('결제 진행 중...')
    expect(payButton(page).props.disabled).toBe(true)
    startSubmit(page) // 확인 중에 다시 눌러도 새 주문을 만들지 않는다
    confirmed.resolve(paidOrder)
    await flush()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(confirmOrder).toHaveBeenCalledTimes(1)
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    const order = [createOrder, confirmOrder, goToOrder].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(payButton(page).props.disabled).toBe(true) // 이동하는 동안에도 다시 누를 수 없다
    expect(byRole(page.root, 'alert')).toHaveLength(0)
  })

  test('바로 구매도 PortOne 결제창 없이 그 상품만 주문하고 확인한다', async () => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProduct.mockResolvedValue(product)
    createOrder.mockResolvedValue({ ...mockPaymentRequest, order_name: gpu.name, total_amount: 1798000 })
    confirmOrder.mockResolvedValue(paidOrder)
    const page = open('?product=3&quantity=2')
    await flush()
    await fill(page)
    await submit(page.root)
    expect(createOrder).toHaveBeenCalledWith({ items: [{ productId: 3, quantity: 2 }], shipping })
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
  })

  test('확인이 재고 부족(409)이면 PortOne 경로와 같이 서버 문구를 보여 주고 이동하지 않으며 다시 결제할 수 있다', async () => {
    const message = "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족해 주문을 취소했습니다."
    createOrder.mockResolvedValue(mockPaymentRequest)
    confirmOrder.mockRejectedValue({ response: { status: 409, data: { message } } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe(message)
    expect(button(page.root, '결제 확인 다시 시도')).toBeNull()
    expect(payButton(page).props.disabled).toBe(false)
    expect(fieldset(page).props.disabled).toBe(false)
    expect(byId(page.root, 'shipping-recipient').value).toBe(' 김철수 ')
  })

  test('확인이 502 면 새로 주문하지 않고 같은 주문의 확인만 다시 시도한다(PortOne 은 끝까지 부르지 않는다)', async () => {
    createOrder.mockResolvedValue(mockPaymentRequest)
    confirmOrder
      .mockRejectedValueOnce({ response: { status: 502, data: { message: '결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } })
      .mockResolvedValueOnce(paidOrder)
    const page = await openFilledCart()
    await submit(page.root)
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe('결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(text(page.root)).toContain('중복으로 결제되지 않습니다')
    expect(payButton(page)).toBeNull()
    expect(fieldset(page).props.disabled).toBe(true)
    await click(button(page.root, '결제 확인 다시 시도'))
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(confirmOrder).toHaveBeenCalledTimes(2)
    expect(confirmOrder).toHaveBeenLastCalledWith('order-7f3a9c2e')
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(launchPortOnePayment).not.toHaveBeenCalled()
  })

  test('확인 중 로그인이 만료되면(401) 새 탭 로그인 링크와 확인 다시 시도를 준다', async () => {
    createOrder.mockResolvedValue(mockPaymentRequest)
    confirmOrder.mockRejectedValue({ response: { status: 401 } })
    const page = await openFilledCart()
    await submit(page.root)
    expect(launchPortOnePayment).not.toHaveBeenCalled()
    expect(alertText(page)).toContain('새 탭에서 다시 로그인한 뒤 다시 시도해 주세요.')
    expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(button(page.root, '결제 확인 다시 시도')).not.toBeNull()
  })

  test.each([
    ['provider 없음(예전 응답)', paymentRequest],
    ['provider portone', { ...paymentRequest, provider: 'portone' }],
  ])('%s 이면 지금처럼 PortOne 결제창을 열고 확인한다', async (_name, response) => {
    createOrder.mockResolvedValue(response)
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockResolvedValue(paidOrder)
    const page = await openFilledCart()
    await submit(page.root)
    expect(launchPortOnePayment).toHaveBeenCalledTimes(1)
    expect(launchPortOnePayment).toHaveBeenCalledWith(response)
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(goToOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    const order = [createOrder, launchPortOnePayment, confirmOrder, goToOrder].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  test('provider portone 결제창에서 취소하면 지금처럼 확인하지 않는다', async () => {
    createOrder.mockResolvedValue({ ...paymentRequest, provider: 'portone' })
    launchPortOnePayment.mockResolvedValue({ code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다.', paymentId: 'order-7f3a9c2e' })
    const page = await openFilledCart()
    await submit(page.root)
    expect(launchPortOnePayment).toHaveBeenCalledTimes(1)
    expect(confirmOrder).not.toHaveBeenCalled()
    expect(goToOrder).not.toHaveBeenCalled()
    expect(alertText(page)).toBe('사용자가 결제를 취소했습니다. 다시 결제하려면 결제하기를 눌러 주세요.')
  })
})
