// 상품 view model(src/stores/productViewModel.js)과 상품 경로(src/router/index.js).
import { jest } from '@jest/globals'
import {
  PRODUCT_CATEGORIES,
  catalogIntro,
  catalogRequest,
  catalogSearch,
  catalogTitle,
  categoryName,
  clearDetailFilters,
  compareToast,
  dropsLinkHref,
  formatCount,
  formatPrice,
  getProductImage,
  getProductPageState,
  getStockStatus,
  hasCatalogFilter,
  hasDetailFilter,
  isCatalogHome,
  maxOrderQuantity,
  productError,
  productPath,
  productSorts,
  pushCatalogQuery,
  readCatalogQuery,
  trendFilterChange,
} from './stores/productViewModel.js'
import { isLoginRoute, resolveProductRoute } from './router/index.js'

describe('카테고리·가격·재고 표시', () => {
  test('카테고리 코드 8개를 spec 순서대로 한글 이름으로 바꾼다', () => {
    expect(PRODUCT_CATEGORIES.map((item) => item.code)).toEqual(['cpu', 'mainboard', 'memory', 'gpu', 'storage', 'psu', 'case', 'cooler'])
  })

  test.each([
    ['cpu', 'CPU'], ['mainboard', '메인보드'], ['memory', '메모리'], ['gpu', '그래픽카드'],
    ['storage', '저장장치'], ['psu', '파워'], ['case', '케이스'], ['cooler', '쿨러'],
    ['monitor', '기타 부품'], [undefined, '기타 부품'],
  ])('%s → %s', (code, name) => expect(categoryName(code)).toBe(name))

  test.each([
    [899000, '899,000원'], [0, '0원'], [12500000, '12,500,000원'], [undefined, '0원'],
  ])('가격 %s → %s', (value, text) => expect(formatPrice(value)).toBe(text))

  test.each([
    [0, { label: '품절', tone: 'sold-out', soldOut: true }],
    [-3, { label: '품절', tone: 'sold-out', soldOut: true }],
    [1, { label: '1개 남음', tone: 'low', soldOut: false }],
    [5, { label: '5개 남음', tone: 'low', soldOut: false }],
    [6, { label: '구매 가능', tone: 'ok', soldOut: false }],
    [120, { label: '구매 가능', tone: 'ok', soldOut: false }],
  ])('재고 %s → %o', (stock, status) => expect(getStockStatus(stock)).toEqual(status))

  test.each([[0, 0], [3, 3], [10, 10], [42, 10], [-1, 0]])('재고 %s 이면 최대 %s개까지 고른다', (stock, max) => {
    expect(maxOrderQuantity(stock)).toBe(max)
  })

  test('이미지가 없으면 자리표시 이미지를 쓴다', () => {
    expect(getProductImage({ thumbnail_url: 'https://cdn.example.test/gpu.png' })).toBe('https://cdn.example.test/gpu.png')
    expect(getProductImage({ thumbnail_url: '' })).toBe('/product-placeholder.svg')
    expect(getProductImage(null)).toBe('/product-placeholder.svg')
  })

  test('상세 주소는 id 를 인코딩한다', () => {
    expect(productPath(3)).toBe('/products/3')
    expect(productPath('a/b')).toBe('/products/a%2Fb')
  })
})

describe('목록 주소 query', () => {
  test.each([
    ['', { category: '', search: '', sort: 'recommended', page: 1 }],
    ['?category=gpu&search=%20RTX%20&sort=price_desc&page=2', { category: 'gpu', search: 'RTX', sort: 'price_desc', page: 2 }],
    ['?category=monitor&sort=cheap&page=0', { category: '', search: '', sort: 'recommended', page: 1 }],
    ['?page=abc', { category: '', search: '', sort: 'recommended', page: 1 }],
    [`?search=${'가'.repeat(60)}`, { category: '', search: '가'.repeat(50), sort: 'recommended', page: 1 }],
  ])('%s 를 읽는다', (search, query) => expect(readCatalogQuery(search)).toEqual(query))

  test.each([
    [{ category: '', search: '', sort: 'recommended', page: 1 }, ''],
    [{ category: 'gpu', search: '', sort: 'recommended', page: 1 }, '?category=gpu'],
    [{ category: 'cpu', search: ' 라이젠 ', sort: 'newest', page: 3 }, '?category=cpu&search=%EB%9D%BC%EC%9D%B4%EC%A0%A0&sort=newest&page=3'],
  ])('%o → %s', (query, search) => expect(catalogSearch(query)).toBe(search))

  test('읽은 값으로 다시 만들면 같은 query 가 된다', () => {
    const search = '?category=memory&search=DDR5&sort=price_asc&page=2'
    expect(catalogSearch(readCatalogQuery(search))).toBe(search)
  })

  test('목록 상태를 /products 주소에 남긴다', () => {
    const history = { pushState: jest.fn() }
    pushCatalogQuery({ category: 'gpu', search: '', sort: 'recommended', page: 2 }, history)
    expect(history.pushState).toHaveBeenCalledWith({}, '', '/products?category=gpu&page=2')
  })

  test.each([
    [{ category: '', search: '' }, false], [{ category: 'gpu', search: '' }, true], [{ category: '', search: ' ssd ' }, true], [{ search: '  ' }, false],
    [{ search: '', dropping: true }, true], [{ search: '', storeLowest: false }, false],
  ])('필터 %o → %s', (query, expected) => expect(hasCatalogFilter(query)).toBe(expected))
})

