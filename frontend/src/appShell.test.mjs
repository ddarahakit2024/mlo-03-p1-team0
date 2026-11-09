// 앱 껍데기(index.html, 전역 CSS, public 파일, 헤더)에 이전 프로젝트(여행 블로그) 잔재나 쓰지 않는 파일이 남지 않게 하고,
// 다크 테마 토큰과 헤더(메뉴·프로필 드롭다운)가 spec(docs/specs/2026-11-01-community-dark-theme.md)과 같은지 본다.
// 헤더·하단 탭·바닥글·토스트는 MOA Parts 디자인(헤더 배지·알림 점·하단 탭 막대). 배지 숫자·토스트는 가짜 API 를 넣은 siteStatus 로 확인한다.
import { jest } from '@jest/globals'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthSession } from './stores/authSession.js'
import { createSiteStatus } from './stores/siteStatus.js'
import { button, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, text } from './testing/sfc.mjs'

const SRC = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(SRC, '..')

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]))
}

const indexHtml = readFileSync(join(FRONTEND, 'index.html'), 'utf8')
const appSources = listFiles(SRC)
  .filter((file) => /\.(vue|m?js)$/.test(file) && !file.endsWith('.test.mjs') && !relative(SRC, file).startsWith('testing'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

test('브라우저 탭 제목은 쇼핑몰 이름이다', () => {
  const title = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1] || ''
  expect(title).toContain('MOA Parts')
  expect(title).not.toMatch(/여행/)
})

test.each(['assets/style.css', 'assets/questions.css', 'assets/shop.css'])('%s 의 클래스는 모두 화면·컴포넌트에서 쓴다', (path) => {
  const css = readFileSync(join(SRC, path), 'utf8').replace(/@import[^;]+;/g, '').replace(/url\([^)]*\)/g, '')
  const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]))]
  const unused = classes.filter((name) => !new RegExp(`(^|[^\\w-])${name}(?![\\w-])`).test(appSources))
  expect(unused).toEqual([])
})

// 상품 사진(/images/products/)은 화면 코드가 아니라 백엔드 상품 데이터(thumbnail_url)가 가리킨다.
// thumbnail_url 은 상품 카탈로그(app/catalog/*.json)의 image.file 에서 만든다(docs/specs/2026-11-01-product-catalog.md)
const PRODUCT_IMAGE_DIR = '/images/products/'
const CATALOG_DIR = resolve(FRONTEND, '..', 'app', 'catalog')
const catalogImages = new Set(readdirSync(CATALOG_DIR)
  .filter((name) => name.endsWith('.json'))
  .flatMap((name) => JSON.parse(readFileSync(join(CATALOG_DIR, name), 'utf8')))
  .map((product) => `${PRODUCT_IMAGE_DIR}${product.image.file}`))

test('public 의 파일은 모두 앱에서 쓴다(상품 사진은 상품 카탈로그에서)', () => {
  const files = listFiles(join(FRONTEND, 'public')).map((file) => `/${relative(join(FRONTEND, 'public'), file).split('\\').join('/')}`)
  const assetSources = appSources + listFiles(SRC).filter((file) => file.endsWith('.css')).map((file) => readFileSync(file, 'utf8')).join('\n')
  expect(files.length).toBeGreaterThan(0)
  expect(catalogImages.size).toBeGreaterThan(0)
  const unused = files.filter((file) => (file.startsWith(PRODUCT_IMAGE_DIR)
    ? !catalogImages.has(file)
    : !assetSources.includes(file) && !indexHtml.includes(file)))
  expect(unused).toEqual([])
})

