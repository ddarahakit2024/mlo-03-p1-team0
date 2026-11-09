// 상품 목록(views/ProductCatalog.vue)의 기능 확장 1차: 브랜드(facets)·가격대 필터, 평점순·가성비순, 필터 결과 없음.
// 가격 추세 스위치(가격 하락 중·1년 최저가 근접·MOA가 최저가 → dropping·near_low·store_lowest)와 하락폭순(drop_desc).
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'

const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD', is_new: true, rating_average: 4.5, review_count: 12 }
const productPage = (items, total = items.length) => ({ items, total, page: 1, page_size: 20 })
const gpuFacets = { brands: [{ name: 'ASUS', count: 3 }, { name: 'MSI', count: 4 }], price_min: 289000, price_max: 3890000 }
const allFacets = { brands: [{ name: 'AMD', count: 2 }, { name: 'MSI', count: 6 }], price_min: 89000, price_max: 3890000 }

const fetchProducts = jest.fn()
const fetchProductFacets = jest.fn()
// 첫 화면의 보조 영역(가격 요약·하락 줄)과 헤더 상태는 이 파일에서 보지 않는다(src/productView.test.mjs)
const fetchPriceSummary = async () => ({ product_count: 1, dropping_count: 0, lowest_1y_count: 0 })
const fetchDropProducts = async () => ({ items: [], total: 0, page: 1, page_size: 10 })
const siteStatus = { setCartCount() {}, setCompareCount() {}, showToast() {} }
let ProductCatalog
let browser

function open(search = '') {
  browser = { location: { search }, history: { pushState: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn(), scrollTo: jest.fn() }
  global.window = browser
  return mount(ProductCatalog)
}
const options = (root, id) => findAll(byId(root, id), (node) => node.type === 'option').map((node) => [node.props.value, text(node)])
const toggleSwitch = async (root, id, checked) => {
  byId(root, id).props.onChange({ target: { checked } })
  await flush()
}

beforeAll(async () => { ProductCatalog = await compileSfc('views/ProductCatalog.vue', { fetchProducts, fetchProductFacets, fetchPriceSummary, fetchDropProducts, siteStatus }) })
beforeEach(() => {
  fetchProducts.mockReset().mockResolvedValue(productPage([gpu], 1))
  fetchProductFacets.mockReset().mockImplementation(async ({ category }) => (category === 'gpu' ? gpuFacets : allFacets))
})
afterEach(() => { delete global.window })

describe('브랜드 선택지(GET /products/facets)', () => {
  test('처음에 지금 카테고리로 부르고, 이름순 브랜드와 개수, 가격 범위를 보여 준다', async () => {
    const page = open('?category=gpu')
    await flush()
    expect(fetchProductFacets).toHaveBeenCalledWith({ category: 'gpu' })
    expect(options(page.root, 'product-brand')).toEqual([['', '전체 브랜드'], ['ASUS', 'ASUS (3)'], ['MSI', 'MSI (4)']])
    expect(text(page.root)).toContain('이 조건의 가격 289,000원 ~ 3,890,000원')
  })

  test('카테고리를 바꾸면 브랜드 선택지를 다시 부르고 고른 브랜드는 지운다', async () => {
    const page = open('?brand=AMD')
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20, brand: 'AMD' })
    await click(button(page.root, '그래픽카드'))
    expect(fetchProductFacets).toHaveBeenLastCalledWith({ category: 'gpu' })
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu')
    expect(byId(page.root, 'product-brand').props.value).toBe('')
    expect(options(page.root, 'product-brand').map(([value]) => value)).toEqual(['', 'ASUS', 'MSI'])
  })

  test('브랜드를 고르면 1쪽부터 다시 부르고 주소에 brand 를 남긴다', async () => {
    const page = open('?category=gpu&page=2')
    await flush()
    byId(page.root, 'product-brand').props.onChange({ target: { value: 'MSI' } })
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, brand: 'MSI' })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&brand=MSI')
    byId(page.root, 'product-brand').props.onChange({ target: { value: '' } })
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20 })
  })

  test('주소의 브랜드가 선택지에 없어도 선택 상자에 그대로 보여 준다', async () => {
    const page = open('?category=gpu&brand=Gigabyte')
    await flush()
    expect(byId(page.root, 'product-brand').props.value).toBe('Gigabyte')
    expect(options(page.root, 'product-brand')).toContainEqual(['Gigabyte', 'Gigabyte'])
  })

  test('늦게 온 이전 카테고리의 선택지는 무시한다', async () => {
    let releaseFirst
    fetchProductFacets.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(allFacets) }))
      .mockResolvedValueOnce(gpuFacets)
    const page = open()
    await flush()
    await click(button(page.root, '그래픽카드'))
    releaseFirst()
    await flush()
    expect(options(page.root, 'product-brand').map(([value]) => value)).toEqual(['', 'ASUS', 'MSI'])
  })

  test('선택지를 불러오지 못해도 목록은 보이고, 안내와 다시 불러오기를 준다', async () => {
    fetchProductFacets.mockReset().mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(allFacets)
    const page = open()
    await flush()
    expect(stub(page.root, 'ProductGrid').props.products).toEqual([gpu])
    expect(text(page.root)).toContain('브랜드 목록을 불러오지 못했습니다.')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    await click(button(page.root, '다시 불러오기'))
    expect(fetchProductFacets).toHaveBeenCalledTimes(2)
    expect(text(page.root)).not.toContain('브랜드 목록을 불러오지 못했습니다.')
    expect(options(page.root, 'product-brand').map(([value]) => value)).toEqual(['', 'AMD', 'MSI'])
  })
})

