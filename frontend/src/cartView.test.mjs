// 장바구니 화면(views/CartPage.vue)의 상태별 렌더링과 수량 변경(−/+·선택)·삭제, 담은 뒤 가격 변동 줄, 요약(타몰 최저가 대비·견적 의견 받기),
// 장바구니 응답마다 헤더 수량(siteStatus.setCartCount).
import { jest } from '@jest/globals'
import { button, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, stub, text } from './testing/sfc.mjs'

const fetchCart = jest.fn()
const updateCartItem = jest.fn()
const removeCartItem = jest.fn()
const checkCompatibility = jest.fn()
const siteStatus = { setCartCount: jest.fn(), showToast: jest.fn() }
let CartPage

const gpu = { product_id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }
const ssd = { product_id: 5, name: '990 PRO 1TB', brand: '삼성전자', category: 'storage', thumbnail_url: '', price_krw: 189000, stock: 30, quantity: 1, subtotal_krw: 189000 }
const cartOf = (items, itemCount, total) => ({ items, item_count: itemCount, total_krw: total })
const fullCart = cartOf([gpu, ssd], 3, 1987000)

const quantitySelect = (page, id) => find(page.root, (node) => node.props['data-stub'] === 'ProductQuantitySelect' && node.props.id === `cart-quantity-${id}`).props
const orderControl = (page) => find(page.root, (node) => ['a', 'button'].includes(node.type) && text(node) === '주문하기')
const rowOf = (page, id) => find(page.root, (node) => node.type === 'li' && node.props.class === 'cart-item' && find(node, (child) => child.type === 'a' && child.props.href === `/products/${id}`))
const stepButton = (page, name, direction) => find(page.root, (node) => node.type === 'button' && node.props['aria-label'] === `수량 ${direction}: ${name}`)
const byClass = (root, name) => find(root, (node) => String(node.props.class || '').split(/\s+/).includes(name))

beforeAll(async () => { CartPage = await compileSfc('views/CartPage.vue', { fetchCart, updateCartItem, removeCartItem, checkCompatibility, siteStatus }) })
beforeEach(() => {
  fetchCart.mockReset(); updateCartItem.mockReset(); removeCartItem.mockReset()
  siteStatus.setCartCount.mockReset(); siteStatus.showToast.mockReset()
  // 부품 호환성(보조 영역)은 src/compatibilityView.test.mjs 에서 확인한다. 여기서는 실제 API 대신 가짜 결과만 넣는다
  checkCompatibility.mockReset().mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: ['gpu', 'storage'] })
})

test('로딩 → 상품 행·소계·총액(서버 값)과 주문하기 링크, 헤더 수량은 item_count', async () => {
  const response = deferred()
  fetchCart.mockReturnValue(response.promise)
  const page = mount(CartPage)
  await flush()
  expect(text(byRole(page.root, 'status')[0])).toBe('장바구니를 불러오는 중입니다...')
  expect(text(page.root)).toContain('담은 뒤 가격이 바뀌면 알려드려요. 결제 금액은 지금 가격 기준이에요.')
  expect(siteStatus.setCartCount).not.toHaveBeenCalled()
  response.resolve(fullCart)
  await flush()
  const content = text(page.root)
  expect(content).toContain('그래픽카드 · MSI')
  expect(content).toContain(gpu.name)
  expect(content).toContain('개당 899,000원')
  expect(content).toContain('1,798,000원')
  expect(content).toContain('3개')
  expect(content).toContain('1,987,000원')
  expect(siteStatus.setCartCount).toHaveBeenCalledWith(3)
  // 요약: 결제 금액 · 상품 N개 · 배송비 무료 · 총 결제 금액, 타몰 대비 값이 없으면 그 줄은 없다
  const summary = find(page.root, (node) => node.type === 'aside')
  expect(text(find(summary, (node) => node.type === 'h2'))).toBe('결제 금액')
  expect(findAll(summary, (node) => node.type === 'dt').map(text)).toEqual(['상품 3개', '배송비', '총 결제 금액'])
  expect(findAll(summary, (node) => node.type === 'dd').map(text)).toEqual(['1,987,000원', '무료', '1,987,000원'])
  expect(link(summary, '이 구성으로 견적 의견 받기').props.href).toBe('/community/build/new?from=cart')
  expect(text(summary)).toContain('장바구니에 담긴 부품 가격은 매일 자정 갱신돼요. 내려가면 알림을 보내드립니다.')
  // 담을 때 가격을 모르는 줄(added_price_krw 없음)은 변동 줄이 없다
  expect(byClass(rowOf(page, 3), 'cart-item__change')).toBeNull()
  expect(link(page.root, gpu.name).props.href).toBe('/products/3')
  expect(quantitySelect(page, 3)).toMatchObject({ 'model-value': 2, max: 7, label: `${gpu.name} 수량`, disabled: false })
  expect(orderControl(page).type).toBe('a')
  expect(orderControl(page).props.href).toBe('/checkout')
  expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('cart')
})

