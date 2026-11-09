// 화면별 이벤트 심기(spec docs/specs/2026-10-30-event-logging.md 의 이벤트 표 37개. compatibility_check 는 2026-11-01 추가,
// 노출·클릭·체류·비교함·커뮤니티 11개는 docs/specs/2026-11-01-event-enrichment.md(schema_version 2),
// build_add_to_cart 와 signup 의 purpose 는 docs/specs/2026-11-01-build-id-purpose.md(schema_version 3),
// return_request·return_withdraw 는 docs/specs/2026-11-01-returns-refunds.md(schema_version 4)에서 추가).
// 화면에 track 을 jest.fn 으로 넘겨 언제(성공했을 때만)·어떤 type·어떤 props 를 남기는지 확인한다.
// 모든 테스트가 끝날 때 props 에 개인정보(이름·이메일·전화·주소·리뷰·질문·답변 본문)가 없고 계약 모양 그대로인지 확인한다.
import { jest } from '@jest/globals'
import { button, byId, click, compileSfc, deferred, find, flush, mount, setValue, stub, submit } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'
import { EVENT_TYPES, LOGOUT_FLUSH_TIMEOUT_MS, cleanProps, createTracker, isPersonalKey } from './stores/tracking.js'
import { createImpressionTracker as realImpressionTracker } from './stores/impressionTracker.js'
import { createDwellTracker as realDwellTracker } from './stores/dwellTracker.js'
import { compareItem } from './stores/compareViewModel.js'

const track = jest.fn()
const seenTypes = new Set()
const member = { id: 1, name: '김학습', email: 'learner@example.com' }
const REVIEW_TEXT = '조용하고 온도도 안정적입니다. 추천합니다.'
const QUESTION_TEXT = '사전 서명 URL 로 PUT 요청을 보내면 403 이 나옵니다.'
const ANSWER_TEXT = '버킷 CORS 설정을 확인해 보세요.'
const SHIPPING = { recipient: '김철수', phone: '010-1234-5678', address: '서울특별시 강남구 테헤란로 123' }
const PERSONAL_TEXT = [member.name, member.email, SHIPPING.recipient, SHIPPING.phone, SHIPPING.address, REVIEW_TEXT, QUESTION_TEXT, ANSWER_TEXT]

// 상품 상세의 추천 상품 영역: 추천 노출·클릭을 보지 않는 테스트는 빈 추천을 준다
const noRecommendations = async () => ({ product_id: 3, model: null, items: [] })
// 상품 상세의 관련 질문·목표가 알림은 이벤트가 없으니 빈 응답을 주고, 헤더 숫자·토스트는 가짜로 둔다(실제 요청·타이머 없이)
const detailExtras = () => ({
  fetchQuestions: async () => ({ items: [], total: 0, page: 1, page_size: 5 }),
  fetchAlerts: async () => ({ items: [] }),
  siteStatus: { setCartCount() {}, setCompareCount() {}, showToast() {} },
})
const events = (type) => track.mock.calls.filter(([name]) => name === type).map(([, props]) => props)
// 상품 목록 첫 화면의 보조 영역(가격 요약·하락 줄)과 헤더 상태(siteStatus)는 src/productView.test.mjs 가 본다. 여기서는 빈 값을 준다
const catalogExtras = () => ({
  fetchPriceSummary: async () => ({ product_count: 2, dropping_count: 0, lowest_1y_count: 0 }),
  fetchDropProducts: async () => ({ items: [], total: 0, page: 1, page_size: 10 }),
  siteStatus: { setCartCount() {}, setCompareCount() {}, showToast() {} },
})
const types = () => track.mock.calls.map(([name]) => name)

beforeEach(() => track.mockReset())
afterEach(() => {
  for (const [type, props = {}] of track.mock.calls) {
    seenTypes.add(type)
    expect(EVENT_TYPES).toContain(type)
    expect(Object.keys(props).filter(isPersonalKey)).toEqual([])
    const json = JSON.stringify(props)
    for (const value of PERSONAL_TEXT) expect(json).not.toContain(value)
    // 정리해도 그대로다 = 키·값이 서버 계약(키 형식, 20개, 문자열 200자, 기본값·배열) 안에 있다
    expect(cleanProps(props)).toEqual(props)
  }
  delete global.window
})
afterAll(() => expect([...seenTypes].sort()).toEqual([...EVENT_TYPES].sort()))

describe('App: page_view', () => {
  test.each([
    ['/products/3', 'product-detail'],
    ['/cart', 'cart'],
    ['/questions/7/edit', 'question-edit'],
    ['/admin/returns', 'admin-returns'],
    ['/admin/recommendations', 'admin-recommendations'],
    ['/', 'products'],
  ])('%s 를 열면 화면 이름(route=%s)으로 page_view 를 한 번 남긴다', async (pathname, route) => {
    global.window = { location: { pathname, search: '' } }
    const App = await compileSfc('App.vue', { track })
    mount(App)
    expect(track.mock.calls).toEqual([['page_view', { route }]])
  })
})

describe('상품 목록: product_list_view·search·filter_change', () => {
  const fetchProducts = jest.fn()
  const fetchProductFacets = jest.fn()
  const addCartItem = jest.fn()
  const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD' }
  const ssd = { ...gpu, id: 9, name: '990 PRO', category: 'storage' }
  let ProductCatalog

  function open(search = '') {
    global.window = { location: { search }, history: { pushState: jest.fn(), replaceState: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn(), scrollTo: jest.fn() }
    return mount(ProductCatalog)
  }

  beforeAll(async () => { ProductCatalog = await compileSfc('views/ProductCatalog.vue', { fetchProducts, fetchProductFacets, addCartItem, track, ...catalogExtras() }) })
  beforeEach(() => {
    fetchProducts.mockReset().mockResolvedValue({ items: [gpu, ssd], total: 45, page: 2, page_size: 20 })
    fetchProductFacets.mockReset().mockResolvedValue({ brands: [{ name: 'MSI', count: 4 }], price_min: 89000, price_max: 3890000 })
    addCartItem.mockReset()
  })

  test('목록을 받으면 요청 조건과 서버 응답(쪽·전체 개수·이번 쪽 상품 id)으로 product_list_view 를 남긴다', async () => {
    open('?category=gpu&brand=MSI&min_price=100000&max_price=900000&sort=price_asc&page=2&search=RTX')
    await flush()
    expect(events('product_list_view')).toEqual([{
      category: 'gpu', brand: 'MSI', min_price: 100000, max_price: 900000, dropping: null, near_low: null, store_lowest: null, sort: 'price_asc', page: 2, search: 'RTX', result_count: 45, product_ids: [3, 9],
      list_view_id: expect.any(String),
    }])
    expect(events('search')).toEqual([])
  })

  test('조건이 없으면 null 로 남기고, 실패하면 남기지 않는다', async () => {
    fetchProducts.mockRejectedValueOnce({ response: { status: 500 } })
    const page = open()
    await flush()
    expect(types()).toEqual([])
    await click(button(page.root, '다시 시도'))
    expect(events('product_list_view')).toEqual([{
      category: null, brand: null, min_price: null, max_price: null, dropping: null, near_low: null, store_lowest: null, sort: 'recommended', page: 2, search: null, result_count: 45, product_ids: [3, 9],
      list_view_id: expect.any(String),
    }])
  })

  test('검색어를 제출하면 결과를 받은 뒤 search(검색어·카테고리·결과 수)를 남긴다. 빈 검색어는 남기지 않는다', async () => {
    const page = open('?category=gpu')
    await flush()
    track.mockClear()
    stub(page.root, 'ProductSearchBar').props.onSearch('RTX 4070')
    await flush()
    expect(types()).toEqual(['product_list_view', 'search'])
    expect(events('search')).toEqual([{ search: 'RTX 4070', category: 'gpu', result_count: 45 }])
    track.mockClear()
    stub(page.root, 'ProductSearchBar').props.onSearch('')
    await flush()
    expect(types()).toEqual(['product_list_view'])
  })

  test('검색 요청이 실패해도 search 는 남기고 결과 수는 null 이다', async () => {
    const page = open()
    await flush()
    fetchProducts.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' })
    stub(page.root, 'ProductSearchBar').props.onSearch('DDR5')
    await flush()
    expect(events('search')).toEqual([{ search: 'DDR5', category: null, result_count: null }])
  })

  test('헤더 검색은 결과 수와 함께 기록하고 새로고침 시 다시 기록하지 않도록 주소를 정리한다', async () => {
    open('?search=RTX&search_action=submit')
    await flush()
    expect(events('search')).toEqual([{ search: 'RTX', category: null, result_count: 45 }])
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/products?search=RTX')
  })

  test('카테고리·정렬·브랜드·가격대를 바꾸면 filter_change(field, value)를 남긴다. 같은 값이면 남기지 않는다', async () => {
    const page = open()
    await flush()
    await click(button(page.root, '그래픽카드'))
    await click(button(page.root, '그래픽카드'))
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'value_desc' } })
    await flush()
    byId(page.root, 'product-brand').props.onChange({ target: { value: 'MSI' } })
    await flush()
    await setValue(byId(page.root, 'product-min-price'), '100,000')
    await submit(page.root)
    await click(button(page.root, '전체'))
    expect(events('filter_change')).toEqual([
      { field: 'category', value: 'gpu' },
      { field: 'sort', value: 'value_desc' },
      { field: 'brand', value: 'MSI' },
      { field: 'price', value: [100000, null] },
      { field: 'category', value: null },
    ])
  })

  test('필터 초기화는 걸려 있던 브랜드·가격대를 null 로 바꾼 것으로 남긴다', async () => {
    const page = open('?brand=MSI&max_price=500000')
    await flush()
    track.mockClear()
    await click(button(page.root, '필터 초기화'))
    expect(events('filter_change')).toEqual([{ field: 'brand', value: null }, { field: 'price', value: [null, null] }])
  })

  test('가격 추세 스위치는 filter_change(field 는 주소 이름, 켬 true·끔 null)를 남기고 product_list_view 에 켠 것은 true 로 싣는다', async () => {
    const page = open()
    await flush()
    track.mockClear()
    byId(page.root, 'filter-dropping').props.onChange({ target: { checked: true } })
    await flush()
    byId(page.root, 'filter-store-lowest').props.onChange({ target: { checked: true } })
    await flush()
    byId(page.root, 'filter-dropping').props.onChange({ target: { checked: false } })
    await flush()
    expect(events('filter_change')).toEqual([
      { field: 'dropping', value: true },
      { field: 'store_lowest', value: true },
      { field: 'dropping', value: null },
    ])
    expect(events('product_list_view').map(({ dropping, near_low, store_lowest }) => [dropping, near_low, store_lowest])).toEqual([
      [true, null, null], [true, null, true], [null, null, true],
    ])
    track.mockClear()
    await click(button(page.root, '필터 초기화'))
    expect(events('filter_change')).toEqual([{ field: 'store_lowest', value: null }])
  })

  test('카드의 담기는 성공했을 때만 add_to_cart(상품·수량 1·담기 응답의 가격)를 남긴다', async () => {
    addCartItem.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValue({ items: [{ product_id: 3, price_krw: 879000, quantity: 2 }], item_count: 2 })
    const page = open()
    await flush()
    track.mockClear()
    await stub(page.root, 'ProductGrid').props.onAddToCart(gpu)
    await flush()
    expect(types()).toEqual([])
    await stub(page.root, 'ProductGrid').props.onAddToCart(gpu)
    await flush()
    expect(track.mock.calls).toEqual([['add_to_cart', { product_id: 3, quantity: 1, price_krw: 879000 }]])
  })
})

