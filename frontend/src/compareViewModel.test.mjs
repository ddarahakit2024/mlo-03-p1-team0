// 비교함 stores(src/stores/compareViewModel.js)와 비교 화면 경로(src/router/index.js 의 isCompareRoute).
// spec docs/specs/2026-11-01-event-enrichment.md: 담기·빼기·비우기·4개 제한·다른 카테고리 안내와 "비우고 담기", 깨진 localStorage 값·
// localStorage 사용 불가, 비교 표 계산(가격 "가장 저렴"·30일 추이·1년 최저·타몰 비교·"최고" 배지·specs 합집합·"—"), compare_add·compare_remove·compare_clear props.
import { jest } from '@jest/globals'
import {
  COMPARE_MESSAGES, COMPARE_STORAGE_KEY, MAX_COMPARE_ITEMS, bestCells, browserCompareStorage, compareItem, compareRows, compareStatus, compareViewProps,
  createCompareBox, emptyCompare, getComparePageState, lowestCell, parseCompare, readCompareQuery, removedNotice, specLabels, storeCell, trendCell,
} from './stores/compareViewModel.js'
import { isCompareRoute, resolveRouteName } from './router/index.js'

const gpu = (id, extra = {}) => ({ id, name: `지포스 ${id}`, category: 'gpu', brand: 'MSI', price_krw: 899000, thumbnail_url: `/images/${id}.webp`, ...extra })
const cpu = (id) => ({ id, name: `라이젠 ${id}`, category: 'cpu', brand: 'AMD', price_krw: 489000, thumbnail_url: '' })

function memoryStorage(initial = null) {
  let value = initial
  return { available: true, get: jest.fn(() => value), set: jest.fn((text) => { value = text; return true }), value: () => value }
}

function setup(initial = null) {
  const storage = memoryStorage(initial)
  const track = jest.fn()
  const onChange = jest.fn()
  const box = createCompareBox({ storage, track, onChange })
  const saved = () => JSON.parse(storage.value())
  const events = (type) => track.mock.calls.filter(([name]) => name === type).map(([, props]) => props)
  return { box, storage, track, onChange, saved, events }
}

describe('경로', () => {
  test.each([
    ['/compare', true],
    ['/compare/', true],
    ['/compare/3', false],
    ['/comparex', false],
    ['/products', false],
  ])('%s 는 비교 화면인가: %s', (pathname, expected) => {
    expect(isCompareRoute(pathname)).toBe(expected)
  })

  test('page_view 의 화면 이름은 compare', () => {
    expect(resolveRouteName('/compare')).toBe('compare')
    expect(resolveRouteName('/products/3')).toBe('product-detail')
  })
})

describe('저장 값', () => {
  test('저장할 항목은 id·이름·카테고리·사진만(가격은 넣지 않는다)', () => {
    expect(compareItem(gpu(3))).toEqual({ id: 3, name: '지포스 3', category: 'gpu', thumbnail_url: '/images/3.webp' })
  })

  test.each([
    ['null', null],
    ['JSON 아님', '{not json'],
    ['배열', '[1,2]'],
    ['items 없음', '{"category":"gpu"}'],
    ['items 가 배열 아님', '{"category":"gpu","items":"3"}'],
    ['id 가 숫자 아님', '{"category":"gpu","items":[{"id":"3","name":"x","category":"gpu"}]}'],
    ['카테고리 없음', '{"items":[{"id":3,"name":"x"}]}'],
  ])('깨진 값(%s)은 빈 비교함', (_name, text) => {
    expect(parseCompare(text)).toEqual(emptyCompare())
  })

  test('같은 id 는 한 번, 비교함 카테고리와 다른 항목은 빼고, 4개까지', () => {
    const items = [gpu(1), gpu(1), cpu(9), gpu(2), gpu(3), gpu(4), gpu(5)].map(compareItem)
    expect(parseCompare(JSON.stringify({ category: 'gpu', items }))).toEqual({ category: 'gpu', items: [gpu(1), gpu(2), gpu(3), gpu(4)].map(compareItem) })
    expect(parseCompare(JSON.stringify({ items: [cpu(9), gpu(1)].map(compareItem) }))).toEqual({ category: 'cpu', items: [compareItem(cpu(9))] })
  })

  test('browserCompareStorage: 저장소가 없거나 접근·읽기가 던지면 쓸 수 없음(available false), 쓰기가 던져도 던지지 않는다', () => {
    expect(browserCompareStorage(() => undefined).available).toBe(false)
    expect(browserCompareStorage(() => { throw new Error('SecurityError') }).available).toBe(false)
    expect(browserCompareStorage({ getItem: () => { throw new Error('denied') }, setItem: () => {} }).available).toBe(false)
    const values = new Map([[COMPARE_STORAGE_KEY, '{"items":[]}']])
    const storage = browserCompareStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) })
    expect(storage.available).toBe(true)
    expect(storage.get()).toBe('{"items":[]}')
    expect(storage.set('{"a":1}')).toBe(true)
    expect(values.get('moa.compare')).toBe('{"a":1}')
    const full = browserCompareStorage({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
    expect(full.set('x')).toBe(false)
  })

  test.each([
    ['', null],
    ['?ids=', null],
    ['?ids=abc', null],
    ['?ids=3', [3]],
    ['?ids=3,5,3, 9', [3, 5, 9]],
    ['?ids=1,2,3,4,5', [1, 2, 3, 4]],
    ['?ids=0,-1,2', [2]],
    ['?category=gpu', null],
  ])('공유 링크 주소 %s → %s', (search, expected) => {
    expect(readCompareQuery(search)).toEqual(expected)
  })
})