test('비어 있으면 안내와 상품 보러 가기 링크, 헤더 수량 0', async () => {
  fetchCart.mockResolvedValue(cartOf([], 0, 0))
  const page = mount(CartPage)
  await flush()
  expect(text(page.root)).toContain('장바구니가 비어 있어요.')
  expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
  expect(orderControl(page)).toBeNull()
  expect(link(page.root, '이 구성으로 견적 의견 받기')).toBeNull()
  expect(siteStatus.setCartCount).toHaveBeenCalledWith(0)
})

test('비로그인(401)이면 로그인 안내, 로그인 링크, 다시 확인 버튼', async () => {
  fetchCart.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Authentication required.' } } }).mockResolvedValue(fullCart)
  const page = mount(CartPage)
  await flush()
  expect(text(page.root)).toContain('로그인 후 이용할 수 있습니다.')
  expect(link(page.root, '로그인').props.href).toBe('/login')
  expect(byRole(page.root, 'alert')).toHaveLength(0)
  expect(siteStatus.setCartCount).not.toHaveBeenCalled()
  await click(button(page.root, '로그인 상태 다시 확인'))
  expect(fetchCart).toHaveBeenCalledTimes(2)
  expect(text(page.root)).toContain(gpu.name)
})

test('서버 오류면 오류와 다시 시도', async () => {
  fetchCart.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue(cartOf([], 0, 0))
  const page = mount(CartPage)
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toContain('장바구니를 불러오지 못했습니다. 다시 시도해 주세요.')
  await click(button(page.root, '다시 시도'))
  expect(fetchCart).toHaveBeenCalledTimes(2)
  expect(text(page.root)).toContain('장바구니가 비어 있어요.')
})

test('수량을 바꾸면 PATCH 하고, 응답 전에는 모든 조작을 막고 진행 문구를 보여 주며, 응답의 금액으로 바꾼다', async () => {
  fetchCart.mockResolvedValue(fullCart)
  const response = deferred()
  updateCartItem.mockReturnValue(response.promise)
  const page = mount(CartPage)
  await flush()
  quantitySelect(page, 3)['onUpdate:modelValue'](3)
  await flush()
  expect(updateCartItem).toHaveBeenCalledWith(3, { quantity: 3 })
  expect(quantitySelect(page, 3)).toMatchObject({ 'model-value': 3, disabled: true })
  expect(quantitySelect(page, 5).disabled).toBe(true)
  expect(text(byRole(page.root, 'status')[0])).toBe('수량을 바꾸는 중입니다...')
  expect(orderControl(page).type).toBe('button')
  expect(orderControl(page).props.disabled).toBe('')
  // 진행 중에는 다른 변경을 보내지 않는다
  quantitySelect(page, 5)['onUpdate:modelValue'](2)
  findAll(page.root, (node) => node.type === 'button' && text(node).startsWith('삭제'))[1].props.onClick()
  expect(updateCartItem).toHaveBeenCalledTimes(1)
  expect(removeCartItem).not.toHaveBeenCalled()
  response.resolve(cartOf([{ ...gpu, quantity: 3, subtotal_krw: 2697000 }, ssd], 4, 2886000))
  await flush()
  expect(quantitySelect(page, 3)).toMatchObject({ 'model-value': 3, disabled: false })
  expect(text(page.root)).toContain('2,697,000원')
  expect(text(page.root)).toContain('2,886,000원')
  expect(orderControl(page).type).toBe('a')
  expect(siteStatus.setCartCount).toHaveBeenLastCalledWith(4)
})