describe('다크 테마 토큰', () => {
  const styleCss = readFileSync(join(SRC, 'assets', 'style.css'), 'utf8')

  test.each([
    ['--bg', '#121417'], ['--surface', '#1a1d22'], ['--surface-2', '#20242a'], ['--surface-3', '#2b3038'],
    ['--line', '#2b3038'], ['--line-strong', '#525b68'], ['--ink', '#f3f4f6'], ['--muted', '#a6adb8'],
    ['--brand', '#ff7a1a'], ['--brand-strong', '#ff913f'], ['--brand-ink', '#121417'], ['--focus', '#ffae70'],
    ['--danger', '#ff7b80'], ['--success', '#3ecf8e'], ['--warning', '#f5c76b'], ['--image-bg', '#ffffff'],
  ])('style.css :root 에 %s 가 spec 값(%s)으로 있다', (name, value) => {
    expect(styleCss).toMatch(new RegExp(`${name}:\\s*${value};`, 'i'))
  })

  // 화면 CSS(.vue 의 <style>, src/assets/*.css)는 16진수 색·white 를 쓰지 않고 style.css 의 토큰만 쓴다(옛 보라색·흰 배경이 남지 않게)
  const styleSources = listFiles(SRC)
    .filter((file) => (file.endsWith('.vue') || (file.endsWith('.css') && !file.endsWith('style.css'))) && !relative(SRC, file).startsWith('testing'))
    .map((file) => {
      const source = readFileSync(file, 'utf8')
      const css = file.endsWith('.vue') ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n') : source
      return [relative(SRC, file).split('\\').join('/'), css]
    })

  test.each(styleSources)('%s 의 CSS 에 하드코딩 색(16진수, white)이 없다', (_file, css) => {
    const hardcoded = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|(?<![\w-])white(?![\w-])/g)].map((match) => match[0])
    expect(hardcoded).toEqual([])
  })
})

