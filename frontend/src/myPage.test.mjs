// 마이페이지(views/MyPage.vue): 로그인 확인 중·비로그인(401)·확인 실패 → 다시 시도, 탭(알림·가격 추적·내 글)마다 로딩·성공·빈 목록·오류 → 다시 시도,
// 알림 읽음·모두 읽음, 추적 해제, 탭 주소(replaceState), 로그아웃. 로그인 상태·헤더 숫자는 가짜 저장소(authSession·siteStatus)를 넣는다.
import { jest } from '@jest/globals'
import { createAuthSession } from './stores/authSession.js'
import { createSiteStatus } from './stores/siteStatus.js'
import { button, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, stub, text } from './testing/sfc.mjs'

const fetchCurrentUser = jest.fn()
const logout = jest.fn()
const authSession = createAuthSession({ fetchCurrentUser, logout })
const status = createSiteStatus({ session: authSession, fetchCart: jest.fn(), fetchUnreadCount: jest.fn(), compareCount: () => 0, setTimer: () => 0, clearTimer: () => {} })
// 헤더 공용 상태: 구독·숫자는 실제 저장소, 바꾸는 함수는 jest.fn 으로 감싸 부른 값을 확인한다
const siteStatus = {
  get state() { return status.state },
  subscribe: (listener) => status.subscribe(listener),
  setUnreadCount: jest.fn((value) => status.setUnreadCount(value)),
  showToast: jest.fn(),
}
const fetchNotifications = jest.fn()
const markNotificationRead = jest.fn()
const markAllNotificationsRead = jest.fn()
const fetchAlerts = jest.fn()
const deleteAlert = jest.fn()
const fetchMyPosts = jest.fn()
const goToMain = jest.fn()
const flushEvents = jest.fn()
const track = jest.fn()
const NOW = new Date('2026-11-05T12:00:00Z')
const apiMocks = [fetchCurrentUser, logout, fetchNotifications, markNotificationRead, markAllNotificationsRead, fetchAlerts, deleteAlert, fetchMyPosts, goToMain, flushEvents, track]

