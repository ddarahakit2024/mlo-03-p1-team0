// 상품 view model(src/stores/productViewModel.js)의 기능 확장 1차: 정렬·브랜드·가격대 필터, 평점·출시일·성능·가성비·90일 최저가 표시, 영역 상태.
import {
  brandLabel,
  brandOptions,
  catalogRequest,
  catalogSearch,
  formatReleaseDate,
  formatScore,
  formatValueScore,
  getSectionState,
  hasCatalogFilter,
  hasDetailFilter,
  lowestPriceInfo,
  parsePriceInput,
  productSorts,
  ratingSummary,
  readCatalogQuery,
  validatePriceRange,
} from './stores/productViewModel.js'

describe('정렬·필터', () => {
  test('가성비순은 카테고리를 고른 때만, 평점순·하락폭순은 언제나 고를 수 있다', () => {
    expect(productSorts('').map((item) => item.value)).toEqual(['recommended', 'drop_desc', 'price_asc', 'price_desc', 'newest', 'rating_desc'])
    expect(productSorts('gpu').map((item) => item.value)).toEqual(['recommended', 'drop_desc', 'price_asc', 'price_desc', 'newest', 'rating_desc', 'value_desc'])
    expect(productSorts('gpu').find((item) => item.value === 'value_desc').label).toBe('가성비순')
    expect(productSorts('').find((item) => item.value === 'rating_desc').label).toBe('평점순')
  })

  test.each([
    ['', null], ['  ', null], ['0', 0], ['1,000,000', 1000000], [' 89 000 ', 89000], ['-1', NaN], ['1.5', NaN], ['abc', NaN], [undefined, null],
  ])('가격 입력 %p → %p', (value, expected) => expect(parsePriceInput(value)).toEqual(expected))

  test.each([
    ['', '', { minPrice: null, maxPrice: null, error: '' }],
    ['0', '100000000', { minPrice: 0, maxPrice: 100000000, error: '' }],
    ['500000', '', { minPrice: 500000, maxPrice: null, error: '' }],
    ['', '1,000,000', { minPrice: null, maxPrice: 1000000, error: '' }],
    ['300000', '300000', { minPrice: 300000, maxPrice: 300000, error: '' }],
    ['10만', '', { error: '최소 가격은 숫자로만 입력해 주세요.' }],
    ['', '-5', { error: '최대 가격은 숫자로만 입력해 주세요.' }],
    ['0', '100000001', { error: '가격은 0원부터 100,000,000원까지 입력할 수 있습니다.' }],
    ['900000', '100000', { error: '최소 가격이 최대 가격보다 큽니다. 가격대를 다시 입력해 주세요.' }],
  ])('가격대 %p ~ %p → %o', (min, max, result) => expect(validatePriceRange(min, max)).toEqual(result))

  test.each([
    ['?category=gpu&brand=MSI&min_price=500000&max_price=1000000', { category: 'gpu', search: '', sort: 'recommended', page: 1, brand: 'MSI', minPrice: 500000, maxPrice: 1000000 }],
    ['?brand=%20AMD%20&min_price=0', { category: '', search: '', sort: 'recommended', page: 1, brand: 'AMD', minPrice: 0 }],
    ['?min_price=900000&max_price=100000', { category: '', search: '', sort: 'recommended', page: 1 }],
    ['?min_price=abc&max_price=200000000', { category: '', search: '', sort: 'recommended', page: 1 }],
    [`?brand=${'B'.repeat(101)}`, { category: '', search: '', sort: 'recommended', page: 1 }],
    ['?sort=value_desc', { category: '', search: '', sort: 'recommended', page: 1 }],
    ['?category=cpu&sort=value_desc', { category: 'cpu', search: '', sort: 'value_desc', page: 1 }],
    ['?sort=rating_desc', { category: '', search: '', sort: 'rating_desc', page: 1 }],
  ])('주소 %s 를 읽는다(빈 필터는 키가 없다)', (search, query) => expect(readCatalogQuery(search)).toStrictEqual(query))

  test.each([
    [{ category: 'gpu', search: '', sort: 'value_desc', page: 1, brand: 'MSI', minPrice: 0, maxPrice: 1000000 }, '?category=gpu&brand=MSI&min_price=0&max_price=1000000&sort=value_desc'],
    [{ category: '', search: '', sort: 'recommended', page: 2, brand: undefined, minPrice: undefined }, '?page=2'],
  ])('%o → %s', (query, search) => expect(catalogSearch(query)).toBe(search))

  test('필터를 넣은 주소는 읽고 다시 만들어도 같다', () => {
    const search = '?category=memory&brand=G.SKILL&min_price=100000&sort=rating_desc&page=2'
    expect(catalogSearch(readCatalogQuery(search))).toBe(search)
  })

  test.each([
    [{ category: '', search: '', sort: 'recommended', page: 1 }, { category: '', search: '', sort: 'recommended', page: 1, pageSize: 20 }],
    [{ category: 'gpu', search: 'RTX', sort: 'value_desc', page: 2, brand: 'MSI', minPrice: 0, maxPrice: 900000 }, { category: 'gpu', search: 'RTX', sort: 'value_desc', page: 2, pageSize: 20, brand: 'MSI', minPrice: 0, maxPrice: 900000 }],
    [{ category: 'cpu', search: '', sort: 'recommended', page: 1, brand: undefined, minPrice: undefined, maxPrice: undefined }, { category: 'cpu', search: '', sort: 'recommended', page: 1, pageSize: 20 }],
  ])('fetchProducts 인자 %o → %o (빈 필터는 빠진다)', (query, request) => expect(catalogRequest(query, 20)).toStrictEqual(request))

  test.each([
    [{}, false], [{ brand: 'MSI' }, true], [{ minPrice: 0 }, true], [{ maxPrice: 1000 }, true], [{ brand: '', minPrice: null }, false],
  ])('브랜드·가격 필터 %o → %s', (query, expected) => {
    expect(hasDetailFilter(query)).toBe(expected)
    expect(hasCatalogFilter(query)).toBe(expected)
  })

  test('브랜드 선택지는 facets 를 그대로 쓰고, 목록에 없는 선택 브랜드는 개수 없이 덧붙인다', () => {
    const facets = { brands: [{ name: 'ASUS', count: 2 }, { name: 'MSI', count: 4 }], price_min: 100, price_max: 900 }
    expect(brandOptions(facets, 'MSI')).toEqual([{ name: 'ASUS', count: 2 }, { name: 'MSI', count: 4 }])
    expect(brandOptions(facets, 'Gigabyte')).toEqual([{ name: 'ASUS', count: 2 }, { name: 'MSI', count: 4 }, { name: 'Gigabyte', count: null }])
    expect(brandOptions(null, '')).toEqual([])
    expect(brandLabel({ name: 'MSI', count: 4 })).toBe('MSI (4)')
    expect(brandLabel({ name: 'Gigabyte', count: null })).toBe('Gigabyte')
  })
})

