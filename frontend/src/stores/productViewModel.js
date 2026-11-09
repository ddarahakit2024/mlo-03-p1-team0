// 상품 목록·상세 화면의 표시 값(카테고리 이름, 가격, 재고 문구, 평점·출시일·성능·가성비), 주소 query·필터 검증, 상태 계산, 오류 문구.
// Vue·axios 를 import 하지 않는다. 브라우저 객체(history)는 인자로 받는다.
// 가성비 지수·신제품·평점 평균·90일 최저가는 서버가 계산한 값을 보여 주기만 한다.

export const PRODUCT_PLACEHOLDER = '/product-placeholder.svg'
export const PRODUCT_PAGE_SIZE = 20
export const MAX_SEARCH_LENGTH = 50
// spec 정책: 상품 하나의 수량은 1~10 이고 재고 이하
export const MAX_ITEM_QUANTITY = 10
export const LOW_STOCK_LIMIT = 5

// API 는 코드만 주고받는다. 순서는 spec 에서 고정했다.
export const PRODUCT_CATEGORIES = [
  { code: 'cpu', name: 'CPU' },
  { code: 'mainboard', name: '메인보드' },
  { code: 'memory', name: '메모리' },
  { code: 'gpu', name: '그래픽카드' },
  { code: 'storage', name: '저장장치' },
  { code: 'psu', name: '파워' },
  { code: 'case', name: '케이스' },
  { code: 'cooler', name: '쿨러' },
]

export const PRODUCT_SORTS = [
  { value: 'recommended', label: '추천순' },
  { value: 'drop_desc', label: '하락폭순' },
  { value: 'price_asc', label: '낮은 가격순' },
  { value: 'price_desc', label: '높은 가격순' },
  { value: 'newest', label: '최신순' },
  { value: 'rating_desc', label: '평점순' },
  { value: 'value_desc', label: '가성비순' },
]
// 가성비 지수는 같은 카테고리끼리만 비교 의미가 있다(spec 정책). API 는 항상 허용하지만 화면은 카테고리를 고른 때만 보여 준다.
export const CATEGORY_ONLY_SORTS = ['value_desc']
// 서버 GET /products 의 brand(1~100자)·min_price·max_price(0~100000000) 제한과 같다
export const MAX_BRAND_LENGTH = 100
export const MAX_PRICE_FILTER = 100000000
export const VALUE_SCORE_HELP = '1만 원당 성능 점수. 같은 카테고리끼리 비교하세요.'
// 가격 추세 스위치(GET /products 의 dropping·near_low·store_lowest). key 는 목록 상태·fetchProducts 인자, param 은 주소 query·
// filter_change 의 field 이름. 켰을 때만 주소(=1)와 요청(true)에 넣는다
export const PRICE_TREND_FILTERS = [
  { key: 'dropping', param: 'dropping', label: '가격 하락 중' },
  { key: 'nearLow', param: 'near_low', label: '1년 최저가 근접' },
  { key: 'storeLowest', param: 'store_lowest', label: 'MOA가 최저가' },
]
// 첫 화면의 "30일 하락폭 큰 부품" 줄: GET /products?dropping=true&sort=drop_desc&page_size=10
export const DROP_ROW_SIZE = 10
export const DROP_ROW_REQUEST = { dropping: true, sort: 'drop_desc', pageSize: DROP_ROW_SIZE }
// 디자인의 토스트 문구(헤더 아래에 잠깐 뜬다. SiteLayout 이 그린다)
export const CART_ADDED_TOAST = '장바구니에 담았어요'
export const LOGIN_NEEDED_TOAST = '로그인이 필요해요'
export const CART_ADD_FAILED_MESSAGE = '장바구니에 담지 못했습니다. 다시 시도해 주세요.'
export const COMPARE_TOASTS = { added: '비교에 추가했어요', removed: '비교에서 제거했어요' }

const CATEGORY_CODES = PRODUCT_CATEGORIES.map((item) => item.code)
const SORT_VALUES = PRODUCT_SORTS.map((item) => item.value)
const DEFAULT_SORT = 'recommended'
const DIGITS = /^[0-9]+$/

/** 카테고리 코드 → 한글 이름. 모르는 코드는 '기타 부품'. */
export function categoryName(code) {
  return PRODUCT_CATEGORIES.find((item) => item.code === code)?.name || '기타 부품'
}

/** 899000 → '899,000원'. 금액은 서버 값을 그대로 보여 주기만 한다. */
export function formatPrice(priceKrw) {
  return `${Number(priceKrw || 0).toLocaleString('ko-KR')}원`
}

