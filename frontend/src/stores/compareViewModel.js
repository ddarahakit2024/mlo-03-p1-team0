// 비교함(spec docs/specs/2026-11-01-event-enrichment.md "정한 것"·"화면")과 비교 화면 표 계산.
// - 저장: 브라우저 localStorage 'moa.compare' = { category, items: [{ id, name, category, thumbnail_url }] }. 가격은 저장하지 않는다
//   (비교 화면이 서버에서 새로 받는다). 깨진 값은 빈 비교함으로 보고, localStorage 를 쓸 수 없으면 비교함 기능을 숨긴다
// - 규칙: 최대 4개, 같은 카테고리만. 다른 카테고리는 안내 + "비교함 비우고 담기", 4개가 차면 담지 않고 안내
// - 이벤트: compare_add·compare_remove·compare_clear(이 모듈의 비교함이 남긴다), compare_view(비교 화면이 남긴다)
// Vue·axios 를 import 하지 않는다. 저장소·track 은 인자로 받는다(테스트는 가짜 저장소를 넘긴다).
import { MAX_PROP_LIST_LENGTH } from './tracking.js'
import { changeArrow, changeTone, formatChangePct, lowestLine, storeLine } from './priceTrendViewModel.js'
import { formatPrice, formatReleaseDate, formatScore, formatValueScore, ratingSummary } from './productViewModel.js'

export const COMPARE_STORAGE_KEY = 'moa.compare'
export const MAX_COMPARE_ITEMS = 4
export const COMPARE_PATH = '/compare'

export const COMPARE_MESSAGES = {
  full: `비교함에는 ${MAX_COMPARE_ITEMS}개까지 담을 수 있습니다. 다른 상품을 빼고 담아 주세요.`,
  category: '비교함에는 같은 카테고리 상품만 담을 수 있습니다. 비교함을 비우고 이 상품을 담을까요?',
  empty: '비교할 부품이 없어요. 상품 카드의 + 비교 버튼으로 담아 보세요.',
  single: '비교하려면 상품을 하나 더 담아 주세요.',
  loading: '비교할 상품 정보를 불러오는 중입니다...',
  error: '비교할 상품 정보를 불러오지 못했습니다. 다시 시도해 주세요.',
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0
}

/** 빈 비교함. */
export function emptyCompare() {
  return { category: null, items: [] }
}

/** 상품(목록·상세 응답) → 비교함에 저장할 모양. 가격은 넣지 않는다. */
export function compareItem(product) {
  return {
    id: product.id,
    name: typeof product.name === 'string' ? product.name : '',
    category: typeof product.category === 'string' ? product.category : '',
    thumbnail_url: typeof product.thumbnail_url === 'string' ? product.thumbnail_url : '',
  }
}

/**
 * 저장된 글자 → 비교함. JSON 이 아니거나 모양이 틀리면 빈 비교함. 항목은 id 가 양의 정수인 것만,
 * 같은 id 는 한 번, 비교함 카테고리와 다른 항목은 빼고, 4개까지.
 */
export function parseCompare(text) {
  let value = null
  try {
    value = JSON.parse(text)
  } catch {
    return emptyCompare()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.items)) return emptyCompare()
  const items = []
  const ids = new Set()
  for (const raw of value.items) {
    if (!raw || typeof raw !== 'object' || !positiveId(raw.id) || ids.has(raw.id)) continue
    const item = compareItem(raw)
    if (!item.category) continue
    ids.add(item.id)
    items.push(item)
  }
  const category = typeof value.category === 'string' && value.category ? value.category : items[0]?.category || null
  const same = items.filter((item) => item.category === category).slice(0, MAX_COMPARE_ITEMS)
  return same.length ? { category, items: same } : emptyCompare()
}

/**
 * 브라우저 localStorage 를 감싼다: { available, get(), set(text) }. 접근만 해도 던지는 브라우저(사생활 보호 모드)·
 * 저장소가 없는 환경이면 available 이 false 이고 비교함 기능을 숨긴다. 어떤 함수도 던지지 않는다.
 */
export function browserCompareStorage(area = () => globalThis.window?.localStorage) {
  let storage = null
  try {
    storage = typeof area === 'function' ? area() : area
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') storage = null
    else storage.getItem(COMPARE_STORAGE_KEY)
  } catch {
    storage = null
  }
  return {
    available: Boolean(storage),
    get() {
      try {
        return storage?.getItem(COMPARE_STORAGE_KEY) ?? null
      } catch {
        return null
      }
    },
    set(text) {
      try {
        storage?.setItem(COMPARE_STORAGE_KEY, text)
        return true
      } catch {
        return false
      }
    },
  }
}