// 노출·클릭·체류·비교함(spec docs/specs/2026-11-01-event-enrichment.md). 브라우저 객체(IntersectionObserver·타이머·시계·visibility·localStorage)는
// 실제 stores 모듈에 가짜를 넣어(compileSfc deps 로 감싼 함수) 화면이 어떤 값으로 부르는지 본다. 모듈 자체의 규칙은 src/impressionTracker.test.mjs·
// src/dwellTracker.test.mjs·src/compareViewModel.test.mjs 가 본다.
function fakeObservers() {
  const created = []
  return {
    supported: true,
    create(callback) {
      if (!this.supported) return null
      const observer = { callback, targets: new Set(), observe(element) { this.targets.add(element) }, unobserve(element) { this.targets.delete(element) }, disconnect() { this.targets.clear() } }
      created.push(observer)
      return observer
    },
    show(elements, ratio = 1) {
      for (const observer of created) {
        const entries = elements.filter((element) => observer.targets.has(element)).map((target) => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio }))
        if (entries.length) observer.callback(entries)
      }
    },
    reset() { created.length = 0; this.supported = true },
  }
}

function fakeTimers() {
  const timers = []
  return {
    schedule: (callback) => { const timer = { callback, cancelled: false }; timers.push(timer); return timer },
    cancel: (timer) => { timer.cancelled = true },
    run() { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback() },
    reset() { timers.length = 0 },
  }
}

function compareMemory(state = null) {
  let value = state ? JSON.stringify(state) : null
  return { available: true, get: () => value, set: (next) => { value = next; return true }, saved: () => JSON.parse(value) }
}

describe('상품 목록: product_impression·product_click(product_list_view 의 list_view_id)', () => {
  const fetchProducts = jest.fn()
  const fetchProductFacets = jest.fn()
  const io = fakeObservers()
  const timers = fakeTimers()
  const exits = []
  let views = 0
  let ProductCatalog
  const item = (id) => ({ id, name: `지포스 ${id}`, brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD' })

  function open(search = '') {
    global.window = { location: { search }, history: { pushState: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn(), scrollTo: jest.fn() }
    return mount(ProductCatalog)
  }
  const grid = (page) => stub(page.root, 'ProductGrid').props

  beforeAll(async () => {
    const createImpressionTracker = (options) => realImpressionTracker({
      ...options, createObserver: (callback) => io.create(callback), schedule: timers.schedule, cancel: timers.cancel, uuid: () => `list-view-${++views}`,
    })
    const onExit = (callback) => { exits.push(callback); return () => {} }
    ProductCatalog = await compileSfc('views/ProductCatalog.vue', { fetchProducts, fetchProductFacets, track, createImpressionTracker, onExit, browserCompareStorage: () => compareMemory(), ...catalogExtras() })
  })
  beforeEach(() => {
    io.reset()
    timers.reset()
    exits.length = 0
    fetchProducts.mockReset().mockResolvedValue({ items: [item(3), item(4)], total: 45, page: 2, page_size: 20 })
    fetchProductFacets.mockReset().mockResolvedValue({ brands: [], price_min: null, price_max: null })
  })

  test('보인 카드는 1초 모아 product_impression(목록 이벤트와 같은 list_view_id, 쪽을 넘어 이어지는 위치), 카드를 누르면 product_click. 비교 버튼은 클릭을 남기지 않는다', async () => {
    const page = open('?category=gpu&sort=price_asc&page=2')
    await flush()
    const [listView] = events('product_list_view')
    expect(listView.list_view_id).toMatch(/^list-view-\d+$/)
    const [first, second] = [{ card: 3 }, { card: 4 }]
    grid(page)['observe-item'](first, item(3), 0)
    grid(page)['observe-item'](second, item(4), 1)
    io.show([first, second])
    expect(events('product_impression')).toEqual([])
    timers.run()
    expect(events('product_impression')).toEqual([{
      list: 'catalog', list_view_id: listView.list_view_id, product_ids: [3, 4], positions: [21, 22], page: 2, sort: 'price_asc', category: 'gpu', search: null,
    }])
    grid(page).onToggleCompare(item(3))
    grid(page).onSelect(item(4), 1)
    expect(events('product_click')).toEqual([{ list: 'catalog', list_view_id: listView.list_view_id, product_id: 4, position: 22 }])
  })

  test('목록을 다시 부르면 새 list_view_id 로 다시 센다. 실패한 목록은 새 id 를 만들지 않는다', async () => {
    const page = open('?category=gpu')
    await flush()
    const element = { card: 3 }
    grid(page)['observe-item'](element, item(3), 0)
    io.show([element])
    fetchProducts.mockRejectedValueOnce({ response: { status: 500 } })
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'price_desc' } })
    await flush()
    expect(events('product_list_view')).toHaveLength(1)
    await click(button(page.root, '다시 시도'))
    const [before, after] = events('product_list_view').map((props) => props.list_view_id)
    expect(after).not.toBe(before)
    io.show([element])
    timers.run()
    expect(events('product_impression').map((props) => [props.list_view_id, props.sort])).toEqual([[before, 'recommended'], [after, 'price_desc']])
  })

  test('IntersectionObserver 가 없으면 노출을 보내지 않는다. 클릭은 남긴다', async () => {
    io.supported = false
    const page = open()
    await flush()
    const element = { card: 3 }
    grid(page)['observe-item'](element, item(3), 0)
    io.show([element])
    timers.run()
    grid(page).onSelect(item(3), 0)
    expect(events('product_impression')).toEqual([])
    expect(events('product_click')).toEqual([expect.objectContaining({ product_id: 3, position: 21 })])
  })

  test('페이지를 떠날 때(onExit) 1초를 기다리던 노출을 보낸다', async () => {
    const page = open()
    await flush()
    const element = { card: 4 }
    grid(page)['observe-item'](element, item(4), 1)
    io.show([element])
    exits.forEach((callback) => callback('leave'))
    expect(events('product_impression')).toEqual([expect.objectContaining({ product_ids: [4], positions: [22] })])
  })
})

describe('상품 상세: product_dwell', () => {
  const detail = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD', specs: [], review_count: 0, rating_average: null }
  const fetchProduct = jest.fn()
  const fetchPriceHistory = jest.fn()
  const fetchProductReviews = jest.fn()
  const fetchCurrentUser = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  const exits = []
  const doc = { visibilityState: 'visible', listeners: new Set(), addEventListener(name, listener) { this.listeners.add(listener) }, removeEventListener(name, listener) { this.listeners.delete(listener) } }
  let clock = 0
  let ProductDetail
  const exit = (reason) => exits.forEach((callback) => callback(reason))
  const setVisibility = (state) => { doc.visibilityState = state; doc.listeners.forEach((listener) => listener()) }

  beforeAll(async () => {
    const createDwellTracker = (options) => realDwellTracker({ ...options, now: () => clock, doc, uuid: () => 'view-0001' })
    const onExit = (callback) => { exits.push(callback); return () => exits.splice(exits.indexOf(callback), 1) }
    ProductDetail = await compileSfc('views/ProductDetail.vue', { fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations: noRecommendations, authSession, track, createDwellTracker, onExit, browserCompareStorage: () => compareMemory(), ...detailExtras() })
  })
  beforeEach(() => {
    exits.length = 0
    doc.listeners.clear()
    doc.visibilityState = 'visible'
    clock = Date.parse('2026-11-01T01:00:00Z')
    for (const mock of [fetchProduct, fetchPriceHistory, fetchProductReviews, fetchCurrentUser]) mock.mockReset()
    fetchProduct.mockResolvedValue(detail)
    fetchPriceHistory.mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    fetchProductReviews.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: {}, my_review: null, can_review: false })
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    authSession.reset()
  })

  test('상품을 받은 뒤 재기 시작해 숨김·떠남마다 구간을 남긴다(숨긴 동안은 세지 않는다)', async () => {
    mount(ProductDetail, { productId: 3 })
    await flush()
    clock += 12_000
    setVisibility('hidden')
    exit('hidden')
    clock += 300_000
    setVisibility('visible')
    clock += 4_000
    exit('leave')
    expect(events('product_dwell')).toEqual([
      { product_id: 3, view_id: 'view-0001', dwell_ms: 12000, reason: 'hidden' },
      { product_id: 3, view_id: 'view-0001', dwell_ms: 4000, reason: 'leave' },
    ])
  })

  test('없는 상품(404)이면 재지 않는다. 화면을 떠나면(unmount) 지금 구간을 leave 로 남긴다', async () => {
    fetchProduct.mockRejectedValueOnce({ response: { status: 404 } })
    mount(ProductDetail, { productId: 3 })
    await flush()
    expect(exits).toHaveLength(0)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    clock += 2500
    page.unmount()
    expect(events('product_dwell')).toEqual([{ product_id: 3, view_id: 'view-0001', dwell_ms: 2500, reason: 'leave' }])
    expect(exits).toHaveLength(0)
  })
})

