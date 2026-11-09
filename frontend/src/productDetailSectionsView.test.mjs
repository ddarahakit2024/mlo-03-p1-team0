// 상품 상세(views/ProductDetail.vue)의 영역들: 상세 스펙(출시일·성능·가성비·90일 최저가), 가격 추이 영역(기간 탭·요청 경합·표로 보기), 리뷰 영역(영역별 로딩·오류·다시 시도).
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const detail = {
  id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용',
  description: '설명', specs: [{ label: '칩셋', value: 'AD104' }],
  released_on: '2026-09-12', performance_score: 24500, value_score: 272.52, is_new: true, rating_average: 4.5, review_count: 12, lowest_price_90d: 879000,
}
const history = {
  items: [
    { price_krw: 949000, source: 'store', recorded_at: '2026-08-01T00:00:00Z' },
    { price_krw: 929000, source: 'coupang', recorded_at: '2026-08-03T00:00:00Z' },
    { price_krw: 879000, source: 'store', recorded_at: '2026-09-18T00:00:00Z' },
    { price_krw: 899000, source: 'store', recorded_at: '2026-10-29T00:00:00Z' },
  ],
  lowest_price_krw: 879000,
  highest_price_krw: 949000,
}
const ten = '조용하고 온도도 안정적입니다.'
const review = (id, extra = {}) => ({ id, product_id: 3, author: { id: String(id), name: `구매자${id}` }, rating: 5, content: `${ten} ${id}`, created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', is_owner: false, ...extra })
const reviewPage = (extra = {}) => ({
  items: [review(1), review(2, { rating: 3, updated_at: '2026-10-21T01:00:00Z' })], total: 12, page: 1, page_size: 10,
  rating_average: 4.5, rating_counts: { 1: 0, 2: 0, 3: 1, 4: 4, 5: 7 }, my_review: null, can_review: false, ...extra,
})
const emptyReviews = { items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, my_review: null, can_review: false }
const member = { id: 1, name: '김조립' }

const fetchProduct = jest.fn()
const fetchPriceHistory = jest.fn()
const fetchProductReviews = jest.fn()
const fetchCurrentUser = jest.fn()
const createReview = jest.fn()
const updateReview = jest.fn()
const deleteReview = jest.fn()
const addCartItem = jest.fn()
const goToCheckout = jest.fn()
const fetchQuestions = jest.fn()
const fetchAlerts = jest.fn()
const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
// 가격 추이는 오늘(서울)로 끝나는 기간이라 시계를 고정한다: 2026-11-05 12:00(서울)
const currentTime = () => Date.parse('2026-11-05T03:00:00Z')
// 추천 상품 영역(spec docs/specs/2026-11-03-product-recommendations.md)은 src/recommendationView.test.mjs 가 본다. 여기서는 빈 추천을 준다
const fetchProductRecommendations = async () => ({ product_id: 3, model: null, items: [] })
const authSession = createAuthSession({ fetchCurrentUser })
let ProductDetail

beforeAll(async () => {
  ProductDetail = await compileSfc('views/ProductDetail.vue', { fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations, fetchQuestions, fetchAlerts, siteStatus, currentTime, authSession, createReview, updateReview, deleteReview, addCartItem, goToCheckout })
})
beforeEach(() => {
  for (const mock of [fetchProduct, fetchPriceHistory, fetchProductReviews, fetchCurrentUser, createReview, updateReview, deleteReview, addCartItem, goToCheckout, fetchQuestions, fetchAlerts]) mock.mockReset()
  fetchQuestions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
  fetchAlerts.mockResolvedValue({ items: [] })
  fetchProduct.mockResolvedValue(detail)
  fetchPriceHistory.mockResolvedValue(history)
  fetchProductReviews.mockResolvedValue(reviewPage())
  fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
  authSession.reset()
})

async function open() {
  const page = mount(ProductDetail, { productId: 3 })
  await flush()
  return page
}
const section = (root, titleId) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === titleId)
const facts = (root) => text(find(root, (node) => node.type === 'dl' && node.props.class === 'product-facts'))

describe('상세 스펙의 상품 정보', () => {
  test('출시일·NEW·성능 점수·가성비 지수(설명)·90일 최저가와 평점 요약을 보여 준다', async () => {
    const page = await open()
    const shown = facts(section(page.root, 'product-specs-title'))
    expect(shown).toContain('출시일2026년 9월 12일 NEW')
    expect(shown).toContain('성능 점수24,500')
    expect(shown).toContain('가성비 지수272.52 1만 원당 성능 점수. 같은 카테고리끼리 비교하세요.')
    expect(shown).toContain('90일 최저가879,000원')
    expect(shown).not.toContain('최근 90일 최저가')
    expect(stub(page.root, 'ProductRating').props).toMatchObject({ average: 4.5, count: 12 })
  })

  test('현재가가 90일 최저가면 "최근 90일 최저가"를 표시하고, 값이 없으면 - 로 둔다', async () => {
    fetchProduct.mockResolvedValue({ ...detail, price_krw: 879000, is_new: false, value_score: null, performance_score: null, released_on: '' })
    const page = await open()
    const shown = facts(page.root)
    expect(shown).toContain('90일 최저가879,000원 최근 90일 최저가')
    expect(shown).toContain('출시일-')
    expect(shown).not.toContain('NEW')
    expect(shown).toContain('성능 점수-')
    expect(shown).toContain('가성비 지수-')
  })

  test('없는 상품(404)이면 가격 이력·질문·리뷰·로그인 확인·목표가 알림을 부르지 않는다', async () => {
    fetchProduct.mockRejectedValue({ response: { status: 404 } })
    const page = await open()
    expect(text(page.root)).toContain('상품을 찾을 수 없습니다.')
    expect(fetchPriceHistory).not.toHaveBeenCalled()
    expect(fetchQuestions).not.toHaveBeenCalled()
    expect(fetchProductReviews).not.toHaveBeenCalled()
    expect(fetchCurrentUser).not.toHaveBeenCalled()
    expect(fetchAlerts).not.toHaveBeenCalled()
  })
})

describe('가격 추이 영역', () => {
  const chart = (page) => stub(section(page.root, 'price-history-title'), 'ProductPriceChart')
  const radio = (page, code) => byId(page.root, `price-period-${code}`)
  // 2026-10-07 ~ 2026-11-05(서울) 30일: 10-28 까지 879,000원(9-18 기록), 10-29 부터 899,000원
  const monthPoints = [
    ...Array.from({ length: 22 }, (_, index) => ({ date: `2026-10-${String(7 + index).padStart(2, '0')}`, price: 879000 })),
    ...['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((date) => ({ date, price: 899000 })),
  ]

  test('로딩 → 기본 1달 그래프(날마다 MOA Parts 판매가·1년 최저가 점선)와 표로 보기(판매처별)', async () => {
    const response = deferred()
    fetchPriceHistory.mockReturnValue(response.promise)
    fetchProduct.mockResolvedValue({ ...detail, price_trend: { lowest_1y_krw: 869000, sparkline_30d: [] } })
    const page = await open()
    expect(fetchPriceHistory).toHaveBeenCalledWith(3, { days: 30 })
    const area = () => section(page.root, 'price-history-title')
    expect(text(area())).toContain('MOA Parts 판매가 · 매일 자정 기록 · 점선은 1년 최저가')
    expect(text(byRole(area(), 'status')[0])).toBe('가격 이력을 불러오는 중입니다...')
    expect(area().props['aria-busy']).toBe(true)
    expect(radio(page, 'month').props.checked).toBe(true)
    response.resolve(history)
    await flush()
    expect(area().props['aria-busy']).toBe(false)
    expect(chart(page).props).toMatchObject({ points: monthPoints, lowest: 869000, 'period-label': '1달', days: 30 })
    const table = find(area(), (node) => node.type === 'details')
    expect(text(find(table, (node) => node.type === 'summary'))).toBe('가격 기록 표로 보기')
    const rows = findAll(table, (node) => node.type === 'tr').slice(1).map(text)
    expect(rows).toEqual(['MOA Parts899,000원879,000원949,000원2026년 10월 29일', '쿠팡929,000원929,000원929,000원2026년 8월 3일'])
  })

  test('기간 라디오 4개(1주·1달·3달·1년). 고르면 그 기간(days)으로 다시 부르고 같은 기간은 다시 부르지 않는다', async () => {
    const page = await open()
    const group = find(page.root, (node) => node.props.role === 'radiogroup')
    expect(group.props['aria-label']).toBe('가격 추이 기간')
    expect(findAll(group, (node) => node.type === 'label').map((node) => [text(node), node.props.for])).toEqual([
      ['1주', 'price-period-week'], ['1달', 'price-period-month'], ['3달', 'price-period-quarter'], ['1년', 'price-period-year'],
    ])
    radio(page, 'month').props.onChange()
    await flush()
    expect(fetchPriceHistory).toHaveBeenCalledTimes(1)
    fetchPriceHistory.mockResolvedValueOnce({ items: [{ price_krw: 899000, source: 'store', recorded_at: '2026-10-29T00:00:00Z' }], lowest_price_krw: 899000, highest_price_krw: 899000 })
    radio(page, 'week').props.onChange()
    await flush()
    expect(fetchPriceHistory).toHaveBeenLastCalledWith(3, { days: 7 })
    expect(radio(page, 'week').props.checked).toBe(true)
    expect(radio(page, 'month').props.checked).toBe(false)
    expect(chart(page).props).toMatchObject({ 'period-label': '1주', days: 7 })
    expect(chart(page).props.points.map((point) => point.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  })

  test('기간을 빨리 바꾸면 마지막으로 고른 기간의 응답만 보여 준다(늦게 온 이전 응답은 버린다)', async () => {
    const page = await open()
    const week = deferred()
    const year = deferred()
    fetchPriceHistory.mockReturnValueOnce(week.promise).mockReturnValueOnce(year.promise)
    radio(page, 'week').props.onChange()
    radio(page, 'year').props.onChange()
    await flush()
    expect(fetchPriceHistory.mock.calls.slice(1)).toEqual([[3, { days: 7 }], [3, { days: 365 }]])
    expect(text(byRole(section(page.root, 'price-history-title'), 'status')[0])).toBe('가격 이력을 불러오는 중입니다...')
    year.resolve(history)
    await flush()
    expect(chart(page).props).toMatchObject({ 'period-label': '1년', days: 365 })
    // 출시일(2026-09-12) 전 날은 빼고, 8-1 기록(949,000원)을 이어 쓴다
    expect(chart(page).props.points[0]).toEqual({ date: '2026-09-12', price: 949000 })
    week.resolve({ items: [], lowest_price_krw: null, highest_price_krw: null })
    await flush()
    expect(chart(page).props).toMatchObject({ 'period-label': '1년', days: 365 })
    expect(text(find(section(page.root, 'price-history-title'), (node) => node.type === 'details'))).toContain('949,000원')
  })

  test('기간 안에 기록이 없으면 지금 판매가로 이어진 그래프(표로 보기는 없다)', async () => {
    fetchPriceHistory.mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    const page = await open()
    expect(chart(page).props.points).toHaveLength(30)
    expect(new Set(chart(page).props.points.map((point) => point.price))).toEqual(new Set([899000]))
    expect(find(section(page.root, 'price-history-title'), (node) => node.type === 'details')).toBeNull()
  })

  test('보여 줄 날이 없으면(출시 전) 안내 문구', async () => {
    fetchProduct.mockResolvedValue({ ...detail, released_on: '2026-12-01' })
    fetchPriceHistory.mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    const page = await open()
    expect(text(section(page.root, 'price-history-title'))).toContain('아직 가격 이력이 없습니다.')
    expect(chart(page)).toBeNull()
  })

  test('실패하면 이 영역만 오류와 다시 시도(같은 기간). 상품 본문과 리뷰는 그대로 보인다', async () => {
    fetchPriceHistory.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(history)
    const page = await open()
    const area = () => section(page.root, 'price-history-title')
    expect(text(byRole(area(), 'alert')[0])).toContain('가격 이력을 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
    expect(text(section(page.root, 'product-reviews-title'))).toContain('구매자1')
    await click(button(area(), '다시 시도'))
    expect(fetchPriceHistory).toHaveBeenCalledTimes(2)
    expect(fetchPriceHistory).toHaveBeenLastCalledWith(3, { days: 30 })
    expect(fetchProduct).toHaveBeenCalledTimes(1)
    expect(fetchProductReviews).toHaveBeenCalledTimes(1)
    expect(byRole(area(), 'alert')).toHaveLength(0)
    expect(findAll(area(), (node) => node.type === 'tr')).toHaveLength(3)
  })

  test('다른 기간이 실패하면 오류 → 다시 시도는 그 기간으로 부른다', async () => {
    const page = await open()
    fetchPriceHistory.mockRejectedValueOnce(new Error('Network Error'))
    radio(page, 'quarter').props.onChange()
    await flush()
    const area = () => section(page.root, 'price-history-title')
    expect(text(byRole(area(), 'alert')[0])).toContain('가격 이력을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(area(), '다시 시도'))
    expect(fetchPriceHistory).toHaveBeenLastCalledWith(3, { days: 90 })
    expect(chart(page).props).toMatchObject({ 'period-label': '3달', days: 90 })
  })
})

describe('리뷰 영역: 보기', () => {
  test('로딩 → 평균·별점 분포·목록(최신순 그대로)·페이지', async () => {
    const response = deferred()
    fetchProductReviews.mockReturnValue(response.promise)
    const page = await open()
    expect(fetchProductReviews).toHaveBeenCalledWith(3, { page: 1, pageSize: 10 })
    const area = () => section(page.root, 'product-reviews-title')
    expect(text(byRole(area(), 'status')[0])).toBe('리뷰를 불러오는 중입니다...')
    response.resolve(reviewPage())
    await flush()
    const content = text(area())
    expect(content).toContain('리뷰 12개')
    expect(content).toContain('4.5')
    expect(text(find(area(), (node) => node.props['aria-label'] === '별점 분포'))).toBe('5점7개4점4개3점1개2점0개1점0개')
    const bars = findAll(area(), (node) => node.type === 'i' && node.props.style)
    expect(bars.map((node) => node.props.style.width)).toEqual(['58%', '33%', '8%', '0%', '0%'])
    const items = findAll(area(), (node) => node.type === 'li' && node.props.class === 'review-item')
    expect(items.map((node) => text(node))).toEqual([
      `★★★★★구매자1${ten} 12026년 10월 20일`,
      `★★★☆☆구매자2${ten} 22026년 10월 20일수정됨`,
    ])
    expect(text(find(area(), (node) => node.type === 'nav'))).toContain('1 / 2')
  })

  test('다음 쪽을 누르면 그 영역만 로딩한 뒤 그 쪽을 보여 준다', async () => {
    const page = await open()
    const response = deferred()
    fetchProductReviews.mockReturnValueOnce(response.promise)
    const area = () => section(page.root, 'product-reviews-title')
    button(area(), '다음').props.onClick()
    await flush()
    expect(fetchProductReviews).toHaveBeenLastCalledWith(3, { page: 2, pageSize: 10 })
    expect(text(byRole(area(), 'status')[0])).toBe('리뷰를 불러오는 중입니다...')
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
    response.resolve(reviewPage({ page: 2, items: [review(11)] }))
    await flush()
    expect(text(area())).toContain('구매자11')
    expect(text(area())).not.toContain('구매자1조용')
    expect(text(find(area(), (node) => node.type === 'nav'))).toContain('2 / 2')
    expect(button(area(), '다음').props.disabled).toBe(true)
  })

  test('리뷰가 없으면 "아직 리뷰가 없습니다." 와 비로그인 안내(로그인 링크)', async () => {
    fetchProductReviews.mockResolvedValue(emptyReviews)
    const page = await open()
    const area = section(page.root, 'product-reviews-title')
    expect(text(area)).toContain('아직 리뷰가 없습니다.')
    expect(text(area)).toContain('로그인하고 구매한 상품의 리뷰를 남겨 주세요.')
    expect(link(area, '로그인').props.href).toBe('/login')
    expect(find(area, (node) => node.props['aria-label'] === '별점 분포')).toBeNull()
    expect(find(area, (node) => node.type === 'form')).toBeNull()
  })

  test('로그인했지만 구매하지 않았으면 구매 안내만(폼·로그인 링크 없음)', async () => {
    fetchCurrentUser.mockResolvedValue(member)
    const page = await open()
    const area = section(page.root, 'product-reviews-title')
    expect(text(area)).toContain('구매한 상품만 리뷰를 남길 수 있습니다.')
    expect(link(area, '로그인')).toBeNull()
    expect(find(area, (node) => node.type === 'form')).toBeNull()
  })

  test('실패하면 리뷰 영역만 오류와 다시 시도. 상품 본문·가격 이력은 그대로 보인다', async () => {
    fetchProductReviews.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValue(reviewPage())
    const page = await open()
    const area = () => section(page.root, 'product-reviews-title')
    expect(text(byRole(area(), 'alert')[0])).toContain('리뷰를 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(byRole(page.root, 'alert')).toHaveLength(1)
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
    expect(findAll(section(page.root, 'price-history-title'), (node) => node.type === 'tr')).toHaveLength(3)
    await click(button(area(), '다시 시도'))
    expect(fetchProductReviews).toHaveBeenCalledTimes(2)
    expect(fetchPriceHistory).toHaveBeenCalledTimes(1)
    expect(text(area())).toContain('구매자1')
  })
})

describe('리뷰 영역: 작성', () => {
  beforeEach(() => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProductReviews.mockResolvedValue(reviewPage({ can_review: true }))
  })
  const form = (page) => find(page.root, (node) => node.type === 'form')

  test('can_review 면 별점·내용 폼을 보여 주고, 검증에 걸리면 요청하지 않는다', async () => {
    const page = await open()
    expect(text(form(page))).toContain('리뷰 작성')
    expect(byId(page.root, 'review-content').props.maxlength).toBe(2000)
    await submit(page.root)
    expect(createReview).not.toHaveBeenCalled()
    expect(text(byRole(form(page), 'alert')[0])).toBe('별점을 1점부터 5점 중에서 골라 주세요.')
    byId(page.root, 'review-rating-4').props.onChange()
    await setValue(byId(page.root, 'review-content'), '  짧아요  ')
    await submit(page.root)
    expect(createReview).not.toHaveBeenCalled()
    expect(text(byRole(form(page), 'alert')[0])).toBe('리뷰는 10자 이상 입력해 주세요.')
    expect(byId(page.root, 'review-rating-4').props.checked).toBe(true)
  })

  test('등록 중에는 저장 중... + 잠금 + 두 번 보내지 않고, 성공하면 리뷰 영역(1쪽)과 상품 평점 요약을 다시 부른다', async () => {
    const response = deferred()
    createReview.mockReturnValue(response.promise)
    const page = await open()
    byId(page.root, 'review-rating-5').props.onChange()
    await setValue(byId(page.root, 'review-content'), ten)
    form(page).props.onSubmit({ preventDefault() {} })
    form(page).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createReview).toHaveBeenCalledTimes(1)
    expect(createReview).toHaveBeenCalledWith(3, { rating: 5, content: ten })
    expect(button(form(page), '저장 중...').props.disabled).toBe(true)
    expect(find(form(page), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    fetchProductReviews.mockResolvedValue(reviewPage({ can_review: false, my_review: review(20, { is_owner: true, content: ten }), total: 13 }))
    fetchProduct.mockResolvedValue({ ...detail, rating_average: 4.6, review_count: 13, stock: 1 })
    response.resolve(review(20, { is_owner: true, content: ten }))
    await flush()
    expect(fetchProductReviews).toHaveBeenLastCalledWith(3, { page: 1, pageSize: 10 })
    expect(fetchProduct).toHaveBeenCalledTimes(2)
    expect(stub(page.root, 'ProductRating').props).toMatchObject({ average: 4.6, count: 13 })
    expect(stub(page.root, 'ProductPurchaseCard').props.stock).toBe(7)
    const area = section(page.root, 'product-reviews-title')
    expect(text(byRole(area, 'status')[0])).toBe('리뷰가 등록되었습니다.')
    expect(text(area)).toContain('내가 쓴 리뷰')
    expect(form(page)).toBeNull()
  })

  test.each([
    ['403 미구매', { response: { status: 403, data: { message: '구매한 상품만 리뷰를 남길 수 있습니다.' } } }, '구매한 상품만 리뷰를 남길 수 있습니다.', false],
    ['409 이미 작성', { response: { status: 409, data: { message: '이미 이 상품의 리뷰를 작성했습니다.' } } }, '이미 이 상품의 리뷰를 작성했습니다.', false],
    ['401 로그인 만료', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.', true],
    ['500', { response: { status: 500 } }, '리뷰를 등록하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.', false],
  ])('실패(%s)하면 문구를 보여 주고 입력을 그대로 둔다', async (_name, failure, message, login) => {
    createReview.mockRejectedValue(failure)
    const page = await open()
    byId(page.root, 'review-rating-3').props.onChange()
    await setValue(byId(page.root, 'review-content'), ten)
    await submit(page.root)
    expect(text(byRole(form(page), 'alert')[0])).toContain(message)
    expect(byId(page.root, 'review-content').value).toBe(ten)
    expect(byId(page.root, 'review-rating-3').props.checked).toBe(true)
    expect(button(form(page), '리뷰 등록').props.disabled).toBe(false)
    const relogin = link(form(page), '새 탭에서 다시 로그인')
    if (login) expect(relogin.props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    else expect(relogin).toBeNull()
    expect(fetchProduct).toHaveBeenCalledTimes(1)
  })
})

describe('리뷰 영역: 내 리뷰 수정·삭제', () => {
  const mine = review(20, { rating: 4, content: ten, is_owner: true })
  beforeEach(() => {
    fetchCurrentUser.mockResolvedValue(member)
    fetchProductReviews.mockResolvedValue(reviewPage({ my_review: mine }))
  })
  const area = (page) => section(page.root, 'product-reviews-title')

  test('내 리뷰를 보여 주고, 수정하면 바뀐 필드만 보낸 뒤 영역과 평점 요약을 다시 부른다', async () => {
    updateReview.mockResolvedValue({ ...mine, rating: 2 })
    const page = await open()
    expect(text(area(page))).toContain(`내가 쓴 리뷰★★★★☆${ten}`)
    await click(button(area(page), '수정'))
    expect(text(find(area(page), (node) => node.type === 'form'))).toContain('리뷰 수정')
    expect(byId(page.root, 'review-content').value).toBe(ten)
    expect(byId(page.root, 'review-rating-4').props.checked).toBe(true)
    await submit(page.root)
    expect(updateReview).not.toHaveBeenCalled()
    expect(text(byRole(area(page), 'alert')[0])).toBe('바뀐 별점이나 내용이 없습니다. 고친 뒤 다시 저장해 주세요.')
    byId(page.root, 'review-rating-2').props.onChange()
    await submit(page.root)
    expect(updateReview).toHaveBeenCalledWith(3, 20, { rating: 2 })
    expect(fetchProductReviews).toHaveBeenLastCalledWith(3, { page: 1, pageSize: 10 })
    expect(fetchProduct).toHaveBeenCalledTimes(2)
    expect(text(byRole(area(page), 'status')[0])).toBe('리뷰가 수정되었습니다.')
  })

  test('수정을 취소하면 내 리뷰로 돌아간다', async () => {
    const page = await open()
    await click(button(area(page), '수정'))
    await click(button(area(page), '취소'))
    expect(find(area(page), (node) => node.type === 'form')).toBeNull()
    expect(text(area(page))).toContain('내가 쓴 리뷰')
  })

  test('삭제는 화면 안 확인을 거친다: 아니요면 그대로, 예면 지우고 영역과 평점 요약을 다시 부른다', async () => {
    const page = await open()
    await click(button(area(page), '삭제'))
    const confirm = () => stub(area(page), 'InlineConfirm')
    expect(confirm().props).toMatchObject({ message: '내 리뷰를 삭제할까요? 삭제한 리뷰는 되돌릴 수 없습니다.', busy: false })
    expect(button(area(page), '삭제')).toBeNull()
    confirm().props.onCancel()
    await flush()
    expect(confirm()).toBeNull()
    expect(deleteReview).not.toHaveBeenCalled()
    await click(button(area(page), '삭제'))
    const response = deferred()
    deleteReview.mockReturnValue(response.promise)
    confirm().props.onConfirm()
    confirm().props.onConfirm()
    await flush()
    expect(deleteReview).toHaveBeenCalledTimes(1)
    expect(deleteReview).toHaveBeenCalledWith(3, 20)
    expect(confirm().props.busy).toBe(true)
    fetchProductReviews.mockResolvedValue(reviewPage({ my_review: null, can_review: true }))
    response.resolve(null)
    await flush()
    expect(fetchProduct).toHaveBeenCalledTimes(2)
    expect(text(byRole(area(page), 'status')[0])).toBe('리뷰가 삭제되었습니다.')
    expect(text(area(page))).toContain('리뷰 작성')
  })

  test('삭제에 실패하면 문구를 보여 주고 확인 상자를 열어 둔다', async () => {
    deleteReview.mockRejectedValue({ response: { status: 403, data: { message: '본인이 작성한 리뷰만 수정하거나 삭제할 수 있습니다.' } } })
    const page = await open()
    await click(button(area(page), '삭제'))
    stub(area(page), 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(byRole(area(page), 'alert')[0])).toBe('본인이 작성한 리뷰만 수정하거나 삭제할 수 있습니다.')
    expect(stub(area(page), 'InlineConfirm').props.busy).toBe(false)
    expect(fetchProduct).toHaveBeenCalledTimes(1)
  })
})