test('같은 수량을 고르면 보내지 않는다', async () => {
  fetchCart.mockResolvedValue(fullCart)
  const page = mount(CartPage)
  await flush()
  quantitySelect(page, 3)['onUpdate:modelValue'](2)
  await flush()
  expect(updateCartItem).not.toHaveBeenCalled()
})

test('재고 부족(409)이면 서버 message 를 보여 주고 원래 수량으로 되돌린다', async () => {
  fetchCart.mockResolvedValue(fullCart)
  updateCartItem.mockRejectedValue({ response: { status: 409, data: { message: "'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다. 최대 7개까지 주문할 수 있습니다." } } })
  const page = mount(CartPage)
  await flush()
  quantitySelect(page, 3)['onUpdate:modelValue'](9)
  await flush()
  expect(text(byRole(page.root, 'alert')[0])).toContain("'지포스 RTX 4070 SUPER 12GB' 상품의 재고가 부족합니다. 최대 7개까지 주문할 수 있습니다.")
  expect(quantitySelect(page, 3)).toMatchObject({ 'model-value': 2, disabled: false })
  expect(text(page.root)).toContain('1,798,000원')
})

test('삭제하면 DELETE 하고 진행 중에는 삭제 중... 을 보여 주며, 마지막 상품이면 빈 장바구니가 된다', async () => {
  fetchCart.mockResolvedValue(cartOf([gpu], 2, 1798000))
  const response = deferred()
  removeCartItem.mockReturnValue(response.promise)
  const page = mount(CartPage)
  await flush()
  button(page.root, '삭제').props.onClick() // 응답을 붙잡아 두었으므로 기다리지 않는다
  await flush()
  expect(removeCartItem).toHaveBeenCalledWith(3)
  expect(button(page.root, '삭제 중...').props.disabled).toBe(true)
  response.resolve(cartOf([], 0, 0))
  await flush()
  expect(text(page.root)).toContain('장바구니가 비어 있어요.')
  expect(siteStatus.setCartCount).toHaveBeenLastCalledWith(0)
})

test('이미 없는 상품(404)이면 문구를 보여 주고 장바구니를 다시 불러온다', async () => {
  fetchCart.mockResolvedValueOnce(fullCart).mockResolvedValueOnce(cartOf([ssd], 1, 189000))
  removeCartItem.mockRejectedValue({ response: { status: 404, data: { message: '장바구니에 없는 상품입니다.' } } })
  const page = mount(CartPage)
  await flush()
  await click(button(page.root, '삭제'))
  expect(fetchCart).toHaveBeenCalledTimes(2)
  expect(text(byRole(page.root, 'alert')[0])).toContain('장바구니에 없는 상품입니다.')
  expect(text(page.root)).not.toContain(gpu.name)
})

