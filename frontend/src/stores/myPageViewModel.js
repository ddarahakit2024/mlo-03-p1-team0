// 마이페이지(/my) 화면의 탭·알림·가격 추적·내 글 표시 계산과 오류 문구, 이동 함수.
// Vue·axios 를 import 하지 않는다. 금액·읽음 여부·도달 여부는 서버 값을 그대로 쓰고 여기서는 글자·경로·진행도만 만든다.
import { formatPrice, productPath } from './productViewModel.js'

export const MY_PAGE_PATH = '/my'
export const MY_PAGE_TABS = [
  { code: 'notifications', name: '알림' },
  { code: 'alerts', name: '가격 추적' },
  { code: 'posts', name: '내 글' },
]
const TAB_CODES = MY_PAGE_TABS.map((tab) => tab.code)
export const DEFAULT_MY_PAGE_TAB = 'notifications'
// 알림·내 글 한 쪽에 보여 주는 수(서버 page_size 1..50)
export const MY_PAGE_SIZE = 20

/** 주소 ?tab= → 탭 코드. 없거나 모르는 값은 알림(notifications). */
export function myPageTab(search = '') {
  const tab = new URLSearchParams(search || '').get('tab')
  return TAB_CODES.includes(tab) ? tab : DEFAULT_MY_PAGE_TAB
}

/** 탭 코드 → 주소('/my?tab=alerts'). 모르는 코드는 알림 탭 주소. */
export function myPagePath(tab = DEFAULT_MY_PAGE_TAB) {
  return `${MY_PAGE_PATH}?tab=${TAB_CODES.includes(tab) ? tab : DEFAULT_MY_PAGE_TAB}`
}

/** 화면 전체 상태: 로그인 확인 중(loading) · 비로그인 또는 로그인 만료(guest) · 확인 실패(error) · 회원(member). */
export function myPageState({ authStatus = 'loading', expired = false } = {}) {
  if (authStatus === 'member') return expired ? 'guest' : 'member'
  if (authStatus === 'guest') return 'guest'
  if (authStatus === 'error') return 'error'
  return 'loading'
}

/** 탭 하나의 상태: idle·loading 은 loading, 오류는 error, 받은 목록이 비면 empty, 아니면 ready. */
export function tabState({ status = 'idle', items = [] } = {}) {
  if (status === 'error') return 'error'
  if (status !== 'ready') return 'loading'
  return items.length ? 'ready' : 'empty'
}

/** 머리말 아래 한 줄: '추적 중 3개 · 읽지 않은 알림 2개'. 가격 추적을 아직 받지 못했으면(null) 알림 수만. */
export function myPageSummary({ alertCount = null, unreadCount = 0 } = {}) {
  const unread = `읽지 않은 알림 ${Math.max(0, Number(unreadCount) || 0)}개`
  return alertCount === null || alertCount === undefined ? unread : `추적 중 ${alertCount}개 · ${unread}`
}

/** 쪽 수(언제나 1 이상). */
export function pageCount(total, pageSize) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 20
  const count = Math.ceil((Number(total) || 0) / size)
  return Math.max(1, Number.isFinite(count) ? count : 1)
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/**
 * 목표가 진행도(0~1): 1 − (현재가 − 목표가) / max(1년 최고가 − 목표가, 1). 1년 최고가가 없으면 현재가를 최고가로 본다.
 * 목표가에 닿았으면 1, 1년 최고가보다 비싸면 0.
 */
export function alertProgress(alert) {
  const price = Number(alert?.product?.price_krw)
  const target = Number(alert?.target_price_krw)
  if (!finite(alert?.product?.price_krw) || !finite(alert?.target_price_krw)) return 0
  const highest = finite(alert?.product?.price_trend?.highest_1y_krw) ? Number(alert.product.price_trend.highest_1y_krw) : price
  const progress = 1 - (price - target) / Math.max(highest - target, 1)
  return Math.min(1, Math.max(0, progress))
}

/** 진행도 → 막대 폭 퍼센트(정수). */
export function progressPercent(progress) {
  return Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100)
}

/**
 * 목표가까지 남은 금액 줄: 도달(서버 reached, 없으면 현재가 ≤ 목표가)이면 '목표가 도달 · 지금 살 때',
 * 아니면 '목표가까지 12,000원'. { text, reached }.
 */
export function alertGap(alert) {
  const price = Number(alert?.product?.price_krw) || 0
  const target = Number(alert?.target_price_krw) || 0
  const reached = typeof alert?.reached === 'boolean' ? alert.reached : price <= target
  if (reached) return { text: '목표가 도달 · 지금 살 때', reached: true }
  return { text: `목표가까지 ${formatPrice(Math.max(0, price - target))}`, reached: false }
}