// spec docs/specs/2026-11-03-product-recommendations.md "이벤트"(schema_version 5): 상품 상세 추천 칸의 노출·클릭은 목록과 같은 추적기(list 'recommendation')이고
// 추천을 받을 때마다 새 list_view_id, page 1, sort·category·search null, 보고 있는 상품(source_product_id)·모델 버전(model_version, 기본 추천이면 null)을 싣는다
describe('상품 상세 추천: product_impression·product_click(list recommendation)', () => {
  const detail = { id: 1, name: '라이젠5 5600', brand: 'AMD', category: 'cpu', price_krw: 149600, stock: 9, thumbnail_url: '', summary: '6코어', specs: [], review_count: 0, rating_average: null }
  const rec = (id, rank, reason = 'similar') => ({ rank, reason, id, name: `라이젠 ${id}`, brand: 'AMD', category: 'cpu', price_krw: 176400, stock: 11, thumbnail_url: '', summary: '8코어' })
  const trained = { product_id: 1, model: { version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' }, items: [rec(3, 1, 'co_view'), rec(28, 2), rec(8, 3)] }
  const fetchProduct = jest.fn()
  const fetchProductRecommendations = jest.fn()
  const io = fakeObservers()
  const timers = fakeTimers()
  const exits = []
  let views = 0
  let ProductDetail
  const area = (page) => stub(page.root, 'ProductRecommendations').props

  beforeAll(async () => {
    const createImpressionTracker = (options) => realImpressionTracker({
      ...options, createObserver: (callback) => io.create(callback), schedule: timers.schedule, cancel: timers.cancel, uuid: () => `list-view-${++views}`,
    })
    const onExit = (callback) => { exits.push(callback); return () => exits.splice(exits.indexOf(callback), 1) }
    ProductDetail = await compileSfc('views/ProductDetail.vue', {
      fetchProduct, fetchProductRecommendations, fetchPriceHistory: jest.fn().mockResolvedValue({ items: [] }), fetchProductReviews: jest.fn().mockResolvedValue(null), ...detailExtras(),
      authSession: createAuthSession({ fetchCurrentUser: jest.fn().mockRejectedValue({ response: { status: 401 } }) }),
      track, createImpressionTracker, onExit, createDwellTracker: () => ({ stop() {} }), browserCompareStorage: () => compareMemory(),
    })
  })
  beforeEach(() => {
    io.reset()
    timers.reset()
    exits.length = 0
    views = 0
    fetchProduct.mockReset().mockResolvedValue(detail)
    fetchProductRecommendations.mockReset().mockResolvedValue(trained)
  })

  test('보인 추천 카드는 1초 모아 product_impression(위치 1부터, source_product_id·model_version), 카드를 누르면 같은 list_view_id 로 product_click', async () => {
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    const [first, second] = [{ card: 3 }, { card: 28 }]
    area(page)['observe-item'](first, trained.items[0], 0)
    area(page)['observe-item'](second, trained.items[1], 1)
    io.show([first, second])
    expect(events('product_impression')).toEqual([])
    timers.run()
    expect(events('product_impression')).toEqual([{
      list: 'recommendation', list_view_id: 'list-view-1', product_ids: [3, 28], positions: [1, 2], page: 1, sort: null, category: null, search: null,
      source_product_id: 1, model_version: 'itemcf-4',
    }])
    area(page).onSelect(trained.items[1], 1)
    expect(events('product_click')).toEqual([{ list: 'recommendation', list_view_id: 'list-view-1', product_id: 28, position: 2, source_product_id: 1, model_version: 'itemcf-4' }])
  })

  test('기본 추천(model null)은 model_version null. 다시 받으면(다시 시도) 새 list_view_id, 실패한 요청은 새 id 를 만들지 않는다', async () => {
    fetchProductRecommendations.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ ...trained, model: null })
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(exits).toHaveLength(0)
    await area(page).onRetry()
    await flush()
    const element = { card: 3 }
    area(page)['observe-item'](element, trained.items[0], 0)
    area(page).onSelect(trained.items[0], 0)
    expect(events('product_impression')).toEqual([expect.objectContaining({ list: 'recommendation', list_view_id: 'list-view-1', product_ids: [3], positions: [1], model_version: null, source_product_id: 1 })])
    expect(events('product_click')).toEqual([{ list: 'recommendation', list_view_id: 'list-view-1', product_id: 3, position: 1, source_product_id: 1, model_version: null }])
  })

  test('페이지를 떠날 때(onExit) 1초를 기다리던 추천 노출을 보내고, 화면을 떠나면(unmount) 등록을 푼다. 추천 노출은 상품 목록 노출과 섞이지 않는다', async () => {
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    const element = { card: 8 }
    area(page)['observe-item'](element, trained.items[2], 2)
    io.show([element])
    exits.forEach((callback) => callback('leave'))
    expect(events('product_impression')).toEqual([expect.objectContaining({ list: 'recommendation', product_ids: [8], positions: [3], model_version: 'itemcf-4' })])
    expect(events('product_click')).toEqual([])
    page.unmount()
    expect(exits).toHaveLength(0)
  })

  test('추천을 받기 전에 실패하면(500) 노출·클릭이 없다', async () => {
    fetchProductRecommendations.mockRejectedValue({ response: { status: 500 } })
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(area(page).state).toBe('error')
    timers.run()
    expect(events('product_impression')).toEqual([])
    expect(events('product_click')).toEqual([])
  })
})