test('변경 중 로그인이 만료되면(401) 새 탭 로그인 링크를 준다', async () => {
  fetchCart.mockResolvedValue(fullCart)
  removeCartItem.mockRejectedValue({ response: { status: 401 } })
  const page = mount(CartPage)
  await flush()
  await click(button(page.root, '삭제'))
  expect(text(byRole(page.root, 'alert')[0])).toContain('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
  expect(link(page.root, '새 탭에서 다시 로그인').props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
})

test('품절이거나 재고보다 많이 담은 상품이 있으면 경고하고 주문하기를 막는다', async () => {
  fetchCart.mockResolvedValue(cartOf([{ ...gpu, stock: 1 }, { ...ssd, stock: 0 }], 3, 1987000))
  const page = mount(CartPage)
  await flush()
  expect(text(page.root)).toContain('재고가 1개 남았습니다. 수량을 줄여 주세요.')
  expect(text(page.root)).toContain('품절된 상품입니다. 삭제한 뒤 주문해 주세요.')
  expect(quantitySelect(page, 3).max).toBe(1)
  expect(orderControl(page).type).toBe('button')
  expect(orderControl(page).props.disabled).toBe('')
  expect(text(page.root)).toContain('정리하면 주문할 수 있습니다.')
})

describe('견적에서 담은 줄(spec 2026-11-01-build-id-purpose)', () => {
  const BUILD_ID = '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7'
  const rows = (page) => findAll(page.root, (node) => node.type === 'li' && node.props.class === 'cart-item')
  const buildMark = (row) => find(row, (node) => node.props.class === 'cart-item__build')

  test('build 가 있는 줄에 "견적에서 담음"(견적 글 링크), post_id 가 null 이면 글자만, 직접 담은 줄은 표시 없음', async () => {
    const memory = { ...ssd, product_id: 6, name: 'DDR5-5600 32GB (16GB x2)', category: 'memory', build: { id: BUILD_ID, post_id: null, comment_id: null } }
    fetchCart.mockResolvedValue(cartOf([{ ...gpu, build: { id: BUILD_ID, post_id: 3, comment_id: 10 } }, { ...ssd, build: null }, memory], 4, 2176000))
    const page = mount(CartPage)
    await flush()
    const [fromQuote, manual, noPost] = rows(page)
    const quoteLink = find(buildMark(fromQuote), (node) => node.type === 'a')
    expect(quoteLink.props.href).toBe('/community/posts/3')
    expect(text(quoteLink)).toBe('견적에서 담음 · 견적 글 보기')
    expect(buildMark(manual)).toBeNull()
    expect(text(buildMark(noPost))).toBe('견적에서 담음')
    expect(find(buildMark(noPost), (node) => node.type === 'a')).toBeNull()
  })

  test('시뮬레이터가 읽는 줄 구조는 그대로: 줄의 첫 링크 = 상품(이름이 상품 이름), 첫 글자 줄 = 카테고리 · 브랜드, "삭제" 버튼, "<상품 이름> 수량"', async () => {
    fetchCart.mockResolvedValue(cartOf([{ ...gpu, build: { id: BUILD_ID, post_id: 3, comment_id: 10 } }], 2, 1798000))
    const page = mount(CartPage)
    await flush()
    const [row] = rows(page)
    const anchors = findAll(row, (node) => node.type === 'a')
    // 사진 링크는 DOM 에서 이름·견적 링크 뒤(화면에서는 grid 로 왼쪽), 같은 상품으로 가는 중복 링크라 탭·화면 읽기에서 뺀다
    expect(anchors.map((node) => node.props.href)).toEqual(['/products/3', '/community/posts/3', '/products/3'])
    expect(text(anchors[0])).toBe(gpu.name)
    expect(anchors.filter((node) => text(node) === gpu.name)).toHaveLength(1)
    expect(anchors[2].props).toMatchObject({ class: 'cart-item__image', tabindex: '-1', 'aria-hidden': 'true' })
    expect(find(anchors[2], (node) => node.type === 'img').props.alt).toBe('')
    expect(text(find(row, (node) => node.props.class === 'cart-item__meta'))).toBe('그래픽카드 · MSI')
    expect(text(button(row, '삭제'))).toBe(`삭제: ${gpu.name}`)
    expect(quantitySelect(page, 3).label).toBe(`${gpu.name} 수량`)
  })

  test('수량을 바꾼 뒤 응답의 build 를 그대로 보여 준다(화면이 build 를 바꾸지 않는다)', async () => {
    fetchCart.mockResolvedValue(cartOf([{ ...gpu, build: { id: BUILD_ID, post_id: 3, comment_id: 10 } }], 2, 1798000))
    updateCartItem.mockResolvedValue(cartOf([{ ...gpu, quantity: 3, subtotal_krw: 2697000, build: { id: BUILD_ID, post_id: 3, comment_id: 10 } }], 3, 2697000))
    const page = mount(CartPage)
    await flush()
    await quantitySelect(page, 3)['onUpdate:modelValue'](3)
    await flush()
    expect(updateCartItem).toHaveBeenCalledWith(3, { quantity: 3 })
    expect(find(buildMark(rows(page)[0]), (node) => node.type === 'a').props.href).toBe('/community/posts/3')
  })
})

describe('담은 뒤 가격 변동·타몰 비교·요약의 타몰 최저가 대비(CONTRACT §11)', () => {
  const lineText = (page, id, name) => text(byClass(rowOf(page, id), name)).trim()

  test('줄마다 서버 price_change_krw: 내려감(초록 ▼)·오름(빨강 ▲)·같음, 담을 때 가격이 없으면 줄 없음', async () => {
    const memory = { ...ssd, product_id: 6, name: 'DDR5-5600 32GB', category: 'memory', added_price_krw: 129000, price_change_krw: 0 }
    const psu = { ...ssd, product_id: 7, name: 'FOCUS GX-850', category: 'psu', added_price_krw: null, price_change_krw: null }
    fetchCart.mockResolvedValue(cartOf([
      { ...gpu, added_price_krw: 912000, price_change_krw: -13000 },
      { ...ssd, added_price_krw: 179000, price_change_krw: 10000 },
      memory, psu,
    ], 5, 2305000))
    const page = mount(CartPage)
    await flush()
    expect(lineText(page, 3, 'cart-item__change')).toBe('▼담았을 때보다 13,000원 내려갔어요')
    expect(byClass(rowOf(page, 3), 'cart-item__change').props.class).toContain('cart-item__change--down')
    expect(lineText(page, 5, 'cart-item__change')).toBe('▲담았을 때보다 10,000원 올랐어요')
    expect(byClass(rowOf(page, 5), 'cart-item__change').props.class).toContain('cart-item__change--up')
    expect(lineText(page, 6, 'cart-item__change')).toBe('담은 뒤 가격 변동 없음')
    expect(byClass(rowOf(page, 7), 'cart-item__change')).toBeNull()
    // 화살표는 꾸밈(aria-hidden), 뜻은 글자가 전한다
    expect(find(byClass(rowOf(page, 3), 'cart-item__change'), (node) => node.props['aria-hidden'] === 'true')).not.toBeNull()
  })

  test('줄에 price_trend 가 있으면 타몰 비교 줄, 없으면 줄 없음', async () => {
    const trend = { external_lowest: { source: 'coupang', price_krw: 912000 }, store_is_lowest: true, store_gap_krw: 13000 }
    fetchCart.mockResolvedValue(cartOf([{ ...gpu, price_trend: trend }, ssd], 3, 1987000))
    const page = mount(CartPage)
    await flush()
    expect(lineText(page, 3, 'cart-item__store')).toBe('타몰 최저가보다 13,000원 저렴')
    expect(byClass(rowOf(page, 5), 'cart-item__store')).toBeNull()
  })

  test('요약의 "타몰 최저가 대비"는 서버 external_saving_krw 가 0 보다 클 때만', async () => {
    fetchCart.mockResolvedValueOnce({ ...fullCart, external_saving_krw: 25000 }).mockResolvedValueOnce({ ...fullCart, external_saving_krw: 0 })
    let page = mount(CartPage)
    await flush()
    let summary = find(page.root, (node) => node.type === 'aside')
    expect(findAll(summary, (node) => node.type === 'dt').map(text)).toEqual(['상품 3개', '배송비', '타몰 최저가 대비', '총 결제 금액'])
    expect(findAll(summary, (node) => node.type === 'dd').map(text)[2]).toBe('−25,000원')
    page = mount(CartPage)
    await flush()
    summary = find(page.root, (node) => node.type === 'aside')
    expect(text(summary)).not.toContain('타몰 최저가 대비')
  })
})

describe('수량 −/+ 버튼', () => {
  test('+ 는 한 개 늘려 PATCH 하고, 응답의 수량·금액으로 바꾼다. 진행 중에는 −/+·선택·삭제를 모두 막는다', async () => {
    fetchCart.mockResolvedValue(fullCart)
    const response = deferred()
    updateCartItem.mockReturnValue(response.promise)
    const page = mount(CartPage)
    await flush()
    expect(text(stepButton(page, gpu.name, '늘리기'))).toBe('+')
    expect(stepButton(page, gpu.name, '늘리기').props.type).toBe('button')
    stepButton(page, gpu.name, '늘리기').props.onClick()
    await flush()
    expect(updateCartItem).toHaveBeenCalledWith(3, { quantity: 3 })
    expect(quantitySelect(page, 3)).toMatchObject({ 'model-value': 3, disabled: true })
    expect(stepButton(page, gpu.name, '늘리기').props.disabled).toBe(true)
    expect(stepButton(page, gpu.name, '줄이기').props.disabled).toBe(true)
    expect(stepButton(page, ssd.name, '늘리기').props.disabled).toBe(true)
    expect(text(byRole(page.root, 'status')[0])).toBe('수량을 바꾸는 중입니다...')
    response.resolve(cartOf([{ ...gpu, quantity: 3, subtotal_krw: 2697000 }, ssd], 4, 2886000))
    await flush()
    expect(quantitySelect(page, 3)['model-value']).toBe(3)
    expect(text(page.root)).toContain('2,886,000원')
    expect(siteStatus.setCartCount).toHaveBeenLastCalledWith(4)
    expect(stepButton(page, gpu.name, '늘리기').props.disabled).toBe(false)
  })

  test('− 는 한 개 줄인다. 1개면 − 를, 재고(또는 10개)만큼 담았으면 + 를 막는다', async () => {
    fetchCart.mockResolvedValue(cartOf([gpu, { ...ssd, quantity: 1 }, { ...ssd, product_id: 8, name: 'SN850X 2TB', stock: 4, quantity: 4, subtotal_krw: 756000 }], 7, 2743000))
    updateCartItem.mockResolvedValue(cartOf([{ ...gpu, quantity: 1, subtotal_krw: 899000 }, { ...ssd, quantity: 1 }], 2, 1088000))
    const page = mount(CartPage)
    await flush()
    expect(stepButton(page, ssd.name, '줄이기').props.disabled).toBe(true)
    expect(stepButton(page, ssd.name, '늘리기').props.disabled).toBe(false)
    expect(stepButton(page, 'SN850X 2TB', '늘리기').props.disabled).toBe(true)
    expect(stepButton(page, 'SN850X 2TB', '줄이기').props.disabled).toBe(false)
    await click(stepButton(page, gpu.name, '줄이기'))
    expect(updateCartItem).toHaveBeenCalledWith(3, { quantity: 1 })
    expect(updateCartItem).toHaveBeenCalledTimes(1)
  })

  test('실패(409)하면 서버 문구를 보여 주고 원래 수량으로 되돌리며, 헤더 수량은 바꾸지 않는다', async () => {
    fetchCart.mockResolvedValue(fullCart)
    updateCartItem.mockRejectedValue({ response: { status: 409, data: { message: '재고가 부족합니다.' } } })
    const page = mount(CartPage)
    await flush()
    siteStatus.setCartCount.mockClear()
    await click(stepButton(page, gpu.name, '늘리기'))
    expect(text(byRole(page.root, 'alert')[0])).toContain('재고가 부족합니다.')
    expect(quantitySelect(page, 3)['model-value']).toBe(2)
    expect(siteStatus.setCartCount).not.toHaveBeenCalled()
  })
})
