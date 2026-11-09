// 가격 추세 표시(src/stores/priceTrendViewModel.js): 변동률 글자·톤, 1년 최저가 문구, 지금 살 때 판단, 타몰 비교 문구, 배지, 추세선 좌표.
import { buyVerdict, changeArrow, changeTone, formatChangePct, lowestLine, priceBadge, sparklineLabel, sparklinePath, storeLine, storeName } from './stores/priceTrendViewModel.js'

const trend = (patch = {}) => ({
  change_30d_pct: -5.2, lowest_1y_krw: 388400, lowest_1y_on: '2026-11-05', highest_1y_krw: 455000, average_30d_krw: 392000,
  is_lowest_1y: false, lowest_gap_pct: 4.1, sparkline_30d: [400000, 388400], external_lowest: { source: 'coupang', price_krw: 392000 },
  store_is_lowest: true, store_gap_krw: 3600, ...patch,
})

test.each([
  [-5.24, '-5.2%'], [1.25, '+1.3%'], [0, '0.0%'], [-0.04, '0.0%'], [null, '—'], [undefined, '—'], ['', '—'], [12, '+12.0%'],
])('formatChangePct(%p) → %p', (pct, expected) => {
  expect(formatChangePct(pct)).toBe(expected)
})

test.each([
  [-5, 'down', '▼'], [-0.5, 'down', '▼'], [-0.49, 'flat', ''], [0.49, 'flat', ''], [0.5, 'up', '▲'], [null, 'flat', ''],
])('changeTone(%p) → %p, 방향 글자 %p', (pct, tone, arrow) => {
  expect(changeTone(pct)).toBe(tone)
  expect(changeArrow(pct)).toBe(arrow)
})

test.each([
  [trend({ is_lowest_1y: true, lowest_gap_pct: 0 }), { text: '지금이 1년 중 최저가', tone: 'good' }],
  [trend({ lowest_gap_pct: 2.9 }), { text: '1년 최저가 대비 +2.9%', tone: 'near' }],
  [trend({ lowest_gap_pct: 3 }), { text: '1년 최저가 대비 +3.0%', tone: 'neutral' }],
  [trend({ lowest_1y_krw: null, lowest_gap_pct: null }), null],
  [null, null],
])('lowestLine %#', (value, expected) => {
  expect(lowestLine(value)).toEqual(expected)
})

test.each([
  [trend({ is_lowest_1y: true }), '지금 사도 좋아요', 'good'],
  [trend({ lowest_gap_pct: 1 }), '최저가에 가까워요', 'near'],
  [trend({ lowest_gap_pct: 8, change_30d_pct: 2 }), '오르는 중, 알림 추천', 'neutral'],
  [trend({ lowest_gap_pct: 8, change_30d_pct: -2 }), '조금 더 기다려도 돼요', 'neutral'],
])('buyVerdict %#: %p', (value, text, tone) => {
  expect(buyVerdict(value)).toEqual({ text, tone })
})

test('buyVerdict 는 이력이 없으면 null', () => {
  expect(buyVerdict(trend({ lowest_1y_krw: null }))).toBeNull()
})

test.each([
  [trend(), { text: '타몰 최저가보다 3,600원 저렴', tone: 'good' }],
  [trend({ store_gap_krw: 0 }), { text: '타몰 최저가와 같은 가격', tone: 'good' }],
  [trend({ store_is_lowest: false, store_gap_krw: 3400 }), { text: '쿠팡에서 3,400원 더 저렴', tone: 'warn' }],
  [trend({ store_is_lowest: false, external_lowest: { source: 'naver', price_krw: 1 }, store_gap_krw: 10 }), { text: '네이버에서 10원 더 저렴', tone: 'warn' }],
  [trend({ external_lowest: null, store_gap_krw: null }), null],
])('storeLine %#', (value, expected) => {
  expect(storeLine(value)).toEqual(expected)
})

test.each([
  [{ price_trend: trend({ is_lowest_1y: true }), is_new: true }, { label: '1년 최저', kind: 'low' }],
  [{ price_trend: trend({ change_30d_pct: -4 }) }, { label: '가격 하락', kind: 'drop' }],
  [{ price_trend: trend({ change_30d_pct: -3.9 }), is_new: true }, { label: 'NEW', kind: 'new' }],
  [{ price_trend: trend({ change_30d_pct: 1 }) }, null],
  [{}, null],
])('priceBadge %#', (product, expected) => {
  expect(priceBadge(product)).toEqual(expected)
})

test.each([
  [[], ''],
  [[100], 'M2.0 16.0 L98.0 16.0'],
  [[100, 100, 100], 'M2.0 16.0 L50.0 16.0 L98.0 16.0'],
  [[200, 100], 'M2.0 2.0 L98.0 30.0'],
  [[100, null, 200], 'M2.0 30.0 L98.0 2.0'],
])('sparklinePath(%p) → %p', (values, expected) => {
  expect(sparklinePath(values)).toBe(expected)
})

test('sparklinePath 는 크기와 여백을 받는다', () => {
  expect(sparklinePath([1, 2], { width: 10, height: 10, pad: 0 })).toBe('M0.0 10.0 L10.0 0.0')
})

test.each([
  [[395200, 388400], -1.7, '최근 30일 가격 추이: 395,200원에서 388,400원(-1.7%)'],
  [[1000], null, '최근 30일 가격 추이: 1,000원에서 1,000원'],
  [[], 2, ''],
])('sparklineLabel %#', (values, pct, expected) => {
  expect(sparklineLabel(values, pct)).toBe(expected)
})

test.each([['store', 'MOA Parts'], ['coupang', '쿠팡'], ['naver', '네이버'], ['gmarket', 'gmarket'], [null, '다른 쇼핑몰']])('storeName(%p) → %p', (source, expected) => {
  expect(storeName(source)).toBe(expected)
})
