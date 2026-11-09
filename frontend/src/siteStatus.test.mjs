// 헤더 공용 상태(src/stores/siteStatus.js): 회원이면 장바구니 수량·읽지 않은 알림 수를 한 번 불러오고, 화면이 숫자를 맞추고, 토스트를 잠깐 보여 준다.
import { jest } from '@jest/globals'
import { countBadge, createSiteStatus, storedCompareCount, TOAST_MS } from './stores/siteStatus.js'

const member = { load: jest.fn().mockResolvedValue({ status: 'member', profile: { name: '서지훈' } }) }
const guest = { load: jest.fn().mockResolvedValue({ status: 'guest', profile: null }) }

function makeTimers() {
  const timers = new Map()
  let next = 0
  return {
    setTimer: jest.fn((callback, ms) => { timers.set(++next, { callback, ms }); return next }),
    clearTimer: jest.fn((id) => timers.delete(id)),
    run() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback() } },
    timers,
  }
}

test.each([
  ['회원', member, { item_count: 3 }, { unread_count: 2 }, { cartCount: 3, unreadCount: 2 }],
  ['비회원', guest, { item_count: 3 }, { unread_count: 2 }, { cartCount: 0, unreadCount: 0 }],
  ['회원·이상한 값', member, { item_count: -1 }, { unread_count: 'x' }, { cartCount: 0, unreadCount: 0 }],
])('%s: load 는 숫자를 채운다', async (_, session, cart, unread, expected) => {
  const fetchCart = jest.fn().mockResolvedValue(cart)
  const fetchUnreadCount = jest.fn().mockResolvedValue(unread)
  const status = createSiteStatus({ session, fetchCart, fetchUnreadCount, compareCount: () => 2 })
  await status.load()
  expect(status.state).toMatchObject({ ...expected, compareCount: 2 })
  if (session === guest) expect(fetchCart).not.toHaveBeenCalled()
})

test('load 는 진행 중이면 같은 Promise, 끝나면 다시 부르지 않고 refresh 는 다시 부른다', async () => {
  const fetchCart = jest.fn().mockResolvedValue({ item_count: 1 })
  const fetchUnreadCount = jest.fn().mockResolvedValue({ unread_count: 0 })
  const status = createSiteStatus({ session: member, fetchCart, fetchUnreadCount, compareCount: () => 0 })
  const first = status.load()
  expect(status.load()).toBe(first)
  await first
  await status.load()
  expect(fetchCart).toHaveBeenCalledTimes(1)
  await status.refresh()
  expect(fetchCart).toHaveBeenCalledTimes(2)
})

test('한쪽 요청이 실패해도 던지지 않고 다른 숫자는 채운다', async () => {
  const status = createSiteStatus({
    session: member,
    fetchCart: jest.fn().mockRejectedValue(new Error('500')),
    fetchUnreadCount: jest.fn().mockResolvedValue({ unread_count: 4 }),
    compareCount: () => 0,
  })
  await expect(status.load()).resolves.toMatchObject({ cartCount: 0, unreadCount: 4 })
})

test('setter 는 음수·소수를 0 이상의 정수로 맞추고 구독자에게 알린다', () => {
  const status = createSiteStatus({ session: guest, compareCount: () => 0 })
  const seen = []
  const stop = status.subscribe((state) => seen.push({ ...state }))
  status.setCartCount(2.7)
  status.setUnreadCount(-3)
  status.setCompareCount(4)
  stop()
  status.setCartCount(9)
  expect(seen.map((state) => [state.cartCount, state.unreadCount, state.compareCount])).toEqual([[0, 0, 0], [2, 0, 0], [2, 0, 0], [2, 0, 4]])
})

test('토스트는 정해진 시간 뒤 사라지고 새 문구가 앞 문구를 바꾼다. 빈 문구는 무시한다', () => {
  const timers = makeTimers()
  const status = createSiteStatus({ session: guest, compareCount: () => 0, ...timers })
  status.showToast('  ')
  expect(status.state.toast).toBeNull()
  status.showToast('장바구니에 담았어요')
  expect(status.state.toast.text).toBe('장바구니에 담았어요')
  expect(timers.setTimer).toHaveBeenLastCalledWith(expect.any(Function), TOAST_MS)
  status.showToast('비교에 추가했어요')
  expect(timers.clearTimer).toHaveBeenCalledTimes(1)
  expect(status.state.toast.text).toBe('비교에 추가했어요')
  timers.run()
  expect(status.state.toast).toBeNull()
  status.showToast('다시')
  status.dismissToast()
  expect(status.state.toast).toBeNull()
})

test.each([
  ['비교함 2개', { available: true, get: () => JSON.stringify({ category: 'cpu', items: [{ id: 1, name: 'a', category: 'cpu' }, { id: 2, name: 'b', category: 'cpu' }] }) }, 2],
  ['저장소 없음', { available: false, get: () => null }, 0],
  ['깨진 값', { available: true, get: () => '{' }, 0],
  ['던지는 저장소', { available: true, get: () => { throw new Error('x') } }, 0],
])('storedCompareCount: %s → %p', (_, storage, expected) => {
  expect(storedCompareCount(storage)).toBe(expected)
})

test.each([
  [0, ''], [-2, ''], ['x', ''], [null, ''], [1, '1'], [3.9, '3'], [99, '99'], [100, '99+'], [1234, '99+'],
])('countBadge(%p) → %p', (value, expected) => {
  expect(countBadge(value)).toBe(expected)
})
