// 로그인 상태 공용 저장소: GET /user/me 를 한 페이지에서 한 번만 부르고 레이아웃과 화면이 결과를 나눠 쓴다.
// 상태는 { status: 'loading' | 'member' | 'guest' | 'error', profile, error }.
// - 401 만 비로그인(guest)이고, 그 밖의 실패(5xx·네트워크)는 오류(error). error 에 원래 오류를 남겨 화면이 문구를 만든다
// - load(): 진행 중이면 같은 Promise, 끝났으면 저장한 결과를 돌려준다(다시 부르지 않는다)
// - refresh(): 다시 부른다. "다시 시도"·"로그인 상태 다시 확인" 버튼과 로그인 뒤에 쓴다
// - logout(): POST /user/logout 에 성공하면 /user/me 를 다시 부른다(실패하면 던진다)
// - subscribe(listener): 상태가 바뀔 때마다 알린다(지금 상태로 한 번 바로 부른다). 해제 함수를 돌려준다
// Promise 는 reject 하지 않는다(logout 만 예외). Vue 를 import 하지 않는다: 화면이 subscribe 로 자기 ref 를 갱신한다.
import { fetchCurrentUser as requestCurrentUser, logout as requestLogout } from '../api/authApi.js'

export const AUTH_STATUSES = ['loading', 'member', 'guest', 'error']

const loadingState = () => ({ status: 'loading', profile: null, error: null })

/** GET /user/me 결과 → 상태. 성공했지만 사용자 정보가 없으면 guest. */
export function authStateFromProfile(profile) {
  return profile ? { status: 'member', profile, error: null } : { status: 'guest', profile: null, error: null }
}

/** GET /user/me 실패 → 상태. 401 만 guest, 그 밖은 error(원래 오류를 남긴다). */
export function authStateFromError(error) {
  return { status: error?.response?.status === 401 ? 'guest' : 'error', profile: null, error }
}

/** 상태가 로그인 사용자면 profile, 아니면 null. */
export function memberProfile(state) {
  return state?.status === 'member' ? state.profile : null
}

/** 저장소를 만든다. 테스트는 fetchCurrentUser·logout 에 jest.fn 을 넣는다. */
export function createAuthSession({ fetchCurrentUser = requestCurrentUser, logout: signOut = requestLogout } = {}) {
  let state = loadingState()
  let settled = false
  let pending = null
  let version = 0
  const listeners = new Set()

  function publish(next) {
    state = next
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch { /* 한 화면의 오류가 다른 화면의 갱신을 막지 않게 한다 */ }
    }
  }

  function load({ force = false } = {}) {
    if (!force && pending) return pending
    if (!force && settled) return Promise.resolve(state)
    const current = ++version
    if (state.status !== 'loading') publish(loadingState())
    pending = (async () => {
      let next
      try {
        next = authStateFromProfile(await fetchCurrentUser())
      } catch (error) {
        next = authStateFromError(error)
      }
      // 그사이 다시 부르기(refresh)·reset 이 있었으면 늦게 온 이 결과는 버리고 새 결과를 돌려준다
      if (current !== version) return pending || state
      pending = null
      settled = true
      publish(next)
      return next
    })()
    return pending
  }

  async function logout() {
    await signOut()
    load({ force: true })
  }

  return {
    getState: () => state,
    load,
    refresh: () => load({ force: true }),
    logout,
    subscribe(listener) {
      listeners.add(listener)
      try {
        listener(state)
      } catch { /* 위와 같다 */ }
      return () => listeners.delete(listener)
    },
    /** 처음 상태로 되돌린다(테스트가 매번 새로 시작할 때). 진행 중인 요청의 결과는 버린다. */
    reset() {
      version++
      pending = null
      settled = false
      publish(loadingState())
    },
  }
}

// 앱 전체가 함께 쓰는 로그인 상태
export const authSession = createAuthSession()