describe('비교함: compare_add·compare_remove·compare_clear·compare_view', () => {
  const gpu = (id) => ({ id, name: `지포스 ${id}`, brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD', specs: [], review_count: 0, rating_average: null })
  const cpu = (id) => ({ ...gpu(id), name: `라이젠 ${id}`, category: 'cpu' })
  const fetchProducts = jest.fn()
  const fetchProductFacets = jest.fn()
  const fetchProduct = jest.fn()
  let storage
  let ProductCatalog
  let ProductDetail
  let ProductCompare

  beforeAll(async () => {
    const browserCompareStorage = () => storage
    ProductCatalog = await compileSfc('views/ProductCatalog.vue', { fetchProducts, fetchProductFacets, track, browserCompareStorage, ...catalogExtras() })
    ProductDetail = await compileSfc('views/ProductDetail.vue', {
      fetchProduct, fetchPriceHistory: jest.fn().mockResolvedValue({ items: [] }), fetchProductReviews: jest.fn().mockResolvedValue(null), fetchProductRecommendations: noRecommendations, ...detailExtras(),
      authSession: createAuthSession({ fetchCurrentUser: jest.fn().mockRejectedValue({ response: { status: 401 } }) }), track, browserCompareStorage,
    })
    ProductCompare = await compileSfc('views/ProductCompare.vue', { fetchProduct, track, browserCompareStorage })
  })
  beforeEach(() => {
    storage = compareMemory()
    fetchProducts.mockReset().mockResolvedValue({ items: [gpu(3), gpu(4), cpu(9)], total: 3, page: 1, page_size: 20 })
    fetchProductFacets.mockReset().mockResolvedValue({ brands: [], price_min: null, price_max: null })
    fetchProduct.mockReset().mockImplementation((id) => (id === 404 ? Promise.reject({ response: { status: 404 } }) : Promise.resolve(id === 9 ? cpu(9) : gpu(id))))
    global.window = { location: { search: '' }, history: { pushState: jest.fn(), replaceState: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn(), scrollTo: jest.fn() }
  })

  test('상품 목록: 비교 토글로 담기·빼기(source catalog), 막대에서 빼기(bar), 다른 카테고리 "비우고 담기"(compare_clear category_change → compare_add), 비우기(user)', async () => {
    const page = mount(ProductCatalog)
    await flush()
    track.mockClear()
    const grid = () => stub(page.root, 'ProductGrid').props
    const bar = () => stub(page.root, 'ProductCompareBar').props
    grid().onToggleCompare(gpu(3))
    grid().onToggleCompare(gpu(4))
    grid().onToggleCompare(gpu(3))
    await flush()
    bar().onRemove(4)
    grid().onToggleCompare(gpu(3))
    grid().onToggleCompare(cpu(9))
    await flush()
    bar().onReplace()
    await flush()
    bar().onClear()
    expect(track.mock.calls).toEqual([
      ['compare_add', { product_id: 3, category: 'gpu', count: 1, source: 'catalog' }],
      ['compare_add', { product_id: 4, category: 'gpu', count: 2, source: 'catalog' }],
      ['compare_remove', { product_id: 3, category: 'gpu', count: 1, source: 'catalog', reason: 'user' }],
      ['compare_remove', { product_id: 4, category: 'gpu', count: 0, source: 'bar', reason: 'user' }],
      ['compare_add', { product_id: 3, category: 'gpu', count: 1, source: 'catalog' }],
      ['compare_clear', { category: 'gpu', product_ids: [3], reason: 'category_change' }],
      ['compare_add', { product_id: 9, category: 'cpu', count: 1, source: 'catalog' }],
      ['compare_clear', { category: 'cpu', product_ids: [9], reason: 'user' }],
    ])
  })

  test('상품 상세: 비교함에 담기·빼기는 source detail', async () => {
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    track.mockClear()
    await click(button(page.root, '비교함에 담기'))
    await click(button(page.root, '비교함에서 빼기'))
    expect(track.mock.calls).toEqual([
      ['compare_add', { product_id: 3, category: 'gpu', count: 1, source: 'detail' }],
      ['compare_remove', { product_id: 3, category: 'gpu', count: 0, source: 'detail', reason: 'user' }],
    ])
  })

  test('비교 화면: 404 상품은 compare_remove(unavailable, compare), 받은 뒤 compare_view 한 번, 표에서 빼기는 source compare', async () => {
    storage = compareMemory({ category: 'gpu', items: [gpu(3), gpu(404), gpu(4)].map(compareItem) })
    const page = mount(ProductCompare)
    await flush()
    expect(track.mock.calls).toEqual([
      ['compare_remove', { product_id: 404, category: 'gpu', count: 2, source: 'compare', reason: 'unavailable' }],
      ['compare_view', { category: 'gpu', product_ids: [3, 4], count: 2 }],
    ])
    const before = track.mock.calls.length
    await click(find(page.root, (node) => node.type === 'button' && node.props['aria-label'] === '지포스 4 비교함에서 빼기'))
    expect(track.mock.calls.slice(before)).toEqual([['compare_remove', { product_id: 4, category: 'gpu', count: 1, source: 'compare', reason: 'user' }]])
  })

  test('비교 화면: 불러오기에 실패하면 compare_view 를 남기지 않는다', async () => {
    storage = compareMemory({ category: 'gpu', items: [gpu(3)].map(compareItem) })
    fetchProduct.mockRejectedValue({ response: { status: 500 } })
    mount(ProductCompare)
    await flush()
    expect(types()).toEqual([])
  })
})

describe('상품 상세: product_view·price_history_view·review_list_view·add_to_cart·buy_now·review_submit', () => {
  const detail = {
    id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용',
    description: '설명', specs: [], released_on: '2026-09-12', performance_score: 24500, value_score: 272.52, is_new: true, rating_average: 4.5, review_count: 12, lowest_price_90d: 879000,
  }
  const history = { items: [{ price_krw: 949000, source: 'store', recorded_at: '2026-08-01T00:00:00Z' }, { price_krw: 879000, source: 'coupang', recorded_at: '2026-09-18T00:00:00Z' }], lowest_price_krw: 879000, highest_price_krw: 949000 }
  const review = (id, extra = {}) => ({ id, product_id: 3, author: { id: String(id), name: member.name }, rating: 5, content: REVIEW_TEXT, created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', is_owner: false, ...extra })
  const reviewPage = (extra = {}) => ({ items: [review(1)], total: 12, page: 1, page_size: 10, rating_average: 4.5, rating_counts: { 1: 0, 2: 0, 3: 1, 4: 4, 5: 7 }, my_review: null, can_review: false, ...extra })
  const fetchProduct = jest.fn()
  const fetchPriceHistory = jest.fn()
  const fetchProductReviews = jest.fn()
  const fetchCurrentUser = jest.fn()
  const createReview = jest.fn()
  const updateReview = jest.fn()
  const deleteReview = jest.fn()
  const addCartItem = jest.fn()
  const goToCheckout = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let ProductDetail

  async function open() {
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    return page
  }
  const card = (page) => stub(page.root, 'ProductPurchaseCard').props
  const reviews = (page) => find(page.root, (node) => node.type === 'section' && node.props['aria-labelledby'] === 'product-reviews-title')

  beforeAll(async () => {
    ProductDetail = await compileSfc('views/ProductDetail.vue', { fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations: noRecommendations, authSession, createReview, updateReview, deleteReview, addCartItem, goToCheckout, track, ...detailExtras() })
  })
  beforeEach(() => {
    for (const mock of [fetchProduct, fetchPriceHistory, fetchProductReviews, fetchCurrentUser, createReview, updateReview, deleteReview, addCartItem, goToCheckout]) mock.mockReset()
    fetchProduct.mockResolvedValue(detail)
    fetchPriceHistory.mockResolvedValue(history)
    fetchProductReviews.mockResolvedValue(reviewPage())
    fetchCurrentUser.mockResolvedValue(member)
    authSession.reset()
  })

  test('상세·가격 이력·리뷰 쪽을 받으면 서버 값으로 남긴다(이름·설명·리뷰 본문은 넣지 않는다)', async () => {
    await open()
    expect(events('product_view')).toEqual([{
      product_id: 3, category: 'gpu', brand: 'MSI', price_krw: 899000, stock: 7, is_new: true,
      performance_score: 24500, value_score: 272.52, rating_average: 4.5, review_count: 12,
    }])
    expect(events('price_history_view')).toEqual([{ product_id: 3, points: 2, lowest_price_krw: 879000, highest_price_krw: 949000 }])
    expect(events('review_list_view')).toEqual([{ product_id: 3, page: 1, total: 12, rating_average: 4.5 }])
  })

  test('없는 상품(404)·영역 실패는 남기지 않는다', async () => {
    fetchProduct.mockRejectedValueOnce({ response: { status: 404 } })
    await open()
    expect(types()).toEqual([])
    fetchPriceHistory.mockRejectedValueOnce({ response: { status: 500 } })
    fetchProductReviews.mockRejectedValueOnce({ response: { status: 500 } })
    await open()
    expect(types()).toEqual(['product_view'])
  })

  test('담기에 성공하면 add_to_cart(담은 수량, 응답의 가격), 실패하면 남기지 않는다', async () => {
    addCartItem.mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ items: [{ product_id: 3, quantity: 3, price_krw: 889000 }], item_count: 3, total_krw: 2667000 })
    const page = await open()
    card(page)['onUpdate:quantity'](2)
    await card(page).onAddToCart()
    await flush()
    expect(events('add_to_cart')).toEqual([])
    await card(page).onAddToCart()
    await flush()
    expect(events('add_to_cart')).toEqual([{ product_id: 3, quantity: 2, price_krw: 889000 }])
  })

  test('바로 구매를 누르면 이동하기 전에 buy_now(상품·수량·서버 가격)를 남긴다', async () => {
    const page = await open()
    card(page)['onUpdate:quantity'](3)
    card(page).onBuyNow()
    expect(events('buy_now')).toEqual([{ product_id: 3, quantity: 3, price_krw: 899000 }])
    expect(goToCheckout).toHaveBeenCalledWith({ productId: 3, quantity: 3 })
  })

  test('리뷰 등록에 성공하면 review_submit(create, 별점). 본문은 넣지 않는다', async () => {
    fetchProductReviews.mockResolvedValue(reviewPage({ can_review: true }))
    createReview.mockResolvedValue(review(30, { rating: 4, is_owner: true }))
    const page = await open()
    byId(page.root, 'review-rating-4').props.onChange()
    await setValue(byId(page.root, 'review-content'), REVIEW_TEXT)
    await submit(reviews(page))
    expect(createReview).toHaveBeenCalledWith(3, { rating: 4, content: REVIEW_TEXT })
    expect(events('review_submit')).toEqual([{ product_id: 3, action: 'create', rating: 4 }])
  })

  test('내 리뷰 수정·삭제에 성공하면 review_submit(update·delete)', async () => {
    const mine = review(20, { rating: 4, is_owner: true })
    fetchProductReviews.mockResolvedValue(reviewPage({ my_review: mine }))
    updateReview.mockResolvedValue({ ...mine, rating: 2 })
    deleteReview.mockResolvedValue(null)
    const page = await open()
    await click(button(reviews(page), '수정'))
    byId(page.root, 'review-rating-2').props.onChange()
    await submit(reviews(page))
    await click(button(reviews(page), '삭제'))
    await stub(reviews(page), 'InlineConfirm').props.onConfirm()
    await flush()
    expect(events('review_submit')).toEqual([{ product_id: 3, action: 'update', rating: 2 }, { product_id: 3, action: 'delete', rating: 4 }])
  })
})

describe('장바구니: cart_view·cart_update·cart_remove', () => {
  const gpu = { product_id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }
  const psu = { product_id: 12, name: 'FOCUS GX-850', brand: 'Seasonic', category: 'psu', thumbnail_url: '', price_krw: 189000, stock: 4, quantity: 1, subtotal_krw: 189000 }
  const cart = { items: [gpu, psu], item_count: 3, total_krw: 1987000 }
  const fetchCart = jest.fn()
  const updateCartItem = jest.fn()
  const removeCartItem = jest.fn()
  const checkCompatibility = jest.fn().mockResolvedValue({ status: 'ok', issues: [], balance: null, power: { estimated_w: 385, psu_w: 850 }, categories: ['gpu', 'psu'] })
  let CartPage
  const quantitySelect = (page, id) => find(page.root, (node) => node.props.id === `cart-quantity-${id}`).props
  const removeButton = (page, index) => page.root && [...findButtons(page.root)][index]
  function* findButtons(node) {
    if (node.type === 'button' && String(node.props.class || '').includes('cart-item__remove')) yield node
    for (const child of node.children) yield* findButtons(child)
  }

  beforeAll(async () => { CartPage = await compileSfc('views/CartPage.vue', { fetchCart, updateCartItem, removeCartItem, checkCompatibility, track }) })
  beforeEach(() => {
    fetchCart.mockReset().mockResolvedValue(cart)
    updateCartItem.mockReset()
    removeCartItem.mockReset()
  })

  test('장바구니를 받으면 cart_view(서버의 수량 합계·금액·상품 id)', async () => {
    mount(CartPage)
    await flush()
    expect(events('cart_view')).toEqual([{ item_count: 3, total_krw: 1987000, product_ids: [3, 12] }])
  })

  test('상품이 20종을 넘어도 product_ids 는 20개까지만(서버 배열 제한)', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ ...gpu, product_id: index + 1, quantity: 1 }))
    fetchCart.mockResolvedValue({ items, item_count: 25, total_krw: 22475000 })
    mount(CartPage)
    await flush()
    expect(events('cart_view')).toEqual([{ item_count: 25, total_krw: 22475000, product_ids: items.slice(0, 20).map((item) => item.product_id) }])
  })

  test('비로그인(401)이면 남기지 않는다', async () => {
    fetchCart.mockRejectedValue({ response: { status: 401 } })
    mount(CartPage)
    await flush()
    expect(types()).toEqual([])
  })

  test('수량 변경에 성공하면 cart_update(이전 수량 → 응답의 수량), 실패하면 남기지 않는다', async () => {
    updateCartItem.mockRejectedValueOnce({ response: { status: 409, data: { message: '재고가 부족합니다.' } } })
      .mockResolvedValueOnce({ items: [{ ...gpu, quantity: 3, subtotal_krw: 2697000 }, psu], item_count: 4, total_krw: 2886000 })
    const page = mount(CartPage)
    await flush()
    await quantitySelect(page, 3)['onUpdate:modelValue'](5)
    await flush()
    expect(events('cart_update')).toEqual([])
    await quantitySelect(page, 3)['onUpdate:modelValue'](3)
    await flush()
    expect(events('cart_update')).toEqual([{ product_id: 3, from_quantity: 2, to_quantity: 3 }])
  })

  test('삭제에 성공하면 cart_remove(상품·지운 수량)', async () => {
    removeCartItem.mockResolvedValue({ items: [psu], item_count: 1, total_krw: 189000 })
    const page = mount(CartPage)
    await flush()
    await removeButton(page, 0).props.onClick()
    await flush()
    expect(events('cart_remove')).toEqual([{ product_id: 3, quantity: 2 }])
  })
})

