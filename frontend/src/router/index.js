import { isValidPaymentId } from '../stores/orderViewModel.js'

function positiveId(value) {
  const id = /^\d+$/.test(value) ? Number(value) : null
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function isLoginRoute(pathname = '/') {
  return pathname === '/login' || pathname.startsWith('/login/')
}

/** /products/{id} 는 상세(숫자가 아닌 id 는 null), 그 밖의 주소(/, /products, 알 수 없는 경로)는 상품 목록. */
export function resolveProductRoute(pathname = '/') {
  const match = pathname.match(/^\/products\/([^/]+)\/?$/)
  if (match) return { name: 'product-detail', id: positiveId(match[1]) }
  return { name: 'products' }
}

/** /compare 비교 화면(비교함의 상품을 표로 비교한다. ?ids= 공유 링크는 화면이 읽는다). */
export function isCompareRoute(pathname = '/') {
  return /^\/compare\/?$/.test(pathname)
}

/** /my 마이페이지(탭 ?tab=notifications|alerts|posts 는 화면이 읽는다). */
export function isMyRoute(pathname = '/') {
  return /^\/my\/?$/.test(pathname)
}

export function isCartRoute(pathname = '/') {
  return /^\/cart\/?$/.test(pathname)
}

/** /checkout 주문서. 장바구니 전체인지 바로 구매(?product=&quantity=)인지는 화면이 주소 query 로 정한다. */
export function isCheckoutRoute(pathname = '/') {
  return /^\/checkout\/?$/.test(pathname)
}

/** /orders 는 주문 내역, /orders/{payment_id} 는 주문 상세(payment_id 는 영문·숫자·_·- 만, 아니면 null. 구간이 더 있어도 null). 그 밖은 null. */
export function resolveOrderRoute(pathname = '/') {
  if (/^\/orders\/?$/.test(pathname)) return { name: 'orders' }
  const match = pathname.match(/^\/orders\/(.+?)\/?$/)
  if (!match) return null
  return { name: 'order-detail', paymentId: isValidPaymentId(match[1]) ? match[1] : null }
}

export function isPaymentCompleteRoute(pathname = '/') {
  return pathname === '/payments/complete'
}

/** /admin/returns 관리자 반품 관리(상태 탭 ?status= 는 화면이 읽는다). 그 밖의 /admin/* 은 아니다(상품 목록). */
export function isAdminReturnsRoute(pathname = '/') {
  return /^\/admin\/returns\/?$/.test(pathname)
}

/** /admin/recommendations 관리자 추천 학습(spec docs/specs/2026-11-03-product-recommendations.md). 그 밖의 /admin/* 은 아니다(상품 목록). */
export function isAdminRecommendationsRoute(pathname = '/') {
  return /^\/admin\/recommendations\/?$/.test(pathname)
}

export function resolveQuestionRoute(pathname = '/') {
  if (/^\/questions\/?$/.test(pathname)) return { name: 'questions' }
  if (/^\/questions\/new\/?$/.test(pathname)) return { name: 'question-new' }
  const match = pathname.match(/^\/questions\/([^/]+)(\/edit)?\/?$/)
  if (!match) return null
  return { name: match[2] ? 'question-edit' : 'question-detail', id: positiveId(match[1]) }
}

const COMMUNITY_BOARD_CODES = ['free', 'build']

function communityBoardCode(value) {
  return COMMUNITY_BOARD_CODES.includes(value) ? value : null
}

/**
 * 커뮤니티 경로. /community 는 홈, /community/{free|build} 는 목록, /community/{board}/new 는 글쓰기,
 * /community/posts/{id} 는 상세, /community/posts/{id}/edit 는 수정. 숫자가 아닌 id 는 null, 모르는 게시판(그 밖의 /community/*)은 board null(화면이 "찾을 수 없음"을 보여 준다).
 * /community 로 시작하지 않으면 null.
 */
export function resolveCommunityRoute(pathname = '/') {
  if (/^\/community\/?$/.test(pathname)) return { name: 'community' }
  const post = pathname.match(/^\/community\/posts\/([^/]+)(\/edit)?\/?$/)
  if (post) return { name: post[2] ? 'community-edit' : 'community-detail', id: positiveId(post[1]) }
  const create = pathname.match(/^\/community\/([^/]+)\/new\/?$/)
  if (create) return { name: 'community-new', board: communityBoardCode(create[1]) }
  const list = pathname.match(/^\/community\/([^/]+)\/?$/)
  if (list) return { name: 'community-list', board: communityBoardCode(list[1]) }
  if (pathname.startsWith('/community/')) return { name: 'community-list', board: null }
  return null
}

/** 이 주소가 보여 주는 화면 이름(page_view 이벤트의 route). App.vue 와 같은 순서로 고른다. 알 수 없는 경로는 상품 목록(products). */
export function resolveRouteName(pathname = '/') {
  if (isPaymentCompleteRoute(pathname)) return 'payment-complete'
  const question = resolveQuestionRoute(pathname)
  if (question) return question.name
  const community = resolveCommunityRoute(pathname)
  if (community) return community.name
  if (isLoginRoute(pathname)) return 'login'
  if (isMyRoute(pathname)) return 'my'
  if (isCartRoute(pathname)) return 'cart'
  if (isCheckoutRoute(pathname)) return 'checkout'
  if (isCompareRoute(pathname)) return 'compare'
  if (isAdminReturnsRoute(pathname)) return 'admin-returns'
  if (isAdminRecommendationsRoute(pathname)) return 'admin-recommendations'
  const order = resolveOrderRoute(pathname)
  if (order) return order.name
  return resolveProductRoute(pathname).name
}
