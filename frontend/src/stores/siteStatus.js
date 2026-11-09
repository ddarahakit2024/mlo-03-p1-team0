// 헤더·하단 탭 막대가 보여 주는 공용 상태: 장바구니 수량, 비교함 개수, 읽지 않은 알림 수, 잠깐 떴다 사라지는 안내(토스트).
// 상태는 { cartCount, compareCount, unreadCount, toast(문구 또는 null) }.
// - load(): 페이지에서 한 번. 로그인 상태(authSession)를 기다려 회원이면 GET /cart 의 item_count 와 GET /notifications/unread-count 를 함께 부른다.
//   실패해도 숫자는 0 으로 두고 던지지 않는다(헤더 숫자는 보조 정보). 진행 중이면 같은 Promise
// - refresh(): 다시 부른다(로그인 직후 등)
// - setCartCount·setUnreadCount·setCompareCount: 화면이 서버 응답을 받은 뒤 숫자를 바로 맞춘다(다시 부르지 않는다)
// - showToast(message): 문구를 TOAST_MS 동안 보여 준다. 새 문구는 앞 문구를 바꾼다. dismissToast() 로 바로 닫는다
// - subscribe(listener): 바뀔 때마다 알린다(지금 상태로 한 번 바로 부른다). 해제 함수를 돌려준다
// 화면: 장바구니 응답 뒤 setCartCount(cart.item_count), 비교함이 바뀐 뒤 setCompareCount(n), 알림을 읽은 뒤 setUnreadCount(n),
//   디자인의 짧은 안내는 showToast('장바구니에 담았어요'). 헤더(SiteLayout)가 subscribe 로 배지·토스트를 그린다
// Vue 를 import 하지 않는다: 레이아웃이 subscribe 로 자기 ref 를 갱신한다.
import { fetchCart as requestCart } from '../api/cartApi.js'
import { fetchUnreadCount as requestUnreadCount } from '../api/notificationApi.js'
import { authSession as defaultSession } from './authSession.js'
import { browserCompareStorage, parseCompare } from './compareViewModel.js'

export const TOAST_MS = 2400

function count(value) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** 헤더·하단 탭 배지 글자: 0 이하는 ''(배지 없음), 100 이상은 '99+'. */
export function countBadge(value) {
  const number = count(value)
  if (!number) return ''
  return number > 99 ? '99+' : String(number)
}

/** 비교함(localStorage moa.compare)에 담긴 상품 수. 읽지 못하면 0. */
export function storedCompareCount(storage = browserCompareStorage()) {
  try {
    return storage?.available ? parseCompare(storage.get()).items.length : 0
  } catch {
    return 0
  }
}

const initialState = () => ({ cartCount: 0, compareCount: 0, unreadCount: 0, toast: null })

/** 저장소를 만든다. 테스트는 fetchCart·fetchUnreadCount·session·compareCount·타이머에 가짜를 넣는다. */
export function createSiteStatus({
  fetchCart = requestCart,
  fetchUnreadCount = requestUnreadCount,
  session = defaultSession,
  compareCount = () => storedCompareCount(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  let state = initialState()
  let pending = null
  let settled = false
  let version = 0
  let toastTimer = null
  let toastId = 0
  const listeners = new Set()

  function publish(patch) {
    state = { ...state, ...patch }
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch { /* 한 화면의 오류가 다른 화면의 갱신을 막지 않게 한다 */ }
    }
  }

  async function fetchCounts() {
    const auth = await session.load()
    if (auth?.status !== 'member') return { cartCount: 0, unreadCount: 0 }
    const [cart, unread] = await Promise.allSettled([fetchCart(), fetchUnreadCount()])
    return {
      cartCount: cart.status === 'fulfilled' ? count(cart.value?.item_count) : 0,
      unreadCount: unread.status === 'fulfilled' ? count(unread.value?.unread_count) : 0,
    }
  }

  function load({ force = false } = {}) {
    if (!force && pending) return pending
    if (!force && settled) return Promise.resolve(state)
    const current = ++version
    publish({ compareCount: count(compareCount()) })
    pending = (async () => {
      let counts
      try {
        counts = await fetchCounts()
      } catch {
        counts = { cartCount: 0, unreadCount: 0 }
      }
      if (current !== version) return pending || state
      settled = true
      pending = null
      publish(counts)
      return state
    })()
    return pending
  }

  function dismissToast() {
    if (toastTimer !== null) clearTimer(toastTimer)
    toastTimer = null
    if (state.toast !== null) publish({ toast: null })
  }

  function showToast(message) {
    const text = String(message ?? '').trim()
    if (!text) return
    if (toastTimer !== null) clearTimer(toastTimer)
    const id = ++toastId
    publish({ toast: { id, text } })
    toastTimer = setTimer(() => {
      if (state.toast?.id !== id) return
      toastTimer = null
      publish({ toast: null })
    }, TOAST_MS)
  }

  return {
    get state() { return state },
    load,
    refresh: () => load({ force: true }),
    setCartCount: (value) => publish({ cartCount: count(value) }),
    setUnreadCount: (value) => publish({ unreadCount: count(value) }),
    setCompareCount: (value) => publish({ compareCount: count(value) }),
    showToast,
    dismissToast,
    subscribe(listener) {
      listeners.add(listener)
      try {
        listener(state)
      } catch { /* 위와 같다 */ }
      return () => listeners.delete(listener)
    },
    reset() {
      version += 1
      pending = null
      settled = false
      if (toastTimer !== null) clearTimer(toastTimer)
      toastTimer = null
      state = initialState()
    },
  }
}

export const siteStatus = createSiteStatus()
