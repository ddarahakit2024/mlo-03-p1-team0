// 부품 호환성 화면 계산(src/stores/compatibilityViewModel.js): 언제 확인할지, 상태 문구, 배지, 균형 막대 좌표, 전력 문구, 같은 구성, 이벤트 props.
// 기준: docs/specs/2026-11-01-compatibility-rules.md "화면"·"이벤트"·"API 계약"
import {
  BALANCE_BAR, COMPATIBILITY_DEBOUNCE_MS, COMPATIBILITY_TEXT, MAX_COMPATIBILITY_LINES, MAX_EVENT_LIST_LENGTH, balanceAriaLabel, balanceLabelText, balanceX, balanceZone,
  clampBalance, compatibilityCategoryCount, compatibilityEventProps, compatibilityItems, compatibilityKey, compatibilityStatusText, compatibilityTone, countIssues,
  formatBalanceScore, issueLevelLabel, powerText, shouldCheckCompatibility, validateCompatibilityItems,
} from './stores/compatibilityViewModel.js'
import { MAX_PROP_LIST_LENGTH } from './stores/tracking.js'

const line = (productId, category, quantity = 1) => ({ product_id: productId, category, quantity, name: `상품 ${productId}` })
const socketIssue = { code: 'SOCKET_MISMATCH', level: 'error', message: 'CPU(AM5)와 메인보드(LGA1700)의 소켓이 다릅니다.', product_ids: [1, 60] }
const coolerIssue = { code: 'NO_CPU_COOLER', level: 'warning', message: 'CPU 에 기본 쿨러가 없어 쿨러가 따로 필요합니다.', product_ids: [1] }
const psuIssue = { code: 'PSU_TIGHT', level: 'warning', message: '그래픽카드 권장 파워는 750W 입니다.', product_ids: [140, 200] }
const missingIssue = { code: 'MISSING_PARTS', level: 'info', message: '완성 PC 에 필요한 메모리, 파워가 없습니다.', product_ids: [] }
// spec API 계약의 응답 예시
const specResult = { status: 'error', issues: [socketIssue, coolerIssue], balance: { score: 0.42, label: 'balanced' }, power: { estimated_w: 520, psu_w: 850 }, categories: ['cpu', 'mainboard', 'memory'] }

test('상수: 0.4초 모으기, 30줄, 이벤트 목록 길이는 추적기와 같다', () => {
  expect(COMPATIBILITY_DEBOUNCE_MS).toBe(400)
  expect(MAX_COMPATIBILITY_LINES).toBe(30)
  expect(MAX_EVENT_LIST_LENGTH).toBe(MAX_PROP_LIST_LENGTH)
})

describe('언제 확인할지(카테고리 2개 이상, API 계약 안의 줄)', () => {
  test.each([
    ['빈 목록', [], false],
    ['부품 1개', [line(1, 'cpu')], false],
    ['같은 카테고리 2개(카테고리 1개뿐)', [line(1, 'cpu'), line(2, 'cpu')], false],
    ['CPU 수량 2(카테고리 1개뿐)', [line(1, 'cpu', 2)], false],
    ['CPU + 메인보드', [line(1, 'cpu'), line(60, 'mainboard')], true],
    ['카테고리가 빈 줄은 세지 않는다', [line(1, 'cpu'), line(2, '')], false],
    ['수량 11(계약 밖)', [line(1, 'cpu', 11), line(60, 'mainboard')], false],
    ['같은 상품 두 줄(계약 밖)', [line(1, 'cpu'), line(1, 'mainboard')], false],
    ['31줄(계약 밖)', Array.from({ length: 31 }, (_, index) => line(index + 1, index % 2 ? 'cpu' : 'gpu')), false],
    ['30줄', Array.from({ length: 30 }, (_, index) => line(index + 1, index % 2 ? 'cpu' : 'gpu')), true],
    ['배열이 아님', null, false],
  ])('%s → %s', (_name, lines, expected) => {
    expect(shouldCheckCompatibility(lines)).toBe(expected)
  })

  test('카테고리 수는 서로 다른 카테고리만 센다', () => {
    expect(compatibilityCategoryCount([line(1, 'cpu'), line(2, 'cpu'), line(3, 'gpu')])).toBe(2)
  })
})

