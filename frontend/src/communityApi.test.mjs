// 커뮤니티 API(src/api/communityApi.js)의 요청 모양: URL·메서드·본문(snake_case)·쿠키·params. spec 2026-11-01-community-dark-theme "API 계약"
import axios from 'axios'
import { jest } from '@jest/globals'
import {
  createCommunityComment, createCommunityPost, deleteCommunityComment, deleteCommunityPost, fetchCommunityPost, fetchCommunityPosts,
  updateCommunityComment, updateCommunityPost,
} from './api/communityApi.js'

afterEach(() => jest.restoreAllMocks())

const API = 'http://127.0.0.1:8000'
const ok = (result) => ({ data: { code: 200, message: '성공했습니다.', result } })

describe('글 목록·상세', () => {
  test('목록은 게시판·쪽·쪽 크기·검색어(앞뒤 공백 제거)를 params 로 보내고 쿠키는 싣지 않는다', async () => {
    const page = { items: [], total: 0, page: 2, page_size: 10 }
    const get = jest.spyOn(axios, 'get').mockResolvedValue(ok(page))
    expect(await fetchCommunityPosts({ board: 'build', page: 2, search: '  게임용  ', apiBaseUrl: 'https://api.example.test/' })).toEqual(page)
    expect(get).toHaveBeenCalledWith('https://api.example.test/community/posts', { params: { board: 'build', page: 2, page_size: 10, search: '게임용' } })
  })

  test('빈 검색어는 보내지 않고, 쪽 크기를 바꿀 수 있다(커뮤니티 홈은 5개)', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [], total: 0, page: 1, page_size: 5 }))
    await fetchCommunityPosts({ board: 'free', pageSize: 5, search: '   ' })
    expect(get).toHaveBeenCalledWith(`${API}/community/posts`, { params: { board: 'free', page: 1, page_size: 5 } })
  })

  test('용도 필터(purpose)는 견적 게시판에서 고른 때만 보낸다(빈 값·자유 게시판은 보내지 않는다: 서버가 422)', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [{ id: 3, quote_count: 2 }], total: 1, page: 1, page_size: 10 }))
    expect((await fetchCommunityPosts({ board: 'build', purpose: 'gaming' })).items[0].quote_count).toBe(2)
    expect(get).toHaveBeenLastCalledWith(`${API}/community/posts`, { params: { board: 'build', page: 1, page_size: 10, purpose: 'gaming' } })
    await fetchCommunityPosts({ board: 'build', purpose: '' })
    expect(get).toHaveBeenLastCalledWith(`${API}/community/posts`, { params: { board: 'build', page: 1, page_size: 10 } })
    await fetchCommunityPosts({ board: 'free', purpose: 'gaming' })
    expect(get).toHaveBeenLastCalledWith(`${API}/community/posts`, { params: { board: 'free', page: 1, page_size: 10 } })
  })

  test('상세는 로그인했으면 is_owner 를 받으려고 쿠키를 싣고, 경로 id 를 encodeURIComponent 한다', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ id: 3 }))
    expect(await fetchCommunityPost(3)).toEqual({ id: 3 })
    expect(get).toHaveBeenLastCalledWith(`${API}/community/posts/3`, { withCredentials: true })
    await fetchCommunityPost('a/b')
    expect(get).toHaveBeenLastCalledWith(`${API}/community/posts/a%2Fb`, { withCredentials: true })
  })
})

describe('글 작성·수정·삭제', () => {
  test('견적 글은 budget_krw·purpose 를 함께, 앞뒤 공백을 지워 보낸다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 9 }))
    expect(await createCommunityPost({ board: 'build', title: ' 150만 원 게임용 ', content: ' 배그 QHD ', budgetKrw: 1500000, purpose: 'gaming' })).toEqual({ id: 9 })
    expect(post).toHaveBeenCalledWith(`${API}/community/posts`, { board: 'build', title: '150만 원 게임용', content: '배그 QHD', budget_krw: 1500000, purpose: 'gaming' }, { withCredentials: true })
  })

  test('자유 글은 예산·용도 없이 보낸다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 10 }))
    await createCommunityPost({ board: 'free', title: '조립 후기', content: '잘 됩니다' })
    expect(post).toHaveBeenCalledWith(`${API}/community/posts`, { board: 'free', title: '조립 후기', content: '잘 됩니다' }, { withCredentials: true })
  })

  test.each([
    ['모르는 게시판', { board: 'notice', title: '제목', content: '내용' }, '게시판을 찾을 수 없습니다.'],
    ['빈 제목', { board: 'free', title: '  ', content: '내용' }, '제목을 입력해 주세요.'],
    ['견적 글의 예산 범위 밖', { board: 'build', title: '제목', content: '내용', budgetKrw: 90000, purpose: 'gaming' }, '예산은 10만 원부터'],
    ['견적 글의 모르는 용도', { board: 'build', title: '제목', content: '내용', budgetKrw: 1500000, purpose: 'mining' }, '용도를 골라 주세요.'],
    ['자유 글의 예산', { board: 'free', title: '제목', content: '내용', budgetKrw: 1500000 }, '견적 게시판 글에만'],
  ])('검사에 걸리면(%s) 요청하지 않는다', async (_name, values, message) => {
    const post = jest.spyOn(axios, 'post')
    await expect(createCommunityPost(values)).rejects.toThrow(message)
    expect(post).not.toHaveBeenCalled()
  })

  test('수정은 바뀐 필드만 snake_case 로 보낸다', async () => {
    const patch = jest.spyOn(axios, 'patch').mockResolvedValue(ok({ id: 3 }))
    await updateCommunityPost(3, { budgetKrw: 2000000, purpose: 'creative' })
    expect(patch).toHaveBeenLastCalledWith(`${API}/community/posts/3`, { budget_krw: 2000000, purpose: 'creative' }, { withCredentials: true })
    await updateCommunityPost(3, { title: ' 새 제목 ' })
    expect(patch).toHaveBeenLastCalledWith(`${API}/community/posts/3`, { title: '새 제목' }, { withCredentials: true })
  })

  test('바뀐 필드가 없거나 틀리면 PATCH 를 보내지 않는다(서버는 빈 본문을 422 로 거절한다)', async () => {
    const patch = jest.spyOn(axios, 'patch')
    await expect(updateCommunityPost(3, {})).rejects.toThrow('바뀐 내용이 없습니다.')
    await expect(updateCommunityPost(3, { content: '   ' })).rejects.toThrow('내용을 입력해 주세요.')
    await expect(updateCommunityPost(3, { budgetKrw: null })).rejects.toThrow('예산은 10만 원부터')
    expect(patch).not.toHaveBeenCalled()
  })

  test('삭제는 쿠키를 싣고 result(null)를 돌려준다', async () => {
    const remove = jest.spyOn(axios, 'delete').mockResolvedValue(ok(null))
    expect(await deleteCommunityPost('7')).toBeNull()
    expect(remove).toHaveBeenCalledWith(`${API}/community/posts/7`, { withCredentials: true })
  })
})

