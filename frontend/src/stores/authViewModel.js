// 로그인·회원가입·카카오 로그인 화면의 검증, 오류 문구, 카카오 인증 흐름, 이동 함수.
// Vue·axios 를 import 하지 않는다. 브라우저 객체(sdk, storage, history, crypto, location)는 인자로 받는다.
import { COMMUNITY_PURPOSES } from './communityViewModel.js'

export const KAKAO_STATE_KEY = 'kakao_oauth_state'
// 회원가입의 "사용 목적(선택)". 이름·코드는 견적 게시판 용도와 같다(spec docs/specs/2026-11-01-build-id-purpose.md "화면")
export const SIGNUP_PURPOSES = COMMUNITY_PURPOSES.map(({ code, name }) => ({ code, name }))
const SIGNUP_PURPOSE_CODES = SIGNUP_PURPOSES.map((purpose) => purpose.code)
export const KAKAO_CALLBACK_PATH = '/login/kakao/callback'

// 서버(app/schemas/user.py)와 같은 제한
export const MAX_NAME_LENGTH = 100
export const MAX_EMAIL_LENGTH = 320
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 사용 목적 select 값 → 보낼 값. 고르지 않음('')·null 은 null, 목록에 있는 코드는 그대로. 모르는 값은 그대로 둬서 검사가 막는다. */
export function signupPurpose(value) {
  return value === '' || value == null ? null : value
}

/** 로그인 화면 주소의 ?mode=signup 이면 회원가입 창으로 연다. 그 밖에는 로그인. */
export function authModeFromSearch(search = '') {
  return new URLSearchParams(search || '').get('mode') === 'signup' ? 'signup' : 'login'
}

/** 로그인·회원가입 입력을 서버로 보내기 전에 검사한다. 문제가 없으면 ''. purpose 는 가입할 때만 본다(null = 고르지 않음). */
export function validateCredentials({ mode = 'login', name = '', email = '', password = '', purpose = null } = {}) {
  const signup = mode === 'signup'
  if (signup && !name.trim()) return '이름을 입력해 주세요.'
  if (signup && name.trim().length > MAX_NAME_LENGTH) return '이름은 100자까지 입력할 수 있습니다.'
  if (!email.trim()) return '이메일 주소를 입력해 주세요.'
  if (email.trim().length > MAX_EMAIL_LENGTH) return '이메일 주소는 320자까지 입력할 수 있습니다.'
  if (signup && !EMAIL_PATTERN.test(email.trim())) return '올바른 이메일 주소를 입력해 주세요. 예: name@example.com'
  if (!password) return '비밀번호를 입력해 주세요.'
  if (signup && password.length < MIN_PASSWORD_LENGTH) return '비밀번호는 8자 이상 입력해 주세요.'
  if (password.length > MAX_PASSWORD_LENGTH) return '비밀번호는 128자까지 입력할 수 있습니다.'
  if (signup && purpose != null && !SIGNUP_PURPOSE_CODES.includes(purpose)) return '사용 목적을 목록에서 다시 골라 주세요.'
  return ''
}

/** 응답을 받지 못한 axios 오류(서버 꺼짐, 네트워크 끊김, 시간 초과). */
export function isNetworkError(error) {
  return Boolean(error?.isAxiosError) && !error.response
}

/** 이메일 로그인·회원가입 실패 문구. 서버가 HTML(예: 502 게이트웨이 페이지)을 돌려줘도 fallback 을 보여 준다. */
export function authError(error, fallback = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.') {
  const status = error?.response?.status
  if (status === 409) return '이미 가입된 이메일입니다. 로그인해 주세요.'
  if (status === 401) return '이메일 또는 비밀번호를 확인해 주세요.'
  if (status === 422) return '입력 정보를 다시 확인해 주세요.'
  if (isNetworkError(error)) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.'
  return error?.response?.data?.message || fallback
}

const KAKAO_ERRORS = {
  not_configured: '카카오 로그인을 준비하지 못했습니다. 이메일로 로그인하거나 잠시 후 다시 시도해 주세요.',
  invalid_state: '로그인 요청을 확인할 수 없습니다. 카카오 로그인을 처음부터 다시 시도해 주세요.',
  cancelled: '카카오 로그인을 취소했습니다. 다시 시도하거나 이메일로 로그인해 주세요.',
  kakao_error: '카카오에서 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  missing_code: '카카오 인증 정보를 받지 못했습니다. 카카오 로그인을 다시 시도해 주세요.',
  exchange_failed: '카카오 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

/** beginKakaoLogin 실패(not_configured)와 completeKakaoCallback 의 error 코드를 문구로 바꾼다. */
export function kakaoLoginError(code) {
  return KAKAO_ERRORS[code] || '카카오 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'
}

export function isKakaoCallback(pathname = '') {
  return pathname === KAKAO_CALLBACK_PATH
}

export function kakaoRedirectUri(origin) {
  return new URL(KAKAO_CALLBACK_PATH, origin).toString()
}

/** 카카오 인가 요청과 콜백을 짝짓는 1회용 state(16바이트 hex). */
export function createOAuthState(crypto = globalThis.crypto) {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function beginKakaoLogin({ sdk, key, redirectUri, storage, state }) {
  if (!sdk || !key || !redirectUri || !state) {
    throw new Error('kakao_not_configured')
  }

  if (!sdk.isInitialized()) {
    sdk.init(key)
  }

  storage.setItem(KAKAO_STATE_KEY, state)
  sdk.Auth.authorize({
    redirectUri,
    scope: 'profile_nickname',
    state,
  })
}

/** 카카오 콜백 주소(?code=&state=)를 확인하고 state 가 맞을 때만 exchangeCode(code) 로 로그인한다. */
export async function completeKakaoCallback({ search, storage, history, exchangeCode }) {
  const params = new URLSearchParams(search)
  const returnedState = params.get('state')
  const expectedState = storage.getItem(KAKAO_STATE_KEY)
  const code = params.get('code')
  const error = params.get('error')

  storage.removeItem(KAKAO_STATE_KEY)
  history.replaceState({}, '', '/login')

  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return { ok: false, error: 'invalid_state' }
  }
  if (error === 'access_denied') {
    return { ok: false, error: 'cancelled' }
  }
  if (error) {
    return { ok: false, error: 'kakao_error' }
  }
  if (!code) {
    return { ok: false, error: 'missing_code' }
  }

  try {
    await exchangeCode(code)
    return { ok: true }
  } catch {
    return { ok: false, error: 'exchange_failed' }
  }
}

/** 헤더·마이페이지 동그라미에 쓰는 이름 첫 글자. 이름이 비면 'M'. */
export function profileInitial(name) {
  return Array.from(String(name ?? '').trim())[0] || 'M'
}

export function goToMain(location = window.location) {
  location.assign('/')
}

/** 로그아웃(POST /user/logout) 실패 문구. 서버는 로그인하지 않았어도 200 이므로 실패는 연결·Origin 문제다. */
export function logoutError(error) {
  if (isNetworkError(error)) return '서버에 연결하지 못해 로그아웃하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  return '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}
