// 주문 상세(views/OrderDetail.vue)의 반품 신청 영역·반품 내역·신청 철회(spec docs/specs/2026-11-01-returns-refunds.md "화면").
// 상태: 반품 가능, 기한 지남, 숨김(PAID 아님·모두 신청함), 저장 중(두 번 제출 방지), 실패(입력 유지), 성공, 내역(상태 배지·환불 금액·거절 사유), 철회(InlineConfirm).
// 신청 가능 수량·환불 금액은 서버 응답을 그대로 쓰는지 본다. 이벤트(return_request·return_withdraw)는 src/trackingView.test.mjs 가 본다.
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'

const NOW = Date.parse('2026-11-01T00:00:00Z')
const AFTER_DEADLINE = Date.parse('2026-11-06T01:13:00Z')
const paymentId = 'order-7f3a9c2e'
const items = [
  { product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', unit_price_krw: 899000, quantity: 2, subtotal_krw: 1798000, build_id: null },
  { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', unit_price_krw: 189000, quantity: 1, subtotal_krw: 189000, build_id: null },
]
const returnRequest = (id, extra = {}) => ({
  id, payment_id: paymentId, status: 'REQUESTED', reason: 'incompatible', detail: '',
  items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }],
  items_total_krw: 899000, shipping_deduction_krw: 0, refund_amount_krw: 899000,
  requested_at: '2026-10-31T02:00:00Z', decided_at: null, reject_reason: null, refunded_at: null,
  ...extra,
})
const order = {
  payment_id: paymentId, order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', status: 'PAID', total_krw: 1987000, item_count: 3, thumbnail_url: '',
  created_at: '2026-10-30T01:12:00Z', paid_at: '2026-10-30T01:13:00Z', cancelled_at: null, items,
  shipping: { recipient_name: '김철수', phone: '010-1234-5678', postal_code: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '', delivery_memo: '' },
  returns: [], returnable: [{ product_id: 3, quantity: 2 }, { product_id: 12, quantity: 1 }], return_deadline: '2026-11-06T01:13:00Z',
}

const fetchOrder = jest.fn()
const createReturn = jest.fn()
const withdrawReturn = jest.fn()
const track = jest.fn()
let now = NOW
const currentTime = () => now
let OrderDetail

beforeAll(async () => { OrderDetail = await compileSfc('views/OrderDetail.vue', { fetchOrder, createReturn, withdrawReturn, currentTime, track }) })
beforeEach(() => {
  for (const mock of [fetchOrder, createReturn, withdrawReturn, track]) mock.mockReset()
  now = NOW
})

async function open(detail = order) {
  fetchOrder.mockResolvedValue(detail)
  const page = mount(OrderDetail, { paymentId })
  await flush()
  return page
}

const returnSection = (root) => find(root, (node) => node.props['aria-labelledby'] === 'order-return-title')
const historySection = (root) => find(root, (node) => node.props['aria-labelledby'] === 'order-return-history-title')
const submitButton = (root) => find(root, (node) => node.type === 'button' && node.props.type === 'submit')
const form = (root) => find(root, (node) => node.type === 'form')
const fieldset = (root) => find(root, (node) => node.type === 'fieldset' && node.props.class === 'order-return__fieldset')
const radio = (root, code) => byId(root, `return-reason-${code}`)
const options = (select) => findAll(select, (node) => node.type === 'option').map((node) => node.props.value)
const historyItems = (root) => findAll(historySection(root), (node) => node.type === 'li' && node.props.class === 'order-return-history__item')

async function choose(root, productId, quantity) {
  byId(root, `return-quantity-${productId}`).props.onChange({ target: { value: String(quantity) } })
  await flush()
}

async function pickReason(root, code) {
  radio(root, code).props.onChange()
  await flush()
}

