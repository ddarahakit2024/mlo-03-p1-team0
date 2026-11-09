import axios from 'axios'
import { baseUrl } from './config.js'
import { REVIEW_PAGE_SIZE, reviewBody, validateReview, validateReviewChanges } from '../stores/reviewViewModel.js'

// 리뷰 목록은 로그인이 선택이다: 쿠키가 있으면 서버가 my_review·can_review 를 계산하므로 목록 조회에도 쿠키를 싣는다.
// 작성·수정·삭제는 로그인 사용자 전용(401)이고, 서버가 Origin 을 검사한다(403).
const credentials = { withCredentials: true }

/** GET /products/{product_id}/reviews → ReviewPage(최신순, 평균·별점 분포·my_review·can_review). */
export async function fetchProductReviews(productId, { page = 1, pageSize = REVIEW_PAGE_SIZE, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/reviews`, {
    ...credentials, params: { page, page_size: pageSize },
  })
  return response.data.result
}

/** POST /products/{product_id}/reviews { rating, content } → Review. 미구매 403, 이미 작성 409. */
export async function createReview(productId, { rating, content }, { apiBaseUrl } = {}) {
  const error = validateReview({ rating, content })
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/reviews`, reviewBody({ rating, content }), credentials)
  return response.data.result
}

/** PATCH /products/{product_id}/reviews/{review_id} { rating?, content? }(하나 이상) → Review. 남의 리뷰 403. */
export async function updateReview(productId, reviewId, { rating, content } = {}, { apiBaseUrl } = {}) {
  const error = validateReviewChanges({ rating, content })
  if (error) throw new Error(error)
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/reviews/${encodeURIComponent(reviewId)}`, reviewBody({ rating, content }), credentials)
  return response.data.result
}

/** DELETE /products/{product_id}/reviews/{review_id} → null. 남의 리뷰 403. */
export async function deleteReview(productId, reviewId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/products/${encodeURIComponent(productId)}/reviews/${encodeURIComponent(reviewId)}`, credentials)
  return response.data.result
}
