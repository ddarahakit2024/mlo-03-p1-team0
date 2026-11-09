// 추천 view model(src/stores/recommendationViewModel.js)과 관리자 추천 학습 경로(src/router/index.js).
// spec docs/specs/2026-11-03-product-recommendations.md: 근거 문구, since 변환(서울 시각 ⇄ 시간대 붙은 ISO), 학습 기록 표시, 순위 변화(▲·▼·새로), 오류 문구.
import {
  ADMIN_ONLY_MESSAGE, DEFAULT_MODEL_LABEL, RECOMMENDATION_COMPARE_LIMIT, RECOMMENDATION_LIMIT, eventPeriodLabel, formatCount, formatDuration,
  formatRecommendationScore, formatSeoulDateTime, getComparisonState, getRecommendationsPageState, isZonedIso, modelLabel, parseProductNumber,
  parseRecommendationTime, rankChange, rankChanges, recommendationError, recommendationListContext, recommendationReason, seoulInputToIso,
  toSeoulInputValue, trainingSince, trainingSuccessMessage, validateProductNumber,
} from './stores/recommendationViewModel.js'
import { LOGIN_EXPIRED_MESSAGE } from './stores/orderViewModel.js'
import { isAdminRecommendationsRoute, resolveRouteName } from './router/index.js'

test('상세 추천은 6개, 관리자 순위 비교는 10줄(서버 기본값)', () => {
  expect(RECOMMENDATION_LIMIT).toBe(6)
  expect(RECOMMENDATION_COMPARE_LIMIT).toBe(10)
})

describe('근거·모델 이름', () => {
  test.each([
    ['co_view', '함께 본 상품'],
    ['similar', '비슷한 가격대'],
    ['unknown', '추천'],
    [null, '추천'],
  ])('reason %p → %p', (code, label) => expect(recommendationReason(code)).toBe(label))

  test.each([
    [{ version: 'itemcf-4', trained_at: '2026-10-08T03:10:00Z' }, 'itemcf-4'],
    [null, DEFAULT_MODEL_LABEL],
    [{ version: '' }, '기본 추천'],
    [undefined, '기본 추천'],
  ])('model %p → %p', (model, label) => expect(modelLabel(model)).toBe(label))
})

describe('시각: 화면은 서울 시각, 서버로는 시간대를 붙인 ISO', () => {
  test.each([
    ['2026-10-08T03:10:00Z', '2026-10-08T12:10:00'],
    ['2026-11-03T05:12:33.987654+00:00', '2026-11-03T14:12:33'],
    ['2026-11-03T20:30:00+00:00', '2026-11-04T05:30:00'],
    ['2026-11-03T14:12:33+09:00', '2026-11-03T14:12:33'],
    ['2026-11-03T05:12:33', '2026-11-03T14:12:33'],
    ['', ''],
    [null, ''],
    ['시각 아님', ''],
  ])('server_time %p → datetime-local 기본값 %p(초 아래는 버린다, 시간대 없으면 UTC)', (value, expected) => {
    expect(toSeoulInputValue(value)).toBe(expected)
  })

  test.each([
    ['2026-11-03T14:12:33', '2026-11-03T14:12:33+09:00'],
    ['2026-11-03T14:12', '2026-11-03T14:12:00+09:00'],
    ['2026-11-03T14:12:33.500', '2026-11-03T14:12:33+09:00'],
    [' 2026-11-03T00:00 ', '2026-11-03T00:00:00+09:00'],
    ['2026-02-30T10:00', null],
    ['2026-11-03T24:00', null],
    ['2026-11-03', null],
    ['', null],
    [undefined, null],
  ])('datetime-local %p → since %p', (text, expected) => expect(seoulInputToIso(text)).toBe(expected))

  test('서울 시각으로 바꿨다가 되돌리면 같은 순간이다(초 단위)', () => {
    const iso = seoulInputToIso(toSeoulInputValue('2026-11-03T05:12:33Z'))
    expect(parseRecommendationTime(iso).toISOString()).toBe('2026-11-03T05:12:33.000Z')
  })

  test.each([
    ['2026-11-03T14:12:33+09:00', true],
    ['2026-10-08T03:00:00Z', true],
    ['2026-10-08T03:00:00.123456+00:00', true],
    ['2026-11-03T14:12:33', false],
    ['2026-11-03', false],
    [null, false],
  ])('시간대가 붙은 ISO 인지 %p → %p', (value, expected) => expect(isZonedIso(value)).toBe(expected))

  test.each([
    ['2026-10-08T03:10:00Z', '2026-10-08 12:10:00'],
    ['2026-10-08T15:00:05+00:00', '2026-10-09 00:00:05'],
    [null, ''],
  ])('표시 %p → %p', (value, expected) => expect(formatSeoulDateTime(value)).toBe(expected))

  test.each([
    [null, '전체'],
    ['', '전체'],
    ['2026-10-08T03:00:00Z', '2026-10-08 12:00:00 이후'],
  ])('이벤트 기간 %p → %p', (value, expected) => expect(eventPeriodLabel(value)).toBe(expected))
})

