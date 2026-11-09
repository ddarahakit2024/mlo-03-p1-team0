// 상품 가격 추세(ProductSummary.price_trend) 표시: 변동률 글자, 색 톤, 1년 최저가 문구, 지금 살 때 판단, 타몰 비교 문구, 배지, 추세선 좌표.
// Vue·axios 를 import 하지 않는다. 숫자는 서버 값(price_trend)을 그대로 쓰고 여기서는 글자·톤·좌표만 만든다.
import { formatPrice } from './productViewModel.js'

// 이 범위 안의 변동은 "변동 없음"(flat)으로 본다(퍼센트)
export const FLAT_CHANGE_PCT = 0.5
// 30일 변동이 이 값 이하면 "가격 하락" 배지(퍼센트)
export const DROP_BADGE_PCT = -4
// 1년 최저가와의 차이가 이 값 미만이면 "최저가에 가까워요"(퍼센트)
export const NEAR_LOW_PCT = 3

export const STORE_NAMES = { store: 'MOA Parts', coupang: '쿠팡', naver: '네이버' }

/** 판매처 코드 → 이름. 모르는 코드는 코드 그대로, 없으면 '다른 쇼핑몰'. */
export function storeName(source) {
  return STORE_NAMES[source] || source || '다른 쇼핑몰'
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/** -5.2 → '-5.2%', 1.25 → '+1.3%', 0 → '0.0%'. 값이 없으면 '—'. */
export function formatChangePct(pct) {
  if (!finite(pct)) return '—'
  const value = Math.round(Number(pct) * 10) / 10
  if (Object.is(value, -0) || value === 0) return '0.0%'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

/** 변동 방향: down(내려감, 좋음) · up(오름) · flat(±0.5% 안 또는 값 없음). 화면은 이 값으로 색과 글자(▲▼)를 함께 정한다. */
export function changeTone(pct) {
  if (!finite(pct)) return 'flat'
  const value = Number(pct)
  if (value <= -FLAT_CHANGE_PCT) return 'down'
  if (value >= FLAT_CHANGE_PCT) return 'up'
  return 'flat'
}

/** 색만으로 구분하지 않도록 붙이는 방향 글자: ▼ 내림, ▲ 오름, 없으면 ''. */
export function changeArrow(pct) {
  const tone = changeTone(pct)
  return tone === 'down' ? '▼' : tone === 'up' ? '▲' : ''
}

/**
 * 1년 최저가 문구와 톤: { text, tone(good·near·neutral) }.
 * 지금이 최저(is_lowest_1y) → '지금이 1년 중 최저가'(good), 아니면 '1년 최저가 대비 +N%'(차이 3% 미만이면 near).
 * 이력이 없으면 null.
 */
export function lowestLine(trend) {
  if (!trend || !finite(trend.lowest_1y_krw)) return null
  if (trend.is_lowest_1y) return { text: '지금이 1년 중 최저가', tone: 'good' }
  const gap = finite(trend.lowest_gap_pct) ? Number(trend.lowest_gap_pct) : null
  if (gap === null) return null
  return { text: `1년 최저가 대비 ${formatChangePct(gap)}`, tone: gap < NEAR_LOW_PCT ? 'near' : 'neutral' }
}

/** "지금 살 때?" 판단 문구와 톤. 이력이 없으면 null. */
export function buyVerdict(trend) {
  const line = lowestLine(trend)
  if (!line) return null
  if (line.tone === 'good') return { text: '지금 사도 좋아요', tone: 'good' }
  if (line.tone === 'near') return { text: '최저가에 가까워요', tone: 'near' }
  if (changeTone(trend.change_30d_pct) === 'up') return { text: '오르는 중, 알림 추천', tone: 'neutral' }
  return { text: '조금 더 기다려도 돼요', tone: 'neutral' }
}

/**
 * 타몰 비교 문구와 톤: MOA 가 최저면 '타몰 최저가보다 N원 저렴'(good, 같으면 '타몰 최저가와 같은 가격'),
 * 아니면 '쿠팡에서 N원 더 저렴'(warn). 외부 가격이 없으면 null.
 */
export function storeLine(trend) {
  const external = trend?.external_lowest
  if (!external || !finite(external.price_krw)) return null
  const gap = finite(trend.store_gap_krw) ? Number(trend.store_gap_krw) : 0
  if (trend.store_is_lowest) {
    return gap > 0 ? { text: `타몰 최저가보다 ${formatPrice(gap)} 저렴`, tone: 'good' } : { text: '타몰 최저가와 같은 가격', tone: 'good' }
  }
  return { text: `${storeName(external.source)}에서 ${formatPrice(gap)} 더 저렴`, tone: 'warn' }
}

/** 카드 배지: 1년 최저(low) > 가격 하락(drop, 30일 -4% 이하) > NEW(new, is_new). 없으면 null. */
export function priceBadge(product) {
  const trend = product?.price_trend
  if (trend?.is_lowest_1y && finite(trend.lowest_1y_krw)) return { label: '1년 최저', kind: 'low' }
  if (finite(trend?.change_30d_pct) && Number(trend.change_30d_pct) <= DROP_BADGE_PCT) return { label: '가격 하락', kind: 'drop' }
  if (product?.is_new) return { label: 'NEW', kind: 'new' }
  return null
}

/**
 * 추세선(SVG path d). viewBox 0 0 width height 안에 pad 만큼 띄워 그린다. 값이 1개면 가운데 가로선, 없으면 ''.
 * 모두 같은 값이면 가운데 가로선.
 */
export function sparklinePath(values = [], { width = 100, height = 32, pad = 2 } = {}) {
  const points = (values || []).filter(finite).map(Number)
  if (!points.length) return ''
  if (points.length === 1) points.push(points[0])
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min
  const innerWidth = width - pad * 2
  const innerHeight = height - pad * 2
  return points.map((value, index) => {
    const x = pad + (innerWidth * index) / (points.length - 1)
    const y = span === 0 ? height / 2 : pad + innerHeight * (1 - (value - min) / span)
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

/** 추세선의 텍스트 대안: '최근 30일 가격 추이: 395,200원에서 388,400원(-1.7%)'. 값이 없으면 ''. */
export function sparklineLabel(values = [], changePct = null) {
  const points = (values || []).filter(finite).map(Number)
  if (!points.length) return ''
  const change = finite(changePct) ? `(${formatChangePct(changePct)})` : ''
  return `최근 30일 가격 추이: ${formatPrice(points[0])}에서 ${formatPrice(points[points.length - 1])}${change}`
}
