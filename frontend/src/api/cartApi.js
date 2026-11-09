import axios from 'axios'
import { baseUrl } from './config.js'
import { validateBuildComment, validateCartItem, validateCartQuantity } from '../stores/cartViewModel.js'

// 장바구니는 로그인 사용자별로 서버에 저장된다. 모든 요청에 쿠키를 싣는다.
// 모든 함수는 서버가 돌려준 Cart({ items, item_count, total_krw })를 그대로 돌려준다(견적 담기는 BuildAddResult).
const credentials = { withCredentials: true }

/** GET /cart */
export async function fetchCart({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/cart`, credentials)
  return response.data.result
}

/** POST /cart/items. 이미 담긴 상품이면 서버가 수량을 더한다. */
export async function addCartItem({ productId, quantity }, { apiBaseUrl } = {}) {
  const error = validateCartItem({ productId, quantity })
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/cart/items`, {
    product_id: productId, quantity,
  }, credentials)
  return response.data.result
}

/**
 * POST /cart/builds { comment_id } → BuildAddResult { build_id, post_id, comment_id, added[], skipped[], cart }.
 * 견적 게시판의 받은 견적(부품 목록이 있는 댓글)을 한 번에 담는다(spec docs/specs/2026-11-01-build-id-purpose.md).
 * 담을 수량·한도·품절 판단은 서버가 한다.
 */
export async function addBuildToCart(commentId, { apiBaseUrl } = {}) {
  const error = validateBuildComment(commentId)
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/cart/builds`, { comment_id: commentId }, credentials)
  return response.data.result
}

/** PATCH /cart/items/{product_id} */
export async function updateCartItem(productId, { quantity }, { apiBaseUrl } = {}) {
  const error = validateCartQuantity(quantity)
  if (error) throw new Error(error)
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/cart/items/${encodeURIComponent(productId)}`, { quantity }, credentials)
  return response.data.result
}

/** DELETE /cart/items/{product_id} */
export async function removeCartItem(productId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/cart/items/${encodeURIComponent(productId)}`, credentials)
  return response.data.result
}
