// 상품 목록(views/ProductCatalog.vue)과 상품 상세(views/ProductDetail.vue)의 상태별 렌더링과 동작.
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, stub, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

// 비교함(localStorage moa.compare) 대신 쓰는 메모리 저장소
function memoryCompare() {
  let value = null
  return { available: true, get: () => value, set: (next) => { value = next; return true } }
}

const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용 그래픽카드' }
const cpu = { id: 1, name: '라이젠 7 7800X3D', brand: 'AMD', category: 'cpu', price_krw: 489000, stock: 3, thumbnail_url: '', summary: '8코어 게이밍 CPU' }
const productPage = (items, total = items.length, page = 1) => ({ items, total, page, page_size: 20 })
const trend = { change_30d_pct: -8.4, lowest_1y_krw: 820000, is_lowest_1y: false, lowest_gap_pct: 2.2, sparkline_30d: [981000, 899000], external_lowest: null, store_is_lowest: true, store_gap_krw: null }
const dropped = { ...gpu, id: 7, price_trend: trend }

describe('상품 목록', () => {
  const fetchProducts = jest.fn()
  const fetchProductFacets = jest.fn()
  const fetchPriceSummary = jest.fn()
  const fetchDropProducts = jest.fn()
  const addCartItem = jest.fn()
  const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
  let ProductCatalog
  let browser

  function open(search = '') {
    browser = {
      location: { search },
      history: { pushState: jest.fn() },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      scrollTo: jest.fn(),
    }
    global.window = browser
    return mount(ProductCatalog)
  }
  const drops = (page) => stub(page.root, 'ProductDropList')
  const grid = (page) => stub(page.root, 'ProductGrid').props
  const hero = (page) => find(page.root, (node) => node.props.class === 'catalog-hero')

  beforeAll(async () => {
    ProductCatalog = await compileSfc('views/ProductCatalog.vue', { fetchProducts, fetchProductFacets, fetchPriceSummary, fetchDropProducts, addCartItem, siteStatus, browserCompareStorage: () => memoryCompare() })
  })
  beforeEach(() => {
    fetchProducts.mockReset()
    fetchProductFacets.mockReset().mockResolvedValue({ brands: [], price_min: null, price_max: null })
    fetchPriceSummary.mockReset().mockResolvedValue({ product_count: 409, dropping_count: 37, lowest_1y_count: 52 })
    fetchDropProducts.mockReset().mockResolvedValue(productPage([dropped]))
    addCartItem.mockReset()
    Object.values(siteStatus).forEach((fn) => fn.mockReset())
  })
  afterEach(() => { delete global.window })

  test('로딩 → 목록. 기본 조건으로 부르고 상품 수와 페이지를 보여 준다', async () => {
    const response = deferred()
    fetchProducts.mockReturnValue(response.promise)
    const page = open()
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('상품을 불러오는 중입니다...')
    expect(fetchProducts).toHaveBeenCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20 })
    response.resolve(productPage([gpu, cpu], 45))
    await flush()
    expect(byRole(page.root, 'status')).toHaveLength(0)
    expect(stub(page.root, 'ProductGrid').props.products).toEqual([gpu, cpu])
    expect(text(byId(page.root, 'catalog-title'))).toBe('전체 상품')
    expect(text(page.root)).toContain('전체 상품45개')
    expect(text(page.root)).toContain('1 / 3')
    expect(button(page.root, '이전').props.disabled).toBe(true)
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('products')
  })

  test('주소 query 로 카테고리·검색어·정렬·쪽을 이어 받는다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu], 21, 2))
    const page = open('?category=gpu&search=RTX&sort=price_asc&page=2')
    await flush()
    expect(fetchProducts).toHaveBeenCalledWith({ category: 'gpu', search: 'RTX', sort: 'price_asc', page: 2, pageSize: 20 })
    expect(text(byId(page.root, 'catalog-title'))).toBe('"RTX" 검색 결과')
    expect(grid(page).label).toBe('"RTX" 검색 결과 목록')
    expect(button(page.root, '그래픽카드').props['aria-pressed']).toBe(true)
    expect(button(page.root, '전체').props['aria-pressed']).toBe(false)
    expect(byId(page.root, 'product-sort').props.value).toBe('price_asc')
    expect(stub(page.root, 'ProductSearchBar').props.keyword).toBe('RTX')
    expect(text(page.root)).toContain('2 / 2')
  })

  test('실패하면 오류와 다시 시도, 다시 시도하면 다시 부른다', async () => {
    fetchProducts.mockRejectedValueOnce({ response: { status: 500, data: { message: 'Internal Server Error' } } }).mockResolvedValue(productPage([gpu]))
    const page = open()
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchProducts).toHaveBeenCalledTimes(2)
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(stub(page.root, 'ProductGrid').props.products).toEqual([gpu])
  })

  test('조건에 맞는 상품이 없으면 안내와 전체 보기 링크를 보여 준다', async () => {
    fetchProducts.mockResolvedValue(productPage([]))
    const page = open('?category=cooler&search=없는부품')
    await flush()
    expect(text(page.root)).toContain('조건에 맞는 부품이 없어요. 필터를 조정하거나 다른 검색어를 입력해 보세요.')
    expect(text(page.root)).toContain('"없는부품" 검색 결과0개')
    expect(link(page.root, '전체 보기').props.href).toBe('/products')
    expect(stub(page.root, 'ProductGrid')).toBeNull()
  })

  test('조건 없이 비어 있으면 전체 보기 링크 없이 준비 중 안내를 보여 준다', async () => {
    fetchProducts.mockResolvedValue(productPage([]))
    const page = open()
    await flush()
    expect(text(page.root)).not.toContain('조건에 맞는 부품이 없어요.')
    expect(text(page.root)).toContain('상품을 준비하고 있습니다.')
    expect(link(page.root, '전체 보기')).toBeNull()
  })

  test('카테고리를 누르면 1쪽부터 다시 부르고 주소에 남긴다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu], 45))
    const page = open('?page=2')
    await flush()
    await click(button(page.root, '그래픽카드'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu')
    expect(text(page.root)).toContain('그래픽카드')
    await click(button(page.root, '전체'))
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products')
  })

  test('검색은 검색창의 search 이벤트로, 정렬은 select 변경으로 1쪽부터 다시 부른다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu]))
    const page = open('?category=gpu')
    await flush()
    stub(page.root, 'ProductSearchBar').props.onSearch('RTX 4070')
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: 'RTX 4070', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&search=RTX+4070')
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'price_desc' } })
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: 'RTX 4070', sort: 'price_desc', page: 1, pageSize: 20 })
  })

  test('다음 쪽을 누르면 쪽 번호를 바꿔 부르고 맨 위로 올린다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu], 45))
    const page = open()
    await flush()
    await click(button(page.root, '다음'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 2, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?page=2')
    expect(browser.scrollTo).toHaveBeenCalled()
    expect(text(page.root)).toContain('2 / 3')
  })

  test('늦게 온 이전 응답은 화면을 덮지 않는다', async () => {
    const slow = deferred()
    fetchProducts.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(productPage([cpu]))
    const page = open()
    await flush()
    await click(button(page.root, 'CPU'))
    slow.resolve(productPage([gpu]))
    await flush()
    expect(stub(page.root, 'ProductGrid').props.products).toEqual([cpu])
  })

  test('뒤로 가기(popstate)를 하면 주소의 query 로 다시 부른다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu]))
    const page = open('?category=gpu')
    await flush()
    const [event, handler] = browser.addEventListener.mock.calls.find(([name]) => name === 'popstate')
    expect(event).toBe('popstate')
    browser.location.search = '?category=memory&search=DDR5'
    handler()
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'memory', search: 'DDR5', sort: 'recommended', page: 1, pageSize: 20 })
    expect(stub(page.root, 'ProductSearchBar').props.keyword).toBe('DDR5')
    page.unmount()
    expect(browser.removeEventListener).toHaveBeenCalledWith('popstate', handler)
  })

  test('목록 조건이 같은 popstate(#drops 같은 쪽 안 이동)는 다시 부르지 않는다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu]))
    open('?category=gpu')
    await flush()
    const [, handler] = browser.addEventListener.mock.calls.find(([name]) => name === 'popstate')
    handler()
    await flush()
    expect(fetchProducts).toHaveBeenCalledTimes(1)
  })

  test('필터 버튼(좁은 화면)은 필터 칸을 열고 닫는다', async () => {
    fetchProducts.mockResolvedValue(productPage([gpu]))
    const page = open()
    await flush()
    const toggle = () => button(page.root, '필터')
    expect(toggle().props).toMatchObject({ type: 'button', 'aria-expanded': false, 'aria-controls': 'catalog-filters' })
    await click(toggle())
    expect(toggle().props['aria-expanded']).toBe(true)
    expect(byId(page.root, 'catalog-filters').props.class).toContain('catalog-filters--open')
  })

  describe('소개·가격 요약(GET /products/price-summary)', () => {
    test('받기 전에는 숫자 없이 로딩, 받으면 상품 수 문구와 숫자 칸(30일 하락·1년 최저·가격 기록)', async () => {
      const summary = deferred()
      fetchPriceSummary.mockReturnValue(summary.promise)
      fetchProducts.mockResolvedValue(productPage([gpu]))
      const page = open()
      await flush()
      expect(fetchPriceSummary).toHaveBeenCalledTimes(1)
      expect(text(hero(page))).toContain('MOA PARTS · 가격 추적')
      expect(text(byId(page.root, 'catalog-hero-title'))).toBe('부품 가격,떨어질 때 사세요')
      expect(find(hero(page), (node) => node.type === 'img').props).toMatchObject({ src: '/images/logo.png', alt: '' })
      expect(text(byRole(hero(page), 'status')[0])).toBe('가격 요약을 불러오는 중입니다...')
      expect(text(hero(page))).toContain('부품 판매가를 매일 기록하고')
      expect(text(hero(page))).toContain('가격 기록365일 · 매일 자정 갱신')
      expect(link(page.root, '예산으로 견적 받기').props.href).toBe('/community/build/new')
      summary.resolve({ product_count: 409, dropping_count: 37, lowest_1y_count: 1052 })
      await flush()
      expect(byRole(hero(page), 'status')).toHaveLength(0)
      expect(text(hero(page))).toContain('409개 부품의 판매가를 매일 기록하고, 1년 최저가와 타 쇼핑몰 가격을 함께 보여드려요. 원하는 가격을 등록하면 도달했을 때 알려드립니다.')
      expect(text(hero(page))).toContain('30일 동안 내려간 부품37개')
      expect(text(hero(page))).toContain('지금 1년 최저가인 부품1,052개')
    })

    test('요약이 실패해도 목록은 보이고, 요약 칸에 오류와 다시 시도를 준다', async () => {
      fetchPriceSummary.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue({ product_count: 409, dropping_count: 37, lowest_1y_count: 52 })
      fetchProducts.mockResolvedValue(productPage([gpu]))
      const page = open()
      await flush()
      expect(grid(page).products).toEqual([gpu])
      const alert = byRole(hero(page), 'alert')[0]
      expect(text(alert)).toContain('가격 요약을 불러오지 못했습니다. 다시 시도해 주세요.')
      expect(text(hero(page))).toContain('부품 판매가를')
      expect(text(hero(page))).not.toContain('30일 동안 내려간 부품')
      await click(button(alert, '다시 시도'))
      expect(fetchPriceSummary).toHaveBeenCalledTimes(2)
      expect(fetchProducts).toHaveBeenCalledTimes(1)
      expect(byRole(hero(page), 'alert')).toHaveLength(0)
      expect(text(hero(page))).toContain('409개 부품의 판매가를')
      expect(text(hero(page))).toContain('지금 1년 최저가인 부품52개')
    })
  })

  describe('30일 하락폭 큰 부품 줄', () => {
    test('첫 화면(조건 없는 1쪽)은 따로 불러(하락 중·하락폭순·10개) 보여 주고, "하락 중인 부품 보기"는 그 영역(#drops)으로 간다', async () => {
      const response = deferred()
      fetchDropProducts.mockReturnValue(response.promise)
      fetchProducts.mockResolvedValue(productPage([gpu]))
      const page = open()
      await flush()
      expect(fetchDropProducts).toHaveBeenCalledWith({ dropping: true, sort: 'drop_desc', pageSize: 10 })
      expect(drops(page).props).toMatchObject({ id: 'drops', state: 'loading' })
      expect(link(page.root, '하락 중인 부품 보기').props.href).toBe('#drops')
      response.resolve(productPage([dropped]))
      await flush()
      expect(drops(page).props).toMatchObject({ state: 'ready', items: [dropped] })
      expect(grid(page).products).toEqual([gpu])
      expect(fetchProducts).toHaveBeenCalledTimes(1)
    })

    test('하락한 부품이 없으면 줄을 숨기고, "하락 중인 부품 보기"는 하락 중 + 하락폭순 목록으로 간다', async () => {
      fetchDropProducts.mockResolvedValue(productPage([]))
      fetchProducts.mockResolvedValue(productPage([gpu]))
      const page = open()
      await flush()
      expect(drops(page)).toBeNull()
      expect(link(page.root, '하락 중인 부품 보기').props.href).toBe('/products?dropping=1&sort=drop_desc')
    })

    test('실패하면 그 영역만 오류(다시 시도 → 다시 부른다). 목록은 그대로', async () => {
      fetchDropProducts.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValue(productPage([dropped]))
      fetchProducts.mockResolvedValue(productPage([gpu]))
      const page = open()
      await flush()
      expect(drops(page).props).toMatchObject({ state: 'error', error: '하락한 부품을 불러오지 못했습니다. 다시 시도해 주세요.' })
      expect(grid(page).products).toEqual([gpu])
      expect(link(page.root, '하락 중인 부품 보기').props.href).toBe('#drops')
      drops(page).props.onRetry()
      await flush()
      expect(fetchDropProducts).toHaveBeenCalledTimes(2)
      expect(drops(page).props).toMatchObject({ state: 'ready', items: [dropped] })
    })

    test('카테고리·검색·필터가 있거나 2쪽이면 부르지도 보이지도 않고, 첫 화면으로 돌아오면 한 번만 부른다', async () => {
      fetchProducts.mockResolvedValue(productPage([gpu], 45))
      const page = open('?category=gpu')
      await flush()
      expect(fetchDropProducts).not.toHaveBeenCalled()
      expect(drops(page)).toBeNull()
      expect(link(page.root, '하락 중인 부품 보기').props.href).toBe('/products?dropping=1&sort=drop_desc')
      await click(button(page.root, '전체'))
      expect(fetchDropProducts).toHaveBeenCalledTimes(1)
      expect(drops(page).props.state).toBe('ready')
      await click(button(page.root, '다음'))
      expect(drops(page)).toBeNull()
      await click(button(page.root, '이전'))
      expect(drops(page)).not.toBeNull()
      expect(fetchDropProducts).toHaveBeenCalledTimes(1)
    })

    test.each([['?search=RTX'], ['?brand=MSI'], ['?near_low=1'], ['?page=2']])('%s 로 열면 부르지 않는다', async (search) => {
      fetchProducts.mockResolvedValue(productPage([gpu], 45))
      const page = open(search)
      await flush()
      expect(fetchDropProducts).not.toHaveBeenCalled()
      expect(drops(page)).toBeNull()
    })
  })

  describe('카드의 담기·비교 토글', () => {
    test('담기: 그 카드만 담는 중으로 막고(두 번 보내지 않는다), 성공하면 헤더 장바구니 수와 토스트', async () => {
      fetchProducts.mockResolvedValue(productPage([gpu, cpu]))
      const response = deferred()
      addCartItem.mockReturnValue(response.promise)
      const page = open()
      await flush()
      expect(grid(page)['adding-ids']).toEqual([])
      grid(page).onAddToCart(gpu)
      grid(page).onAddToCart(gpu)
      await flush()
      expect(addCartItem).toHaveBeenCalledTimes(1)
      expect(addCartItem).toHaveBeenCalledWith({ productId: 3, quantity: 1 })
      expect(grid(page)['adding-ids']).toEqual([3])
      response.resolve({ items: [{ product_id: 3, price_krw: 899000, quantity: 1 }], item_count: 4, total_krw: 899000 })
      await flush()
      expect(grid(page)['adding-ids']).toEqual([])
      expect(siteStatus.setCartCount).toHaveBeenCalledWith(4)
      expect(siteStatus.showToast).toHaveBeenCalledWith('장바구니에 담았어요')
    })

    test.each([
      ['비로그인(401)은 로그인 안내', { response: { status: 401, data: { message: 'Authentication required.' } } }, '로그인이 필요해요'],
      ['재고 부족(409)은 서버 문구', { response: { status: 409, data: { message: "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다." } } }, "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다."],
      ['서버 오류는 우리 문구', { response: { status: 500, data: { message: 'Internal Server Error' } } }, '장바구니에 담지 못했습니다. 다시 시도해 주세요.'],
    ])('담기 실패: %s 토스트. 화면은 그대로이고 버튼은 다시 누를 수 있다', async (_name, failure, message) => {
      fetchProducts.mockResolvedValue(productPage([gpu]))
      addCartItem.mockRejectedValue(failure)
      const page = open()
      await flush()
      await grid(page).onAddToCart(gpu)
      await flush()
      expect(siteStatus.showToast).toHaveBeenCalledWith(message)
      expect(siteStatus.setCartCount).not.toHaveBeenCalled()
      expect(grid(page)['adding-ids']).toEqual([])
      expect(grid(page).products).toEqual([gpu])
      expect(browser.history.pushState).not.toHaveBeenCalled()
    })

    test('비교 토글은 헤더 비교 수와 토스트(추가·제거)를 알리고, 다른 카테고리는 토스트 없이 비교함 막대가 안내한다', async () => {
      fetchProducts.mockResolvedValue(productPage([gpu, cpu]))
      const page = open()
      await flush()
      grid(page).onToggleCompare(gpu)
      await flush()
      expect(grid(page)['compare-ids']).toEqual([3])
      expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(1)
      expect(siteStatus.showToast).toHaveBeenLastCalledWith('비교에 추가했어요')
      grid(page).onToggleCompare(cpu)
      await flush()
      expect(siteStatus.showToast).toHaveBeenCalledTimes(1)
      expect(stub(page.root, 'ProductCompareBar').props.notice).toMatchObject({ kind: 'category' })
      grid(page).onToggleCompare(gpu)
      await flush()
      expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(0)
      expect(siteStatus.showToast).toHaveBeenLastCalledWith('비교에서 제거했어요')
    })
  })
})

