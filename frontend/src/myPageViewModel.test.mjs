// 마이페이지(src/stores/myPageViewModel.js) 계산: 탭 주소, 화면·탭 상태, 머리말 줄, 목표가 진행도·남은 금액, 알림 아이콘·이동 경로,
// 내 글 배지·경로·답글 수, 날짜·상대 시각, 오류 문구, 보통 누르기 판별, /my 경로.
import { jest } from '@jest/globals'
import {
  DEFAULT_MY_PAGE_TAB, MY_PAGE_TABS, alertGap, alertProgress, formatMyDate, formatNotificationTime, isPlainClick, myPageError, myPagePath,
  myPageState, myPageSummary, myPageTab, myPostKindLabel, myPostPath, myPostReplyLabel, notificationIcon, notificationKindName,
  notificationPath, openPath, pageCount, progressPercent, tabState,
} from './stores/myPageViewModel.js'
import { isMyRoute, resolveRouteName } from './router/index.js'

test('탭은 알림·가격 추적·내 글 세 개이고 기본은 알림이다', () => {
  expect(MY_PAGE_TABS.map((tab) => [tab.code, tab.name])).toEqual([['notifications', '알림'], ['alerts', '가격 추적'], ['posts', '내 글']])
  expect(DEFAULT_MY_PAGE_TAB).toBe('notifications')
})

test.each([
  ['', 'notifications'],
  ['?tab=alerts', 'alerts'],
  ['?tab=posts', 'posts'],
  ['?tab=notifications', 'notifications'],
  ['?tab=ALERTS', 'notifications'],
  ['?tab=orders', 'notifications'],
  ['?foo=1&tab=posts', 'posts'],
  [undefined, 'notifications'],
])('myPageTab(%p) → %p', (search, expected) => {
  expect(myPageTab(search)).toBe(expected)
})

test.each([
  ['alerts', '/my?tab=alerts'],
  ['posts', '/my?tab=posts'],
  ['notifications', '/my?tab=notifications'],
  ['unknown', '/my?tab=notifications'],
  [undefined, '/my?tab=notifications'],
])('myPagePath(%p) → %p', (tab, expected) => {
  expect(myPagePath(tab)).toBe(expected)
})

test.each([
  [{ authStatus: 'loading' }, 'loading'],
  [{ authStatus: 'member' }, 'member'],
  [{ authStatus: 'member', expired: true }, 'guest'],
  [{ authStatus: 'guest' }, 'guest'],
  [{ authStatus: 'error' }, 'error'],
  [{}, 'loading'],
])('myPageState(%p) → %p', (input, expected) => {
  expect(myPageState(input)).toBe(expected)
})

test.each([
  [{ status: 'idle', items: [] }, 'loading'],
  [{ status: 'loading', items: [{ id: 1 }] }, 'loading'],
  [{ status: 'error', items: [{ id: 1 }] }, 'error'],
  [{ status: 'ready', items: [] }, 'empty'],
  [{ status: 'ready', items: [{ id: 1 }] }, 'ready'],
])('tabState(%p) → %p', (section, expected) => {
  expect(tabState(section)).toBe(expected)
})

test.each([
  [{ alertCount: 3, unreadCount: 2 }, '추적 중 3개 · 읽지 않은 알림 2개'],
  [{ alertCount: 0, unreadCount: 0 }, '추적 중 0개 · 읽지 않은 알림 0개'],
  [{ alertCount: null, unreadCount: 5 }, '읽지 않은 알림 5개'],
  [{ alertCount: 1, unreadCount: -1 }, '추적 중 1개 · 읽지 않은 알림 0개'],
])('myPageSummary(%p) → %p', (input, expected) => {
  expect(myPageSummary(input)).toBe(expected)
})

test.each([
  [0, 20, 1], [20, 20, 1], [21, 20, 2], [45, 20, 3], ['x', 20, 1], [10, 0, 1],
])('pageCount(%p, %p) → %p', (total, size, expected) => {
  expect(pageCount(total, size)).toBe(expected)
})

const alertOf = (price, target, highest, extra = {}) => ({
  product_id: 7, target_price_krw: target, ...extra,
  product: { id: 7, name: 'RTX 4070', price_krw: price, price_trend: highest === undefined ? null : { highest_1y_krw: highest } },
})

test.each([
  // 디자인 공식: 1 − (현재가 − 목표가) / max(1년 최고가 − 목표가, 1), 0~1
  ['최고가 = 현재가 → 0', alertOf(800000, 700000, 800000), 0],
  ['절반', alertOf(750000, 700000, 800000), 0.5],
  ['목표가 도달 → 1', alertOf(690000, 700000, 800000), 1],
  ['현재가가 1년 최고가보다 높으면 0', alertOf(900000, 700000, 800000), 0],
  ['1년 최고가가 없으면 현재가를 최고가로 → 0', alertOf(800000, 700000, null), 0],
  ['price_trend 가 없어도 도달이면 1', alertOf(700000, 700000, undefined), 1],
  ['최고가 = 목표가(분모 1)', alertOf(700001, 700000, 700000), 0],
  ['값이 없으면 0', { target_price_krw: 1000, product: null }, 0],
])('alertProgress: %s', (_, alert, expected) => {
  expect(alertProgress(alert)).toBeCloseTo(expected, 5)
})

test.each([[0, 0], [0.5, 50], [0.726, 73], [1, 100], [1.5, 100], [-1, 0], ['x', 0]])('progressPercent(%p) → %p', (value, expected) => {
  expect(progressPercent(value)).toBe(expected)
})