describe('반품 신청 영역', () => {
  test('반품 가능: 기한(한국 시간 24시간제), 상품마다 수량 select(0~서버 신청 가능 수량), 사유 5개, 자세한 내용, 변심 배송비 안내, 수량 0 이면 버튼 비활성화', async () => {
    const page = await open()
    const section = returnSection(page.root)
    const content = text(section)
    expect(content).toContain('반품 신청')
    expect(content).toContain('신청 기한 2026년 11월 6일 10:13 까지')
    expect(content).toContain('지포스 RTX 4070 SUPER 12GB')
    expect(content).toContain('단가 899,000원 · 신청 가능 2개')
    expect(content).toContain('신청 가능 1개')
    expect(options(byId(page.root, 'return-quantity-3'))).toEqual([0, 1, 2])
    expect(options(byId(page.root, 'return-quantity-12'))).toEqual([0, 1])
    expect(findAll(section, (node) => node.type === 'input' && node.props.type === 'radio').map((node) => node.props.value))
      .toEqual(['defective', 'incompatible', 'not_as_described', 'wrong_item', 'changed_mind'])
    expect(content).toContain('호환 안 됨')
    expect(content).toContain('단순 변심')
    expect(byId(page.root, 'return-detail').props.maxlength).toBe(500)
    expect(content).toContain('단순 변심은 왕복 배송비 6,000원을 빼고 환불합니다.')
    expect(content).toContain('반품할 수량 0개')
    expect(text(submitButton(page.root))).toBe('반품 신청')
    expect(submitButton(page.root).props.disabled).toBe(true)
    // 시뮬레이터가 읽는 상품 표(table)의 링크는 그대로 2개다(반품 영역에는 표·상품 링크를 두지 않는다)
    expect(findAll(page.root, (node) => node.type === 'table')).toHaveLength(1)
    expect(findAll(section, (node) => node.type === 'a')).toHaveLength(0)
    expect(historySection(page.root)).toBeNull()
  })

  test('수량을 고르면 합계를 보여 주고 버튼이 켜진다', async () => {
    const page = await open()
    await choose(page.root, 3, 2)
    await choose(page.root, 12, 1)
    expect(text(returnSection(page.root))).toContain('반품할 수량 3개')
    expect(byId(page.root, 'return-quantity-3').props.value).toBe(2)
    expect(submitButton(page.root).props.disabled).toBe(false)
  })

  test('기한이 지나면 신청서 대신 기한 지남 안내를 보여 준다', async () => {
    now = AFTER_DEADLINE
    const page = await open()
    const content = text(returnSection(page.root))
    expect(content).toContain('반품 신청 기간이 지났습니다. 반품은 결제 후 7일 안에 신청할 수 있습니다.')
    expect(content).toContain('(신청 기한: 2026년 11월 6일 10:13 까지)')
    expect(find(page.root, (node) => node.type === 'form')).toBeNull()
    expect(byId(page.root, 'return-quantity-3')).toBeNull()
  })

  test.each([
    ['결제 대기', { ...order, status: 'READY', paid_at: null, return_deadline: null }],
    ['취소됨', { ...order, status: 'CANCELLED', paid_at: null, cancelled_at: '2026-10-30T01:14:00Z', return_deadline: null }],
    ['모두 신청함(returnable 비어 있음)', { ...order, returnable: [] }],
    ['반품 필드가 없는 예전 응답', { ...order, returns: undefined, returnable: undefined, return_deadline: undefined }],
  ])('%s 이면 반품 신청 영역을 보여 주지 않는다', async (_name, detail) => {
    const page = await open(detail)
    expect(returnSection(page.root)).toBeNull()
    expect(text(page.root)).not.toContain('단순 변심은 왕복 배송비')
  })

  test('사유를 고르지 않고 신청하면 요청을 보내지 않고 안내한다', async () => {
    const page = await open()
    await choose(page.root, 3, 1)
    await submit(page.root)
    expect(createReturn).not.toHaveBeenCalled()
    expect(text(byRole(page.root, 'alert')[0])).toBe('반품 사유를 골라 주세요.')
  })

  test('저장 중: 버튼 "저장 중..."·fieldset 비활성화, 두 번 보내지 않는다. 성공하면 서버의 환불 금액으로 안내하고 입력을 비우고 상세를 다시 부른다', async () => {
    const page = await open()
    await choose(page.root, 3, 1)
    await choose(page.root, 12, 1)
    await pickReason(page.root, 'changed_mind')
    await setValue(byId(page.root, 'return-detail'), '  생각보다 커서 케이스에 맞지 않습니다. ')
    const response = deferred()
    createReturn.mockReturnValue(response.promise)
    // 응답을 붙잡아 둔 동안: 제출을 기다리지 않고 두 번 누른다
    form(page.root).props.onSubmit({ preventDefault() {} })
    form(page.root).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createReturn).toHaveBeenCalledTimes(1)
    expect(createReturn).toHaveBeenCalledWith(paymentId, {
      reason: 'changed_mind', detail: '  생각보다 커서 케이스에 맞지 않습니다. ', items: [{ productId: 3, quantity: 1 }, { productId: 12, quantity: 1 }],
    })
    expect(text(submitButton(page.root))).toBe('저장 중...')
    expect(submitButton(page.root).props.disabled).toBe(true)
    expect(fieldset(page.root).props.disabled).toBe(true)
    expect(form(page.root).props['aria-busy']).toBe(true)

    const created = returnRequest(41, {
      reason: 'changed_mind', detail: '생각보다 커서 케이스에 맞지 않습니다.',
      items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }, { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', quantity: 1, unit_price_krw: 189000 }],
      items_total_krw: 1088000, shipping_deduction_krw: 6000, refund_amount_krw: 1082000, requested_at: '2026-11-01T02:00:00Z',
    })
    fetchOrder.mockResolvedValue({ ...order, returns: [created], returnable: [{ product_id: 3, quantity: 1 }] })
    response.resolve(created)
    await flush()
    expect(text(byRole(page.root, 'status').find((node) => text(node).includes('반품을 신청했습니다')))).toBe('반품을 신청했습니다. 환불 예정 금액은 1,082,000원이며, 관리자가 확인한 뒤 환불합니다.')
    expect(fetchOrder).toHaveBeenCalledTimes(2)
    // 다시 부른 상세의 returnable(서버 값)로 줄이 바뀐다
    expect(options(byId(page.root, 'return-quantity-3'))).toEqual([0, 1])
    expect(byId(page.root, 'return-quantity-12')).toBeNull()
    expect(byId(page.root, 'return-quantity-3').props.value).toBe(0)
    expect(radio(page.root, 'changed_mind').props.checked).toBe(false)
    expect(byId(page.root, 'return-detail').value).toBe('')
    expect(text(submitButton(page.root))).toBe('반품 신청')
    expect(historyItems(page.root)).toHaveLength(1)
    expect(text(historySection(page.root))).toContain('1,082,000원')
  })

  test('상세를 다시 부르지 못해도 서버가 돌려준 신청은 반품 내역에 보인다', async () => {
    const page = await open()
    await choose(page.root, 3, 1)
    await pickReason(page.root, 'defective')
    createReturn.mockResolvedValue(returnRequest(42, { reason: 'defective' }))
    fetchOrder.mockRejectedValue({ isAxiosError: true })
    await submit(page.root)
    expect(historyItems(page.root)).toHaveLength(1)
    expect(text(historySection(page.root))).toContain('불량')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
  })

  test('실패(409)하면 서버 문구를 보여 주고 입력은 그대로 둔다. 상세는 조용히 다시 부른다', async () => {
    const page = await open()
    await choose(page.root, 3, 2)
    await pickReason(page.root, 'incompatible')
    await setValue(byId(page.root, 'return-detail'), '메인보드 소켓이 맞지 않습니다.')
    createReturn.mockRejectedValue({ response: { status: 409, data: { message: '신청할 수 있는 수량을 넘었습니다.' } } })
    await submit(page.root)
    expect(text(byRole(page.root, 'alert')[0])).toBe('신청할 수 있는 수량을 넘었습니다.')
    expect(byId(page.root, 'return-quantity-3').props.value).toBe(2)
    expect(radio(page.root, 'incompatible').props.checked).toBe(true)
    expect(byId(page.root, 'return-detail').value).toBe('메인보드 소켓이 맞지 않습니다.')
    expect(fetchOrder).toHaveBeenCalledTimes(2)
    expect(submitButton(page.root).props.disabled).toBe(false)
    expect(byRole(page.root, 'status').filter((node) => text(node).includes('반품을 신청했습니다'))).toHaveLength(0)
  })

  test('서버 오류(500)는 다시 시도 안내를 보여 주고 상세를 다시 부르지 않는다', async () => {
    const page = await open()
    await choose(page.root, 12, 1)
    await pickReason(page.root, 'wrong_item')
    createReturn.mockRejectedValue({ response: { status: 500, data: { message: 'Internal Server Error' } } })
    await submit(page.root)
    expect(text(byRole(page.root, 'alert')[0])).toBe('반품을 신청하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(fetchOrder).toHaveBeenCalledTimes(1)
  })

  test('로그인이 만료(401)되면 안내와 새 탭 로그인 링크를 주고 입력을 지킨다', async () => {
    const page = await open()
    await choose(page.root, 3, 1)
    await pickReason(page.root, 'not_as_described')
    createReturn.mockRejectedValue({ response: { status: 401 } })
    await submit(page.root)
    expect(text(byRole(page.root, 'alert')[0])).toContain('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
    const login = link(returnSection(page.root), '새 탭에서 다시 로그인')
    expect(login.props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(radio(page.root, 'not_as_described').props.checked).toBe(true)
  })
})

describe('반품 내역·신청 철회', () => {
  const history = [
    returnRequest(1, { status: 'REFUNDED', reason: 'defective', detail: '전원이 켜지지 않습니다.', refunded_at: '2026-10-31T05:00:00Z', decided_at: '2026-10-31T05:00:00Z' }),
    returnRequest(2, {
      status: 'REJECTED', reason: 'changed_mind', reject_reason: '사용 흔적이 있어 반품할 수 없습니다.',
      items: [{ product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', quantity: 1, unit_price_krw: 189000 }], items_total_krw: 189000, shipping_deduction_krw: 6000, refund_amount_krw: 183000,
    }),
    returnRequest(3, { status: 'APPROVED' }),
    returnRequest(4, { status: 'WITHDRAWN' }),
    returnRequest(5, { status: 'REQUESTED', reason: 'wrong_item' }),
  ]
  const detail = { ...order, returns: history, returnable: [{ product_id: 3, quantity: 1 }] }

  test('신청마다 상태 글자 배지·상품·수량·사유·환불 금액(서버 값, 차감 표시)·거절 사유. REQUESTED 만 "신청 철회"', async () => {
    const page = await open(detail)
    expect(text(historySection(page.root))).toContain('반품 내역 5건')
    const rows = historyItems(page.root)
    expect(rows.map((row) => text(find(row, (node) => node.props.class?.includes?.('shop-order-status'))))).toEqual(['환불 완료', '거절됨', '승인됨·환불 대기', '철회함', '신청됨'])
    expect(text(rows[0])).toContain('지포스 RTX 4070 SUPER 12GB1개')
    expect(text(rows[0])).toContain('사유불량')
    expect(text(rows[0])).toContain('자세한 내용전원이 켜지지 않습니다.')
    expect(text(rows[0])).toContain('환불일2026년 10월 31일 오후 2:00')
    expect(text(rows[1])).toContain('환불 금액183,000원 (상품 189,000원 − 왕복 배송비 6,000원)')
    expect(text(rows[1])).toContain('거절 사유사용 흔적이 있어 반품할 수 없습니다.')
    expect(text(rows[2])).not.toContain('배송비')
    expect(rows.map((row) => Boolean(button(row, '신청 철회')))).toEqual([false, false, false, false, true])
  })

  test('철회: 화면 안 확인(InlineConfirm) → 예 → 서버가 돌려준 WITHDRAWN 으로 바꾸고 안내, 상세를 다시 부른다', async () => {
    const page = await open(detail)
    await click(button(historyItems(page.root)[4], '신청 철회'))
    const confirm = stub(historyItems(page.root)[4], 'InlineConfirm')
    expect(confirm.props).toMatchObject({ message: '이 반품 신청을 철회할까요?', 'confirm-label': '철회', 'busy-label': '철회 중...', busy: false })
    expect(button(historyItems(page.root)[4], '신청 철회')).toBeNull()

    const response = deferred()
    withdrawReturn.mockReturnValue(response.promise)
    confirm.props.onConfirm()
    await flush()
    expect(withdrawReturn).toHaveBeenCalledWith(paymentId, 5)
    expect(stub(historyItems(page.root)[4], 'InlineConfirm').props.busy).toBe(true)
    fetchOrder.mockResolvedValue({ ...detail, returns: history.map((item) => (item.id === 5 ? { ...item, status: 'WITHDRAWN' } : item)), returnable: [{ product_id: 3, quantity: 2 }] })
    response.resolve({ ...history[4], status: 'WITHDRAWN' })
    await flush()
    expect(text(find(historyItems(page.root)[4], (node) => node.props.class?.includes?.('shop-order-status')))).toBe('철회함')
    expect(stub(historyItems(page.root)[4], 'InlineConfirm')).toBeNull()
    expect(text(byRole(historySection(page.root), 'status')[0])).toBe('반품 신청을 철회했습니다. 철회한 수량은 신청 기한 안에 다시 신청할 수 있습니다.')
    expect(fetchOrder).toHaveBeenCalledTimes(2)
    // 철회한 수량은 다시 신청할 수 있다(서버 returnable 이 늘어난다)
    expect(options(byId(page.root, 'return-quantity-3'))).toEqual([0, 1, 2])
  })

  test('철회 확인에서 아니요를 누르면 상자를 닫고 아무것도 보내지 않는다', async () => {
    const page = await open(detail)
    await click(button(historyItems(page.root)[4], '신청 철회'))
    stub(historyItems(page.root)[4], 'InlineConfirm').props.onCancel()
    await flush()
    expect(stub(historyItems(page.root)[4], 'InlineConfirm')).toBeNull()
    expect(button(historyItems(page.root)[4], '신청 철회')).not.toBeNull()
    expect(withdrawReturn).not.toHaveBeenCalled()
  })

  test('철회가 실패(500)하면 확인 상자를 그대로 두고 오류를 보여 준다', async () => {
    const page = await open(detail)
    await click(button(historyItems(page.root)[4], '신청 철회'))
    withdrawReturn.mockRejectedValue({ response: { status: 500 } })
    stub(historyItems(page.root)[4], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(byRole(historySection(page.root), 'alert')[0])).toBe('반품 신청을 철회하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(stub(historyItems(page.root)[4], 'InlineConfirm').props.busy).toBe(false)
    expect(text(find(historyItems(page.root)[4], (node) => node.props.class?.includes?.('shop-order-status')))).toBe('신청됨')
    expect(fetchOrder).toHaveBeenCalledTimes(1)
  })

  test('이미 처리된 신청(409)이면 상자를 닫고 서버 문구를 보여 주며 상세를 다시 부른다', async () => {
    const page = await open(detail)
    await click(button(historyItems(page.root)[4], '신청 철회'))
    withdrawReturn.mockRejectedValue({ response: { status: 409, data: { message: '신청 상태에서만 철회할 수 있습니다.' } } })
    fetchOrder.mockResolvedValue({ ...detail, returns: history.map((item) => (item.id === 5 ? { ...item, status: 'APPROVED' } : item)) })
    stub(historyItems(page.root)[4], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(byRole(historySection(page.root), 'alert')[0])).toBe('신청 상태에서만 철회할 수 있습니다.')
    expect(stub(historyItems(page.root)[4], 'InlineConfirm')).toBeNull()
    expect(text(find(historyItems(page.root)[4], (node) => node.props.class?.includes?.('shop-order-status')))).toBe('승인됨·환불 대기')
  })
})
