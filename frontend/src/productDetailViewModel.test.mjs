// 상품 상세 view model(src/stores/productDetailViewModel.js): 가격 카드 칸·판매처 문구, 판매처 비교, 목표가 알림, 관련 질문, 주소, 실패 문구.
import {
  alertButtonLabel, alertPresets, alertSavedMessage, askQuestionPath, categoryPath, detailRequestError, findAlert, formatDotDate,
  formatStoreUpdatedAt, parseTargetPrice, priceTiles, relatedQuestionRows, storeComparison, storeSummary,
} from './stores/productDetailViewModel.js'

const trend = (extra = {}) => ({
  change_30d_pct: -5.2, lowest_1y_krw: 388400, lowest_1y_on: '2026-11-05', highest_1y_krw: 455000, average_30d_krw: 392000,
  is_lowest_1y: true, lowest_gap_pct: 0, sparkline_30d: [395200, 388400], external_lowest: { source: 'coupang', price_krw: 392000 },
  store_is_lowest: true, store_gap_krw: 3600, ...extra,
})

test.each([
  ['2026-11-05', '2026.11.05'],
  ['2026-10-29T16:00:00Z', '2026.10.30'],
  ['2026-10-29T14:00:00', '2026.10.29'],
  ['', ''],
  [null, ''],
  ['bad', ''],
])('날짜 %p → %p', (value, text) => expect(formatDotDate(value)).toBe(text))

test.each([
  ['2026-11-05T00:00:00Z', '11월 5일 09:00 기준'],
  ['2026-11-05T03:05:00Z', '11월 5일 12:05 기준'],
  [null, ''],
  ['bad', ''],
])('판매처 기준 시각 %p → %p', (value, text) => expect(formatStoreUpdatedAt(value)).toBe(text))

describe('가격 카드', () => {
  test.each([
    [
      '지금이 1년 최저가',
      trend(),
      { lowest: { text: '388,400원', note: '2026.11.05' }, average: { text: '392,000원', note: '1년 최고 455,000원' }, verdict: { text: '지금 사도 좋아요', tone: 'good', note: '지금이 1년 중 최저가' } },
    ],
    [
      '최저가와 3% 안',
      trend({ is_lowest_1y: false, lowest_gap_pct: 2.1 }),
      { verdict: { text: '최저가에 가까워요', tone: 'near', note: '1년 최저가 대비 +2.1%' } },
    ],
    [
      '오르는 중',
      trend({ is_lowest_1y: false, lowest_gap_pct: 8, change_30d_pct: 3 }),
      { verdict: { text: '오르는 중, 알림 추천', tone: 'neutral', note: '1년 최저가 대비 +8.0%' } },
    ],
    [
      '내리는 중이지만 최저가와 멀다',
      trend({ is_lowest_1y: false, lowest_gap_pct: 8, change_30d_pct: -2 }),
      { verdict: { text: '조금 더 기다려도 돼요', tone: 'neutral', note: '1년 최저가 대비 +8.0%' } },
    ],
    [
      '추세가 없으면 —',
      null,
      { lowest: { text: '—', note: '기록 없음' }, average: { text: '—', note: '1년 최고 —' }, verdict: { text: '기록이 더 필요해요', tone: 'neutral', note: '가격 기록이 쌓이면 알려 드려요' } },
    ],
  ])('%s', (_name, value, expected) => expect(priceTiles(value)).toMatchObject(expected))

  test.each([
    ['MOA 가 최저면 배송 문구까지', trend(), { text: '타몰 최저가보다 3,600원 저렴 · 무료배송 · 오늘 출발', tone: 'good' }],
    ['다른 곳이 더 싸면 경고 문구만', trend({ store_is_lowest: false }), { text: '쿠팡에서 3,600원 더 저렴', tone: 'warn' }],
    ['외부 가격이 없으면 null', trend({ external_lowest: null, store_gap_krw: null }), null],
  ])('판매처 문구: %s', (_name, value, expected) => expect(storeSummary(value)).toEqual(expected))
})