describe('가격 추세 스위치(dropping·near_low·store_lowest)', () => {
  test.each([
    ['?dropping=1', { dropping: true }],
    ['?near_low=true&store_lowest=1', { nearLow: true, storeLowest: true }],
    ['?dropping=0&near_low=yes&store_lowest=', {}],
    ['?category=gpu&dropping=1&sort=drop_desc', { category: 'gpu', dropping: true, sort: 'drop_desc' }],
  ])('%s 를 읽는다(켠 것만 true 로 들어 있다)', (search, expected) => {
    expect(readCatalogQuery(search)).toEqual({ category: '', search: '', sort: 'recommended', page: 1, ...expected })
  })

  test.each([
    [{ dropping: true }, '?dropping=1'],
    [{ nearLow: true, storeLowest: true, sort: 'drop_desc', page: 2 }, '?near_low=1&store_lowest=1&sort=drop_desc&page=2'],
    [{ category: 'gpu', brand: 'MSI', maxPrice: 900000, dropping: true }, '?category=gpu&brand=MSI&max_price=900000&dropping=1'],
    [{ dropping: false, nearLow: undefined }, ''],
  ])('%o → %s', (query, search) => expect(catalogSearch(query)).toBe(search))

  test('읽은 값으로 다시 만들면 같은 query 가 된다', () => {
    const search = '?category=memory&min_price=10000&dropping=1&near_low=1&store_lowest=1&sort=drop_desc&page=3'
    expect(catalogSearch(readCatalogQuery(search))).toBe(search)
  })

  test.each([
    [{ dropping: true }, { dropping: true }],
    [{ nearLow: true, storeLowest: true }, { nearLow: true, storeLowest: true }],
    [{ dropping: false, nearLow: undefined, storeLowest: null }, {}],
  ])('요청 인자 %o → 켠 것만 true 로 보낸다', (filters, expected) => {
    expect(catalogRequest({ category: '', search: '', sort: 'recommended', page: 1, ...filters })).toEqual({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20, ...expected })
  })

  test.each([
    [{}, false], [{ brand: 'MSI' }, true], [{ minPrice: 0 }, true], [{ dropping: true }, true], [{ nearLow: true }, true], [{ storeLowest: true }, true], [{ dropping: false }, false],
  ])('상세 필터 %o → %s', (query, expected) => expect(hasDetailFilter(query)).toBe(expected))

  test.each([
    ['켬', {}, 'dropping', true, { changes: { dropping: true, page: 1 }, event: { field: 'dropping', value: true } }],
    ['끔', { nearLow: true }, 'nearLow', false, { changes: { nearLow: undefined, page: 1 }, event: { field: 'near_low', value: null } }],
    ['그대로', { storeLowest: true }, 'storeLowest', true, { changes: { storeLowest: true, page: 1 }, event: null }],
    ['모르는 스위치', {}, 'cheap', true, null],
  ])('스위치 %s', (_name, query, key, on, expected) => expect(trendFilterChange(query, key, on)).toEqual(expected))

  test.each([
    ['걸린 것이 없으면 이벤트 없음', {}, []],
    ['브랜드·가격', { brand: 'MSI', maxPrice: 500000 }, [{ field: 'brand', value: null }, { field: 'price', value: [null, null] }]],
    ['스위치', { dropping: true, storeLowest: true }, [{ field: 'dropping', value: null }, { field: 'store_lowest', value: null }]],
  ])('필터 초기화: %s', (_name, query, events) => {
    const result = clearDetailFilters({ category: 'gpu', search: 'RTX', ...query })
    expect(result.events).toEqual(events)
    expect(result.changes).toEqual({ brand: undefined, minPrice: undefined, maxPrice: undefined, dropping: undefined, nearLow: undefined, storeLowest: undefined, page: 1 })
  })

  test('하락폭순은 추천순 다음에 있고, 가성비순은 카테고리를 고른 때만', () => {
    expect(productSorts('').map((item) => item.value)).toEqual(['recommended', 'drop_desc', 'price_asc', 'price_desc', 'newest', 'rating_desc'])
    expect(productSorts('gpu').map((item) => item.label)).toEqual(['추천순', '하락폭순', '낮은 가격순', '높은 가격순', '최신순', '평점순', '가성비순'])
    expect(readCatalogQuery('?sort=drop_desc').sort).toBe('drop_desc')
  })
})