describe('학습 요청의 since', () => {
  test.each([
    [{ scope: 'all', sinceText: '2026-11-03T14:12:33' }, { since: null, error: '' }],
    [{ scope: 'all', sinceText: '' }, { since: null, error: '' }],
    [{ scope: 'since', sinceText: '2026-11-03T14:12:33' }, { since: '2026-11-03T14:12:33+09:00', error: '' }],
    [{ scope: 'since', sinceText: '' }, { since: null, error: '학습에 쓸 이벤트의 시작 시각을 입력해 주세요.' }],
    [{ scope: 'since', sinceText: '2026-13-01T00:00' }, { since: null, error: '시작 시각 형식이 올바르지 않습니다. 날짜와 시각을 다시 입력해 주세요.' }],
    [{}, { since: null, error: '' }],
  ])('%p → %p', (input, expected) => expect(trainingSince(input)).toEqual(expected))
})

describe('학습 결과 문구', () => {
  test.each([
    [180, '0.2초'],
    [0, '0.0초'],
    [1234, '1.2초'],
    [59_940, '59.9초'],
    [65_000, '1분 5초'],
    [null, '-'],
    [-1, '-'],
  ])('걸린 시간 %p ms → %p', (ms, expected) => expect(formatDuration(ms)).toBe(expected))

  test.each([[24, '24'], [720000, '720,000'], [null, '0'], ['x', '0']])('개수 %p → %p', (value, expected) => expect(formatCount(value)).toBe(expected))

  test.each([[0.49, '0.490'], [0.23077, '0.231'], [0, '0.000'], [null, '-'], [undefined, '-']])('점수 %p → %p', (value, expected) => {
    expect(formatRecommendationScore(value)).toBe(expected)
  })

  test('성공 문구는 spec 예시 그대로다(값은 서버 응답)', () => {
    expect(trainingSuccessMessage({ version: 'itemcf-4', event_count: 24, session_count: 6, duration_ms: 180 }))
      .toBe('itemcf-4 를 학습했습니다. 상품 조회 이벤트 24건 · 세션 6개 · 0.2초')
    expect(trainingSuccessMessage({ version: 'itemcf-12', event_count: 12345, session_count: 1200, duration_ms: 2500 }))
      .toBe('itemcf-12 를 학습했습니다. 상품 조회 이벤트 12,345건 · 세션 1,200개 · 2.5초')
  })
})

describe('순위 변화(현재 표 ↔ 이전 표, product_id 기준)', () => {
  const previous = [
    { rank: 1, product_id: 28 }, { rank: 2, product_id: 8 }, { rank: 3, product_id: 9 }, { rank: 4, product_id: 3 }, { rank: 5, product_id: 31 },
  ]
  test.each([
    [{ rank: 1, product_id: 3 }, { text: '▲3', label: '이전보다 3계단 오름', tone: 'up' }],
    [{ rank: 2, product_id: 28 }, { text: '▼1', label: '이전보다 1계단 내림', tone: 'down' }],
    [{ rank: 3, product_id: 9 }, { text: '-', label: '이전과 같은 순위', tone: 'same' }],
    [{ rank: 6, product_id: 44 }, { text: '새로', label: '이전 순위에 없던 상품', tone: 'new' }],
  ])('%p → %p', (item, expected) => expect(rankChange(item, previous)).toEqual(expected))

  test('이전 순위가 없으면(모델 0개, previous null) 표시하지 않는다. 이전이 빈 목록이면 모두 새로', () => {
    expect(rankChange({ rank: 1, product_id: 3 }, null)).toBeNull()
    expect(rankChanges([{ rank: 1, product_id: 3 }, { rank: 2, product_id: 8 }], null)).toEqual([null, null])
    expect(rankChanges([{ rank: 1, product_id: 3 }], []).map((change) => change.text)).toEqual(['새로'])
    expect(rankChanges(null, previous)).toEqual([])
  })
})

