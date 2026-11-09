// 부품 호환성 화면(spec docs/specs/2026-11-01-compatibility-rules.md "화면"·"이벤트").
// - CompatibilityPanel: 상태표(확인 중·문제 없음·주의·호환 안 됨·오류 → 다시 시도), 수준 배지 글자, 균형 막대(SVG role=img), 전력, 견적 카드 요약 펼치기
// - 장바구니(CartPage): 받은 뒤·수량 변경·삭제 뒤 확인, 카테고리 1개면 숨김, 주문하기는 어떤 상태에서도 그대로, 늦게 온 이전 응답 무시
// - 견적 게시판 상세(CommunityPostDetail): 견적 카드마다 한 번 확인(카드마다 로딩·오류·다시 시도), 견적 보내기는 0.4초 모아 다시 확인
// - compatibility_check: 장바구니·견적 보내기에서 결과를 보여 준 뒤 같은 구성은 한 번, 견적 카드에서는 보내지 않는다
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const socketIssue = { code: 'SOCKET_MISMATCH', level: 'error', message: 'CPU(AM5)와 메인보드(LGA1700)의 소켓이 다릅니다.', product_ids: [1, 60] }
const coolerIssue = { code: 'NO_CPU_COOLER', level: 'warning', message: 'CPU 에 기본 쿨러가 없어 쿨러가 따로 필요합니다.', product_ids: [1] }
const missingIssue = { code: 'MISSING_PARTS', level: 'info', message: '완성 PC 에 필요한 메모리, 파워가 없습니다.', product_ids: [] }
// spec API 계약의 응답 예시(호환 안 됨)와 상태별 결과
const errorResult = { status: 'error', issues: [socketIssue, coolerIssue], balance: { score: 0.42, label: 'balanced' }, power: { estimated_w: 520, psu_w: 850 }, categories: ['cpu', 'mainboard', 'memory'] }
const warningResult = { status: 'warning', issues: [coolerIssue, missingIssue], balance: { score: 1.6, label: 'cpu_bound' }, power: { estimated_w: 620, psu_w: null }, categories: ['cpu', 'mainboard', 'gpu'] }
const okResult = { status: 'ok', issues: [], balance: { score: 0.1, label: 'balanced' }, power: { estimated_w: 480, psu_w: 850 }, categories: ['cpu', 'gpu', 'psu'] }
const infoResult = { status: 'ok', issues: [missingIssue], balance: null, power: null, categories: ['cpu', 'mainboard'] }
const plainOkResult = { status: 'ok', issues: [], balance: null, power: null, categories: ['storage', 'case'] }
const serverError = { response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } }

const hasClass = (node, name) => String(node?.props.class || '').split(/\s+/).includes(name)
const byClass = (root, name) => find(root, (node) => hasClass(node, name))
const elements = (node) => node.children.filter((child) => !String(child.type).startsWith('#'))
const buttonNames = (root) => findAll(root, (node) => node.type === 'button').map((node) => text(node).trim())
const compatibilityEvents = (track) => track.mock.calls.filter(([type]) => type === 'compatibility_check').map(([, props]) => props)
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

