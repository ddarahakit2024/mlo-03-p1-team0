// 기능 확장 1차의 공용 컴포넌트: InlineConfirm(화면 안 확인), ProductRating(평점 요약), ProductCard(NEW·평점), SiteLayout(로그아웃).
import { jest } from '@jest/globals'
import { button, byRole, click, compileSfc, deferred, find, flush, link, mount, stub, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'
import { logoutError } from './stores/authViewModel.js'

describe('InlineConfirm', () => {
  let InlineConfirm
  beforeAll(async () => { InlineConfirm = await compileSfc('components/InlineConfirm.vue') })

  test('기본 문구 "삭제할까요? 예/아니요"를 묶음(role=group)으로 보여 주고 누른 버튼을 알린다', async () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    const view = mount(InlineConfirm, { onConfirm, onCancel })
    const group = byRole(view.root, 'group')[0]
    expect(group.props['aria-label']).toBe('삭제할까요?')
    expect(text(group)).toBe('삭제할까요?예아니요')
    await click(button(view.root, '예'))
    await click(button(view.root, '아니요'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('Esc 는 취소이고, 진행 중(busy)에는 두 버튼을 막고 진행 문구를 보여 주며 Esc 도 무시한다', async () => {
    const onCancel = jest.fn()
    const view = mount(InlineConfirm, { message: '이 답변을 삭제할까요?', onCancel })
    byRole(view.root, 'group')[0].props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    expect(onCancel).toHaveBeenCalledTimes(1)
    const busy = mount(InlineConfirm, { message: '이 답변을 삭제할까요?', busy: true, onCancel })
    expect(text(busy.root)).toContain('이 답변을 삭제할까요?')
    expect(button(busy.root, '삭제 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    expect(button(busy.root, '아니요').props.disabled).toBe(true)
    byRole(busy.root, 'group')[0].props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('버튼 문구를 바꿀 수 있다', () => {
    const view = mount(InlineConfirm, { message: '정말 지울까요?', confirmLabel: '지우기', cancelLabel: '그대로 두기' })
    expect(button(view.root, '지우기')).not.toBeNull()
    expect(button(view.root, '그대로 두기')).not.toBeNull()
  })
})

describe('ProductRating', () => {
  let ProductRating
  beforeAll(async () => { ProductRating = await compileSfc('components/ProductRating.vue') })

  test('"★ 4.5 (12)" 를 그림(role=img)과 읽을 이름으로 보여 준다', () => {
    const view = mount(ProductRating, { average: 4.5, count: 12 })
    const rating = byRole(view.root, 'img')[0]
    expect(text(rating)).toBe('★ 4.5 (12)')
    expect(rating.props['aria-label']).toBe('평점 5점 만점에 4.5점, 리뷰 12개')
  })

  test.each([[{ average: null, count: 0 }], [{ average: 4.5, count: 0 }], [{}]])('리뷰가 없으면 아무것도 그리지 않는다(%o)', (props) => {
    const view = mount(ProductRating, props)
    expect(text(view.root)).toBe('')
  })
})

describe('ProductCard 의 NEW·평점', () => {
  const gpu = { id: 3, name: '지포스 RTX 4070 SUPER 12GB', brand: 'MSI', category: 'gpu', price_krw: 899000, stock: 7, thumbnail_url: '', summary: 'QHD 게이밍용' }
  let ProductCard
  beforeAll(async () => { ProductCard = await compileSfc('components/ProductCard.vue') })

  test('신제품이면 NEW 배지, 평점 요약에는 서버 값(rating_average, review_count)을 넘기고 앞에 " · " 구분을 둔다', () => {
    const card = mount(ProductCard, { product: { ...gpu, is_new: true, rating_average: 4.5, review_count: 12 } })
    const badge = find(card.root, (node) => node.props.class?.includes?.('product-card__badge'))
    expect(text(badge)).toBe('NEW')
    expect(badge.props.class).toContain('product-card__badge--new')
    expect(stub(card.root, 'ProductRating').props).toMatchObject({ average: 4.5, count: 12 })
    expect(text(find(card.root, (node) => node.props.class === 'product-card__meta'))).toBe('MSI · 그래픽카드 · ')
  })

  test('신제품이 아니면 NEW 가 없고, 평점 값이 없으면 null·0 을 넘긴다', () => {
    const card = mount(ProductCard, { product: { ...gpu, is_new: false } })
    expect(text(card.root)).not.toContain('NEW')
    expect(stub(card.root, 'ProductRating').props).toMatchObject({ average: null, count: 0 })
  })
})

describe('SiteLayout 로그아웃', () => {
  const fetchCurrentUser = jest.fn()
  const logout = jest.fn()
  const goToMain = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser, logout })
  // 헤더 숫자·토스트(siteStatus)는 가짜를 넣는다(실제 저장소는 GET /cart 등을 부른다)
  const siteStatus = { state: { cartCount: 0, compareCount: 0, unreadCount: 0, toast: null }, load: jest.fn(), subscribe: (listener) => { listener(siteStatus.state); return () => {} } }
  let SiteLayout

  beforeAll(async () => { SiteLayout = await compileSfc('components/SiteLayout.vue', { authSession, siteStatus, goToMain }) })
  beforeEach(() => {
    fetchCurrentUser.mockReset().mockResolvedValue({ id: 1, name: '김조립' })
    logout.mockReset()
    goToMain.mockReset()
    authSession.reset()
  })

  test('비로그인이면 로그아웃 버튼이 없다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    expect(button(layout.root, '로그아웃')).toBeNull()
    expect(link(layout.root, '로그인').props.href).toBe('/login')
  })

  test('로그아웃 중에는 버튼을 막아 한 번만 보내고, 성공하면 첫 화면(/)으로 이동한다', async () => {
    const response = deferred()
    logout.mockReturnValue(response.promise)
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    const signOut = button(layout.root, '로그아웃').props.onClick
    signOut()
    signOut()
    await flush()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(button(layout.root, '로그아웃 중...').props).toMatchObject({ disabled: true, 'aria-busy': true })
    response.resolve(null)
    await flush()
    expect(goToMain).toHaveBeenCalledTimes(1)
    expect(byRole(layout.root, 'alert')).toHaveLength(0)
  })

  test('실패하면 이동하지 않고 안내(role=alert)를 보여 주며 다시 누를 수 있다', async () => {
    logout.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Origin not allowed' } } }).mockResolvedValueOnce(null)
    const layout = mount(SiteLayout, { activePage: 'products' })
    await flush()
    await click(button(layout.root, '로그아웃'))
    expect(goToMain).not.toHaveBeenCalled()
    expect(text(byRole(layout.root, 'alert')[0])).toBe('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(button(layout.root, '로그아웃').props.disabled).toBe(false)
    await click(button(layout.root, '로그아웃'))
    expect(logout).toHaveBeenCalledTimes(2)
    expect(goToMain).toHaveBeenCalledTimes(1)
    expect(byRole(layout.root, 'alert')).toHaveLength(0)
  })

  test.each([
    ['네트워크 오류', { isAxiosError: true, code: 'ERR_NETWORK' }, '서버에 연결하지 못해 로그아웃하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'],
    ['403 Origin', { isAxiosError: true, response: { status: 403 } }, '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
    ['500', { response: { status: 500 } }, '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
  ])('로그아웃 실패 문구: %s', (_name, error, message) => expect(logoutError(error)).toBe(message))
})
