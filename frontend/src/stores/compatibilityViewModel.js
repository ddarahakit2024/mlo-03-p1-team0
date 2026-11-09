// 부품 호환성(spec docs/specs/2026-11-01-compatibility-rules.md) 화면 계산.
// 언제 확인할지, 상태 문구, 수준 배지, 균형 막대 좌표, 전력 문구, 같은 구성 판단, compatibility_check 이벤트 props.
// Vue·axios 를 import 하지 않는다. 판단(문제·균형·전력)은 서버(POST /compatibility/check)가 하고 여기서는 보여 줄 모양만 만든다.

// API 계약: 1~30줄, 수량 1~10, 같은 상품 두 줄 금지
export const MAX_COMPATIBILITY_LINES = 30
export const MAX_COMPATIBILITY_QUANTITY = 10
// 견적 보내기에서 부품을 바꿀 때 모아서 확인하는 시간(spec 화면 "0.4초 모아서")
export const COMPATIBILITY_DEBOUNCE_MS = 400
// 이벤트 props 의 목록 길이(추적기 MAX_PROP_LIST_LENGTH 와 같다. 테스트가 같은지 확인한다)
export const MAX_EVENT_LIST_LENGTH = 20

// spec 화면 상태표의 문구
export const COMPATIBILITY_TEXT = {
  title: '부품 호환성',
  loading: '부품 호환성을 확인하는 중입니다...',
  ok: '함께 쓸 수 있는 부품입니다.',
  fail: '호환성을 확인하지 못했습니다. 다시 시도해 주세요.',
}

// 문제 수준 배지(색만으로 구분하지 않게 글자를 함께 쓴다)
export const ISSUE_LEVEL_LABELS = { error: '호환 안 됨', warning: '주의', info: '안내' }

// 균형 라벨(서버 balance.label → 화면 문구)
export const BALANCE_LABELS = { balanced: '균형 좋음', cpu_bound: 'CPU 가 약함', gpu_bound: '그래픽카드가 약함' }
// 균형 막대: -2(왼쪽, 그래픽카드가 약함) ~ 0(균형) ~ 2(오른쪽, CPU 가 약함). SVG viewBox 단위
export const BALANCE_MIN = -2
export const BALANCE_MAX = 2
export const BALANCE_BAR = { width: 300, height: 24, padding: 10 }

/** 요청 본문의 줄: 장바구니 줄·견적 부품 줄·고른 부품 줄에서 product_id·quantity 만. */
export function compatibilityItems(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({ product_id: line?.product_id, quantity: line?.quantity }))
}

/** 서버로 보내기 전 검사(API 계약과 같은 규칙). 문제가 없으면 ''. */
export function validateCompatibilityItems(items) {
  if (!Array.isArray(items) || !items.length) return '호환성을 확인할 부품을 골라 주세요.'
  if (items.length > MAX_COMPATIBILITY_LINES) return `호환성은 부품 ${MAX_COMPATIBILITY_LINES}줄까지 확인할 수 있습니다.`
  const seen = new Set()
  for (const item of items) {
    if (!Number.isSafeInteger(item?.product_id) || item.product_id < 1) return '상품 정보가 올바르지 않습니다. 부품을 다시 골라 주세요.'
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_COMPATIBILITY_QUANTITY) return `수량은 1~${MAX_COMPATIBILITY_QUANTITY}개로 골라 주세요.`
    if (seen.has(item.product_id)) return '같은 상품이 두 줄 있습니다. 한 줄로 합쳐 주세요.'
    seen.add(item.product_id)
  }
  return ''
}

/** 줄에 들어 있는 카테고리 수(카테고리가 비어 있는 줄은 세지 않는다). */
export function compatibilityCategoryCount(lines = []) {
  return new Set((Array.isArray(lines) ? lines : []).map((line) => line?.category).filter(Boolean)).size
}

/**
 * 확인할지(= 영역을 보여 줄지). 카테고리가 2개 이상이고 API 계약 안의 줄일 때만.
 * 카테고리가 1개뿐이면 영역을 보여 주지 않는다(spec 상태표 "부품 1개").
 */
export function shouldCheckCompatibility(lines = []) {
  return compatibilityCategoryCount(lines) >= 2 && !validateCompatibilityItems(compatibilityItems(lines))
}

/** 같은 부품 구성인지 판단하는 키(순서는 무시, 수량은 포함). 같은 구성은 이벤트를 한 번만 남긴다. */
export function compatibilityKey(lines = []) {
  return compatibilityItems(lines)
    .map((item) => [Number(item.product_id), Number(item.quantity)])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
    .map(([productId, quantity]) => `${productId}x${quantity}`)
    .join(',')
}

function issuesOf(result) {
  return Array.isArray(result?.issues) ? result.issues : []
}

/** 수준별 문제 수. */
export function countIssues(result, level) {
  return issuesOf(result).filter((issue) => issue?.level === level).length
}

