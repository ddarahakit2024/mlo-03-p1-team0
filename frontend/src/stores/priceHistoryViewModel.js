// 상품 상세의 가격 추이 영역: 기간(1주·1달·3달·1년), 날마다의 MOA Parts 판매가, 선 그래프(SVG) 좌표·마우스/키보드 위치,
// 그래프의 텍스트 대안, 판매처별 표(표로 보기), 날짜 표시.
// Vue·axios 를 import 하지 않는다. 가격은 서버 값(PriceHistory, price_trend)을 그대로 쓰고, 여기서는 표시용 좌표와 글자만 만든다.
import { formatPrice } from './productViewModel.js'
import { changeTone, formatChangePct } from './priceTrendViewModel.js'

// GET /products/{id}/price-history 의 기본 기간(api 기본값). 상세 화면은 기간 탭의 days 를 보낸다
export const PRICE_HISTORY_DAYS = 90
// 기간 탭. days 는 API 의 days(7~365)
export const PRICE_PERIODS = [
  { code: 'week', label: '1주', days: 7 },
  { code: 'month', label: '1달', days: 30 },
  { code: 'quarter', label: '3달', days: 90 },
  { code: 'year', label: '1년', days: 365 },
]
export const DEFAULT_PRICE_PERIOD = 'month'
// 판매처 코드(spec 정책) → 이름과 표의 선 모양. 순서대로 표에 나온다.
export const PRICE_SOURCES = [
  { code: 'store', name: 'MOA Parts', tone: 'store' },
  { code: 'coupang', name: '쿠팡', tone: 'coupang' },
  { code: 'naver', name: '네이버', tone: 'naver' },
]
// 그래프 viewBox 와 여백(왼쪽은 y 축 글자 자리, 아래는 x 축 글자 자리)
export const TREND_CHART_SIZE = { width: 640, height: 240, left: 56, right: 12, top: 16, bottom: 36 }

const SOURCE_CODES = PRICE_SOURCES.map((item) => item.code)
const DAY_MS = 24 * 60 * 60 * 1000
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** 지금 시각(ms). 화면 테스트는 compileSfc deps 로 바꿔 넣는다. */
export function currentTime() {
  return Date.now()
}

/** 기간 코드 → { code, label, days }. 모르는 코드는 기본(1달). */
export function pricePeriod(code) {
  return PRICE_PERIODS.find((item) => item.code === code) || PRICE_PERIODS.find((item) => item.code === DEFAULT_PRICE_PERIOD)
}

/** 판매처 코드 → 이름. 모르는 코드는 코드 그대로(없으면 '기타 판매처'). */
export function priceSourceName(source) {
  return PRICE_SOURCES.find((item) => item.code === source)?.name || source || '기타 판매처'
}

function sourceTone(source) {
  return PRICE_SOURCES.find((item) => item.code === source)?.tone || 'other'
}

function sourceOrder(source) {
  const index = SOURCE_CODES.indexOf(source)
  return index < 0 ? SOURCE_CODES.length : index
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function toTime(value) {
  if (typeof value === 'number') return value
  if (!value) return NaN
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
}

/** 서버의 UTC 시각을 한국 날짜로: '2026년 10월 30일'. 틀린 값은 ''. */
export function formatPriceDate(value) {
  const time = toTime(value)
  if (Number.isNaN(time)) return ''
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(time))
}