describe('첫 화면(목록 제목·하락 줄·소개·토스트)', () => {
  test.each([
    [{}, '전체 상품'],
    [{ category: 'gpu' }, '그래픽카드'],
    [{ category: 'gpu', search: ' RTX ' }, '"RTX" 검색 결과'],
    [{ search: '   ' }, '전체 상품'],
  ])('목록 제목 %o → %s', (query, title) => expect(catalogTitle(query)).toBe(title))

  test.each([
    [{ category: '', search: '', sort: 'recommended', page: 1 }, true],
    [{ category: '', search: '', sort: 'price_desc', page: 1 }, true],
    [{ category: '', search: '', sort: 'recommended', page: 2 }, false],
    [{ category: 'cpu', search: '', page: 1 }, false],
    [{ category: '', search: 'RTX', page: 1 }, false],
    [{ category: '', search: '', page: 1, brand: 'MSI' }, false],
    [{ category: '', search: '', page: 1, minPrice: 0 }, false],
    [{ category: '', search: '', page: 1, dropping: true }, false],
  ])('하락 줄을 보여 줄 첫 화면인가 %o → %s', (query, expected) => expect(isCatalogHome(query)).toBe(expected))

  test.each([
    [true, '#drops'],
    [false, '/products?dropping=1&sort=drop_desc'],
  ])('"하락 중인 부품 보기" 링크(하락 줄 보임 %s) → %s', (visible, href) => expect(dropsLinkHref(visible)).toBe(href))

  const rest = '매일 기록하고, 1년 최저가와 타 쇼핑몰 가격을 함께 보여드려요. 원하는 가격을 등록하면 도달했을 때 알려드립니다.'
  test.each([
    [409, `409개 부품의 판매가를 ${rest}`],
    [1234, `1,234개 부품의 판매가를 ${rest}`],
    [null, `부품 판매가를 ${rest}`],
    [0, `부품 판매가를 ${rest}`],
    ['abc', `부품 판매가를 ${rest}`],
  ])('소개 문구(상품 %s개)', (count, text) => expect(catalogIntro(count)).toBe(text))

  test.each([[37, '37'], [1234, '1,234'], [0, '0'], [null, '-'], [undefined, '-'], ['', '-'], ['x', '-']])('요약 숫자 %s → %s', (value, text) => {
    expect(formatCount(value)).toBe(text)
  })

  test.each([
    ['added', '비교에 추가했어요'], ['removed', '비교에서 제거했어요'], ['full', null], ['category', null], ['exists', null], ['unavailable', null],
  ])('비교 토글 결과 %s → 토스트 %s', (result, message) => expect(compareToast(result)).toBe(message))
})

describe('화면 상태와 오류 문구', () => {
  const product = { id: 3, name: '지포스 RTX 4070 SUPER 12GB' }

  test.each([
    [{ loading: true }, 'loading'],
    [{ loading: false, error: '실패' }, 'error'],
    [{ loading: false, products: [] }, 'empty'],
    [{ loading: false, products: [product] }, 'ready'],
    [{ loading: false, missing: true, detail: true }, 'missing'],
    [{ loading: false, product: null, detail: true }, 'missing'],
    [{ loading: false, error: '실패', detail: true }, 'error'],
    [{ loading: false, product, detail: true }, 'ready'],
  ])('%o → %s', (data, state) => expect(getProductPageState(data)).toBe(state))

  const fallback = '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.'
  test.each([
    ['서버 오류(500)는 우리 문구', { response: { status: 500, data: { message: '서버 오류가 발생했습니다.' } } }, fallback],
    ['네트워크 오류는 우리 문구', { isAxiosError: true, code: 'ERR_NETWORK' }, fallback],
    ['422 는 서버 문구', { response: { status: 422, data: { message: '카테고리 값이 올바르지 않습니다.' } } }, '카테고리 값이 올바르지 않습니다.'],
    ['HTML 응답은 우리 문구', { response: { status: 404, data: '<html>' } }, fallback],
  ])('%s', (_name, error, message) => expect(productError(error, fallback)).toBe(message))
})

describe('상품 경로', () => {
  test.each([
    ['/', { name: 'products' }],
    ['/products', { name: 'products' }],
    ['/products/', { name: 'products' }],
    ['/products/3', { name: 'product-detail', id: 3 }],
    ['/products/3/', { name: 'product-detail', id: 3 }],
    ['/products/abc', { name: 'product-detail', id: null }],
    ['/products/0', { name: 'product-detail', id: null }],
    ['/products/99999999999999999999', { name: 'product-detail', id: null }],
    ['/unknown/7', { name: 'products' }],
    ['/orders', { name: 'products' }],
  ])('%s → %o (알 수 없는 경로는 상품 목록)', (path, route) => expect(resolveProductRoute(path)).toEqual(route))

  test.each([['/login', true], ['/login/kakao/callback', true], ['/loginx', false], ['/', false]])('로그인 경로 %s → %s', (path, expected) => {
    expect(isLoginRoute(path)).toBe(expected)
  })
})
