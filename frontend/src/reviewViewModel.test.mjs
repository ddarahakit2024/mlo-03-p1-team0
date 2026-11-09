// 리뷰 view model(src/stores/reviewViewModel.js): 검증(서버 규칙과 같다), 쓰기 영역 상태, 별점·분포 표시, 오류 문구.
import {
  formatRatingAverage,
  formatReviewDate,
  getReviewWriteState,
  isEdited,
  ratingDistribution,
  ratingStars,
  reviewBody,
  reviewChanges,
  reviewError,
  reviewLength,
  validateReview,
  validateReviewChanges,
} from './stores/reviewViewModel.js'

const ten = '열 글자 이상인 리뷰입니다'

describe('입력 검증', () => {
  test.each([
    [{ rating: 5, content: ten }, ''],
    [{ rating: 1, content: '가'.repeat(10) }, ''],
    [{ rating: 5, content: '가'.repeat(2000) }, ''],
    [{ rating: 0, content: ten }, '별점을 1점부터 5점 중에서 골라 주세요.'],
    [{ rating: 6, content: ten }, '별점을 1점부터 5점 중에서 골라 주세요.'],
    [{ rating: 4.5, content: ten }, '별점을 1점부터 5점 중에서 골라 주세요.'],
    [{ content: ten }, '별점을 1점부터 5점 중에서 골라 주세요.'],
    [{ rating: 5, content: '   ' }, '리뷰 내용을 입력해 주세요.'],
    [{ rating: 5, content: `  ${'가'.repeat(9)}  ` }, '리뷰는 10자 이상 입력해 주세요.'],
    [{ rating: 5, content: '가'.repeat(2001) }, '리뷰는 2,000자까지 입력할 수 있습니다.'],
  ])('%o → %p', (values, message) => expect(validateReview(values)).toBe(message))

  test('글자 수는 서버처럼 앞뒤 공백을 빼고 코드 포인트로 센다(이모지 1글자)', () => {
    expect(reviewLength('  😀😀😀😀😀😀😀😀😀😀  ')).toBe(10)
    expect(validateReview({ rating: 5, content: '😀'.repeat(10) })).toBe('')
    expect(reviewLength(undefined)).toBe(0)
  })

  test.each([
    [{}, '바뀐 별점이나 내용이 없습니다. 고친 뒤 다시 저장해 주세요.'],
    [{ rating: null, content: null }, '바뀐 별점이나 내용이 없습니다. 고친 뒤 다시 저장해 주세요.'],
    [{ rating: 3 }, ''],
    [{ content: ten }, ''],
    [{ rating: 9 }, '별점을 1점부터 5점 중에서 골라 주세요.'],
    [{ content: '짧음' }, '리뷰는 10자 이상 입력해 주세요.'],
  ])('수정 %o → %p', (values, message) => expect(validateReviewChanges(values)).toBe(message))

  test.each([
    [{ rating: 4, content: `  ${ten}  ` }, { rating: 4, content: ten }],
    [{ rating: 2 }, { rating: 2 }],
    [{ content: ' 내용 ' }, { content: '내용' }],
    [{ rating: null, content: undefined }, {}],
  ])('본문 %o → %o', (values, body) => expect(reviewBody(values)).toEqual(body))
})

describe('수정할 때 바뀐 필드만', () => {
  const original = { id: 5, rating: 4, content: ten }
  test.each([
    [{ rating: 4, content: ten }, {}],
    [{ rating: 4, content: `  ${ten}  ` }, {}],
    [{ rating: 5, content: ten }, { rating: 5 }],
    [{ rating: 4, content: '내용을 새로 고쳐 썼습니다.' }, { content: '내용을 새로 고쳐 썼습니다.' }],
    [{ rating: 2, content: '내용을 새로 고쳐 썼습니다.' }, { rating: 2, content: '내용을 새로 고쳐 썼습니다.' }],
  ])('%o → %o', (values, changes) => expect(reviewChanges(original, values)).toEqual(changes))
})