/** 재고 문구와 색(tone): 품절 / n개 남음(5개 이하) / 구매 가능. */
export function getStockStatus(stock) {
  const count = Math.max(0, Math.floor(Number(stock) || 0))
  if (count === 0) return { label: '품절', tone: 'sold-out', soldOut: true }
  if (count <= LOW_STOCK_LIMIT) return { label: `${count}개 남음`, tone: 'low', soldOut: false }
  return { label: '구매 가능', tone: 'ok', soldOut: false }
}

/** 고를 수 있는 최대 수량: min(10, 재고). 품절이면 0. */
export function maxOrderQuantity(stock) {
  return Math.min(MAX_ITEM_QUANTITY, Math.max(0, Math.floor(Number(stock) || 0)))
}

export function getProductImage(product) {
  return product?.thumbnail_url || PRODUCT_PLACEHOLDER
}

/** 카테고리에 따라 보여 줄 정렬. 가성비순은 카테고리를 고른 때만 있다. */
export function productSorts(category = '') {
  return PRODUCT_SORTS.filter((item) => category || !CATEGORY_ONLY_SORTS.includes(item.value))
}

/** 가격 입력 한 칸 → 숫자. 빈 칸은 null, 숫자가 아니면 NaN. 쉼표·공백은 지운다("1,000,000" 도 받는다). */
export function parsePriceInput(value) {
  const text = String(value ?? '').replace(/[,\s]/g, '')
  if (!text) return null
  return DIGITS.test(text) ? Number(text) : NaN
}

/**
 * 가격대(최소·최대) 입력 검사(서버와 같은 규칙: 숫자, 0~100,000,000, 최소 ≤ 최대).
 * 맞으면 { minPrice, maxPrice, error: '' }(빈 칸은 null), 틀리면 { error } 만. 틀리면 화면은 요청하지 않는다.
 */
export function validatePriceRange(minText, maxText) {
  const minPrice = parsePriceInput(minText)
  const maxPrice = parsePriceInput(maxText)
  if (Number.isNaN(minPrice)) return { error: '최소 가격은 숫자로만 입력해 주세요.' }
  if (Number.isNaN(maxPrice)) return { error: '최대 가격은 숫자로만 입력해 주세요.' }
  if ([minPrice, maxPrice].some((value) => value != null && value > MAX_PRICE_FILTER)) {
    return { error: '가격은 0원부터 100,000,000원까지 입력할 수 있습니다.' }
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { error: '최소 가격이 최대 가격보다 큽니다. 가격대를 다시 입력해 주세요.' }
  }
  return { minPrice, maxPrice, error: '' }
}

const ON_VALUES = ['1', 'true']

/**
 * 주소 query(?category=&search=&brand=&min_price=&max_price=&dropping=1&near_low=1&store_lowest=1&sort=&page=)를 읽는다.
 * 잘못된 값은 기본값으로 바꿔 422 를 피한다. brand·minPrice·maxPrice 와 가격 추세 스위치(dropping·nearLow·storeLowest, '1'·'true' 만 켬)는
 * 값이 있을 때만 들어 있다. 카테고리 없는 가성비순은 추천순으로 바꾼다.
 */
