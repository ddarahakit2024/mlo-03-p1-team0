import axios from 'axios'
import { baseUrl } from './config.js'
import { signupPurpose } from '../stores/authViewModel.js'

// 로그인은 HttpOnly 쿠키로 유지된다. 쿠키를 받고(로그인) 보내야(내 정보) 하므로 모든 인증 요청에 싣는다.
const credentials = { withCredentials: true }

export async function loginWithEmail({ email, password }, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/user/login`, {
    email: email.trim(), password,
  }, credentials)
  return response.data.result
}

/** POST /user/signup { name, email, password, purpose }. purpose(사용 목적)는 선택: 고르지 않으면 null(spec docs/specs/2026-11-01-build-id-purpose.md). */
export async function signupWithEmail({ name, email, password, purpose = null }, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/user/signup`, {
    name: name.trim(), email: email.trim(), password, purpose: signupPurpose(purpose),
  }, credentials)
  return response.data.result
}

export async function loginWithKakao(code, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/user/kakao/login`, { code }, credentials)
  return response.data.result
}

export async function fetchCurrentUser({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/user/me`, credentials)
  return response.data.result
}

/** POST /user/logout → null. 로그인하지 않았어도 200(멱등). 서버가 같은 속성의 만료 쿠키를 돌려준다. */
export async function logout({ apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/user/logout`, null, credentials)
  return response.data.result
}

export const MY_POSTS_PAGE_SIZE = 20

/** GET /user/me/posts?page=&page_size= → { items: [{ kind(question·free·build), id, title, created_at, reply_count }], total, page, page_size } (최근 순) */
export async function fetchMyPosts({ page = 1, pageSize = MY_POSTS_PAGE_SIZE, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/user/me/posts`, { ...credentials, params: { page, page_size: pageSize } })
  return response.data.result
}