describe('요청 줄과 검사', () => {
  test('줄에서 product_id·quantity 만 남긴다(이름·카테고리는 보내지 않는다)', () => {
    expect(compatibilityItems([line(1, 'cpu'), line(60, 'mainboard', 2)])).toEqual([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 2 }])
    expect(compatibilityItems(undefined)).toEqual([])
  })

  test.each([
    [[], '호환성을 확인할 부품을 골라 주세요.'],
    [null, '호환성을 확인할 부품을 골라 주세요.'],
    [Array.from({ length: 31 }, (_, index) => ({ product_id: index + 1, quantity: 1 })), '호환성은 부품 30줄까지 확인할 수 있습니다.'],
    [[{ product_id: 0, quantity: 1 }], '상품 정보가 올바르지 않습니다. 부품을 다시 골라 주세요.'],
    [[{ product_id: '1', quantity: 1 }], '상품 정보가 올바르지 않습니다. 부품을 다시 골라 주세요.'],
    [[{ product_id: 1, quantity: 0 }], '수량은 1~10개로 골라 주세요.'],
    [[{ product_id: 1, quantity: 11 }], '수량은 1~10개로 골라 주세요.'],
    [[{ product_id: 1, quantity: 1.5 }], '수량은 1~10개로 골라 주세요.'],
    [[{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }], '같은 상품이 두 줄 있습니다. 한 줄로 합쳐 주세요.'],
    [[{ product_id: 1, quantity: 1 }], ''],
    [[{ product_id: 1, quantity: 10 }, { product_id: 2, quantity: 1 }], ''],
  ])('validateCompatibilityItems(%j) → %p', (items, expected) => {
    expect(validateCompatibilityItems(items)).toBe(expected)
  })
})

describe('상태 문구(spec 상태표 그대로)', () => {
  test.each([
    ['loading', null, '부품 호환성을 확인하는 중입니다...', 'loading'],
    ['error', null, '호환성을 확인하지 못했습니다. 다시 시도해 주세요.', 'fail'],
    ['ready', { status: 'ok', issues: [] }, '함께 쓸 수 있는 부품입니다.', 'ok'],
    ['ready', { status: 'ok', issues: [missingIssue] }, '함께 쓸 수 있는 부품입니다.', 'ok'],
    ['ready', { status: 'warning', issues: [coolerIssue, psuIssue, missingIssue] }, '주의할 점 2개', 'warning'],
    ['ready', specResult, '함께 쓸 수 없는 부품이 있습니다(1개)', 'error'],
    ['ready', { status: 'error', issues: [socketIssue, { ...socketIssue, code: 'GPU_TOO_LONG' }, coolerIssue] }, '함께 쓸 수 없는 부품이 있습니다(2개)', 'error'],
    ['ready', { status: 'unknown', issues: [] }, '', ''],
    ['ready', null, '', ''],
    ['', null, '', ''],
  ])('state %s, result %j → "%s" (모양 %s)', (state, result, text, tone) => {
    expect(compatibilityStatusText(state, result)).toBe(text)
    expect(compatibilityTone(state, result)).toBe(tone)
  })

  test('문구 상수', () => {
    expect(COMPATIBILITY_TEXT).toEqual({
      title: '부품 호환성', loading: '부품 호환성을 확인하는 중입니다...', ok: '함께 쓸 수 있는 부품입니다.', fail: '호환성을 확인하지 못했습니다. 다시 시도해 주세요.',
    })
  })

  test('수준별 문제 수', () => {
    expect(countIssues(specResult, 'error')).toBe(1)
    expect(countIssues(specResult, 'warning')).toBe(1)
    expect(countIssues(specResult, 'info')).toBe(0)
    expect(countIssues(null, 'error')).toBe(0)
  })
})

describe('배지·라벨', () => {
  test.each([
    ['error', '호환 안 됨'],
    ['warning', '주의'],
    ['info', '안내'],
    ['other', '안내'],
    [undefined, '안내'],
  ])('수준 %s → 배지 "%s"', (level, label) => {
    expect(issueLevelLabel(level)).toBe(label)
  })

  test.each([
    ['balanced', '균형 좋음'],
    ['cpu_bound', 'CPU 가 약함'],
    ['gpu_bound', '그래픽카드가 약함'],
    ['other', ''],
    [null, ''],
  ])('균형 %s → "%s"', (label, text) => {
    expect(balanceLabelText(label)).toBe(text)
  })
})

describe('균형 막대 좌표(-2 ~ 2, viewBox 300 · 여백 10)', () => {
  test('막대 크기', () => {
    expect(BALANCE_BAR).toEqual({ width: 300, height: 24, padding: 10 })
  })

  test.each([
    [-2, 10],
    [-1, 80],
    [0, 150],
    [0.42, 179.4],
    [1, 220],
    [2, 290],
    [3.5, 290],
    [-7, 10],
    ['1.5', 255],
    [null, null],
    [undefined, null],
    ['', null],
    [Number.NaN, null],
    ['abc', null],
  ])('점수 %p → x %p', (score, x) => {
    expect(balanceX(score)).toBe(x)
  })

  test.each([
    [5, 2], [-5, -2], [0.42, 0.42], [null, null],
  ])('clampBalance(%p) → %p', (score, expected) => {
    expect(clampBalance(score)).toBe(expected)
  })

  test('다른 막대 크기에도 같은 비율', () => {
    expect(balanceX(0, { width: 100, height: 10, padding: 0 })).toBe(50)
    expect(balanceX(-2, { width: 100, height: 10, padding: 0 })).toBe(0)
  })

  test('균형 좋음 구간(-1 ~ 1)', () => {
    expect(balanceZone()).toEqual({ x: 80, width: 140 })
  })

  test.each([
    [0.42, '0.42'], [-1.5, '-1.5'], [0, '0'], [null, ''],
  ])('점수 표시 %p → "%s"', (score, text) => {
    expect(formatBalanceScore(score)).toBe(text)
  })

  test('텍스트 대안(aria-label)에 점수·라벨·막대 양 끝의 뜻이 있다', () => {
    expect(balanceAriaLabel({ score: 0.42, label: 'balanced' })).toBe('CPU ↔ 그래픽카드 균형 점수 0.42, 균형 좋음. 막대는 왼쪽 끝 -2(그래픽카드가 약함)부터 가운데 0(균형 좋음), 오른쪽 끝 2(CPU 가 약함)까지입니다.')
    expect(balanceAriaLabel({ score: 1.6, label: 'cpu_bound' })).toContain('점수 1.6, CPU 가 약함.')
    expect(balanceAriaLabel(null)).toBe('')
  })
})