describe('댓글', () => {
  const lines = [
    { product_id: 1, name: '라이젠7 9800X3D', price_krw: 739000, quantity: 1 },
    { product_id: 7, name: '지포스 RTX 5070 Ti', price_krw: 1290000, quantity: 1 },
  ]

  test('작성은 내용과 부품(product_id·quantity 만, 가격·합계는 보내지 않는다)을 보낸다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 10 }))
    expect(await createCommunityComment(3, { content: ' 이렇게 맞춰 보세요 ', items: lines })).toEqual({ id: 10 })
    expect(post).toHaveBeenCalledWith(`${API}/community/posts/3/comments`, {
      content: '이렇게 맞춰 보세요', items: [{ product_id: 1, quantity: 1 }, { product_id: 7, quantity: 1 }],
    }, { withCredentials: true })
  })

  test('부품이 없으면 items 를 빼고 보낸다(자유 게시판 댓글)', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 11 }))
    await createCommunityComment('a/b', { content: '좋네요' })
    expect(post).toHaveBeenCalledWith(`${API}/community/posts/a%2Fb/comments`, { content: '좋네요' }, { withCredentials: true })
  })

  test.each([
    ['빈 내용', { content: '  ' }, '댓글 내용을 입력해 주세요.'],
    ['16줄', { content: '견적', items: Array.from({ length: 16 }, (_, index) => ({ product_id: index + 1, quantity: 1 })) }, '15줄까지'],
    ['수량 11', { content: '견적', items: [{ product_id: 1, quantity: 11 }] }, '1개부터 10개까지'],
    ['같은 상품 두 줄', { content: '견적', items: [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }] }, '같은 상품을 두 줄로'],
  ])('작성 검사에 걸리면(%s) 요청하지 않는다', async (_name, values, message) => {
    const post = jest.spyOn(axios, 'post')
    await expect(createCommunityComment(3, values)).rejects.toThrow(message)
    expect(post).not.toHaveBeenCalled()
  })

  test('수정은 바뀐 필드만: 부품 목록은 목록 전체, [] 는 비움', async () => {
    const patch = jest.spyOn(axios, 'patch').mockResolvedValue(ok({ id: 10 }))
    await updateCommunityComment(10, { items: lines })
    expect(patch).toHaveBeenLastCalledWith(`${API}/community/comments/10`, { items: [{ product_id: 1, quantity: 1 }, { product_id: 7, quantity: 1 }] }, { withCredentials: true })
    await updateCommunityComment(10, { items: [] })
    expect(patch).toHaveBeenLastCalledWith(`${API}/community/comments/10`, { items: [] }, { withCredentials: true })
    await updateCommunityComment('1/2', { content: ' 고친 내용 ' })
    expect(patch).toHaveBeenLastCalledWith(`${API}/community/comments/1%2F2`, { content: '고친 내용' }, { withCredentials: true })
  })

  test('바뀐 필드가 없거나 빈 내용이면 PATCH 를 보내지 않는다', async () => {
    const patch = jest.spyOn(axios, 'patch')
    await expect(updateCommunityComment(10, {})).rejects.toThrow('바뀐 내용이 없습니다.')
    await expect(updateCommunityComment(10, { content: ' ' })).rejects.toThrow('댓글 내용을 입력해 주세요.')
    expect(patch).not.toHaveBeenCalled()
  })

  test('삭제는 쿠키를 싣는다', async () => {
    const remove = jest.spyOn(axios, 'delete').mockResolvedValue(ok(null))
    expect(await deleteCommunityComment(10, { apiBaseUrl: 'https://api.example.test' })).toBeNull()
    expect(remove).toHaveBeenCalledWith('https://api.example.test/community/comments/10', { withCredentials: true })
  })
})