describe('쓰기 영역 상태', () => {
  const mine = { id: 5, rating: 4, content: ten, is_owner: true }
  test.each([
    [{ loggedIn: true, page: { my_review: mine, can_review: false } }, 'mine'],
    [{ loggedIn: true, page: { my_review: null, can_review: true } }, 'form'],
    [{ loggedIn: true, page: { my_review: null, can_review: false } }, 'not-purchased'],
    [{ loggedIn: false, page: { my_review: null, can_review: false } }, 'guest'],
    [{ loggedIn: false, page: null }, 'guest'],
    [{}, 'guest'],
  ])('%o → %s', (data, state) => expect(getReviewWriteState(data)).toBe(state))
})

describe('표시', () => {
  test.each([[5, '★★★★★'], [3, '★★★☆☆'], [1, '★☆☆☆☆'], [4.4, '★★★★☆'], [4.5, '★★★★★'], [0, '☆☆☆☆☆'], [9, '★★★★★'], [null, '☆☆☆☆☆']])('별점 %p → %s', (rating, stars) => {
    expect(ratingStars(rating)).toBe(stars)
  })

  test.each([[4.5, '4.5'], [4, '4.0'], [3.25, '3.3'], [null, '-'], [undefined, '-']])('평균 %p → %s', (average, text) => expect(formatRatingAverage(average)).toBe(text))

  test('별점 분포는 5점부터, 막대 길이는 전체 리뷰 수 대비 정수 %', () => {
    expect(ratingDistribution({ 1: 0, 2: 0, 3: 1, 4: 4, 5: 7 }, 12)).toEqual([
      { score: 5, count: 7, percent: 58 },
      { score: 4, count: 4, percent: 33 },
      { score: 3, count: 1, percent: 8 },
      { score: 2, count: 0, percent: 0 },
      { score: 1, count: 0, percent: 0 },
    ])
    expect(ratingDistribution({}, 0).map((row) => row.percent)).toEqual([0, 0, 0, 0, 0])
    expect(ratingDistribution(undefined, 3).map((row) => row.count)).toEqual([0, 0, 0, 0, 0])
  })

  test.each([
    [{ created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }, false],
    [{ created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }, true],
    [{ created_at: '2026-10-01T00:00:00Z' }, false],
  ])('수정됨 %o → %s', (item, edited) => expect(isEdited(item)).toBe(edited))

  test.each([['2026-10-30T01:12:00Z', '2026년 10월 30일'], ['2026-10-29T16:00:00', '2026년 10월 30일'], ['', ''], ['bad', '']])('날짜 %p → %p', (value, text) => {
    expect(formatReviewDate(value)).toBe(text)
  })
})

describe('오류 문구', () => {
  const fallback = '리뷰를 등록하지 못했습니다. 다시 시도해 주세요.'
  test.each([
    ['401 은 로그인 만료', { response: { status: 401, data: { message: '로그인이 필요합니다.' } } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    ['403 미구매는 서버 문구', { response: { status: 403, data: { message: '구매한 상품만 리뷰를 남길 수 있습니다.' } } }, '구매한 상품만 리뷰를 남길 수 있습니다.'],
    ['403 남의 리뷰는 서버 문구', { response: { status: 403, data: { message: '본인이 작성한 리뷰만 수정하거나 삭제할 수 있습니다.' } } }, '본인이 작성한 리뷰만 수정하거나 삭제할 수 있습니다.'],
    ['404 는 서버 문구', { response: { status: 404, data: { message: '리뷰를 찾을 수 없습니다.' } } }, '리뷰를 찾을 수 없습니다.'],
    ['409 이미 작성은 서버 문구', { response: { status: 409, data: { message: '이미 이 상품의 리뷰를 작성했습니다.' } } }, '이미 이 상품의 리뷰를 작성했습니다.'],
    ['422 HTML 응답은 우리 문구', { response: { status: 422, data: '<html>' } }, fallback],
    ['500 은 우리 문구', { response: { status: 500, data: { message: 'Internal Server Error' } } }, fallback],
    ['네트워크 오류는 우리 문구', { isAxiosError: true, code: 'ERR_NETWORK' }, fallback],
  ])('%s', (_name, error, message) => expect(reviewError(error, fallback)).toBe(message))
})