describe('CompatibilityPanel', () => {
  let Panel
  beforeAll(async () => { Panel = await compileSfc('components/CompatibilityPanel.vue') })
  const render = (props) => mount(Panel, props).root

  test('확인 중: 장바구니는 제목 h2 "부품 호환성"(영역 이름) + role=status 문구', () => {
    const root = render({ state: 'loading', result: null, context: 'cart' })
    const section = find(root, (node) => node.type === 'section')
    const heading = find(root, (node) => node.type === 'h2')
    expect(text(heading)).toBe('부품 호환성')
    expect(section.props['aria-labelledby']).toBe(heading.props.id)
    expect(text(byRole(root, 'status')[0])).toBe('부품 호환성을 확인하는 중입니다...')
    expect(byRole(root, 'alert')).toHaveLength(0)
    expect(hasClass(section, 'compat--loading')).toBe(true)
  })

  test('문제 없음: 문구, 문제 목록 없음, 균형 막대(SVG role=img + aria-label + 같은 내용의 글자), 전력', () => {
    const root = render({ state: 'ready', result: okResult, context: 'cart' })
    expect(text(byRole(root, 'status')[0])).toContain('함께 쓸 수 있는 부품입니다.')
    expect(hasClass(find(root, (node) => node.type === 'section'), 'compat--ok')).toBe(true)
    expect(find(root, (node) => node.type === 'ul')).toBeNull()
    const svg = byRole(root, 'img')[0]
    expect(svg.type).toBe('svg')
    expect(svg.props.viewBox).toBe('0 0 300 24')
    expect(svg.props['aria-label']).toBe('CPU ↔ 그래픽카드 균형 점수 0.1, 균형 좋음. 막대는 왼쪽 끝 -2(그래픽카드가 약함)부터 가운데 0(균형 좋음), 오른쪽 끝 2(CPU 가 약함)까지입니다.')
    const marker = find(svg, (node) => node.type === 'circle')
    expect(marker.props.cx).toBe(157)
    expect(hasClass(marker, 'compat__marker--balanced')).toBe(true)
    const zone = byClass(svg, 'compat__zone')
    expect([zone.props.x, zone.props.width]).toEqual([80, 140])
    expect(text(byClass(root, 'compat__balance-title'))).toBe('CPU ↔ 그래픽카드 균형균형 좋음점수 0.1')
    expect(text(byClass(root, 'compat__scale'))).toBe('그래픽카드가 약함균형 좋음CPU 가 약함')
    expect(byClass(root, 'compat__scale').props['aria-hidden']).toBe('true')
    expect(text(byClass(root, 'compat__power'))).toBe('전력예상 소비 전력 480W / 파워 850W')
    expect(buttonNames(root)).toEqual([])
  })

  test('주의: "주의할 점 N개", 문제마다 수준 배지 글자와 서버 문구(순서 그대로), 파워가 없으면 "파워 없음"', () => {
    const root = render({ state: 'ready', result: warningResult, context: 'cart' })
    expect(text(byRole(root, 'status')[0])).toContain('주의할 점 1개')
    const items = findAll(root, (node) => node.type === 'li')
    expect(items.map((item) => [text(byClass(item, 'compat__badge')), text(byClass(item, 'compat__message'))])).toEqual([['주의', coolerIssue.message], ['안내', missingIssue.message]])
    expect(hasClass(byClass(items[0], 'compat__badge'), 'compat__badge--warning')).toBe(true)
    expect(hasClass(byClass(items[1], 'compat__badge'), 'compat__badge--info')).toBe(true)
    expect(text(byClass(root, 'compat__power'))).toContain('예상 소비 전력 620W / 파워 없음')
    const marker = find(root, (node) => node.type === 'circle')
    expect(marker.props.cx).toBe(262)
    expect(hasClass(marker, 'compat__marker--cpu_bound')).toBe(true)
    expect(text(byClass(root, 'compat__balance-title'))).toContain('CPU 가 약함')
  })

  test('호환 안 됨: "함께 쓸 수 없는 부품이 있습니다(N개)", 호환 안 됨 → 주의 순서', () => {
    const root = render({ state: 'ready', result: errorResult, context: 'cart' })
    expect(text(byRole(root, 'status')[0])).toContain('함께 쓸 수 없는 부품이 있습니다(1개)')
    expect(findAll(root, (node) => node.type === 'li').map((item) => text(byClass(item, 'compat__badge')))).toEqual(['호환 안 됨', '주의'])
    expect(hasClass(byClass(root, 'compat__badge'), 'compat__badge--error')).toBe(true)
    expect(hasClass(find(root, (node) => node.type === 'section'), 'compat--error')).toBe(true)
  })

  test('안내(info)만 있으면 문제 없음 문구 + 안내 배지. 균형·전력이 없으면 막대·전력 줄이 없다', () => {
    const root = render({ state: 'ready', result: infoResult, context: 'cart' })
    expect(text(byRole(root, 'status')[0])).toContain('함께 쓸 수 있는 부품입니다.')
    expect(text(byClass(root, 'compat__badge'))).toBe('안내')
    expect(byRole(root, 'img')).toHaveLength(0)
    expect(byClass(root, 'compat__power')).toBeNull()
  })

  test('오류: role=alert 문구와 "다시 시도" → retry 를 알린다', async () => {
    const onRetry = jest.fn()
    const root = render({ state: 'error', result: null, context: 'cart', onRetry })
    expect(text(byRole(root, 'alert')[0])).toContain('호환성을 확인하지 못했습니다. 다시 시도해 주세요.')
    expect(byRole(root, 'status')).toHaveLength(0)
    await click(button(root, '다시 시도'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('견적 보내기(quote_compose)는 견적 보내기(h2) 아래라 제목이 h3', () => {
    const root = render({ state: 'ready', result: errorResult, context: 'quote_compose' })
    expect(find(root, (node) => node.type === 'h2')).toBeNull()
    expect(text(find(root, (node) => node.type === 'h3'))).toBe('부품 호환성')
    expect(findAll(root, (node) => node.type === 'li')).toHaveLength(2)
  })

  test('장바구니에 넣어도 기존 버튼 이름(주문하기·결제하기·삭제·로그인 상태 다시 확인)과 겹치지 않고 상품 링크가 없다(시뮬레이터가 목록 줄을 장바구니 줄로 읽지 않는다)', () => {
    const taken = ['주문하기', '결제하기', '삭제', '로그인 상태 다시 확인']
    for (const props of [{ state: 'loading' }, { state: 'error' }, { state: 'ready', result: errorResult }, { state: 'ready', result: warningResult }]) {
      const root = render({ context: 'cart', ...props })
      expect(buttonNames(root).filter((name) => taken.some((item) => name.includes(item)))).toEqual([])
      expect(findAll(root, (node) => node.type === 'a')).toHaveLength(0)
      expect(find(root, (node) => node.type === 'aside')).toBeNull()
    }
  })

  test('견적 카드(quote_card): 제목 없이 요약 한 줄 + "호환성 자세히 보기"(aria-expanded·aria-controls), 누르면 문제 목록·균형·전력', async () => {
    const root = render({ state: 'ready', result: warningResult, context: 'quote_card' })
    expect(find(root, (node) => node.type === 'section')).toBeNull()
    expect(find(root, (node) => ['h2', 'h3'].includes(node.type))).toBeNull()
    expect(hasClass(root.children[0], 'compat--compact')).toBe(true)
    const line = byClass(root, 'compat__line')
    expect(text(line)).toContain('부품 호환성')
    expect(text(line)).toContain('주의할 점 1개')
    const toggle = button(root, '호환성 자세히 보기')
    const details = byClass(root, 'compat__details')
    expect(toggle.props.type).toBe('button')
    expect(toggle.props['aria-expanded']).toBe('false')
    expect(toggle.props['aria-controls']).toBe(details.props.id)
    expect(details.props.hidden).toBe(true)
    await click(toggle)
    const opened = button(root, '호환성 접기')
    expect(opened.props['aria-expanded']).toBe('true')
    expect(byClass(root, 'compat__details').props.hidden).toBe(false)
    expect(text(byClass(root, 'compat__details'))).toContain(coolerIssue.message)
    expect(text(byClass(root, 'compat__details'))).toContain('예상 소비 전력 620W / 파워 없음')
    await click(opened)
    expect(byClass(root, 'compat__details').props.hidden).toBe(true)
  })

  test('견적 카드(디자인의 호환성 한 줄): 상자 없이 "아이콘 글자 + 부품 호환성 · 문구"가 role=status 한 줄, 색 클래스는 상태별', () => {
    const ok = render({ state: 'ready', result: okResult, context: 'quote_card' })
    const status = byRole(ok, 'status')[0]
    expect(elements(status).map((node) => [node.props.class || '', text(node)])).toEqual([
      ['compat__icon', '✓'], ['compat__label', '부품 호환성'], ['', '함께 쓸 수 있는 부품입니다.'],
    ])
    expect(byClass(ok, 'compat__icon').props['aria-hidden']).toBe('true')
    expect(hasClass(ok.children[0], 'compat--ok')).toBe(true)
    const failed = render({ state: 'ready', result: errorResult, context: 'quote_card' })
    expect(text(byClass(failed, 'compat__icon'))).toBe('✕')
    expect(hasClass(failed.children[0], 'compat--error')).toBe(true)
    // 장바구니(전체 영역)에는 줄 안 이름이 없다(제목 h2 가 이름)
    expect(byClass(render({ state: 'ready', result: okResult, context: 'cart' }), 'compat__label')).toBeNull()
  })

  test('견적 카드: 확인 중(role=status)·오류(그 카드만 다시 시도)·펼칠 내용이 없으면 버튼 없음', async () => {
    expect(text(byRole(render({ state: 'loading', context: 'quote_card' }), 'status')[0])).toBe('부품 호환성부품 호환성을 확인하는 중입니다...')
    const onRetry = jest.fn()
    const failed = render({ state: 'error', context: 'quote_card', onRetry })
    expect(text(byRole(failed, 'alert')[0])).toContain('호환성을 확인하지 못했습니다. 다시 시도해 주세요.')
    await click(button(failed, '다시 시도'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    const plain = render({ state: 'ready', result: plainOkResult, context: 'quote_card' })
    expect(text(plain)).toContain('함께 쓸 수 있는 부품입니다.')
    expect(buttonNames(plain)).toEqual([])
    expect(byClass(plain, 'compat__details')).toBeNull()
  })
})

describe('장바구니의 부품 호환성(CartPage)', () => {
  const fetchCart = jest.fn()
  const updateCartItem = jest.fn()
  const removeCartItem = jest.fn()
  const checkCompatibility = jest.fn()
  const track = jest.fn()
  let CartPage
  const cpu = { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 1, subtotal_krw: 739000 }
  const board = { product_id: 60, name: 'TUF Gaming B650-PLUS WIFI', brand: 'ASUS', category: 'mainboard', thumbnail_url: '', price_krw: 289000, stock: 8, quantity: 1, subtotal_krw: 289000 }
  const memory = { product_id: 140, name: 'DDR5-5600 16GB', brand: '삼성전자', category: 'memory', thumbnail_url: '', price_krw: 69000, stock: 30, quantity: 2, subtotal_krw: 138000 }
  const otherCpu = { ...cpu, product_id: 2, name: '코어 울트라7 265K', brand: 'Intel', price_krw: 519000, subtotal_krw: 519000 }
  const cartOf = (items) => ({ items, item_count: items.reduce((sum, item) => sum + item.quantity, 0), total_krw: items.reduce((sum, item) => sum + item.subtotal_krw, 0) })
  const panel = (page) => stub(page.root, 'CompatibilityPanel')
  const orderControl = (page) => find(page.root, (node) => ['a', 'button'].includes(node.type) && text(node) === '주문하기')
  const quantitySelect = (page, id) => find(page.root, (node) => node.props['data-stub'] === 'ProductQuantitySelect' && node.props.id === `cart-quantity-${id}`).props
  const removeButton = (page, item) => find(page.root, (node) => node.type === 'button' && text(node).includes(`: ${item.name}`))

  beforeAll(async () => { CartPage = await compileSfc('views/CartPage.vue', { fetchCart, updateCartItem, removeCartItem, checkCompatibility, track }) })
  beforeEach(() => { for (const mock of [fetchCart, updateCartItem, removeCartItem, checkCompatibility, track]) mock.mockReset() })

  test('장바구니를 받은 뒤 확인: 확인 중 → 문제 없음. 상품 목록 바로 아래, 요청은 product_id·quantity, 주문하기는 그대로', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, board, memory]))
    const response = deferred()
    checkCompatibility.mockReturnValue(response.promise)
    const page = mount(CartPage)
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(1)
    expect(checkCompatibility).toHaveBeenCalledWith([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }, { product_id: 140, quantity: 2 }])
    expect(panel(page).props).toMatchObject({ state: 'loading', result: null, context: 'cart' })
    expect(elements(byClass(page.root, 'cart-list')).map((node) => node.props['data-stub'] || node.props.class)).toEqual(['cart-items', 'CompatibilityPanel'])
    expect(orderControl(page).type).toBe('a')
    response.resolve(okResult)
    await flush()
    expect(panel(page).props).toMatchObject({ state: 'ready', result: okResult, context: 'cart' })
    expect(orderControl(page).type).toBe('a')
    expect(orderControl(page).props.href).toBe('/checkout')
  })

  test.each([
    ['주의', warningResult],
    ['호환 안 됨', errorResult],
  ])('%s 결과도 그대로 넘기고 주문하기 링크는 그대로(결제는 막지 않는다)', async (_name, result) => {
    fetchCart.mockResolvedValue(cartOf([cpu, board, memory]))
    checkCompatibility.mockResolvedValue(result)
    const page = mount(CartPage)
    await flush()
    expect(panel(page).props).toMatchObject({ state: 'ready', result })
    expect(orderControl(page).type).toBe('a')
    expect(orderControl(page).props.href).toBe('/checkout')
  })

  test('확인 실패(500)면 영역만 오류, 장바구니 본문·주문하기는 그대로, 다시 시도하면 다시 확인한다', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, board]))
    checkCompatibility.mockRejectedValueOnce(serverError).mockResolvedValue(okResult)
    const page = mount(CartPage)
    await flush()
    expect(panel(page).props.state).toBe('error')
    expect(text(page.root)).toContain(cpu.name)
    expect(text(page.root)).toContain('총 결제 금액')
    expect(text(page.root)).toContain('1,028,000원')
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(orderControl(page).type).toBe('a')
    expect(compatibilityEvents(track)).toEqual([])
    await panel(page).props.onRetry()
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(panel(page).props).toMatchObject({ state: 'ready', result: okResult })
    expect(compatibilityEvents(track)).toHaveLength(1)
  })

  test.each([
    ['부품 1개', [cpu]],
    ['같은 카테고리 2개', [cpu, otherCpu]],
    ['같은 상품 수량 2', [{ ...cpu, quantity: 2, subtotal_krw: 1478000 }]],
  ])('카테고리가 1개뿐이면(%s) 확인하지 않고 영역을 보여 주지 않는다', async (_name, items) => {
    fetchCart.mockResolvedValue(cartOf(items))
    const page = mount(CartPage)
    await flush()
    expect(checkCompatibility).not.toHaveBeenCalled()
    expect(panel(page)).toBeNull()
    expect(orderControl(page).type).toBe('a')
    expect(compatibilityEvents(track)).toEqual([])
  })

  test('비어 있거나 비로그인이면 확인하지 않는다', async () => {
    fetchCart.mockResolvedValueOnce(cartOf([])).mockRejectedValueOnce({ response: { status: 401 } })
    const empty = mount(CartPage)
    await flush()
    const guest = mount(CartPage)
    await flush()
    expect(checkCompatibility).not.toHaveBeenCalled()
    expect(panel(empty)).toBeNull()
    expect(panel(guest)).toBeNull()
  })

  test('수량을 바꾸면 바뀐 수량으로 다시 확인하고, 늦게 온 이전 응답은 무시한다', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, memory]))
    const first = deferred()
    const second = deferred()
    checkCompatibility.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    updateCartItem.mockResolvedValue(cartOf([cpu, { ...memory, quantity: 4, subtotal_krw: 276000 }]))
    const page = mount(CartPage)
    await flush()
    await quantitySelect(page, 140)['onUpdate:modelValue'](4)
    await flush()
    expect(updateCartItem).toHaveBeenCalledWith(140, { quantity: 4 })
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(checkCompatibility).toHaveBeenLastCalledWith([{ product_id: 1, quantity: 1 }, { product_id: 140, quantity: 4 }])
    expect(panel(page).props.state).toBe('loading')
    second.resolve(errorResult)
    await flush()
    expect(panel(page).props).toMatchObject({ state: 'ready', result: errorResult })
    first.resolve(okResult)
    await flush()
    expect(panel(page).props.result).toEqual(errorResult)
    expect(compatibilityEvents(track)).toEqual([expect.objectContaining({ context: 'cart', status: 'error', product_ids: [1, 140] })])
  })

  test('수량 변경이 실패하면 다시 확인하지 않는다(장바구니가 그대로)', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, memory]))
    checkCompatibility.mockResolvedValue(okResult)
    updateCartItem.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족합니다.' } } })
    const page = mount(CartPage)
    await flush()
    await quantitySelect(page, 140)['onUpdate:modelValue'](9)
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(1)
    expect(panel(page).props).toMatchObject({ state: 'ready', result: okResult })
  })

  test('삭제해서 카테고리가 1개가 되면 영역을 숨기고, 진행 중이던 확인 결과는 버린다', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, memory]))
    const pending = deferred()
    checkCompatibility.mockReturnValueOnce(pending.promise)
    removeCartItem.mockResolvedValue(cartOf([cpu]))
    const page = mount(CartPage)
    await flush()
    expect(panel(page).props.state).toBe('loading')
    await click(removeButton(page, memory))
    expect(removeCartItem).toHaveBeenCalledWith(140)
    expect(panel(page)).toBeNull()
    pending.resolve(errorResult)
    await flush()
    expect(panel(page)).toBeNull()
    expect(checkCompatibility).toHaveBeenCalledTimes(1)
    expect(compatibilityEvents(track)).toEqual([])
  })

  test('compatibility_check: 결과를 보여 준 뒤 계약대로 한 번, 같은 구성은 다시 남기지 않고, 구성이 바뀌면 한 번 더, 실패하면 남기지 않는다', async () => {
    fetchCart.mockResolvedValue(cartOf([cpu, board, memory]))
    checkCompatibility.mockResolvedValue(errorResult)
    const page = mount(CartPage)
    await flush()
    expect(compatibilityEvents(track)).toEqual([{
      context: 'cart', status: 'error', error_codes: ['SOCKET_MISMATCH'], warning_codes: ['NO_CPU_COOLER'], balance_score: 0.42, estimated_w: 520, psu_w: 850, product_ids: [1, 60, 140],
    }])
    const types = track.mock.calls.map(([type]) => type)
    expect(types.indexOf('cart_view')).toBeLessThan(types.indexOf('compatibility_check'))
    await panel(page).props.onRetry()
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(compatibilityEvents(track)).toHaveLength(1)
    updateCartItem.mockResolvedValueOnce(cartOf([cpu, board, { ...memory, quantity: 1, subtotal_krw: 69000 }]))
    await quantitySelect(page, 140)['onUpdate:modelValue'](1)
    await flush()
    expect(compatibilityEvents(track)).toHaveLength(2)
    checkCompatibility.mockRejectedValueOnce(serverError)
    updateCartItem.mockResolvedValueOnce(cartOf([cpu, board, { ...memory, quantity: 3, subtotal_krw: 207000 }]))
    await quantitySelect(page, 140)['onUpdate:modelValue'](3)
    await flush()
    expect(panel(page).props.state).toBe('error')
    expect(compatibilityEvents(track)).toHaveLength(2)
  })
})

