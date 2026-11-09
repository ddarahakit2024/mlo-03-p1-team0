// 리뷰 API(src/api/reviewApi.js)의 요청 모양. spec API 계약(추가분): GET·POST /products/{id}/reviews, PATCH·DELETE /products/{id}/reviews/{review_id}
import axios from 'axios'
import { jest } from '@jest/globals'
import { createReview, deleteReview, fetchProductReviews, updateReview } from './api/reviewApi.js'

afterEach(() => jest.restoreAllMocks())

const review = { id: 5, product_id: 3, author: { id: '1', name: '김조립' }, rating: 4, content: '조용하고 온도도 안정적입니다.', is_owner: true }
const reviewPage = { items: [review], total: 1, page: 1, page_size: 10, rating_average: 4, rating_counts: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 }, my_review: review, can_review: false }

test('리뷰 목록은 쿠키(my_review·can_review 계산용)와 쪽·쪽 크기를 보내고 result 만 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: 200, message: 'ok', result: reviewPage } })
  await expect(fetchProductReviews(3)).resolves.toEqual(reviewPage)
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/products/3/reviews', { withCredentials: true, params: { page: 1, page_size: 10 } })
  await fetchProductReviews('a/b', { page: 2, pageSize: 5, apiBaseUrl: 'https://api.example.test/' })
  expect(get).toHaveBeenLastCalledWith('https://api.example.test/products/a%2Fb/reviews', { withCredentials: true, params: { page: 2, page_size: 5 } })
})

test('리뷰 작성은 평점과 앞뒤 공백을 지운 내용만 쿠키와 함께 보낸다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 201, message: 'ok', result: review } })
  await expect(createReview(3, { rating: 4, content: '  조용하고 온도도 안정적입니다.  ' })).resolves.toEqual(review)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/products/3/reviews', { rating: 4, content: '조용하고 온도도 안정적입니다.' }, { withCredentials: true })
})

test('리뷰 수정은 넣은 값만 보내고 경로의 두 값을 인코딩한다', async () => {
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue({ data: { result: review } })
  await updateReview(3, 5, { rating: 5, content: ' 다시 써 봐도 만족스럽습니다. ' })
  expect(patch).toHaveBeenLastCalledWith('http://127.0.0.1:8000/products/3/reviews/5', { rating: 5, content: '다시 써 봐도 만족스럽습니다.' }, { withCredentials: true })
  await updateReview('a/b', 'c/d', { rating: 2 }, { apiBaseUrl: 'https://api.example.test' })
  expect(patch).toHaveBeenLastCalledWith('https://api.example.test/products/a%2Fb/reviews/c%2Fd', { rating: 2 }, { withCredentials: true })
})

test('리뷰 삭제는 쿠키를 싣고 null 을 돌려준다', async () => {
  const remove = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { result: null } })
  await expect(deleteReview(3, 5)).resolves.toBeNull()
  expect(remove).toHaveBeenCalledWith('http://127.0.0.1:8000/products/3/reviews/5', { withCredentials: true })
})

test.each([
  ['평점 없음', () => createReview(3, { content: '열 글자가 넘는 리뷰 내용입니다.' }), '별점'],
  ['평점 6', () => createReview(3, { rating: 6, content: '열 글자가 넘는 리뷰 내용입니다.' }), '별점'],
  ['내용 9자', () => createReview(3, { rating: 5, content: '  아홉글자리뷰입니  ' }), '10자 이상'],
  ['내용 2001자', () => createReview(3, { rating: 5, content: '가'.repeat(2001) }), '2,000자'],
  ['수정할 값 없음', () => updateReview(3, 5, {}), '바뀐 별점이나 내용이 없습니다.'],
  ['null 값만', () => updateReview(3, 5, { rating: null, content: null }), '바뀐 별점이나 내용이 없습니다.'],
  ['수정 내용 짧음', () => updateReview(3, 5, { content: '짧음' }), '10자 이상'],
])('%s 은 요청하지 않고 오류를 던진다', async (_name, call, message) => {
  const post = jest.spyOn(axios, 'post')
  const patch = jest.spyOn(axios, 'patch')
  await expect(call()).rejects.toThrow(message)
  expect(post).not.toHaveBeenCalled()
  expect(patch).not.toHaveBeenCalled()
})

test('서버 오류(403 미구매·409 이미 작성)는 잡지 않고 던진다', async () => {
  const failure = { response: { status: 409, data: { message: '이미 이 상품의 리뷰를 작성했습니다.' } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(createReview(3, { rating: 5, content: '열 글자가 넘는 리뷰 내용입니다.' })).rejects.toBe(failure)
})
