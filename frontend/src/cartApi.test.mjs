// 장바구니 API(src/api/cartApi.js)의 요청 모양. spec API 계약: GET /cart, POST /cart/items, PATCH·DELETE /cart/items/{product_id},
// POST /cart/builds(docs/specs/2026-11-01-build-id-purpose.md)
import axios from 'axios'
import { jest } from '@jest/globals'
import { addBuildToCart, addCartItem, fetchCart, removeCartItem, updateCartItem } from './api/cartApi.js'

afterEach(() => jest.restoreAllMocks())

const cart = { items: [{ product_id: 3, quantity: 2, subtotal_krw: 1798000 }], item_count: 2, total_krw: 1798000 }
const ok = { data: { code: 200, message: '장바구니를 조회했습니다.', result: cart } }

test('장바구니 조회는 쿠키를 싣고 result 만 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok)
  await expect(fetchCart({ apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(cart)
  expect(get).toHaveBeenCalledWith('https://api.example.test/cart', { withCredentials: true })
})

test('담기는 product_id 와 quantity 만 보낸다(가격은 보내지 않는다)', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok)
  await expect(addCartItem({ productId: 3, quantity: 2 })).resolves.toEqual(cart)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/cart/items', { product_id: 3, quantity: 2 }, { withCredentials: true })
})

test.each([
  [{ productId: 3, quantity: 0 }, '수량은 1개 이상 선택해 주세요.'],
  [{ productId: 3, quantity: 11 }, '한 상품은 10개까지 담을 수 있습니다.'],
  [{ productId: 3, quantity: 1.5 }, '수량은 1개 이상 선택해 주세요.'],
  [{ productId: null, quantity: 1 }, '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
])('담기 입력이 잘못되면(%o) 요청을 보내지 않는다', async (input, message) => {
  const post = jest.spyOn(axios, 'post')
  await expect(addCartItem(input)).rejects.toThrow(message)
  expect(post).not.toHaveBeenCalled()
})

test('수량 변경은 PATCH 로 quantity 만 보내고 경로 값을 인코딩한다', async () => {
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue(ok)
  await expect(updateCartItem(3, { quantity: 4 })).resolves.toEqual(cart)
  expect(patch).toHaveBeenCalledWith('http://127.0.0.1:8000/cart/items/3', { quantity: 4 }, { withCredentials: true })
  await updateCartItem('a/b', { quantity: 1 })
  expect(patch).toHaveBeenLastCalledWith('http://127.0.0.1:8000/cart/items/a%2Fb', { quantity: 1 }, { withCredentials: true })
})

test('수량 변경 값이 1~10 이 아니면 요청을 보내지 않는다', async () => {
  const patch = jest.spyOn(axios, 'patch')
  await expect(updateCartItem(3, { quantity: 0 })).rejects.toThrow('수량은 1개 이상 선택해 주세요.')
  expect(patch).not.toHaveBeenCalled()
})

test('삭제는 DELETE 로 보내고 남은 장바구니를 돌려준다', async () => {
  const remove = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { result: { items: [], item_count: 0, total_krw: 0 } } })
  await expect(removeCartItem(3)).resolves.toEqual({ items: [], item_count: 0, total_krw: 0 })
  expect(remove).toHaveBeenCalledWith('http://127.0.0.1:8000/cart/items/3', { withCredentials: true })
})

test('서버 오류(409 재고 부족)는 그대로 던진다', async () => {
  const failure = { response: { status: 409, data: { message: '재고가 부족합니다.' } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(addCartItem({ productId: 3, quantity: 2 })).rejects.toBe(failure)
})

// BuildAddResult(spec "API 계약"): 이번에 더한 줄(added), 뺀 줄(skipped), 담은 뒤 장바구니(cart, GET /cart 의 result 와 같은 모양)
const buildResult = {
  build_id: '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7', post_id: 3, comment_id: 10,
  added: [{ product_id: 1, quantity: 1 }, { product_id: 6, quantity: 2 }],
  skipped: [{ product_id: 7, reason: 'sold_out' }],
  cart: { ...cart, items: [{ ...cart.items[0], build: { id: '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7', post_id: 3, comment_id: 10 } }] },
}

test('견적 담기는 POST /cart/builds 에 comment_id 만 쿠키와 함께 보내고 result(BuildAddResult)를 돌려준다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 200, message: '견적을 장바구니에 담았습니다.', result: buildResult } })
  await expect(addBuildToCart(10, { apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual(buildResult)
  expect(post).toHaveBeenCalledWith('https://api.example.test/cart/builds', { comment_id: 10 }, { withCredentials: true })
  await addBuildToCart(11)
  expect(post).toHaveBeenLastCalledWith('http://127.0.0.1:8000/cart/builds', { comment_id: 11 }, { withCredentials: true })
})

test.each([[0], [-1], [1.5], ['10'], [null], [undefined]])('견적 댓글 id 가 1 이상의 정수가 아니면(%p) 요청을 보내지 않는다', async (commentId) => {
  const post = jest.spyOn(axios, 'post')
  await expect(addBuildToCart(commentId)).rejects.toThrow('견적 정보가 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.')
  expect(post).not.toHaveBeenCalled()
})

test.each([
  ['401 비로그인', 401, '로그인이 필요합니다.'],
  ['404 없는 댓글', 404, '견적을 찾을 수 없습니다.'],
  ['409 담을 수 있는 부품 없음', 409, '담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.'],
])('견적 담기 실패(%s)는 그대로 던진다', async (_name, status, message) => {
  const failure = { response: { status, data: { code: status, message, result: null } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(addBuildToCart(10)).rejects.toBe(failure)
})
