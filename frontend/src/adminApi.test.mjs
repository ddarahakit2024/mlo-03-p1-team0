// 관리자 API(src/api/adminApi.js)의 요청 모양. spec docs/specs/2026-11-01-returns-refunds.md "API 계약":
// GET /admin/returns?status=&page=, POST /admin/returns/{return_id}/approve, POST /admin/returns/{return_id}/reject {reason}
// 추천 학습(spec docs/specs/2026-11-03-product-recommendations.md): POST /admin/recommendations/train {since}, GET /admin/recommendations/models, GET /admin/recommendations/products/{product_id}?limit=
import axios from 'axios'
import { jest } from '@jest/globals'
import { approveReturn, fetchAdminReturns, fetchRecommendationComparison, fetchRecommendationModels, rejectReturn, trainRecommendations } from './api/adminApi.js'

afterEach(() => jest.restoreAllMocks())

const adminReturn = {
  id: 12, payment_id: 'order-7f3a9c2e', status: 'REFUNDED', reason: 'incompatible', detail: '',
  items: [{ product_id: 3, product_name: '지포스 RTX 4070 SUPER 12GB', quantity: 1, unit_price_krw: 899000 }],
  items_total_krw: 899000, shipping_deduction_krw: 0, refund_amount_krw: 899000,
  requested_at: '2026-11-01T02:00:00Z', decided_at: '2026-11-01T03:00:00Z', reject_reason: null, refunded_at: '2026-11-01T03:00:00Z',
  order_name: '지포스 RTX 4070 SUPER 12GB 외 1건', buyer_subject: 'user-1', paid_at: '2026-10-30T01:13:00Z', payment_provider: 'mock', refund_error: null,
}
const page = { items: [adminReturn], total: 1, page: 1 }

test('반품 목록은 쿠키와 상태·쪽을 params 로 보내고 { items, total, page } 를 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: '반품 신청을 조회했습니다.', result: page } })
  await expect(fetchAdminReturns({ status: 'REQUESTED', page: 2, apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(page)
  expect(get).toHaveBeenCalledWith('https://api.example.test/admin/returns', { withCredentials: true, params: { page: 2, status: 'REQUESTED' } })
})

test.each([
  [{}, { page: 1 }],
  [{ status: null, page: 3 }, { page: 3 }],
  [{ status: 'DELETED' }, { page: 1 }],
  [{ status: 'approved', page: 0 }, { page: 1, status: 'APPROVED' }],
])('상태가 없거나 모르는 값이면 status 를 보내지 않는다(전체) %#', async (input, params) => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: page } })
  await fetchAdminReturns(input)
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/admin/returns', { withCredentials: true, params })
})

test('승인은 본문 없이 쿠키와 함께 보내고 AdminReturn(REFUNDED)을 돌려준다. 금액은 보내지 않는다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 200, message: '환불을 마쳤습니다.', result: adminReturn } })
  await expect(approveReturn(12)).resolves.toEqual(adminReturn)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/admin/returns/12/approve', null, { withCredentials: true })
  await approveReturn('1/2', { apiBaseUrl: 'https://api.example.test/' })
  expect(post).toHaveBeenLastCalledWith('https://api.example.test/admin/returns/1%2F2/approve', null, { withCredentials: true })
})

test('거절은 앞뒤 공백을 지운 사유만 보낸다', async () => {
  const rejected = { ...adminReturn, status: 'REJECTED', reject_reason: '사용 흔적이 있습니다.', refunded_at: null }
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: rejected } })
  await expect(rejectReturn(12, { reason: '  사용 흔적이 있습니다. ' })).resolves.toEqual(rejected)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/admin/returns/12/reject', { reason: '사용 흔적이 있습니다.' }, { withCredentials: true })
})

test.each([['', '거절 사유를 입력해 주세요.'], ['가'.repeat(201), '거절 사유는 200자까지 입력할 수 있습니다.']])('거절 사유가 잘못되면(%#) 요청을 보내지 않는다', async (reason, message) => {
  const post = jest.spyOn(axios, 'post')
  await expect(rejectReturn(12, { reason })).rejects.toThrow(message)
  expect(post).not.toHaveBeenCalled()
})

