export const MAX_QUESTION_IMAGES = 5
export const MAX_QUESTION_IMAGE_SIZE = 5 * 1024 * 1024
export const QUESTION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function validateQuestion({ title = '', content = '' } = {}) {
  if (!title.trim()) return '질문 제목을 입력해 주세요.'
  if (title.trim().length > 200) return '제목은 200자까지 입력할 수 있습니다.'
  if (!content.trim()) return '질문 내용을 입력해 주세요.'
  if (content.trim().length > 10000) return '내용은 10,000자까지 입력할 수 있습니다.'
  return ''
}

export function validateQuestionImages(images = []) {
  if (images.length > MAX_QUESTION_IMAGES) return '이미지는 최대 5장까지 첨부할 수 있습니다.'
  for (const image of images) {
    if (!QUESTION_IMAGE_TYPES.includes(image.type)) return 'JPG, PNG, GIF, WebP 이미지만 첨부할 수 있습니다.'
    if (!image.size) return '비어 있는 이미지는 첨부할 수 없습니다.'
    if (image.size > MAX_QUESTION_IMAGE_SIZE) return '이미지 한 장의 크기는 5MB 이하여야 합니다.'
  }
  return ''
}

export function questionError(error, fallback) {
  if (error?.code === 'QUESTION_IMAGE_UPLOAD_FAILED') return error.message
  if (error?.response?.status === 401) return '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'
  if (error?.response?.status === 403) return '본인이 작성한 질문만 변경할 수 있습니다.'
  if (error?.response?.status === 413) return '첨부 파일이 너무 큽니다. 이미지는 한 장당 5MB 이하로 첨부해 주세요.'
  return error?.response?.data?.message || fallback
}

export function formatQuestionDate(value) {
  if (!value) return ''
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul',
  }).format(date)
}

export function goToQuestion(id, location = window.location) {
  location.assign(id == null ? '/questions' : `/questions/${encodeURIComponent(id)}`)
}

// 답변(spec 정책): 로그인한 사용자는 누구나 쓴다. 내용 1~5000자(앞뒤 공백 제거). 본인 것만 수정·삭제(is_owner).
export const MAX_ANSWER_LENGTH = 5000

/** 서버(파이썬)와 같이 코드 포인트로 센 답변 글자 수(앞뒤 공백 제외). */
export function answerLength(content) {
  return [...String(content ?? '').trim()].length
}

export function validateAnswer({ content = '' } = {}) {
  const length = answerLength(content)
  if (!length) return '답변 내용을 입력해 주세요.'
  if (length > MAX_ANSWER_LENGTH) return '답변은 5,000자까지 입력할 수 있습니다.'
  return ''
}

/**
 * 답변 작성·수정·삭제 실패 문구. 401 로그인 만료, 403 남의 답변, 404 는 서버 문구(질문을/답변을 찾을 수 없습니다.)에 새로고침 안내를 붙인다.
 * 5xx·네트워크는 fallback, 그 밖(422 등)은 서버 문구.
 */
export function answerError(error, fallback) {
  const status = error?.response?.status
  const message = error?.response?.data?.message
  const serverMessage = typeof message === 'string' && message ? message : ''
  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'
  if (status === 403) return '본인이 작성한 답변만 수정하거나 삭제할 수 있습니다.'
  if (status === 404) return `${serverMessage || '질문이나 답변을 찾을 수 없습니다.'} 새로고침한 뒤 다시 확인해 주세요.`
  if (!status || status >= 500) return fallback
  return serverMessage || fallback
}

// ---------------------------------------------------------------- 답변 채택(CONTRACT §9)

/** 이 답변이 채택된 답변인지. 질문의 accepted_answer_id 가 기준이고, 없으면 답변의 is_accepted. */
export function isAcceptedAnswer(question, answer) {
  if (!answer) return false
  if (question?.accepted_answer_id != null) return answer.id === question.accepted_answer_id
  return Boolean(answer.is_accepted)
}

/** 화면에 보여 줄 답변 순서: 채택된 답변을 맨 위에, 나머지는 서버 순서(오래된 순) 그대로. */
export function orderAnswers(question) {
  const answers = Array.isArray(question?.answers) ? question.answers : []
  const accepted = answers.filter((answer) => isAcceptedAnswer(question, answer))
  return [...accepted, ...answers.filter((answer) => !accepted.includes(answer))]
}

/** 채택은 질문을 쓴 사람만(서버의 is_owner). 다른 사람·비로그인은 채택 버튼이 없다. */
export function canAcceptAnswers(question) {
  return Boolean(question?.is_owner)
}

/** 답변 하나의 채택 동작: 질문 작성자가 아니면 null, 채택된 답변이면 'unaccept'(채택 취소), 아니면 'accept'(채택하기). */
export function acceptAction(question, answer) {
  if (!canAcceptAnswers(question) || !answer) return null
  return isAcceptedAnswer(question, answer) ? 'unaccept' : 'accept'
}

/** 채택·채택 취소 실패 문구. 401 로그인 만료, 403 작성자 아님, 404 서버 문구 + 새로고침 안내, 5xx·네트워크는 fallback, 그 밖은 서버 문구. */
export function acceptError(error, fallback) {
  const status = error?.response?.status
  const message = error?.response?.data?.message
  const serverMessage = typeof message === 'string' && message ? message : ''
  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'
  if (status === 403) return '질문을 쓴 사람만 답변을 채택할 수 있습니다.'
  if (status === 404) return `${serverMessage || '답변을 찾을 수 없습니다.'} 새로고침한 뒤 다시 확인해 주세요.`
  if (!status || status >= 500) return fallback
  return serverMessage || fallback
}

// ---------------------------------------------------------------- 관련 부품·조회 수(CONTRACT §9)

// 관련 부품 검색: 입력을 0.3초 모아 GET /products?search=&page_size=10
export const PRODUCT_SEARCH_DEBOUNCE_MS = 300
export const PRODUCT_SEARCH_PAGE_SIZE = 10

/** 목록 줄의 관련 부품 이름. 연결된 부품이 없으면(또는 판매 중이 아니면) '부품 미지정'. */
export function questionProductName(question) {
  return question?.product?.name || '부품 미지정'
}

/** 조회 수 글자: '조회 1,234'. 값이 없으면 0. */
export function formatViewCount(value) {
  const count = Math.max(0, Math.floor(Number(value)) || 0)
  return `조회 ${count.toLocaleString('ko-KR')}`
}

/** 글쓰기 주소의 ?product={id}(상품 상세의 "질문하기"). 양의 정수가 아니면 null. */
export function readProductQuery(search = globalThis.window?.location?.search || '') {
  const value = new URLSearchParams(search || '').get('product')
  if (!value || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 이 부품에 대한 질문 쓰기 주소(/questions/new?product=3). */
export function newQuestionPath(productId) {
  return productId == null ? '/questions/new' : `/questions/new?product=${encodeURIComponent(productId)}`
}

/** 수정에 보낼 관련 부품: 원래 부품 id 와 고른 부품 id 가 다를 때만 { productId }(null 은 연결 해제), 같으면 {}. */
export function productChange(originalId, chosenId) {
  const before = originalId ?? null
  const after = chosenId ?? null
  return before === after ? {} : { productId: after }
}
