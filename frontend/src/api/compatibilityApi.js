import axios from 'axios'
import { baseUrl } from './config.js'
import { compatibilityItems, validateCompatibilityItems } from '../stores/compatibilityViewModel.js'

// 부품 호환성 확인(spec docs/specs/2026-11-01-compatibility-rules.md "API 계약").
// 쿠키를 쓰지 않는 읽기 전용 확인이라 withCredentials 를 싣지 않는다.

/**
 * POST /compatibility/check { items: [{ product_id, quantity }] } → result({ status, issues, balance, power, categories }).
 * items 는 장바구니 줄·견적 부품 줄처럼 product_id·quantity 가 있는 줄. 계약 밖(0줄·31줄·수량 11·같은 상품 두 줄)이면 보내지 않고 던진다.
 */
export async function checkCompatibility(items, { apiBaseUrl } = {}) {
  const body = compatibilityItems(items)
  const error = validateCompatibilityItems(body)
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/compatibility/check`, { items: body })
  return response.data.result
}
