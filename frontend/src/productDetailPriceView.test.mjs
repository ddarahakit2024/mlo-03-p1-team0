// 상품 상세(views/ProductDetail.vue)의 가격 기능: 목표가 알림 패널(비회원·불러오기·빠른 선택·저장·검증·실패·해제),
// 판매처 비교와 최저가 매칭 요청(비회원·성공·422·로그인 만료), "이 부품에 대한 질문" 영역(로딩·정상·빈 목록·오류 → 다시 시도),
// 기간을 바꿔 받았을 때의 price_history_view.
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const trend = {
  change_30d_pct: -2.1, lowest_1y_krw: 879000, lowest_1y_on: '2026-10-01', highest_1y_krw: 949000, average_30d_krw: 905000, is_lowest_1y: false, lowest_gap_pct: 2.3,
  sparkline_30d: [], external_lowest: { source: 'coupang', price_krw: 879000 }, store_is_lowest: false, store_gap_krw: 20000,
}
const detail = {
  id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용',
  description: '설명', specs: [], released_on: '2026-01-10', is_new: false, rating_average: null, review_count: 0, lowest_price_90d: 879000,
  price_trend: trend,
  store_prices: [
    { source: 'coupang', price_krw: 879000, recorded_at: '2026-11-05T03:00:00Z' },
    { source: 'store', price_krw: 899000, recorded_at: '2026-10-29T00:00:00Z' },
    { source: 'naver', price_krw: 909000, recorded_at: '2026-11-04T03:00:00Z' },
  ],
}
const member = { id: 1, name: '김조립' }
const alertOf = (target) => ({ product_id: 3, target_price_krw: target, reached: false, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', product: { id: 3 } })
const question = (id, extra = {}) => ({ id, title: `질문 ${id}`, content: '', author: { id: '9', name: `글쓴이${id}` }, created_at: '2026-10-29T16:00:00Z', updated_at: '2026-10-29T16:00:00Z', image_count: 0, answer_count: 0, accepted_answer_id: null, ...extra })

const fetchProduct = jest.fn()
const fetchPriceHistory = jest.fn()
const fetchProductReviews = jest.fn()
const fetchQuestions = jest.fn()
const fetchAlerts = jest.fn()
const saveAlert = jest.fn()
const deleteAlert = jest.fn()
const requestPriceMatch = jest.fn()
const fetchCurrentUser = jest.fn()
const track = jest.fn()
const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
const authSession = createAuthSession({ fetchCurrentUser })
const fetchProductRecommendations = async () => ({ product_id: 3, model: null, items: [] })
const currentTime = () => Date.parse('2026-11-05T03:00:00Z')
let ProductDetail

beforeAll(async () => {
  ProductDetail = await compileSfc('views/ProductDetail.vue', {
    fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations, fetchQuestions, fetchAlerts, saveAlert, deleteAlert, requestPriceMatch,
    authSession, siteStatus, track, currentTime,
  })
})
beforeEach(() => {
  for (const mock of [fetchProduct, fetchPriceHistory, fetchProductReviews, fetchQuestions, fetchAlerts, saveAlert, deleteAlert, requestPriceMatch, fetchCurrentUser, track, ...Object.values(siteStatus)]) mock.mockReset()
  fetchProduct.mockResolvedValue(detail)
  fetchPriceHistory.mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
  fetchProductReviews.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: {}, my_review: null, can_review: false })
  fetchQuestions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
  fetchAlerts.mockResolvedValue({ items: [] })
  fetchCurrentUser.mockResolvedValue(member)
  authSession.reset()
})

