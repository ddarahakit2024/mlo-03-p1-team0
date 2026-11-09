// 비교함 화면들(spec docs/specs/2026-11-01-event-enrichment.md "화면"):
// 비교 화면 ProductCompare(비어 있음·로딩·성공(열 머리·가장 저렴·30일 추이·1년 최저·타몰 비교·"최고" 배지·specs 합집합·"—")·1개 안내·404 상품 빼기·
// 오류 → 다시 시도·× 빼기·모두 비우기·열마다 장바구니 담기(토스트·헤더 수량·401)·공유 링크·localStorage 사용 불가),
// 비교함 막대 ProductCompareBar, 상품 카드 목록 ProductGrid 의 비교 토글·노출 관찰·클릭, 상품 목록·상세의 비교 버튼과 막대.
// 이벤트 type·props 는 src/trackingView.test.mjs 가 본다.
import { jest } from '@jest/globals'
import { button, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, stub, text } from './testing/sfc.mjs'
import { compareItem } from './stores/compareViewModel.js'

const gpu = (id, extra = {}) => ({
  id, name: `지포스 RTX ${id}`, brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD',
  released_on: '2026-09-12', performance_score: 24500, value_score: 272.52, is_new: false, rating_average: 4.5, review_count: 12, specs: [], ...extra,
})
const cpu = (id) => ({ ...gpu(id), name: `라이젠 ${id}`, category: 'cpu' })

function memoryStorage(state = null) {
  let value = state ? JSON.stringify(state) : null
  return { available: true, get: jest.fn(() => value), set: jest.fn((textValue) => { value = textValue; return true }), saved: () => JSON.parse(value) }
}
const boxOf = (...products) => ({ category: products[0].category, items: products.map(compareItem) })
const unavailable = { available: false, get: () => null, set: () => false }
const cells = (row) => findAll(row, (node) => node.type === 'td').map((cell) => text(cell).trim())
const rowOf = (root, label) => find(root, (node) => node.type === 'tr' && find(node, (child) => child.type === 'th' && text(child) === label))

