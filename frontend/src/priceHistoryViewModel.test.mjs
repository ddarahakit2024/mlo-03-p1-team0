// 가격 추이 view model(src/stores/priceHistoryViewModel.js): 기간, 날마다의 MOA Parts 판매가, 그래프 좌표(디자인 시안 chartFor), 포인터·키보드 위치,
// 텍스트 대안, 판매처별 표, 날짜 표시.
import {
  DEFAULT_PRICE_PERIOD, chartIndexAt, dailyStorePrices, formatAxisPrice, formatChartDate, formatPriceDate, priceHistoryRows, pricePeriod,
  priceSourceName, priceTrendChart, priceTrendChartLabel, seoulDate, stepChartIndex,
} from './stores/priceHistoryViewModel.js'

const day = (n) => `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`
const NOW = Date.parse('2026-10-05T03:00:00Z') // 서울 2026-10-05 12:00

test.each([
  ['store', 'MOA Parts'], ['coupang', '쿠팡'], ['naver', '네이버'], ['11st', '11st'], ['', '기타 판매처'], [undefined, '기타 판매처'],
])('판매처 %p → %p', (source, name) => expect(priceSourceName(source)).toBe(name))

test.each([
  ['2026-10-30T01:12:00Z', '2026년 10월 30일'],
  ['2026-10-29T16:00:00', '2026년 10월 30일'],
  ['', ''],
  ['not-a-date', ''],
])('기록 시각 %p → 한국 날짜 %p', (value, text) => expect(formatPriceDate(value)).toBe(text))

test.each([
  ['2026-10-03T16:00:00Z', '2026-10-04'],
  ['2026-10-03T14:59:59Z', '2026-10-03'],
  ['2026-10-03T15:00:00', '2026-10-04'],
  [Date.parse('2026-10-05T03:00:00Z'), '2026-10-05'],
  ['', ''],
  ['bad', ''],
])('서울 날짜 %p → %p', (value, date) => expect(seoulDate(value)).toBe(date))

test.each([
  ['week', '1주', 7], ['month', '1달', 30], ['quarter', '3달', 90], ['year', '1년', 365], ['bad', '1달', 30], [undefined, '1달', 30],
])('기간 %p → %s(%i일)', (code, label, days) => expect(pricePeriod(code)).toMatchObject({ label, days }))

test('기본 기간은 1달', () => expect(pricePeriod(DEFAULT_PRICE_PERIOD).days).toBe(30))

test.each([
  [388400, '38.8만'], [1250000, '125만'], [5000, '0.5만'], [0, '0.0만'],
])('y 축 글자 %p → %p', (value, label) => expect(formatAxisPrice(value)).toBe(label))

test.each([['2026-10-05', '2026.10.05'], ['', ''], ['2026/10/05', '']])('툴팁 날짜 %p → %p', (date, text) => expect(formatChartDate(date)).toBe(text))

describe('날마다의 MOA Parts 판매가', () => {
  const store = (time, price) => ({ price_krw: price, source: 'store', recorded_at: time })
  const coupang = (time, price) => ({ price_krw: price, source: 'coupang', recorded_at: time })
  const points = (list) => list.map(([date, price]) => ({ date, price }))

  test.each([
    [
      '그날(서울)까지의 마지막 store 기록. 다른 판매처는 쓰지 않고, 기간 안 첫 기록 전 날은 뺀다',
      { items: [store(day(1), 1000), coupang(day(2), 850), store('2026-10-03T16:00:00Z', 900)] },
      { days: 7, price: 900, now: NOW },
      [['2026-10-01', 1000], ['2026-10-02', 1000], ['2026-10-03', 1000], ['2026-10-04', 900], ['2026-10-05', 900]],
    ],
    [
      '첫 기록 전 날은 서버의 30일 추세(오늘로 끝남)로 채운다',
      { items: [store(day(1), 1000), store('2026-10-03T16:00:00Z', 900)] },
      { days: 7, price: 900, now: NOW, sparkline: [1100, 1100, 1000, 1000, 1000, 900, 900] },
      [['2026-09-29', 1100], ['2026-09-30', 1100], ['2026-10-01', 1000], ['2026-10-02', 1000], ['2026-10-03', 1000], ['2026-10-04', 900], ['2026-10-05', 900]],
    ],
    [
      '기간 안에 store 기록이 없으면 기간 내내 지금 판매가',
      { items: [coupang(day(4), 480)] },
      { days: 3, price: 500, now: NOW },
      [['2026-10-03', 500], ['2026-10-04', 500], ['2026-10-05', 500]],
    ],
    [
      '출시일 전 날은 뺀다',
      { items: [] },
      { days: 3, price: 500, now: NOW, releasedOn: '2026-10-04' },
      [['2026-10-04', 500], ['2026-10-05', 500]],
    ],
    [
      '마지막 날(오늘)은 지금 판매가',
      { items: [store(day(4), 900)] },
      { days: 2, price: 880, now: NOW },
      [['2026-10-04', 900], ['2026-10-05', 880]],
    ],
    [
      '기간 앞의 기록도 이어 쓰고, 판매가가 없으면 기록 값 그대로',
      { items: [store('2026-09-01T00:00:00Z', 1200)] },
      { days: 2, price: null, now: NOW },
      [['2026-10-04', 1200], ['2026-10-05', 1200]],
    ],
    [
      '받은 기록이 지금보다 늦으면(서버의 가상 시계가 앞섬) 그날을 오늘로 본다',
      { items: [coupang('2026-10-08T03:00:00Z', 650)] },
      { days: 2, price: 700, now: NOW },
      [['2026-10-07', 700], ['2026-10-08', 700]],
    ],
  ])('%s', (_name, history, options, expected) => {
    expect(dailyStorePrices(history, options)).toEqual(points(expected))
  })

  test.each([
    [null, { price: null }],
    [{ items: [{ price_krw: 'x', source: 'store', recorded_at: day(1) }, { price_krw: 1, source: 'store', recorded_at: 'bad' }] }, { price: null }],
  ])('기록도 판매가도 없으면 빈 배열(%p)', (history, options) => {
    expect(dailyStorePrices(history, { days: 7, now: NOW, ...options })).toEqual([])
  })
})

