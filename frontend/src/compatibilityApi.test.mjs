// 부품 호환성 API(src/api/compatibilityApi.js): spec docs/specs/2026-11-01-compatibility-rules.md "API 계약"의 요청 모양.
import axios from 'axios'
import { jest } from '@jest/globals'
import { checkCompatibility } from './api/compatibilityApi.js'

afterEach(() => jest.restoreAllMocks())

// spec API 계약의 응답 예시
const result = {
  status: 'error',
  issues: [
    { code: 'SOCKET_MISMATCH', level: 'error', message: 'CPU(AM5)와 메인보드(LGA1700)의 소켓이 다릅니다.', product_ids: [1, 60] },
    { code: 'NO_CPU_COOLER', level: 'warning', message: 'CPU 에 기본 쿨러가 없어 쿨러가 따로 필요합니다.', product_ids: [1] },
  ],
  balance: { score: 0.42, label: 'balanced' },
  power: { estimated_w: 520, psu_w: 850 },
  categories: ['cpu', 'mainboard', 'memory'],
}
const response = { data: { code: 200, message: '호환성을 확인했습니다.', result } }

test('POST /compatibility/check 에 { items: [{ product_id, quantity }] } 만 보내고 쿠키는 싣지 않으며 result 를 돌려준다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(response)
  // 장바구니 줄처럼 이름·카테고리·가격이 붙어 있어도 product_id·quantity 만 보낸다
  const lines = [
    { product_id: 1, quantity: 1, name: '라이젠7 9800X3D', category: 'cpu', price_krw: 739000 },
    { product_id: 60, quantity: 1, name: 'B650 보드', category: 'mainboard' },
    { product_id: 140, quantity: 2, name: 'DDR5 16GB', category: 'memory' },
  ]
  await expect(checkCompatibility(lines)).resolves.toEqual(result)
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/compatibility/check', {
    items: [{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }, { product_id: 140, quantity: 2 }],
  })
  // 세 번째 인자(설정)가 없다 = withCredentials 를 싣지 않는다(인증 불필요)
  expect(post.mock.calls[0]).toHaveLength(2)
})

test('apiBaseUrl 을 넘기면 그 주소를 쓰고 끝의 / 를 지운다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(response)
  await checkCompatibility([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }], { apiBaseUrl: 'https://api.example.test/' })
  expect(post.mock.calls[0][0]).toBe('https://api.example.test/compatibility/check')
})

test.each([
  ['빈 목록', [], '호환성을 확인할 부품을 골라 주세요.'],
  ['31줄', Array.from({ length: 31 }, (_, index) => ({ product_id: index + 1, quantity: 1 })), '호환성은 부품 30줄까지 확인할 수 있습니다.'],
  ['수량 11', [{ product_id: 1, quantity: 11 }], '수량은 1~10개로 골라 주세요.'],
  ['같은 상품 두 줄', [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 1 }], '같은 상품이 두 줄 있습니다. 한 줄로 합쳐 주세요.'],
  ['상품 id 없음', [{ quantity: 1 }], '상품 정보가 올바르지 않습니다. 부품을 다시 골라 주세요.'],
])('계약 밖(%s)이면 요청하지 않고 던진다', async (_name, items, message) => {
  const post = jest.spyOn(axios, 'post')
  await expect(checkCompatibility(items)).rejects.toThrow(message)
  expect(post).not.toHaveBeenCalled()
})

test.each([
  [{ response: { status: 404, data: { code: 404, message: '상품을 찾을 수 없습니다.', result: { code: 'PRODUCT_NOT_FOUND' } } } }],
  [{ response: { status: 500 } }],
  [{ isAxiosError: true, code: 'ERR_NETWORK' }],
])('서버 오류·네트워크 오류는 잡지 않고 그대로 던진다(%#)', async (failure) => {
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(checkCompatibility([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }])).rejects.toBe(failure)
})