describe('비교 화면(ProductCompare)', () => {
  const fetchProduct = jest.fn()
  const addCartItem = jest.fn()
  const track = jest.fn()
  const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
  let storage
  let ProductCompare
  const replaceState = jest.fn()
  const trend = {
    change_30d_pct: -5.2, lowest_1y_krw: 388400, lowest_1y_on: '2026-11-05', highest_1y_krw: 455000, average_30d_krw: 392000, is_lowest_1y: false,
    lowest_gap_pct: 1.2, sparkline_30d: [409000, 395200, 388400], external_lowest: { source: 'coupang', price_krw: 392000 }, store_is_lowest: true, store_gap_krw: 3600,
  }
  const columnHeads = (page) => findAll(page.root, (node) => node.type === 'th' && node.props.scope === 'col')
  const removeButton = (page, name) => find(page.root, (node) => node.type === 'button' && node.props['aria-label'] === `${name} 비교함에서 빼기`)
  const cartButtons = (page) => findAll(page.root, (node) => node.type === 'button' && String(node.props.class || '').includes('compare-table__cart'))

  function open(search = '') {
    global.window = { location: { search }, history: { replaceState } }
    const page = mount(ProductCompare)
    return page
  }

  beforeAll(async () => {
    ProductCompare = await compileSfc('views/ProductCompare.vue', { fetchProduct, addCartItem, track, siteStatus, browserCompareStorage: () => storage })
  })
  beforeEach(() => {
    fetchProduct.mockReset()
    addCartItem.mockReset()
    track.mockReset()
    replaceState.mockReset()
    Object.values(siteStatus).forEach((mock) => mock.mockReset())
    storage = memoryStorage()
  })
  afterEach(() => { delete global.window })

  test('비어 있음: API 를 부르지 않고 제목·설명, 빈 안내와 상품 보러 가기 링크(모두 비우기 없음)', async () => {
    const page = open()
    await flush()
    expect(fetchProduct).not.toHaveBeenCalled()
    expect(text(find(page.root, (node) => node.type === 'h1'))).toBe('부품 비교')
    expect(text(page.root)).toContain('최대 4개까지 나란히 비교할 수 있어요. 가장 저렴한 가격과 하락 중인 부품은 초록색으로 표시돼요.')
    expect(text(page.root)).toContain('비교할 부품이 없어요. 상품 카드의 + 비교 버튼으로 담아 보세요.')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    expect(button(page.root, '모두 비우기')).toBeNull()
    expect(stub(page.root, 'ProductCompareBar')).toBeNull()
    expect(track).not.toHaveBeenCalled()
    // 헤더의 비교 아이콘·모바일 탭 막대의 "비교"가 현재 화면으로 표시된다
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('compare')
  })

  test('로딩 → 성공: 상품마다 GET /products/{id} 를 함께 부르고 표(열 머리·가격·추이·최저·타몰·평점·점수·specs 합집합 "—")를 그린다, compare_view 는 한 번', async () => {
    storage = memoryStorage(boxOf(gpu(3), gpu(4)))
    const first = deferred()
    fetchProduct.mockReturnValueOnce(first.promise).mockResolvedValueOnce(gpu(4, { brand: 'ASUS', price_krw: 3890000, performance_score: 39800, value_score: 102.31, rating_average: null, review_count: 0, specs: [{ label: '메모리', value: '24GB' }] }))
    const page = open()
    await flush()
    expect(fetchProduct.mock.calls.map(([id]) => id)).toEqual([3, 4])
    expect(text(byRole(page.root, 'status')[0])).toContain('비교할 상품 정보를 불러오는 중입니다...')
    expect(button(page.root, '모두 비우기')).toBeNull()
    first.resolve(gpu(3, { price_trend: trend, specs: [{ label: '칩셋', value: 'AD104' }, { label: '메모리', value: '12GB' }] }))
    await flush()
    expect(byRole(page.root, 'status')).toHaveLength(0)
    expect(text(page.root)).toContain('그래픽카드 2개를 비교합니다.')
    // 열 머리: (숨긴 "항목") + 상품마다 브랜드 · 카테고리, 이름 링크, × 빼기. 사진 링크는 같은 곳으로 가는 중복 링크라 탭·화면 읽기에서 뺀다
    const heads = columnHeads(page)
    expect(heads.map((node) => text(node).trim())).toEqual(['항목', 'MSI · 그래픽카드지포스 RTX 3×', 'ASUS · 그래픽카드지포스 RTX 4×'])
    expect(link(page.root, '지포스 RTX 3').props.href).toBe('/products/3')
    const imageLink = find(heads[1], (node) => node.type === 'a' && node.props.class === 'compare-table__image')
    expect(imageLink.props).toMatchObject({ href: '/products/3', tabindex: '-1', 'aria-hidden': 'true' })
    expect(find(imageLink, (node) => node.type === 'img').props.alt).toBe('')
    expect(removeButton(page, '지포스 RTX 3').props.type).toBe('button')
    // 행(th scope=row): 가격(가장 저렴은 글자)·30일 추이·1년 최저 대비·타몰 비교·평점·성능·가성비·출시일·specs
    expect(findAll(page.root, (node) => node.type === 'th' && node.props.scope === 'row').map((node) => text(node).trim())).toEqual([
      '가격', '30일 추이', '1년 최저 대비', '타몰 비교', '평점', '성능 점수', '가성비 지수', '출시일', '칩셋', '메모리', '장바구니',
    ])
    expect(cells(rowOf(page.root, '가격'))).toEqual(['899,000원가장 저렴', '3,890,000원'])
    expect(cells(rowOf(page.root, '30일 추이'))).toEqual(['▼ -5.2%', '—'])
    expect(stub(rowOf(page.root, '30일 추이'), 'PriceSparkline').props).toMatchObject({ values: [409000, 395200, 388400], 'change-pct': -5.2 })
    expect(findAll(rowOf(page.root, '30일 추이'), (node) => node.props['data-stub'] === 'PriceSparkline')).toHaveLength(1)
    expect(cells(rowOf(page.root, '1년 최저 대비'))).toEqual(['1년 최저가 대비 +1.2%최저 388,400원', '—'])
    expect(cells(rowOf(page.root, '타몰 비교'))).toEqual(['타몰 최저가보다 3,600원 저렴', '—'])
    expect(cells(rowOf(page.root, '평점'))).toEqual(['★ 4.5(리뷰 12개)', '—'])
    expect(cells(rowOf(page.root, '성능 점수'))).toEqual(['24,500', '39,800최고'])
    expect(cells(rowOf(page.root, '가성비 지수'))).toEqual(['272.52최고', '102.31'])
    expect(cells(rowOf(page.root, '칩셋'))).toEqual(['AD104', '—'])
    expect(cells(rowOf(page.root, '메모리'))).toEqual(['12GB', '24GB'])
    expect(cartButtons(page).map((node) => text(node).trim())).toEqual(['장바구니 담기: 지포스 RTX 3', '장바구니 담기: 지포스 RTX 4'])
    expect(text(page.root)).not.toContain('하나 더 담아 주세요')
    expect(button(page.root, '모두 비우기').props.type).toBe('button')
    expect(track.mock.calls).toEqual([['compare_view', { category: 'gpu', product_ids: [3, 4], count: 2 }]])
    // 비교 화면에는 비교함 막대(트레이)를 두지 않는다. 헤더 비교함 개수는 서버 값으로 맞춘 비교함 개수
    expect(stub(page.root, 'ProductCompareBar')).toBeNull()
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(2)
  })

  test('1개만 있으면 표와 함께 "하나 더 담아 주세요" 안내와 같은 카테고리 목록 링크', async () => {
    storage = memoryStorage(boxOf(gpu(3)))
    fetchProduct.mockResolvedValue(gpu(3))
    const page = open()
    await flush()
    expect(text(page.root)).toContain('비교하려면 상품을 하나 더 담아 주세요.')
    expect(link(page.root, '그래픽카드 더 보기').props.href).toBe('/products?category=gpu')
    expect(find(page.root, (node) => node.type === 'table')).not.toBeNull()
    // 하나뿐이면 "가장 저렴" 배지를 붙이지 않는다
    expect(cells(rowOf(page.root, '가격'))).toEqual(['899,000원'])
  })

  test('404 상품은 비교함에서 빼고 안내한다(나머지는 표로)', async () => {
    storage = memoryStorage(boxOf(gpu(3), gpu(404), gpu(4)))
    fetchProduct.mockImplementation((id) => (id === 404 ? Promise.reject({ response: { status: 404 } }) : Promise.resolve(gpu(id))))
    const page = open()
    await flush()
    expect(text(page.root)).toContain('판매하지 않는 상품 1개를 비교함에서 뺐습니다.')
    expect(storage.saved().items.map((item) => item.id)).toEqual([3, 4])
    expect(columnHeads(page)).toHaveLength(3)
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(2)
  })

  test('모두 404 면 빈 비교함 안내와 뺀 개수 안내', async () => {
    storage = memoryStorage(boxOf(gpu(7), gpu(8)))
    fetchProduct.mockRejectedValue({ response: { status: 404 } })
    const page = open()
    await flush()
    expect(text(page.root)).toContain('판매하지 않는 상품 2개를 비교함에서 뺐습니다.')
    expect(text(page.root)).toContain('비교할 부품이 없어요.')
    expect(track.mock.calls.map(([type]) => type)).toEqual(['compare_remove', 'compare_remove'])
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(0)
  })

  test('오류(404 가 아닌 실패) → 다시 시도 → 성공. 실패한 동안 비교함은 그대로', async () => {
    storage = memoryStorage(boxOf(gpu(3), gpu(4)))
    fetchProduct.mockImplementationOnce(() => Promise.resolve(gpu(3))).mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }))
    const page = open()
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('비교할 상품 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(storage.saved().items).toHaveLength(2)
    expect(track).not.toHaveBeenCalled()
    fetchProduct.mockImplementation((id) => Promise.resolve(gpu(id)))
    await click(button(page.root, '다시 시도'))
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(find(page.root, (node) => node.type === 'table')).not.toBeNull()
    expect(track.mock.calls.filter(([type]) => type === 'compare_view')).toHaveLength(1)
  })

  test('열의 × 로 빼면 표에서 바로 사라지고, "모두 비우기"는 비교함을 비워 빈 안내로(compare_clear, 헤더 개수 0)', async () => {
    storage = memoryStorage(boxOf(gpu(3), gpu(4), gpu(5)))
    fetchProduct.mockImplementation((id) => Promise.resolve(gpu(id)))
    const page = open()
    await flush()
    await click(removeButton(page, '지포스 RTX 3'))
    expect(columnHeads(page)).toHaveLength(3)
    expect(storage.saved().items.map((item) => item.id)).toEqual([4, 5])
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(2)
    expect(track.mock.calls.at(-1)).toEqual(['compare_remove', { product_id: 3, category: 'gpu', count: 2, source: 'compare', reason: 'user' }])
    await click(button(page.root, '모두 비우기'))
    expect(text(page.root)).toContain('비교할 부품이 없어요.')
    expect(storage.saved().items).toEqual([])
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(0)
    expect(track.mock.calls.at(-1)).toEqual(['compare_clear', { category: 'gpu', product_ids: [4, 5], reason: 'user' }])
    expect(button(page.root, '모두 비우기')).toBeNull()
    expect(fetchProduct).toHaveBeenCalledTimes(3)
  })

  test('마지막 상품을 × 로 빼면 빈 안내', async () => {
    storage = memoryStorage(boxOf(gpu(3)))
    fetchProduct.mockResolvedValue(gpu(3))
    const page = open()
    await flush()
    await click(removeButton(page, '지포스 RTX 3'))
    expect(text(page.root)).toContain('비교할 부품이 없어요.')
    expect(find(page.root, (node) => node.type === 'table')).toBeNull()
  })

  test('오류 화면에서도 "모두 비우기"로 비우면 오류 대신 빈 안내', async () => {
    storage = memoryStorage(boxOf(gpu(3), gpu(4)))
    fetchProduct.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(gpu(4))
    const page = open()
    await flush()
    expect(byRole(page.root, 'alert')).toHaveLength(1)
    await click(button(page.root, '모두 비우기'))
    expect(byRole(page.root, 'alert')).toHaveLength(0)
    expect(text(page.root)).toContain('비교할 부품이 없어요.')
  })

  test('공유 링크(?ids=)로 열면 그 상품들로 비교함을 채우고 주소를 /compare 로 바꾼다(다른 카테고리는 뺀다)', async () => {
    storage = memoryStorage(boxOf(gpu(1)))
    fetchProduct.mockImplementation((id) => Promise.resolve(id === 9 ? cpu(9) : gpu(id)))
    const page = open('?ids=3,4,9')
    await flush()
    expect(fetchProduct.mock.calls.map(([id]) => id)).toEqual([3, 4, 9])
    expect(storage.saved()).toEqual(boxOf(gpu(3), gpu(4)))
    expect(replaceState).toHaveBeenCalledWith({}, '', '/compare')
    expect(columnHeads(page)).toHaveLength(3)
    expect(track.mock.calls.map(([type]) => type)).toEqual(['compare_view'])
    expect(siteStatus.setCompareCount).toHaveBeenLastCalledWith(2)
  })

  test('localStorage 를 쓸 수 없으면 비어 있음 안내(모두 비우기 없음). 공유 링크는 받은 상품을 그대로 보여 준다', async () => {
    storage = unavailable
    let page = open()
    await flush()
    expect(text(page.root)).toContain('비교할 부품이 없어요.')
    expect(button(page.root, '모두 비우기')).toBeNull()
    fetchProduct.mockImplementation((id) => Promise.resolve(gpu(id)))
    page = open('?ids=3,4')
    await flush()
    expect(columnHeads(page)).toHaveLength(3)
  })

  describe('열마다 장바구니 담기', () => {
    beforeEach(() => {
      storage = memoryStorage(boxOf(gpu(3), gpu(4)))
      fetchProduct.mockImplementation((id) => Promise.resolve(gpu(id)))
    })

    test('1개를 담고(POST /cart/items), 담는 중에는 모든 담기 버튼을 막는다. 성공하면 헤더 수량(item_count)·토스트·add_to_cart', async () => {
      const response = deferred()
      addCartItem.mockReturnValue(response.promise)
      const page = open()
      await flush()
      track.mockClear()
      cartButtons(page)[1].props.onClick()
      await flush()
      expect(addCartItem).toHaveBeenCalledWith({ productId: 4, quantity: 1 })
      expect(cartButtons(page).map((node) => [text(node).trim(), node.props.disabled])).toEqual([
        ['장바구니 담기: 지포스 RTX 3', true], ['담는 중...: 지포스 RTX 4', true],
      ])
      expect(cartButtons(page)[1].props['aria-busy']).toBe(true)
      response.resolve({ items: [{ product_id: 4, price_krw: 899000, quantity: 1 }], item_count: 5, total_krw: 899000 })
      await flush()
      expect(siteStatus.setCartCount).toHaveBeenCalledWith(5)
      expect(siteStatus.showToast).toHaveBeenCalledWith('장바구니에 담았어요')
      expect(track.mock.calls).toEqual([['add_to_cart', { product_id: 4, quantity: 1, price_krw: 899000 }]])
      expect(cartButtons(page).every((node) => node.props.disabled === false)).toBe(true)
    })

    test('비로그인(401)이면 토스트 "로그인이 필요해요"와 표 위 로그인 링크, 헤더 수량·이벤트는 그대로', async () => {
      addCartItem.mockRejectedValue({ response: { status: 401 } })
      const page = open()
      await flush()
      track.mockClear()
      await click(cartButtons(page)[0])
      expect(siteStatus.showToast).toHaveBeenCalledWith('로그인이 필요해요')
      expect(link(page.root, '로그인').props.href).toBe('/login')
      expect(siteStatus.setCartCount).not.toHaveBeenCalled()
      expect(track).not.toHaveBeenCalled()
    })

    test('재고 부족(409)이면 서버 문구, 서버 오류면 기본 문구를 토스트로', async () => {
      addCartItem.mockRejectedValueOnce({ response: { status: 409, data: { message: '재고가 부족합니다.' } } }).mockRejectedValueOnce({ response: { status: 500 } })
      const page = open()
      await flush()
      await click(cartButtons(page)[0])
      expect(siteStatus.showToast).toHaveBeenLastCalledWith('재고가 부족합니다.')
      await click(cartButtons(page)[0])
      expect(siteStatus.showToast).toHaveBeenLastCalledWith('장바구니에 담지 못했어요. 다시 시도해 주세요.')
      expect(link(page.root, '로그인')).toBeNull()
    })
  })
})

