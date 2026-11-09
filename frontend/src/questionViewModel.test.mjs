// 질문 view model(src/stores/questionViewModel.js)의 답변 검증·오류 문구, 답변 채택(순서·권한·오류), 관련 부품·조회 수. 질문 검증은 src/questionApi.test.mjs 에 있다.
import {
  MAX_ANSWER_LENGTH, PRODUCT_SEARCH_DEBOUNCE_MS, PRODUCT_SEARCH_PAGE_SIZE, acceptAction, acceptError, answerError, answerLength, canAcceptAnswers, formatViewCount,
  isAcceptedAnswer, newQuestionPath, orderAnswers, productChange, questionProductName, readProductQuery, validateAnswer,
} from './stores/questionViewModel.js'

test.each([
  [{ content: '파워 케이블을 다시 꽂아 보세요.' }, ''],
  [{ content: '네' }, ''],
  [{ content: '가'.repeat(MAX_ANSWER_LENGTH) }, ''],
  [{ content: '   ' }, '답변 내용을 입력해 주세요.'],
  [{}, '답변 내용을 입력해 주세요.'],
  [{ content: `  ${'가'.repeat(5001)}  ` }, '답변은 5,000자까지 입력할 수 있습니다.'],
])('답변 %o → %p', (values, message) => expect(validateAnswer(values)).toBe(message))

test('답변 글자 수는 앞뒤 공백을 빼고 코드 포인트로 센다', () => {
  expect(answerLength('  👍 좋아요  ')).toBe(5)
  expect(answerLength(null)).toBe(0)
  expect(validateAnswer({ content: '😀'.repeat(5000) })).toBe('')
})