/** 시각(UTC ISO 문자열·ms) → 서울 날짜 'YYYY-MM-DD'. 틀리면 ''. */
export function seoulDate(value) {
  const time = toTime(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + SEOUL_OFFSET_MS).toISOString().slice(0, 10)
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD'(툴팁). */
export function formatChartDate(date) {
  return DATE_ONLY.test(date || '') ? date.replaceAll('-', '.') : ''
}

/** x 축 글자: 긴 기간(90일 넘게)은 'YY.MM', 짧으면 'MM.DD'. */
function axisDate(date, long) {
  const [year, month, day] = date.split('-')
  return long ? `${year.slice(2)}.${month}` : `${month}.${day}`
}

/** y 축 글자: 388400 → '38.8만', 1000000 이상은 정수 '120만'. */
export function formatAxisPrice(value) {
  const amount = Number(value) || 0
  return `${(amount / 10000).toFixed(amount >= 1000000 ? 0 : 1)}만`
}

/**
 * 기간(days 일, 오늘로 끝남)의 날마다 MOA Parts 판매가: [{ date: 'YYYY-MM-DD', price }] (오래된 순).
 * 판매가는 바뀔 때마다 store 이력이 남으므로(app.core.pricing.change_store_price)
 * - 그날(서울)까지의 마지막 store 기록 가격이 그날 가격이다(기간 앞의 기록도 이어 쓴다)
 * - 기간 안에 store 기록이 하나도 없으면 기간 내내 지금 판매가(price)다
 * - 기간 안 첫 기록 전 날은 서버의 최근 30일 추세(price_trend.sparkline_30d, 오늘로 끝남)로 채우고, 그것도 없으면 뺀다
 * - 출시일(releasedOn, 'YYYY-MM-DD') 전 날은 뺀다. 마지막 날(오늘)은 지금 판매가
 * 오늘 = 서울 기준 now 와 받은 기록 중 가장 늦은 날 중 늦은 쪽(가상 시계로 서버가 앞서 있어도 맞게).
 */
export function dailyStorePrices(history, { days = 30, price = null, sparkline = [], releasedOn = '', now = currentTime() } = {}) {
  const items = (Array.isArray(history?.items) ? history.items : [])
    .map((item) => ({ time: toTime(item?.recorded_at), price: Number(item?.price_krw), source: item?.source }))
    .filter((item) => Number.isFinite(item.time) && finite(item.price))
  const dates = [seoulDate(now), ...items.map((item) => seoulDate(item.time))].filter(Boolean).sort()
  const today = dates[dates.length - 1]
  const count = Math.max(1, Math.floor(Number(days) || 1))
  if (!today) return []
  const store = items.filter((item) => item.source === 'store').sort((a, b) => a.time - b.time).map((item) => ({ date: seoulDate(item.time), price: item.price }))
  const current = finite(price) ? Number(price) : null
  const trend = (Array.isArray(sparkline) ? sparkline : []).filter(finite).map(Number)
  const released = DATE_ONLY.test(releasedOn || '') ? releasedOn : ''
  const start = addDays(today, -(count - 1))
  const points = []
  let cursor = 0
  let last = null
  for (let offset = 0; offset < count; offset += 1) {
    const date = addDays(start, offset)
    while (cursor < store.length && store[cursor].date <= date) {
      last = store[cursor].price
      cursor += 1
    }
    let value = last
    if (value === null) {
      if (!store.length) value = current
      else {
        const index = trend.length - 1 - daysBetween(date, today)
        value = index >= 0 ? trend[index] : null
      }
    }
    if (offset === count - 1 && current !== null) value = current
    if (value === null || (released && date < released)) continue
    points.push({ date, price: value })
  }
  return points
}

const round = (value) => Math.round(value * 10) / 10
const fixed = (value) => value.toFixed(1)
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/**
 * 가격 추이 선 그래프 좌표(디자인 시안 chartFor 와 같은 계산). points = dailyStorePrices 결과.
 * - y 범위: 가격과 1년 최저가(lowest, 점선) 모두 들어가게 하고 위아래 15% 여백(모두 같으면 2%)
 * - 가로선 4개(아래→위, 'N만' 글자), x 축 날짜 4개(처음·1/3·2/3·끝), 마지막 점
 * - hoverIndex 가 있으면 그 날의 세로선·점·툴팁(left 는 % 로 12~88 사이)
 * - stats: 처음·마지막·최저·최고·평균(반올림)과 기간 변동률(%, 소수 1자리)
 * 값이 없으면 null.
 */
export function priceTrendChart(points = [], { lowest = null, hoverIndex = null, size = TREND_CHART_SIZE } = {}) {
  const values = (points || []).map((point) => Number(point?.price)).filter(Number.isFinite)
  if (!values.length || values.length !== points.length) return null
  const { width, height, left, right, top, bottom } = size
  const count = values.length
  const low = finite(lowest) ? Number(lowest) : null
  const min = Math.min(...values)
  const max = Math.max(...values)
  let floor = low === null ? min : Math.min(min, low)
  let ceiling = low === null ? max : Math.max(max, low)
  const pad = (ceiling - floor) * 0.15 || floor * 0.02 || 1
  floor -= pad
  ceiling += pad
  const base = height - bottom
  const plot = width - left - right
  const x = (index) => (count > 1 ? left + (plot * index) / (count - 1) : width - right)
  const y = (value) => top + (base - top) * (1 - (value - floor) / (ceiling - floor))
  const line = count > 1
    ? values.map((value, index) => `${index ? 'L' : 'M'}${fixed(x(index))} ${fixed(y(value))}`).join(' ')
    : `M${fixed(left)} ${fixed(y(values[0]))} L${fixed(width - right)} ${fixed(y(values[0]))}`
  // 선 아래 채우기: 선을 따라간 뒤 오른쪽 아래 → 왼쪽 아래로 닫는다(x(0) = left, x(마지막) = width - right)
  const area = `${line} L${fixed(width - right)} ${base} L${fixed(left)} ${base} Z`
  const grid = [0, 1 / 3, 2 / 3, 1].map((fraction) => {
    const value = floor + (ceiling - floor) * fraction
    return { y: round(y(value)), labelY: round(y(value) + 4), label: formatAxisPrice(value) }
  })
  const long = count > 90
  const indexes = [...new Set([0, 1 / 3, 2 / 3, 1].map((fraction) => Math.round((count - 1) * fraction)))]
  const xLabels = indexes.map((index, order) => ({
    x: round(x(index)),
    label: axisDate(points[index].date, long),
    anchor: order === 0 && indexes.length > 1 ? 'start' : order === indexes.length - 1 ? 'end' : 'middle',
  }))
  const hovered = Number.isInteger(hoverIndex) ? clamp(hoverIndex, 0, count - 1) : null
  const first = values[0]
  const lastValue = values[count - 1]
  const changePct = first ? Math.round(((lastValue - first) / first) * 1000) / 10 : null
  return {
    width, height, left, right, top, base, count, line, area, grid, xLabels,
    lowY: low === null ? null : round(y(low)),
    last: { x: round(x(count - 1)), y: round(y(lastValue)) },
    hover: hovered === null ? null : {
      index: hovered,
      x: round(x(hovered)),
      y: round(y(values[hovered])),
      left: round(clamp((x(hovered) / width) * 100, 12, 88)),
      date: formatChartDate(points[hovered].date),
      price: values[hovered],
    },
    stats: {
      first, last: lastValue, min, max,
      average: Math.round(values.reduce((sum, value) => sum + value, 0) / count),
      changePct,
      tone: changeTone(changePct),
    },
  }
}

/** 그래프 위 가로 위치(0~1, 요소 폭 기준) → 가장 가까운 날의 순서(0~count-1). 그래프가 없으면 null. */
export function chartIndexAt(chart, ratio) {
  if (!chart || !Number.isFinite(ratio)) return null
  if (chart.count < 2) return 0
  const position = ratio * chart.width
  const index = Math.round(((position - chart.left) / (chart.width - chart.left - chart.right)) * (chart.count - 1))
  return clamp(index, 0, chart.count - 1)
}

/**
 * 키보드로 고른 날 옮기기. ←·→ 하루씩(처음 누르면 마지막 날), Home 처음, End 마지막, Escape 는 null(선택 해제).
 * 다루지 않는 키는 undefined.
 */
export function stepChartIndex(current, key, count) {
  if (!count) return undefined
  const last = count - 1
  const selected = Number.isInteger(current) ? clamp(current, 0, last) : null
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'Escape') return null
  if (key === 'ArrowLeft') return selected === null ? last : Math.max(0, selected - 1)
  if (key === 'ArrowRight') return selected === null ? last : Math.min(last, selected + 1)
  return undefined
}