describe('담기 규칙', () => {
  test.each([
    ['빈 비교함', emptyCompare(), gpu(3), 'add'],
    ['이미 있음', { category: 'gpu', items: [compareItem(gpu(3))] }, gpu(3), 'exists'],
    ['다른 카테고리', { category: 'gpu', items: [compareItem(gpu(3))] }, cpu(9), 'category'],
    ['4개 참', { category: 'gpu', items: [1, 2, 3, 4].map((id) => compareItem(gpu(id))) }, gpu(5), 'full'],
    ['4개 참 + 다른 카테고리', { category: 'gpu', items: [1, 2, 3, 4].map((id) => compareItem(gpu(id))) }, cpu(9), 'category'],
    ['id 없음', emptyCompare(), { name: 'x' }, 'invalid'],
  ])('%s → %s', (_name, state, product, expected) => {
    expect(compareStatus(state, product)).toBe(expected)
  })
})

describe('비교함(createCompareBox)', () => {
  test('담기: 저장하고 compare_add(상품·카테고리·담은 뒤 개수·source)를 남긴다. 이미 있으면 다시 담지 않는다', () => {
    const { box, saved, events, onChange } = setup()
    expect(box.add(gpu(3), 'catalog')).toBe('added')
    expect(box.add(gpu(4), 'detail')).toBe('added')
    expect(box.add(gpu(4), 'detail')).toBe('exists')
    expect(saved()).toEqual({ category: 'gpu', items: [compareItem(gpu(3)), compareItem(gpu(4))] })
    expect(events('compare_add')).toEqual([
      { product_id: 3, category: 'gpu', count: 1, source: 'catalog' },
      { product_id: 4, category: 'gpu', count: 2, source: 'detail' },
    ])
    expect(onChange).toHaveBeenLastCalledWith({ state: box.state(), notice: null })
    expect(box.has(4)).toBe(true)
  })

  test(`${MAX_COMPARE_ITEMS}개가 차면 담지 않고 안내한다(이벤트 없음)`, () => {
    const { box, events } = setup()
    for (const id of [1, 2, 3, 4]) box.add(gpu(id), 'catalog')
    expect(box.add(gpu(5), 'catalog')).toBe('full')
    expect(box.state().items).toHaveLength(4)
    expect(box.notice()).toMatchObject({ kind: 'full', text: COMPARE_MESSAGES.full, product: null })
    expect(events('compare_add')).toHaveLength(4)
  })

  test('다른 카테고리는 안내하고, "비우고 담기"는 compare_clear(category_change) → compare_add 순서로 비교함을 바꾼다', () => {
    const { box, track, saved } = setup()
    box.add(gpu(3), 'catalog')
    box.add(gpu(4), 'catalog')
    track.mockClear()
    expect(box.add(cpu(9), 'detail')).toBe('category')
    expect(box.notice()).toMatchObject({ kind: 'category', text: COMPARE_MESSAGES.category, product: cpu(9), source: 'detail' })
    expect(track).not.toHaveBeenCalled()
    expect(box.replace()).toBe(true)
    expect(track.mock.calls).toEqual([
      ['compare_clear', { category: 'gpu', product_ids: [3, 4], reason: 'category_change' }],
      ['compare_add', { product_id: 9, category: 'cpu', count: 1, source: 'detail' }],
    ])
    expect(saved()).toEqual({ category: 'cpu', items: [compareItem(cpu(9))] })
    expect(box.notice()).toBeNull()
    expect(box.replace()).toBe(false)
  })

  test('빼기: compare_remove(뺀 뒤 개수·source·reason), 마지막을 빼면 빈 비교함. 없는 상품은 아무것도 하지 않는다', () => {
    const { box, events, saved } = setup()
    box.add(gpu(3), 'catalog')
    box.add(gpu(4), 'catalog')
    expect(box.remove(3, { source: 'bar' })).toBe(true)
    expect(box.remove(4, { source: 'compare', reason: 'unavailable' })).toBe(true)
    expect(box.remove(99, { source: 'bar' })).toBe(false)
    expect(events('compare_remove')).toEqual([
      { product_id: 3, category: 'gpu', count: 1, source: 'bar', reason: 'user' },
      { product_id: 4, category: 'gpu', count: 0, source: 'compare', reason: 'unavailable' },
    ])
    expect(saved()).toEqual(emptyCompare())
  })

  test('토글: 담겨 있으면 빼고(compare_remove source), 아니면 담는다', () => {
    const { box, track } = setup()
    expect(box.toggle(gpu(3), 'catalog')).toBe('added')
    expect(box.toggle(gpu(3), 'catalog')).toBe('removed')
    expect(track.mock.calls.map(([type, props]) => [type, props.source])).toEqual([['compare_add', 'catalog'], ['compare_remove', 'catalog']])
  })

  test('비우기: compare_clear(user, 담겨 있던 id). 비어 있으면 남기지 않는다. 안내는 닫을 수 있다', () => {
    const { box, events } = setup()
    expect(box.clear()).toBe(false)
    box.add(gpu(3), 'catalog')
    box.add(cpu(9), 'catalog')
    box.dismiss()
    expect(box.notice()).toBeNull()
    expect(box.clear()).toBe(true)
    expect(events('compare_clear')).toEqual([{ category: 'gpu', product_ids: [3], reason: 'user' }])
    expect(box.state()).toEqual(emptyCompare())
  })

  test('저장된 비교함을 이어 쓰고, 깨진 값이면 빈 비교함으로 시작한다', () => {
    expect(setup(JSON.stringify({ category: 'gpu', items: [compareItem(gpu(3))] })).box.state().items).toEqual([compareItem(gpu(3))])
    const broken = setup('{"category":')
    expect(broken.box.state()).toEqual(emptyCompare())
    expect(broken.box.add(gpu(3), 'catalog')).toBe('added')
  })

  test('localStorage 를 쓸 수 없으면 비교함을 쓰지 않는다(available false, 담지 않고 이벤트 없음)', () => {
    const track = jest.fn()
    const box = createCompareBox({ storage: browserCompareStorage(() => { throw new Error('SecurityError') }), track })
    expect(box.available).toBe(false)
    expect(box.add(gpu(3), 'catalog')).toBe('unavailable')
    expect(box.toggle(gpu(3), 'catalog')).toBe('unavailable')
    expect(box.state()).toEqual(emptyCompare())
    expect(track).not.toHaveBeenCalled()
  })

  test('refresh: 서버 상품으로 이름·사진·카테고리를 맞춘다(첫 상품 카테고리만, 4개까지, 이벤트 없음)', () => {
    const { box, track, saved } = setup(JSON.stringify({ category: 'gpu', items: [{ id: 3, name: '옛 이름', category: 'gpu', thumbnail_url: '' }] }))
    box.refresh([gpu(3, { name: '새 이름' }), cpu(9), gpu(4), gpu(5), gpu(6), gpu(7)])
    expect(saved()).toEqual({ category: 'gpu', items: [3, 4, 5, 6].map((id) => compareItem(id === 3 ? gpu(3, { name: '새 이름' }) : gpu(id))) })
    box.refresh([])
    expect(saved()).toEqual(emptyCompare())
    expect(track).not.toHaveBeenCalled()
  })

  test('track·onChange 가 던져도 비교함은 바뀐다', () => {
    const box = createCompareBox({ storage: memoryStorage(), track: () => { throw new Error('track') }, onChange: () => { throw new Error('render') } })
    expect(box.add(gpu(3), 'catalog')).toBe('added')
    expect(box.state().items).toHaveLength(1)
  })
})

