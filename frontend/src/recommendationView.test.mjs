// 추천(spec docs/specs/2026-11-03-product-recommendations.md "화면")의 상태별 렌더링과 동작.
// 1) 상품 상세(views/ProductDetail.vue)의 "함께 보는 부품"(추천) 영역: 본문을 받은 뒤 부르는 보조 영역(로딩·정상·빈 목록·오류 → 다시 시도), 본문이 실패하면 부르지 않음
// 2) 추천 카드 컴포넌트(components/ProductRecommendations.vue): 상태 문구, 카드 링크·이름 h3·가격·근거(글자)·30일 변동 배지·추세선, h1·dl/dt 없음, 목록 이름
// 3) 관리자 추천 학습(views/AdminRecommendations.vue, /admin/recommendations): 401·403·로딩·빈 목록·오류 → 다시 시도, 학습 중 잠금·성공 status·실패 alert(입력 유지),
//    순위 비교(현재/이전, ▲·▼·새로, 이전 없음, 404, 번호 검증, 요청 경합)
// 추천 노출·클릭 이벤트(source_product_id·model_version)는 src/trackingView.test.mjs 가 본다.
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const recItem = (id, extra = {}) => ({
  rank: 1, reason: 'similar', id, name: `라이젠 ${id}`, brand: 'AMD', category: 'cpu', price_krw: 176400, stock: 11, thumbnail_url: '', summary: '8코어',
  released_on: '2022-04-04', performance_score: 26538, value_score: 1504.42, is_new: false, rating_average: 3.3, review_count: 4,
  price_trend: { change_30d_pct: -3.4, sparkline_30d: [182600, 176400], lowest_1y_krw: 176400, is_lowest_1y: true }, ...extra,
})
const recommendations = (items, model = { version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' }) => ({ product_id: 1, model, items })
const sixItems = [
  recItem(3, { rank: 1, reason: 'co_view', name: '라이젠7 5700X' }), recItem(28, { rank: 2 }), recItem(8, { rank: 3 }),
  recItem(9, { rank: 4 }), recItem(31, { rank: 5 }), recItem(12, { rank: 6 }),
]

describe('상품 상세: 추천 상품 영역', () => {
  const detail = {
    id: 1, name: '라이젠5 5600', brand: 'AMD', category: 'cpu', price_krw: 149600, stock: 9, thumbnail_url: '', summary: '6코어', description: '설명', specs: [],
    released_on: '2022-04-04', performance_score: 21000, value_score: 1403.74, is_new: false, rating_average: null, review_count: 0, lowest_price_90d: 149600,
  }
  const fetchProduct = jest.fn()
  const fetchPriceHistory = jest.fn()
  const fetchProductReviews = jest.fn()
  const fetchProductRecommendations = jest.fn()
  const fetchCurrentUser = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  const fetchQuestions = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
  let ProductDetail

  beforeAll(async () => {
    ProductDetail = await compileSfc('views/ProductDetail.vue', { fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations, fetchQuestions, authSession, track: jest.fn() })
  })
  beforeEach(() => {
    for (const mock of [fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations, fetchCurrentUser]) mock.mockReset()
    fetchProduct.mockResolvedValue(detail)
    fetchPriceHistory.mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    fetchProductReviews.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: {}, my_review: null, can_review: false })
    fetchProductRecommendations.mockResolvedValue(recommendations(sixItems))
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    authSession.reset()
  })

  const area = (page) => stub(page.root, 'ProductRecommendations')

  test('상품을 받은 뒤 추천 6개를 부른다: 로딩 → 정상(카드 목록). 위치는 디자인대로 가격 추이·판매처·스펙 카드 다음, 리뷰 앞', async () => {
    const response = deferred()
    fetchProductRecommendations.mockReturnValue(response.promise)
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(fetchProductRecommendations).toHaveBeenCalledWith(1, { limit: 6 })
    expect(area(page).props).toMatchObject({ state: 'loading', items: [], error: '' })
    const article = find(page.root, (node) => node.type === 'article')
    const order = article.children.map((node) => node.props['data-stub'] || node.props['aria-labelledby'] || node.props.class).filter(Boolean)
    expect(order.indexOf('product-detail__top')).toBeLessThan(order.indexOf('price-history-title'))
    expect(order.indexOf('price-history-title')).toBeLessThan(order.indexOf('ProductRecommendations'))
    expect(order.indexOf('ProductRecommendations')).toBeLessThan(order.indexOf('product-reviews-title'))
    response.resolve(recommendations(sixItems))
    await flush()
    expect(area(page).props).toMatchObject({ state: 'ready', items: sixItems, error: '' })
  })

  test('추천이 0개면 빈 목록 상태', async () => {
    fetchProductRecommendations.mockResolvedValue(recommendations([], null))
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(area(page).props).toMatchObject({ state: 'empty', items: [] })
  })

  test('오류(500)면 영역만 오류이고 본문은 그대로 보인다 → 다시 시도하면 다시 부른다', async () => {
    fetchProductRecommendations.mockRejectedValueOnce({ response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } })
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(area(page).props).toMatchObject({ state: 'error', error: '추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.' })
    expect(stub(page.root, 'ProductSummary').props.name).toBe('라이젠5 5600')
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
    expect(byRole(page.root, 'alert')).toEqual([])
    await area(page).props.onRetry()
    await flush()
    expect(fetchProductRecommendations).toHaveBeenCalledTimes(2)
    expect(area(page).props).toMatchObject({ state: 'ready', items: sixItems, error: '' })
  })

  test('네트워크 오류도 같은 문구다. 늦게 온 이전 응답은 버린다', async () => {
    const first = deferred()
    fetchProductRecommendations.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('Network Error'))
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    await area(page).props.onRetry()
    await flush()
    expect(area(page).props).toMatchObject({ state: 'error', error: '추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.' })
    first.resolve(recommendations(sixItems))
    await flush()
    expect(area(page).props.state).toBe('error')
  })

  test.each([[404], [500]])('상품 본문이 실패하면(%s) 추천을 부르지 않는다', async (status) => {
    fetchProduct.mockRejectedValue({ response: { status } })
    const page = mount(ProductDetail, { productId: 1 })
    await flush()
    expect(fetchProductRecommendations).not.toHaveBeenCalled()
    expect(area(page)).toBeNull()
  })

  test('올바르지 않은 주소(id null)면 추천을 부르지 않는다', async () => {
    mount(ProductDetail, { productId: null })
    await flush()
    expect(fetchProductRecommendations).not.toHaveBeenCalled()
  })
})