describe('전력 문구', () => {
  test.each([
    [{ estimated_w: 520, psu_w: 850 }, '예상 소비 전력 520W / 파워 850W'],
    [{ estimated_w: 620, psu_w: null }, '예상 소비 전력 620W / 파워 없음'],
    [{ estimated_w: 1250, psu_w: 1600 }, '예상 소비 전력 1,250W / 파워 1,600W'],
    [null, ''],
    [{ estimated_w: null, psu_w: 850 }, ''],
  ])('%j → "%s"', (power, text) => {
    expect(powerText(power)).toBe(text)
  })
})

describe('같은 부품 구성(이벤트 한 번)', () => {
  test.each([
    [[line(60, 'mainboard'), line(1, 'cpu')], '1x1,60x1'],
    [[line(1, 'cpu'), line(60, 'mainboard')], '1x1,60x1'],
    [[line(1, 'cpu'), line(60, 'mainboard', 2)], '1x1,60x2'],
    [[], ''],
  ])('%j → "%s"', (lines, key) => {
    expect(compatibilityKey(lines)).toBe(key)
  })

  test('순서가 달라도 같은 키, 수량이 다르면 다른 키', () => {
    expect(compatibilityKey([line(1, 'cpu'), line(60, 'mainboard')])).toBe(compatibilityKey([line(60, 'mainboard'), line(1, 'cpu')]))
    expect(compatibilityKey([line(1, 'cpu'), line(60, 'mainboard')])).not.toBe(compatibilityKey([line(1, 'cpu', 2), line(60, 'mainboard')]))
  })
})

describe('compatibility_check 이벤트 props(spec 이벤트 표)', () => {
  test('spec 응답 예시 → 코드는 수준별, 값은 서버 응답 그대로, product_ids 는 확인한 줄', () => {
    const items = [{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }, { product_id: 140, quantity: 2 }]
    expect(compatibilityEventProps('cart', items, specResult)).toEqual({
      context: 'cart', status: 'error', error_codes: ['SOCKET_MISMATCH'], warning_codes: ['NO_CPU_COOLER'],
      balance_score: 0.42, estimated_w: 520, psu_w: 850, product_ids: [1, 60, 140],
    })
  })

  test('균형·전력이 없으면 null, info 는 코드 목록에 넣지 않는다', () => {
    const result = { status: 'ok', issues: [missingIssue], balance: null, power: null, categories: ['cpu', 'mainboard'] }
    expect(compatibilityEventProps('quote_compose', [line(1, 'cpu'), line(60, 'mainboard')], result)).toEqual({
      context: 'quote_compose', status: 'ok', error_codes: [], warning_codes: [], balance_score: null, estimated_w: null, psu_w: null, product_ids: [1, 60],
    })
  })

  test('파워가 없으면 psu_w 만 null', () => {
    const result = { status: 'warning', issues: [psuIssue], balance: { score: -1.2, label: 'gpu_bound' }, power: { estimated_w: 400, psu_w: null } }
    expect(compatibilityEventProps('cart', [line(1, 'cpu'), line(7, 'gpu')], result)).toMatchObject({ balance_score: -1.2, estimated_w: 400, psu_w: null, warning_codes: ['PSU_TIGHT'] })
  })

  test('코드·상품 목록은 20개로 자른다', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ product_id: index + 1, quantity: 1 }))
    const issues = Array.from({ length: 25 }, (_, index) => ({ code: `CODE_${index}`, level: index % 2 ? 'warning' : 'error', message: '문구', product_ids: [] }))
    issues.push(...Array.from({ length: 25 }, (_, index) => ({ code: `WARN_${index}`, level: 'warning', message: '문구', product_ids: [] })))
    const props = compatibilityEventProps('cart', items, { status: 'error', issues, balance: null, power: null })
    expect(props.product_ids).toEqual(items.slice(0, 20).map((item) => item.product_id))
    expect(props.error_codes).toHaveLength(13)
    expect(props.warning_codes).toHaveLength(20)
  })
})