describe('견적 게시판 상세의 부품 호환성(CommunityPostDetail)', () => {
  const fetchCurrentUser = jest.fn()
  const fetchCommunityPost = jest.fn()
  const createCommunityComment = jest.fn()
  const updateCommunityComment = jest.fn()
  const deleteCommunityComment = jest.fn()
  const deleteCommunityPost = jest.fn()
  const fetchProducts = jest.fn()
  const goToCommunityBoard = jest.fn()
  const checkCompatibility = jest.fn()
  const track = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  const mocks = [fetchCurrentUser, fetchCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, deleteCommunityPost, fetchProducts, goToCommunityBoard, checkCompatibility, track]
  // 테스트에서는 0.4초 대신 짧게 모은다(화면이 import 한 상수를 바꿔 넣는다)
  const DEBOUNCE = 50
  const settle = async () => { await wait(DEBOUNCE * 3); await flush() }
  const CREATED = '2026-11-01T03:00:00Z'
  const part = (productId, category, quantity = 1) => ({ product_id: productId, name: `부품 ${productId}`, brand: 'MOA', category, thumbnail_url: '', price_krw: 100000, stock: 5, quantity, line_total_krw: 100000 * quantity })
  const line = (productId, category, quantity = 1) => ({ product_id: productId, name: `부품 ${productId}`, brand: 'MOA', category, thumbnail_url: '', price_krw: 100000, stock: 5, quantity })
  const comment = (id, extra = {}) => ({
    id, post_id: 3, author: { id: `user:${id}`, name: `회원${id}` }, content: `댓글 ${id}`, is_owner: false, created_at: CREATED, updated_at: CREATED,
    items: [], items_total_krw: 0, budget_gap_krw: null, ...extra,
  })
  const quote = (id, items, extra = {}) => comment(id, { items, items_total_krw: items.reduce((sum, item) => sum + item.line_total_krw, 0), budget_gap_krw: -100000, ...extra })
  const detail = (comments) => ({
    id: 3, board: 'build', title: '150만 원 게임용 견적 부탁드립니다', content: '배그를 QHD 로 즐기고 싶습니다.', author: { id: 'user:7', name: '민지' },
    budget_krw: 1500000, purpose: 'gaming', is_owner: false, created_at: CREATED, updated_at: CREATED, comments,
  })
  let Detail

  beforeAll(async () => {
    Detail = await compileSfc('views/CommunityPostDetail.vue', {
      authSession, fetchCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, deleteCommunityPost, fetchProducts, goToCommunityBoard,
      checkCompatibility, track, COMPATIBILITY_DEBOUNCE_MS: DEBOUNCE,
    })
  })
  beforeEach(() => {
    for (const mock of mocks) mock.mockReset()
    fetchCurrentUser.mockResolvedValue({ id: 11, name: '회원11' })
    authSession.reset()
  })
  async function open() {
    const view = mount(Detail, { postId: 3 })
    await flush()
    return view
  }
  const quotesSection = (root) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === 'quotes-title')
  const quoteCards = (root) => findAll(quotesSection(root), (node) => node.type === 'li' && node.props.class === 'cm-quote')
  const cardPanel = (root, index) => stub(quoteCards(root)[index], 'CompatibilityPanel')
  const newForm = (root) => find(root, (node) => node.type === 'form' && Boolean(find(node, (child) => child.props.id === 'comment-content')))
  const composePanel = (root) => stub(newForm(root), 'CompatibilityPanel')
  async function pick(root, lines) {
    stub(newForm(root), 'CommunityPartsPicker').props['onUpdate:modelValue'](lines)
    await flush()
  }

  test('받은 견적 카드마다 본문을 받은 뒤 한 번 확인: 카드마다 확인 중 → 결과, 부품 표 바로 위, 카테고리 1개뿐인 견적·댓글은 확인하지 않는다', async () => {
    const first = deferred()
    const second = deferred()
    checkCompatibility.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    fetchCommunityPost.mockResolvedValue(detail([
      quote(10, [part(1, 'cpu'), part(60, 'mainboard')]), comment(11), quote(12, [part(7, 'gpu'), part(200, 'psu')]), quote(13, [part(1, 'cpu'), part(2, 'cpu')]),
    ]))
    const view = await open()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(checkCompatibility.mock.calls.map(([items]) => items)).toEqual([
      [{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }],
      [{ product_id: 7, quantity: 1 }, { product_id: 200, quantity: 1 }],
    ])
    expect(quoteCards(view.root)).toHaveLength(3)
    expect(cardPanel(view.root, 0).props).toMatchObject({ state: 'loading', result: null, context: 'quote_card' })
    expect(cardPanel(view.root, 1).props.state).toBe('loading')
    expect(cardPanel(view.root, 2)).toBeNull()
    const order = elements(quoteCards(view.root)[0]).map((node) => node.props['data-stub'] || node.props.class)
    expect(order.slice(0, 4)).toEqual(['cm-quote__head', 'cm-quote__summary', 'cm-quote__compat', 'CommunityPartsTable'])
    expect(stub(byClass(quoteCards(view.root)[0], 'cm-quote__compat'), 'CompatibilityPanel')).not.toBeNull()
    second.resolve(warningResult)
    await flush()
    expect(cardPanel(view.root, 1).props).toMatchObject({ state: 'ready', result: warningResult })
    expect(cardPanel(view.root, 0).props.state).toBe('loading')
    first.resolve(okResult)
    await flush()
    expect(cardPanel(view.root, 0).props).toMatchObject({ state: 'ready', result: okResult })
    // 남이 보낸 견적을 보는 것이라 compatibility_check 를 남기지 않는다(글 상세의 community_post_view 는 2026-11-01 event-enrichment 에서 추가)
    expect(compatibilityEvents(track)).toEqual([])
  })

  test('견적 카드 확인이 실패하면 그 카드만 오류(본문·부품 표는 그대로), 다시 시도하면 그 카드만 다시 확인한다', async () => {
    checkCompatibility.mockRejectedValueOnce(serverError).mockResolvedValueOnce(okResult).mockResolvedValue(errorResult)
    fetchCommunityPost.mockResolvedValue(detail([quote(10, [part(1, 'cpu'), part(60, 'mainboard')]), quote(12, [part(7, 'gpu'), part(200, 'psu')])]))
    const view = await open()
    expect(cardPanel(view.root, 0).props.state).toBe('error')
    expect(cardPanel(view.root, 1).props).toMatchObject({ state: 'ready', result: okResult })
    expect(text(view.root)).toContain('150만 원 게임용 견적 부탁드립니다')
    expect(stub(quoteCards(view.root)[0], 'CommunityPartsTable')).not.toBeNull()
    await cardPanel(view.root, 0).props.onRetry()
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(3)
    expect(checkCompatibility).toHaveBeenLastCalledWith([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }])
    expect(cardPanel(view.root, 0).props).toMatchObject({ state: 'ready', result: errorResult })
    expect(cardPanel(view.root, 1).props.result).toEqual(okResult)
    expect(compatibilityEvents(track)).toEqual([])
  })

  test('비로그인이어도 받은 견적 카드는 확인한다(견적 보내기 폼만 없다)', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    checkCompatibility.mockResolvedValue(warningResult)
    fetchCommunityPost.mockResolvedValue(detail([quote(10, [part(1, 'cpu'), part(60, 'mainboard')])]))
    const view = await open()
    expect(newForm(view.root)).toBeNull()
    expect(cardPanel(view.root, 0).props).toMatchObject({ state: 'ready', result: warningResult, context: 'quote_card' })
  })

  test('견적 보내기: 카테고리 2개부터 0.4초 모아 한 번 확인하고 고른 부품 표 아래에 보여 준다. 이벤트는 같은 구성에서 한 번', async () => {
    checkCompatibility.mockResolvedValue(warningResult)
    fetchCommunityPost.mockResolvedValue(detail([comment(11)]))
    const view = await open()
    await pick(view.root, [line(1, 'cpu')])
    expect(composePanel(view.root)).toBeNull()
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard')])
    expect(composePanel(view.root).props).toMatchObject({ state: 'loading', result: null, context: 'quote_compose' })
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard'), line(140, 'memory', 2)])
    expect(checkCompatibility).not.toHaveBeenCalled()
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(1)
    expect(checkCompatibility).toHaveBeenCalledWith([{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }, { product_id: 140, quantity: 2 }])
    expect(composePanel(view.root).props).toMatchObject({ state: 'ready', result: warningResult })
    const fieldsetNode = find(newForm(view.root), (node) => node.type === 'fieldset')
    expect(elements(fieldsetNode).map((node) => node.props['data-stub'] || node.type)).toEqual(['CommunityPartsPicker', 'CompatibilityPanel', 'div'])
    expect(compatibilityEvents(track)).toEqual([{
      context: 'quote_compose', status: 'warning', error_codes: [], warning_codes: ['NO_CPU_COOLER'], balance_score: 1.6, estimated_w: 620, psu_w: null, product_ids: [1, 60, 140],
    }])
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard')])
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(compatibilityEvents(track)).toHaveLength(2)
    // 앞에서 확인한 구성으로 돌아오면 다시 확인하지만 이벤트는 다시 남기지 않는다
    await pick(view.root, [line(140, 'memory', 2), line(1, 'cpu'), line(60, 'mainboard')])
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(3)
    expect(compatibilityEvents(track)).toHaveLength(2)
    await pick(view.root, [line(1, 'cpu')])
    expect(composePanel(view.root)).toBeNull()
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(3)
  })

  test('견적 보내기: 늦게 온 이전 응답은 무시하고, 모으는 동안 끝난 이전 확인도 버린다', async () => {
    fetchCommunityPost.mockResolvedValue(detail([]))
    const first = deferred()
    const second = deferred()
    checkCompatibility.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = await open()
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard')])
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(1)
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard'), line(7, 'gpu')])
    first.resolve(okResult)
    await flush()
    expect(composePanel(view.root).props.state).toBe('loading')
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    second.resolve(errorResult)
    await flush()
    expect(composePanel(view.root).props).toMatchObject({ state: 'ready', result: errorResult })
    expect(compatibilityEvents(track)).toEqual([expect.objectContaining({ context: 'quote_compose', status: 'error', product_ids: [1, 60, 7] })])
  })

  test('견적 보내기: 확인 실패면 오류(이벤트 없음), 다시 시도는 기다리지 않고 바로 확인한다', async () => {
    fetchCommunityPost.mockResolvedValue(detail([]))
    checkCompatibility.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' }).mockResolvedValue(okResult)
    const view = await open()
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard')])
    await settle()
    expect(composePanel(view.root).props.state).toBe('error')
    expect(compatibilityEvents(track)).toEqual([])
    await composePanel(view.root).props.onRetry()
    await flush()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(composePanel(view.root).props).toMatchObject({ state: 'ready', result: okResult })
    expect(compatibilityEvents(track)).toHaveLength(1)
  })

  test('견적을 보내면 고른 부품이 비워져 영역을 숨기고, 새 견적 카드를 확인한다(카드는 이벤트 없음)', async () => {
    fetchCommunityPost.mockResolvedValue(detail([]))
    checkCompatibility.mockResolvedValue(okResult)
    createCommunityComment.mockResolvedValue(quote(20, [part(1, 'cpu'), part(60, 'mainboard')], { is_owner: true, author: { id: 'user:11', name: '회원11' } }))
    const view = await open()
    await pick(view.root, [line(1, 'cpu'), line(60, 'mainboard')])
    await settle()
    expect(compatibilityEvents(track)).toHaveLength(1)
    await setValue(byId(view.root, 'comment-content'), '게임용으로 무난합니다')
    await submit(newForm(view.root))
    expect(createCommunityComment).toHaveBeenCalledWith(3, { content: '게임용으로 무난합니다', items: [{ product_id: 1, quantity: 1 }, { product_id: 60, quantity: 1 }] })
    expect(composePanel(view.root)).toBeNull()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(cardPanel(view.root, 0).props).toMatchObject({ state: 'ready', result: okResult, context: 'quote_card' })
    await settle()
    expect(checkCompatibility).toHaveBeenCalledTimes(2)
    expect(compatibilityEvents(track)).toHaveLength(1)
  })
})
