// 사용자 행동 이벤트 추적(spec docs/specs/2026-10-30-event-logging.md).
// 화면은 track(type, props) 만 부른다. 이벤트는 큐에 쌓였다가 10개가 되거나 3초가 지나면 POST /events 로 묶어 보내고,
// 페이지를 떠날 때(pagehide, visibilitychange → hidden)는 keepalive 요청으로 남은 것을 보낸다.
//
// 정책
// - 개인정보(이름·이메일·전화·주소·리뷰·질문·답변 본문)를 props 에 넣지 않는다. 그런 이름의 키는 여기서도 버린다
// - 추적이 실패해도 화면에는 영향이 없다: 어떤 함수도 예외를 던지지 않고, 사용자에게 보이지 않는다
// - 네트워크 오류·5xx 로 실패한 묶음은 다음 전송 때 한 번만 다시 보내고 그래도 실패하면 버린다(서버가 event_id 로 중복을 무시한다).
//   422·413·403 처럼 다시 보내도 같은 결과인 실패는 바로 버린다
// - anonymous_id 는 localStorage(브라우저마다 고정), session_id 는 sessionStorage(탭마다, 30분 동안 이벤트가 없으면 새로)
// - 실제 전송은 빌드 모드가 production·development 일 때만 한다. Jest 처럼 import.meta.env 가 없으면 아무것도 하지 않는다
// - 이벤트마다 schema_version(2026-11-03 부터 5, spec docs/specs/2026-11-03-product-recommendations.md. 4 는 docs/specs/2026-11-01-returns-refunds.md,
//   3 은 docs/specs/2026-11-01-build-id-purpose.md, 2 는 docs/specs/2026-11-01-event-enrichment.md)을 싣는다
// - 페이지를 떠날 때는 보내기 전에 화면이 onExit 로 등록한 "떠나기 전 할 일"(체류 시간·남은 노출)을 먼저 부른다.
//   할 일이 track 한 이벤트가 같은 keepalive 전송에 실린다. 할 일이 던져도 전송은 한다
import { sendEvents, sendEventsOnExit } from '../api/eventApi.js'

export const EVENT_TYPES = [
  'page_view', 'product_list_view', 'search', 'filter_change', 'product_view', 'price_history_view', 'review_list_view',
  'add_to_cart', 'buy_now', 'cart_view', 'cart_update', 'cart_remove', 'checkout_view', 'payment_start', 'payment_result',
  'order_view', 'review_submit', 'question_view', 'answer_submit', 'login', 'signup', 'logout',
  // 2026-11-01 추가: 부품 호환성 결과를 보여 준 뒤(spec docs/specs/2026-11-01-compatibility-rules.md "이벤트")
  'compatibility_check',
  // 2026-11-01 추가(schema_version 2, spec docs/specs/2026-11-01-event-enrichment.md): 노출·클릭·체류, 비교함, 커뮤니티
  'product_impression', 'product_click', 'product_dwell',
  'compare_add', 'compare_remove', 'compare_clear', 'compare_view',
  'community_list_view', 'community_post_view', 'community_post_submit', 'community_comment_submit',
  // 2026-11-01 추가(schema_version 3, spec docs/specs/2026-11-01-build-id-purpose.md): 견적을 장바구니에 담음. signup 에 purpose 도 더했다
  'build_add_to_cart',
  // 2026-11-01 추가(schema_version 4, spec docs/specs/2026-11-01-returns-refunds.md): 반품 신청·철회에 성공했을 때
  'return_request', 'return_withdraw',
  // 2026-11-03(schema_version 5, spec docs/specs/2026-11-03-product-recommendations.md): 새 type 은 없다.
  // 상품 상세 추천 칸의 product_impression·product_click(list 'recommendation')에 source_product_id·model_version 이 더해졌다
]
// 이벤트 계약 버전. 서버는 1~5 를 받고 없으면 1 로 저장한다(2 = 노출·클릭·체류·비교함·커뮤니티, 3 = build_add_to_cart·signup purpose,
// 4 = return_request·return_withdraw, 5 = 추천 칸 노출·클릭의 source_product_id·model_version 이 있는 계약)
export const SCHEMA_VERSION = 5
export const BATCH_SIZE = 10
export const FLUSH_DELAY_MS = 3000
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000
export const MAX_ATTEMPTS = 2
// 서버 제한: 한 요청에 1~50개, 본문 64KB. keepalive 요청도 합쳐서 64KB 까지라 조금 작게 자른다
export const MAX_EVENTS_PER_REQUEST = 50
export const MAX_REQUEST_BYTES = 60 * 1024
export const MAX_QUEUE = 200
// 로그아웃 전에 큐를 비울 때 기다리는 최대 시간. 넘으면 기다리지 않고 로그아웃을 계속한다
export const LOGOUT_FLUSH_TIMEOUT_MS = 2000
export const ANONYMOUS_ID_KEY = 'moa.anonymous_id'
export const SESSION_KEY = 'moa.session'

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const PROP_KEY = /^[a-z][a-z0-9_]{0,39}$/
// 개인정보가 담길 수 있는 키(받는 분 이름, 이메일, 연락처, 주소, 본문 등)와 사용자를 가리키는 키(subject, user_id 등. 서버가 422 로 거절한다)는
// 화면이 실수로 넣어도 보내지 않는다. 사용자는 서버가 쿠키로 판단한 subject 로만 잇는다
const PERSONAL_KEY = /(^|_)(name|username|email|phone|tel|address\d*|recipient|content|body|title|memo|password|token|subject|sub|user|userid|member|account)(_|$)/
const SECRET_QUERY_KEYS = ['code', 'state', 'token', 'password']
const MAX_PROPS = 20
const MAX_TEXT = 200
// props 배열의 최대 길이. 화면도 product_ids 같은 목록을 이만큼 자른다
export const MAX_PROP_LIST_LENGTH = 20
const MAX_LIST = MAX_PROP_LIST_LENGTH
const MAX_PATH = 500
// 서버는 정수를 64비트 범위만 받는다
const INT64_LIMIT = 2 ** 63

