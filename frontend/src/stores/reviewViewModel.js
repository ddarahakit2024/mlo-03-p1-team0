// 상품 리뷰 영역: 입력 검증(서버와 같은 규칙), 쓰기 영역 상태, 별점 표시, 별점 분포, 오류 문구, 날짜.
// Vue·axios 를 import 하지 않는다. 평점 평균·리뷰 수·작성 가능 여부(can_review)·본인 여부(is_owner)는 서버 값을 그대로 쓴다.

export const REVIEW_PAGE_SIZE = 10
// 서버 규칙: 평점 1~5 정수, 내용 10~2000자(앞뒤 공백 제거)
export const MIN_REVIEW_LENGTH = 10
export const MAX_REVIEW_LENGTH = 2000
export const REVIEW_RATINGS = [5, 4, 3, 2, 1]
export const LOGIN_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'

// 서버(파이썬)는 글자 수를 코드 포인트로 센다. 이모지가 2글자로 세어지지 않게 맞춘다.
export function reviewLength(content) {
  return [...String(content ?? '').trim()].length
}

function ratingError(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? '' : '별점을 1점부터 5점 중에서 골라 주세요.'
}

function contentError(content) {
  const length = reviewLength(content)
  if (!length) return '리뷰 내용을 입력해 주세요.'
  if (length < MIN_REVIEW_LENGTH) return `리뷰는 ${MIN_REVIEW_LENGTH}자 이상 입력해 주세요.`
  if (length > MAX_REVIEW_LENGTH) return `리뷰는 ${MAX_REVIEW_LENGTH.toLocaleString('ko-KR')}자까지 입력할 수 있습니다.`
  return ''
}

/** 리뷰 작성 검사. 문제가 없으면 ''. */
export function validateReview({ rating, content = '' } = {}) {
  return ratingError(rating) || contentError(content)
}

const present = (value) => value !== undefined && value !== null

/**
 * 리뷰 수정 검사: 바꿀 값이 하나 이상 있어야 하고(서버는 {} 와 null 을 422 로 거절한다), 넣은 값은 작성과 같은 규칙.
 * 문제가 없으면 ''.
 */
export function validateReviewChanges({ rating, content } = {}) {
  if (!present(rating) && !present(content)) return '바뀐 별점이나 내용이 없습니다. 고친 뒤 다시 저장해 주세요.'
  if (present(rating) && ratingError(rating)) return ratingError(rating)
  if (present(content) && contentError(content)) return contentError(content)
  return ''
}

/**
 * 수정 폼 값 중 원래 리뷰와 달라진 것만 고른다(PATCH 는 바뀐 필드만 보낸다).
 * 내용은 앞뒤 공백을 지운 값으로 비교한다. 바뀐 것이 없으면 {}.
 */
export function reviewChanges(original, { rating, content } = {}) {
  const changes = {}
  if (present(rating) && rating !== original?.rating) changes.rating = rating
  if (present(content) && String(content).trim() !== String(original?.content ?? '').trim()) changes.content = content
  return changes
}

/** 서버로 보낼 본문. 평점은 정수 그대로, 내용은 앞뒤 공백을 지우고, 넣지 않은(또는 null) 값은 보내지 않는다. */
export function reviewBody({ rating, content } = {}) {
  const body = {}
  if (present(rating)) body.rating = rating
  if (present(content)) body.content = String(content).trim()
  return body
}

/**
 * 리뷰 쓰기 영역에 무엇을 보여 줄지.
 * 'mine'(내 리뷰가 있음: 수정·삭제) | 'form'(can_review: 작성 폼) | 'guest'(비로그인: 로그인 링크) | 'not-purchased'(로그인했지만 구매하지 않음)
 */
export function getReviewWriteState({ loggedIn = false, page = null } = {}) {
  if (page?.my_review) return 'mine'
  if (page?.can_review) return 'form'
  return loggedIn ? 'not-purchased' : 'guest'
}

/** 별점 3 → '★★★☆☆'. 범위를 벗어나면 0~5 로 자른다. */
export function ratingStars(rating) {
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`
}

/** 평균 4.46 → '4.5'. 평균이 없으면(리뷰 없음) '-'. 평균은 서버 값이다. */
export function formatRatingAverage(average) {
  return average == null || !Number.isFinite(Number(average)) ? '-' : Number(average).toFixed(1)
}

/**
 * 별점 분포(5점 → 1점): [{ score, count, percent }]. percent 는 막대 길이용(전체 리뷰 수 대비, 정수 %).
 * rating_counts 의 키는 "1"~"5" 문자열이다.
 */
export function ratingDistribution(counts = {}, total = 0) {
  const sum = Math.max(0, Number(total) || 0)
  return REVIEW_RATINGS.map((score) => {
    const count = Math.max(0, Number(counts?.[String(score)]) || 0)
    return { score, count, percent: sum ? Math.round((count / sum) * 100) : 0 }
  })
}

/** 리뷰 수정 여부(서버의 updated_at 이 created_at 과 다르면 수정됨). */
export function isEdited(item) {
  return Boolean(item?.updated_at && item?.created_at && item.updated_at !== item.created_at)
}

/** 서버의 UTC 시각을 한국 날짜로: '2026년 10월 30일'. */
export function formatReviewDate(value) {
  if (!value) return ''
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date)
}

/**
 * 리뷰 요청 실패 문구. 401 은 로그인 만료, 5xx·네트워크는 fallback,
 * 그 밖(403 미구매·남의 리뷰, 404, 409 이미 작성, 422)은 서버 message 를 그대로 보여 준다.
 */
export function reviewError(error, fallback) {
  const status = error?.response?.status
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (!status || status >= 500) return fallback
  const message = error?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}