describe('부품 호환성: compatibility_check', () => {
  // spec docs/specs/2026-11-01-compatibility-rules.md "이벤트". 화면별 자세한 경우(같은 구성 한 번, 견적 보내기, 견적 카드 제외)는 src/compatibilityView.test.mjs
  const cpu = { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 1, subtotal_krw: 739000 }
  const board = { product_id: 60, name: 'TUF Gaming B650-PLUS WIFI', brand: 'ASUS', category: 'mainboard', thumbnail_url: '', price_krw: 289000, stock: 8, quantity: 1, subtotal_krw: 289000 }
  const result = {
    status: 'error',
    issues: [
      { code: 'SOCKET_MISMATCH', level: 'error', message: 'CPU(AM5)와 메인보드(LGA1700)의 소켓이 다릅니다.', product_ids: [1, 60] },
      { code: 'NO_CPU_COOLER', level: 'warning', message: 'CPU 에 기본 쿨러가 없어 쿨러가 따로 필요합니다.', product_ids: [1] },
    ],
    balance: null,
    power: { estimated_w: 220, psu_w: null },
    categories: ['cpu', 'mainboard'],
  }
  const fetchCart = jest.fn()
  const checkCompatibility = jest.fn()
  let CartPage

  beforeAll(async () => { CartPage = await compileSfc('views/CartPage.vue', { fetchCart, updateCartItem: jest.fn(), removeCartItem: jest.fn(), checkCompatibility, track }) })
  beforeEach(() => {
    fetchCart.mockReset().mockResolvedValue({ items: [cpu, board], item_count: 2, total_krw: 1028000 })
    checkCompatibility.mockReset()
  })

  test('장바구니에서 호환성 결과를 보여 준 뒤 compatibility_check(context·status·수준별 코드·균형·전력·상품 id)', async () => {
    checkCompatibility.mockResolvedValue(result)
    mount(CartPage)
    await flush()
    expect(events('compatibility_check')).toEqual([{
      context: 'cart', status: 'error', error_codes: ['SOCKET_MISMATCH'], warning_codes: ['NO_CPU_COOLER'], balance_score: null, estimated_w: 220, psu_w: null, product_ids: [1, 60],
    }])
  })

  test('확인이 실패하면 남기지 않는다', async () => {
    checkCompatibility.mockRejectedValue({ response: { status: 500 } })
    mount(CartPage)
    await flush()
    expect(events('compatibility_check')).toEqual([])
  })
})

describe('주문서·결제: checkout_view·payment_start·payment_result', () => {
  const gpu = { product_id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }
  const cart = { items: [gpu], item_count: 2, total_krw: 1798000 }
  const product = { id: 3, name: gpu.name, brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '' }
  const paymentRequest = { payment_id: 'order-7f3a9c2e', order_name: gpu.name, total_amount: 1798000, currency: 'KRW', store_id: 'store-test', channel_key: 'channel-key-test', status: 'READY' }
  const paidOrder = { payment_id: 'order-7f3a9c2e', status: 'PAID', total_krw: 1798000, item_count: 2 }
  const fill = { 'shipping-recipient': SHIPPING.recipient, 'shipping-phone': SHIPPING.phone, 'shipping-postal-code': '06236', 'shipping-address1': SHIPPING.address }
  const fetchCart = jest.fn()
  const fetchProduct = jest.fn()
  const fetchCurrentUser = jest.fn()
  const createOrder = jest.fn()
  const launchPortOnePayment = jest.fn()
  const confirmOrder = jest.fn()
  const goToOrder = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let CheckoutPage

  async function openFilled(search = '') {
    global.window = { location: { search } }
    const page = mount(CheckoutPage)
    await flush()
    for (const [id, value] of Object.entries(fill)) await setValue(byId(page.root, id), value)
    return page
  }

  beforeAll(async () => {
    CheckoutPage = await compileSfc('views/CheckoutPage.vue', { fetchCart, fetchProduct, authSession, createOrder, launchPortOnePayment, confirmOrder, goToOrder, track })
  })
  beforeEach(() => {
    for (const mock of [fetchCart, fetchProduct, fetchCurrentUser, createOrder, launchPortOnePayment, confirmOrder, goToOrder]) mock.mockReset()
    fetchCart.mockResolvedValue(cart)
    fetchProduct.mockResolvedValue(product)
    fetchCurrentUser.mockResolvedValue(member)
    createOrder.mockResolvedValue(paymentRequest)
    authSession.reset()
  })

  test.each([
    ['장바구니', '', { source: 'cart', item_count: 2, total_krw: 1798000, product_ids: [3] }],
    ['바로 구매', '?product=3&quantity=2', { source: 'buy_now', item_count: 2, total_krw: 1798000, product_ids: [3] }],
  ])('%s 주문서를 받으면 checkout_view', async (_name, search, props) => {
    await openFilled(search)
    expect(events('checkout_view')).toEqual([props])
  })

  test('결제창을 열기 직전 payment_start, 결제 확인에 성공하면 payment_result(paid). 배송지는 넣지 않는다', async () => {
    launchPortOnePayment.mockImplementation(async () => {
      expect(events('payment_start')).toEqual([{ payment_id: 'order-7f3a9c2e', total_amount: 1798000, item_count: 2 }])
      return { paymentId: 'order-7f3a9c2e' }
    })
    confirmOrder.mockResolvedValue(paidOrder)
    const page = await openFilled()
    await submit(page.root)
    expect(types()).toEqual(['checkout_view', 'payment_start', 'payment_result'])
    expect(events('payment_result')).toEqual([{ payment_id: 'order-7f3a9c2e', result: 'paid' }])
  })

  test.each([
    ['사용자가 닫음', { code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소하였습니다.' }, { payment_id: 'order-7f3a9c2e', result: 'cancelled', error_code: 'FAILURE_TYPE_PG' }],
    ['카드 거절', { code: 'FAILURE_TYPE_PG', message: '카드 한도 초과' }, { payment_id: 'order-7f3a9c2e', result: 'failed', error_code: 'FAILURE_TYPE_PG' }],
  ])('결제창이 code 를 돌려주면(%s) payment_result 를 남기고 확인하지 않는다', async (_name, response, props) => {
    launchPortOnePayment.mockResolvedValue(response)
    const page = await openFilled()
    await submit(page.root)
    expect(events('payment_result')).toEqual([props])
    expect(confirmOrder).not.toHaveBeenCalled()
  })

  test('결제창을 열지 못하면 payment_result(failed)', async () => {
    launchPortOnePayment.mockRejectedValue(new Error('sdk'))
    const page = await openFilled()
    await submit(page.root)
    expect(events('payment_result')).toEqual([{ payment_id: 'order-7f3a9c2e', result: 'failed' }])
  })

  test('결제 확인이 실패하면 payment_result(failed, HTTP 상태·오류 코드). 확인 다시 시도가 성공하면 paid', async () => {
    launchPortOnePayment.mockResolvedValue({ paymentId: 'order-7f3a9c2e' })
    confirmOrder.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 502, data: { message: '포트원 오류' } } }).mockResolvedValueOnce(paidOrder)
    const page = await openFilled()
    await submit(page.root)
    await click(button(page.root, '결제 확인 다시 시도'))
    expect(events('payment_result')).toEqual([
      { payment_id: 'order-7f3a9c2e', result: 'failed', status: 502, error_code: 'ERR_BAD_RESPONSE' },
      { payment_id: 'order-7f3a9c2e', result: 'paid' },
    ])
  })

  describe('모의 결제(provider mock): 결제창 없이 확인해도 이벤트 모양은 같다', () => {
    const mockPaymentRequest = { ...paymentRequest, store_id: '', channel_key: '', provider: 'mock' }

    test('확인 직전 payment_start, 확인에 성공하면 payment_result(paid). PortOne 결제창은 열지 않는다', async () => {
      createOrder.mockResolvedValue(mockPaymentRequest)
      confirmOrder.mockImplementation(async () => {
        expect(events('payment_start')).toEqual([{ payment_id: 'order-7f3a9c2e', total_amount: 1798000, item_count: 2 }])
        return paidOrder
      })
      const page = await openFilled()
      await submit(page.root)
      expect(launchPortOnePayment).not.toHaveBeenCalled()
      expect(types()).toEqual(['checkout_view', 'payment_start', 'payment_result'])
      expect(events('payment_result')).toEqual([{ payment_id: 'order-7f3a9c2e', result: 'paid' }])
    })

    test('확인이 실패하면 payment_result(failed, HTTP 상태·오류 코드). 확인 다시 시도가 성공하면 paid', async () => {
      createOrder.mockResolvedValue(mockPaymentRequest)
      confirmOrder.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 502, data: { message: '결제 확인 오류' } } }).mockResolvedValueOnce(paidOrder)
      const page = await openFilled()
      await submit(page.root)
      await click(button(page.root, '결제 확인 다시 시도'))
      expect(launchPortOnePayment).not.toHaveBeenCalled()
      expect(events('payment_start')).toHaveLength(1)
      expect(events('payment_result')).toEqual([
        { payment_id: 'order-7f3a9c2e', result: 'failed', status: 502, error_code: 'ERR_BAD_RESPONSE' },
        { payment_id: 'order-7f3a9c2e', result: 'paid' },
      ])
    })

    test('재고 부족(409)으로 취소되면 payment_result(failed, 409)', async () => {
      createOrder.mockResolvedValue(mockPaymentRequest)
      confirmOrder.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족해 주문을 취소했습니다.' } } })
      const page = await openFilled()
      await submit(page.root)
      expect(types()).toEqual(['checkout_view', 'payment_start', 'payment_result'])
      expect(events('payment_result')).toEqual([{ payment_id: 'order-7f3a9c2e', result: 'failed', status: 409 }])
    })
  })

  test('주문 만들기(POST /orders)가 실패하면 결제 이벤트를 남기지 않는다', async () => {
    createOrder.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족합니다.' } } })
    const page = await openFilled()
    await submit(page.root)
    expect(types()).toEqual(['checkout_view'])
  })
})