/** 무작위 uuid. crypto.randomUUID 가 없으면 getRandomValues, 그것도 없으면 Math.random 으로 만든다. */
export function createUuid(crypto = globalThis.crypto) {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* 아래 대체 방법을 쓴다 */ }
  const bytes = new Uint8Array(16)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function isPersonalKey(key) {
  return PERSONAL_KEY.test(key)
}

function cleanValue(value) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Number.isInteger(value) && Math.abs(value) >= INT64_LIMIT ? null : value
  }
  // 서버(파이썬)는 글자 수를 코드 포인트로 센다. 이모지 같은 문자를 반으로 자르지 않게 코드 포인트로 자른다
  if (typeof value === 'string') return value.length > MAX_TEXT ? Array.from(value).slice(0, MAX_TEXT).join('') : value
  return undefined
}

/** 다시 보내면 성공할 수 있는 실패인지: 응답이 없음(네트워크·시간 초과) 또는 5xx. 422·413·403 등은 다시 보내지 않는다. */
export function isRetryableError(error) {
  const status = error?.response?.status
  return !Number.isInteger(status) || status >= 500
}

/**
 * props 를 서버 계약에 맞춘다: 키는 [a-z][a-z0-9_]{0,39} 이고 20개까지, 값은 문자열(200자)·숫자·불리언·null 또는 그런 값 20개까지의 배열.
 * 맞지 않는 키·값(객체, undefined, 개인정보 키)은 버린다. 한 이벤트 때문에 묶음 전체가 422 로 거절되지 않게 한다.
 */
export function cleanProps(props) {
  const clean = {}
  if (!props || typeof props !== 'object' || Array.isArray(props)) return clean
  for (const [key, value] of Object.entries(props)) {
    if (Object.keys(clean).length >= MAX_PROPS) break
    if (!PROP_KEY.test(key) || isPersonalKey(key)) continue
    const cleaned = Array.isArray(value)
      ? value.slice(0, MAX_LIST).map(cleanValue).filter((item) => item !== undefined)
      : cleanValue(value)
    if (cleaned !== undefined) clean[key] = cleaned
  }
  return clean
}

/** 주소의 query 중 비밀값(code·state·token·password)의 값을 지운다. 서버도 지우지만 처음부터 보내지 않는다. */
export function redactQuery(search = '') {
  const text = String(search || '').replace(/^\?/, '')
  if (!text) return ''
  const params = new URLSearchParams(text)
  if (![...params.keys()].some((key) => SECRET_QUERY_KEYS.includes(key.toLowerCase()))) return `?${text}`
  for (const key of [...new Set(params.keys())]) {
    if (SECRET_QUERY_KEYS.includes(key.toLowerCase())) params.set(key, '')
  }
  return `?${params.toString()}`
}