describe('비교함 막대(ProductCompareBar)', () => {
  let Bar
  beforeAll(async () => { Bar = await compileSfc('components/ProductCompareBar.vue') })

  test('비어 있으면 아무것도 그리지 않는다', () => {
    const bar = mount(Bar, { items: [] })
    expect(find(bar.root, (node) => node.type === 'section')).toBeNull()
  })

  test('기본은 화면 아래 가운데에 떠 있는 비교 트레이(floating), floating=false 면 페이지 끝 제자리', () => {
    const section = (props) => find(mount(Bar, { items: [compareItem(gpu(3))], ...props }).root, (node) => node.type === 'section')
    expect(section({}).props.class).toBe('compare-bar compare-bar--floating')
    expect(section({ floating: false }).props.class).toBe('compare-bar')
  })

  test('"비교 n/4"(제목), 담은 상품(사진·이름·빼기), × 비우기, "비교하기" 링크, 목록 이름은 " 목록"으로 끝나지 않는다', async () => {
    const onRemove = jest.fn()
    const onClear = jest.fn()
    const bar = mount(Bar, { items: [compareItem(gpu(3)), compareItem(gpu(4))], onRemove, onClear })
    expect(text(find(bar.root, (node) => node.type === 'h2'))).toContain('비교 2/4')
    expect(find(bar.root, (node) => node.type === 'section').props['aria-labelledby']).toBe('compare-bar-title')
    expect(text(bar.root)).toContain('그래픽카드')
    const list = find(bar.root, (node) => node.type === 'ul')
    expect(list.props['aria-label']).toBe('비교함에 담은 상품')
    expect(list.props['aria-label']).not.toMatch(/ 목록$/)
    expect(findAll(list, (node) => node.type === 'img').map((node) => node.props.alt)).toEqual(['', ''])
    expect(link(bar.root, '비교하기').props.href).toBe('/compare')
    // 비우기는 디자인의 × 아이콘 버튼: 숨김 글자로 이름을 준다
    expect(text(find(button(bar.root, '비우기'), (node) => node.props.class === 'sr-only'))).toBe('비교함 비우기')
    await click(find(bar.root, (node) => node.props['aria-label'] === '지포스 RTX 4 비교함에서 빼기'))
    expect(onRemove).toHaveBeenCalledWith(4)
    await click(button(bar.root, '비우기'))
    expect(onClear).toHaveBeenCalled()
    // 안내 줄(role=status)은 늘 있고 비어 있다
    expect(byRole(bar.root, 'status').map((node) => text(node))).toEqual([''])
  })

  test('4개 초과 안내는 role="status" 로 보이고 "비우고 담기" 버튼은 없다. 닫을 수 있다', async () => {
    const onDismiss = jest.fn()
    const bar = mount(Bar, { items: [compareItem(gpu(3))], notice: { kind: 'full', text: '비교함에는 4개까지 담을 수 있습니다. 다른 상품을 빼고 담아 주세요.' }, onDismiss })
    expect(text(byRole(bar.root, 'status')[0])).toBe('비교함에는 4개까지 담을 수 있습니다. 다른 상품을 빼고 담아 주세요.')
    expect(button(bar.root, '비교함 비우고 담기')).toBeNull()
    await click(find(bar.root, (node) => node.props['aria-label'] === '안내 닫기'))
    expect(onDismiss).toHaveBeenCalled()
  })

  test('다른 카테고리 안내에는 "비교함 비우고 담기"(replace). 비교 화면에서는 "비교하기" 링크를 숨긴다', async () => {
    const onReplace = jest.fn()
    const bar = mount(Bar, { items: [compareItem(gpu(3))], notice: { kind: 'category', text: '같은 카테고리만' }, showLink: false, onReplace })
    await click(button(bar.root, '비교함 비우고 담기'))
    expect(onReplace).toHaveBeenCalled()
    expect(link(bar.root, '비교하기')).toBeNull()
  })

  test('사진이 깨지면 대체 이미지', async () => {
    const bar = mount(Bar, { items: [{ ...compareItem(gpu(3)), thumbnail_url: '/broken.webp' }] })
    const image = find(bar.root, (node) => node.type === 'img')
    expect(image.props.src).toBe('/broken.webp')
    image.props.onError()
    await flush()
    expect(find(bar.root, (node) => node.type === 'img').props.src).toBe('/product-placeholder.svg')
  })
})

