// 상품 상세 체류 시간(product_dwell) 이벤트(spec docs/specs/2026-11-01-event-enrichment.md "정한 것").
// - 탭이 보이는 동안만 잰다. 탭이 숨겨질 때(reason hidden)와 페이지를 떠날 때(reason leave) 그때까지의 구간을 보낸다
// - 상세를 열 때마다 새 view_id 하나. 구간들의 합이 그 상세 보기의 체류 시간이다
// - 한 구간은 30분(세션 기준)에서 자르고, 1초 미만 구간은 보내지 않는다
// - 숨김·떠남은 추적기의 onExit 로 받는다: 체류 이벤트가 추적기의 keepalive 전송보다 먼저 큐에 들어간다
// - 다시 보이면(visibilitychange → visible) 새 구간을 시작한다
// 브라우저 객체(document)·시계는 인자로 바꿔 넣을 수 있다(테스트는 가짜 시계·visibility 를 넘긴다).
import { SESSION_TIMEOUT_MS, createUuid } from './tracking.js'

export const MIN_DWELL_MS = 1000
export const MAX_DWELL_MS = SESSION_TIMEOUT_MS

/** 구간 길이(ms) → 보낼 dwell_ms(정수, 30분에서 자름). 1초 미만이면 null(보내지 않음). */
export function dwellSegment(elapsed, { min = MIN_DWELL_MS, max = MAX_DWELL_MS } = {}) {
  if (!Number.isFinite(elapsed) || elapsed < min) return null
  return Math.round(Math.min(elapsed, max))
}

/**
 * 상세 보기 하나의 체류 시간 추적기를 만든다. 만들면 바로 재기 시작한다(탭이 숨겨져 있으면 보일 때부터).
 * - productId, track, onExit(callback(reason) → 해제 함수): 추적기의 track·onExit
 * - now: 시계(ms), doc: visibilityState·visibilitychange 를 가진 document(없으면 늘 보이는 것으로 본다), uuid: view_id
 * stop(): 화면을 떠날 때(지금 구간을 leave 로 보내고 해제). 어떤 함수도 던지지 않는다.
 */
export function createDwellTracker({
  productId,
  track = () => {},
  onExit = null,
  now = () => Date.now(),
  doc = globalThis.document,
  uuid = createUuid,
  min = MIN_DWELL_MS,
  max = MAX_DWELL_MS,
} = {}) {
  let viewId = null
  try {
    viewId = uuid()
  } catch {
    viewId = `view-${Date.now()}`
  }
  let startedAt = null
  let stopped = false

  function visible() {
    return doc?.visibilityState !== 'hidden'
  }

  function clock() {
    try {
      const value = now()
      return Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  function begin() {
    if (stopped || startedAt != null || !visible()) return
    startedAt = clock()
  }

  /** 지금 구간을 끝내고 1초 이상이면 보낸다. reason: 'hidden' | 'leave'. */
  function end(reason) {
    if (startedAt == null) return
    const finished = clock()
    const elapsed = finished == null ? NaN : finished - startedAt
    startedAt = null
    const dwell = dwellSegment(elapsed, { min, max })
    if (dwell == null) return
    try {
      track('product_dwell', { product_id: productId, view_id: viewId, dwell_ms: dwell, reason })
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  const onVisibility = () => {
    if (visible()) begin()
  }
  let stopExit = () => {}
  try {
    stopExit = onExit?.((reason) => end(reason === 'hidden' ? 'hidden' : 'leave')) || (() => {})
  } catch { /* 숨김·떠남을 받지 못하면 화면을 떠날 때(stop)만 보낸다 */ }
  try {
    doc?.addEventListener?.('visibilitychange', onVisibility)
  } catch { /* 다시 보일 때 이어 재지 못한다 */ }
  begin()

  function stop() {
    if (stopped) return
    end('leave')
    stopped = true
    try { stopExit() } catch { /* 이미 해제됨 */ }
    try { doc?.removeEventListener?.('visibilitychange', onVisibility) } catch { /* 이미 해제됨 */ }
  }

  return { stop, viewId: () => viewId }
}