/** 그래프의 텍스트 대안(aria-label): 기간·처음과 마지막 가격·변동률·최저·최고·평균·1년 최저가. */
export function priceTrendChartLabel(chart, points = [], { periodLabel = '', lowest = null } = {}) {
  if (!chart || !points.length) return '가격 기록이 없습니다.'
  const { stats } = chart
  const head = `${periodLabel ? `최근 ${periodLabel} ` : ''}MOA Parts 판매가 그래프`
  const range = `${formatChartDate(points[0].date)} ${formatPrice(stats.first)}에서 ${formatChartDate(points[points.length - 1].date)} ${formatPrice(stats.last)}(${formatChangePct(stats.changePct)})`
  const summary = `최저 ${formatPrice(stats.min)}, 최고 ${formatPrice(stats.max)}, 평균 ${formatPrice(stats.average)}`
  const low = finite(lowest) ? ` 점선은 1년 최저가 ${formatPrice(lowest)}.` : ''
  return `${head}. ${range}. ${summary}.${low}`
}

/** 이력 항목을 판매처별로 나눈다(각 판매처 안은 오래된 순). 판매처 순서: MOA Parts, 쿠팡, 네이버, 그 밖(코드 이름순). */
function groupBySource(items = []) {
  const groups = new Map()
  for (const item of items || []) {
    const time = toTime(item?.recorded_at)
    if (Number.isNaN(time) || !Number.isFinite(Number(item?.price_krw))) continue
    if (!groups.has(item.source)) groups.set(item.source, [])
    groups.get(item.source).push({ price: Number(item.price_krw), time, recordedAt: item.recorded_at })
  }
  return [...groups.entries()]
    .map(([source, points]) => ({ source, points: points.sort((a, b) => a.time - b.time) }))
    .sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || String(a.source).localeCompare(String(b.source)))
}

/**
 * 판매처별 표의 행: [{ source, name, tone, latest, lowest, highest, latestAt, count }] (받은 기간 안).
 * latest 는 그 판매처의 마지막 기록 가격(MOA Parts 는 현재 판매가와 같다).
 */
export function priceHistoryRows(items = []) {
  return groupBySource(items).map(({ source, points }) => {
    const prices = points.map((point) => point.price)
    const last = points[points.length - 1]
    return {
      source, name: priceSourceName(source), tone: sourceTone(source),
      latest: last.price, lowest: Math.min(...prices), highest: Math.max(...prices), latestAt: last.recordedAt, count: points.length,
    }
  })
}
