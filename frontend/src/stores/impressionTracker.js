// 상품 목록 카드의 노출(product_impression)·클릭(product_click) 이벤트(spec docs/specs/2026-11-01-event-enrichment.md).
// - 노출: 카드의 50% 이상이 화면에 보이면 1회. 같은 목록 결과(list_view_id) 안에서 상품마다 한 번만 센다(머문 시간 조건은 없다)
// - 1초 동안 모아 한 번에 보낸다(이벤트 하나에 20개까지, 넘으면 나눈다). 페이지를 떠날 때(onExit)와 목록이 바뀔 때도 남은 것을 보낸다
// - 위치(position)는 1부터, 쪽을 넘어도 이어지는 순위 = (page-1) × 쪽 크기 + 칸 순서
// - 목록 결과를 새로 받을 때마다(start) 새 list_view_id 를 만든다. 화면은 이 id 를 product_list_view 에도 넣어 목록·노출·클릭을 잇는다
// - IntersectionObserver 가 없는 브라우저(또는 테스트)에서는 노출을 보내지 않는다(추측하지 않는다). 클릭은 그대로 남긴다
// - list(목록 이름)를 받으므로 다른 목록(추천 칸 등)도 같은 모듈을 쓴다
// - start() 에 목록 조건 밖의 값(상품 상세 추천 칸의 source_product_id·model_version, spec docs/specs/2026-11-03-product-recommendations.md
//   "이벤트", schema_version 5)을 넘기면 그 목록 결과의 노출·클릭에 함께 싣는다. 기본 키(list·list_view_id·위치 등)는 덮어쓰지 못한다
// 브라우저 객체(IntersectionObserver·타이머)는 인자로 바꿔 넣을 수 있다(테스트는 가짜 관찰자·타이머를 넘긴다).
import { MAX_PROP_LIST_LENGTH, createUuid } from './tracking.js'

export const IMPRESSION_THRESHOLD = 0.5
export const IMPRESSION_BATCH_MS = 1000
// 추적기가 정하는 키. start() 의 추가 값으로 바꿀 수 없다
const BASE_KEYS = new Set(['list', 'list_view_id', 'product_ids', 'positions', 'product_id', 'position', 'page', 'sort', 'category', 'search'])

/** start() 의 추가 값 중 노출·클릭에 실을 것(기본 키·undefined 는 뺀다). null 은 "없음"이라는 값이라 남긴다. */
function extraProps(values) {
  const extra = {}
  for (const [key, value] of Object.entries(values || {})) {
    if (!BASE_KEYS.has(key) && value !== undefined) extra[key] = value
  }
  return extra
}

/** 목록 안 순위(1부터, 쪽을 넘어도 이어진다): (page-1) × pageSize + index + 1. */
export function listPosition(page, index, pageSize) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1
  return (safePage - 1) * pageSize + index + 1
}

/** 브라우저의 IntersectionObserver 로 관찰자를 만든다. 없거나 만들 수 없으면 null(노출을 보내지 않는다). */
export function browserObserver(callback, options) {
  const Observer = globalThis.IntersectionObserver
  if (typeof Observer !== 'function') return null
  try {
    return new Observer(callback, options)
  } catch {
    return null
  }
}

/**
 * 목록 하나의 노출·클릭 추적기를 만든다.
 * - list: 목록 이름(상품 목록은 'catalog')
 * - track: 이벤트 함수(src/stores/tracking.js 의 track)
 * - onExit: 페이지를 떠나기 전 할 일 등록(src/stores/tracking.js 의 onExit). 남은 노출을 keepalive 에 싣는다
 * - pageSize: 쪽 크기(위치 계산)
 * - createObserver(callback, { threshold }): 관찰자 { observe, unobserve, disconnect } 또는 null
 * - schedule·cancel: 1초 묶음 타이머, uuid: list_view_id 만들기
 * 어떤 함수도 던지지 않는다(추적은 화면에 영향을 주지 않는다).
 */