describe('결제 완료(모바일 redirect)·주문 상세: payment_result·order_view', () => {
  const paymentId = 'order-7f3a9c2e'
  const order = { payment_id: paymentId, order_name: '지포스 외 1건', status: 'PAID', total_krw: 1987000, item_count: 3, thumbnail_url: '', created_at: '2026-10-30T01:12:00Z', paid_at: '2026-10-30T01:13:00Z', cancelled_at: null, items: [], shipping: { recipient_name: SHIPPING.recipient, phone: SHIPPING.phone, postal_code: '06236', address1: SHIPPING.address, address2: '', delivery_memo: '' } }
  const confirmOrder = jest.fn()
  const fetchOrder = jest.fn()
  let PaymentComplete
  let OrderDetail

  beforeAll(async () => {
    PaymentComplete = await compileSfc('views/PaymentComplete.vue', { confirmOrder, track })
    OrderDetail = await compileSfc('views/OrderDetail.vue', { fetchOrder, confirmOrder, track })
  })
  beforeEach(() => { confirmOrder.mockReset(); fetchOrder.mockReset() })

  test.each([
    ['확인 성공', () => confirmOrder.mockResolvedValue(order), `?paymentId=${paymentId}`, { payment_id: paymentId, result: 'paid' }],
    ['확인 실패(409)', () => confirmOrder.mockRejectedValue({ response: { status: 409, data: { message: '결제가 완료되지 않았습니다.' } } }), `?paymentId=${paymentId}`, { payment_id: paymentId, result: 'failed', status: 409 }],
    ['결제창 취소', () => {}, `?paymentId=${paymentId}&code=FAILURE_TYPE_PG&message=${encodeURIComponent('결제를 취소했습니다.')}`, { payment_id: paymentId, result: 'cancelled', error_code: 'FAILURE_TYPE_PG' }],
  ])('결제 완료 화면 %s → payment_result', async (_name, arrange, search, props) => {
    arrange()
    global.window = { location: { search } }
    mount(PaymentComplete)
    await flush()
    expect(track.mock.calls).toEqual([['payment_result', props]])
  })

  test('결제 정보가 없는 주소는 남기지 않는다', async () => {
    global.window = { location: { search: '' } }
    mount(PaymentComplete)
    await flush()
    expect(types()).toEqual([])
  })

  test('주문 상세를 받으면 order_view(주문 번호·상태·금액·수량). 배송지는 넣지 않는다', async () => {
    fetchOrder.mockResolvedValue(order)
    mount(OrderDetail, { paymentId })
    await flush()
    expect(track.mock.calls).toEqual([['order_view', { payment_id: paymentId, status: 'PAID', total_krw: 1987000, item_count: 3 }]])
  })

  test('결제 대기 주문의 결제 확인 결과도 payment_result 로 남긴다', async () => {
    fetchOrder.mockResolvedValue({ ...order, status: 'READY', paid_at: null })
    confirmOrder.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValueOnce(order)
    const page = mount(OrderDetail, { paymentId })
    await flush()
    await click(button(page.root, '결제 확인'))
    await click(button(page.root, '결제 확인'))
    expect(events('payment_result')).toEqual([{ payment_id: paymentId, result: 'failed', error_code: 'ERR_NETWORK' }, { payment_id: paymentId, result: 'paid' }])
  })
})

describe('주문 상세 반품: return_request·return_withdraw', () => {
  const paymentId = 'order-7f3a9c2e'
  const buildId = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6'
  const DETAIL_TEXT = '케이스에 들어가지 않습니다.'
  const items = [
    { product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', unit_price_krw: 899000, quantity: 2, subtotal_krw: 1798000, build_id: buildId },
    { product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', unit_price_krw: 189000, quantity: 1, subtotal_krw: 189000, build_id: null },
  ]
  const requested = {
    id: 5, payment_id: paymentId, status: 'REQUESTED', reason: 'wrong_item', detail: '',
    items: [{ product_id: 12, product_name: 'FOCUS GX-850 GOLD 850W', quantity: 1, unit_price_krw: 189000 }],
    items_total_krw: 189000, shipping_deduction_krw: 0, refund_amount_krw: 189000, requested_at: '2026-10-31T02:00:00Z', decided_at: null, reject_reason: null, refunded_at: null,
  }
  const order = {
    payment_id: paymentId, order_name: '지포스 외 1건', status: 'PAID', total_krw: 1987000, item_count: 3, thumbnail_url: '', created_at: '2026-10-30T01:12:00Z', paid_at: '2026-10-30T01:13:00Z', cancelled_at: null,
    items, shipping: { recipient_name: SHIPPING.recipient, phone: SHIPPING.phone, postal_code: '06236', address1: SHIPPING.address, address2: '', delivery_memo: '' },
    returns: [requested], returnable: [{ product_id: 3, quantity: 2 }], return_deadline: '2026-11-06T01:13:00Z',
  }
  const fetchOrder = jest.fn()
  const createReturn = jest.fn()
  const withdrawReturn = jest.fn()
  const currentTime = () => Date.parse('2026-11-01T00:00:00Z')
  let OrderDetail

  beforeAll(async () => { OrderDetail = await compileSfc('views/OrderDetail.vue', { fetchOrder, createReturn, withdrawReturn, currentTime, track }) })
  beforeEach(() => {
    for (const mock of [fetchOrder, createReturn, withdrawReturn]) mock.mockReset()
    fetchOrder.mockResolvedValue(order)
  })

  async function fillReturn(page) {
    byId(page.root, 'return-quantity-3').props.onChange({ target: { value: '2' } })
    byId(page.root, 'return-reason-changed_mind').props.onChange()
    await flush()
    await setValue(byId(page.root, 'return-detail'), DETAIL_TEXT)
  }

  test('반품 신청에 성공하면 return_request(서버 응답의 신청 번호·사유·상품·환불 금액, 줄 수·수량 합, 주문 줄 build_id). 자세한 내용은 넣지 않는다', async () => {
    const page = mount(OrderDetail, { paymentId })
    await flush()
    await fillReturn(page)
    track.mockReset()
    createReturn.mockResolvedValue({
      ...requested, id: 6, reason: 'changed_mind', detail: DETAIL_TEXT,
      items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 2, unit_price_krw: 899000 }],
      items_total_krw: 1798000, shipping_deduction_krw: 6000, refund_amount_krw: 1792000,
    })
    await submit(page.root)
    expect(track.mock.calls).toEqual([['return_request', {
      payment_id: paymentId, return_id: 6, reason: 'changed_mind', item_count: 1, quantity: 2, product_ids: [3], refund_amount_krw: 1792000, build_ids: [buildId],
    }]])
    expect(JSON.stringify(track.mock.calls)).not.toContain(DETAIL_TEXT)
  })

  test('반품 신청이 실패하면 return_request 를 남기지 않는다', async () => {
    const page = mount(OrderDetail, { paymentId })
    await flush()
    await fillReturn(page)
    track.mockReset()
    createReturn.mockRejectedValue({ response: { status: 409, data: { message: '반품 신청 기간(결제 후 7일)이 지났습니다.' } } })
    await submit(page.root)
    expect(types()).toEqual([])
  })

  test('신청 철회에 성공하면 return_withdraw(주문 번호·신청 번호), 실패하면 남기지 않는다', async () => {
    const page = mount(OrderDetail, { paymentId })
    await flush()
    await click(button(page.root, '신청 철회'))
    track.mockReset()
    withdrawReturn.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ ...requested, status: 'WITHDRAWN' })
    stub(page.root, 'InlineConfirm').props.onConfirm()
    await flush()
    expect(types()).toEqual([])
    stub(page.root, 'InlineConfirm').props.onConfirm()
    await flush()
    expect(track.mock.calls).toEqual([['return_withdraw', { payment_id: paymentId, return_id: 5 }]])
  })
})