async function open() {
  const page = mount(ProductDetail, { productId: 3 })
  await flush()
  return page
}
const section = (root, titleId) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === titleId)
const panel = (page) => byId(page.root, 'price-alert-panel')
const alertButton = (page) => find(page.root, (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)

describe('목표가 알림', () => {
  test('비회원이 누르면 요청 없이 로그인 안내(로그인 링크)를 펼친다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    expect(fetchAlerts).not.toHaveBeenCalled()
    expect(text(alertButton(page))).toBe('목표가 알림')
    expect(alertButton(page).props['aria-expanded']).toBe(false)
    await click(alertButton(page))
    expect(alertButton(page).props).toMatchObject({ 'aria-expanded': true, 'aria-controls': 'price-alert-panel' })
    expect(text(panel(page))).toContain('로그인하면 목표가 알림을 받을 수 있어요.')
    expect(link(panel(page), '로그인').props.href).toBe('/login')
    expect(find(panel(page), (node) => node.type === 'form')).toBeNull()
    expect(fetchAlerts).not.toHaveBeenCalled()
    expect(saveAlert).not.toHaveBeenCalled()
    await click(alertButton(page))
    expect(panel(page)).toBeNull()
  })

  test('회원은 내 알림을 불러와 버튼에 "알림 N원"을 보여 주고, 펼치면 목표가를 입력칸에 채운다', async () => {
    fetchAlerts.mockResolvedValue({ items: [{ ...alertOf(500000), product_id: 9 }, alertOf(860000)] })
    const page = await open()
    expect(fetchAlerts).toHaveBeenCalledTimes(1)
    expect(text(alertButton(page))).toBe('알림 860,000원')
    expect(alertButton(page).props.class).toContain('pd-action--on')
    await click(alertButton(page))
    expect(byId(page.root, 'price-alert-target').value).toBe('860000')
    expect(text(panel(page))).toContain('지금 목표가는 860,000원이에요.')
    expect(button(panel(page), '해제')).not.toBeNull()
  })

  test('빠른 선택(1년 최저가·-5%·-10%)을 누르면 입력칸을 채우고, 저장하면 PUT 뒤 토스트·패널 닫기(초점은 버튼으로)·버튼 글자를 바꾼다', async () => {
    const response = deferred()
    saveAlert.mockReturnValue(response.promise)
    const page = await open()
    await click(alertButton(page))
    const presets = findAll(panel(page), (node) => node.type === 'button' && node.props.class === 'pd-preset')
    expect(presets.map(text)).toEqual(['1년 최저가 879,000원', '-5% 854,100원', '-10% 809,100원'])
    expect(button(panel(page), '해제')).toBeNull()
    await click(presets[1])
    expect(byId(page.root, 'price-alert-target').value).toBe('854100')
    expect(find(panel(page), (node) => node.type === 'label').props.for).toBe('price-alert-target')
    const form = find(panel(page), (node) => node.type === 'form')
    form.props.onSubmit({ preventDefault() {} })
    form.props.onSubmit({ preventDefault() {} })
    await flush()
    expect(saveAlert).toHaveBeenCalledTimes(1)
    expect(saveAlert).toHaveBeenCalledWith(3, { targetPriceKrw: 854100 })
    expect(button(panel(page), '저장 중...').props['aria-busy']).toBe(true)
    expect(find(panel(page), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    const focus = jest.fn()
    alertButton(page).focus = focus
    response.resolve(alertOf(854100))
    await flush()
    expect(siteStatus.showToast).toHaveBeenCalledWith('854,100원 이하로 내려오면 알려드릴게요')
    expect(panel(page)).toBeNull()
    expect(focus).toHaveBeenCalled()
    expect(text(alertButton(page))).toBe('알림 854,100원')
  })

  test.each([
    ['비어 있음', ''],
    ['0원', '0'],
    ['1억 원 넘음', '100,000,001'],
  ])('입력 검사(%s)에 걸리면 보내지 않고 role=alert 로 알린다', async (_name, value) => {
    const page = await open()
    await click(alertButton(page))
    await setValue(byId(page.root, 'price-alert-target'), value)
    await submit(panel(page))
    expect(saveAlert).not.toHaveBeenCalled()
    expect(text(byRole(panel(page), 'alert')[0])).toBe('목표 가격을 1원 이상 1억 원 이하의 숫자로 입력해 주세요.')
    expect(byId(page.root, 'price-alert-target').props['aria-invalid']).toBe(true)
  })

  test.each([
    ['409 50개 초과', { response: { status: 409, data: { message: '목표가 알림은 50개까지 등록할 수 있습니다.' } } }, '목표가 알림은 50개까지 등록할 수 있습니다.', false],
    ['500', { response: { status: 500 } }, '목표가 알림을 저장하지 못했습니다. 입력한 가격은 그대로 있습니다. 다시 시도해 주세요.', false],
    ['401 로그인 만료', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.', true],
  ])('저장 실패(%s)는 문구를 보여 주고 입력을 그대로 둔다', async (_name, failure, message, login) => {
    saveAlert.mockRejectedValue(failure)
    const page = await open()
    await click(alertButton(page))
    await setValue(byId(page.root, 'price-alert-target'), '850,000원')
    await submit(panel(page))
    expect(saveAlert).toHaveBeenCalledWith(3, { targetPriceKrw: 850000 })
    expect(text(byRole(panel(page), 'alert')[0])).toContain(message)
    expect(byId(page.root, 'price-alert-target').value).toBe('850,000원')
    expect(button(panel(page), '저장').props['aria-busy']).toBe(false)
    expect(siteStatus.showToast).not.toHaveBeenCalled()
    const relogin = link(panel(page), '새 탭에서 다시 로그인')
    if (login) expect(relogin.props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    else expect(relogin).toBeNull()
  })

  test('해제하면 DELETE 뒤 토스트·패널 닫기·버튼은 "목표가 알림". 해제 중에는 잠근다', async () => {
    fetchAlerts.mockResolvedValue({ items: [alertOf(860000)] })
    const response = deferred()
    deleteAlert.mockReturnValue(response.promise)
    const page = await open()
    await click(alertButton(page))
    button(panel(page), '해제').props.onClick()
    await flush()
    expect(deleteAlert).toHaveBeenCalledWith(3)
    expect(find(panel(page), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    expect(text(panel(page))).toContain('해제 중...')
    response.resolve(null)
    await flush()
    expect(siteStatus.showToast).toHaveBeenCalledWith('목표가 알림을 해제했어요')
    expect(panel(page)).toBeNull()
    expect(text(alertButton(page))).toBe('목표가 알림')
  })

  test('해제 실패(500)는 문구를 보여 주고 알림을 그대로 둔다. 이미 없으면(404) 해제된 것으로 본다', async () => {
    fetchAlerts.mockResolvedValue({ items: [alertOf(860000)] })
    deleteAlert.mockRejectedValueOnce({ response: { status: 500 } }).mockRejectedValueOnce({ response: { status: 404, data: { message: '등록된 목표가 알림이 없습니다.' } } })
    const page = await open()
    await click(alertButton(page))
    await click(button(panel(page), '해제'))
    expect(text(byRole(panel(page), 'alert')[0])).toBe('목표가 알림을 해제하지 못했습니다. 다시 시도해 주세요.')
    expect(text(alertButton(page))).toBe('알림 860,000원')
    await click(button(panel(page), '해제'))
    expect(text(alertButton(page))).toBe('목표가 알림')
  })

  test('알림을 불러오는 동안은 role=status, 실패하면 role=alert + 다시 시도', async () => {
    const response = deferred()
    fetchAlerts.mockReturnValueOnce(response.promise).mockResolvedValue({ items: [alertOf(870000)] })
    const page = await open()
    await click(alertButton(page))
    expect(text(byRole(panel(page), 'status')[0])).toBe('목표가 알림을 불러오는 중입니다...')
    response.reject({ response: { status: 500 } })
    await flush()
    expect(text(byRole(panel(page), 'alert')[0])).toContain('목표가 알림을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(panel(page), '다시 시도'))
    expect(fetchAlerts).toHaveBeenCalledTimes(2)
    expect(text(alertButton(page))).toBe('알림 870,000원')
    expect(find(panel(page), (node) => node.type === 'form')).not.toBeNull()
  })

  test('로그인 상태를 확인하지 못하면(500) 알림을 부르지 않고 오류 → 다시 시도는 로그인 상태부터 다시 확인한다', async () => {
    fetchCurrentUser.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(member)
    const page = await open()
    expect(fetchAlerts).not.toHaveBeenCalled()
    await click(alertButton(page))
    expect(text(byRole(panel(page), 'alert')[0])).toContain('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
    await click(button(panel(page), '다시 시도'))
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
    expect(fetchAlerts).toHaveBeenCalledTimes(1)
    expect(find(panel(page), (node) => node.type === 'form')).not.toBeNull()
  })

  test('알림 목록이 401 이면(그사이 로그아웃) 로그인 안내로 바꾼다', async () => {
    fetchAlerts.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    await click(alertButton(page))
    expect(text(panel(page))).toContain('로그인하면 목표가 알림을 받을 수 있어요.')
  })
})

describe('판매처 비교와 최저가 매칭', () => {
  const area = (page) => section(page.root, 'store-prices-title')
  const rows = (page) => findAll(area(page), (node) => node.type === 'li')

  test('가격 낮은 순으로 판매처를 보여 주고 MOA Parts 줄을 강조, 맨 위에 최저가 배지, 차이와 기준 시각', async () => {
    const page = await open()
    expect(text(area(page))).toContain('11월 5일 12:00 기준')
    expect(rows(page).map(text)).toEqual([
      '쿠팡11월 5일 기록최저가879,000원−20,000원',
      'MOA Parts무료 배송899,000원MOA 판매가',
      '네이버11월 4일 기록909,000원+10,000원',
    ])
    expect(rows(page).map((node) => node.props.class)).toEqual(['pd-store', 'pd-store pd-store--mine', 'pd-store'])
    expect(text(area(page))).toContain('다른 곳이 더 저렴해요. 최저가에 맞춰 드릴게요.')
  })

  test('MOA Parts 가 최저면 매칭 요청 상자가 없다. 다른 판매처가 없으면 안내', async () => {
    fetchProduct.mockResolvedValue({ ...detail, price_trend: { ...trend, store_is_lowest: true }, store_prices: [{ source: 'store', price_krw: 899000, recorded_at: null }] })
    const page = await open()
    expect(button(area(page), '최저가 매칭 요청')).toBeNull()
    expect(text(area(page))).toContain('다른 판매처 가격 기록이 아직 없습니다.')
    expect(text(area(page))).not.toContain('최저가899,000원')
  })

  test('비회원은 요청하지 않고 로그인 안내', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    await click(button(area(page), '최저가 매칭 요청'))
    expect(requestPriceMatch).not.toHaveBeenCalled()
    expect(text(byRole(area(page), 'status')[0])).toContain('로그인하면 최저가 매칭을 요청할 수 있어요.')
    expect(link(area(page), '로그인').props.href).toBe('/login')
  })

  test('회원: 보내는 중에는 막고 한 번만 보낸다. 성공하면 토스트와 "매칭을 요청했어요"(다시 누를 수 없음)', async () => {
    const response = deferred()
    requestPriceMatch.mockReturnValue(response.promise)
    const page = await open()
    button(area(page), '최저가 매칭 요청').props.onClick()
    await flush()
    expect(button(area(page), '요청 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    expect(requestPriceMatch).toHaveBeenCalledTimes(1)
    expect(requestPriceMatch).toHaveBeenCalledWith(3)
    response.resolve({ id: 1, product_id: 3, store_price_krw: 899000, external_source: 'coupang', external_price_krw: 879000, status: 'requested', created_at: '2026-11-05T03:00:00Z' })
    await flush()
    expect(siteStatus.showToast).toHaveBeenCalledWith('최저가 매칭을 요청했어요. 확인 후 알려드릴게요')
    expect(button(area(page), '매칭을 요청했어요').props.disabled).toBe(true)
  })

  test.each([
    ['422 이미 최저', { response: { status: 422, data: { message: '이미 MOA Parts 가 가장 저렴한 상품입니다.' } } }, '이미 MOA Parts 가 가장 저렴한 상품입니다.'],
    ['500', { response: { status: 500 } }, '최저가 매칭을 요청하지 못했습니다. 다시 시도해 주세요.'],
  ])('실패(%s)는 role=alert 문구, 버튼은 다시 누를 수 있다', async (_name, failure, message) => {
    requestPriceMatch.mockRejectedValue(failure)
    const page = await open()
    await click(button(area(page), '최저가 매칭 요청'))
    expect(text(byRole(area(page), 'alert')[0])).toBe(message)
    expect(button(area(page), '최저가 매칭 요청').props.disabled).toBe(false)
    expect(siteStatus.showToast).not.toHaveBeenCalled()
  })

  test('로그인이 만료됐으면(401) 만료 안내와 로그인 링크', async () => {
    requestPriceMatch.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    await click(button(area(page), '최저가 매칭 요청'))
    expect(text(byRole(area(page), 'status')[0])).toContain('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
    expect(link(area(page), '로그인').props.href).toBe('/login')
  })
})

describe('이 부품에 대한 질문', () => {
  const area = (page) => section(page.root, 'product-questions-title')

  test('상품을 받은 뒤 이 부품의 질문 5개를 부른다: 로딩 → 줄(답변 수·제목·글쓴이·날짜, 질문 링크)과 질문하기 링크', async () => {
    const response = deferred()
    fetchQuestions.mockReturnValue(response.promise)
    const page = await open()
    expect(fetchQuestions).toHaveBeenCalledWith({ productId: 3, pageSize: 5 })
    expect(text(byRole(area(page), 'status')[0])).toBe('질문을 불러오는 중입니다...')
    expect(area(page).props['aria-busy']).toBe(true)
    response.resolve({ items: [question(12, { answer_count: 2, accepted_answer_id: 4 }), question(13)], total: 2, page: 1, page_size: 5 })
    await flush()
    expect(link(area(page), '질문하기').props.href).toBe('/questions/new?product=3')
    const items = findAll(area(page), (node) => node.type === 'a' && node.props.class === 'pd-question')
    expect(items.map((node) => [node.props.href, text(node)])).toEqual([
      ['/questions/12', '답변 2질문 12글쓴이12 · 2026.10.30'],
      ['/questions/13', '답변 0질문 13글쓴이13 · 2026.10.30'],
    ])
    expect(find(items[0], (node) => node.type === 'span').props.class).toContain('pd-question__count--answered')
    expect(find(area(page), (node) => node.type === 'ul').props['aria-label']).toBe('이 부품에 대한 질문')
  })

  test('질문이 없으면 영역을 숨긴다', async () => {
    const page = await open()
    expect(area(page)).toBeNull()
  })

  test('실패하면 이 영역만 오류와 다시 시도. 본문은 그대로 보인다', async () => {
    fetchQuestions.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue({ items: [question(12)], total: 1, page: 1, page_size: 5 })
    const page = await open()
    expect(text(byRole(area(page), 'alert')[0])).toContain('이 부품에 대한 질문을 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
    await click(button(area(page), '다시 시도'))
    expect(fetchQuestions).toHaveBeenCalledTimes(2)
    expect(byRole(area(page), 'alert')).toHaveLength(0)
    expect(text(area(page))).toContain('질문 12')
  })
})

test('기간을 바꿔 받으면 price_history_view 를 다시 남긴다(실패한 요청은 남기지 않는다)', async () => {
  const history = { items: [{ price_krw: 899000, source: 'store', recorded_at: '2026-10-29T00:00:00Z' }], lowest_price_krw: 899000, highest_price_krw: 899000 }
  fetchPriceHistory.mockResolvedValueOnce(history).mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ ...history, items: [] })
  const page = await open()
  byId(page.root, 'price-period-week').props.onChange()
  await flush()
  byId(page.root, 'price-period-year').props.onChange()
  await flush()
  const views = track.mock.calls.filter(([type]) => type === 'price_history_view').map(([, props]) => props)
  expect(views).toEqual([
    { product_id: 3, points: 1, lowest_price_krw: 899000, highest_price_krw: 899000 },
    { product_id: 3, points: 0, lowest_price_krw: 899000, highest_price_krw: 899000 },
  ])
})