/** 비교 화면 주소의 ?ids=3,5 (공유 링크) → 상품 id 목록(양의 정수, 중복 제거, 4개까지). ids 가 없거나 맞는 값이 없으면 null. */
export function readCompareQuery(search = '') {
  const value = new URLSearchParams(search || '').get('ids')
  if (value == null) return null
  const ids = []
  for (const part of value.split(',')) {
    const id = /^\d+$/.test(part.trim()) ? Number(part.trim()) : null
    if (positiveId(id) && !ids.includes(id)) ids.push(id)
  }
  return ids.length ? ids.slice(0, MAX_COMPARE_ITEMS) : null
}

/** 비교함 상태: 담겼는지, 담을 수 있는지(담으면 'add', 이미 있음 'exists', 꽉 참 'full', 다른 카테고리 'category'). */
export function compareStatus(state, product) {
  if (!product || !positiveId(product.id)) return 'invalid'
  if (state.items.some((item) => item.id === product.id)) return 'exists'
  if (state.items.length && state.category && product.category !== state.category) return 'category'
  if (state.items.length >= MAX_COMPARE_ITEMS) return 'full'
  return 'add'
}

/**
 * 비교함 하나를 만든다. 담기·빼기·비우기 규칙과 저장, compare_add·compare_remove·compare_clear 이벤트를 맡는다.
 * - storage: browserCompareStorage() 모양({ available, get, set })
 * - track: 이벤트 함수, onChange({ state, notice }): 바뀔 때마다(화면이 ref 에 넣는다)
 * notice: { kind: 'full' | 'category', text, product(category 일 때 비우고 담을 상품), source } 또는 null
 */
export function createCompareBox({ storage = browserCompareStorage(), track = () => {}, onChange = () => {} } = {}) {
  const available = Boolean(storage?.available)
  let state = available ? parseCompare(storage.get()) : emptyCompare()
  let notice = null

  function save() {
    if (!available) return
    storage.set(JSON.stringify(state))
  }

  function changed() {
    try {
      onChange({ state, notice })
    } catch { /* 화면 갱신 실패는 비교함 상태에 영향을 주지 않는다 */ }
  }

  function setState(next) {
    state = next
    save()
  }

  function emit(type, props) {
    try {
      track(type, props)
    } catch { /* 추적 실패는 화면에 알리지 않는다 */ }
  }

  /** 담기. source: catalog | detail. 결과 'added' | 'exists' | 'full' | 'category' | 'unavailable'. */
  function add(product, source) {
    if (!available) return 'unavailable'
    const status = compareStatus(state, product)
    if (status === 'invalid') return 'unavailable'
    if (status === 'exists') return 'exists'
    if (status === 'full' || status === 'category') {
      notice = { kind: status, text: COMPARE_MESSAGES[status], product: status === 'category' ? product : null, source }
      changed()
      return status
    }
    const item = compareItem(product)
    setState({ category: state.items.length ? state.category : item.category, items: [...state.items, item] })
    notice = null
    emit('compare_add', { product_id: item.id, category: item.category, count: state.items.length, source })
    changed()
    return 'added'
  }

  /** 빼기. source: catalog | detail | compare | bar, reason: user | unavailable(판매하지 않는 상품). */
  function remove(productId, { source, reason = 'user' } = {}) {
    const item = state.items.find((entry) => entry.id === productId)
    if (!item) return false
    const items = state.items.filter((entry) => entry.id !== productId)
    setState(items.length ? { category: state.category, items } : emptyCompare())
    notice = null
    emit('compare_remove', { product_id: item.id, category: item.category, count: items.length, source, reason })
    changed()
    return true
  }

  /** 담겨 있으면 빼고, 아니면 담는다(상품 카드의 비교 토글). */
  function toggle(product, source) {
    if (state.items.some((item) => item.id === product?.id)) return remove(product.id, { source }) ? 'removed' : 'unavailable'
    return add(product, source)
  }

  /** 비우기. reason: user | category_change(다른 카테고리를 담으려고). */
  function clear(reason = 'user') {
    if (!state.items.length) return false
    const previous = state
    setState(emptyCompare())
    notice = null
    emit('compare_clear', { category: previous.category, product_ids: previous.items.slice(0, MAX_PROP_LIST_LENGTH).map((item) => item.id), reason })
    changed()
    return true
  }

  /** "비교함 비우고 담기": 다른 카테고리 안내의 상품으로 비교함을 바꾼다(compare_clear category_change → compare_add). */
  function replace() {
    if (notice?.kind !== 'category' || !notice.product) return false
    const { product, source } = notice
    clear('category_change')
    add(product, source)
    return true
  }

  function dismiss() {
    if (!notice) return
    notice = null
    changed()
  }

  /**
   * 비교 화면이 서버에서 받은 상품으로 비교함 항목(이름·사진·카테고리)을 새로 맞춘다. 이벤트는 남기지 않는다.
   * products 의 순서대로, 첫 상품의 카테고리와 같은 것만, 4개까지(공유 링크로 연 비교함도 이것으로 채운다).
   */
  function refresh(products) {
    if (!available) return
    const items = []
    for (const product of products || []) {
      if (!product || !positiveId(product.id) || items.some((item) => item.id === product.id)) continue
      items.push(compareItem(product))
    }
    const category = items[0]?.category || null
    const same = items.filter((item) => item.category === category).slice(0, MAX_COMPARE_ITEMS)
    setState(same.length ? { category, items: same } : emptyCompare())
    changed()
  }

  return {
    available,
    add, remove, toggle, clear, replace, dismiss, refresh,
    state: () => state,
    notice: () => notice,
    has: (productId) => state.items.some((item) => item.id === productId),
  }
}