describe('질문 상세: question_view·answer_submit', () => {
  const answer = (id, extra = {}) => ({ id, question_id: 7, author: { id: String(id), name: member.name }, content: ANSWER_TEXT, created_at: '2026-10-28T01:00:00', updated_at: '2026-10-28T01:00:00', is_owner: false, ...extra })
  const question = { id: 7, title: 'S3 업로드 403', content: QUESTION_TEXT, author: { id: '9', name: member.name }, created_at: '2026-10-27T01:00:00', updated_at: '2026-10-27T01:00:00', image_count: 0, images: [], is_owner: false, answer_count: 2, answers: [answer(1), answer(2, { is_owner: true })] }
  const fetchQuestion = jest.fn()
  const fetchCurrentUser = jest.fn()
  const createAnswer = jest.fn()
  const updateAnswer = jest.fn()
  const deleteAnswer = jest.fn()
  const deleteQuestion = jest.fn()
  const goToQuestion = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let QuestionDetail
  const items = (page) => {
    const list = []
    const walk = (node) => { if (node.type === 'li') list.push(node); node.children.forEach(walk) }
    walk(page.root)
    return list
  }

  beforeAll(async () => {
    QuestionDetail = await compileSfc('views/QuestionDetail.vue', { fetchQuestion, authSession, createAnswer, updateAnswer, deleteAnswer, deleteQuestion, goToQuestion, track })
  })
  beforeEach(() => {
    for (const mock of [fetchQuestion, fetchCurrentUser, createAnswer, updateAnswer, deleteAnswer, deleteQuestion, goToQuestion]) mock.mockReset()
    fetchQuestion.mockResolvedValue(question)
    fetchCurrentUser.mockResolvedValue(member)
    authSession.reset()
  })

  test('질문 상세를 받으면 question_view(질문 id·답변 수). 제목·본문은 넣지 않는다', async () => {
    mount(QuestionDetail, { questionId: 7 })
    await flush()
    expect(track.mock.calls).toEqual([['question_view', { question_id: 7, answer_count: 2 }]])
  })

  test('답변 등록·수정·삭제에 성공하면 answer_submit(질문 id·action), 실패하면 남기지 않는다', async () => {
    createAnswer.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(answer(3, { is_owner: true }))
    updateAnswer.mockResolvedValue(answer(2, { is_owner: true, content: '고친 답변' }))
    deleteAnswer.mockResolvedValue(null)
    const page = mount(QuestionDetail, { questionId: 7 })
    await flush()
    await setValue(byId(page.root, 'answer-content'), ANSWER_TEXT)
    await submit(find(page.root, (node) => node.type === 'form'))
    expect(events('answer_submit')).toEqual([])
    await submit(find(page.root, (node) => node.type === 'form'))
    await click(button(items(page)[1], '수정'))
    await setValue(byId(page.root, 'answer-edit-2'), '고친 답변')
    await submit(items(page)[1])
    await click(button(items(page)[1], '삭제'))
    await stub(items(page)[1], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(events('answer_submit')).toEqual([
      { question_id: 7, action: 'create' },
      { question_id: 7, action: 'update' },
      { question_id: 7, action: 'delete' },
    ])
  })
})

describe('커뮤니티: community_list_view·community_post_view·community_post_submit·community_comment_submit', () => {
  // spec docs/specs/2026-11-01-event-enrichment.md: 성공했을 때만, 늦게 온 이전 응답·실패는 남기지 않음, 제목·본문·글쓴이 없음
  const TITLE = '150만 원 게임용 견적 부탁드립니다'
  const BODY = '배그·로아를 QHD 로 즐기고 싶습니다.'
  const COMMENT_TEXT = '이렇게 맞춰 보세요'
  const author = { id: 'user:7', name: member.name }
  const part = { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 1, line_total_krw: 739000 }
  const comment = (id, extra = {}) => ({ id, post_id: 3, author, content: COMMENT_TEXT, is_owner: true, created_at: '2026-11-01T05:00:00Z', updated_at: '2026-11-01T05:00:00Z', items: [], items_total_krw: 0, budget_gap_krw: null, ...extra })
  const quote = (id, extra = {}) => comment(id, { items: [part, { ...part, product_id: 7, category: 'gpu', quantity: 2, line_total_krw: 2580000 }], items_total_krw: 3319000, budget_gap_krw: 1819000, ...extra })
  const post = (extra = {}) => ({
    id: 3, board: 'build', title: TITLE, content: BODY, author, budget_krw: 1500000, purpose: 'gaming', is_owner: true,
    created_at: '2026-11-01T03:00:00Z', updated_at: '2026-11-01T03:00:00Z', comments: [quote(10, { is_owner: false }), comment(11)], ...extra,
  })
  const summary = (id) => ({ id, board: 'build', title: TITLE, preview: BODY, author, budget_krw: 1500000, purpose: 'gaming', comment_count: 2, quote_count: 1, created_at: '2026-11-01T03:00:00Z', updated_at: '2026-11-01T03:00:00Z' })
  const fetchCommunityPosts = jest.fn()
  const fetchCommunityPost = jest.fn()
  const createCommunityPost = jest.fn()
  const updateCommunityPost = jest.fn()
  const deleteCommunityPost = jest.fn()
  const createCommunityComment = jest.fn()
  const updateCommunityComment = jest.fn()
  const deleteCommunityComment = jest.fn()
  const goToCommunityPost = jest.fn()
  const goToCommunityBoard = jest.fn()
  const fetchCurrentUser = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  const mocks = [fetchCommunityPosts, fetchCommunityPost, createCommunityPost, updateCommunityPost, deleteCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, goToCommunityPost, goToCommunityBoard, fetchCurrentUser]
  let List
  let Detail
  let Editor
  const noText = () => {
    const json = JSON.stringify(track.mock.calls)
    for (const value of [TITLE, BODY, COMMENT_TEXT, member.name]) expect(json).not.toContain(value)
  }
  const section = (root, id) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === id)
  const items = (root, id, className) => {
    const list = []
    const walk = (node) => { if (node.type === 'li' && node.props.class === className) list.push(node); node.children.forEach(walk) }
    const area = section(root, id)
    if (area) walk(area)
    return list
  }
  const newForm = (root) => find(root, (node) => node.type === 'form' && Boolean(find(node, (child) => child.props.id === 'comment-content')))

  beforeAll(async () => {
    List = await compileSfc('views/CommunityPostList.vue', { fetchCommunityPosts, readPurposeQuery: () => 'gaming', replacePurposeQuery: jest.fn(), track })
    Detail = await compileSfc('views/CommunityPostDetail.vue', {
      authSession, fetchCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, deleteCommunityPost, goToCommunityBoard,
      fetchProducts: jest.fn().mockResolvedValue({ items: [] }), checkCompatibility: jest.fn().mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: [] }), track,
    })
    Editor = await compileSfc('views/CommunityPostEditor.vue', { authSession, createCommunityPost, fetchCommunityPost, updateCommunityPost, goToCommunityPost, track })
  })
  beforeEach(() => {
    for (const mock of mocks) mock.mockReset()
    fetchCurrentUser.mockResolvedValue(member)
    fetchCommunityPost.mockResolvedValue(post())
    authSession.reset()
  })
  afterEach(noText)

  test('게시판 목록을 받으면 community_list_view(게시판·용도·쪽·검색어·전체 수·글 id). 실패와 늦게 온 이전 응답은 남기지 않는다', async () => {
    const slow = deferred()
    fetchCommunityPosts.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ items: [summary(5)], total: 1, page: 1, page_size: 10 })
      .mockRejectedValueOnce({ response: { status: 500 } })
    const page = mount(List, { board: 'build' })
    await flush()
    await setValue(byId(page.root, 'community-search'), '게임')
    await submit(find(page.root, (node) => node.type === 'form'))
    slow.resolve({ items: [summary(3), summary(4)], total: 2, page: 1, page_size: 10 })
    await flush()
    expect(events('community_list_view')).toEqual([{ board: 'build', purpose: 'gaming', page: 1, search: '게임', result_count: 1, post_ids: [5] }])
    await click(button(page.root, '검색 지우기'))
    expect(events('community_list_view')).toHaveLength(1)
  })

  test('자유 게시판은 용도가 null, 쪽은 서버 응답의 쪽', async () => {
    fetchCommunityPosts.mockResolvedValue({ items: [{ ...summary(21), board: 'free', purpose: null, budget_krw: null }], total: 11, page: 2, page_size: 10 })
    mount(List, { board: 'free' })
    await flush()
    expect(events('community_list_view')).toEqual([{ board: 'free', purpose: null, page: 2, search: null, result_count: 11, post_ids: [21] }])
  })

  test('글 상세를 받으면 community_post_view(글 id·게시판·용도·예산·댓글 수·받은 견적 수). 실패는 남기지 않는다', async () => {
    fetchCommunityPost.mockRejectedValueOnce({ response: { status: 500 } })
    const page = mount(Detail, { postId: 3 })
    await flush()
    expect(events('community_post_view')).toEqual([])
    await click(button(page.root, '다시 시도'))
    expect(events('community_post_view')).toEqual([{ post_id: 3, board: 'build', purpose: 'gaming', budget_krw: 1500000, comment_count: 2, quote_count: 1 }])
  })

  test('견적·댓글 등록·수정·삭제에 성공하면 community_comment_submit(action·kind·부품 줄 수·합계·상품 id). 실패는 남기지 않는다', async () => {
    createCommunityComment.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(quote(12))
    updateCommunityComment.mockResolvedValue(comment(11, { content: '고친 댓글', updated_at: '2026-11-02T01:00:00Z' }))
    deleteCommunityComment.mockResolvedValue(null)
    const page = mount(Detail, { postId: 3 })
    await flush()
    track.mockClear()
    stub(newForm(page.root), 'CommunityPartsPicker').props['onUpdate:modelValue']([{ ...part, quantity: 1 }])
    await flush()
    await setValue(byId(page.root, 'comment-content'), COMMENT_TEXT)
    await submit(newForm(page.root))
    expect(events('community_comment_submit')).toEqual([])
    await submit(newForm(page.root))
    const comments = () => items(page.root, 'comments-title', 'cm-comment')
    await click(button(comments()[0], '수정'))
    await setValue(byId(page.root, 'comment-edit-11'), '고친 댓글')
    await submit(find(comments()[0], (node) => node.type === 'form'))
    await click(button(comments()[0], '삭제'))
    await stub(comments()[0], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(events('community_comment_submit')).toEqual([
      { action: 'create', post_id: 3, comment_id: 12, board: 'build', kind: 'quote', item_count: 2, items_total_krw: 3319000, product_ids: [1, 7] },
      { action: 'update', post_id: 3, comment_id: 11, board: 'build', kind: 'comment', item_count: 0, items_total_krw: 0, product_ids: [] },
      { action: 'delete', post_id: 3, comment_id: 11, board: 'build', kind: 'comment', item_count: 0, items_total_krw: 0, product_ids: [] },
    ])
  })

  test('글 삭제에 성공하면 이동하기 전에 community_post_submit(delete). 실패는 남기지 않는다', async () => {
    deleteCommunityPost.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(null)
    goToCommunityBoard.mockImplementation(() => expect(events('community_post_submit')).toHaveLength(1))
    const page = mount(Detail, { postId: 3 })
    await flush()
    const actions = find(page.root, (node) => String(node.props.class || '').split(' ').includes('cm-post__actions'))
    await click(button(actions, '삭제'))
    await stub(actions, 'InlineConfirm').props.onConfirm()
    await flush()
    expect(events('community_post_submit')).toEqual([])
    await stub(actions, 'InlineConfirm').props.onConfirm()
    await flush()
    expect(events('community_post_submit')).toEqual([{ action: 'delete', post_id: 3, board: 'build', purpose: 'gaming', budget_krw: 1500000 }])
    expect(goToCommunityBoard).toHaveBeenCalledWith('build')
  })

  test('글 등록·수정에 성공하면 이동하기 전에 community_post_submit(create·update, 서버 응답의 값). 실패는 남기지 않는다', async () => {
    createCommunityPost.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(post({ id: 9, comments: [] }))
    goToCommunityPost.mockImplementation(() => expect(events('community_post_submit').length).toBeGreaterThan(0))
    const page = mount(Editor, { board: 'build' })
    await flush()
    await setValue(byId(page.root, 'post-budget'), '150')
    await setValue(byId(page.root, 'post-purpose-gaming'), 'gaming')
    await setValue(byId(page.root, 'post-title'), TITLE)
    await setValue(byId(page.root, 'post-content'), BODY)
    await submit(page.root)
    expect(events('community_post_submit')).toEqual([])
    await submit(page.root)
    updateCommunityPost.mockResolvedValue(post({ budget_krw: 2000000, purpose: 'creative' }))
    const edit = mount(Editor, { postId: 3, editing: true })
    await flush()
    await setValue(byId(edit.root, 'post-budget'), '200')
    await setValue(byId(edit.root, 'post-purpose-creative'), 'creative')
    await submit(edit.root)
    expect(events('community_post_submit')).toEqual([
      { action: 'create', post_id: 9, board: 'build', purpose: 'gaming', budget_krw: 1500000 },
      { action: 'update', post_id: 3, board: 'build', purpose: 'creative', budget_krw: 2000000 },
    ])
  })
})