describe('그래프 좌표', () => {
  // 계산하기 쉬운 크기: 그리는 폭 100(10~110), 높이 100(10~110)
  const size = { width: 110, height: 120, left: 10, right: 0, top: 10, bottom: 10 }
  const series = (prices) => prices.map((price, index) => ({ date: `2026-10-0${index + 1}`, price }))

  test('선·채우기·가로선 4개(N만)·x 축 날짜·마지막 점·통계', () => {
    const chart = priceTrendChart(series([100000, 200000, 150000]), { size })
    expect(chart.line).toBe('M10.0 98.5 L60.0 21.5 L110.0 60.0')
    expect(chart.area).toBe('M10.0 98.5 L60.0 21.5 L110.0 60.0 L110.0 110 L10.0 110 Z')
    expect(chart.grid).toEqual([
      { y: 110, labelY: 114, label: '8.5만' },
      { y: 76.7, labelY: 80.7, label: '12.8만' },
      { y: 43.3, labelY: 47.3, label: '17.2만' },
      { y: 10, labelY: 14, label: '21.5만' },
    ])
    expect(chart.xLabels).toEqual([{ x: 10, label: '10.01', anchor: 'start' }, { x: 60, label: '10.02', anchor: 'middle' }, { x: 110, label: '10.03', anchor: 'end' }])
    expect(chart).toMatchObject({ count: 3, base: 110, lowY: null, last: { x: 110, y: 60 }, hover: null })
    expect(chart.stats).toEqual({ first: 100000, last: 150000, min: 100000, max: 200000, average: 150000, changePct: 50, tone: 'up' })
  })

  test.each([
    [1, { index: 1, x: 60, y: 21.5, left: 54.5, date: '2026.10.02', price: 200000 }],
    [0, { index: 0, x: 10, y: 98.5, left: 12, date: '2026.10.01', price: 100000 }],
    [9, { index: 2, x: 110, y: 60, left: 88, date: '2026.10.03', price: 150000 }],
    [null, null],
  ])('고른 날 %p 의 세로선·점·툴팁(left 는 12~88%)', (hoverIndex, hover) => {
    expect(priceTrendChart(series([100000, 200000, 150000]), { size, hoverIndex }).hover).toEqual(hover)
  })

  test('1년 최저가(점선)도 y 범위에 넣는다', () => {
    const chart = priceTrendChart(series([100000, 100000]), { size, lowest: 90000 })
    expect(chart.lowY).toBe(98.5)
    expect(chart.line).toBe('M10.0 21.5 L110.0 21.5')
    expect(chart.stats).toMatchObject({ changePct: 0, tone: 'flat' })
  })

  test('모든 값이 같으면 가운데 가로선(위아래 2% 여백)', () => {
    expect(priceTrendChart(series([100000, 100000]), { size }).line).toBe('M10.0 60.0 L110.0 60.0')
  })

  test('하루뿐이면 그래프 폭 전체의 가로선과 오른쪽 끝 점', () => {
    const chart = priceTrendChart(series([100000]), { size, hoverIndex: 0 })
    expect(chart.line).toBe('M10.0 60.0 L110.0 60.0')
    expect(chart.last).toEqual({ x: 110, y: 60 })
    expect(chart.xLabels).toEqual([{ x: 110, label: '10.01', anchor: 'end' }])
    expect(chart.hover).toMatchObject({ index: 0, x: 110 })
  })

  test('90일보다 길면 x 축 날짜는 YY.MM', () => {
    const long = Array.from({ length: 91 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), price: 1000 + index }))
    expect(priceTrendChart(long).xLabels.map((tick) => tick.label)).toEqual(['26.01', '26.01', '26.03', '26.04'])
    expect(priceTrendChart(long.slice(0, 90)).xLabels.map((tick) => tick.label)).toEqual(['01.01', '01.31', '03.01', '03.31'])
  })

  test('기본 크기는 디자인 시안과 같다(640×240, 왼쪽 56·오른쪽 12·위 16·아래 36)', () => {
    const chart = priceTrendChart(series([100, 200]))
    expect(chart).toMatchObject({ width: 640, height: 240, left: 56, right: 12, top: 16, base: 204 })
    expect(chart.line.startsWith('M56.0 ')).toBe(true)
    expect(chart.last.x).toBe(628)
  })

  test.each([[[]], [null], [[{ date: '2026-10-01', price: 'x' }]]])('값이 없으면 null(%p)', (points) => expect(priceTrendChart(points)).toBeNull())

  test.each([
    [0, 0], [0.3, 0], [0.5, 1], [0.8, 2], [1, 2], [-1, 0], [Number.NaN, null],
  ])('가로 위치 %p → 가장 가까운 날 %p', (ratio, index) => {
    expect(chartIndexAt(priceTrendChart(series([100000, 200000, 150000]), { size }), ratio)).toBe(index)
  })

  test('그래프가 없으면 null, 하루뿐이면 0', () => {
    expect(chartIndexAt(null, 0.5)).toBeNull()
    expect(chartIndexAt(priceTrendChart(series([100000]), { size }), 0.2)).toBe(0)
  })

  test.each([
    [null, 'ArrowLeft', 5, 4], [null, 'ArrowRight', 5, 4], [2, 'ArrowLeft', 5, 1], [0, 'ArrowLeft', 5, 0], [3, 'ArrowRight', 5, 4], [4, 'ArrowRight', 5, 4],
    [2, 'Home', 5, 0], [2, 'End', 5, 4], [2, 'Escape', 5, null], [2, 'Enter', 5, undefined], [null, 'ArrowLeft', 0, undefined],
  ])('키보드: 지금 %p 에서 %s(날 %i개) → %p', (current, key, count, next) => expect(stepChartIndex(current, key, count)).toBe(next))

  test('텍스트 대안은 기간·처음과 마지막 가격·변동률·최저·최고·평균·1년 최저가를 읽어 준다', () => {
    const points = series([100000, 200000, 150000])
    const chart = priceTrendChart(points, { size, lowest: 90000 })
    expect(priceTrendChartLabel(chart, points, { periodLabel: '1달', lowest: 90000 })).toBe(
      '최근 1달 MOA Parts 판매가 그래프. 2026.10.01 100,000원에서 2026.10.03 150,000원(+50.0%). 최저 100,000원, 최고 200,000원, 평균 150,000원. 점선은 1년 최저가 90,000원.',
    )
    expect(priceTrendChartLabel(chart, points)).toBe('MOA Parts 판매가 그래프. 2026.10.01 100,000원에서 2026.10.03 150,000원(+50.0%). 최저 100,000원, 최고 200,000원, 평균 150,000원.')
    expect(priceTrendChartLabel(null, [])).toBe('가격 기록이 없습니다.')
  })
})