test.each([
  ['남은 금액', alertOf(712000, 700000, 800000), { text: '목표가까지 12,000원', reached: false }],
  ['서버 reached true', alertOf(712000, 700000, 800000, { reached: true }), { text: '목표가 도달 · 지금 살 때', reached: true }],
  ['서버 reached 가 없으면 현재가 ≤ 목표가', alertOf(700000, 700000, 800000), { text: '목표가 도달 · 지금 살 때', reached: true }],
  ['서버 reached false 를 따른다', alertOf(690000, 700000, 800000, { reached: false }), { text: '목표가까지 0원', reached: false }],
])('alertGap: %s', (_, alert, expected) => {
  expect(alertGap(alert)).toEqual(expected)
})

test.each([
  ['price_target', 'trend', '목표가 도달'],
  ['price_low', 'trend', '1년 최저가 갱신'],
  ['answer', 'chat', '새 답변'],
  ['quote', 'document', '견적 도착'],
  ['unknown', 'bell', '알림'],
  [undefined, 'bell', '알림'],
])('알림 종류 %p → 아이콘 %p, 이름 %p', (kind, icon, name) => {
  expect(notificationIcon(kind)).toBe(icon)
  expect(notificationKindName(kind)).toBe(name)
})

test.each([
  [{ kind: 'price_target', product_id: 7 }, '/products/7'],
  [{ kind: 'price_low', product_id: 12, question_id: 3 }, '/products/12'],
  [{ kind: 'answer', question_id: 3 }, '/questions/3'],
  [{ kind: 'quote', post_id: 509 }, '/community/posts/509'],
  [{ kind: 'answer', question_id: null, post_id: 9 }, '/community/posts/9'],
  [{ kind: 'mystery', question_id: 4 }, '/questions/4'],
  [{ kind: 'quote', post_id: 0 }, null],
  [{ kind: 'price_target', product_id: 'abc' }, null],
  [null, null],
])('notificationPath(%p) → %p', (notification, expected) => {
  expect(notificationPath(notification)).toBe(expected)
})

test.each([
  [{ kind: 'question', id: 2, reply_count: 3 }, '질문', '/questions/2', '답변 3'],
  [{ kind: 'free', id: 15, reply_count: 0 }, '자유', '/community/posts/15', '댓글 0'],
  [{ kind: 'build', id: 509, reply_count: 1 }, '견적 요청', '/community/posts/509', '댓글 1'],
  [{ kind: 'other', id: 1, reply_count: null }, '글', null, '댓글 0'],
  [{ kind: 'question', id: -1, reply_count: 2.5 }, '질문', null, '답변 2'],
])('내 글 %p → 배지 %p, 경로 %p, 답글 %p', (post, label, path, replies) => {
  expect(myPostKindLabel(post.kind)).toBe(label)
  expect(myPostPath(post)).toBe(path)
  expect(myPostReplyLabel(post)).toBe(replies)
})

test.each([
  ['2026-11-04T15:30:00Z', '2026.11.05'],
  ['2026-11-04T14:59:00', '2026.11.04'],
  ['2026-01-01T00:00:00+09:00', '2026.01.01'],
  ['', ''],
  ['not a date', ''],
  [null, ''],
])('formatMyDate(%p) → %p (한국 시간)', (value, expected) => {
  expect(formatMyDate(value)).toBe(expected)
})

const NOW = new Date('2026-11-05T12:00:00Z')
test.each([
  ['2026-11-05T11:59:40Z', '방금 전'],
  ['2026-11-05T12:00:30Z', '방금 전'],
  ['2026-11-05T11:55:00Z', '5분 전'],
  ['2026-11-05T09:00:00Z', '3시간 전'],
  ['2026-11-03T12:00:00Z', '2일 전'],
  ['2026-10-29T12:00:01Z', '6일 전'],
  ['2026-10-29T12:00:00Z', '2026.10.29'],
  ['2026-11-05T11:00:00', '1시간 전'],
  ['', ''],
])('formatNotificationTime(%p) → %p', (value, expected) => {
  expect(formatNotificationTime(value, NOW)).toBe(expected)
})

test.each([
  ['연결 실패', { isAxiosError: true, code: 'ERR_NETWORK' }, '기본 문구'],
  ['500', { response: { status: 500, data: { message: '서버 오류' } } }, '기본 문구'],
  ['404 서버 문구', { response: { status: 404, data: { message: '등록된 목표가 알림이 없습니다.' } } }, '등록된 목표가 알림이 없습니다.'],
  ['422 문구 없음', { response: { status: 422, data: '<html>' } }, '기본 문구'],
  ['오류 없음', null, '기본 문구'],
])('myPageError: %s', (_, error, expected) => {
  expect(myPageError(error, '기본 문구')).toBe(expected)
})

test.each([
  [{ button: 0 }, true],
  [undefined, true],
  [{}, true],
  [{ button: 1 }, false],
  [{ button: 0, ctrlKey: true }, false],
  [{ button: 0, metaKey: true }, false],
  [{ button: 0, shiftKey: true }, false],
  [{ button: 0, altKey: true }, false],
  [{ button: 0, defaultPrevented: true }, false],
])('isPlainClick(%p) → %p', (event, expected) => {
  expect(isPlainClick(event)).toBe(expected)
})

test('openPath 는 location.assign 으로 이동한다', () => {
  const location = { assign: jest.fn() }
  openPath('/products/7', location)
  expect(location.assign).toHaveBeenCalledWith('/products/7')
})

test.each([
  ['/my', true, 'my'],
  ['/my/', true, 'my'],
  ['/my/orders', false, 'products'],
  ['/mypage', false, 'products'],
])('경로 %s: isMyRoute %p, 화면 이름 %p', (pathname, isMy, name) => {
  expect(isMyRoute(pathname)).toBe(isMy)
  expect(resolveRouteName(pathname)).toBe(name)
})
