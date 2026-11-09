// 2026-11-05 가격 추적 재설계로 기존 API 모듈에 더한 요청의 모양:
// 상품(추세 필터·price-summary·price-match), 질문(관련 부품·채택), 커뮤니티(모니터 해상도·선호 사항), 내 글.
import axios from 'axios'
import { jest } from '@jest/globals'
import { fetchMyPosts } from './api/authApi.js'
import { createCommunityPost, updateCommunityPost } from './api/communityApi.js'
import { fetchPriceSummary, fetchProducts, requestPriceMatch } from './api/productApi.js'
import { acceptAnswer, createQuestion, fetchQuestions, unacceptAnswer, updateQuestion } from './api/questionApi.js'

afterEach(() => jest.restoreAllMocks())

const ok = (result) => ({ data: { code: 200, message: '', result } })
const API = 'http://127.0.0.1:8000'
const credentials = { withCredentials: true }

test('상품 목록은 켠 추세 필터만 true 로 보낸다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [] }))
  await fetchProducts({ sort: 'drop_desc', dropping: true, nearLow: false, storeLowest: true })
  expect(get).toHaveBeenCalledWith(`${API}/products`, { params: { page: 1, page_size: 20, sort: 'drop_desc', dropping: true, store_lowest: true } })
  await fetchProducts()
  expect(get.mock.calls[1][1].params).toEqual({ page: 1, page_size: 20, sort: 'recommended' })
})

test('가격 요약은 공개 GET(쿠키 없음)', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ product_count: 409, dropping_count: 3, lowest_1y_count: 4 }))
  await expect(fetchPriceSummary()).resolves.toEqual({ product_count: 409, dropping_count: 3, lowest_1y_count: 4 })
  expect(get).toHaveBeenCalledWith(`${API}/products/price-summary`)
})

test('최저가 매칭 요청은 쿠키를 싣고 본문 없이 POST, 경로 값을 인코딩한다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1, status: 'requested' }))
  await expect(requestPriceMatch(7)).resolves.toEqual({ id: 1, status: 'requested' })
  expect(post).toHaveBeenCalledWith(`${API}/products/7/price-match`, null, credentials)
  await requestPriceMatch('a/b')
  expect(post).toHaveBeenLastCalledWith(`${API}/products/a%2Fb/price-match`, null, credentials)
})

test('질문 목록은 productId 가 있을 때만 product_id 를 보낸다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [] }))
  await fetchQuestions({ productId: 7, pageSize: 5 })
  expect(get).toHaveBeenCalledWith(`${API}/questions`, { ...credentials, params: { page: 1, page_size: 5, search: '', product_id: 7 } })
  await fetchQuestions()
  expect(get.mock.calls[1][1].params).toEqual({ page: 1, page_size: 10, search: '' })
})

test('질문 등록은 관련 부품을 골랐을 때만 product_id 를 보낸다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1 }))
  await createQuestion({ title: ' 제목 ', content: ' 내용 ', productId: 7 })
  expect(post).toHaveBeenCalledWith(`${API}/questions`, { title: '제목', content: '내용', upload_ids: [], product_id: 7 }, credentials)
  await createQuestion({ title: '제목', content: '내용' })
  expect(post.mock.calls[1][1]).toEqual({ title: '제목', content: '내용', upload_ids: [] })
})

test('질문 수정은 productId 를 넘겼을 때만 product_id 를 보낸다(null 은 연결 해제)', async () => {
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue(ok({ id: 1 }))
  await updateQuestion(1, { title: '제목', content: '내용' })
  expect(patch).toHaveBeenCalledWith(`${API}/questions/1`, { title: '제목', content: '내용' }, credentials)
  await updateQuestion(1, { title: '제목', content: '내용', productId: null })
  expect(patch.mock.calls[1][1]).toEqual({ title: '제목', content: '내용', product_id: null })
  await updateQuestion(1, { title: '제목', content: '내용', productId: 9 })
  expect(patch.mock.calls[2][1]).toEqual({ title: '제목', content: '내용', product_id: 9 })
})

test('답변 채택·취소는 accept 경로에 POST·DELETE', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1, accepted_answer_id: 3 }))
  const del = jest.spyOn(axios, 'delete').mockResolvedValue(ok({ id: 1, accepted_answer_id: null }))
  await expect(acceptAnswer(1, 3)).resolves.toEqual({ id: 1, accepted_answer_id: 3 })
  expect(post).toHaveBeenCalledWith(`${API}/questions/1/answers/3/accept`, null, credentials)
  await expect(unacceptAnswer('a/b', 3)).resolves.toEqual({ id: 1, accepted_answer_id: null })
  expect(del).toHaveBeenCalledWith(`${API}/questions/a%2Fb/answers/3/accept`, credentials)
})

test('견적 글은 모니터 해상도와 선호 사항(중복 제거)을 함께 보내고 자유 글은 보내지 않는다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1 }))
  await createCommunityPost({ board: 'build', title: '견적', content: '내용', budgetKrw: 1500000, purpose: 'gaming', monitorResolution: 'qhd', preferences: ['quiet', 'rgb', 'quiet'] })
  expect(post).toHaveBeenCalledWith(`${API}/community/posts`, {
    board: 'build', title: '견적', content: '내용', budget_krw: 1500000, purpose: 'gaming', monitor_resolution: 'qhd', preferences: ['quiet', 'rgb'],
  }, credentials)
  await createCommunityPost({ board: 'free', title: '자유', content: '내용', monitorResolution: 'qhd', preferences: ['rgb'] })
  expect(post.mock.calls[1][1]).toEqual({ board: 'free', title: '자유', content: '내용' })
})

test('견적 글 수정은 바뀐 모니터 해상도·선호 사항만 보낸다', async () => {
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue(ok({ id: 1 }))
  await updateCommunityPost(1, { title: '새 제목', monitorResolution: 'uhd', preferences: ['white'] })
  expect(patch).toHaveBeenCalledWith(`${API}/community/posts/1`, { title: '새 제목', monitor_resolution: 'uhd', preferences: ['white'] }, credentials)
})

test('내 글은 쿠키를 싣고 page·page_size 를 보낸다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 20 }))
  await expect(fetchMyPosts()).resolves.toEqual({ items: [], total: 0, page: 1, page_size: 20 })
  expect(get).toHaveBeenCalledWith(`${API}/user/me/posts`, { ...credentials, params: { page: 1, page_size: 20 } })
})