test('오류(502 환불 실패·403 관리자 아님)는 잡지 않고 그대로 던진다', async () => {
  const refundFailed = { response: { status: 502, data: { message: '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.' } } }
  const forbidden = { response: { status: 403, data: { message: '관리자만 사용할 수 있습니다.' } } }
  jest.spyOn(axios, 'post').mockRejectedValue(refundFailed)
  jest.spyOn(axios, 'get').mockRejectedValue(forbidden)
  await expect(approveReturn(12)).rejects.toBe(refundFailed)
  await expect(fetchAdminReturns()).rejects.toBe(forbidden)
})

describe('추천 학습', () => {
  const model = {
    id: 4, version: 'itemcf-4', algorithm: 'itemcf-cosine', trained_at: '2026-10-08T03:10:00Z',
    events_since: '2026-10-08T03:00:00Z', event_count: 24, session_count: 6, product_count: 2, pair_count: 1,
    params: { neighbors: 50, shrinkage: 20, base_weight: 0.5, price_scale: 0.25, top_k: 20 }, duration_ms: 180,
  }
  const comparison = {
    product: { id: 1, name: '라이젠5 5600', category: 'cpu', price_krw: 149600 },
    current: { model: { version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' }, items: [] },
    previous: { model: null, items: [] },
  }

  test.each([
    [{ since: '2026-11-03T14:12:33+09:00' }, { since: '2026-11-03T14:12:33+09:00' }],
    [{ since: '2026-10-08T03:00:00Z' }, { since: '2026-10-08T03:00:00Z' }],
    [{ since: null }, { since: null }],
    [{}, { since: null }],
  ])('학습은 쿠키와 함께 본문 { since }(시간대 포함 ISO 또는 null=전체)를 보내고 모델 기록을 돌려준다 %#', async (input, body) => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 201, message: '추천 모델을 학습했습니다.', result: model } })
    await expect(trainRecommendations(input)).resolves.toEqual(model)
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/admin/recommendations/train', body, { withCredentials: true })
  })

  test.each([['2026-11-03T14:12:33'], ['2026-11-03'], ['어제'], [''], [1730000000]])('since 에 시간대가 없거나 형식이 틀리면(%p) 보내지 않고 던진다', async (since) => {
    const post = jest.spyOn(axios, 'post')
    await expect(trainRecommendations({ since })).rejects.toThrow('시간대')
    expect(post).not.toHaveBeenCalled()
  })

  test('학습 기록은 쿠키와 함께 부르고 { server_time, items } 를 돌려준다(apiBaseUrl 끝의 / 제거)', async () => {
    const result = { server_time: '2026-10-08T03:20:00Z', items: [model] }
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: 'ok', result } })
    await expect(fetchRecommendationModels({ apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(result)
    expect(get).toHaveBeenCalledWith('https://api.example.test/admin/recommendations/models', { withCredentials: true })
  })

  test('상품별 순위 비교는 경로 값을 인코딩하고 limit(기본 10)을 params 로, 쿠키와 함께 보낸다', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: comparison } })
    await expect(fetchRecommendationComparison(1)).resolves.toEqual(comparison)
    expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/admin/recommendations/products/1', { withCredentials: true, params: { limit: 10 } })
    await fetchRecommendationComparison('1/2', { limit: 20, apiBaseUrl: 'https://api.example.test' })
    expect(get).toHaveBeenLastCalledWith('https://api.example.test/admin/recommendations/products/1%2F2', { withCredentials: true, params: { limit: 20 } })
  })

  test('오류(409 학습 중·503 이벤트 저장소·404 상품 없음)는 잡지 않고 그대로 던진다', async () => {
    const busy = { response: { status: 409, data: { message: '이미 추천 모델을 학습하고 있습니다.' } } }
    const missing = { response: { status: 404, data: { message: '상품을 찾을 수 없습니다.' } } }
    jest.spyOn(axios, 'post').mockRejectedValue(busy)
    jest.spyOn(axios, 'get').mockRejectedValue(missing)
    await expect(trainRecommendations({ since: null })).rejects.toBe(busy)
    await expect(fetchRecommendationComparison(999)).rejects.toBe(missing)
    await expect(fetchRecommendationModels()).rejects.toBe(missing)
  })
})