describe('가격대', () => {
  test('최소·최대를 넣고 적용하면 1쪽부터 min_price·max_price 로 부르고 주소에 남긴다', async () => {
    const page = open('?category=gpu&page=3')
    await flush()
    await setValue(byId(page.root, 'product-min-price'), '500,000')
    await setValue(byId(page.root, 'product-max-price'), '1000000')
    await submit(page.root)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, minPrice: 500000, maxPrice: 1000000 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&min_price=500000&max_price=1000000')
    expect(byId(page.root, 'product-min-price').value).toBe('500000')
  })

  test('한쪽만 넣거나(0 포함) 둘 다 비우면 그 쪽 제한만 바꾼다', async () => {
    const page = open('?min_price=100&max_price=900')
    await flush()
    expect(byId(page.root, 'product-min-price').value).toBe('100')
    await setValue(byId(page.root, 'product-min-price'), '0')
    await setValue(byId(page.root, 'product-max-price'), '')
    await submit(page.root)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20, minPrice: 0 })
    await setValue(byId(page.root, 'product-min-price'), '')
    await submit(page.root)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20 })
  })

  test.each([
    ['숫자가 아님', '10만', '', '최소 가격은 숫자로만 입력해 주세요.'],
    ['범위를 넘음', '0', '100000001', '가격은 0원부터 100,000,000원까지 입력할 수 있습니다.'],
    ['최소 > 최대', '900000', '100000', '최소 가격이 최대 가격보다 큽니다. 가격대를 다시 입력해 주세요.'],
  ])('%s 이면 요청하지 않고 안내하며 입력은 그대로 둔다', async (_name, min, max, message) => {
    const page = open()
    await flush()
    const calls = fetchProducts.mock.calls.length
    await setValue(byId(page.root, 'product-min-price'), min)
    await setValue(byId(page.root, 'product-max-price'), max)
    await submit(page.root)
    expect(fetchProducts).toHaveBeenCalledTimes(calls)
    expect(browser.history.pushState).not.toHaveBeenCalled()
    expect(text(byRole(page.root, 'alert')[0])).toBe(message)
    expect(byId(page.root, 'product-min-price').value).toBe(min)
    expect(byId(page.root, 'product-min-price').props['aria-invalid']).toBe(true)
    await setValue(byId(page.root, 'product-min-price'), '1000')
    await setValue(byId(page.root, 'product-max-price'), '2000')
    await submit(page.root)
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(fetchProducts).toHaveBeenLastCalledWith(expect.objectContaining({ minPrice: 1000, maxPrice: 2000 }))
  })
})

describe('정렬', () => {
  test('전체 상품에서는 평점순까지만, 카테고리를 고르면 가성비순도 고를 수 있다', async () => {
    const page = open()
    await flush()
    expect(options(page.root, 'product-sort').map(([value]) => value)).toEqual(['recommended', 'drop_desc', 'price_asc', 'price_desc', 'newest', 'rating_desc'])
    await click(button(page.root, 'CPU'))
    expect(options(page.root, 'product-sort')).toContainEqual(['value_desc', '가성비순'])
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'value_desc' } })
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'cpu', search: '', sort: 'value_desc', page: 1, pageSize: 20 })
  })

  test('가성비순에서 전체로 돌아가면 추천순으로 바꾼다. 평점순은 그대로 둔다', async () => {
    const page = open('?category=gpu&sort=value_desc')
    await flush()
    expect(byId(page.root, 'product-sort').props.value).toBe('value_desc')
    await click(button(page.root, '전체'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products')
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'rating_desc' } })
    await flush()
    await click(button(page.root, '메모리'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'memory', search: '', sort: 'rating_desc', page: 1, pageSize: 20 })
  })

  test('하락폭순(drop_desc)은 전체·카테고리 어디서나 고를 수 있고 주소에 남는다', async () => {
    const page = open()
    await flush()
    expect(options(page.root, 'product-sort')).toContainEqual(['drop_desc', '하락폭순'])
    byId(page.root, 'product-sort').props.onChange({ target: { value: 'drop_desc' } })
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'drop_desc', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?sort=drop_desc')
    await click(button(page.root, 'CPU'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'cpu', search: '', sort: 'drop_desc', page: 1, pageSize: 20 })
  })
})