// ---------------------------------------------------------------- 비교 화면 표

/** 비교 화면 상태: 'empty' | 'loading' | 'error' | 'ready'. */
export function getComparePageState({ loading = false, error = '', products = [] } = {}) {
  if (loading) return 'loading'
  if (error) return 'error'
  return products.length ? 'ready' : 'empty'
}

/** 404 로 뺀 상품 안내. 없으면 ''. */
export function removedNotice(count) {
  return count > 0 ? `판매하지 않는 상품 ${count.toLocaleString('ko-KR')}개를 비교함에서 뺐습니다.` : ''
}

function numeric(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
}

/**
 * 값 목록에서 배지를 붙일 칸(true/false 목록). best: 'min' | 'max'. 숫자 값이 2개 이상이고 모두 같지 않을 때만
 * 가장 낮은(높은) 값의 칸에 붙인다(같은 값이 여럿이면 모두).
 */
export function bestCells(values, best) {
  const numbers = values.map(numeric)
  const present = numbers.filter((value) => value != null)
  if (present.length < 2) return numbers.map(() => false)
  const target = best === 'min' ? Math.min(...present) : Math.max(...present)
  if (present.every((value) => value === target)) return numbers.map(() => false)
  return numbers.map((value) => value === target)
}

/** 상품들의 specs 라벨 합집합(처음 나온 순서). */
export function specLabels(products = []) {
  const labels = []
  for (const product of products) {
    for (const spec of Array.isArray(product?.specs) ? product.specs : []) {
      const label = typeof spec?.label === 'string' ? spec.label.trim() : ''
      if (label && !labels.includes(label)) labels.push(label)
    }
  }
  return labels
}

// 비교 표 칸: { text, badge, tone, missing, sub?, note?, values?, changePct? }
// - tone: 'good'(초록: 가장 저렴·내림·1년 최저·MOA 최저) | 'bad'(빨강: 오름) | 'warn'(노랑: 최저가 근접·타몰이 더 쌈) | ''(기본)
//   색만으로 구분하지 않도록 글자(가장 저렴·▼▲·문구)를 함께 둔다
// - missing: 값이 없는 칸("—", 흐린 글자)
// - sub: 아래 작은 줄(1년 최저가 금액), note: 옆 작은 글자(리뷰 수), values·changePct: 30일 추세선(PriceSparkline props)
export const COMPARE_MISSING = '—'
export const COMPARE_BADGES = { cheapest: '가장 저렴', best: '최고' }

const LOWEST_TONES = { good: 'good', near: 'warn', neutral: '' }
const STORE_TONES = { good: 'good', warn: 'warn' }
const CHANGE_TONES = { down: 'good', up: 'bad', flat: '' }

function cell(text, extra = {}) {
  return { text, badge: '', tone: '', missing: false, ...extra }
}

function missingCell() {
  return cell(COMPARE_MISSING, { missing: true })
}

function specValue(product, label) {
  const spec = (Array.isArray(product?.specs) ? product.specs : []).find((item) => typeof item?.label === 'string' && item.label.trim() === label)
  const value = spec?.value == null ? '' : String(spec.value).trim()
  return value ? cell(value) : missingCell()
}

