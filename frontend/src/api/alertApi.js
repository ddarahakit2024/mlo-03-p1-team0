import axios from 'axios'
import { baseUrl } from './config.js'
import { MAX_PRICE_FILTER } from '../stores/productViewModel.js'

// 목표가 알림(가격 추적). 로그인 사용자별로 서버에 저장된다. 모든 요청에 쿠키를 싣는다.
// Alert = { product_id, target_price_krw, reached, created_at, updated_at, product(ProductSummary + price_trend) }
const credentials = { withCredentials: true }

/** 목표가 입력 검사. 1원 이상 1억 원 이하의 정수. 통과하면 ''. */
export function validateTargetPrice(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PRICE_FILTER) return '목표 가격을 1원 이상 1억 원 이하의 숫자로 입력해 주세요.'
  return ''
}

/** GET /alerts → { items: Alert[] } (최근에 바꾼 순) */
export async function fetchAlerts({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/alerts`, credentials)
  return response.data.result
}

/** PUT /alerts/{product_id} { target_price_krw } → Alert. 없으면 만들고 있으면 바꾼다. */
export async function saveAlert(productId, { targetPriceKrw }, { apiBaseUrl } = {}) {
  const error = validateTargetPrice(targetPriceKrw)
  if (error) throw new Error(error)
  const response = await axios.put(`${baseUrl(apiBaseUrl)}/alerts/${encodeURIComponent(productId)}`, { target_price_krw: targetPriceKrw }, credentials)
  return response.data.result
}

/** DELETE /alerts/{product_id} → null */
export async function deleteAlert(productId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/alerts/${encodeURIComponent(productId)}`, credentials)
  return response.data.result
}