describe('SiteLayout 헤더: 메뉴와 프로필 드롭다운', () => {
  const fetchCurrentUser = jest.fn()
  const logout = jest.fn()
  const goToMain = jest.fn()
  const flushEvents = jest.fn()
  const track = jest.fn()
  const fetchCart = jest.fn()
  const fetchUnreadCount = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser, logout })
  let storedCompareCount = 0
  // 헤더 공용 상태(배지·토스트): 실제 저장소에 가짜 API·비교함·타이머를 넣는다
  const siteStatus = createSiteStatus({ session: authSession, fetchCart, fetchUnreadCount, compareCount: () => storedCompareCount, setTimer: () => 1, clearTimer: () => {} })
  const member = { id: 1, name: '김조립', email: 'builder@example.com' }
  let SiteLayout

  beforeAll(async () => { SiteLayout = await compileSfc('components/SiteLayout.vue', { authSession, siteStatus, goToMain, flushEvents, track }) })
  beforeEach(() => {
    for (const mock of [fetchCurrentUser, logout, goToMain, flushEvents, track, fetchCart, fetchUnreadCount]) mock.mockReset()
    fetchCurrentUser.mockResolvedValue(member)
    fetchCart.mockResolvedValue({ item_count: 0 })
    fetchUnreadCount.mockResolvedValue({ unread_count: 0 })
    flushEvents.mockResolvedValue(undefined)
    storedCompareCount = 0
    authSession.reset()
    siteStatus.reset()
  })

  const navLinks = (root) => findAll(find(root, (node) => node.type === 'nav'), (node) => node.type === 'a')
    .map((node) => [text(node), node.props.href, node.props['aria-current']])
  const tabBar = (root) => find(root, (node) => node.type === 'nav' && node.props['aria-label'] === '하단 메뉴')
  const tabLinks = (root) => findAll(tabBar(root), (node) => node.type === 'a').map((node) => [text(node), node.props.href, node.props['aria-current']])
  const headerLink = (root, href) => find(find(root, (node) => node.type === 'header'), (node) => node.type === 'a' && node.props.href === href)
  const panelLinks = (root) => findAll(panel(root), (node) => node.type === 'a')
  const menu = (root) => find(root, (node) => node.props.class === 'site-menu')
  const profileButton = (root) => find(root, (node) => node.type === 'button' && node.props['aria-controls'] === 'site-profile-menu')
  const panel = (root) => find(root, (node) => node.props.id === 'site-profile-menu')
  const isOpen = (root) => profileButton(root).props['aria-expanded'] === true && panel(root).props.hidden === false
  const isClosed = (root) => profileButton(root).props['aria-expanded'] === false && panel(root).props.hidden === true
  // 가짜 DOM 노드에는 contains 가 없어서, 메뉴 안의 노드인지 트리를 따라 확인하는 함수를 붙인다
  const withContains = (root) => {
    const node = menu(root)
    node.contains = (target) => findAll(node, (child) => child === target).length > 0
    return node
  }
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))

  async function render(activePage = 'products') {
    const layout = mount(SiteLayout, { activePage })
    await flush()
    return layout
  }

  test.each([
    ['products', [['상품', '/products', 'page'], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', undefined]]],
    ['alerts', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', 'page'], ['커뮤니티', '/community', undefined]]],
    ['community', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', 'page']]],
    ['questions', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', 'page']]],
    ['my', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', undefined]]],
    ['cart', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', undefined]]],
    ['auth', [['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', undefined]]],
  ])('주요 메뉴는 상품·가격 추적·커뮤니티 세 개이고 active-page=%s 를 aria-current 로 표시한다', async (activePage, expected) => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const layout = await render(activePage)
    expect(find(layout.root, (node) => node.type === 'nav').props['aria-label']).toBe('주요 메뉴')
    expect(navLinks(layout.root)).toEqual(expected)
  })

  test('비로그인이면 로그인 링크만 있고 프로필 버튼·메뉴(마이페이지·주문 내역)·로그아웃이 없다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const layout = await render('products')
    expect(link(layout.root, '로그인').props.href).toBe('/login')
    expect(profileButton(layout.root)).toBeNull()
    expect(panel(layout.root)).toBeNull()
    expect(link(layout.root, '마이페이지')).toBeNull()
    expect(link(layout.root, '주문 내역')).toBeNull()
    expect(button(layout.root, '로그아웃')).toBeNull()
  })

  test('로그인하면 동그란 첫 글자 프로필 버튼(숨김 글자 이름, aria-expanded, aria-controls)이 보이고 드롭다운은 닫혀 있다', async () => {
    const layout = await render('products')
    expect(link(layout.root, '로그인')).toBeNull()
    const profile = profileButton(layout.root)
    expect(profile.props).toMatchObject({ type: 'button', 'aria-expanded': false, 'aria-controls': 'site-profile-menu' })
    expect(text(find(profile, (node) => node.props.class === 'site-profile__avatar'))).toBe('김')
    expect(text(find(profile, (node) => node.props.class === 'sr-only'))).toBe('김조립 계정 메뉴')
    expect(panel(layout.root).props.hidden).toBe(true)
    expect(text(panel(layout.root))).toContain('김조립님')
    expect(panelLinks(layout.root).map((node) => [text(node), node.props.href])).toEqual([
      ['마이페이지', '/my'],
      ['장바구니', '/cart'],
      ['주문 내역', '/orders'],
    ])
    expect(button(panel(layout.root), '로그아웃')).not.toBeNull()
  })

  test.each([['my'], ['alerts']])('active-page=%s 이면 메뉴의 "마이페이지"에 aria-current="page"', async (activePage) => {
    const layout = await render(activePage)
    expect(link(panel(layout.root), '마이페이지').props['aria-current']).toBe('page')
    expect(String(profileButton(layout.root).props.class)).toContain('site-profile--current')
  })

  // spec docs/specs/2026-11-01-returns-refunds.md: GET /user/me 의 role 이 admin 이면 "반품 관리". 시뮬레이터는 링크를 이름(exact)으로 찾으므로 기존 두 링크는 그대로다
  // spec docs/specs/2026-11-03-product-recommendations.md(2026-11-03 승인): "반품 관리" 아래에 "추천 학습"(/admin/recommendations)도 관리자만
  test('관리자(role admin)면 드롭다운의 주문 내역 뒤에 "반품 관리"(/admin/returns)와 "추천 학습"(/admin/recommendations)이 있다. 관리자 화면(active-page 빈 값)은 아무것도 강조하지 않는다', async () => {
    fetchCurrentUser.mockResolvedValue({ ...member, role: 'admin' })
    const layout = await render('')
    expect(panelLinks(layout.root).map((node) => [text(node), node.props.href, node.props['aria-current']])).toEqual([
      ['마이페이지', '/my', undefined],
      ['장바구니', '/cart', undefined],
      ['주문 내역', '/orders', undefined],
      ['반품 관리', '/admin/returns', undefined],
      ['추천 학습', '/admin/recommendations', undefined],
    ])
    expect(String(profileButton(layout.root).props.class)).not.toContain('site-profile--current')
    expect(navLinks(layout.root)).toEqual([['상품', '/products', undefined], ['가격 추적', '/my?tab=alerts', undefined], ['커뮤니티', '/community', undefined]])
  })

  test.each([[null], ['member'], [undefined]])('role 이 admin 이 아니면(%p) "반품 관리"·"추천 학습" 링크가 없다', async (role) => {
    fetchCurrentUser.mockResolvedValue({ ...member, role })
    const layout = await render('orders')
    expect(link(layout.root, '반품 관리')).toBeNull()
    expect(link(layout.root, '추천 학습')).toBeNull()
    expect(panelLinks(layout.root).map(text)).toEqual(['마이페이지', '장바구니', '주문 내역'])
  })

  test('비로그인이면 "반품 관리"·"추천 학습"도 없다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const layout = await render('')
    expect(link(layout.root, '반품 관리')).toBeNull()
    expect(link(layout.root, '추천 학습')).toBeNull()
  })

  test('프로필 버튼을 누르면 열리고 다시 누르면 닫힌다', async () => {
    const layout = await render('products')
    await click(profileButton(layout.root))
    expect(isOpen(layout.root)).toBe(true)
    await click(profileButton(layout.root))
    expect(isClosed(layout.root)).toBe(true)
  })

  test('마우스를 올리면 열리고, 벗어나면 잠시 뒤 닫힌다. 그 사이 패널로 들어오면 닫히지 않는다', async () => {
    const layout = await render('products')
    menu(layout.root).props.onMouseenter()
    await flush()
    expect(isOpen(layout.root)).toBe(true)

    menu(layout.root).props.onMouseleave()
    await flush()
    expect(isOpen(layout.root)).toBe(true)
    menu(layout.root).props.onMouseenter()
    await wait(260)
    await flush()
    expect(isOpen(layout.root)).toBe(true)

    menu(layout.root).props.onMouseleave()
    await wait(260)
    await flush()
    expect(isClosed(layout.root)).toBe(true)
  })

  test('터치처럼 mouseenter 바로 뒤에 누르면(click) 닫히지 않고 열려 있다. 한 번 더 누르면 닫힌다', async () => {
    const layout = await render('products')
    menu(layout.root).props.onMouseenter()
    await click(profileButton(layout.root))
    expect(isOpen(layout.root)).toBe(true)
    await click(profileButton(layout.root))
    expect(isClosed(layout.root)).toBe(true)
  })

  test('키보드(Tab)로 버튼에 포커스하면 열리고, 마우스로 누를 때의 포커스(:focus-visible 아님)로는 열리지 않는다', async () => {
    const layout = await render('products')
    profileButton(layout.root).props.onFocus({ target: { matches: () => false } })
    await flush()
    expect(isClosed(layout.root)).toBe(true)
    profileButton(layout.root).props.onFocus({ target: { matches: (selector) => selector === ':focus-visible' } })
    await flush()
    expect(isOpen(layout.root)).toBe(true)
  })

  test('Esc 를 누르면 닫히고 프로필 버튼으로 포커스가 돌아간다(돌아간 포커스로 다시 열리지 않는다)', async () => {
    const layout = await render('products')
    await click(profileButton(layout.root))
    const profile = profileButton(layout.root)
    profile.focus = jest.fn(() => profile.props.onFocus({ target: { matches: () => true } }))
    menu(layout.root).props.onKeydown({ key: 'Enter' })
    await flush()
    expect(isOpen(layout.root)).toBe(true)
    menu(layout.root).props.onKeydown({ key: 'Escape' })
    await flush()
    expect(isClosed(layout.root)).toBe(true)
    expect(profile.focus).toHaveBeenCalledTimes(1)
  })

  test('Tab 으로 메뉴 밖으로 포커스가 나가면 닫히고, 메뉴 안에서 옮겨 가면 열려 있다', async () => {
    const layout = await render('products')
    await click(profileButton(layout.root))
    const node = withContains(layout.root)
    node.props.onFocusout({ relatedTarget: link(panel(layout.root), '장바구니') })
    await flush()
    expect(isOpen(layout.root)).toBe(true)
    node.props.onFocusout({ relatedTarget: { type: 'a' } })
    await flush()
    expect(isClosed(layout.root)).toBe(true)
  })

  describe('문서(document) 이벤트', () => {
    let listeners
    beforeEach(() => {
      listeners = {}
      globalThis.document = {
        addEventListener: jest.fn((type, handler) => { listeners[type] = handler }),
        removeEventListener: jest.fn((type) => { delete listeners[type] }),
      }
    })
    afterEach(() => { delete globalThis.document })

    test('메뉴 바깥을 누르면 닫히고, 메뉴 안을 누르면 열려 있다', async () => {
      const layout = await render('products')
      await click(profileButton(layout.root))
      withContains(layout.root)
      listeners.click({ target: link(panel(layout.root), '주문 내역') })
      await flush()
      expect(isOpen(layout.root)).toBe(true)
      listeners.click({ target: { type: 'main' } })
      await flush()
      expect(isClosed(layout.root)).toBe(true)
    })

    test('포커스가 메뉴 밖에 있어도 Esc 를 누르면 닫는다. 화면을 떠나면 문서 이벤트를 해제한다', async () => {
      const layout = await render('products')
      menu(layout.root).props.onMouseenter()
      await flush()
      listeners.keydown({ key: 'Escape' })
      await flush()
      expect(isClosed(layout.root)).toBe(true)
      layout.unmount()
      expect(globalThis.document.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function))
      expect(globalThis.document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })

  test.each([
    ['cart', '장바구니', '주문 내역'],
    ['orders', '주문 내역', '장바구니'],
  ])('active-page=%s 이면 드롭다운의 "%s" 링크에 aria-current="page" 가 있다', async (activePage, current, other) => {
    const layout = await render(activePage)
    await click(profileButton(layout.root))
    expect(link(panel(layout.root), current).props['aria-current']).toBe('page')
    expect(link(panel(layout.root), other).props['aria-current']).toBeUndefined()
    expect(navLinks(layout.root).every(([, , ariaCurrent]) => ariaCurrent === undefined)).toBe(true)
  })

  test('드롭다운의 로그아웃: 쌓인 이벤트를 먼저 보내고 → 로그아웃 → logout 이벤트 → 첫 화면으로 이동한다', async () => {
    const order = []
    const response = deferred()
    flushEvents.mockImplementation(async () => { order.push('flush') })
    logout.mockImplementation(() => { order.push('logout'); return response.promise })
    track.mockImplementation((type) => { order.push(`track:${type}`) })
    goToMain.mockImplementation(() => { order.push('goToMain') })
    const layout = await render('products')
    await click(profileButton(layout.root))
    button(panel(layout.root), '로그아웃').props.onClick()
    await flush()
    expect(button(panel(layout.root), '로그아웃 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    response.resolve(null)
    await flush()
    expect(order).toEqual(['flush', 'logout', 'track:logout', 'goToMain'])
    expect(byRole(layout.root, 'alert')).toHaveLength(0)
  })

  test('드롭다운의 로그아웃이 실패하면 이동하지 않고 안내(role=alert)를 보여 주며 메뉴와 버튼을 다시 쓸 수 있다', async () => {
    logout.mockRejectedValue({ isAxiosError: true, code: 'ERR_NETWORK' })
    const layout = await render('products')
    await click(profileButton(layout.root))
    await click(button(panel(layout.root), '로그아웃'))
    expect(goToMain).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
    expect(text(byRole(layout.root, 'alert')[0])).toBe('서버에 연결하지 못해 로그아웃하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    expect(isOpen(layout.root)).toBe(true)
    expect(button(panel(layout.root), '로그아웃').props.disabled).toBe(false)
  })

  test('헤더: 로고(/images/logo.png)와 MOA Parts 홈 링크, 검색 폼은 GET /products(name search, 숨은 search_action)', async () => {
    const layout = await render('products')
    const brand = headerLink(layout.root, '/')
    expect(brand.props['aria-label']).toBe('MOA Parts 홈')
    expect(find(brand, (node) => node.type === 'img').props).toMatchObject({ src: '/images/logo.png', alt: '' })
    const form = find(layout.root, (node) => node.type === 'form')
    expect(form.props).toMatchObject({ action: '/products', role: 'search' })
    // 바뀌지 않는 폼 안쪽은 Vue 가 HTML 문자열(정적 노드)로 만든다
    const html = findAll(form, (node) => node.type === '#static').map((node) => node.text).join('')
    expect(html).toContain('<input name="search_action" type="hidden" value="submit">')
    expect(html).toContain('<label class="sr-only" for="site-search">부품 이름, 모델명 검색</label>')
    expect(html).toMatch(/<input id="site-search" name="search" type="search"[^>]*placeholder="부품 이름, 모델명 검색 \(예: RTX 4070, DDR5\)"/)
    expect(html).toContain('<button type="submit" aria-label="상품 검색">')
  })

  test('show-search=false 이면 헤더 검색 폼이 없다(상품 목록은 자기 검색창을 쓴다)', async () => {
    const layout = mount(SiteLayout, { activePage: 'products', showSearch: false })
    await flush()
    expect(find(layout.root, (node) => node.type === 'form')).toBeNull()
  })

  test('비교·장바구니·알림 아이콘: 숫자가 없으면 배지·점 없이 이름만', async () => {
    const layout = await render('products')
    expect(fetchCart).toHaveBeenCalledTimes(1)
    expect(headerLink(layout.root, '/compare').props['aria-label']).toBe('상품 비교')
    expect(headerLink(layout.root, '/cart').props['aria-label']).toBe('장바구니')
    const bell = headerLink(layout.root, '/my?tab=notifications')
    expect(bell.props['aria-label']).toBe('알림')
    expect(find(bell, (node) => node.props.class === 'site-dot')).toBeNull()
    expect(findAll(layout.root, (node) => String(node.props.class).includes('site-badge'))).toHaveLength(0)
  })

  test('회원이면 siteStatus 가 불러온 숫자로 배지(비교함·장바구니)와 빨간 점(읽지 않은 알림)을 그리고, 이름에 숫자를 넣는다', async () => {
    fetchCart.mockResolvedValue({ item_count: 3 })
    fetchUnreadCount.mockResolvedValue({ unread_count: 4 })
    storedCompareCount = 2
    const layout = await render('products')
    const compare = headerLink(layout.root, '/compare')
    const cart = headerLink(layout.root, '/cart')
    const bell = headerLink(layout.root, '/my?tab=notifications')
    expect(compare.props['aria-label']).toBe('상품 비교, 비교함 2개')
    expect(text(find(compare, (node) => node.props.class === 'site-badge'))).toBe('2')
    expect(cart.props['aria-label']).toBe('장바구니, 3개 담김')
    expect(text(find(cart, (node) => node.props.class === 'site-badge'))).toBe('3')
    expect(bell.props['aria-label']).toBe('알림, 읽지 않은 알림 4개')
    expect(find(bell, (node) => node.props.class === 'site-dot').props['aria-hidden']).toBe('true')
    // 화면이 숫자를 바꾸면 헤더가 따라간다(다시 부르지 않는다)
    siteStatus.setCartCount(120)
    siteStatus.setUnreadCount(0)
    await flush()
    expect(text(find(cart, (node) => node.props.class === 'site-badge'))).toBe('99+')
    expect(headerLink(layout.root, '/my?tab=notifications').props['aria-label']).toBe('알림')
    expect(fetchCart).toHaveBeenCalledTimes(1)
  })

  test('비회원이면 장바구니·알림 숫자를 부르지 않는다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    await render('products')
    expect(fetchCart).not.toHaveBeenCalled()
    expect(fetchUnreadCount).not.toHaveBeenCalled()
  })

  test.each([
    ['products', null, [['상품', '/products', 'page'], ['커뮤니티', '/community', undefined], ['비교', '/compare', undefined], ['장바구니', '/cart', undefined], ['마이', '/my', undefined]]],
    ['questions', null, [['상품', '/products', undefined], ['커뮤니티', '/community', 'page'], ['비교', '/compare', undefined], ['장바구니', '/cart', undefined], ['마이', '/my', undefined]]],
    ['compare', null, [['상품', '/products', undefined], ['커뮤니티', '/community', undefined], ['비교', '/compare', 'page'], ['장바구니', '/cart', undefined], ['마이', '/my', undefined]]],
    ['cart', null, [['상품', '/products', undefined], ['커뮤니티', '/community', undefined], ['비교', '/compare', undefined], ['장바구니', '/cart', 'page'], ['마이', '/my', undefined]]],
    ['alerts', null, [['상품', '/products', undefined], ['커뮤니티', '/community', undefined], ['비교', '/compare', undefined], ['장바구니', '/cart', undefined], ['마이', '/my', 'page']]],
    ['auth', { response: { status: 401 } }, [['상품', '/products', undefined], ['커뮤니티', '/community', undefined], ['비교', '/compare', undefined], ['장바구니', '/cart', undefined], ['마이', '/login', 'page']]],
  ])('하단 탭 막대(nav "하단 메뉴"): active-page=%s 를 aria-current 로, 비회원의 "마이"는 /login', async (activePage, failure, expected) => {
    if (failure) fetchCurrentUser.mockRejectedValue(failure)
    const layout = await render(activePage)
    expect(tabLinks(layout.root)).toEqual(expected)
  })

  test('하단 탭의 비교·장바구니 배지는 숨김 글자로도 읽힌다', async () => {
    fetchCart.mockResolvedValue({ item_count: 1 })
    storedCompareCount = 3
    const layout = await render('products')
    const [, , compare, cart] = findAll(tabBar(layout.root), (node) => node.type === 'a')
    expect(text(compare)).toBe('비교3, 비교함 3개')
    expect(text(cart)).toBe('장바구니1, 1개 담김')
    expect(find(compare, (node) => String(node.props.class).includes('site-tabbar__badge')).props['aria-hidden']).toBe('true')
  })

  test('토스트: siteStatus.showToast 의 문구를 role=status·aria-live=polite 영역에 보여 주고, 사라지면 영역만 남는다', async () => {
    const layout = await render('products')
    const region = () => find(layout.root, (node) => node.props.class === 'site-toast-region')
    expect(region().props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(text(region())).toBe('')
    siteStatus.showToast('장바구니에 담았어요')
    await flush()
    expect(text(find(region(), (node) => node.props.class === 'site-toast'))).toBe('장바구니에 담았어요')
    siteStatus.dismissToast()
    await flush()
    expect(text(region())).toBe('')
  })

  test('바닥글: 로고·MOA Parts·"내 PC에 맞는 부품을 가장 좋은 가격에"·© 올해', async () => {
    const layout = await render('products')
    const footer = find(layout.root, (node) => node.type === 'footer')
    expect(find(footer, (node) => node.type === 'img').props).toMatchObject({ src: '/images/logo.png', alt: '' })
    expect(link(footer, 'MOA Parts').props.href).toBe('/')
    expect(text(footer)).toContain('내 PC에 맞는 부품을 가장 좋은 가격에')
    expect(text(footer)).toContain(`© ${new Date().getFullYear()} MOA Parts`)
  })

  test('화면을 떠나면 로그인 상태·헤더 숫자 구독을 해제한다', async () => {
    const layout = await render('products')
    layout.unmount()
    siteStatus.setCartCount(5)
    expect(() => siteStatus.showToast('남은 구독 없음')).not.toThrow()
  })
})