describe('상품 카드 목록(ProductGrid)의 비교 토글·노출·클릭', () => {
  let Grid
  beforeAll(async () => { Grid = await compileSfc('components/ProductGrid.vue') })

  test('비교 버튼은 카드 링크 밖(카드 뒤)의 button, aria-pressed 와 이름이 담김 상태를 따른다', async () => {
    const onToggleCompare = jest.fn()
    const onSelect = jest.fn()
    const grid = mount(Grid, { products: [gpu(3), gpu(4)], label: '그래픽카드 목록', compareIds: [4], onToggleCompare, onSelect })
    const items = findAll(grid.root, (node) => node.type === 'li')
    // 담기 줄(addingIds·타몰 비교 문구)이 없으면 자리 표시 주석만 남는다
    expect(items[0].children.filter((node) => node.type !== '#comment').map((node) => node.props['data-stub'] || node.type)).toEqual(['ProductCard', 'button'])
    const buttons = findAll(grid.root, (node) => node.type === 'button')
    expect(buttons.map((node) => [node.props['aria-label'], node.props['aria-pressed'], node.props.type])).toEqual([
      ['지포스 RTX 3 비교함에 담기', false, 'button'],
      ['지포스 RTX 4 비교함에서 빼기', true, 'button'],
    ])
    expect(buttons.map(text)).toEqual(['+ 비교', '비교 중'])
    await click(buttons[0])
    expect(onToggleCompare).toHaveBeenCalledWith(gpu(3))
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('비교함을 쓸 수 없으면(compareIds null) 비교 버튼이 없다(li 안에는 카드 링크 하나)', () => {
    const grid = mount(Grid, { products: [gpu(3)] })
    expect(findAll(grid.root, (node) => node.type === 'button')).toEqual([])
  })

  test('카드를 누르면 select(상품, 칸 순서). 카드 li 를 observeItem 에 넘긴다', async () => {
    const onSelect = jest.fn()
    const observeItem = jest.fn()
    const grid = mount(Grid, { products: [gpu(3), gpu(4)], observeItem, onSelect })
    const items = findAll(grid.root, (node) => node.type === 'li')
    expect(observeItem).toHaveBeenCalledWith(items[0], gpu(3), 0)
    expect(observeItem).toHaveBeenCalledWith(items[1], gpu(4), 1)
    findAll(grid.root, (node) => node.props['data-stub'] === 'ProductCard')[1].props.onClick()
    expect(onSelect).toHaveBeenCalledWith(gpu(4), 1)
  })
})

describe('상품 목록·상세의 비교 버튼과 막대', () => {
  const fetchProducts = jest.fn()
  const fetchProductFacets = jest.fn()
  const fetchProduct = jest.fn()
  const fetchPriceHistory = jest.fn()
  const fetchProductReviews = jest.fn()
  let storage
  let ProductCatalog
  let ProductDetail

  beforeAll(async () => {
    const browserCompareStorage = () => storage
    // 첫 화면의 보조 영역(가격 요약·하락 줄)과 헤더 상태(siteStatus)는 src/productView.test.mjs 가 본다
    ProductCatalog = await compileSfc('views/ProductCatalog.vue', {
      fetchProducts, fetchProductFacets, browserCompareStorage, track: jest.fn(),
      fetchPriceSummary: async () => ({ product_count: 3, dropping_count: 0, lowest_1y_count: 0 }),
      fetchDropProducts: async () => ({ items: [], total: 0, page: 1, page_size: 10 }),
      siteStatus: { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() },
    })
    ProductDetail = await compileSfc('views/ProductDetail.vue', { fetchProduct, fetchPriceHistory, fetchProductReviews, fetchProductRecommendations: async () => ({ product_id: 3, model: null, items: [] }), browserCompareStorage, track: jest.fn() })
  })
  beforeEach(() => {
    storage = memoryStorage()
    fetchProducts.mockReset().mockResolvedValue({ items: [gpu(3), gpu(4), cpu(9)], total: 3, page: 1, page_size: 20 })
    fetchProductFacets.mockReset().mockResolvedValue({ brands: [], price_min: null, price_max: null })
    fetchProduct.mockReset().mockResolvedValue(gpu(3))
    fetchPriceHistory.mockReset().mockResolvedValue({ items: [], lowest_price_krw: null, highest_price_krw: null })
    fetchProductReviews.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, rating_average: null, rating_counts: {}, my_review: null, can_review: false })
    global.window = { location: { search: '' }, history: { pushState: jest.fn() }, addEventListener: jest.fn(), removeEventListener: jest.fn(), scrollTo: jest.fn() }
  })
  afterEach(() => { delete global.window })

  test('상품 목록: 카드의 비교 토글로 담고 빼며, 막대가 담긴 상품을 받는다. 다른 카테고리는 막대에 안내와 "비우고 담기"', async () => {
    const page = mount(ProductCatalog)
    await flush()
    const grid = () => stub(page.root, 'ProductGrid').props
    const bar = () => stub(page.root, 'ProductCompareBar').props
    expect(grid()['compare-ids']).toEqual([])
    grid().onToggleCompare(gpu(3))
    grid().onToggleCompare(gpu(4))
    await flush()
    expect(grid()['compare-ids']).toEqual([3, 4])
    expect(bar().items.map((item) => item.id)).toEqual([3, 4])
    grid().onToggleCompare(gpu(3))
    await flush()
    expect(grid()['compare-ids']).toEqual([4])
    grid().onToggleCompare(cpu(9))
    await flush()
    expect(bar().notice).toMatchObject({ kind: 'category' })
    bar().onReplace()
    await flush()
    expect(grid()['compare-ids']).toEqual([9])
    expect(bar().notice).toBeNull()
    bar().onRemove(9)
    await flush()
    expect(grid()['compare-ids']).toEqual([])
  })

  test('상품 목록: 깨진 localStorage 값이어도 목록은 그대로(빈 비교함), localStorage 를 쓸 수 없으면 비교 버튼·막대가 없다', async () => {
    storage = { available: true, get: () => '{"items":[{"id":', set: () => true }
    let page = mount(ProductCatalog)
    await flush()
    expect(stub(page.root, 'ProductGrid').props.products).toHaveLength(3)
    expect(stub(page.root, 'ProductGrid').props['compare-ids']).toEqual([])
    storage = unavailable
    page = mount(ProductCatalog)
    await flush()
    expect(stub(page.root, 'ProductGrid').props.products).toHaveLength(3)
    expect(stub(page.root, 'ProductGrid').props['compare-ids']).toBeNull()
    expect(stub(page.root, 'ProductCompareBar')).toBeNull()
  })

  test('상품 상세: "비교함에 담기"/"비교함에서 빼기" 버튼은 구매 영역 밖에 있고 막대에 반영된다', async () => {
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    const purchase = stub(page.root, 'ProductPurchaseCard')
    expect(button(purchase, '비교함')).toBeNull()
    await click(button(page.root, '비교함에 담기'))
    expect(stub(page.root, 'ProductCompareBar').props.items.map((item) => item.id)).toEqual([3])
    expect(storage.saved().items.map((item) => item.id)).toEqual([3])
    await click(button(page.root, '비교함에서 빼기'))
    expect(button(page.root, '비교함에 담기')).not.toBeNull()
    expect(stub(page.root, 'ProductCompareBar').props.items).toEqual([])
  })

  test('상품 상세: localStorage 를 쓸 수 없으면 비교 버튼이 없고 상세는 그대로 보인다', async () => {
    storage = unavailable
    const page = mount(ProductDetail, { productId: 3 })
    await flush()
    expect(button(page.root, '비교함에 담기')).toBeNull()
    expect(stub(page.root, 'ProductPurchaseCard')).not.toBeNull()
  })
})
