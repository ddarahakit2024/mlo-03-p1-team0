import axios from 'axios'
import { jest } from '@jest/globals'
import { fetchCurrentUser, loginWithEmail, loginWithKakao, logout, signupWithEmail } from './api/authApi.js'

afterEach(() => jest.restoreAllMocks())

const ok = (result) => ({ data: { code: 200, message: '성공했습니다.', result } })

test('이메일 로그인은 고정 경로로 쿠키를 받고 이메일만 공백을 지운다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ authenticated: true }))
  await expect(loginWithEmail({ email: ' person@example.com ', password: ' secret ' })).resolves.toEqual({ authenticated: true })
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/user/login', { email: 'person@example.com', password: ' secret ' }, { withCredentials: true })
})

test('회원가입은 이름·이메일·비밀번호와 사용 목적(고르지 않으면 null)만 보낸다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1, email: 'person@example.com', name: '김학습' }))
  await signupWithEmail({ mode: 'signup', name: ' 김학습 ', email: 'person@example.com', password: 'password1' })
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/user/signup', { name: '김학습', email: 'person@example.com', password: 'password1', purpose: null }, { withCredentials: true })
})

test.each([
  ['고른 사용 목적은 코드 그대로', 'gaming', 'gaming'],
  ['선택 안 함(빈 값)은 null', '', null],
  ['null 은 null', null, null],
])('회원가입 purpose: %s (spec 2026-11-01-build-id-purpose)', async (_name, purpose, sent) => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 1, email: 'person@example.com', name: '김학습' }))
  await signupWithEmail({ mode: 'signup', name: '김학습', email: 'person@example.com', password: 'password1', purpose }, { apiBaseUrl: 'https://api.example.test/' })
  expect(post).toHaveBeenCalledWith('https://api.example.test/user/signup', { name: '김학습', email: 'person@example.com', password: 'password1', purpose: sent }, { withCredentials: true })
})

test('회원가입이 422(모르는 사용 목적)로 실패하면 그대로 던진다', async () => {
  const failure = { response: { status: 422, data: { message: '입력값이 올바르지 않습니다.' } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(signupWithEmail({ mode: 'signup', name: '김학습', email: 'person@example.com', password: 'password1', purpose: 'mining' })).rejects.toBe(failure)
})

test('카카오 로그인은 인가 코드를 본문으로 보내고 apiBaseUrl 끝의 / 를 지운다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ authenticated: true }))
  await expect(loginWithKakao('a/b?code', { apiBaseUrl: 'https://api.example.test/' })).resolves.toEqual({ authenticated: true })
  expect(post).toHaveBeenCalledWith('https://api.example.test/user/kakao/login', { code: 'a/b?code' }, { withCredentials: true })
})

test('현재 사용자는 쿠키를 실어 조회하고 result 만 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ name: 'Moa', provider: 'kakao' }))
  await expect(fetchCurrentUser({ apiBaseUrl: 'https://api.example.test' })).resolves.toEqual({ name: 'Moa', provider: 'kakao' })
  expect(get).toHaveBeenCalledWith('https://api.example.test/user/me', { withCredentials: true })
})

test('오류는 잡지 않고 그대로 던진다(화면이 authError 로 문구를 만든다)', async () => {
  const failure = { response: { status: 401, data: { message: '이메일 또는 비밀번호가 올바르지 않습니다.' } } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(loginWithEmail({ email: 'person@example.com', password: 'wrong' })).rejects.toBe(failure)
})

test('로그아웃은 본문 없이 쿠키를 실어 보내고(만료 쿠키를 받는다) result 만 돌려준다', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 200, message: '로그아웃되었습니다.', result: null } })
  await expect(logout()).resolves.toBeNull()
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/user/logout', null, { withCredentials: true })
  await logout({ apiBaseUrl: 'https://api.example.test/' })
  expect(post).toHaveBeenLastCalledWith('https://api.example.test/user/logout', null, { withCredentials: true })
})

test('로그아웃 실패(403 Origin 등)는 그대로 던진다', async () => {
  const failure = { response: { status: 403 } }
  jest.spyOn(axios, 'post').mockRejectedValue(failure)
  await expect(logout()).rejects.toBe(failure)
})