/** page.path: / 로 시작하는 경로 + query(비밀값 제거), 500자까지. */
export function eventPath(value = '/') {
  const text = String(value || '/').split('#')[0]
  const index = text.indexOf('?')
  const path = index < 0 ? text : text.slice(0, index)
  const search = index < 0 ? '' : redactQuery(text.slice(index))
  return `${path.startsWith('/') ? path : `/${path}`}${search}`.slice(0, MAX_PATH)
}

/** page.referrer: 이전 페이지 주소(비밀값 제거), 500자까지. 주소가 아니면 ''. */
export function eventReferrer(value = '') {
  if (!value) return ''
  try {
    const url = new URL(String(value))
    return `${url.origin}${url.pathname}${redactQuery(url.search)}`.slice(0, MAX_PATH)
  } catch {
    return ''
  }
}

/** 이벤트 목록을 한 요청 크기(50개, 60KB)로 나눈다. 혼자서도 너무 큰 이벤트는 버린다. */
export function chunkEvents(events, { maxCount = MAX_EVENTS_PER_REQUEST, maxBytes = MAX_REQUEST_BYTES } = {}) {
  const size = (items) => byteLength(JSON.stringify({ events: items }))
  const chunks = []
  let current = []
  for (const event of events) {
    if (size([event]) > maxBytes) continue
    if (current.length && (current.length >= maxCount || size([...current, event]) > maxBytes)) {
      chunks.push(current)
      current = []
    }
    current.push(event)
  }
  if (current.length) chunks.push(current)
  return chunks
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length
  } catch {
    return text.length * 3
  }
}

/**
 * localStorage·sessionStorage 를 감싼다. 저장소 접근이 막힌 브라우저(사생활 보호 모드, 쿠키 차단)에서도 던지지 않고
 * 이 페이지 동안만 메모리에 둔다. area 는 Storage 또는 Storage 를 돌려주는 함수(접근만으로 던지는 브라우저가 있다).
 */