const member = { id: 1, name: '서지훈', email: 'jihoon@example.com' }
const notification = (id, extra = {}) => ({
  id, kind: 'price_target', title: '목표가 도달', body: 'RTX 4070 가격이 목표가 700,000원 이하로 내려왔어요. 지금 689,000원',
  product_id: 7, question_id: null, post_id: null, created_at: '2026-11-05T11:55:00Z', read: false, ...extra,
})
const product = (id, extra = {}) => ({
  id, name: `지포스 RTX ${id}`, brand: 'MSI', category: 'gpu', price_krw: 750000, thumbnail_url: `/images/products/${id}.webp`,
  price_trend: { change_30d_pct: -5.2, highest_1y_krw: 800000 }, ...extra,
})
const alert = (id, target, extra = {}) => ({ product_id: id, target_price_krw: target, reached: false, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', product: product(id), ...extra })
const notificationPage = (items, extra = {}) => ({ items, total: items.length, unread_count: items.filter((item) => !item.read).length, page: 1, page_size: 20, ...extra })
const postPage = (items, extra = {}) => ({ items, total: items.length, page: 1, page_size: 20, ...extra })
const myPosts = [
  { kind: 'build', id: 509, title: '150만 원 게임용 견적 부탁드립니다', created_at: '2026-11-04T03:00:00Z', reply_count: 2 },
  { kind: 'question', id: 3, title: '파워 750W 면 충분할까요?', created_at: '2026-11-01T03:00:00Z', reply_count: 1 },
  { kind: 'free', id: 15, title: '첫 조립 후기', created_at: '2026-10-20T03:00:00Z', reply_count: 0 },
]

let MyPage
let page

beforeAll(async () => {
  MyPage = await compileSfc('views/MyPage.vue', {
    authSession, siteStatus, fetchNotifications, markNotificationRead, markAllNotificationsRead, fetchAlerts, deleteAlert, fetchMyPosts,
    goToMain, flushEvents, track, currentTime: () => NOW,
  })
})
beforeEach(() => {
  for (const mock of apiMocks) mock.mockReset()
  siteStatus.setUnreadCount.mockClear()
  siteStatus.showToast.mockClear()
  authSession.reset()
  status.reset()
  fetchCurrentUser.mockResolvedValue(member)
  fetchNotifications.mockResolvedValue(notificationPage([notification(1), notification(2, { kind: 'answer', title: '새 답변', body: "'파워 750W 면 충분할까요?'에 김조립님이 답변했어요", product_id: null, question_id: 3, read: true, created_at: '2026-11-05T09:00:00Z' })]))
  fetchAlerts.mockResolvedValue({ items: [alert(7, 700000), alert(8, 760000, { reached: true, product: product(8, { price_krw: 740000 }) })] })
  fetchMyPosts.mockResolvedValue(postPage(myPosts))
  flushEvents.mockResolvedValue(undefined)
})
afterEach(() => {
  page?.unmount()
  page = null
  delete global.window
})

async function open(search = '') {
  global.window = { location: { search, assign: jest.fn() }, history: { replaceState: jest.fn() } }
  page = mount(MyPage)
  await flush()
  return page
}

const layout = () => stub(page.root, 'SiteLayout').props
const tabButton = (name) => find(page.root, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && text(node) === name)
const notificationItems = () => findAll(find(page.root, (node) => node.props['aria-label'] === '받은 알림'), (node) => node.type === 'li')
const alertCards = () => findAll(page.root, (node) => node.type === 'li' && node.props.class === 'my-watch__card')

describe('로그인 상태', () => {
  test('로그인을 확인하는 동안 로딩(role=status)을 보여 주고 API 를 부르지 않는다', async () => {
    const pending = deferred()
    fetchCurrentUser.mockReturnValue(pending.promise)
    await open()
    expect(text(byRole(page.root, 'status')[0])).toBe('마이페이지를 불러오는 중이에요...')
    expect(fetchNotifications).not.toHaveBeenCalled()
    pending.resolve(member)
    await flush()
    expect(text(page.root)).toContain('서지훈님')
  })

  test('비로그인(401)이면 로그인 안내와 /login 링크, "로그인 상태 다시 확인"은 다시 부른다', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    await open()
    expect(text(page.root)).toContain('로그인이 필요해요')
    expect(link(page.root, '로그인').props.href).toBe('/login')
    expect(fetchAlerts).not.toHaveBeenCalled()
    fetchCurrentUser.mockResolvedValue(member)
    await click(button(page.root, '로그인 상태 다시 확인'))
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain('서지훈님')
    expect(fetchNotifications).toHaveBeenCalledTimes(1)
  })

  test('로그인 확인이 실패(500)하면 오류(role=alert) + 다시 시도', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 500 } })
    await open()
    expect(text(byRole(page.root, 'alert')[0])).toContain('로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.')
    fetchCurrentUser.mockResolvedValue(member)
    await click(button(page.root, '다시 시도'))
    expect(text(page.root)).toContain('서지훈님')
  })

  test('탭 요청이 401(로그인 만료)이면 화면 전체를 로그인 안내로 바꾼다', async () => {
    fetchNotifications.mockRejectedValue({ response: { status: 401 } })
    await open()
    expect(text(page.root)).toContain('로그인이 필요해요')
    expect(text(page.root)).not.toContain('서지훈님')
  })

  test('머리말: 이름 첫 글자·"이름님"·추적 수·읽지 않은 알림 수, 로그아웃은 이벤트를 보낸 뒤 로그아웃 → logout 이벤트 → 첫 화면', async () => {
    const order = []
    flushEvents.mockImplementation(async () => { order.push('flush') })
    logout.mockImplementation(async () => { order.push('logout') })
    track.mockImplementation((type) => { order.push(`track:${type}`) })
    goToMain.mockImplementation(() => { order.push('goToMain') })
    await open()
    expect(text(find(page.root, (node) => node.props.class === 'my-head__avatar'))).toBe('서')
    expect(text(find(page.root, (node) => node.type === 'h1'))).toBe('서지훈님')
    expect(text(page.root)).toContain('추적 중 2개 · 읽지 않은 알림 1개')
    await click(button(page.root, '로그아웃'))
    expect(order).toEqual(['flush', 'logout', 'track:logout', 'goToMain'])
  })

  test('로그아웃이 실패하면 안내(role=alert)를 보여 주고 이동하지 않는다', async () => {
    logout.mockRejectedValue({ isAxiosError: true, code: 'ERR_NETWORK' })
    await open()
    await click(button(page.root, '로그아웃'))
    expect(goToMain).not.toHaveBeenCalled()
    expect(text(byRole(page.root, 'alert')[0])).toContain('로그아웃하지 못했습니다')
    expect(button(page.root, '로그아웃').props.disabled).toBe(false)
  })
})