describe('견적 → 장바구니: build_add_to_cart', () => {
  // spec docs/specs/2026-11-01-build-id-purpose.md "이벤트": 견적 담기에 성공했을 때만. 값은 서버 응답(BuildAddResult) 그대로, 본문·이름 없음
  const BUILD_ID = '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7'
  const COMMENT_TEXT = '이렇게 맞춰 보세요'
  const author = { id: 'user:9', name: '조립왕' }
  const part = (productId, category, extra = {}) => ({ product_id: productId, name: `부품 ${productId}`, brand: 'AMD', category, thumbnail_url: '', price_krw: 100000, stock: 5, quantity: 1, line_total_krw: 100000, ...extra })
  const quote = { id: 10, post_id: 3, author, content: COMMENT_TEXT, is_owner: false, created_at: '2026-11-01T05:00:00Z', updated_at: '2026-11-01T05:00:00Z', items: [part(1, 'cpu'), part(6, 'memory', { quantity: 2 }), part(7, 'gpu', { stock: 0 })], items_total_krw: 400000, budget_gap_krw: -1100000 }
  const post = { id: 3, board: 'build', title: '150만 원 게임용 견적 부탁드립니다', content: '본문', author: { id: 'user:7', name: '민지' }, budget_krw: 1500000, purpose: 'gaming', is_owner: false, created_at: '2026-11-01T03:00:00Z', updated_at: '2026-11-01T03:00:00Z', comments: [quote] }
  const result = {
    build_id: BUILD_ID, post_id: 3, comment_id: 10,
    added: [{ product_id: 1, quantity: 1 }, { product_id: 6, quantity: 2 }],
    skipped: [{ product_id: 7, reason: 'sold_out' }],
    cart: { items: [], item_count: 3, total_krw: 300000 },
  }
  const fetchCurrentUser = jest.fn()
  const fetchCommunityPost = jest.fn()
  const addBuildToCart = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let Detail
  const card = (root) => find(root, (node) => node.type === 'li' && node.props.class === 'cm-quote')

  beforeAll(async () => {
    Detail = await compileSfc('views/CommunityPostDetail.vue', {
      authSession, fetchCommunityPost, addBuildToCart, siteStatus: { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() },
      fetchProducts: jest.fn().mockResolvedValue({ items: [] }), checkCompatibility: jest.fn().mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: [] }), track,
    })
  })
  beforeEach(() => {
    for (const mock of [fetchCurrentUser, fetchCommunityPost, addBuildToCart]) mock.mockReset()
    fetchCurrentUser.mockResolvedValue(member)
    fetchCommunityPost.mockResolvedValue(post)
    authSession.reset()
  })

  test('견적 담기에 성공하면 build_add_to_cart(build_id·글·댓글·담은 줄 수·뺀 수·담은 상품 id·뺀 이유). 실패는 남기지 않는다', async () => {
    addBuildToCart.mockRejectedValueOnce({ response: { status: 409, data: { message: '담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.' } } }).mockResolvedValueOnce(result)
    const page = mount(Detail, { postId: 3 })
    await flush()
    track.mockClear()
    await click(button(card(page.root), '전체 장바구니에 담기'))
    expect(events('build_add_to_cart')).toEqual([])
    await click(button(card(page.root), '다시 시도'))
    expect(addBuildToCart).toHaveBeenLastCalledWith(10)
    expect(events('build_add_to_cart')).toEqual([
      { build_id: BUILD_ID, post_id: 3, comment_id: 10, added_count: 2, skipped_count: 1, product_ids: [1, 6], skipped_reasons: ['sold_out'] },
    ])
    expect(JSON.stringify(track.mock.calls)).not.toContain(COMMENT_TEXT)
  })
})

describe('로그인 화면·레이아웃: login·signup·logout', () => {
  const loginWithEmail = jest.fn()
  const signupWithEmail = jest.fn()
  const loginWithKakao = jest.fn()
  const goToMain = jest.fn()
  const fetchCurrentUser = jest.fn()
  const logout = jest.fn()
  const flushEvents = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser, logout })
  // 헤더 숫자·토스트(siteStatus)는 가짜를 넣는다(실제 저장소는 GET /cart 등을 부른다)
  const layoutStatus = { state: { cartCount: 0, compareCount: 0, unreadCount: 0, toast: null }, load: jest.fn(), refresh: jest.fn(), subscribe: jest.fn((listener) => { listener(layoutStatus.state); return () => {} }) }
  let LoginPage
  let SiteLayout
  const storage = (initial = {}) => {
    const values = new Map(Object.entries(initial))
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  }
  const openLogin = ({ pathname = '/login', search = '', sessionStorage = storage() } = {}) => {
    global.window = { location: { pathname, search, origin: 'http://localhost:5173' }, sessionStorage, history: { replaceState: jest.fn() }, crypto: { getRandomValues: (bytes) => bytes.fill(1) } }
    return mount(LoginPage)
  }
  const dialog = (page) => stub(page.root, 'AuthDialog').props

  beforeAll(async () => {
    LoginPage = await compileSfc('views/LoginPage.vue', { loginWithEmail, signupWithEmail, loginWithKakao, goToMain, authSession, siteStatus: layoutStatus, track })
    SiteLayout = await compileSfc('components/SiteLayout.vue', { authSession, siteStatus: layoutStatus, goToMain, track, flushEvents })
  })
  beforeEach(() => {
    for (const mock of [loginWithEmail, signupWithEmail, loginWithKakao, goToMain, fetchCurrentUser, logout, flushEvents]) mock.mockReset()
    fetchCurrentUser.mockResolvedValue(member)
    authSession.reset()
  })

  test('가입에 성공하면 signup(purpose: 고르지 않으면 null), 이메일 로그인에 성공하면 login(email) 을 남기고 로그인 상태를 다시 부른 뒤 이동한다', async () => {
    signupWithEmail.mockResolvedValue({ id: 1 })
    loginWithEmail.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ id: 1 })
    const page = openLogin()
    await dialog(page).onSubmit({ mode: 'signup', name: member.name, email: member.email, password: 'password1' })
    await flush()
    await dialog(page).onSubmit({ mode: 'login', email: member.email, password: 'password1' })
    await flush()
    expect(types()).toEqual(['signup'])
    await dialog(page).onSubmit({ mode: 'login', email: member.email, password: 'password1' })
    await flush()
    expect(track.mock.calls).toEqual([['signup', { purpose: null }], ['login', { method: 'email' }]])
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
    expect(goToMain).toHaveBeenCalledTimes(1)
  })

  test('가입할 때 고른 사용 목적은 signup 의 purpose 로 남긴다(이름·이메일 없음). 가입에 실패하면 남기지 않는다', async () => {
    signupWithEmail.mockRejectedValueOnce({ response: { status: 422 } }).mockResolvedValueOnce({ id: 1 })
    const page = openLogin({ search: '?mode=signup' })
    const credentials = { mode: 'signup', name: member.name, email: member.email, password: 'password1', purpose: 'creative' }
    await dialog(page).onSubmit(credentials)
    await flush()
    expect(types()).toEqual([])
    await dialog(page).onSubmit(credentials)
    await flush()
    expect(track.mock.calls).toEqual([['signup', { purpose: 'creative' }]])
  })

  test('카카오 콜백 로그인에 성공하면 login(kakao)', async () => {
    loginWithKakao.mockResolvedValue({ id: 'kakao:1' })
    openLogin({ pathname: '/login/kakao/callback', search: '?code=auth-code&state=saved', sessionStorage: storage({ kakao_oauth_state: 'saved' }) })
    await flush()
    expect(track.mock.calls).toEqual([['login', { method: 'kakao' }]])
    expect(goToMain).toHaveBeenCalledTimes(1)
  })

  test('로그아웃에 성공하면 logout 을 남기고 이동한다. 실패하면 남기지 않는다', async () => {
    logout.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValueOnce(null)
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    await click(button(layout.root, '로그아웃'))
    expect(types()).toEqual([])
    await click(button(layout.root, '로그아웃'))
    expect(track.mock.calls).toEqual([['logout']])
    expect(goToMain).toHaveBeenCalledTimes(1)
  })

  test('로그아웃은 쌓인 이벤트를 먼저 보내고(끝날 때까지 기다림) → POST /user/logout → logout 이벤트 순서다', async () => {
    const order = []
    const flushing = deferred()
    flushEvents.mockImplementation(() => {
      order.push('flush')
      return flushing.promise.then(() => { order.push('flushed') })
    })
    logout.mockImplementation(async () => { order.push('logout') })
    track.mockImplementation((type) => { order.push(`track:${type}`) })
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    button(layout.root, '로그아웃').props.onClick()
    await flush()
    expect(order).toEqual(['flush'])
    expect(logout).not.toHaveBeenCalled()
    expect(button(layout.root, '로그아웃 중...').props.disabled).toBe(true)
    flushing.resolve()
    await flush()
    expect(order).toEqual(['flush', 'flushed', 'logout', 'track:logout'])
    expect(goToMain).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['시간 초과(응답이 2초 안에 오지 않음)', 'timeout'],
    ['전송 실패', 'fail'],
  ])('쌓인 이벤트 전송이 %s 여도 로그아웃은 진행된다', async (_name, mode) => {
    const limit = deferred()
    const delay = jest.fn(() => ({ promise: limit.promise, cancel: jest.fn() }))
    const send = jest.fn(() => (mode === 'timeout' ? new Promise(() => {}) : Promise.reject(new Error('Network Error'))))
    const tracker = createTracker({ send, delay, storage: {}, page: () => ({ path: '/products', referrer: '' }), schedule: () => null, cancel: () => {} })
    tracker.track('page_view', { route: 'products' })
    flushEvents.mockImplementation((options) => tracker.flushNow(options))
    logout.mockResolvedValue(null)
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    button(layout.root, '로그아웃').props.onClick()
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(delay).toHaveBeenCalledWith(LOGOUT_FLUSH_TIMEOUT_MS)
    if (mode === 'timeout') {
      expect(logout).not.toHaveBeenCalled()
      limit.resolve()
      await flush()
    }
    expect(logout).toHaveBeenCalledTimes(1)
    expect(track.mock.calls).toEqual([['logout']])
    expect(goToMain).toHaveBeenCalledTimes(1)
  })
})