describe('비교 화면 표', () => {
  const products = [
    gpu(3, { brand: 'MSI', price_krw: 899000, performance_score: 24500, value_score: 272.52, rating_average: 4.5, review_count: 12, released_on: '2026-09-12', specs: [{ label: '칩셋', value: 'AD104' }, { label: '메모리', value: '12GB' }] }),
    gpu(4, { brand: 'ASUS', price_krw: 3890000, performance_score: 39800, value_score: 102.31, rating_average: null, review_count: 0, released_on: null, specs: [{ label: '메모리', value: '24GB' }, { label: '권장 파워', value: '850W' }] }),
    gpu(5, { brand: '', price_krw: 899000, performance_score: null, value_score: 272.52, rating_average: 3.94, review_count: 1284, released_on: '2025-01-30', specs: [] }),
  ]

  test.each([
    ['min', [3, 1, 2], [false, true, false]],
    ['max', [3, 1, 3], [true, false, true]],
    ['min', [5, 5], [false, false]],
    ['max', [5, null], [false, false]],
    ['min', [null, '7', 9], [false, true, false]],
  ])('bestCells(%s, %j) → %j', (best, values, expected) => {
    expect(bestCells(values, best)).toEqual(expected)
  })

  test('specs 라벨 합집합(처음 나온 순서)', () => {
    expect(specLabels(products)).toEqual(['칩셋', '메모리', '권장 파워'])
    expect(specLabels([{ specs: null }, {}])).toEqual([])
  })

  test('행: 가격·30일 추이·1년 최저 대비·타몰 비교·평점·성능 점수·가성비 지수·출시일·specs. 없는 값은 "—"(흐림), 배지는 글자', () => {
    const rows = compareRows(products)
    expect(rows.map((row) => row.label)).toEqual(['가격', '30일 추이', '1년 최저 대비', '타몰 비교', '평점', '성능 점수', '가성비 지수', '출시일', '칩셋', '메모리', '권장 파워'])
    const row = (label) => rows.find((item) => item.label === label).cells
    const missing = { text: '—', badge: '', tone: '', missing: true }
    expect(row('가격')).toEqual([
      { text: '899,000원', badge: '가장 저렴', tone: 'good', missing: false },
      { text: '3,890,000원', badge: '', tone: '', missing: false },
      { text: '899,000원', badge: '가장 저렴', tone: 'good', missing: false },
    ])
    // price_trend 가 없는 상품(기능 전 응답)은 추이·최저·타몰 칸이 모두 "—"
    expect(row('30일 추이')).toEqual([missing, missing, missing])
    expect(row('1년 최저 대비')).toEqual([missing, missing, missing])
    expect(row('타몰 비교')).toEqual([missing, missing, missing])
    expect(row('성능 점수')).toEqual([
      { text: '24,500', badge: '', tone: '', missing: false },
      { text: '39,800', badge: '최고', tone: '', missing: false },
      missing,
    ])
    expect(row('가성비 지수').map((cell) => cell.badge)).toEqual(['최고', '', '최고'])
    expect(row('평점').map((cell) => [cell.text, cell.note])).toEqual([['★ 4.5', '리뷰 12개'], ['—', undefined], ['★ 3.9', '리뷰 1,284개']])
    expect(row('출시일').map((cell) => cell.text)).toEqual(['2026년 9월 12일', '—', '2025년 1월 30일'])
    expect(row('칩셋').map((cell) => [cell.text, cell.missing])).toEqual([['AD104', false], ['—', true], ['—', true]])
    expect(row('메모리').map((cell) => cell.text)).toEqual(['12GB', '24GB', '—'])
  })

  const trend = (extra = {}) => ({
    change_30d_pct: -5.2, lowest_1y_krw: 388400, lowest_1y_on: '2026-11-05', highest_1y_krw: 455000, average_30d_krw: 392000,
    is_lowest_1y: false, lowest_gap_pct: 1.2, sparkline_30d: [409000, 395200, 388400], external_lowest: { source: 'coupang', price_krw: 392000 },
    store_is_lowest: true, store_gap_krw: 3600, ...extra,
  })

  test.each([
    ['내림: ▼ + 초록 + 추세선', trend(), { text: '▼ -5.2%', tone: 'good', missing: false, values: [409000, 395200, 388400], changePct: -5.2 }],
    ['오름: ▲ + 빨강', trend({ change_30d_pct: 3.04 }), { text: '▲ +3.0%', tone: 'bad', missing: false, values: [409000, 395200, 388400], changePct: 3.04 }],
    ['±0.5% 안은 변동 없음(화살표 없음)', trend({ change_30d_pct: 0.3 }), { text: '+0.3%', tone: '', missing: false, values: [409000, 395200, 388400] }],
    ['값이 하나뿐이면 추세선 없이 변동률만', trend({ sparkline_30d: [388400] }), { text: '▼ -5.2%', tone: 'good' }],
    ['변동률이 없으면 "—"(추세선은 그대로)', trend({ change_30d_pct: null }), { text: '—', missing: true, values: [409000, 395200, 388400], changePct: null }],
    ['price_trend 가 없으면 "—"', null, { text: '—', missing: true }],
  ])('30일 추이 칸: %s', (_name, priceTrend, expected) => {
    const result = trendCell({ id: 1, price_trend: priceTrend })
    expect(result).toMatchObject(expected)
    // 추세선(values)은 값이 2개 이상일 때만 싣는다
    expect('values' in result).toBe('values' in expected)
  })

  test.each([
    ['지금이 최저', trend({ is_lowest_1y: true, lowest_gap_pct: 0 }), { text: '지금이 1년 중 최저가', tone: 'good', sub: '최저 388,400원' }],
    ['최저가 근접(3% 미만)', trend(), { text: '1년 최저가 대비 +1.2%', tone: 'warn', sub: '최저 388,400원' }],
    ['멀다', trend({ lowest_gap_pct: 8.4 }), { text: '1년 최저가 대비 +8.4%', tone: '', sub: '최저 388,400원' }],
    ['이력 없음', trend({ lowest_1y_krw: null }), { text: '—', missing: true }],
    ['price_trend 없음', undefined, { text: '—', missing: true }],
  ])('1년 최저 대비 칸: %s', (_name, priceTrend, expected) => {
    expect(lowestCell({ id: 1, price_trend: priceTrend })).toMatchObject(expected)
  })

  test.each([
    ['MOA 가 최저', trend(), { text: '타몰 최저가보다 3,600원 저렴', tone: 'good' }],
    ['같은 가격', trend({ store_gap_krw: 0 }), { text: '타몰 최저가와 같은 가격', tone: 'good' }],
    ['타몰이 더 쌈', trend({ store_is_lowest: false, external_lowest: { source: 'naver', price_krw: 380000 }, store_gap_krw: 8400 }), { text: '네이버에서 8,400원 더 저렴', tone: 'warn' }],
    ['타몰 가격 없음', trend({ external_lowest: null, store_gap_krw: null }), { text: '—', missing: true }],
  ])('타몰 비교 칸: %s', (_name, priceTrend, expected) => {
    expect(storeCell({ id: 1, price_trend: priceTrend })).toMatchObject(expected)
  })

  test('compareRows 는 price_trend 를 행에 그대로 싣는다(가격 배지와 따로)', () => {
    const rows = compareRows([gpu(3, { price_trend: trend() }), gpu(4, { price_krw: 950000, price_trend: trend({ change_30d_pct: 2, is_lowest_1y: true }) })])
    const row = (key) => rows.find((item) => item.key === key).cells.map((cell) => cell.text)
    expect(row('price')).toEqual(['899,000원', '950,000원'])
    expect(row('trend')).toEqual(['▼ -5.2%', '▲ +2.0%'])
    expect(row('lowest')).toEqual(['1년 최저가 대비 +1.2%', '지금이 1년 중 최저가'])
    expect(row('store')).toEqual(['타몰 최저가보다 3,600원 저렴', '타몰 최저가보다 3,600원 저렴'])
    expect(compareRows([])).toHaveLength(8)
    expect(compareRows(null).every((item) => item.cells.length === 0)).toBe(true)
  })

  test('상품이 하나면 배지를 붙이지 않는다', () => {
    const rows = compareRows([products[0]])
    expect(rows.flatMap((row) => row.cells).some((cell) => cell.badge)).toBe(false)
  })

  test.each([
    [{ loading: true }, 'loading'],
    [{ error: '실패' }, 'error'],
    [{ products: [] }, 'empty'],
    [{ products: [gpu(3)] }, 'ready'],
  ])('화면 상태 %j → %s', (input, expected) => {
    expect(getComparePageState(input)).toBe(expected)
  })

  test('404 안내와 compare_view props', () => {
    expect(removedNotice(0)).toBe('')
    expect(removedNotice(2)).toBe('판매하지 않는 상품 2개를 비교함에서 뺐습니다.')
    expect(compareViewProps(products)).toEqual({ category: 'gpu', product_ids: [3, 4, 5], count: 3 })
    expect(compareViewProps([])).toEqual({ category: null, product_ids: [], count: 0 })
  })
})