describe('상품 번호', () => {
  test.each([
    [1, 1], ['3', 3], [' 12 ', 12], [0, null], [-1, null], [1.5, null], ['abc', null], ['', null], [null, null], ['1e3', null],
  ])('%p → %p', (value, expected) => {
    expect(parseProductNumber(value)).toBe(expected)
    expect(validateProductNumber(value)).toBe(expected === null ? '상품 번호를 1 이상의 정수로 입력해 주세요.' : '')
  })
})

describe('오류 문구와 화면 상태', () => {
  const failure = (status, message) => ({ response: { status, data: { message } } })
  test.each([
    [failure(401, '로그인이 필요합니다.'), LOGIN_EXPIRED_MESSAGE],
    [failure(403, '관리자만 사용할 수 있습니다.'), ADMIN_ONLY_MESSAGE],
    [failure(409, '이미 추천 모델을 학습하고 있습니다.'), '이미 추천 모델을 학습하고 있습니다.'],
    [failure(422, 'since 는 지금보다 미래일 수 없습니다.'), 'since 는 지금보다 미래일 수 없습니다.'],
    [failure(503, '이벤트 저장소에 연결하지 못했습니다.'), '이벤트 저장소에 연결하지 못했습니다.'],
    [failure(503), '대신 문구'],
    [failure(500, '서버 내부 오류가 발생했습니다.'), '대신 문구'],
    [{ message: 'Network Error' }, '대신 문구'],
    [null, '대신 문구'],
  ])('%#: 오류 → 문구', (error, expected) => expect(recommendationError(error, '대신 문구')).toBe(expected))

  test.each([
    [{ loading: true, needsLogin: true }, 'loading'],
    [{ needsLogin: true, forbidden: true }, 'guest'],
    [{ forbidden: true, error: '오류' }, 'forbidden'],
    [{ error: '오류', items: [{}] }, 'error'],
    [{ items: [] }, 'empty'],
    [{ items: null }, 'empty'],
    [{ items: [{ version: 'itemcf-1' }] }, 'ready'],
  ])('관리자 화면 %p → %s', (input, expected) => expect(getRecommendationsPageState(input)).toBe(expected))

  test.each([
    [{}, 'idle'],
    [{ loading: true, missing: true }, 'loading'],
    [{ missing: true, error: '오류' }, 'missing'],
    [{ error: '오류', comparison: {} }, 'error'],
    [{ comparison: { current: {} } }, 'ready'],
  ])('순위 비교 영역 %p → %s', (input, expected) => expect(getComparisonState(input)).toBe(expected))
})

describe('추천 칸 노출·클릭 추적기의 start 값(schema_version 5)', () => {
  test.each([
    [{ product_id: 1, model: { version: 'itemcf-4' }, items: [] }, 9, { page: 1, source_product_id: 1, model_version: 'itemcf-4' }],
    [{ product_id: 1, model: null, items: [] }, 1, { page: 1, source_product_id: 1, model_version: null }],
    [{ model: { version: '' } }, 7, { page: 1, source_product_id: 7, model_version: null }],
    [null, 3, { page: 1, source_product_id: 3, model_version: null }],
  ])('%p (보고 있는 상품 %p) → %p', (data, productId, expected) => expect(recommendationListContext(data, productId)).toEqual(expected))
})

describe('경로', () => {
  test.each([
    ['/admin/recommendations', true], ['/admin/recommendations/', true], ['/admin/recommendations/1', false], ['/admin', false], ['/admin/returns', false],
  ])('%s → 관리자 추천 학습 %s', (pathname, expected) => expect(isAdminRecommendationsRoute(pathname)).toBe(expected))

  test.each([['/admin/recommendations', 'admin-recommendations'], ['/admin/recommendations/', 'admin-recommendations'], ['/admin/recommendation', 'products']])(
    '화면 이름(page_view route) %s → %s', (pathname, name) => expect(resolveRouteName(pathname)).toBe(name),
  )
})