export function readCatalogQuery(search = '') {
  const params = new URLSearchParams(search)
  const categoryParam = params.get('category') || ''
  const category = CATEGORY_CODES.includes(categoryParam) ? categoryParam : ''
  const sort = params.get('sort') || ''
  const page = Number(params.get('page'))
  const query = {
    category,
    search: (params.get('search') || '').trim().slice(0, MAX_SEARCH_LENGTH),
    sort: SORT_VALUES.includes(sort) && (category || !CATEGORY_ONLY_SORTS.includes(sort)) ? sort : DEFAULT_SORT,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
  const brand = (params.get('brand') || '').trim()
  if (brand && brand.length <= MAX_BRAND_LENGTH) query.brand = brand
  const range = validatePriceRange(params.get('min_price'), params.get('max_price'))
  if (!range.error) {
    if (range.minPrice != null) query.minPrice = range.minPrice
    if (range.maxPrice != null) query.maxPrice = range.maxPrice
  }
  for (const filter of PRICE_TREND_FILTERS) {
    if (ON_VALUES.includes(params.get(filter.param))) query[filter.key] = true
  }
  return query
}

/** 목록 상태 → 주소 query 문자열. 기본값·빈 값·꺼진 스위치는 빼고, 아무것도 없으면 ''. */
export function catalogSearch(query = {}) {
  const { category = '', search = '', sort = DEFAULT_SORT, page = 1, brand = '', minPrice = null, maxPrice = null } = query
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (search.trim()) params.set('search', search.trim())
  if (brand) params.set('brand', brand)
  if (minPrice != null) params.set('min_price', String(minPrice))
  if (maxPrice != null) params.set('max_price', String(maxPrice))
  for (const filter of PRICE_TREND_FILTERS) {
    if (query[filter.key]) params.set(filter.param, '1')
  }
  if (sort && sort !== DEFAULT_SORT) params.set('sort', sort)
  if (page > 1) params.set('page', String(page))
  const value = params.toString()
  return value ? `?${value}` : ''
}

/** 목록 상태 → fetchProducts 인자. 빈 브랜드·가격과 꺼진 스위치는 넣지 않는다(API 요청에서도 빠진다). */
export function catalogRequest(query = {}, pageSize = PRODUCT_PAGE_SIZE) {
  const { category = '', search = '', sort = DEFAULT_SORT, page = 1, brand = '', minPrice = null, maxPrice = null } = query
  const request = { category, search, sort, page, pageSize }
  if (brand) request.brand = brand
  if (minPrice != null) request.minPrice = minPrice
  if (maxPrice != null) request.maxPrice = maxPrice
  for (const filter of PRICE_TREND_FILTERS) {
    if (query[filter.key]) request[filter.key] = true
  }
  return request
}

/** 목록 상태를 주소에 남긴다(새로고침·공유·뒤로 가기). */
export function pushCatalogQuery(query, history = window.history) {
  history.pushState({}, '', `/products${catalogSearch(query)}`)
}

export function hasCatalogFilter(query = {}) {
  const { category = '', search = '' } = query
  return Boolean(category || search.trim()) || hasDetailFilter(query)
}

/** 브랜드·가격대·가격 추세 스위치 필터가 걸려 있는지(필터 초기화 버튼을 보여 줄지). */
export function hasDetailFilter(query = {}) {
  const { brand = '', minPrice = null, maxPrice = null } = query
  return Boolean(brand) || minPrice != null || maxPrice != null || PRICE_TREND_FILTERS.some((filter) => Boolean(query[filter.key]))
}

/**
 * 가격 추세 스위치 하나를 켜고 끈 결과: { changes(목록 상태 변경, 1쪽부터), event(filter_change props: field = 주소 이름,
 * 켬 true·끔 null. 그대로면 null) }. 모르는 스위치는 null.
 */
export function trendFilterChange(query = {}, key, on) {
  const filter = PRICE_TREND_FILTERS.find((item) => item.key === key)
  if (!filter) return null
  const next = Boolean(on)
  return {
    changes: { [key]: next || undefined, page: 1 },
    event: next === Boolean(query[key]) ? null : { field: filter.param, value: next || null },
  }
}

/**
 * "필터 초기화": 브랜드·가격대·가격 추세 스위치를 지운다(카테고리·검색어·정렬은 그대로).
 * { changes, events(걸려 있던 것만 filter_change props, 값은 null·[null, null]) }.
 */
export function clearDetailFilters(query = {}) {
  const changes = { brand: undefined, minPrice: undefined, maxPrice: undefined, page: 1 }
  const events = []
  if (query.brand) events.push({ field: 'brand', value: null })
  if (query.minPrice != null || query.maxPrice != null) events.push({ field: 'price', value: [null, null] })
  for (const filter of PRICE_TREND_FILTERS) {
    changes[filter.key] = undefined
    if (query[filter.key]) events.push({ field: filter.param, value: null })
  }
  return { changes, events }
}

/** 목록 제목: '"RTX" 검색 결과' / 카테고리 이름 / '전체 상품'. */
export function catalogTitle({ category = '', search = '' } = {}) {
  const keyword = search.trim()
  if (keyword) return `"${keyword}" 검색 결과`
  return category ? categoryName(category) : '전체 상품'
}

/**
 * 첫 화면 영역("30일 하락폭 큰 부품" 줄)을 보여 줄 목록 상태인지: 검색어·카테고리·필터(브랜드·가격대·스위치)가 없고 1쪽.
 * 정렬은 거르는 조건이 아니라서 상관없다.
 */
export function isCatalogHome(query = {}) {
  return !hasCatalogFilter(query) && !(query.page > 1)
}

/** "하락 중인 부품 보기" 링크: 하락 줄이 보이면 그 영역(#drops), 아니면 하락 중 + 하락폭순 목록. */
export function dropsLinkHref(dropRowVisible) {
  return dropRowVisible ? '#drops' : `/products${catalogSearch({ dropping: true, sort: 'drop_desc' })}`
}

/** 첫 화면 소개 문구. 상품 수(price-summary 의 product_count)를 모르면 숫자 없이. */
export function catalogIntro(productCount) {
  const count = Number(productCount)
  const subject = productCount != null && Number.isSafeInteger(count) && count > 0 ? `${count.toLocaleString('ko-KR')}개 부품의 판매가를` : '부품 판매가를'
  return `${subject} 매일 기록하고, 1년 최저가와 타 쇼핑몰 가격을 함께 보여드려요. 원하는 가격을 등록하면 도달했을 때 알려드립니다.`
}

/** 요약 숫자 37 → '37', 1234 → '1,234'. 값이 없거나 숫자가 아니면 '-'. */
export function formatCount(value) {
  const count = Number(value)
  return value == null || value === '' || !Number.isFinite(count) ? '-' : Math.max(0, Math.floor(count)).toLocaleString('ko-KR')
}

/** 비교 토글 결과(createCompareBox.toggle) → 토스트 문구. 꽉 참·다른 카테고리는 비교함 막대가 안내하므로 null. */
export function compareToast(result) {
  return COMPARE_TOASTS[result] || null
}

/**
 * 브랜드 선택지: Facets 의 brands(이름순, count 포함). 주소로 들어온 브랜드가 목록에 없으면(다른 카테고리 등) 개수 없이 덧붙여
 * 선택 상자가 지금 조건을 그대로 보여 주게 한다.
 */
export function brandOptions(facets, selected = '') {
  const brands = (facets?.brands || []).map((item) => ({ name: item.name, count: item.count }))
  if (selected && !brands.some((item) => item.name === selected)) brands.push({ name: selected, count: null })
  return brands
}

/** 브랜드 선택지 문구: 'MSI (4)', 개수를 모르면 이름만. */
export function brandLabel({ name = '', count = null } = {}) {
  return count == null ? name : `${name} (${count})`
}

/** 평점 요약(★ 4.5 (12)). 리뷰가 없거나 평균이 없으면 null(표시하지 않는다). 평균은 서버 값(소수 1자리)을 그대로 쓴다. */
export function ratingSummary(average, count) {
  const reviews = Math.max(0, Math.floor(Number(count) || 0))
  if (!reviews || average == null || !Number.isFinite(Number(average))) return null
  const value = Number(average).toFixed(1)
  return { average: value, count: reviews, text: `★ ${value} (${reviews})`, label: `평점 5점 만점에 ${value}점, 리뷰 ${reviews}개` }
}

/** 출시일 "2026-09-12" → '2026년 9월 12일'(날짜만 있는 값이라 시간대 변환을 하지 않는다). 형식이 틀리면 ''. */
export function formatReleaseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return ''
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`
}

/** 성능 점수 24500 → '24,500'. 값이 없으면 '-'. */
export function formatScore(value) {
  return value == null || !Number.isFinite(Number(value)) ? '-' : Number(value).toLocaleString('ko-KR')
}

/** 가성비 지수 272.5 → '272.50'(서버가 소수 2자리로 준다). 값이 없으면 '-'. */
export function formatValueScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return '-'
  return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 90일 최저가 표시: { price, isLowest(현재가가 최저가) }. 값이 없으면 null. */
export function lowestPriceInfo(product) {
  const lowest = product?.lowest_price_90d
  if (lowest == null || !Number.isFinite(Number(lowest))) return null
  return { price: Number(lowest), isLowest: Number(product.price_krw) <= Number(lowest) }
}

export function productPath(id) {
  return `/products/${encodeURIComponent(id)}`
}

/** 'loading' | 'missing' | 'error' | 'empty' | 'ready' */
export function getProductPageState({ loading = false, error = '', missing = false, products = [], product = null, detail = false } = {}) {
  if (loading) return 'loading'
  if (missing) return 'missing'
  if (error) return 'error'
  if (detail) return product ? 'ready' : 'missing'
  return products.length ? 'ready' : 'empty'
}

/** 상세 화면의 영역(가격 이력·리뷰) 하나의 상태: 'loading' | 'error' | 'empty' | 'ready'. 영역마다 따로 불러오고 따로 다시 시도한다. */
export function getSectionState({ loading = false, error = '', empty = false } = {}) {
  if (loading) return 'loading'
  if (error) return 'error'
  return empty ? 'empty' : 'ready'
}

/**
 * 상품 조회 실패 문구. 서버 오류(5xx)·네트워크 오류는 우리가 정한 문구(fallback)를,
 * 그 밖의 오류(422 등)는 서버 message 를 보여 준다.
 */
export function productError(error, fallback) {
  const status = error?.response?.status
  if (!status || status >= 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}