function priceCell(product, cheapest) {
  if (numeric(product?.price_krw) == null) return missingCell()
  return cell(formatPrice(product.price_krw), cheapest ? { badge: COMPARE_BADGES.cheapest, tone: 'good' } : {})
}

/** 30일 추이: 추세선(값 2개 이상일 때) + '▼ -5.2%'. 변동률이 없으면 "—". */
export function trendCell(product) {
  const trend = product?.price_trend
  const values = (Array.isArray(trend?.sparkline_30d) ? trend.sparkline_30d : []).filter((value) => numeric(value) != null)
  const pct = numeric(trend?.change_30d_pct)
  const line = values.length > 1 ? { values, changePct: pct } : {}
  if (pct == null) return { ...missingCell(), ...line }
  const arrow = changeArrow(pct)
  return cell(`${arrow ? `${arrow} ` : ''}${formatChangePct(pct)}`, { tone: CHANGE_TONES[changeTone(pct)], ...line })
}

/** 1년 최저 대비: '지금이 1년 중 최저가' / '1년 최저가 대비 +N%' + 아래 줄 '최저 N원'. 이력이 없으면 "—". */
export function lowestCell(product) {
  const trend = product?.price_trend
  const line = lowestLine(trend)
  if (!line) return missingCell()
  return cell(line.text, { tone: LOWEST_TONES[line.tone] ?? '', sub: `최저 ${formatPrice(trend.lowest_1y_krw)}` })
}

/** 타몰 비교: '타몰 최저가보다 N원 저렴'(good) / '쿠팡에서 N원 더 저렴'(warn). 타몰 가격이 없으면 "—". */
export function storeCell(product) {
  const line = storeLine(product?.price_trend)
  return line ? cell(line.text, { tone: STORE_TONES[line.tone] ?? '' }) : missingCell()
}

function ratingCell(product) {
  const summary = ratingSummary(product?.rating_average ?? null, product?.review_count || 0)
  return summary ? cell(`★ ${summary.average}`, { note: `리뷰 ${summary.count.toLocaleString('ko-KR')}개` }) : missingCell()
}

function scoreCell(value, format, best) {
  if (numeric(value) == null) return missingCell()
  return cell(format(value), best ? { badge: COMPARE_BADGES.best } : {})
}

/**
 * 비교 표의 행: [{ key, label, cells }]. 열은 products 순서, 칸 모양은 위 주석.
 * 행 = 가격(가장 저렴), 30일 추이, 1년 최저 대비, 타몰 비교, 평점, 성능 점수(최고), 가성비 지수(최고), 출시일, specs 라벨 합집합.
 * 브랜드는 열 머리(브랜드 · 카테고리)에 있다. 배지는 값이 2개 이상이고 모두 같지 않을 때만 글자로 붙인다.
 * 값은 서버 응답을 그대로 보여 준다(price_trend 의 숫자도 서버 값).
 */
export function compareRows(products = []) {
  const list = Array.isArray(products) ? products : []
  const cheapest = bestCells(list.map((product) => product?.price_krw), 'min')
  const strongest = bestCells(list.map((product) => product?.performance_score), 'max')
  const bestValue = bestCells(list.map((product) => product?.value_score), 'max')
  const row = (key, label, cells) => ({ key, label, cells })
  return [
    row('price', '가격', list.map((product, index) => priceCell(product, cheapest[index]))),
    row('trend', '30일 추이', list.map(trendCell)),
    row('lowest', '1년 최저 대비', list.map(lowestCell)),
    row('store', '타몰 비교', list.map(storeCell)),
    row('rating', '평점', list.map(ratingCell)),
    row('performance', '성능 점수', list.map((product, index) => scoreCell(product?.performance_score, formatScore, strongest[index]))),
    row('value', '가성비 지수', list.map((product, index) => scoreCell(product?.value_score, formatValueScore, bestValue[index]))),
    row('released', '출시일', list.map((product) => {
      const date = formatReleaseDate(product?.released_on)
      return date ? cell(date) : missingCell()
    })),
    ...specLabels(list).map((label, index) => row(`spec-${index}`, label, list.map((product) => specValue(product, label)))),
  ]
}

/** compare_view props: 카테고리, 상품 id(20개까지), 개수. */
export function compareViewProps(products = []) {
  return {
    category: products[0]?.category || null,
    product_ids: products.slice(0, MAX_PROP_LIST_LENGTH).map((product) => product.id),
    count: products.length,
  }
}
