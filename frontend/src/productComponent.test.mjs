// 쇼핑 공용 컴포넌트(src/components/Product*.vue, SiteLayout.vue)의 props 별 표시와 이벤트.
import { jest } from '@jest/globals'
import { h } from 'vue'
import { button, byId, byRole, click, compileSfc, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'
import { createSiteStatus } from './stores/siteStatus.js'

const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용' }
// CONTRACT §1 price_trend
const trend = (overrides = {}) => ({
  change_30d_pct: -5.2, lowest_1y_krw: 880000, lowest_1y_on: '2026-10-01', highest_1y_krw: 990000, average_30d_krw: 920000,
  is_lowest_1y: false, lowest_gap_pct: 2.2, sparkline_30d: [948000, 930000, 899000],
  external_lowest: { source: 'coupang', price_krw: 905000 }, store_is_lowest: true, store_gap_krw: 6000, ...overrides,
})
const byClass = (root, name) => find(root, (node) => String(node.props.class || '').split(' ').includes(name))

describe('ProductCard', () => {
  let ProductCard
  beforeAll(async () => { ProductCard = await compileSfc('components/ProductCard.vue') })

  test('카드 전체가 상세 링크이고 브랜드 · 카테고리·이름(h3)·가격을 보여 준다. 재고가 넉넉하면 재고 문구는 없다', () => {
    const card = mount(ProductCard, { product: gpu })
    const anchor = find(card.root, (node) => node.type === 'a')
    expect(anchor.props.href).toBe('/products/3')
    expect(text(byClass(card.root, 'product-card__meta'))).toContain('MSI · 그래픽카드')
    expect(text(find(card.root, (node) => node.type === 'h3'))).toBe(gpu.name)
    expect(text(card.root)).toContain('899,000원')
    expect(text(card.root)).not.toContain('구매 가능')
    expect(findAll(card.root, (node) => node.type === 'button')).toEqual([])
  })

  test('가격 추세: 30일 추세선(sparkline_30d·변동률)과 "30일" 변동률 배지, 1년 최저가 문구', () => {
    const card = mount(ProductCard, { product: { ...gpu, price_trend: trend() } })
    expect(stub(card.root, 'PriceSparkline').props).toMatchObject({ values: [948000, 930000, 899000], 'change-pct': -5.2 })
    expect(stub(card.root, 'PriceChangeBadge').props.pct).toBe(-5.2)
    expect(stub(card.root, 'PriceChangeBadge').props.prefix).toBeUndefined()
    const lowest = byClass(card.root, 'product-card__lowest')
    expect(text(lowest)).toBe('1년 최저가 대비 +2.2%')
    expect(lowest.props.class).toContain('product-card__lowest--near')
  })

  test.each([
    ['1년 최저', { is_lowest_1y: true, lowest_gap_pct: 0 }, false, '1년 최저', 'low', '지금이 1년 중 최저가', 'good'],
    ['가격 하락', { change_30d_pct: -8.4, lowest_gap_pct: 6.5 }, false, '가격 하락', 'drop', '1년 최저가 대비 +6.5%', 'neutral'],
    ['NEW', { change_30d_pct: 1.2, lowest_gap_pct: 4 }, true, 'NEW', 'new', '1년 최저가 대비 +4.0%', 'neutral'],
  ])('배지 %s(priceBadge)와 1년 최저가 문구 톤', (_name, overrides, isNew, label, kind, lowestText, tone) => {
    const card = mount(ProductCard, { product: { ...gpu, is_new: isNew, price_trend: trend(overrides) } })
    const badge = byClass(card.root, 'product-card__badge')
    expect(text(badge)).toBe(label)
    expect(badge.props.class).toContain(`product-card__badge--${kind}`)
    expect(text(byClass(card.root, 'product-card__lowest'))).toBe(lowestText)
    expect(byClass(card.root, 'product-card__lowest').props.class).toContain(`product-card__lowest--${tone}`)
  })

  test('가격 추세가 없으면(이전 응답) 추세 줄·최저가 문구·배지를 그리지 않는다', () => {
    const card = mount(ProductCard, { product: { ...gpu, is_new: false } })
    expect(stub(card.root, 'PriceSparkline')).toBeNull()
    expect(stub(card.root, 'PriceChangeBadge')).toBeNull()
    expect(byClass(card.root, 'product-card__lowest')).toBeNull()
    expect(byClass(card.root, 'product-card__badge')).toBeNull()
  })

  test('이미지가 없거나 깨지면 자리표시 이미지를 쓴다', async () => {
    const card = mount(ProductCard, { product: { ...gpu, thumbnail_url: 'https://cdn.example.test/broken.png' } })
    const image = () => find(card.root, (node) => node.type === 'img')
    expect(image().props.src).toBe('https://cdn.example.test/broken.png')
    expect(image().props.alt).toBe(`${gpu.name} 이미지`)
    image().props.onError()
    await flush()
    expect(image().props.src).toBe('/product-placeholder.svg')
    const empty = mount(ProductCard, { product: { ...gpu, thumbnail_url: '' } })
    expect(find(empty.root, (node) => node.type === 'img').props.src).toBe('/product-placeholder.svg')
  })

  test.each([[0, '품절'], [4, '4개 남음']])('재고 %s 이면 %s', (stock, label) => {
    const card = mount(ProductCard, { product: { ...gpu, stock } })
    expect(text(card.root)).toContain(label)
  })
})

describe('ProductGrid', () => {
  let ProductGrid
  beforeAll(async () => { ProductGrid = await compileSfc('components/ProductGrid.vue') })

  test('상품마다 카드를 하나씩 그린다', () => {
    const grid = mount(ProductGrid, { products: [gpu, { ...gpu, id: 4 }], label: '그래픽카드 목록' })
    expect(findAll(grid.root, (node) => node.props['data-stub'] === 'ProductCard').map((node) => node.props.product.id)).toEqual([3, 4])
    expect(find(grid.root, (node) => node.type === 'ul').props['aria-label']).toBe('그래픽카드 목록')
  })

  test('카드 링크 밖 아래 줄에 타몰 비교 문구(MOA 최저 good / 다른 곳이 더 쌈 warn)와 담기 버튼', async () => {
    const onAddToCart = jest.fn()
    const onSelect = jest.fn()
    const cheaper = { ...gpu, id: 4, name: '라데온 RX 7800 XT', price_trend: trend({ store_is_lowest: false, external_lowest: { source: 'naver', price_krw: 880000 }, store_gap_krw: 19000 }) }
    const grid = mount(ProductGrid, { products: [{ ...gpu, price_trend: trend() }, cheaper], compareIds: [], addingIds: [], onAddToCart, onSelect })
    const items = findAll(grid.root, (node) => node.type === 'li')
    expect(items[0].children.map((node) => node.props['data-stub'] || node.type)).toEqual(['ProductCard', 'button', 'div'])
    const stores = findAll(grid.root, (node) => String(node.props.class || '').includes('product-grid__store'))
    expect(stores.map((node) => [text(node), node.props.class])).toEqual([
      ['타몰 최저가보다 6,000원 저렴', 'product-grid__store product-grid__store--good'],
      ['네이버에서 19,000원 더 저렴', 'product-grid__store product-grid__store--warn'],
    ])
    const add = button(items[1], '담기')
    expect(add.props).toMatchObject({ type: 'button', disabled: false, 'aria-label': '라데온 RX 7800 XT 장바구니에 담기' })
    await click(add)
    expect(onAddToCart).toHaveBeenCalledWith(cheaper)
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('담는 중인 카드만 "담는 중..."·비활성, 품절은 "품절"·비활성. addingIds 가 없으면 담기 버튼이 없다', () => {
    const grid = mount(ProductGrid, { products: [gpu, { ...gpu, id: 4 }, { ...gpu, id: 5, stock: 0 }], addingIds: [3] })
    const buttons = findAll(grid.root, (node) => node.type === 'button')
    expect(buttons.map((node) => [text(node), node.props.disabled, node.props['aria-busy']])).toEqual([
      ['담는 중...', true, true], ['담기', false, false], ['품절', true, false],
    ])
    expect(buttons[2].props['aria-label']).toBe(`${gpu.name} 품절`)
    const plain = mount(ProductGrid, { products: [gpu] })
    expect(findAll(plain.root, (node) => node.type === 'button')).toEqual([])
    const children = findAll(plain.root, (node) => node.type === 'li')[0].children.filter((node) => node.type !== '#comment')
    expect(children.map((node) => node.props['data-stub'] || node.type)).toEqual(['ProductCard'])
  })

  test('비교 버튼 글자는 "+ 비교" / "비교 중"', () => {
    const grid = mount(ProductGrid, { products: [gpu, { ...gpu, id: 4 }], compareIds: [4] })
    expect(findAll(grid.root, (node) => node.type === 'button').map(text)).toEqual(['+ 비교', '비교 중'])
  })
})

describe('ProductDropList', () => {
  let ProductDropList
  beforeAll(async () => { ProductDropList = await compileSfc('components/ProductDropList.vue') })
  const dropped = { ...gpu, id: 7, name: '삼성 990 PRO 2TB', thumbnail_url: 'https://cdn.example.test/ssd.png', price_trend: trend({ change_30d_pct: -12.3, is_lowest_1y: true, lowest_gap_pct: 0 }) }

  test('로딩: 제목과 기준 문구, role="status"', () => {
    const view = mount(ProductDropList, { state: 'loading' })
    // 제목 줄은 정적 내용이라 컴파일러가 HTML 문자열 한 덩어리로 넣는다
    expect(text(view.root)).toContain('<h2 id="drop-list-title">')
    expect(text(view.root)).toContain('30일 하락폭 큰 부품</h2>')
    expect(text(view.root)).toContain('30일 전 가격 기준')
    expect(text(byRole(view.root, 'status')[0])).toBe('하락한 부품을 불러오는 중입니다...')
  })

  test('카드는 상세 링크 하나: 사진(장식)·변동률 배지(접두 없음)·이름 h3·추세선·가격·1년 최저가 문구', async () => {
    const view = mount(ProductDropList, { state: 'ready', items: [dropped, { ...gpu, price_trend: trend() }] })
    const list = find(view.root, (node) => node.type === 'ul')
    expect(list.props['aria-labelledby']).toBe('drop-list-title')
    const cards = findAll(view.root, (node) => node.type === 'a')
    expect(cards.map((node) => node.props.href)).toEqual(['/products/7', '/products/3'])
    expect(findAll(view.root, (node) => node.type === 'button')).toEqual([])
    expect(text(find(cards[0], (node) => node.type === 'h3'))).toBe('삼성 990 PRO 2TB')
    expect(stub(cards[0], 'PriceChangeBadge').props).toMatchObject({ pct: -12.3, prefix: '' })
    expect(stub(cards[0], 'PriceSparkline').props['change-pct']).toBe(-12.3)
    expect(text(cards[0])).toContain('899,000원')
    expect(text(cards[0])).toContain('지금이 1년 중 최저가')
    expect(text(cards[1])).toContain('1년 최저가 대비 +2.2%')
    const image = () => find(cards[0], (node) => node.type === 'img')
    expect(image().props).toMatchObject({ src: 'https://cdn.example.test/ssd.png', alt: '' })
    image().props.onError()
    await flush()
    expect(find(findAll(view.root, (node) => node.type === 'a')[0], (node) => node.type === 'img').props.src).toBe('/product-placeholder.svg')
  })

  test('오류: role="alert" 문구와 다시 시도(retry)', async () => {
    const onRetry = jest.fn()
    const view = mount(ProductDropList, { state: 'error', error: '하락한 부품을 불러오지 못했습니다. 다시 시도해 주세요.', onRetry })
    expect(text(byRole(view.root, 'alert')[0])).toContain('하락한 부품을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(view.root, '다시 시도'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('빈 목록이면 아무것도 그리지 않는다', () => {
    const view = mount(ProductDropList, { state: 'empty', items: [] })
    expect(text(view.root)).toBe('')
    expect(find(view.root, (node) => node.type === 'section')).toBeNull()
  })
})

describe('ProductSearchBar', () => {
  test('제출하면 입력값과 앞뒤 공백을 지운 검색어를 알린다', async () => {
    const ProductSearchBar = await compileSfc('components/ProductSearchBar.vue')
    const onSearch = jest.fn()
    const onUpdateKeyword = jest.fn()
    const bar = mount(ProductSearchBar, { keyword: '', onSearch, 'onUpdate:keyword': onUpdateKeyword })
    expect(byId(bar.root, 'product-search').props.maxlength).toBe(50)
    await setValue(byId(bar.root, 'product-search'), ' RTX 4070 ')
    await submit(bar.root)
    expect(onUpdateKeyword).toHaveBeenCalledWith(' RTX 4070 ')
    expect(onSearch).toHaveBeenCalledWith('RTX 4070')
  })
})

describe('ProductSummary', () => {
  test('윗줄 "브랜드 · 카테고리"(+ slot), 이름 h1 하나, 요약을 보여 준다', async () => {
    const ProductSummary = await compileSfc('components/ProductSummary.vue')
    const summary = mount(ProductSummary, { name: gpu.name, brand: 'MSI', categoryName: '그래픽카드', summary: 'QHD 게이밍용' })
    expect(findAll(summary.root, (node) => node.type === 'h1').map(text)).toEqual([gpu.name])
    expect(text(find(summary.root, (node) => node.type === 'p'))).toBe('MSI·그래픽카드')
    expect(text(summary.root)).toContain('QHD 게이밍용')
    const noBrand = mount(ProductSummary, { name: gpu.name, categoryName: '그래픽카드' })
    expect(text(find(noBrand.root, (node) => node.type === 'p'))).toBe('그래픽카드')
    expect(findAll(noBrand.root, (node) => node.type === 'p')).toHaveLength(1)
  })
})

describe('ProductQuantitySelect', () => {
  let ProductQuantitySelect
  beforeAll(async () => { ProductQuantitySelect = await compileSfc('components/ProductQuantitySelect.vue') })
  const options = (view) => findAll(view.root, (node) => node.type === 'option')

  test('1~max 를 보여 주고, 바꾸면 숫자로 알린다', () => {
    const onUpdate = jest.fn()
    const view = mount(ProductQuantitySelect, { id: 'qty', modelValue: 2, max: 4, 'onUpdate:modelValue': onUpdate })
    expect(options(view).map((node) => node.props.value)).toEqual([1, 2, 3, 4])
    const select = find(view.root, (node) => node.type === 'select')
    expect(select.props).toMatchObject({ id: 'qty', value: 2, disabled: false })
    expect(find(view.root, (node) => node.type === 'label').props.for).toBe('qty')
    select.props.onChange({ target: { value: '3' } })
    expect(onUpdate).toHaveBeenCalledWith(3)
  })

  test('재고가 줄어 지금 수량이 max 보다 크면 지금 수량은 보여 주되 고를 수 없게 한다', () => {
    const view = mount(ProductQuantitySelect, { id: 'qty', modelValue: 3, max: 1, label: '그래픽카드 수량', hideLabel: true })
    expect(options(view).map((node) => [node.props.value, node.props.disabled])).toEqual([[1, false], [2, true], [3, true]])
    const label = find(view.root, (node) => node.type === 'label')
    expect(text(label)).toBe('그래픽카드 수량')
    expect(label.props.class).toBe('sr-only')
  })
})

describe('ProductPurchaseCard', () => {
  let ProductPurchaseCard
  beforeAll(async () => { ProductPurchaseCard = await compileSfc('components/ProductPurchaseCard.vue') })

  test('재고·수량 선택(최대 min(10, 재고))과 장바구니 담기·바로 구매(가격은 없다), slot 은 버튼 줄 다음', async () => {
    const handlers = { onAddToCart: jest.fn(), onBuyNow: jest.fn(), 'onUpdate:quantity': jest.fn() }
    const slotted = { name: 'Slotted', setup: () => () => h('p', { class: 'slotted' }, '장바구니에 담았습니다.') }
    const card = mount({ setup: () => () => h(ProductPurchaseCard, { stock: 42, quantity: 2, ...handlers }, { default: () => h(slotted) }) })
    expect(text(card.root)).toContain('구매 가능')
    expect(text(card.root)).not.toContain('899,000원')
    const quantity = stub(card.root, 'ProductQuantitySelect').props
    expect(quantity).toMatchObject({ id: 'product-quantity', 'model-value': 2, max: 10, disabled: false })
    quantity['onUpdate:modelValue'](5)
    expect(handlers['onUpdate:quantity']).toHaveBeenCalledWith(5)
    const actions = find(card.root, (node) => node.props.class === 'product-purchase__actions')
    expect(findAll(actions, (node) => node.type === 'button').map(text)).toEqual(['장바구니 담기', '바로 구매'])
    const section = find(card.root, (node) => node.type === 'section')
    expect(section.props['aria-label']).toBe('구매하기')
    expect(section.children.filter((node) => !node.type.startsWith('#')).map((node) => node.props.class)).toEqual(['product-purchase__options', 'product-purchase__actions', 'slotted'])
    await click(button(card.root, '장바구니 담기'))
    await click(button(card.root, '바로 구매'))
    expect(handlers.onAddToCart).toHaveBeenCalledTimes(1)
    expect(handlers.onBuyNow).toHaveBeenCalledTimes(1)
  })

  test('품절이면 품절을 보여 주고 수량 선택 없이 두 버튼을 비활성화한다', () => {
    const card = mount(ProductPurchaseCard, { stock: 0 })
    expect(text(card.root)).toContain('품절')
    expect(text(card.root)).toContain('품절된 상품입니다.')
    expect(stub(card.root, 'ProductQuantitySelect')).toBeNull()
    expect(button(card.root, '장바구니 담기').props.disabled).toBe(true)
    expect(button(card.root, '바로 구매').props.disabled).toBe(true)
  })

  test('담는 중에는 진행 문구를 보여 주고 두 버튼과 수량 선택을 막는다', () => {
    const card = mount(ProductPurchaseCard, { stock: 3, adding: true })
    expect(button(card.root, '담는 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    expect(button(card.root, '바로 구매').props.disabled).toBe(true)
    expect(stub(card.root, 'ProductQuantitySelect').props).toMatchObject({ max: 3, disabled: true })
    expect(text(card.root)).toContain('3개 남음')
  })
})

describe('ProductPriceSummary', () => {
  let ProductPriceSummary
  beforeAll(async () => { ProductPriceSummary = await compileSfc('components/ProductPriceSummary.vue') })
  const trend = {
    change_30d_pct: -5.2, lowest_1y_krw: 879000, lowest_1y_on: '2026-10-01', highest_1y_krw: 949000, average_30d_krw: 905000, is_lowest_1y: false, lowest_gap_pct: 2.3,
    sparkline_30d: [], external_lowest: { source: 'coupang', price_krw: 905000 }, store_is_lowest: true, store_gap_krw: 6000,
  }
  const tiles = (view) => findAll(view.root, (node) => node.type === 'dt').map((dt) => [text(dt), text(dt.parent.children.find((child) => child.type === 'dd'))])
  const storeLine = (view) => find(view.root, (node) => node.type === 'p' && String(node.props.class).includes('price-summary__store'))

  test('판매가(32px)·30일 변동 배지, 세 칸(1년 최저가·30일 평균·지금 살 때?)과 MOA 최저 문구 + 배송', () => {
    const view = mount(ProductPriceSummary, { price: 899000, trend })
    expect(text(find(view.root, (node) => node.props.class === 'price-summary__price'))).toBe('899,000원')
    expect(stub(view.root, 'PriceChangeBadge').props.pct).toBe(-5.2)
    expect(tiles(view)).toEqual([
      ['1년 최저가', '879,000원2026.10.01'],
      ['30일 평균', '905,000원1년 최고 949,000원'],
      ['지금 살 때?', '최저가에 가까워요1년 최저가 대비 +2.3%'],
    ])
    expect(find(view.root, (node) => node.type === 'strong' && text(node) === '최저가에 가까워요').props.class).toBe('price-summary__verdict--near')
    expect(text(storeLine(view))).toBe('타몰 최저가보다 6,000원 저렴 · 무료배송 · 오늘 출발')
    expect(storeLine(view).props.class).toContain('price-summary__store--good')
  })

  test('다른 곳이 더 싸면 경고 문구만(배송 문구 없음)', () => {
    const view = mount(ProductPriceSummary, { price: 899000, trend: { ...trend, store_is_lowest: false } })
    expect(text(storeLine(view))).toBe('쿠팡에서 6,000원 더 저렴')
    expect(storeLine(view).props.class).toContain('price-summary__store--warn')
  })

  test('가격 추세가 없으면 —·안내 문구, 판매처 문구 없음', () => {
    const view = mount(ProductPriceSummary, { price: 899000, trend: null })
    expect(stub(view.root, 'PriceChangeBadge').props.pct).toBeNull()
    expect(tiles(view)).toEqual([
      ['1년 최저가', '—기록 없음'],
      ['30일 평균', '—1년 최고 —'],
      ['지금 살 때?', '기록이 더 필요해요가격 기록이 쌓이면 알려 드려요'],
    ])
    expect(storeLine(view)).toBeNull()
  })
})

describe('ProductPriceChart', () => {
  let ProductPriceChart
  beforeAll(async () => { ProductPriceChart = await compileSfc('components/ProductPriceChart.vue') })
  const points = [{ date: '2026-10-01', price: 100000 }, { date: '2026-10-02', price: 200000 }, { date: '2026-10-03', price: 150000 }]
  const svg = (view) => find(view.root, (node) => node.type === 'svg')
  const tip = (view) => find(view.root, (node) => node.props.class === 'trend-chart__tip')
  const live = (view) => find(view.root, (node) => node.props['aria-live'] === 'polite')
  const key = (name) => ({ key: name, preventDefault: jest.fn() })

  test('SVG(role=img·요약 aria-label·초점 가능): 가로선 4개, 1년 최저가 점선, 채우기·선·마지막 점, x 축 날짜, 통계 줄', () => {
    const view = mount(ProductPriceChart, { points, lowest: 90000, periodLabel: '1달', days: 3 })
    expect(svg(view).props).toMatchObject({ role: 'img', tabindex: '0', viewBox: '0 0 640 240', 'aria-describedby': 'trend-chart-help' })
    expect(svg(view).props['aria-label']).toBe('최근 1달 MOA Parts 판매가 그래프. 2026.10.01 100,000원에서 2026.10.03 150,000원(+50.0%). 최저 100,000원, 최고 200,000원, 평균 150,000원. 점선은 1년 최저가 90,000원.')
    expect(findAll(svg(view), (node) => node.props.class === 'trend-chart__grid')).toHaveLength(4)
    expect(findAll(svg(view), (node) => node.props.class === 'trend-chart__low')).toHaveLength(1)
    expect(findAll(svg(view), (node) => node.type === 'path').map((node) => node.props.class)).toEqual(['trend-chart__area', 'trend-chart__line'])
    expect(find(svg(view), (node) => node.props.class === 'trend-chart__area').props.fill).toBe('url(#trend-chart-area)')
    expect(find(svg(view), (node) => node.props.class === 'trend-chart__last').props).toMatchObject({ cx: 628 })
    expect(findAll(svg(view), (node) => node.type === 'text').map(text).slice(-3)).toEqual(['10.01', '10.02', '10.03'])
    expect(findAll(find(view.root, (node) => node.type === 'dl'), (node) => node.type === 'div').map(text)).toEqual([
      '현재가150,000원', '1달 변동▲+50.0%', '1달 최저100,000원', '1달 최고200,000원', '1달 평균150,000원',
    ])
    expect(tip(view)).toBeNull()
    expect(text(view.root)).not.toContain('부터 있어요')
  })

  test('1년 최저가가 없으면 점선이 없고, 기록이 기간보다 짧으면 시작일을 알려 준다', () => {
    const view = mount(ProductPriceChart, { points, lowest: null, periodLabel: '1년', days: 365 })
    expect(findAll(svg(view), (node) => node.props.class === 'trend-chart__low')).toHaveLength(0)
    expect(text(view.root)).toContain('가격 기록은 2026.10.01부터 있어요.')
    expect(text(view.root)).toContain('1년 변동')
  })

  test('포인터를 움직이면 가장 가까운 날의 세로선·점·툴팁, 벗어나면 지운다', async () => {
    const view = mount(ProductPriceChart, { points, periodLabel: '1달', days: 3 })
    const rect = { getBoundingClientRect: () => ({ left: 100, width: 640 }) }
    svg(view).props.onPointermove({ clientX: 420, currentTarget: rect })
    await flush()
    expect(text(tip(view))).toBe('2026.10.02200,000원')
    expect(tip(view).props['aria-hidden']).toBe('true')
    expect(find(svg(view), (node) => node.props.class === 'trend-chart__hover')).not.toBeNull()
    expect(text(live(view))).toBe('')
    svg(view).props.onPointerleave()
    await flush()
    expect(tip(view)).toBeNull()
  })

  test('키보드: ←(처음엔 마지막 날)·→·Home·End 로 날을 옮기고 읽어 준다. Esc 는 지우고, 다른 키는 그대로', async () => {
    const view = mount(ProductPriceChart, { points, periodLabel: '1달', days: 3 })
    const left = key('ArrowLeft')
    svg(view).props.onKeydown(left)
    await flush()
    expect(left.preventDefault).toHaveBeenCalled()
    expect(text(tip(view))).toBe('2026.10.03150,000원')
    expect(text(live(view))).toBe('2026.10.03 150,000원')
    svg(view).props.onKeydown(key('ArrowLeft'))
    await flush()
    expect(text(live(view))).toBe('2026.10.02 200,000원')
    svg(view).props.onKeydown(key('Home'))
    await flush()
    expect(text(live(view))).toBe('2026.10.01 100,000원')
    const other = key('Tab')
    svg(view).props.onKeydown(other)
    expect(other.preventDefault).not.toHaveBeenCalled()
    svg(view).props.onKeydown(key('Escape'))
    await flush()
    expect(tip(view)).toBeNull()
    expect(text(live(view))).toBe('')
    svg(view).props.onKeydown(key('End'))
    svg(view).props.onBlur()
    await flush()
    expect(tip(view)).toBeNull()
  })

  test('값이 없으면 아무것도 그리지 않는다', () => {
    const view = mount(ProductPriceChart, { points: [] })
    expect(svg(view)).toBeNull()
  })
})

describe('SiteLayout', () => {
  const fetchCurrentUser = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  // 헤더 숫자(siteStatus)는 가짜 API 를 넣는다(네트워크를 쓰지 않는다)
  const siteStatus = createSiteStatus({ session: authSession, fetchCart: jest.fn().mockResolvedValue({ item_count: 0 }), fetchUnreadCount: jest.fn().mockResolvedValue({ unread_count: 0 }), compareCount: () => 0 })
  let SiteLayout
  beforeAll(async () => { SiteLayout = await compileSfc('components/SiteLayout.vue', { authSession, siteStatus }) })
  beforeEach(() => {
    fetchCurrentUser.mockReset()
    authSession.reset()
    siteStatus.reset()
  })

  // MOA Parts 디자인: 주요 메뉴는 상품·가격 추적·커뮤니티 세 개. 장바구니·주문 내역은 로그인 뒤 프로필 드롭다운에 있다
  test('MOA Parts 메뉴 3개(상품·가격 추적·커뮤니티)와 현재 메뉴 표시, 비로그인이면 로그인 링크', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const layout = mount(SiteLayout, { activePage: 'community' })
    await flush()
    expect(text(layout.root)).toContain('MOA Parts')
    const menu = findAll(find(layout.root, (node) => node.type === 'nav'), (node) => node.type === 'a')
    expect(menu.map((node) => [text(node), node.props.href, node.props['aria-current']])).toEqual([
      ['상품', '/products', undefined],
      ['가격 추적', '/my?tab=alerts', undefined],
      ['커뮤니티', '/community', 'page'],
    ])
    expect(link(layout.root, '로그인').props.href).toBe('/login')
    expect(byId(layout.root, 'site-profile-menu')).toBeNull()
  })

  test('로그인했으면 이름(숨김 글자)을 보여 주고, 로그인 화면(auth)은 하단 탭 "마이"만 강조한다', async () => {
    fetchCurrentUser.mockResolvedValue({ id: 1, name: '김조립', email: 'builder@example.com' })
    const layout = mount(SiteLayout, { activePage: 'auth' })
    await flush()
    expect(text(layout.root)).toContain('김조립')
    expect(link(layout.root, '로그인')).toBeNull()
    expect(findAll(layout.root, (node) => node.props['aria-current'] === 'page').map(text)).toEqual(['마이'])
  })
})