describe('판매처별 표', () => {
  test('판매처 순서는 MOA Parts·쿠팡·네이버·그 밖이고, 최근·최저·최고 가격과 마지막 기록을 계산한다', () => {
    const items = [
      { price_krw: 900, source: 'naver', recorded_at: day(2) },
      { price_krw: 1000, source: 'store', recorded_at: day(1) },
      { price_krw: 700, source: 'zz-shop', recorded_at: day(3) },
      { price_krw: 800, source: 'store', recorded_at: day(10) },
      { price_krw: 950, source: 'store', recorded_at: day(5) },
      { price_krw: 850, source: 'coupang', recorded_at: day(4) },
    ]
    expect(priceHistoryRows(items)).toEqual([
      { source: 'store', name: 'MOA Parts', tone: 'store', latest: 800, lowest: 800, highest: 1000, latestAt: day(10), count: 3 },
      { source: 'coupang', name: '쿠팡', tone: 'coupang', latest: 850, lowest: 850, highest: 850, latestAt: day(4), count: 1 },
      { source: 'naver', name: '네이버', tone: 'naver', latest: 900, lowest: 900, highest: 900, latestAt: day(2), count: 1 },
      { source: 'zz-shop', name: 'zz-shop', tone: 'other', latest: 700, lowest: 700, highest: 700, latestAt: day(3), count: 1 },
    ])
  })

  test.each([[[]], [undefined], [[{ price_krw: 'x', source: 'store', recorded_at: day(1) }, { price_krw: 100, source: 'store', recorded_at: 'bad' }]]])('이력이 없거나 틀린 값만 있으면 빈 표(%p)', (items) => {
    expect(priceHistoryRows(items)).toEqual([])
  })
})