const fallback = '답변을 등록하지 못했습니다. 다시 시도해 주세요.'
test.each([
  ['401 은 로그인 만료', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
  ['403 은 남의 답변', { response: { status: 403, data: { message: 'Forbidden' } } }, '본인이 작성한 답변만 수정하거나 삭제할 수 있습니다.'],
  ['404 답변은 서버 문구 + 새로고침 안내', { response: { status: 404, data: { message: '답변을 찾을 수 없습니다.' } } }, '답변을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
  ['404 질문은 서버 문구 + 새로고침 안내', { response: { status: 404, data: { message: '질문을 찾을 수 없습니다.' } } }, '질문을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
  ['404 문구가 없으면 우리 문구', { response: { status: 404 } }, '질문이나 답변을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
  ['422 는 서버 문구', { response: { status: 422, data: { message: '답변은 5000자까지 입력할 수 있습니다.' } } }, '답변은 5000자까지 입력할 수 있습니다.'],
  ['500 은 우리 문구', { response: { status: 500, data: { message: 'Internal Server Error' } } }, fallback],
  ['네트워크 오류는 우리 문구', { isAxiosError: true }, fallback],
])('%s', (_name, error, message) => expect(answerError(error, fallback)).toBe(message))

// ---------------------------------------------------------------- 채택(CONTRACT §9)
const answers = [{ id: 1 }, { id: 2 }, { id: 3, is_accepted: true }]
test.each([
  ['accepted_answer_id 가 기준', { accepted_answer_id: 2, answers }, 2, [2, 1, 3]],
  ['accepted_answer_id 가 없으면 답변의 is_accepted', { answers }, 3, [3, 1, 2]],
  ['채택 없음', { accepted_answer_id: null, answers: [{ id: 1 }, { id: 2 }] }, null, [1, 2]],
  ['답변이 없는 질문', { answers: [] }, null, []],
  ['질문 없음', null, null, []],
])('채택된 답변·순서: %s', (_name, question, acceptedId, order) => {
  const list = question?.answers || []
  expect(list.filter((answer) => isAcceptedAnswer(question, answer)).map((answer) => answer.id)).toEqual(acceptedId == null ? [] : [acceptedId])
  expect(orderAnswers(question).map((answer) => answer.id)).toEqual(order)
})

test.each([
  ['질문 작성자 · 채택 안 된 답변', { is_owner: true, accepted_answer_id: 2 }, { id: 1 }, true, 'accept'],
  ['질문 작성자 · 채택된 답변', { is_owner: true, accepted_answer_id: 2 }, { id: 2 }, true, 'unaccept'],
  ['다른 사람', { is_owner: false, accepted_answer_id: null }, { id: 1 }, false, null],
  ['비로그인(is_owner 없음)', {}, { id: 1 }, false, null],
  ['답변 없음', { is_owner: true }, null, true, null],
])('채택 권한·동작: %s', (_name, question, answer, can, action) => {
  expect(canAcceptAnswers(question)).toBe(can)
  expect(acceptAction(question, answer)).toBe(action)
})

const acceptFallback = '답변을 채택하지 못했습니다. 다시 시도해 주세요.'
test.each([
  ['401 은 로그인 만료', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
  ['403 은 작성자 아님', { response: { status: 403, data: { message: 'Forbidden' } } }, '질문을 쓴 사람만 답변을 채택할 수 있습니다.'],
  ['404 는 서버 문구 + 새로고침 안내', { response: { status: 404, data: { message: '채택된 답변이 아닙니다.' } } }, '채택된 답변이 아닙니다. 새로고침한 뒤 다시 확인해 주세요.'],
  ['404 문구가 없으면 우리 문구', { response: { status: 404 } }, '답변을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
  ['422 는 서버 문구', { response: { status: 422, data: { message: '잘못된 요청입니다.' } } }, '잘못된 요청입니다.'],
  ['500 은 우리 문구', { response: { status: 500 } }, acceptFallback],
  ['네트워크 오류는 우리 문구', { isAxiosError: true }, acceptFallback],
])('채택 실패 %s', (_name, error, message) => expect(acceptError(error, acceptFallback)).toBe(message))

// ---------------------------------------------------------------- 관련 부품·조회 수
test('관련 부품 검색은 0.3초 모아 10개', () => {
  expect(PRODUCT_SEARCH_DEBOUNCE_MS).toBe(300)
  expect(PRODUCT_SEARCH_PAGE_SIZE).toBe(10)
})

test.each([
  [{ product: { id: 3, name: '라이젠5 7600' } }, '라이젠5 7600'],
  [{ product: null }, '부품 미지정'],
  [{}, '부품 미지정'],
])('목록의 관련 부품 이름 %o → %p', (question, name) => expect(questionProductName(question)).toBe(name))

test.each([
  [1234, '조회 1,234'], [0, '조회 0'], [null, '조회 0'], [undefined, '조회 0'], ['7', '조회 7'], [-3, '조회 0'],
])('조회 수 %p → %p', (value, label) => expect(formatViewCount(value)).toBe(label))

test.each([
  ['?product=3', 3], ['?product=3&x=1', 3], ['?product=0', null], ['?product=-1', null], ['?product=abc', null], ['?product=1.5', null], ['', null],
])('글쓰기 주소 %p 의 관련 부품 → %p', (search, id) => expect(readProductQuery(search)).toBe(id))

test('브라우저 주소가 없으면(서버·테스트) 관련 부품 없음', () => expect(readProductQuery()).toBeNull())

test.each([
  [3, '/questions/new?product=3'], [null, '/questions/new'],
])('부품 %p 질문 쓰기 주소 → %p', (id, path) => expect(newQuestionPath(id)).toBe(path))

test.each([
  ['그대로', 3, 3, {}],
  ['둘 다 없음', null, undefined, {}],
  ['새로 고름', null, 5, { productId: 5 }],
  ['바꿈', 3, 5, { productId: 5 }],
  ['지움(null 이면 연결 해제)', 3, undefined, { productId: null }],
])('수정에 보낼 관련 부품: %s', (_name, before, after, change) => expect(productChange(before, after)).toEqual(change))