const NOTIFICATION_ICONS = { price_target: 'trend', price_low: 'trend', answer: 'chat', quote: 'document' }
const NOTIFICATION_KIND_NAMES = { price_target: '목표가 도달', price_low: '1년 최저가 갱신', answer: '새 답변', quote: '견적 도착' }

/** 알림 종류 → 아이콘: 가격(trend), 답변(chat), 견적(document), 그 밖(bell). */
export function notificationIcon(kind) {
  return NOTIFICATION_ICONS[kind] || 'bell'
}

/** 알림 종류 이름(아이콘의 텍스트 대안). 모르는 종류는 '알림'. */
export function notificationKindName(kind) {
  return NOTIFICATION_KIND_NAMES[kind] || '알림'
}

function positiveId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * 알림을 눌렀을 때 갈 곳: 가격 알림은 상품(/products/{id}), 답변은 질문(/questions/{id}), 견적은 글(/community/posts/{id}).
 * 종류에 맞는 id 가 없으면 있는 id 순서(상품 → 질문 → 글)로, 아무것도 없으면 null.
 */
export function notificationPath(notification) {
  const product = positiveId(notification?.product_id)
  const question = positiveId(notification?.question_id)
  const post = positiveId(notification?.post_id)
  const paths = {
    product: product && productPath(product),
    question: question && `/questions/${encodeURIComponent(question)}`,
    post: post && `/community/posts/${encodeURIComponent(post)}`,
  }
  const preferred = { price_target: 'product', price_low: 'product', answer: 'question', quote: 'post' }[notification?.kind]
  return (preferred && paths[preferred]) || paths.product || paths.question || paths.post || null
}

const MY_POST_KINDS = { question: '질문', free: '자유', build: '견적 요청' }

/** 내 글 종류 → 배지 글자: 질문 · 자유 · 견적 요청. 모르는 종류는 '글'. */
export function myPostKindLabel(kind) {
  return MY_POST_KINDS[kind] || '글'
}

/** 내 글 → 주소: 질문은 /questions/{id}, 자유·견적 글은 /community/posts/{id}. id 가 틀리면 null. */
export function myPostPath(post) {
  const id = positiveId(post?.id)
  if (!id) return null
  if (post.kind === 'question') return `/questions/${encodeURIComponent(id)}`
  if (post.kind === 'free' || post.kind === 'build') return `/community/posts/${encodeURIComponent(id)}`
  return null
}

/** 답글 수 글자: 질문은 '답변 3', 글은 '댓글 3'. */
export function myPostReplyLabel(post) {
  const count = Math.max(0, Math.floor(Number(post?.reply_count) || 0))
  return `${post?.kind === 'question' ? '답변' : '댓글'} ${count}`
}

/** 서버 시각(UTC ISO, 시간대가 없으면 UTC 로 본다) → Date. 틀리면 null. */
function serverDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (!value) return null
  const text = String(value)
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const SEOUL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 날짜 '2026.11.05'(한국 시간). 값이 없거나 틀리면 ''. */
export function formatMyDate(value) {
  const date = serverDate(value)
  if (!date) return ''
  const parts = Object.fromEntries(SEOUL_DATE.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}.${parts.month}.${parts.day}`
}

/** 알림 시각: '방금 전'(1분 안) · 'N분 전' · 'N시간 전' · 'N일 전'(7일 안) · 그 전은 '2026.10.31'. now 는 테스트에서 넘긴다. */
export function formatNotificationTime(value, now = new Date()) {
  const date = serverDate(value)
  const current = serverDate(now)
  if (!date || !current) return ''
  const minutes = Math.floor((current.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}일 전`
  return formatMyDate(date)
}

/** 마이페이지 요청 실패 문구. 연결 실패·5xx 는 fallback, 그 밖(404·422 등)은 서버 문구(없으면 fallback). */
export function myPageError(error, fallback) {
  const status = error?.response?.status
  if (!status || status >= 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}

/** 새 탭·새 창으로 여는 누르기(가운데 버튼, Ctrl·⌘·Shift·Alt)가 아닌 보통 누르기인지. */
export function isPlainClick(event) {
  return !event || (!event.defaultPrevented && (event.button ?? 0) === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey)
}

/** 지금 시각(알림의 'N분 전'). 화면 테스트는 compileSfc deps 로 바꾼다. */
export function currentTime() {
  return new Date()
}

/** 코드에서 이동할 때(알림을 읽음으로 바꾼 뒤). */
export function openPath(path, location = window.location) {
  location.assign(path)
}
