// 관리자 반품 관리(views/AdminReturns.vue, /admin/returns)의 상태별 렌더링과 처리(spec docs/specs/2026-11-01-returns-refunds.md "화면").
// 상태: 로딩, 목록, 빈 목록(전체·상태별), 오류 → 다시 시도, 비로그인(401), 관리자 아님(403), 상태 탭(?status=)·쪽 이동·요청 경합,
// 승인(카드 안 확인 "환불 N원을 승인할까요?" → 예일 때만 요청, 아니요는 요청 없음) → 환불 성공, 환불 실패(502) → APPROVED + refund_error → 다시 환불(확인을 거침),
// 거절(사유 입력 + 확인·검증·실패·취소).
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, text } from './testing/sfc.mjs'

const adminReturn = (id, extra = {}) => ({
  id, payment_id: `order-${id}a9c2e0b1d4e5f8a9b0c1d2e3f4a5b`, status: 'REQUESTED', reason: 'incompatible', detail: '',
  items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }],
  items_total_krw: 899000, shipping_deduction_krw: 0, refund_amount_krw: 899000,
  requested_at: '2026-11-01T02:00:00Z', decided_at: null, reject_reason: null, refunded_at: null,
  order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', buyer_subject: `user-${id}`, paid_at: '2026-10-30T01:13:00Z', payment_provider: 'mock', refund_error: null,
  ...extra,
})
const requested = adminReturn(12, {
  reason: 'changed_mind', detail: '케이스에 들어가지 않습니다.\n길이를 잘못 봤습니다.',
  items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }, { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', quantity: 1, unit_price_krw: 189000 }],
  items_total_krw: 1088000, shipping_deduction_krw: 6000, refund_amount_krw: 1082000,
})
const approved = adminReturn(11, { status: 'APPROVED', payment_provider: 'portone', decided_at: '2026-11-01T03:00:00Z', refund_error: 'PortOne 취소 요청이 실패했습니다(TIMEOUT).' })
const refunded = adminReturn(10, { status: 'REFUNDED', decided_at: '2026-10-31T03:00:00Z', refunded_at: '2026-10-31T03:00:00Z' })
const listPage = (items, total = items.length, page = 1) => ({ items, total, page })

const fetchAdminReturns = jest.fn()
const approveReturn = jest.fn()
const rejectReturn = jest.fn()
const readAdminReturnsQuery = jest.fn()
const replaceAdminReturnsQuery = jest.fn()
let AdminReturns

beforeAll(async () => {
  AdminReturns = await compileSfc('views/AdminReturns.vue', { fetchAdminReturns, approveReturn, rejectReturn, readAdminReturnsQuery, replaceAdminReturnsQuery })
})
beforeEach(() => {
  for (const mock of [fetchAdminReturns, approveReturn, rejectReturn, readAdminReturnsQuery, replaceAdminReturnsQuery]) mock.mockReset()
  readAdminReturnsQuery.mockReturnValue({ status: null })
})

async function open(response = listPage([requested, approved, refunded])) {
  fetchAdminReturns.mockResolvedValue(response)
  const page = mount(AdminReturns)
  await flush()
  return page
}

const cards = (root) => findAll(root, (node) => node.type === 'article')
const tabs = (root) => findAll(root, (node) => node.type === 'button' && node.props.class === 'admin-returns__tab')
const pressed = (root) => tabs(root).filter((node) => node.props['aria-pressed'] === true).map(text)
const badge = (card) => text(find(card, (node) => typeof node.props.class === 'string' && node.props.class.includes('shop-order-status')))
const notice = (root) => find(root, (node) => typeof node.props.class === 'string' && node.props.class.includes('admin-returns__notice'))