describe('판매처 비교', () => {
  test('가격 낮은 순, 맨 위가 최저가, MOA Parts 판매가 기준 차이, 가장 늦은 기록 시각', () => {
    const result = storeComparison({
      price_krw: 392000,
      price_trend: trend({ store_is_lowest: false }),
      store_prices: [
        { source: 'store', price_krw: 392000, recorded_at: '2026-11-01T00:00:00Z' },
        { source: 'naver', price_krw: 398000, recorded_at: '2026-11-04T03:00:00Z' },
        { source: 'coupang', price_krw: 388400, recorded_at: '2026-11-05T03:00:00Z' },
      ],
    })
    expect(result.rows).toEqual([
      { source: 'coupang', name: '쿠팡', price: 388400, isStore: false, isLowest: true, note: '11월 5일 기록', diffText: '−3,600원', diffTone: 'lower' },
      { source: 'store', name: 'MOA Parts', price: 392000, isStore: true, isLowest: false, note: '무료 배송', diffText: 'MOA 판매가', diffTone: 'store' },
      { source: 'naver', name: '네이버', price: 398000, isStore: false, isLowest: false, note: '11월 4일 기록', diffText: '+6,000원', diffTone: 'higher' },
    ])
    expect(result).toMatchObject({ updatedAt: '2026-11-05T03:00:00Z', storeIsLowest: false, hasExternal: true })
  })

  test('같은 가격이면 MOA Parts 가 먼저(최저가)이고, 서버 값이 없으면 줄 순서로 최저를 정한다', () => {
    const result = storeComparison({ price_krw: 1000, store_prices: [{ source: 'coupang', price_krw: 1000, recorded_at: null }, { source: 'store', price_krw: 1000, recorded_at: null }] })
    expect(result.rows.map((row) => [row.source, row.isLowest, row.diffText, row.note])).toEqual([['store', true, 'MOA 판매가', '무료 배송'], ['coupang', false, '같은 가격', '최근 기록']])
    expect(result).toMatchObject({ updatedAt: null, storeIsLowest: true, hasExternal: true })
  })

  test('store_prices 가 없으면 지금 판매가로 MOA Parts 한 줄(최저가 배지 없음)', () => {
    expect(storeComparison({ price_krw: 5000 })).toEqual({
      rows: [{ source: 'store', name: 'MOA Parts', price: 5000, isStore: true, isLowest: false, note: '무료 배송', diffText: 'MOA 판매가', diffTone: 'store' }],
      updatedAt: null, storeIsLowest: true, hasExternal: false,
    })
    expect(storeComparison(null)).toEqual({ rows: [], updatedAt: null, storeIsLowest: true, hasExternal: false })
  })
})

describe('목표가 알림', () => {
  test.each([
    ['1년 최저가와 -5%·-10%(100원 단위)', { price_krw: 389990, price_trend: trend() }, [{ label: '1년 최저가', value: 388400 }, { label: '-5%', value: 370500 }, { label: '-10%', value: 351000 }]],
    ['추세가 없으면 -5%·-10% 만', { price_krw: 392000 }, [{ label: '-5%', value: 372400 }, { label: '-10%', value: 352800 }]],
    ['가격이 없으면 없음', null, []],
  ])('빠른 선택: %s', (_name, product, presets) => expect(alertPresets(product)).toEqual(presets))

  test.each([
    ['389,000원', 389000], [' 12 000 ', 12000], ['0', 0], ['', null], ['abc', null], [null, null],
  ])('입력 %p → %p', (text, value) => expect(parseTargetPrice(text)).toBe(value))

  test('이 상품의 알림 찾기·버튼 글자·저장 안내', () => {
    const items = [{ product_id: 2, target_price_krw: 380000 }, { product_id: 7, target_price_krw: 690000 }]
    expect(findAlert(items, 7)).toBe(items[1])
    expect(findAlert(items, 3)).toBeNull()
    expect(findAlert(null, 3)).toBeNull()
    expect(alertButtonLabel(items[1])).toBe('알림 690,000원')
    expect(alertButtonLabel(null)).toBe('목표가 알림')
    expect(alertSavedMessage(389000)).toBe('389,000원 이하로 내려오면 알려드릴게요')
  })
})

test.each([
  ['401', { response: { status: 401 } }, { message: '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.', needsLogin: true }],
  ['403 서버 문구', { response: { status: 403, data: { message: '허용되지 않은 요청 출처입니다.' } } }, { message: '허용되지 않은 요청 출처입니다.', needsLogin: false }],
  ['403 문구 없음', { response: { status: 403 } }, { message: '요청할 권한이 없습니다. 새로 고친 뒤 다시 시도해 주세요.', needsLogin: false }],
  ['409', { response: { status: 409, data: { message: '목표가 알림은 50개까지 등록할 수 있습니다.' } } }, { message: '목표가 알림은 50개까지 등록할 수 있습니다.', needsLogin: false }],
  ['422', { response: { status: 422, data: { message: '이미 MOA Parts 가 가장 저렴한 상품입니다.' } } }, { message: '이미 MOA Parts 가 가장 저렴한 상품입니다.', needsLogin: false }],
  ['500', { response: { status: 500, data: { message: 'Internal' } } }, { message: '실패', needsLogin: false }],
  ['네트워크', new Error('Network Error'), { message: '실패', needsLogin: false }],
])('요청 실패 %s', (_name, error, expected) => expect(detailRequestError(error, '실패')).toEqual(expected))

test('관련 질문 줄: 링크·답변 수·채택·글쓴이·날짜', () => {
  const page = { items: [
    { id: 12, title: '이 쿨러 높이 괜찮나요?', author: { name: '김조립' }, created_at: '2026-10-29T16:00:00Z', answer_count: 2, accepted_answer_id: 5 },
    { id: 13, title: '', author: null, created_at: '', answer_count: null, accepted_answer_id: null },
  ] }
  expect(relatedQuestionRows(page)).toEqual([
    { id: 12, href: '/questions/12', title: '이 쿨러 높이 괜찮나요?', answerCount: 2, accepted: true, author: '김조립', date: '2026.10.30', createdAt: '2026-10-29T16:00:00Z' },
    { id: 13, href: '/questions/13', title: '제목 없는 질문', answerCount: 0, accepted: false, author: '회원', date: '', createdAt: '' },
  ])
  expect(relatedQuestionRows(null)).toEqual([])
})

test.each([
  [() => askQuestionPath(3), '/questions/new?product=3'],
  [() => categoryPath('gpu'), '/products?category=gpu'],
  [() => categoryPath(''), '/products'],
])('주소 %#', (make, path) => expect(make()).toBe(path))
