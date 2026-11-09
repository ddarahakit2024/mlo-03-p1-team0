// 상품 API(src/api/productApi.js)의 요청 모양. spec API 계약: GET /products(+brand·min_price·max_price), /products/facets, /products/{product_id}, /products/{product_id}/price-history, /products/{product_id}/recommendations
import axios from 'axios'
import { jest } from '@jest/globals'
import { fetchPriceHistory, fetchProduct, fetchProductFacets, fetchProductRecommendations, fetchProducts } from './api/productApi.js'

afterEach(() => jest.restoreAllMocks())

const page = { items: [{ id: 3, name: '지포스 RTX 4070 SUPER 12GB' }], total: 1, page: 1, page_size: 20 }

test('상품 목록은 기본 정렬·쪽·쪽 크기만 보내고 쿠키는 싣지 않는다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: 'ok', result: page } })
  await expect(fetchProducts()).resolves.toEqual(page)
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/products', { params: { sort: 'recommended', page: 1, page_size: 20 } })
})

test('카테고리·검색어(앞뒤 공백 제거)·정렬·쪽을 query 로 보내고 apiBaseUrl 끝의 / 를 지운다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await fetchProducts({ category: 'gpu', search: ' RTX 4070 ', sort: 'price_asc', page: 3, pageSize: 12, apiBaseUrl: 'https://api.example.test/' })
  expect(get).toHaveBeenCalledWith('https://api.example.test/products', {
    params: { category: 'gpu', search: 'RTX 4070', sort: 'price_asc', page: 3, page_size: 12 },
  })
})

test.each([
  ['빈 검색어', { search: '   ' }, { sort: 'recommended', page: 1, page_size: 20 }],
  ['빈 카테고리', { category: '' }, { sort: 'recommended', page: 1, page_size: 20 }],
  ['빈 정렬', { sort: '' }, { page: 1, page_size: 20 }],
])('%s 는 보내지 않는다(서버는 빈 query 값을 422 로 거절한다)', async (_name, options, params) => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await fetchProducts(options)
  expect(get.mock.calls[0][1].params).toEqual(params)
})

test('상품 상세는 경로 값을 인코딩하고 result 만 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: 'ok', result: { id: 3 } } })
  await expect(fetchProduct(3)).resolves.toEqual({ id: 3 })
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/products/3')
  await fetchProduct('a/b', { apiBaseUrl: 'https://api.example.test' })
  expect(get).toHaveBeenLastCalledWith('https://api.example.test/products/a%2Fb')
})

test('오류는 잡지 않고 던진다(문구는 화면이 만든다)', async () => {
  const failure = { response: { status: 404 } }
  jest.spyOn(axios, 'get').mockRejectedValue(failure)
  await expect(fetchProduct(9)).rejects.toBe(failure)
})

test('브랜드·가격대(0 포함)를 brand·min_price·max_price 로 보내고 새 정렬 값도 그대로 보낸다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await fetchProducts({ category: 'gpu', sort: 'value_desc', brand: 'MSI', minPrice: 0, maxPrice: 1000000 })
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/products', {
    params: { category: 'gpu', sort: 'value_desc', brand: 'MSI', min_price: 0, max_price: 1000000, page: 1, page_size: 20 },
  })
})

test.each([
  ['빈 브랜드', { brand: '' }],
  ['값이 없는 가격', { minPrice: null, maxPrice: undefined }],
  ['빈 문자열 가격', { minPrice: '', maxPrice: '' }],
])('%s 는 보내지 않는다', async (_name, options) => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await fetchProducts({ sort: 'rating_desc', ...options })
  expect(get.mock.calls[0][1].params).toEqual({ sort: 'rating_desc', page: 1, page_size: 20 })
})

test('브랜드 선택지(facets)는 카테고리를 고른 때만 category 를 보내고 쿠키는 싣지 않는다', async () => {
  const facets = { brands: [{ name: 'MSI', count: 4 }], price_min: 189000, price_max: 3890000 }
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: 'ok', result: facets } })
  await expect(fetchProductFacets()).resolves.toEqual(facets)
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/products/facets', { params: {} })
  await fetchProductFacets({ category: 'gpu', apiBaseUrl: 'https://api.example.test/' })
  expect(get).toHaveBeenLastCalledWith('https://api.example.test/products/facets', { params: { category: 'gpu' } })
})

test('가격 이력은 경로 값을 인코딩하고 기본 90일을 days 로 보낸다', async () => {
  const history = { items: [], lowest_price_krw: null, highest_price_krw: null }
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: history } })
  await expect(fetchPriceHistory(3)).resolves.toEqual(history)
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/products/3/price-history', { params: { days: 90 } })
  await fetchPriceHistory('a/b', { days: 30, apiBaseUrl: 'https://api.example.test' })
  expect(get).toHaveBeenLastCalledWith('https://api.example.test/products/a%2Fb/price-history', { params: { days: 30 } })
})

// spec docs/specs/2026-11-03-product-recommendations.md: GET /products/{product_id}/recommendations?limit=(1~20, 상세는 6). 공개 API 라 쿠키를 싣지 않는다
describe('상품 상세 추천', () => {
  const recommendations = {
    product_id: 1,
    model: { version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' },
    items: [{ rank: 1, reason: 'co_view', id: 3, name: '라이젠7 5700X', brand: 'AMD', category: 'cpu', price_krw: 176400, stock: 11, thumbnail_url: '' }],
  }

  test('기본 limit 6 을 params 로 보내고 쿠키 없이 부르며 result 만 돌려준다', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: '추천 상품을 조회했습니다.', result: recommendations } })
    await expect(fetchProductRecommendations(1)).resolves.toEqual(recommendations)
    expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/products/1/recommendations', { params: { limit: 6 } })
  })

  test('경로 값을 인코딩하고 limit·apiBaseUrl(끝의 / 제거)을 그대로 쓴다', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: recommendations } })
    await fetchProductRecommendations('1/2', { limit: 20, apiBaseUrl: 'https://api.example.test/' })
    expect(get).toHaveBeenCalledWith('https://api.example.test/products/1%2F2/recommendations', { params: { limit: 20 } })
  })

  test('오류(404 상품 없음·422)는 잡지 않고 던진다', async () => {
    const failure = { response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } }
    jest.spyOn(axios, 'get').mockRejectedValue(failure)
    await expect(fetchProductRecommendations(999)).rejects.toBe(failure)
  })
})
