// 주문 내역(views/OrderList.vue)과 주문 상세(views/OrderDetail.vue)의 상태별 렌더링.
import { jest } from '@jest/globals'
import { button, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, stub, text } from './testing/sfc.mjs'

const paid = {
  payment_id: 'order-7f3a9c2e', order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', status: 'PAID', total_krw: 1987000, item_count: 3,
  thumbnail_url: 'https://images.example.test/gpu.png', created_at: '2026-10-30T01:12:00Z', paid_at: '2026-10-30T01:13:00Z',
}
const cancelled = {
  payment_id: 'order-1b2c3d', order_name: '라이젠 7 7800X3D', status: 'CANCELLED', total_krw: 489000, item_count: 1,
  thumbnail_url: '', created_at: '2026-10-28T05:00:00Z', paid_at: null,
}
const orderPage = (items, total = items.length, page = 1) => ({ items, total, page, page_size: 10 })
const detail = {
  ...paid,
  cancelled_at: null,
  items: [
    { product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', unit_price_krw: 899000, quantity: 2, subtotal_krw: 1798000 },
    { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', unit_price_krw: 189000, quantity: 1, subtotal_krw: 189000 },
  ],
  shipping: { recipient_name: '김철수', phone: '010-1234-5678', postal_code: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '4층 401호', delivery_memo: '' },
}

describe('주문 내역', () => {
  const fetchOrders = jest.fn()
  let OrderList

  beforeAll(async () => { OrderList = await compileSfc('views/OrderList.vue', { fetchOrders }) })
  beforeEach(() => fetchOrders.mockReset())

  test('로딩 → 상태 이름·주문명·총액·주문일·이미지와 상세 링크', async () => {
    const response = deferred()
    fetchOrders.mockReturnValue(response.promise)
    const page = mount(OrderList)
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('주문 내역을 불러오는 중입니다...')
    expect(fetchOrders).toHaveBeenCalledWith({ page: 1, pageSize: 10 })
    response.resolve(orderPage([paid, cancelled]))
    await flush()
    const content = text(page.root)
    expect(content).toContain('전체 주문 2건')
    expect(content).toContain('결제 완료')
    expect(content).toContain('취소됨')
    expect(content).toContain(paid.order_name)
    expect(content).toContain('1,987,000원')
    expect(content).toContain('2026년 10월 30일 주문')
    expect(content).toContain('상품 3개')
    expect(link(page.root, paid.order_name).props.href).toBe('/orders/order-7f3a9c2e')
    const images = findAll(page.root, (node) => node.type === 'img')
    expect(images.map((image) => image.props.src)).toEqual(['https://images.example.test/gpu.png', '/product-placeholder.svg'])
    expect(images.every((image) => image.props.alt === '')).toBe(true)
    expect(find(page.root, (node) => node.type === 'nav')).toBeNull()
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('orders')
  })

  test('깨진 이미지는 기본 이미지로 바꾼다', async () => {
    fetchOrders.mockResolvedValue(orderPage([paid]))
    const page = mount(OrderList)
    await flush()
    find(page.root, (node) => node.type === 'img').props.onError()
    await flush()
    expect(find(page.root, (node) => node.type === 'img').props.src).toBe('/product-placeholder.svg')
  })

  test('비어 있으면 안내와 상품 보러 가기 링크', async () => {
    fetchOrders.mockResolvedValue(orderPage([]))
    const page = mount(OrderList)
    await flush()
    expect(text(page.root)).toContain('아직 주문한 상품이 없습니다.')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
  })

  test('비로그인(401)이면 로그인 안내, 로그인 링크, 다시 확인 버튼', async () => {
    fetchOrders.mockRejectedValueOnce({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } }).mockResolvedValue(orderPage([paid]))
    const page = mount(OrderList)
    await flush()
    expect(text(page.root)).toContain('로그인 후 이용할 수 있습니다.')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(fetchOrders).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain(paid.order_name)
  })

  test('서버 오류면 오류와 다시 시도', async () => {
    fetchOrders.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(orderPage([]))
    const page = mount(OrderList)
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('주문 내역을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchOrders).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain('아직 주문한 상품이 없습니다.')
  })

  test('페이지를 넘기면 그 쪽을 부르고 현재 쪽을 보여 준다', async () => {
    fetchOrders.mockResolvedValueOnce(orderPage([paid], 25, 1)).mockResolvedValueOnce(orderPage([cancelled], 25, 2))
    const page = mount(OrderList)
    await flush()
    expect(text(find(page.root, (node) => node.type === 'nav'))).toContain('1 / 3')
    expect(button(page.root, '이전').props.disabled).toBe(true)
    await click(button(page.root, '다음'))
    expect(fetchOrders).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 })
    expect(text(page.root)).toContain('2 / 3')
    expect(text(page.root)).toContain(cancelled.order_name)
    expect(text(page.root)).not.toContain(paid.order_name)
    expect(button(page.root, '이전').props.disabled).toBe(false)
  })
})