/**
 * 영역 상태 문구. state: 'loading' | 'ready' | 'error'.
 * ready 는 서버 status 로: ok → 문제 없음, warning → "주의할 점 N개"(주의 수준 문제 수), error → "함께 쓸 수 없는 부품이 있습니다(N개)"(호환 안 됨 수준 문제 수).
 */
export function compatibilityStatusText(state, result) {
  if (state === 'loading') return COMPATIBILITY_TEXT.loading
  if (state === 'error') return COMPATIBILITY_TEXT.fail
  if (state !== 'ready') return ''
  if (result?.status === 'error') return `함께 쓸 수 없는 부품이 있습니다(${countIssues(result, 'error')}개)`
  if (result?.status === 'warning') return `주의할 점 ${countIssues(result, 'warning')}개`
  if (result?.status === 'ok') return COMPATIBILITY_TEXT.ok
  return ''
}

/** 상태 모양(CSS 클래스 이름에 쓴다): 'loading' | 'fail' | 'ok' | 'warning' | 'error' | ''. */
export function compatibilityTone(state, result) {
  if (state === 'loading') return 'loading'
  if (state === 'error') return 'fail'
  if (state !== 'ready') return ''
  return ['ok', 'warning', 'error'].includes(result?.status) ? result.status : ''
}

/** 문제 수준 배지 글자. 모르는 수준은 '안내'. */
export function issueLevelLabel(level) {
  return ISSUE_LEVEL_LABELS[level] || ISSUE_LEVEL_LABELS.info
}

/** 균형 라벨 문구. 모르는 라벨이면 ''. */
export function balanceLabelText(label) {
  return BALANCE_LABELS[label] || ''
}

function finiteScore(score) {
  if (score === null || score === undefined || score === '') return null
  const value = Number(score)
  return Number.isFinite(value) ? value : null
}

/** 균형 점수를 -2 ~ 2 로 자른다. 숫자가 아니면 null. */
export function clampBalance(score) {
  const value = finiteScore(score)
  return value === null ? null : Math.min(BALANCE_MAX, Math.max(BALANCE_MIN, value))
}

/** 균형 점수 → 막대의 x 좌표(viewBox 단위, 소수 둘째 자리). -2 → 왼쪽 끝(padding), 2 → 오른쪽 끝(width − padding). */
export function balanceX(score, bar = BALANCE_BAR) {
  const value = clampBalance(score)
  if (value === null) return null
  const usable = bar.width - bar.padding * 2
  return Math.round((bar.padding + ((value - BALANCE_MIN) / (BALANCE_MAX - BALANCE_MIN)) * usable) * 100) / 100
}

/** 균형 좋음 구간(-1 ~ 1)의 막대 위치. */
export function balanceZone(bar = BALANCE_BAR) {
  const start = balanceX(-1, bar)
  return { x: start, width: Math.round((balanceX(1, bar) - start) * 100) / 100 }
}

/** 균형 점수 표시(서버 값 그대로). */
export function formatBalanceScore(score) {
  const value = finiteScore(score)
  return value === null ? '' : String(value)
}

/** 균형 막대 SVG 의 텍스트 대안(aria-label). balance 가 없으면 ''. */
export function balanceAriaLabel(balance) {
  const value = finiteScore(balance?.score)
  if (value === null) return ''
  const label = balanceLabelText(balance.label) || '알 수 없음'
  return `CPU ↔ 그래픽카드 균형 점수 ${value}, ${label}. 막대는 왼쪽 끝 -2(그래픽카드가 약함)부터 가운데 0(균형 좋음), 오른쪽 끝 2(CPU 가 약함)까지입니다.`
}

function watts(value) {
  return `${Number(value).toLocaleString('ko-KR')}W`
}

/** "예상 소비 전력 520W / 파워 850W". 파워가 없으면 "파워 없음", 전력이 없으면 ''. */
export function powerText(power) {
  const estimated = finiteScore(power?.estimated_w)
  if (estimated === null) return ''
  const psu = finiteScore(power?.psu_w)
  return `예상 소비 전력 ${watts(estimated)} / ${psu === null ? '파워 없음' : `파워 ${watts(psu)}`}`
}

/**
 * compatibility_check 이벤트 props(spec 이벤트 표). 값은 서버 응답 그대로, 목록은 20개까지.
 * context: 'cart' | 'quote_compose', items: 확인한 줄({ product_id, quantity }), result: 서버 result.
 */
export function compatibilityEventProps(context, items, result) {
  const codes = (level) => issuesOf(result).filter((issue) => issue?.level === level).map((issue) => issue.code).slice(0, MAX_EVENT_LIST_LENGTH)
  return {
    context,
    status: result?.status ?? null,
    error_codes: codes('error'),
    warning_codes: codes('warning'),
    balance_score: finiteScore(result?.balance?.score),
    estimated_w: finiteScore(result?.power?.estimated_w),
    psu_w: finiteScore(result?.power?.psu_w),
    product_ids: compatibilityItems(items).map((item) => item.product_id).slice(0, MAX_EVENT_LIST_LENGTH),
  }
}