export function createImpressionTracker({
  list,
  track = () => {},
  onExit = null,
  pageSize = MAX_PROP_LIST_LENGTH,
  createObserver = browserObserver,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  uuid = createUuid,
  delay = IMPRESSION_BATCH_MS,
  threshold = IMPRESSION_THRESHOLD,
} = {}) {
  // 지금 목록 결과: { id(list_view_id), page, sort, category, search, extra(start 의 추가 값) }
  let context = null
  // 이 목록 결과에서 이미 센 상품 id
  const seen = new Set()
  // 관찰 중인 카드: 요소 → { productId, index, contextId }, 상품 id → 요소
  const targets = new Map()
  const elementsByProduct = new Map()
  // 보낼 노출: { context, productId, position }
  let pending = []
  let timer = null
  let observer = null
  try {
    observer = createObserver?.(handleEntries, { threshold }) || null
  } catch {
    observer = null
  }
  let stopExit = () => {}
  try {
    stopExit = onExit?.(() => flush()) || (() => {})
  } catch { /* 떠날 때 보내기만 못 한다 */ }

  function handleEntries(entries) {
    try {
      for (const entry of entries || []) {
        if (!entry?.isIntersecting || !(entry.intersectionRatio >= threshold)) continue
        const target = targets.get(entry.target)
        if (!target || !context || target.contextId !== context.id || seen.has(target.productId)) continue
        seen.add(target.productId)
        pending.push({ context, productId: target.productId, position: listPosition(context.page, target.index, pageSize) })
      }
      if (pending.length) startTimer()
    } catch { /* 노출 하나를 못 세도 화면에는 영향이 없다 */ }
  }

  function startTimer() {
    if (timer != null) return
    try {
      timer = schedule(() => {
        timer = null
        flush()
      }, delay)
    } catch {
      timer = null
    }
  }

  function stopTimer() {
    if (timer == null) return
    try {
      cancel(timer)
    } catch { /* 이미 끝난 타이머 */ }
    timer = null
  }

  function reobserve(element) {
    try {
      observer?.unobserve(element)
      observer?.observe(element)
    } catch { /* 관찰하지 못하면 그 카드의 노출만 빠진다 */ }
  }

  /** 모아 둔 노출을 지금 보낸다(목록 결과마다 나누고, 이벤트 하나에 20개까지). */
  function flush() {
    stopTimer()
    if (!pending.length) return
    const items = pending
    pending = []
    try {
      const groups = new Map()
      for (const item of items) {
        if (!groups.has(item.context)) groups.set(item.context, [])
        groups.get(item.context).push(item)
      }
      for (const [view, group] of groups) {
        for (let start = 0; start < group.length; start += MAX_PROP_LIST_LENGTH) {
          const chunk = group.slice(start, start + MAX_PROP_LIST_LENGTH)
          track('product_impression', {
            list,
            list_view_id: view.id,
            product_ids: chunk.map((item) => item.productId),
            positions: chunk.map((item) => item.position),
            page: view.page,
            sort: view.sort,
            category: view.category,
            search: view.search,
            ...view.extra,
          })
        }
      }
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /**
   * 목록 결과를 새로 받았을 때 부른다: 이전 결과의 남은 노출을 보내고, 새 list_view_id 로 다시 센다.
   * page·sort·category·search 는 이번 요청 조건(빈 조건은 null). 그 밖의 값(추천 칸의 source_product_id·model_version)은
   * 이 목록 결과의 노출·클릭 props 에 그대로 싣는다. 새 list_view_id 를 돌려준다.
   */
  function start({ page = 1, sort = null, category = null, search = null, ...extra } = {}) {
    flush()
    let id = null
    try {
      id = uuid()
    } catch {
      id = `list-${Date.now()}`
    }
    context = { id, page, sort: sort || null, category: category || null, search: search || null, extra: extraProps(extra) }
    seen.clear()
    // 그대로 남아 있는 카드(같은 상품 요소를 다시 쓰는 경우)도 새 결과로 다시 잰다
    for (const [element, target] of targets) {
      targets.set(element, { ...target, contextId: id })
      reobserve(element)
    }
    return id
  }

  /**
   * 카드 요소를 관찰한다(ProductGrid 의 observeItem). element 가 null 이면(카드가 사라짐) 그 상품의 관찰을 멈춘다.
   * 같은 요소·같은 칸·같은 목록 결과면 다시 관찰하지 않는다.
   */
  function observe(element, product, index) {
    try {
      const productId = product?.id
      if (productId == null) return
      if (!element) {
        const previous = elementsByProduct.get(productId)
        if (previous) {
          try { observer?.unobserve(previous) } catch { /* 이미 해제됨 */ }
          targets.delete(previous)
          elementsByProduct.delete(productId)
        }
        return
      }
      if (!observer) return
      const contextId = context?.id ?? null
      const current = targets.get(element)
      if (current && current.productId === productId && current.index === index && current.contextId === contextId) return
      const previous = elementsByProduct.get(productId)
      if (previous && previous !== element) {
        try { observer.unobserve(previous) } catch { /* 이미 해제됨 */ }
        targets.delete(previous)
      }
      if (current && current.productId !== productId) elementsByProduct.delete(current.productId)
      targets.set(element, { productId, index, contextId })
      elementsByProduct.set(productId, element)
      reobserve(element)
    } catch { /* 관찰하지 못하면 그 카드의 노출만 빠진다 */ }
  }

  /**
   * 카드를 눌렀을 때(이동 직전): 모아 둔 노출을 먼저 보내고 product_click(list_view_id·position 은 노출과 같다).
   * 누른 카드는 본 것이므로, 아직 노출로 세지 않았으면(누르면서 화면 안으로 스크롤돼 관찰자가 알리기 전 등) 노출로도 센다.
   * 노출이 없는 클릭이 생기지 않게 하기 위해서다. IntersectionObserver 가 없으면(노출을 재지 않는 브라우저) 세지 않는다.
   * start() 의 추가 값(source_product_id·model_version 등)도 함께 싣는다.
   */
  function click(product, index) {
    try {
      if (product?.id == null) return
      const position = listPosition(context?.page, index, pageSize)
      if (observer && context && !seen.has(product.id)) {
        seen.add(product.id)
        pending.push({ context, productId: product.id, position })
      }
      flush()
      track('product_click', {
        list,
        list_view_id: context?.id ?? null,
        product_id: product.id,
        position,
        ...context?.extra,
      })
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /** 화면을 떠날 때: 남은 노출을 보내고 관찰을 멈춘다. */
  function stop() {
    flush()
    try { observer?.disconnect() } catch { /* 이미 해제됨 */ }
    try { stopExit() } catch { /* 이미 해제됨 */ }
    targets.clear()
    elementsByProduct.clear()
  }

  return { start, observe, click, flush, stop, listViewId: () => context?.id ?? null, supported: () => Boolean(observer) }
}