describe('탭과 주소', () => {
  test('기본은 알림 탭: 헤더 active-page my, 알림과 가격 추적(추적 수)만 부르고 내 글은 열 때 부른다', async () => {
    await open()
    expect(layout()['active-page']).toBe('my')
    expect(tabButton('알림').props['aria-pressed']).toBe(true)
    expect(tabButton('가격 추적').props['aria-pressed']).toBe(false)
    expect(fetchNotifications).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    expect(fetchAlerts).toHaveBeenCalledTimes(1)
    expect(fetchMyPosts).not.toHaveBeenCalled()

    await click(tabButton('내 글'))
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/my?tab=posts')
    expect(fetchMyPosts).toHaveBeenCalledTimes(1)
    await click(tabButton('가격 추적'))
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/my?tab=alerts')
    expect(layout()['active-page']).toBe('alerts')
    await click(tabButton('알림'))
    expect(fetchNotifications).toHaveBeenCalledTimes(1)
    expect(fetchAlerts).toHaveBeenCalledTimes(1)
  })

  test('?tab=alerts 로 열면 가격 추적 탭이고 GET /alerts 만 부른다', async () => {
    await open('?tab=alerts')
    expect(tabButton('가격 추적').props['aria-pressed']).toBe(true)
    expect(layout()['active-page']).toBe('alerts')
    expect(fetchAlerts).toHaveBeenCalledTimes(1)
    expect(fetchNotifications).not.toHaveBeenCalled()
  })
})