export function safeStorage(area) {
  const memory = new Map()
  const real = () => {
    try {
      return typeof area === 'function' ? area() : area
    } catch {
      return null
    }
  }
  return {
    get(key) {
      if (memory.has(key)) return memory.get(key)
      try {
        return real()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set(key, value) {
      memory.set(key, value)
      try {
        real()?.setItem(key, value)
      } catch { /* 메모리 값만 쓴다 */ }
    },
  }
}

function browserPage() {
  const location = globalThis.window?.location
  return { path: `${location?.pathname || '/'}${location?.search || ''}`, referrer: globalThis.document?.referrer || '' }
}

/**
 * 추적기를 만든다. 테스트는 send·sendOnExit·storage·now·uuid·page·schedule 를 바꿔 넣는다.
 * - send(events): 묶음 전송(Promise). 실패하면 그 묶음은 다음 전송 때 한 번 더 보내고 버린다
 * - sendOnExit(events): 페이지를 떠날 때 전송(keepalive). 응답을 기다리지 않는다
 * - storage: { local, session } (Storage 또는 그것을 돌려주는 함수)
 * - enabled: false 면 track 이 아무것도 하지 않는다(테스트 환경)
 */
export function createTracker({
  send = async () => {},
  sendOnExit = () => {},
  storage = {},
  now = () => Date.now(),
  uuid = createUuid,
  page = browserPage,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  enabled = true,
  batchSize = BATCH_SIZE,
  flushDelay = FLUSH_DELAY_MS,
  sessionTimeout = SESSION_TIMEOUT_MS,
  delay = waitFor,
} = {}) {
  const local = safeStorage(storage.local)
  const session = safeStorage(storage.session)
  // 페이지를 떠나기 전 할 일(onExit). 등록한 순서대로 부른다
  const exitCallbacks = new Set()
  let queue = []
  const inflight = new Set()
  // 진행 중인 묶음 전송(flush). flushNow 가 이것까지 끝나기를 기다린다
  const running = new Set()
  let timer = null

  function anonymousId() {
    const saved = local.get(ANONYMOUS_ID_KEY)
    if (typeof saved === 'string' && ID_PATTERN.test(saved)) return saved
    const id = uuid()
    local.set(ANONYMOUS_ID_KEY, id)
    return id
  }

  // 마지막 이벤트 시각(last)에서 30분이 지났으면 새 세션을 만든다
  function sessionId(time) {
    let saved = null
    try {
      saved = JSON.parse(session.get(SESSION_KEY) || 'null')
    } catch { /* 깨진 값은 새로 만든다 */ }
    const alive = saved && typeof saved.id === 'string' && ID_PATTERN.test(saved.id)
      && Number.isFinite(saved.last) && time - saved.last <= sessionTimeout
    const id = alive ? saved.id : uuid()
    session.set(SESSION_KEY, JSON.stringify({ id, last: time }))
    return id
  }

  function currentPage() {
    const value = page() || {}
    return { path: eventPath(value.path), referrer: eventReferrer(value.referrer) }
  }

  function stopTimer() {
    if (timer == null) return
    try {
      cancel(timer)
    } catch { /* 이미 끝난 타이머 */ }
    timer = null
  }

  function startTimer() {
    if (timer != null) return
    try {
      timer = schedule(() => {
        timer = null
        flush()
      }, flushDelay)
    } catch {
      timer = null
    }
  }

  async function deliver(entries) {
    for (const chunk of chunkEntries(entries)) {
      inflight.add(chunk)
      try {
        await send(chunk.map((entry) => entry.event))
      } catch (error) {
        // 네트워크 오류·5xx 만 한 번 더 보낸다. 큐 앞에 돌려 놓아 다음 전송(3초 뒤, 10개, 페이지를 떠날 때)에 함께 간다
        if (!isRetryableError(error)) continue
        const retry = chunk.filter((entry) => entry.attempts + 1 < MAX_ATTEMPTS).map((entry) => ({ ...entry, attempts: entry.attempts + 1 }))
        if (retry.length) {
          queue = [...retry, ...queue]
          startTimer()
        }
      } finally {
        inflight.delete(chunk)
      }
    }
  }

  function chunkEntries(entries) {
    const byEvent = new Map(entries.map((entry) => [entry.event, entry]))
    return chunkEvents(entries.map((entry) => entry.event)).map((events) => events.map((event) => byEvent.get(event)))
  }

  /** 큐의 이벤트를 지금 보낸다. 끝나면 resolve 하고 절대 reject 하지 않는다. */
  async function sendQueue() {
    try {
      stopTimer()
      if (!queue.length) return
      const entries = queue
      queue = []
      await deliver(entries)
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /** 큐의 이벤트를 지금 보낸다. 끝나면 resolve 하고 절대 reject 하지 않는다. */
  function flush() {
    const job = sendQueue()
    running.add(job)
    job.then(() => running.delete(job))
    return job
  }

  /**
   * 지금 큐를 일반 전송(axios, 쿠키 포함)으로 보내고, 그 전송과 이미 진행 중인 전송이 끝날 때까지 기다린다(최대 timeout).
   * 로그아웃 직전에 쓴다: 쿠키가 지워지기 전에 도착해야 서버가 subject 를 기록한다. 실패·시간 초과여도 resolve 하고 절대 reject 하지 않는다.
   */
  async function flushNow({ timeout = LOGOUT_FLUSH_TIMEOUT_MS } = {}) {
    if (!enabled) return
    let expire = null
    try {
      flush()
      if (!running.size) return
      expire = delay(timeout)
      await Promise.race([Promise.allSettled([...running]), expire.promise])
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ } finally {
      try {
        expire?.cancel?.()
      } catch { /* 이미 끝난 타이머 */ }
    }
  }

  /**
   * 페이지를 떠나기 전 할 일을 등록한다(체류 시간 구간, 1초 묶음으로 기다리는 노출). callback(reason) 의 reason 은
   * 'hidden'(탭이 숨겨짐) 또는 'leave'(페이지를 떠남). 할 일이 track 한 이벤트는 그 뒤의 keepalive 전송에 함께 실린다.
   * 해제 함수를 돌려준다. 절대 던지지 않는다.
   */
  function onExit(callback) {
    if (typeof callback !== 'function') return () => {}
    exitCallbacks.add(callback)
    return () => { exitCallbacks.delete(callback) }
  }

  function runExitCallbacks(reason) {
    for (const callback of [...exitCallbacks]) {
      try {
        callback(reason)
      } catch { /* 할 일 하나가 실패해도 다른 할 일과 전송은 계속한다 */ }
    }
  }

  /**
   * 페이지를 떠날 때: 먼저 떠나기 전 할 일(onExit)을 부르고, 큐와 아직 응답을 받지 못한 묶음을 keepalive 로 보낸다
   * (중복은 서버가 event_id 로 무시한다). reason: 'hidden' | 'leave'.
   */
  function flushOnExit(reason = 'leave') {
    if (enabled) runExitCallbacks(reason)
    try {
      stopTimer()
      const entries = [...[...inflight].flat(), ...queue]
      queue = []
      inflight.clear()
      for (const chunk of chunkEntries(entries)) {
        try {
          const result = sendOnExit(chunk.map((entry) => entry.event))
          result?.catch?.(() => {})
        } catch { /* 떠나는 중에는 다시 시도하지 않는다 */ }
      }
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /** track(type, props): 이벤트 하나를 큐에 넣는다. 모르는 type 은 버린다. 절대 던지지 않는다. */
  function track(type, props = {}) {
    if (!enabled) return
    try {
      if (!EVENT_TYPES.includes(type)) return
      const time = now()
      const event = {
        event_id: uuid(),
        type,
        occurred_at: new Date(time).toISOString(),
        session_id: sessionId(time),
        anonymous_id: anonymousId(),
        page: currentPage(),
        props: cleanProps(props),
        schema_version: SCHEMA_VERSION,
      }
      queue.push({ event, attempts: 0 })
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
      if (queue.length >= batchSize) flush()
      else startTimer()
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /** pagehide·visibilitychange 에 페이지를 떠날 때 전송을 건다. 해제 함수를 돌려준다. */
  function listen(target = globalThis.window, doc = globalThis.document) {
    if (!enabled || typeof target?.addEventListener !== 'function') return () => {}
    const onPageHide = () => flushOnExit('leave')
    const onVisibility = () => {
      if (doc?.visibilityState === 'hidden') flushOnExit('hidden')
    }
    try {
      target.addEventListener('pagehide', onPageHide)
      doc?.addEventListener?.('visibilitychange', onVisibility)
    } catch { /* 이벤트를 걸 수 없으면 3초 묶음 전송만 한다 */ }
    return () => {
      try {
        target.removeEventListener('pagehide', onPageHide)
        doc?.removeEventListener?.('visibilitychange', onVisibility)
      } catch { /* 이미 해제됨 */ }
    }
  }

  return { track, flush, flushNow, flushOnExit, onExit, listen, pending: () => queue.length }
}

/** ms 뒤에 resolve 하는 { promise, cancel }. 테스트는 createTracker 의 delay 로 바꿔 넣는다. */
function waitFor(ms) {
  let id = null
  const promise = new Promise((done) => { id = setTimeout(done, ms) })
  return { promise, cancel: () => clearTimeout(id) }
}

// 앱 전체가 함께 쓰는 추적기. 실제 전송은 빌드 모드가 production·development 일 때만 한다.
const env = import.meta.env || {}
const tracker = createTracker({
  enabled: env.MODE === 'production' || env.MODE === 'development',
  send: (events) => sendEvents(events),
  sendOnExit: (events) => sendEventsOnExit(events),
  storage: { local: () => globalThis.window?.localStorage, session: () => globalThis.window?.sessionStorage },
})
tracker.listen()

/** 화면이 부르는 추적 함수. props 에 개인정보를 넣지 않는다. 값은 서버 응답의 것을 쓴다. */
export function track(type, props) {
  tracker.track(type, props)
}

/**
 * 페이지를 떠나기 전(탭 숨김·페이지 떠남) 할 일을 등록한다. callback(reason: 'hidden' | 'leave') 에서 track 한 이벤트는
 * 같은 keepalive 전송에 실린다. 해제 함수를 돌려준다. 테스트 환경(전송 꺼짐)에서는 부르지 않는다.
 */
export function onExit(callback) {
  return tracker.onExit(callback)
}

/** 로그아웃 직전: 쌓인 이벤트를 지금 보내고 끝날 때까지 기다린다(최대 2초, 실패해도 resolve). 테스트 환경에서는 바로 끝난다. */
export function flushEvents(options) {
  return tracker.flushNow(options)
}