describe('목록과 화면 상태', () => {
  test('로딩 → 신청마다 주문 이름·payment_id·결제 시각·결제 방식·상품·수량·단가·사유·자세한 내용·금액(서버 값, 차감 표시)·상태·refund_error', async () => {
    const response = deferred()
    fetchAdminReturns.mockReturnValue(response.promise)
    const page = mount(AdminReturns)
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('반품 신청을 불러오는 중입니다...')
    expect(fetchAdminReturns).toHaveBeenCalledWith({ status: null, page: 1 })
    response.resolve(listPage([requested, approved, refunded]))
    await flush()
    expect(text(page.root)).toContain('반품 신청 3건')
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('')
    const [first, second, third] = cards(page.root)
    expect(badge(first)).toBe('신청됨')
    expect(text(first)).toContain('신청 #12')
    expect(text(first)).toContain('지포스 RTX 4070 SUPER 12GB 외 1건')
    expect(text(first)).toContain(`주문 번호${requested.payment_id}`)
    expect(text(first)).toContain('결제 시각2026년 10월 30일 오전 10:13')
    expect(text(first)).toContain('결제 방식모의 결제')
    expect(text(first)).toContain('구매자user-12')
    expect(text(first)).toContain('FOCUS GX-850 GOLD 850W1개 × 189,000원')
    expect(text(first)).toContain('사유단순 변심')
    expect(text(first)).toContain('자세한 내용케이스에 들어가지 않습니다.\n길이를 잘못 봤습니다.')
    expect(text(first)).toContain('상품 합계1,088,000원')
    expect(text(first)).toContain('배송비 차감− 6,000원')
    expect(text(first)).toContain('환불 금액1,082,000원')
    expect(button(first, '승인하고 환불')).not.toBeNull()
    expect(button(first, '거절')).not.toBeNull()
    expect(badge(second)).toBe('승인됨·환불 대기')
    expect(text(second)).toContain('결제 방식PortOne')
    expect(text(second)).toContain('배송비 차감없음')
    expect(text(second)).toContain('환불 실패: PortOne 취소 요청이 실패했습니다(TIMEOUT).')
    expect(button(second, '다시 환불')).not.toBeNull()
    expect(button(second, '승인하고 환불')).toBeNull()
    expect(badge(third)).toBe('환불 완료')
    expect(text(third)).toContain('환불 시각2026년 10월 31일 오후 12:00')
    expect(findAll(third, (node) => node.type === 'button')).toHaveLength(0)
    expect(pressed(page.root)).toEqual(['전체'])
    expect(tabs(page.root).map(text)).toEqual(['전체', '신청', '환불 대기', '환불 완료', '거절', '철회'])
    expect(byRole(page.root, 'alert')).toHaveLength(0)
  })

  test('주소 ?status=REQUESTED 로 열면 그 상태로 부르고 탭을 강조한다', async () => {
    readAdminReturnsQuery.mockReturnValue({ status: 'REQUESTED' })
    const page = await open(listPage([requested]))
    expect(fetchAdminReturns).toHaveBeenCalledWith({ status: 'REQUESTED', page: 1 })
    expect(pressed(page.root)).toEqual(['신청'])
  })

  test('비어 있으면(전체) 안내를 보여 준다', async () => {
    const page = await open(listPage([]))
    expect(text(page.root)).toContain('아직 반품 신청이 없습니다.')
    expect(text(page.root)).toContain('구매자가 주문 상세에서 반품을 신청하면 여기에 보입니다.')
    expect(cards(page.root)).toHaveLength(0)
  })

  test('고른 상태에 신청이 없으면 그 상태 이름으로 안내하고 "전체 보기"로 돌아간다', async () => {
    readAdminReturnsQuery.mockReturnValue({ status: 'APPROVED' })
    const page = await open(listPage([]))
    expect(text(page.root)).toContain('환불 대기 상태의 반품 신청이 없습니다.')
    fetchAdminReturns.mockResolvedValue(listPage([refunded]))
    await click(button(page.root, '전체 보기'))
    expect(replaceAdminReturnsQuery).toHaveBeenLastCalledWith(null)
    expect(fetchAdminReturns).toHaveBeenLastCalledWith({ status: null, page: 1 })
    expect(cards(page.root)).toHaveLength(1)
  })

  test('비로그인(401)이면 로그인 안내·로그인 링크·다시 확인(탭은 숨김)', async () => {
    fetchAdminReturns.mockRejectedValueOnce({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } }).mockResolvedValue(listPage([requested]))
    const page = mount(AdminReturns)
    await flush()
    expect(text(page.root)).toContain('로그인 후 이용할 수 있습니다.')
    expect(text(page.root)).toContain('관리자 계정으로 로그인하면 반품 신청을 확인할 수 있습니다.')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    expect(tabs(page.root)).toHaveLength(0)
    expect(text(page.root)).not.toContain('관리자만 볼 수 있습니다.')
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(fetchAdminReturns).toHaveBeenCalledTimes(2)
    expect(cards(page.root)).toHaveLength(1)
  })

  test('관리자가 아니면(403) "관리자만 볼 수 있습니다." — 로그인 안내와 다른 문구, 다시 시도 없음', async () => {
    fetchAdminReturns.mockRejectedValue({ response: { status: 403, data: { message: '관리자만 사용할 수 있습니다.' } } })
    const page = mount(AdminReturns)
    await flush()
    expect(text(page.root)).toContain('관리자만 볼 수 있습니다.')
    expect(text(page.root)).not.toContain('로그인 후 이용할 수 있습니다.')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    expect(button(page.root, '다시 시도')).toBeNull()
    expect(tabs(page.root)).toHaveLength(0)
  })

  test('서버 오류면 오류(role=alert)와 다시 시도', async () => {
    fetchAdminReturns.mockRejectedValueOnce({ isAxiosError: true }).mockResolvedValue(listPage([requested]))
    const page = mount(AdminReturns)
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('반품 신청 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchAdminReturns).toHaveBeenCalledTimes(2)
    expect(cards(page.root)).toHaveLength(1)
  })

  test('상태 탭을 누르면 주소를 바꾸고 1쪽부터 그 상태로 부른다. 늦게 온 이전 응답은 무시한다', async () => {
    const page = await open()
    const late = deferred()
    fetchAdminReturns.mockReturnValueOnce(late.promise).mockResolvedValueOnce(listPage([refunded]))
    await click(button(page.root, '환불 대기'))
    await click(tabs(page.root).find((node) => text(node) === '환불 완료'))
    expect(replaceAdminReturnsQuery.mock.calls).toEqual([['APPROVED'], ['REFUNDED']])
    expect(fetchAdminReturns).toHaveBeenNthCalledWith(2, { status: 'APPROVED', page: 1 })
    expect(fetchAdminReturns).toHaveBeenNthCalledWith(3, { status: 'REFUNDED', page: 1 })
    late.resolve(listPage([approved]))
    await flush()
    expect(cards(page.root).map((card) => badge(card))).toEqual(['환불 완료'])
    expect(pressed(page.root)).toEqual(['환불 완료'])
  })

  test('쪽 이동: 쪽당 20개, 다음을 누르면 그 쪽을 부르고 현재 쪽을 보여 준다', async () => {
    const page = await open(listPage([requested], 45, 1))
    const nav = find(page.root, (node) => node.type === 'nav')
    expect(nav.props['aria-label']).toBe('반품 신청 페이지')
    expect(text(nav)).toContain('1 / 3')
    expect(button(nav, '이전').props.disabled).toBe(true)
    fetchAdminReturns.mockResolvedValue(listPage([approved], 45, 2))
    await click(button(nav, '다음'))
    expect(fetchAdminReturns).toHaveBeenLastCalledWith({ status: null, page: 2 })
    expect(text(find(page.root, (node) => node.type === 'nav'))).toContain('2 / 3')
  })
})