describe('알림 탭', () => {
  test('불러오는 동안 로딩(role=status)', async () => {
    fetchNotifications.mockReturnValue(deferred().promise)
    await open()
    expect(text(byRole(page.root, 'status')[0])).toBe('알림을 불러오는 중이에요...')
  })

  test('목록: 종류 아이콘·제목·본문·읽지 않음 글자·시각, 대상 링크. 헤더 숫자를 서버 unread_count 로 맞춘다', async () => {
    await open()
    const [unread, read] = notificationItems()
    expect(text(unread)).toContain('목표가 도달')
    expect(text(unread)).toContain('읽지 않음')
    expect(text(unread)).toContain('5분 전')
    expect(find(unread, (node) => node.type === 'a').props.href).toBe('/products/7')
    expect(find(unread, (node) => String(node.props.class).includes('my-notif__icon--trend'))).not.toBeNull()
    expect(text(read)).not.toContain('읽지 않음')
    expect(text(read)).toContain('3시간 전')
    expect(find(read, (node) => node.type === 'a').props.href).toBe('/questions/3')
    expect(find(read, (node) => String(node.props.class).includes('my-notif__icon--chat'))).not.toBeNull()
    expect(siteStatus.setUnreadCount).toHaveBeenCalledWith(1)
  })

  test('읽지 않은 알림을 누르면 읽음으로 바꾼 뒤 대상 화면으로 이동한다(헤더 숫자 1 줄임)', async () => {
    const marking = deferred()
    markNotificationRead.mockReturnValue(marking.promise)
    await open()
    const anchor = find(notificationItems()[0], (node) => node.type === 'a')
    const event = { button: 0, preventDefault: jest.fn() }
    anchor.props.onClick(event)
    await flush()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(markNotificationRead).toHaveBeenCalledWith(1)
    expect(window.location.assign).not.toHaveBeenCalled()
    marking.resolve(notification(1, { read: true }))
    await flush()
    expect(window.location.assign).toHaveBeenCalledWith('/products/7')
    expect(siteStatus.setUnreadCount).toHaveBeenLastCalledWith(0)
    expect(text(notificationItems()[0])).not.toContain('읽지 않음')
  })

  test('읽음 표시가 실패해도 이동한다. 이미 읽은 알림은 링크 그대로(읽음 요청 없음)', async () => {
    markNotificationRead.mockRejectedValue({ response: { status: 500 } })
    await open()
    const readEvent = { button: 0, preventDefault: jest.fn() }
    find(notificationItems()[1], (node) => node.type === 'a').props.onClick(readEvent)
    await flush()
    expect(readEvent.preventDefault).not.toHaveBeenCalled()
    expect(markNotificationRead).not.toHaveBeenCalled()
    find(notificationItems()[0], (node) => node.type === 'a').props.onClick({ button: 0, preventDefault: jest.fn() })
    await flush()
    expect(window.location.assign).toHaveBeenCalledWith('/products/7')
  })

  test('새 탭으로 여는 누르기(Ctrl)는 막지 않고 읽음만 보낸다', async () => {
    markNotificationRead.mockResolvedValue(notification(1, { read: true }))
    await open()
    const event = { button: 0, ctrlKey: true, preventDefault: jest.fn() }
    find(notificationItems()[0], (node) => node.type === 'a').props.onClick(event)
    await flush()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(markNotificationRead).toHaveBeenCalledWith(1)
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  test('"모두 읽음": 모든 알림을 읽음으로, 헤더 숫자 0, 토스트. 읽지 않은 알림이 없으면 버튼을 막는다', async () => {
    markAllNotificationsRead.mockResolvedValue({ unread_count: 0 })
    await open()
    await click(button(page.root, '모두 읽음'))
    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    expect(siteStatus.setUnreadCount).toHaveBeenLastCalledWith(0)
    expect(siteStatus.showToast).toHaveBeenCalledWith('알림을 모두 읽었어요')
    expect(notificationItems().some((item) => text(item).includes('읽지 않음'))).toBe(false)
    expect(button(page.root, '모두 읽음').props.disabled).toBe(true)
    expect(text(page.root)).toContain('읽지 않은 알림 0개')
  })

  test('"모두 읽음"이 실패하면 안내(role=alert)를 보여 주고 목록은 그대로다', async () => {
    markAllNotificationsRead.mockRejectedValue({ response: { status: 500 } })
    await open()
    await click(button(page.root, '모두 읽음'))
    expect(text(byRole(page.root, 'alert')[0])).toBe('알림을 읽음으로 바꾸지 못했어요. 다시 시도해 주세요.')
    expect(text(notificationItems()[0])).toContain('읽지 않음')
  })

  test('빈 목록은 다음 행동을 안내한다', async () => {
    fetchNotifications.mockResolvedValue(notificationPage([]))
    await open()
    expect(text(page.root)).toContain('아직 받은 알림이 없어요.')
    expect(button(page.root, '모두 읽음')).toBeNull()
  })

  test('오류(role=alert) → 다시 시도하면 목록을 보여 준다', async () => {
    fetchNotifications.mockRejectedValueOnce({ response: { status: 500 } })
    await open()
    expect(text(byRole(page.root, 'alert')[0])).toContain('알림을 불러오지 못했어요. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(notificationItems()).toHaveLength(2)
  })

  test('알림이 한 쪽(20개)보다 많으면 쪽 이동(이전·다음, 끝에서는 막힘)', async () => {
    fetchNotifications.mockResolvedValue(notificationPage([notification(1)], { total: 45 }))
    await open()
    const pager = () => find(page.root, (node) => node.type === 'nav' && node.props['aria-label'] === '알림 페이지')
    expect(text(pager())).toContain('1 / 3')
    expect(button(pager(), '이전').props.disabled).toBe(true)
    fetchNotifications.mockResolvedValue(notificationPage([notification(41)], { total: 45, page: 3 }))
    await click(button(pager(), '다음'))
    expect(fetchNotifications).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(text(pager())).toContain('3 / 3')
    expect(button(pager(), '다음').props.disabled).toBe(true)
  })
})

describe('가격 추적 탭', () => {
  test('불러오는 동안 로딩(role=status), 머리말은 추적 수 없이 읽지 않은 알림 수만', async () => {
    fetchAlerts.mockReturnValue(deferred().promise)
    await open('?tab=alerts')
    expect(text(byRole(page.root, 'status')[0])).toBe('가격 추적 목록을 불러오는 중이에요...')
    expect(text(page.root)).not.toContain('추적 중')
  })

  test('카드: 상품 링크·브랜드·카테고리·현재가·목표가·진행도 막대(글자 대안)·남은 금액·30일 변동 배지', async () => {
    await open('?tab=alerts')
    const [first, reached] = alertCards()
    const productLink = find(first, (node) => node.type === 'a')
    expect(productLink.props.href).toBe('/products/7')
    expect(text(productLink)).toContain('지포스 RTX 7')
    expect(text(productLink)).toContain('MSI · 그래픽카드')
    expect(find(first, (node) => node.type === 'img').props).toMatchObject({ src: '/images/products/7.webp', alt: '' })
    expect(text(first)).toContain('현재가750,000원')
    expect(text(first)).toContain('목표가700,000원')
    const bar = find(first, (node) => node.props.role === 'img')
    expect(bar.props['aria-label']).toBe('목표가 진행도 50%')
    expect(find(bar, (node) => node.type === 'span').props.style).toEqual({ width: '50%' })
    expect(text(first)).toContain('목표가까지 50,000원')
    expect(stub(first, 'PriceChangeBadge').props.pct).toBe(-5.2)
    expect(text(reached)).toContain('목표가 도달 · 지금 살 때')
    expect(find(reached, (node) => node.props.role === 'img').props['aria-label']).toBe('목표가 진행도 100%')
  })

  test('× 추적 해제: 처리 중에는 버튼을 막고, 성공하면 카드를 빼고 토스트 "추적을 해제했어요"', async () => {
    const removal = deferred()
    deleteAlert.mockReturnValue(removal.promise)
    await open('?tab=alerts')
    const remove = find(alertCards()[0], (node) => node.type === 'button')
    expect(remove.props['aria-label']).toBe('지포스 RTX 7 추적 해제')
    remove.props.onClick()
    await flush()
    expect(deleteAlert).toHaveBeenCalledWith(7)
    expect(find(alertCards()[0], (node) => node.type === 'button').props.disabled).toBe(true)
    removal.resolve(null)
    await flush()
    expect(alertCards()).toHaveLength(1)
    expect(siteStatus.showToast).toHaveBeenCalledWith('추적을 해제했어요')
    expect(text(page.root)).toContain('추적 중 1개')
  })

  test('추적 해제가 실패(500)하면 안내(role=alert)를 보여 주고 카드는 남는다. 이미 없으면(404) 카드를 뺀다', async () => {
    deleteAlert.mockRejectedValueOnce({ response: { status: 500 } })
    await open('?tab=alerts')
    await click(find(alertCards()[0], (node) => node.type === 'button'))
    expect(text(byRole(page.root, 'alert')[0])).toBe('추적을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(alertCards()).toHaveLength(2)
    deleteAlert.mockRejectedValueOnce({ response: { status: 404, data: { message: '등록된 목표가 알림이 없습니다.' } } })
    await click(find(alertCards()[0], (node) => node.type === 'button'))
    expect(alertCards()).toHaveLength(1)
    expect(byRole(page.root, 'alert')).toHaveLength(0)
  })

  test('빈 목록은 목표가 알림 설정을 안내한다', async () => {
    fetchAlerts.mockResolvedValue({ items: [] })
    await open('?tab=alerts')
    expect(text(page.root)).toContain('추적 중인 부품이 없어요. 상품 상세에서 목표가 알림을 설정해 보세요.')
    expect(link(page.root, '상품 보러 가기').props.href).toBe('/products')
    expect(text(page.root)).toContain('추적 중 0개')
  })

  test('오류(role=alert) → 다시 시도', async () => {
    fetchAlerts.mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' })
    await open('?tab=alerts')
    expect(text(byRole(page.root, 'alert')[0])).toContain('가격 추적 목록을 불러오지 못했어요. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(alertCards()).toHaveLength(2)
  })
})

describe('내 글 탭', () => {
  const rows = () => findAll(page.root, (node) => node.type === 'li' && node.props.class === 'my-post')

  test('불러오는 동안 로딩(role=status)', async () => {
    fetchMyPosts.mockReturnValue(deferred().promise)
    await open('?tab=posts')
    expect(text(byRole(page.root, 'status')[0])).toBe('내 글을 불러오는 중이에요...')
  })

  test('글마다 종류 배지·제목 링크·답글 수·날짜', async () => {
    await open('?tab=posts')
    expect(fetchMyPosts).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    expect(rows().map((row) => [
      text(find(row, (node) => node.props.class === 'my-post__kind')),
      find(row, (node) => node.type === 'a').props.href,
      text(find(row, (node) => node.type === 'a')),
      text(find(row, (node) => node.props.class === 'my-post__meta')),
    ])).toEqual([
      ['견적 요청', '/community/posts/509', '150만 원 게임용 견적 부탁드립니다', '댓글 22026.11.04'],
      ['질문', '/questions/3', '파워 750W 면 충분할까요?', '답변 12026.11.01'],
      ['자유', '/community/posts/15', '첫 조립 후기', '댓글 02026.10.20'],
    ])
  })

  test('빈 목록은 질문하기·견적 요청하기를 안내한다', async () => {
    fetchMyPosts.mockResolvedValue(postPage([]))
    await open('?tab=posts')
    expect(text(page.root)).toContain('아직 쓴 글이 없어요.')
    expect(link(page.root, '질문하기').props.href).toBe('/questions/new')
    expect(link(page.root, '견적 요청하기').props.href).toBe('/community/build/new')
  })

  test('오류(role=alert) → 다시 시도', async () => {
    fetchMyPosts.mockRejectedValueOnce({ response: { status: 503 } })
    await open('?tab=posts')
    expect(text(byRole(page.root, 'alert')[0])).toContain('내 글을 불러오지 못했어요. 다시 시도해 주세요.')
    await click(button(page.root, '다시 시도'))
    expect(rows()).toHaveLength(3)
  })

  test('글이 한 쪽보다 많으면 쪽 이동', async () => {
    fetchMyPosts.mockResolvedValue(postPage(myPosts, { total: 30 }))
    await open('?tab=posts')
    const pager = find(page.root, (node) => node.type === 'nav' && node.props['aria-label'] === '내 글 페이지')
    expect(text(pager)).toContain('1 / 2')
    fetchMyPosts.mockResolvedValue(postPage(myPosts.slice(0, 1), { total: 30, page: 2 }))
    await click(button(pager, '다음'))
    expect(fetchMyPosts).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(rows()).toHaveLength(1)
  })
})