describe('주문 상세', () => {
  const fetchOrder = jest.fn()
  let OrderDetail

  beforeAll(async () => { OrderDetail = await compileSfc('views/OrderDetail.vue', { fetchOrder }) })
  beforeEach(() => fetchOrder.mockReset())

  test('로딩 → 상태, 상품 표(주문 당시 이름·단가·수량·소계), 총액, 배송지, 결제일', async () => {
    const response = deferred()
    fetchOrder.mockReturnValue(response.promise)
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('주문 정보를 불러오는 중입니다...')
    expect(fetchOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    response.resolve(detail)
    await flush()
    const content = text(page.root)
    expect(content).toContain('결제 완료')
    expect(content).toContain(detail.order_name)
    expect(content).toContain('주문 번호 order-7f3a9c2e')
    expect(content).toContain('주문일2026년 10월 30일 오전 10:12')
    expect(content).toContain('결제일2026년 10월 30일 오전 10:13')
    expect(content).not.toContain('취소일')
    const rows = findAll(page.root, (node) => node.type === 'tr').slice(1).map(text)
    expect(rows).toEqual(['지포스 RTX 4070 SUPER 12GB899,000원2개1,798,000원', 'FOCUS GX-850 GOLD 850W189,000원1개189,000원'])
    expect(link(page.root, 'FOCUS GX-850 GOLD 850W').props.href).toBe('/products/12')
    expect(content).toContain('총 결제 금액1,987,000원')
    expect(content).toContain('받는 분김철수')
    expect(content).toContain('연락처010-1234-5678')
    expect(content).toContain('(06236) 서울특별시 강남구 테헤란로 123 4층 401호')
    expect(content).toContain('배송 메모없음')
    expect(link(page.root, '주문 내역').props.href).toBe('/orders')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('orders')
  })

  test('취소된 주문은 취소일과 환불 안내를 보여 준다', async () => {
    fetchOrder.mockResolvedValue({ ...detail, status: 'CANCELLED', paid_at: null, cancelled_at: '2026-10-30T01:14:00Z' })
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    expect(text(page.root)).toContain('취소됨')
    expect(text(page.root)).toContain('취소일2026년 10월 30일 오전 10:14')
    expect(text(page.root)).toContain('취소된 주문입니다. 결제 금액은 자동으로 환불됩니다.')
    expect(text(page.root)).not.toContain('결제일')
  })

  test('결제 대기 주문은 결제가 확인되지 않았다고 안내한다', async () => {
    fetchOrder.mockResolvedValue({ ...detail, status: 'READY', paid_at: null })
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    expect(text(page.root)).toContain('결제 대기')
    expect(text(page.root)).toContain('결제가 아직 확인되지 않은 주문입니다.')
  })

  test('잘못된 주소(null)는 API 를 부르지 않고 주문 내역 링크를 준다', async () => {
    const page = mount(OrderDetail, { paymentId: null })
    await flush()
    expect(fetchOrder).not.toHaveBeenCalled()
    expect(text(byRole(page.root, 'alert')[0])).toContain('올바르지 않은 주문 주소입니다.')
    expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
  })

  test('비로그인(401)이면 로그인 안내와 다시 확인', async () => {
    fetchOrder.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValue(detail)
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    expect(text(page.root)).toContain('로그인 후 이용할 수 있습니다.')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(text(page.root)).toContain(detail.order_name)
  })

  test('없거나 남의 주문(404)이면 다시 시도 없이 주문 내역 링크', async () => {
    fetchOrder.mockRejectedValue({ response: { status: 404, data: { message: '주문을 찾을 수 없습니다.' } } })
    const page = mount(OrderDetail, { paymentId: 'order-other' })
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('주문을 찾을 수 없습니다.')
    expect(link(page.root, '주문 내역 보기').props.href).toBe('/orders')
    expect(button(page.root, '다시 시도')).toBeNull()
  })

  test('서버 오류면 오류와 다시 시도', async () => {
    fetchOrder.mockRejectedValueOnce({ isAxiosError: true }).mockResolvedValue(detail)
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('주문 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchOrder).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain(detail.order_name)
  })
})

describe('주문 상세: 결제 대기 주문의 결제 확인', () => {
  const fetchOrder = jest.fn()
  const confirmOrder = jest.fn()
  const ready = { ...detail, status: 'READY', paid_at: null }
  let OrderDetail

  beforeAll(async () => { OrderDetail = await compileSfc('views/OrderDetail.vue', { fetchOrder, confirmOrder }) })
  beforeEach(() => {
    fetchOrder.mockReset().mockResolvedValue(ready)
    confirmOrder.mockReset()
  })

  async function open() {
    const page = mount(OrderDetail, { paymentId: 'order-7f3a9c2e' })
    await flush()
    return page
  }

  test.each([['PAID', detail], ['CANCELLED', { ...detail, status: 'CANCELLED' }]])('%s 주문에는 결제 확인 버튼이 없다', async (_status, order) => {
    fetchOrder.mockResolvedValue(order)
    const page = await open()
    expect(button(page.root, '결제 확인')).toBeNull()
  })

  test('결제 확인 중에는 버튼을 막아 한 번만 보내고, 성공하면 응답(OrderDetail)으로 상세를 다시 그린다', async () => {
    const response = deferred()
    confirmOrder.mockReturnValue(response.promise)
    const page = await open()
    expect(text(page.root)).toContain('결제 대기')
    expect(text(page.root)).toContain('여러 번 눌러도 중복으로 결제되지 않습니다.')
    const confirm = button(page.root, '결제 확인').props.onClick
    confirm()
    confirm()
    await flush()
    expect(confirmOrder).toHaveBeenCalledTimes(1)
    expect(confirmOrder).toHaveBeenCalledWith('order-7f3a9c2e')
    expect(button(page.root, '결제 확인 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    response.resolve(detail)
    await flush()
    expect(text(page.root)).toContain('결제 완료')
    expect(text(page.root)).toContain('결제일2026년 10월 30일 오전 10:13')
    expect(text(byRole(page.root, 'status')[0])).toContain('결제가 확인되었습니다.')
    expect(button(page.root, '결제 확인')).toBeNull()
    expect(fetchOrder).toHaveBeenCalledTimes(1)
  })

  test('409(결제 미완료)는 서버 문구를 그대로 보여 주고, 상태가 바뀌었을 수 있으니 상세를 다시 부른다', async () => {
    confirmOrder.mockRejectedValue({ response: { status: 409, data: { message: '결제가 완료되지 않은 주문입니다.' } } })
    const page = await open()
    await click(button(page.root, '결제 확인'))
    expect(text(byRole(page.root, 'alert')[0])).toContain('결제가 완료되지 않은 주문입니다.')
    expect(fetchOrder).toHaveBeenCalledTimes(2)
    expect(button(page.root, '결제 확인').props.disabled).toBe(false)
  })

  test('409(재고 부족으로 취소)면 다시 부른 상세가 취소됨으로 바뀌고 안내가 남는다', async () => {
    confirmOrder.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.' } } })
    const page = await open()
    fetchOrder.mockResolvedValue({ ...ready, status: 'CANCELLED', cancelled_at: '2026-10-30T01:14:00Z' })
    await click(button(page.root, '결제 확인'))
    expect(text(page.root)).toContain('취소됨')
    expect(text(byRole(page.root, 'alert')[0])).toContain('재고가 부족해 주문을 취소했습니다. 결제 금액은 자동으로 환불됩니다.')
    expect(button(page.root, '결제 확인')).toBeNull()
  })

  test('502 는 서버 문구를 보여 주고 상세는 다시 부르지 않으며 다시 누를 수 있다', async () => {
    confirmOrder.mockRejectedValueOnce({ response: { status: 502, data: { message: '포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } }).mockResolvedValueOnce(detail)
    const page = await open()
    await click(button(page.root, '결제 확인'))
    expect(text(byRole(page.root, 'alert')[0])).toContain('포트원 결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(fetchOrder).toHaveBeenCalledTimes(1)
    await click(button(page.root, '결제 확인'))
    expect(confirmOrder).toHaveBeenCalledTimes(2)
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(text(page.root)).toContain('결제 완료')
  })

  test('401 이면 로그인 만료 안내와 새 탭 로그인 링크', async () => {
    confirmOrder.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    await click(button(page.root, '결제 확인'))
    expect(text(byRole(page.root, 'alert')[0])).toContain('로그인이 만료되어 결제를 확인하지 못했습니다.')
    expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
  })
})