describe('가격 추세 스위치', () => {
  const switches = (root) => findAll(root, (node) => node.type === 'input' && node.props.role === 'switch')

  test('스위치 3개는 이름(label for)이 있는 checkbox role="switch" 이고 주소의 값으로 켜져 있다', async () => {
    const page = open('?dropping=1&store_lowest=1')
    await flush()
    expect(switches(page.root).map((node) => [node.props.id, node.props.type, node.props.checked])).toEqual([
      ['filter-dropping', 'checkbox', true], ['filter-near-low', 'checkbox', false], ['filter-store-lowest', 'checkbox', true],
    ])
    const labels = findAll(page.root, (node) => node.type === 'label' && String(node.props.for).startsWith('filter-')).map((node) => [node.props.for, text(node)])
    expect(labels).toEqual([['filter-dropping', '가격 하락 중'], ['filter-near-low', '1년 최저가 근접'], ['filter-store-lowest', 'MOA가 최저가']])
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20, dropping: true, storeLowest: true })
  })

  test('켜고 끌 때마다 1쪽부터 다시 부르고(켠 것만 true) 주소에 =1 로 남긴다', async () => {
    const page = open('?category=gpu&page=3')
    await flush()
    await toggleSwitch(page.root, 'filter-dropping', true)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, dropping: true })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&dropping=1')
    await toggleSwitch(page.root, 'filter-near-low', true)
    await toggleSwitch(page.root, 'filter-store-lowest', true)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, dropping: true, nearLow: true, storeLowest: true })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&dropping=1&near_low=1&store_lowest=1')
    expect(switches(page.root).map((node) => node.props.checked)).toEqual([true, true, true])
    await toggleSwitch(page.root, 'filter-dropping', false)
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, nearLow: true, storeLowest: true })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&near_low=1&store_lowest=1')
  })

  test('스위치가 켜져 있으면 필터 초기화가 보이고, 초기화하면 스위치도 끈다(카테고리는 그대로)', async () => {
    const page = open('?category=gpu')
    await flush()
    expect(button(page.root, '필터 초기화')).toBeNull()
    await toggleSwitch(page.root, 'filter-near-low', true)
    await click(button(page.root, '필터 초기화'))
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu')
    expect(switches(page.root).map((node) => node.props.checked)).toEqual([false, false, false])
    expect(button(page.root, '필터 초기화')).toBeNull()
  })

  test('뒤로 가기로 주소의 스위치가 바뀌면 다시 부르고 스위치도 맞춘다', async () => {
    const page = open('?dropping=1')
    await flush()
    const [, handler] = browser.addEventListener.mock.calls.find(([name]) => name === 'popstate')
    browser.location.search = '?store_lowest=1'
    handler()
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: '', search: '', sort: 'recommended', page: 1, pageSize: 20, storeLowest: true })
    expect(switches(page.root).map((node) => node.props.checked)).toEqual([false, false, true])
  })
})

describe('필터 결과 없음', () => {
  test('브랜드·가격 필터로 0건이면 안내와 필터 초기화·전체 보기를 주고, 초기화는 브랜드·가격만 지운다', async () => {
    fetchProducts.mockReset().mockResolvedValueOnce(productPage([])).mockResolvedValue(productPage([gpu]))
    const page = open('?category=gpu&search=RTX&brand=MSI&min_price=5000000&max_price=9000000')
    await flush()
    expect(text(page.root)).toContain('조건에 맞는 부품이 없어요. 필터를 조정하거나 다른 검색어를 입력해 보세요.')
    expect(link(page.root, '전체 보기').props.href).toBe('/products')
    const resetButtons = findAll(page.root, (node) => node.type === 'button' && text(node) === '필터 초기화')
    expect(resetButtons).toHaveLength(2)
    await click(resetButtons[1])
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: 'RTX', sort: 'recommended', page: 1, pageSize: 20 })
    expect(browser.history.pushState).toHaveBeenLastCalledWith({}, '', '/products?category=gpu&search=RTX')
    expect(byId(page.root, 'product-min-price').value).toBe('')
    expect(byId(page.root, 'product-max-price').value).toBe('')
    expect(button(page.root, '필터 초기화')).toBeNull()
    expect(stub(page.root, 'ProductGrid').props.products).toEqual([gpu])
  })

  test('뒤로 가기로 필터가 바뀌면 가격 입력도 주소에 맞춘다', async () => {
    const page = open('?category=gpu')
    await flush()
    const [, handler] = browser.addEventListener.mock.calls.find(([name]) => name === 'popstate')
    browser.location.search = '?category=gpu&brand=MSI&max_price=700000'
    handler()
    await flush()
    expect(fetchProducts).toHaveBeenLastCalledWith({ category: 'gpu', search: '', sort: 'recommended', page: 1, pageSize: 20, brand: 'MSI', maxPrice: 700000 })
    expect(byId(page.root, 'product-max-price').value).toBe('700000')
    expect(byId(page.root, 'product-brand').props.value).toBe('MSI')
    expect(fetchProductFacets).toHaveBeenCalledTimes(1)
  })
})