describe('상품 정보 표시', () => {
  test.each([
    [4.5, 12, { average: '4.5', count: 12, text: '★ 4.5 (12)', label: '평점 5점 만점에 4.5점, 리뷰 12개' }],
    [4, 1, { average: '4.0', count: 1, text: '★ 4.0 (1)', label: '평점 5점 만점에 4.0점, 리뷰 1개' }],
    [null, 0, null],
    [4.5, 0, null],
    [null, 3, null],
    [undefined, undefined, null],
  ])('평점 %p, 리뷰 %p → %o', (average, count, summary) => expect(ratingSummary(average, count)).toEqual(summary))

  test.each([
    ['2026-09-12', '2026년 9월 12일'], ['2025-01-01', '2025년 1월 1일'], ['', ''], [null, ''], ['2026/09/12', ''],
  ])('출시일 %p → %p', (value, text) => expect(formatReleaseDate(value)).toBe(text))

  test.each([[24500, '24,500'], [0, '0'], [null, '-'], [undefined, '-']])('성능 점수 %p → %p', (value, text) => expect(formatScore(value)).toBe(text))

  test.each([[272.5, '272.50'], [27.25, '27.25'], [1234.5, '1,234.50'], [0, '0.00'], [null, '-']])('가성비 지수 %p → %p', (value, text) => expect(formatValueScore(value)).toBe(text))

  test.each([
    [{ price_krw: 899000, lowest_price_90d: 879000 }, { price: 879000, isLowest: false }],
    [{ price_krw: 879000, lowest_price_90d: 879000 }, { price: 879000, isLowest: true }],
    [{ price_krw: 899000, lowest_price_90d: null }, null],
    [{ price_krw: 899000 }, null],
    [null, null],
  ])('90일 최저가 %o → %o', (product, info) => expect(lowestPriceInfo(product)).toEqual(info))

  test.each([
    [{ loading: true, error: '실패' }, 'loading'],
    [{ loading: false, error: '실패' }, 'error'],
    [{ empty: true }, 'empty'],
    [{}, 'ready'],
  ])('영역 상태 %o → %s', (data, state) => expect(getSectionState(data)).toBe(state))
})