describe('승인·환불', () => {
  // "승인하고 환불"·"다시 환불"은 그 카드 안의 확인 상자(InlineConfirm, 테스트에서는 stub)를 거친다
  const confirmBox = (card) => stub(card, 'InlineConfirm')
  async function approveWithConfirm(root, index, label) {
    await click(button(cards(root)[index], label))
    confirmBox(cards(root)[index]).props.onConfirm()
    await flush()
  }

  test('승인하고 환불: 누르면 요청하지 않고 그 카드에 "환불 N원을 승인할까요?"(서버 refund_amount_krw) 확인을 연다', async () => {
    const page = await open()
    await click(button(cards(page.root)[0], '승인하고 환불'))
    expect(approveReturn).not.toHaveBeenCalled()
    expect(confirmBox(cards(page.root)[0]).props).toMatchObject({ message: '환불 1,082,000원을 승인할까요?', 'busy-label': '환불 처리 중...', busy: false })
    expect(button(cards(page.root)[0], '승인하고 환불')).toBeNull()
    expect(button(cards(page.root)[0], '거절')).toBeNull()
    // 다른 카드에는 확인 상자가 없다
    expect(confirmBox(cards(page.root)[1])).toBeNull()
    expect(button(cards(page.root)[1], '다시 환불')).not.toBeNull()
  })

  test('확인에서 "아니요"를 누르면 요청 없이 상자를 닫고 승인·거절 버튼으로 돌아간다', async () => {
    const page = await open()
    await click(button(cards(page.root)[0], '승인하고 환불'))
    confirmBox(cards(page.root)[0]).props.onCancel()
    await flush()
    expect(approveReturn).not.toHaveBeenCalled()
    expect(confirmBox(cards(page.root)[0])).toBeNull()
    expect(button(cards(page.root)[0], '승인하고 환불')).not.toBeNull()
    expect(notice(page.root)).toBeNull()
  })

  test('"다시 환불"도 확인(서버 refund_amount_krw 그대로)을 거치고, "아니요"면 요청하지 않는다', async () => {
    const page = await open()
    await click(button(cards(page.root)[1], '다시 환불'))
    expect(approveReturn).not.toHaveBeenCalled()
    expect(confirmBox(cards(page.root)[1]).props.message).toBe('환불 899,000원을 승인할까요?')
    confirmBox(cards(page.root)[1]).props.onCancel()
    await flush()
    expect(approveReturn).not.toHaveBeenCalled()
    expect(button(cards(page.root)[1], '다시 환불')).not.toBeNull()
  })

  test('다른 카드의 확인을 열거나 거절을 시작하면 열려 있던 승인 확인은 닫힌다(한 번에 한 카드)', async () => {
    const page = await open()
    await click(button(cards(page.root)[0], '승인하고 환불'))
    await click(button(cards(page.root)[1], '다시 환불'))
    expect(confirmBox(cards(page.root)[0])).toBeNull()
    expect(confirmBox(cards(page.root)[1])).not.toBeNull()
    await click(button(cards(page.root)[0], '거절'))
    expect(confirmBox(cards(page.root)[1])).toBeNull()
    expect(byId(page.root, 'reject-reason-12')).not.toBeNull()
  })

  test('확인 → 예 → 요청: 처리 중에는 상자(busy)·모든 처리 버튼·탭을 막아 두 번 보내지 않고, 성공하면 응답(REFUNDED)으로 바꾸고 role=status 로 알린다', async () => {
    const page = await open()
    const response = deferred()
    approveReturn.mockReturnValue(response.promise)
    await click(button(cards(page.root)[0], '승인하고 환불'))
    confirmBox(cards(page.root)[0]).props.onConfirm()
    confirmBox(cards(page.root)[0]).props.onConfirm()
    await flush()
    expect(approveReturn).toHaveBeenCalledTimes(1)
    expect(approveReturn).toHaveBeenCalledWith(12)
    expect(confirmBox(cards(page.root)[0]).props.busy).toBe(true)
    confirmBox(cards(page.root)[0]).props.onCancel()
    await flush()
    expect(confirmBox(cards(page.root)[0])).not.toBeNull()
    expect(button(cards(page.root)[1], '다시 환불').props.disabled).toBe(true)
    expect(tabs(page.root).every((node) => node.props.disabled === true)).toBe(true)
    response.resolve({ ...requested, status: 'REFUNDED', decided_at: '2026-11-01T04:00:00Z', refunded_at: '2026-11-01T04:00:00Z' })
    await flush()
    expect(badge(cards(page.root)[0])).toBe('환불 완료')
    expect(confirmBox(cards(page.root)[0])).toBeNull()
    expect(findAll(cards(page.root)[0], (node) => node.type === 'button')).toHaveLength(0)
    expect(notice(page.root).props.role).toBe('status')
    expect(text(notice(page.root))).toBe('신청 #12 환불을 마쳤습니다(환불 금액 1,082,000원).')
    expect(button(cards(page.root)[1], '다시 환불').props.disabled).toBe(false)
  })

  test('환불 실패(502): 서버 문구를 role=alert 로 보여 주고 목록을 다시 불러 APPROVED + refund_error 로 보인다. "다시 환불"(확인 → 예)로 재시도해 성공한다', async () => {
    const page = await open(listPage([requested]))
    approveReturn.mockRejectedValueOnce({ response: { status: 502, data: { message: '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.' } } })
    const failed = { ...requested, status: 'APPROVED', decided_at: '2026-11-01T04:00:00Z', refund_error: 'PortOne 응답 시간이 지났습니다.' }
    fetchAdminReturns.mockResolvedValue(listPage([failed]))
    await approveWithConfirm(page.root, 0, '승인하고 환불')
    expect(confirmBox(cards(page.root)[0])).toBeNull()
    expect(notice(page.root).props.role).toBe('alert')
    expect(text(notice(page.root))).toBe('신청 #12: 환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.')
    expect(fetchAdminReturns).toHaveBeenCalledTimes(2)
    expect(fetchAdminReturns).toHaveBeenLastCalledWith({ status: null, page: 1 })
    expect(badge(cards(page.root)[0])).toBe('승인됨·환불 대기')
    expect(text(cards(page.root)[0])).toContain('환불 실패: PortOne 응답 시간이 지났습니다.')
    expect(byRole(page.root, 'status')).toHaveLength(0)

    approveReturn.mockResolvedValueOnce({ ...failed, status: 'REFUNDED', refund_error: null, refunded_at: '2026-11-01T04:05:00Z' })
    await click(button(cards(page.root)[0], '다시 환불'))
    expect(approveReturn).toHaveBeenCalledTimes(1)
    expect(confirmBox(cards(page.root)[0]).props.message).toBe('환불 1,082,000원을 승인할까요?')
    confirmBox(cards(page.root)[0]).props.onConfirm()
    await flush()
    expect(approveReturn).toHaveBeenCalledTimes(2)
    expect(approveReturn).toHaveBeenLastCalledWith(12)
    expect(badge(cards(page.root)[0])).toBe('환불 완료')
    expect(text(cards(page.root)[0])).not.toContain('환불 실패')
    expect(notice(page.root).props.role).toBe('status')
  })

  test('조용히 다시 부르기가 실패해도 지금 목록과 실패 안내를 그대로 둔다', async () => {
    const page = await open(listPage([requested]))
    approveReturn.mockRejectedValue({ response: { status: 409, data: { message: '이미 처리한 반품 신청입니다.' } } })
    fetchAdminReturns.mockRejectedValue({ isAxiosError: true })
    await approveWithConfirm(page.root, 0, '승인하고 환불')
    expect(text(notice(page.root))).toBe('신청 #12: 이미 처리한 반품 신청입니다.')
    expect(cards(page.root)).toHaveLength(1)
    expect(text(page.root)).not.toContain('반품 신청 목록을 불러오지 못했습니다.')
  })

  test('로그인이 만료(401)되면 새 탭 로그인 링크를 주고 목록을 다시 부르지 않는다', async () => {
    const page = await open(listPage([requested]))
    approveReturn.mockRejectedValue({ response: { status: 401 } })
    await approveWithConfirm(page.root, 0, '승인하고 환불')
    expect(text(notice(page.root))).toContain('신청 #12: 로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
    expect(link(notice(page.root), '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(fetchAdminReturns).toHaveBeenCalledTimes(1)
  })
})

describe('거절', () => {
  test('거절 → 사유 입력 + 확인: 빈 사유는 보내지 않고, 처리 중 "거절 중..."·잠금, 성공하면 REJECTED 와 거절 사유를 보여 준다', async () => {
    const page = await open(listPage([requested]))
    await click(button(cards(page.root)[0], '거절'))
    const input = byId(page.root, 'reject-reason-12')
    expect(input.props.maxlength).toBe(200)
    expect(find(page.root, (node) => node.type === 'label' && node.props.for === 'reject-reason-12')).not.toBeNull()
    expect(button(cards(page.root)[0], '승인하고 환불')).toBeNull()
    const form = () => find(cards(page.root)[0], (node) => node.type === 'form')
    form().props.onSubmit({ preventDefault() {} })
    await flush()
    expect(rejectReturn).not.toHaveBeenCalled()
    expect(text(byRole(form(), 'alert')[0])).toBe('거절 사유를 입력해 주세요.')

    await setValue(byId(page.root, 'reject-reason-12'), '사용 흔적이 있어 반품할 수 없습니다.')
    expect(text(form())).toContain('21 / 200')
    const response = deferred()
    rejectReturn.mockReturnValue(response.promise)
    form().props.onSubmit({ preventDefault() {} })
    form().props.onSubmit({ preventDefault() {} })
    await flush()
    expect(rejectReturn).toHaveBeenCalledTimes(1)
    expect(rejectReturn).toHaveBeenCalledWith(12, { reason: '사용 흔적이 있어 반품할 수 없습니다.' })
    expect(button(form(), '거절 중...').props.disabled).toBe(true)
    expect(find(form(), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    response.resolve({ ...requested, status: 'REJECTED', reject_reason: '사용 흔적이 있어 반품할 수 없습니다.', decided_at: '2026-11-01T04:00:00Z' })
    await flush()
    expect(badge(cards(page.root)[0])).toBe('거절됨')
    expect(text(cards(page.root)[0])).toContain('거절 사유사용 흔적이 있어 반품할 수 없습니다.')
    expect(form()).toBeNull()
    expect(text(notice(page.root))).toBe('신청 #12 거절을 마쳤습니다. 구매자의 반품 내역에 거절 사유가 보입니다.')
    expect(notice(page.root).props.role).toBe('status')
  })

  test('거절이 실패(500)해도 입력한 사유를 그대로 두고 오류를 보여 준다', async () => {
    const page = await open(listPage([requested]))
    await click(button(cards(page.root)[0], '거절'))
    await setValue(byId(page.root, 'reject-reason-12'), '구성품이 빠져 있습니다.')
    rejectReturn.mockRejectedValue({ response: { status: 500 } })
    const form = () => find(cards(page.root)[0], (node) => node.type === 'form')
    form().props.onSubmit({ preventDefault() {} })
    await flush()
    expect(text(byRole(form(), 'alert')[0])).toBe('거절하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(byId(page.root, 'reject-reason-12').value).toBe('구성품이 빠져 있습니다.')
    expect(badge(cards(page.root)[0])).toBe('신청됨')
    expect(fetchAdminReturns).toHaveBeenCalledTimes(1)
  })

  test('이미 처리된 신청(409)이면 입력 상자를 닫고 안내한 뒤 목록을 다시 부른다', async () => {
    const page = await open(listPage([requested]))
    await click(button(cards(page.root)[0], '거절'))
    await setValue(byId(page.root, 'reject-reason-12'), '구성품이 빠져 있습니다.')
    rejectReturn.mockRejectedValue({ response: { status: 409, data: { message: '신청 상태에서만 거절할 수 있습니다.' } } })
    fetchAdminReturns.mockResolvedValue(listPage([{ ...requested, status: 'WITHDRAWN' }]))
    find(cards(page.root)[0], (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await flush()
    expect(text(notice(page.root))).toBe('신청 #12: 신청 상태에서만 거절할 수 있습니다.')
    expect(find(cards(page.root)[0], (node) => node.type === 'form')).toBeNull()
    expect(badge(cards(page.root)[0])).toBe('철회함')
  })

  test('취소를 누르면 입력 상자를 닫고 승인·거절 버튼으로 돌아간다', async () => {
    const page = await open(listPage([requested]))
    await click(button(cards(page.root)[0], '거절'))
    await click(button(cards(page.root)[0], '취소'))
    expect(byId(page.root, 'reject-reason-12')).toBeNull()
    expect(button(cards(page.root)[0], '승인하고 환불')).not.toBeNull()
    expect(rejectReturn).not.toHaveBeenCalled()
  })
})