describe('상품 상세', () => {
  const fetchProduct = jest.fn()
  const addCartItem = jest.fn()
  const goToCheckout = jest.fn()
  const fetchPriceHistory = jest.fn()
  const fetchProductReviews = jest.fn()
  const fetchCurrentUser = jest.fn()
  const fetchQuestions = jest.fn()
  const fetchAlerts = jest.fn()
  const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
  const authSession = createAuthSession({ fetchCurrentUser })
  const trend = {
    change_30d_pct: -2.1, lowest_1y_krw: 879000, lowest_1y_on: '2026-11-05', highest_1y_krw: 949000, average_30d_krw: 905000, is_lowest_1y: false, lowest_gap_pct: 2.3,
    sparkline_30d: [949000, 899000], external_lowest: { source: 'coupang', price_krw: 905000 }, store_is_lowest: true, store_gap_krw: 6000,
  }
  const detail = { ...gpu, description: '첫 줄\n둘째 줄', specs: [{ label: '칩셋', value: 'AD104' }, { label: '메모리', value: 'GDDR6X 12GB' }], price_trend: trend, store_prices: [] }
  let ProductDetail
  let compareStorage
  const card = (page) => stub(page.root, 'ProductPurchaseCard').props

  // 추천 상품 영역(spec docs/specs/2026-11-03-product-recommendations.md)은 src/recommendationView.test.mjs 가,
  // 목표가 알림·가격 추이 기간·판매처 비교·관련 질문은 src/productDetailPriceView.test.mjs 가 본다. 여기서는 빈 응답을 준다
  const fetchProductRecommendations = async () => ({ product_id: 3, model: null, items: [] })
  beforeAll(async () => {
    ProductDetail = await compileSfc('views/ProductDetail.vue', {
      fetchProduct, addCartItem, goToCheckout, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations, fetchQuestions, fetchAlerts, authSession, siteStatus,
      browserCompareStorage: () => compareStorage,
    })
  })
  beforeEach(() => {
    compareStorage = memoryCompare()
    fetchProduct.mockReset(); addCartItem.mockReset(); goToCheckout.mockReset()
    fetchPriceHistory.mockReset().mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    fetchProductReviews.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, my_review: null, can_review: false })
    fetchQuestions.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 })
    fetchAlerts.mockReset().mockResolvedValue({ items: [] })
    fetchCurrentUser.mockReset().mockRejectedValue({ response: { status: 401 } })
    for (const mock of Object.values(siteStatus)) mock.mockReset()
    authSession.reset()
  })

  test.each([null, 0, -1])('잘못된 id(%s)는 부르지 않고 목록 링크를 준다', async (productId) => {
    const page = mount(ProductDetail, { productId })
    await flush()
    expect(fetchProduct).not.toHaveBeenCalled()
    expect(text(byRole(page.root, 'alert')[0])).toContain('올바르지 않은 상품 주소입니다.')
    expect(link(page.root, '상품 목록 보기').props.href).toBe('/products')
  })

  test('로딩 → 상세: 브레드크럼·사진(배지)·요약·가격 카드·구매 카드·사양표·설명을 보여 준다', async () => {
    const response = deferred()
    fetchProduct.mockReturnValue(response.promise)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(fetchProduct).toHaveBeenCalledWith(3)
    expect(text(byRole(page.root, 'status')[0])).toBe('상품 정보를 불러오는 중입니다...')
    response.resolve({ ...detail, is_new: true })
    await flush()
    const crumbs = find(page.root, (node) => node.type === 'nav' && node.props['aria-label'] === '현재 위치')
    expect(findAll(crumbs, (node) => node.type === 'a').map((node) => [text(node), node.props.href])).toEqual([['상품', '/products'], ['그래픽카드', '/products?category=gpu']])
    expect(text(find(crumbs, (node) => node.props['aria-current'] === 'page'))).toBe(gpu.name)
    const figure = find(page.root, (node) => node.type === 'figure')
    expect(find(figure, (node) => node.type === 'img').props).toMatchObject({ src: '/product-placeholder.svg', alt: `${gpu.name} 이미지` })
    expect(text(figure)).toBe('NEW')
    expect(stub(page.root, 'ProductSummary').props).toMatchObject({ name: gpu.name, brand: 'MSI', 'category-name': '그래픽카드', summary: gpu.summary })
    expect(stub(page.root, 'ProductPriceSummary').props).toMatchObject({ price: 899000, trend })
    expect(card(page)).toMatchObject({ stock: 7, quantity: 1, adding: false })
    expect(text(page.root)).toContain('칩셋AD104')
    expect(text(page.root)).toContain('메모리GDDR6X 12GB')
    expect(text(page.root)).toContain('첫 줄\n둘째 줄')
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('products')
  })

  test.each([
    ['1년 최저', { ...trend, is_lowest_1y: true }, false],
    ['가격 하락', { ...trend, change_30d_pct: -6 }, false],
    ['NEW', null, true],
  ])('사진 배지 "%s"', async (label, priceTrend, isNew) => {
    fetchProduct.mockResolvedValue({ ...detail, price_trend: priceTrend, is_new: isNew })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(text(find(page.root, (node) => node.type === 'figure'))).toBe(label)
  })

  test('평점이 있으면 요약 윗줄에 평점(ProductRating), 없으면 없다', async () => {
    fetchProduct.mockResolvedValue({ ...detail, rating_average: 4.5, review_count: 12 })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(stub(stub(page.root, 'ProductSummary'), 'ProductRating').props).toMatchObject({ average: 4.5, count: 12 })
    fetchProduct.mockResolvedValue({ ...detail, rating_average: null, review_count: 0 })
    const empty = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(stub(empty.root, 'ProductRating')).toBeNull()
  })

  test('사양이 없으면 안내 문구를 보여 준다', async () => {
    fetchProduct.mockResolvedValue({ ...detail, specs: [] })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(text(page.root)).toContain('등록된 사양 정보가 없습니다.')
  })

  test('404 는 찾을 수 없음과 목록 링크(다시 시도 없음)', async () => {
    fetchProduct.mockRejectedValue({ response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } })
    const page = mount(ProductDetail, { productId: 404 })
    await flush()
    expect(text(page.root)).toContain('상품을 찾을 수 없습니다.')
    expect(link(page.root, '상품 목록 보기').props.href).toBe('/products')
    expect(button(page.root, '다시 시도')).toBeNull()
  })

  test('서버 오류는 다시 시도, 다시 시도하면 상세를 보여 준다', async () => {
    fetchProduct.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValue(detail)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('상품 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(fetchProduct).toHaveBeenCalledTimes(2)
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
  })

  test('고른 수량으로 장바구니에 담고, 담는 중에는 두 번 보내지 않으며, 성공하면 장바구니 보기 링크·헤더 수량·토스트', async () => {
    fetchProduct.mockResolvedValue(detail)
    const response = deferred()
    addCartItem.mockReturnValue(response.promise)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    card(page)['onUpdate:quantity'](2)
    await flush()
    expect(card(page).quantity).toBe(2)
    card(page).onAddToCart()
    card(page).onAddToCart()
    await flush()
    expect(addCartItem).toHaveBeenCalledTimes(1)
    expect(addCartItem).toHaveBeenCalledWith({ productId: 3, quantity: 2 })
    expect(card(page).adding).toBe(true)
    response.resolve({ items: [], item_count: 2, total_krw: 1798000 })
    await flush()
    expect(card(page).adding).toBe(false)
    expect(text(byRole(page.root, 'status')[0])).toContain('장바구니에 담았습니다.')
    expect(link(page.root, '장바구니 보기').props.href).toBe('/cart')
    expect(siteStatus.setCartCount).toHaveBeenCalledWith(2)
    expect(siteStatus.showToast).toHaveBeenCalledWith('장바구니에 담았어요')
  })

  test('비로그인(401)이면 로그인 안내와 로그인 링크를 보여 준다(헤더 수량·토스트 없음)', async () => {
    fetchProduct.mockResolvedValue(detail)
    addCartItem.mockRejectedValue({ response: { status: 401, data: { message: 'Authentication required.' } } })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    await card(page).onAddToCart()
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('로그인 후 이용할 수 있습니다.')
    expect(link(page.root, '로그인하기').props.href).toBe('/login')
    expect(link(page.root, '장바구니 보기')).toBeNull()
    expect(siteStatus.setCartCount).not.toHaveBeenCalled()
    expect(siteStatus.showToast).not.toHaveBeenCalled()
  })

  test('재고 부족(409)은 서버 message 를 그대로 보여 준다', async () => {
    fetchProduct.mockResolvedValue(detail)
    addCartItem.mockRejectedValue({ response: { status: 409, data: { message: "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다. 최대 7개까지 주문할 수 있습니다." } } })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    await card(page).onAddToCart()
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain("'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다. 최대 7개까지 주문할 수 있습니다.")
  })

  test('바로 구매는 상품 id 와 고른 수량으로 주문서로 이동만 한다', async () => {
    fetchProduct.mockResolvedValue(detail)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    card(page)['onUpdate:quantity'](3)
    await flush()
    card(page).onBuyNow()
    expect(goToCheckout).toHaveBeenCalledWith({ productId: 3, quantity: 3 })
    expect(addCartItem).not.toHaveBeenCalled()
  })

  test('품절 상품도 상세를 보여 주고 재고 0 을 구매 카드에 넘긴다', async () => {
    fetchProduct.mockResolvedValue({ ...detail, stock: 0 })
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(card(page)).toMatchObject({ stock: 0, quantity: 1 })
  })

  test('비교함 담기·빼기는 구매 영역 옆(밖) 버튼이고, 토스트와 헤더의 비교함 개수를 맞춘다', async () => {
    fetchProduct.mockResolvedValue(detail)
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(button(stub(page.root, 'ProductPurchaseCard'), '비교함')).toBeNull()
    const actions = () => find(page.root, (node) => node.props.class === 'pd-buy__more')
    expect(find(page.root, (node) => node.props.class === 'pd-buy').children[0].props['data-stub']).toBe('ProductPurchaseCard')
    await click(button(actions(), '비교함에 담기'))
    expect(siteStatus.showToast).toHaveBeenLastCalledWith('비교에 추가했어요')
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(1)
    expect(stub(page.root, 'ProductCompareBar').props.items.map((item) => item.id)).toEqual([3])
    await click(button(actions(), '비교함에서 빼기'))
    expect(siteStatus.showToast).toHaveBeenLastCalledWith('비교에서 제거했어요')
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(0)
    expect(stub(page.root, 'ProductCompareBar').props.items).toEqual([])
  })
})