describe('ProductRecommendations 컴포넌트', () => {
  let ProductRecommendations
  beforeAll(async () => { ProductRecommendations = await compileSfc('components/ProductRecommendations.vue') })

  const heading = (root) => find(root, (node) => node.type === 'h2')
  const list = (root) => find(root, (node) => node.type === 'ul')
  const cards = (root) => findAll(root, (node) => node.type === 'a')

  test('로딩: 제목 "함께 보는 부품"과 role=status 문구, 영역 aria-busy', () => {
    const view = mount(ProductRecommendations, { state: 'loading' })
    expect(text(heading(view.root))).toBe('함께 보는 부품')
    expect(view.root.children[0].props['aria-labelledby']).toBe('product-recommendations-title')
    expect(view.root.children[0].props['aria-busy']).toBe(true)
    expect(byRole(view.root, 'status').map(text)).toEqual(['추천 상품을 불러오는 중입니다...'])
    expect(list(view.root)).toBeNull()
  })

  test('오류: role=alert 문구(받은 문구, 없으면 기본 문구) + "다시 시도" → retry', async () => {
    const onRetry = jest.fn()
    const view = mount(ProductRecommendations, { state: 'error', error: '추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.', onRetry })
    expect(text(byRole(view.root, 'alert')[0])).toContain('추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(view.root, '다시 시도'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    const fallback = mount(ProductRecommendations, { state: 'error' })
    expect(text(byRole(fallback.root, 'alert')[0])).toContain('추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.')
  })

  test('빈 목록: "추천할 상품이 아직 없습니다."', () => {
    const view = mount(ProductRecommendations, { state: 'empty', items: [] })
    expect(text(view.root)).toContain('추천할 상품이 아직 없습니다.')
    expect(list(view.root)).toBeNull()
    expect(byRole(view.root, 'status')).toEqual([])
  })

  test('정상: ul aria-label="추천 상품"(" 목록"으로 끝나지 않음), 카드마다 /products/{id} 링크·사진(alt)·이름 h3·가격·근거(글자)·30일 변동 배지·추세선', () => {
    const view = mount(ProductRecommendations, { state: 'ready', items: sixItems })
    expect(list(view.root).props['aria-label']).toBe('추천 상품')
    expect(list(view.root).props['aria-label']).not.toMatch(/ 목록$/)
    expect(cards(view.root).map((node) => node.props.href)).toEqual(['/products/3', '/products/28', '/products/8', '/products/9', '/products/31', '/products/12'])
    const first = cards(view.root)[0]
    expect(text(find(first, (node) => node.type === 'h3'))).toBe('라이젠7 5700X')
    expect(find(first, (node) => node.type === 'img').props.alt).toBe('라이젠7 5700X 이미지')
    expect(text(first)).toContain('176,400원')
    expect(text(first)).toContain('함께 본 상품')
    expect(text(cards(view.root)[1])).toContain('비슷한 가격대')
    // 변동 배지는 글자(접두 없음), 추세선은 배지와 같은 내용이라 읽지 않는다(aria-hidden)
    expect(stub(first, 'PriceChangeBadge').props).toMatchObject({ pct: -3.4, prefix: '' })
    expect(stub(first, 'PriceSparkline').props).toMatchObject({ values: [182600, 176400], 'change-pct': -3.4 })
    expect(stub(first, 'PriceSparkline').parent.props['aria-hidden']).toBe('true')
  })

  test('price_trend 가 없으면 변동 배지·추세선 없이 그린다', () => {
    const view = mount(ProductRecommendations, { state: 'ready', items: [recItem(5, { price_trend: null })] })
    expect(stub(view.root, 'PriceChangeBadge')).toBeNull()
    expect(stub(view.root, 'PriceSparkline')).toBeNull()
    expect(text(cards(view.root)[0])).toContain('176,400원')
  })

  test('시뮬레이터가 읽는 h1·dl·dt 를 쓰지 않는다(모든 상태)', () => {
    for (const state of ['loading', 'error', 'empty', 'ready']) {
      const view = mount(ProductRecommendations, { state, items: sixItems, error: '오류' })
      expect(findAll(view.root, (node) => ['h1', 'dl', 'dt'].includes(node.type))).toEqual([])
    }
  })

  test('카드를 누르면 select(항목, 칸 순서)를 알리고, 카드 li 를 observeItem 에 넘긴다. 사진이 깨지면 대체 그림', async () => {
    const onSelect = jest.fn()
    const observeItem = jest.fn()
    const view = mount(ProductRecommendations, { state: 'ready', items: sixItems.slice(0, 2), onSelect, observeItem })
    const items = findAll(view.root, (node) => node.type === 'li')
    expect(observeItem.mock.calls.map(([element, item, index]) => [element, item.id, index])).toEqual([[items[0], 3, 0], [items[1], 28, 1]])
    await click(cards(view.root)[1])
    expect(onSelect).toHaveBeenCalledWith(sixItems[1], 1)
    const image = find(cards(view.root)[0], (node) => node.type === 'img')
    image.props.onError()
    await flush()
    expect(find(cards(view.root)[0], (node) => node.type === 'img').props.src).toBe('/product-placeholder.svg')
  })
})

describe('관리자 추천 학습', () => {
  const model = (id, extra = {}) => ({
    id, version: `itemcf-${id}`, algorithm: 'itemcf-cosine', trained_at: '2026-10-08T03:10:00Z', events_since: '2026-10-08T03:00:00Z',
    event_count: 24, session_count: 6, product_count: 2, pair_count: 1, params: { neighbors: 50, shrinkage: 20, base_weight: 0.5, price_scale: 0.25, top_k: 20 },
    duration_ms: 180, ...extra,
  })
  const modelsPage = (items, serverTime = '2026-10-08T03:20:00Z') => ({ server_time: serverTime, items })
  const row = (rank, productId, extra = {}) => ({ rank, product_id: productId, name: `상품 ${productId}`, price_krw: 150000, score: 0.4, cf_score: 0, base_score: 0.8, co_sessions: 0, reason: 'similar', ...extra })
  const comparison = (extra = {}) => ({
    product: { id: 1, name: '라이젠5 5600', category: 'cpu', price_krw: 149600 },
    current: {
      model: { version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' },
      items: [row(1, 3, { name: '라이젠7 5700X', score: 0.49, cf_score: 0.23, base_score: 0.52, co_sessions: 6, reason: 'co_view' }), row(2, 28, { score: 0.48 }), row(3, 9), row(4, 44)],
    },
    previous: { model: null, items: [row(1, 28), row(2, 8), row(3, 9), row(4, 3)] },
    ...extra,
  })

  const fetchRecommendationModels = jest.fn()
  const fetchRecommendationComparison = jest.fn()
  const trainRecommendations = jest.fn()
  let AdminRecommendations

  beforeAll(async () => {
    AdminRecommendations = await compileSfc('views/AdminRecommendations.vue', { fetchRecommendationModels, fetchRecommendationComparison, trainRecommendations })
  })
  beforeEach(() => {
    for (const mock of [fetchRecommendationModels, fetchRecommendationComparison, trainRecommendations]) mock.mockReset()
    fetchRecommendationModels.mockResolvedValue(modelsPage([model(4), model(3, { events_since: null, event_count: 720000, session_count: 120000, duration_ms: 65000 })]))
    fetchRecommendationComparison.mockResolvedValue(comparison())
  })

  async function open() {
    const page = mount(AdminRecommendations)
    await flush()
    return page
  }
  const section = (root, id) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === id)
  const rows = (root) => findAll(root, (node) => node.type === 'tbody').map((body) => findAll(body, (node) => node.type === 'tr').map(text))
  const trainButton = (root) => find(root, (node) => node.type === 'button' && node.props.type === 'submit' && /추천 학습하기|학습 중/.test(text(node)))
  const trainForm = (root) => find(root, (node) => node.type === 'form' && node.props.class === 'admin-recs__train')
  const compareForm = (root) => find(root, (node) => node.type === 'form' && node.props.class === 'admin-recs__compare-form')
  const scopeRadio = (root, value) => byId(root, `recommendation-scope-${value}`)
  const chooseSince = async (root) => { scopeRadio(root, 'since').props.onChange(); await flush() }
  const submitForm = async (form) => { await form.props.onSubmit({ preventDefault() {} }); await flush() }

  test('로딩(role=status) → 학습 기록 표(최신 먼저, 서울 시각, 이벤트 기간 전체/… 이후, 개수, 걸린 시간) → 상품 1번 순위 비교', async () => {
    const response = deferred()
    fetchRecommendationModels.mockReturnValue(response.promise)
    const page = mount(AdminRecommendations)
    await flush()
    expect(byRole(page.root, 'status').map(text)).toEqual(['추천 학습 정보를 불러오는 중입니다...'])
    expect(fetchRecommendationComparison).not.toHaveBeenCalled()
    response.resolve(modelsPage([model(4), model(3, { events_since: null, event_count: 720000, session_count: 120000, duration_ms: 65000 })]))
    await flush()
    expect(text(find(page.root, (node) => node.type === 'h1'))).toBe('추천 학습')
    const history = section(page.root, 'admin-recs-history-title')
    expect(findAll(history, (node) => node.type === 'th' && node.props.scope === 'col').map(text)).toEqual(['버전', '학습 시각', '이벤트 기간', '상품 조회 이벤트', '세션', '걸린 시간'])
    expect(rows(history)[0]).toEqual([
      'itemcf-4사용 중2026-10-08 12:10:002026-10-08 12:00:00 이후24건6개0.2초',
      'itemcf-32026-10-08 12:10:00전체720,000건120,000개1분 5초',
    ])
    expect(fetchRecommendationComparison).toHaveBeenCalledWith(1, { limit: 10 })
    expect(byId(page.root, 'recommendation-product').value).toBe(1)
  })

  test('학습 폼: fieldset "학습에 쓸 이벤트" 라디오 전체(기본)/이 시각 이후, datetime-local 기본값은 server_time 의 서울 시각', async () => {
    const page = await open()
    const fieldset = find(trainForm(page.root), (node) => node.type === 'fieldset')
    expect(text(find(fieldset, (node) => node.type === 'legend'))).toBe('학습에 쓸 이벤트')
    expect(scopeRadio(page.root, 'all').props).toMatchObject({ type: 'radio', checked: true })
    expect(scopeRadio(page.root, 'since').props).toMatchObject({ type: 'radio', checked: false })
    expect(text(fieldset)).toContain('전체')
    expect(text(fieldset)).toContain('이 시각 이후')
    const since = byId(page.root, 'recommendation-since')
    expect(since.props).toMatchObject({ type: 'datetime-local', disabled: true })
    expect(since.value).toBe('2026-10-08T12:20:00')
    await chooseSince(page.root)
    expect(byId(page.root, 'recommendation-since').props.disabled).toBe(false)
    expect(text(trainButton(page.root))).toBe('추천 학습하기')
  })

  test('학습 중: 버튼 "학습 중..."·fieldset 비활성, 두 번 보내지 않는다 → 성공 role=status 문구 뒤 학습 기록·순위 비교를 다시 부른다', async () => {
    const page = await open()
    const response = deferred()
    trainRecommendations.mockReturnValue(response.promise)
    await chooseSince(page.root)
    await setValue(byId(page.root, 'recommendation-since'), '2026-10-08T12:00:00')
    // 응답을 붙잡아 둔 동안은 제출(학습)이 끝나지 않으므로 기다리지 않는다
    const submitting = trainForm(page.root).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(trainRecommendations).toHaveBeenCalledWith({ since: '2026-10-08T12:00:00+09:00' })
    expect(text(trainButton(page.root))).toBe('학습 중...')
    expect(trainButton(page.root).props.disabled).toBe(true)
    expect(find(trainForm(page.root), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    await submitForm(trainForm(page.root))
    expect(trainRecommendations).toHaveBeenCalledTimes(1)
    fetchRecommendationModels.mockResolvedValue(modelsPage([model(5), model(4)], '2026-10-08T04:00:00Z'))
    response.resolve(model(5, { event_count: 24, session_count: 6, duration_ms: 180 }))
    await submitting
    await flush()
    const status = byRole(section(page.root, 'admin-recs-train-title'), 'status')
    expect(status.map(text)).toEqual(['itemcf-5 를 학습했습니다. 상품 조회 이벤트 24건 · 세션 6개 · 0.2초'])
    expect(fetchRecommendationModels).toHaveBeenCalledTimes(2)
    expect(fetchRecommendationComparison).toHaveBeenCalledTimes(2)
    expect(fetchRecommendationComparison).toHaveBeenLastCalledWith(1, { limit: 10 })
    expect(rows(section(page.root, 'admin-recs-history-title'))[0][0]).toContain('itemcf-5사용 중')
    // 입력한 시각은 새 server_time 으로 바꾸지 않는다
    expect(byId(page.root, 'recommendation-since').value).toBe('2026-10-08T12:00:00')
    expect(text(trainButton(page.root))).toBe('추천 학습하기')
  })

  test('"전체"로 학습하면 since null 을 보낸다', async () => {
    const page = await open()
    trainRecommendations.mockResolvedValue(model(5, { events_since: null }))
    await submitForm(trainForm(page.root))
    expect(trainRecommendations).toHaveBeenCalledWith({ since: null })
  })

  test.each([
    [409, '이미 추천 모델을 학습하고 있습니다. 끝난 뒤 다시 눌러 주세요.'],
    [422, 'since 는 지금보다 미래일 수 없습니다.'],
    [503, '이벤트 저장소에 연결하지 못했습니다. MONGODB_URI 를 확인해 주세요.'],
  ])('학습 실패(%s)는 role=alert 서버 문구, 고른 기간·시각은 그대로', async (status, message) => {
    const page = await open()
    trainRecommendations.mockRejectedValue({ response: { status, data: { message } } })
    await chooseSince(page.root)
    await setValue(byId(page.root, 'recommendation-since'), '2026-10-08T11:59:30')
    await submitForm(trainForm(page.root))
    expect(byRole(section(page.root, 'admin-recs-train-title'), 'alert').map(text)).toEqual([message])
    expect(byRole(section(page.root, 'admin-recs-train-title'), 'status')).toEqual([])
    expect(scopeRadio(page.root, 'since').props.checked).toBe(true)
    expect(byId(page.root, 'recommendation-since').value).toBe('2026-10-08T11:59:30')
    expect(text(trainButton(page.root))).toBe('추천 학습하기')
    expect(fetchRecommendationModels).toHaveBeenCalledTimes(1)
  })

  test('학습 중 로그인이 만료되면(401) 새 탭 로그인 링크, 500 은 우리 문구', async () => {
    const page = await open()
    trainRecommendations.mockRejectedValueOnce({ response: { status: 401 } }).mockRejectedValueOnce({ response: { status: 500, data: { message: 'Internal' } } })
    await submitForm(trainForm(page.root))
    const alert = byRole(section(page.root, 'admin-recs-train-title'), 'alert')[0]
    expect(text(alert)).toContain('로그인이 만료되었습니다.')
    expect(link(alert, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    await submitForm(trainForm(page.root))
    expect(text(byRole(section(page.root, 'admin-recs-train-title'), 'alert')[0])).toBe('추천 모델을 학습하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  })

  test('"이 시각 이후"인데 시각이 비었으면 요청하지 않고 안내한다', async () => {
    const page = await open()
    await chooseSince(page.root)
    await setValue(byId(page.root, 'recommendation-since'), '')
    await submitForm(trainForm(page.root))
    expect(trainRecommendations).not.toHaveBeenCalled()
    expect(text(byRole(section(page.root, 'admin-recs-train-title'), 'alert')[0])).toBe('학습에 쓸 이벤트의 시작 시각을 입력해 주세요.')
  })

  test('순위 비교: 상품 정보, 현재(모델)·이전(기본 추천) 표, 현재 표의 ▲·▼·새로·- 표시(글자)', async () => {
    const page = await open()
    const compare = section(page.root, 'admin-recs-compare-title')
    expect(text(compare)).toContain('1번 라이젠5 5600')
    expect(text(compare)).toContain('CPU · 149,600원')
    const current = section(page.root, 'admin-recs-current-title')
    const previous = section(page.root, 'admin-recs-previous-title')
    expect(text(find(current, (node) => node.type === 'h3'))).toBe('현재 itemcf-4')
    expect(text(current)).toContain('2026-10-08 12:10:00 학습')
    expect(text(find(previous, (node) => node.type === 'h3'))).toBe('이전 기본 추천')
    expect(findAll(current, (node) => node.type === 'th').map(text)).toEqual(['순위', '상품', '점수', 'CF', '기본', '함께 본 세션'])
    expect(rows(current)[0]).toEqual([
      '1▲3이전보다 3계단 오름라이젠7 5700X3번 · 150,000원0.4900.2300.5206',
      '2▼1이전보다 1계단 내림상품 2828번 · 150,000원0.4800.0000.8000',
      '3-이전과 같은 순위상품 99번 · 150,000원0.4000.0000.8000',
      '4새로이전 순위에 없던 상품상품 4444번 · 150,000원0.4000.0000.8000',
    ])
    expect(rows(previous)[0].map((line) => line.slice(0, 1))).toEqual(['1', '2', '3', '4'])
    expect(text(previous)).not.toMatch(/▲|▼|새로/)
    expect(link(current, '라이젠7 5700X').props.href).toBe('/products/3')
  })

  test('빈 목록(모델 0개): 학습 기록 안내, 학습 폼은 그대로, 이전 순위 없음(순위 변화 표시 없음)', async () => {
    fetchRecommendationModels.mockResolvedValue(modelsPage([]))
    fetchRecommendationComparison.mockResolvedValue(comparison({ current: { model: null, items: [row(1, 28), row(2, 8)] }, previous: null }))
    const page = await open()
    expect(text(section(page.root, 'admin-recs-history-title'))).toContain('아직 학습한 모델이 없습니다. 지금은 기본 추천(같은 카테고리·비슷한 가격)을 보여 줍니다.')
    expect(trainButton(page.root)).not.toBeNull()
    expect(text(find(section(page.root, 'admin-recs-current-title'), (node) => node.type === 'h3'))).toBe('현재 기본 추천')
    expect(text(section(page.root, 'admin-recs-current-title'))).toContain('같은 카테고리·비슷한 가격으로 계산한 순위')
    expect(text(section(page.root, 'admin-recs-current-title'))).not.toMatch(/▲|▼|새로/)
    expect(text(section(page.root, 'admin-recs-previous-title'))).toContain('비교할 이전 순위가 없습니다.')
  })

  test('오류(500·네트워크) → role=alert + 다시 시도 → 학습 기록과 비교를 부른다', async () => {
    fetchRecommendationModels.mockRejectedValueOnce({ response: { status: 500, data: { message: 'Internal' } } }).mockRejectedValueOnce(new Error('Network Error'))
    const page = await open()
    expect(text(byRole(page.root, 'alert')[0])).toContain('추천 학습 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(fetchRecommendationComparison).not.toHaveBeenCalled()
    await click(button(page.root, '다시 시도'))
    expect(text(byRole(page.root, 'alert')[0])).toContain('추천 학습 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(byRole(page.root, 'alert')).toEqual([])
    expect(rows(section(page.root, 'admin-recs-history-title'))[0]).toHaveLength(2)
    expect(fetchRecommendationComparison).toHaveBeenCalledTimes(1)
  })

  test('비로그인(401): "로그인한 관리자만 볼 수 있습니다." + 로그인 링크 + 다시 확인, 학습 폼·비교는 없다', async () => {
    fetchRecommendationModels.mockRejectedValueOnce({ response: { status: 401 } })
    const page = await open()
    expect(text(page.root)).toContain('로그인한 관리자만 볼 수 있습니다.')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    expect(trainForm(page.root)).toBeNull()
    expect(fetchRecommendationComparison).not.toHaveBeenCalled()
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(fetchRecommendationModels).toHaveBeenCalledTimes(2)
    expect(trainForm(page.root)).not.toBeNull()
  })

  test('권한 없음(403): "관리자만 볼 수 있습니다." (로그인 안내와 다른 문구), 학습 폼·비교는 없다', async () => {
    fetchRecommendationModels.mockRejectedValue({ response: { status: 403, data: { message: '관리자만 사용할 수 있습니다.' } } })
    const page = await open()
    const heading = find(page.root, (node) => node.type === 'h2')
    expect(text(heading)).toBe('관리자만 볼 수 있습니다.')
    expect(text(page.root)).not.toContain('로그인한 관리자만')
    expect(link(page.root, '로그인')).toBeNull()
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    expect(trainForm(page.root)).toBeNull()
    expect(fetchRecommendationComparison).not.toHaveBeenCalled()
  })

  test('비교하기: 다른 번호로 부르고, 없는 상품(404)은 번호 확인 안내(다시 시도 없음)', async () => {
    const page = await open()
    fetchRecommendationComparison.mockRejectedValueOnce({ response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } })
    await setValue(byId(page.root, 'recommendation-product'), 999)
    await submitForm(compareForm(page.root))
    expect(fetchRecommendationComparison).toHaveBeenLastCalledWith(999, { limit: 10 })
    const compare = section(page.root, 'admin-recs-compare-title')
    expect(byRole(compare, 'alert').map(text)).toEqual(['상품을 찾을 수 없습니다. 번호를 확인해 주세요.'])
    expect(button(compare, '다시 시도')).toBeNull()
    expect(section(page.root, 'admin-recs-current-title')).toBeNull()
  })

  test('비교 오류(500) → 다시 시도는 같은 번호로 다시 부른다', async () => {
    fetchRecommendationComparison.mockRejectedValueOnce({ response: { status: 500 } })
    const page = await open()
    const compare = () => section(page.root, 'admin-recs-compare-title')
    expect(text(byRole(compare(), 'alert')[0])).toContain('추천 순위를 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(compare(), '다시 시도'))
    expect(fetchRecommendationComparison).toHaveBeenLastCalledWith(1, { limit: 10 })
    expect(section(page.root, 'admin-recs-current-title')).not.toBeNull()
  })

  test.each([[''], [0], [1.5], [-3]])('상품 번호가 잘못되면(%p) 요청하지 않고 안내한다', async (value) => {
    const page = await open()
    await setValue(byId(page.root, 'recommendation-product'), value)
    await submitForm(compareForm(page.root))
    expect(fetchRecommendationComparison).toHaveBeenCalledTimes(1)
    expect(text(byId(page.root, 'recommendation-product-error'))).toBe('상품 번호를 1 이상의 정수로 입력해 주세요.')
    expect(byId(page.root, 'recommendation-product').props['aria-invalid']).toBe('true')
  })

  test('비교 요청 경합: 늦게 온 이전 응답은 버린다. 비교 중에는 role=status', async () => {
    const page = await open()
    const slow = deferred()
    fetchRecommendationComparison.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(comparison({ product: { id: 3, name: '라이젠7 5700X', category: 'cpu', price_krw: 176400 } }))
    await setValue(byId(page.root, 'recommendation-product'), 2)
    await submitForm(compareForm(page.root))
    expect(byRole(section(page.root, 'admin-recs-compare-title'), 'status').map(text)).toEqual(['추천 순위를 불러오는 중입니다...'])
    await setValue(byId(page.root, 'recommendation-product'), 3)
    await submitForm(compareForm(page.root))
    slow.resolve(comparison({ product: { id: 2, name: '늦게 온 상품', category: 'cpu', price_krw: 1 } }))
    await flush()
    expect(text(section(page.root, 'admin-recs-compare-title'))).toContain('3번 라이젠7 5700X')
    expect(text(section(page.root, 'admin-recs-compare-title'))).not.toContain('늦게 온 상품')
  })

  test('학습 뒤 학습 기록을 다시 부르지 못하면 지금 표를 둔 채 role=alert + 다시 시도', async () => {
    const page = await open()
    trainRecommendations.mockResolvedValue(model(5))
    fetchRecommendationModels.mockRejectedValueOnce({ response: { status: 500 } })
    await submitForm(trainForm(page.root))
    const history = () => section(page.root, 'admin-recs-history-title')
    expect(text(byRole(history(), 'alert')[0])).toContain('학습 기록을 다시 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(rows(history())[0]).toHaveLength(2)
    expect(byRole(section(page.root, 'admin-recs-train-title'), 'status')).toHaveLength(1)
    await click(button(history(), '다시 시도'))
    expect(byRole(history(), 'alert')).toEqual([])
  })
})
