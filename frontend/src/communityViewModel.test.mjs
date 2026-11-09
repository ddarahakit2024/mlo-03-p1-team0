// 커뮤니티 view model(src/stores/communityViewModel.js)과 경로 함수(src/router/index.js 의 resolveCommunityRoute).
import { jest } from '@jest/globals'
import {
  BUDGET_SLIDER, BUILD_PREFERENCES, CORE_COMPARE_CATEGORIES, DEFAULT_BUDGET_MANWON, MONITOR_RESOLUTIONS, authorInitial, budgetSliderValue, budgetUsage,
  buildTitleHint, buildToastMessage, cartPrefillDraft, goToCompare, navCount, normalizePreferences, partLinesFromCart, preferenceLine, preferenceNames,
  quoteCompareProducts, readCartPrefillQuery, resolutionName, waitingQuoteCount,
} from './stores/communityViewModel.js'
import {
  BUDGET_PRESETS_MANWON, COMMUNITY_NAV_LINKS, COMMUNITY_WRITE_LINKS, MAX_PART_LINES, PURPOSE_FILTERS, addPartLine, boardName, boardNewPath, boardPageCount,
  boardPageItems, boardPath, boardRowNumber, budgetGapBadge, budgetInputFromKrw, budgetKrwFromInput, changedCommentFields, changedPostFields, communityBoard,
  communityError, communityListRequest, communityPostPath, draftFromPost, estimatedBudgetGap, estimatedPartsTotal, formatBoardDate, formatBoardDateTime,
  formatBudget, goToCommunityBoard, goToCommunityPost, isEdited, isQuote, normalizePurposeFilter, partItemsPayload, partLinesFromItems, postFromDraft,
  purposeName, quoteStatus, readPurposeQuery, removePartLine, replacePurposeQuery, samePartItems, splitBuildComments, textLength, validateBudgetInput, validateComment, validateCommunityPost,
  validatePostChanges, validatePostDraft,
} from './stores/communityViewModel.js'
import { resolveCommunityRoute, resolveRouteName } from './router/index.js'

describe('게시판·용도 표시', () => {
  test.each([
    ['free', '자유 게시판', '/community/free', '/community/free/new'],
    ['build', '견적 게시판', '/community/build', '/community/build/new'],
    ['questions', '질문 게시판', '/questions', '/questions/new'],
    ['notice', '커뮤니티', '/community', '/community'],
    [null, '커뮤니티', '/community', '/community'],
  ])('게시판 %p → %p, 목록 %p, 글쓰기 %p', (code, name, path, newPath) => {
    expect(boardName(code)).toBe(name)
    expect(boardPath(code)).toBe(path)
    expect(boardNewPath(code)).toBe(newPath)
  })

  test('모르는 게시판은 null, 왼쪽 게시판 메뉴는 커뮤니티 홈·질문·자유·견적 순서, 그 아래 글쓰기 바로가기', () => {
    expect(communityBoard('notice')).toBeNull()
    expect(COMMUNITY_NAV_LINKS.map((link) => [link.key, link.label, link.href])).toEqual([
      ['home', '커뮤니티 홈', '/community'], ['questions', '질문 게시판', '/questions'], ['free', '자유 게시판', '/community/free'], ['build', '견적 게시판', '/community/build'],
    ])
    expect(COMMUNITY_WRITE_LINKS.map((link) => [link.key, link.label, link.href, link.primary])).toEqual([
      ['questions', '질문하기', '/questions/new', false], ['build', '견적 요청하기', '/community/build/new', true],
    ])
  })

  test('용도 필터 칩은 전체 + 용도 5개, 예산 빠른 선택은 50·100·150·200·300만 원', () => {
    expect(PURPOSE_FILTERS.map((item) => [item.code, item.name])).toEqual([
      ['', '전체'], ['gaming', '게임'], ['office', '사무·학습'], ['creative', '영상·그래픽 작업'], ['development', '개발·AI'], ['other', '기타'],
    ])
    expect(BUDGET_PRESETS_MANWON).toEqual([50, 100, 150, 200, 300])
  })

  test.each([
    ['gaming', '게임'], ['office', '사무·학습'], ['creative', '영상·그래픽 작업'], ['development', '개발·AI'], ['other', '기타'], ['mining', ''], [null, ''],
  ])('용도 %p → %p', (code, name) => expect(purposeName(code)).toBe(name))

  test.each([
    [1500000, '150만 원'],
    [100000, '10만 원'],
    [100000000, '1억 원'],
    [12500000, '1,250만 원'],
    [1234567, '1,234,567원'],
    [null, ''],
    ['abc', ''],
  ])('예산 %p → %p', (krw, text) => expect(formatBudget(krw)).toBe(text))

  test('글 주소는 id 를 encodeURIComponent 한다', () => {
    expect(communityPostPath(3)).toBe('/community/posts/3')
    expect(communityPostPath('a/b')).toBe('/community/posts/a%2Fb')
  })

  test.each([
    [{ created_at: '2026-11-01T03:00:00Z', updated_at: '2026-11-01T03:00:00Z' }, false],
    [{ created_at: '2026-11-01T03:00:00Z', updated_at: '2026-11-02T03:00:00Z' }, true],
    [{}, false],
  ])('수정됨 %o → %p', (item, edited) => expect(isEdited(item)).toBe(edited))
})

describe('게시판 목록 표시(번호·날짜·쪽)', () => {
  // now 를 넘겨 시계와 상관없이 같은 결과를 본다. 날짜는 한국 시간 기준(서버 값은 UTC, 시간대가 없으면 UTC 로 본다)
  const NOW = '2026-11-01T05:00:00Z' // 한국 시간 2026-11-01 14:00
  test.each([
    ['오늘 쓴 글은 시:분', '2026-11-01T03:05:00Z', '12:05'],
    ['한국 시간 자정 넘긴 직후도 오늘', '2026-10-31T15:00:00Z', '00:00'],
    ['한국 시간 어제 23:59 는 날짜', '2026-10-31T14:59:00Z', '2026.10.31'],
    ['시간대가 없는 값은 UTC 로 본다', '2026-10-27T01:00:00', '2026.10.27'],
    ['다른 해', '2025-12-31T00:00:00Z', '2025.12.31'],
    ['빈 값', '', ''],
    ['틀린 값', 'not-a-date', ''],
  ])('목록 날짜: %s', (_name, value, text) => expect(formatBoardDate(value, NOW)).toBe(text))

  test.each([
    ['2026-11-01T03:00:00Z', '2026.11.01 12:00'],
    ['2026-10-28T01:00:00', '2026.10.28 10:00'],
    [null, ''],
  ])('상세 날짜 %p → %p', (value, text) => expect(formatBoardDateTime(value)).toBe(text))

  test.each([
    // [전체 수, 쪽, 쪽 크기, 순서(0부터), 번호]
    [128, 1, 10, 0, 128],
    [128, 1, 10, 9, 119],
    [128, 2, 10, 0, 118],
    [128, 13, 10, 7, 1],
    [3, 1, 10, 2, 1],
    [3, 2, 10, 0, ''],
    [0, 1, 10, 0, ''],
  ])('번호: 전체 %p, %p쪽(쪽당 %p), %p번째 → %p', (total, page, size, index, number) => expect(boardRowNumber(total, page, size, index)).toBe(number))

  test.each([
    [0, 10, 1], [1, 10, 1], [10, 10, 1], [11, 10, 2], [128, 10, 13], [undefined, 10, 1],
  ])('쪽 수: 전체 %p, 쪽당 %p → %p', (total, size, count) => expect(boardPageCount(total, size)).toBe(count))

  test.each([
    [1, 1, [1]],
    [2, 5, [1, 2, 3, 4, 5]],
    [7, 7, [1, 2, 3, 4, 5, 6, 7]],
    [1, 10, [1, 2, 3, 4, 5, 'end-gap', 10]],
    [4, 10, [1, 2, 3, 4, 5, 'end-gap', 10]],
    [5, 10, [1, 'start-gap', 4, 5, 6, 'end-gap', 10]],
    [7, 10, [1, 'start-gap', 6, 7, 8, 9, 10]],
    [10, 10, [1, 'start-gap', 6, 7, 8, 9, 10]],
    [99, 10, [1, 'start-gap', 6, 7, 8, 9, 10]],
    [0, 0, [1]],
  ])('쪽 목록: %p쪽 / 전체 %p쪽 → %p', (page, count, items) => expect(boardPageItems(page, count)).toEqual(items))
})

describe('견적 게시판: 용도 필터·상태·예산 비교', () => {
  test.each([
    ['gaming', 'gaming'], ['other', 'other'], ['', ''], ['mining', ''], [null, ''], [undefined, ''],
  ])('용도 필터 %p → %p', (value, code) => expect(normalizePurposeFilter(value)).toBe(code))

  test.each([
    ['견적 게시판 + 용도', { board: 'build', page: 2, search: '게임', purpose: 'gaming' }, { board: 'build', page: 2, pageSize: 10, search: '게임', purpose: 'gaming' }],
    ['견적 게시판 + 전체', { board: 'build', page: 1, search: '', purpose: '' }, { board: 'build', page: 1, pageSize: 10, search: '' }],
    ['견적 게시판 + 모르는 용도', { board: 'build', purpose: 'mining' }, { board: 'build', page: 1, pageSize: 10, search: '' }],
    ['자유 게시판에는 용도를 넣지 않는다', { board: 'free', page: 1, search: '', purpose: 'gaming' }, { board: 'free', page: 1, pageSize: 10, search: '' }],
  ])('목록 요청: %s', (_name, values, request) => expect(communityListRequest(values)).toEqual(request))

  test.each([
    ['?purpose=gaming', 'gaming'], ['?purpose=development&page=2', 'development'], ['?purpose=mining', ''], ['?purpose=', ''], ['', ''],
  ])('주소의 용도 필터 %p → %p', (search, code) => expect(readPurposeQuery(search)).toBe(code))

  test.each([
    ['gaming', '/community/build?purpose=gaming'], ['', '/community/build'], ['mining', '/community/build'],
  ])('용도 %p 를 고르면 주소를 %p 로 바꾼다(뒤로 가기 기록은 늘리지 않는다)', (code, path) => {
    const history = { replaceState: jest.fn() }
    replacePurposeQuery(code, history)
    expect(history.replaceState).toHaveBeenCalledWith({}, '', path)
  })

  test.each([
    [0, { waiting: true, label: '견적 대기' }],
    [null, { waiting: true, label: '견적 대기' }],
    [undefined, { waiting: true, label: '견적 대기' }],
    [1, { waiting: false, label: '견적 1개' }],
    [12, { waiting: false, label: '견적 12개' }],
    [1.5, { waiting: true, label: '견적 대기' }],
  ])('상태: quote_count %p → %o', (count, status) => expect(quoteStatus(count)).toEqual(status))

  test.each([
    [-310000, { tone: 'under', label: '예산 안 · 310,000원 남음' }],
    [0, { tone: 'exact', label: '예산에 딱 맞음' }],
    [1196000, { tone: 'over', label: '예산 초과 · 1,196,000원' }],
    [null, null],
    [undefined, null],
    ['abc', null],
  ])('예산 비교 배지: budget_gap_krw %p → %o', (gap, badge) => expect(budgetGapBadge(gap)).toEqual(badge))

  const lines = [{ product_id: 1, price_krw: 739000, quantity: 1 }, { product_id: 7, price_krw: 1290000, quantity: 1 }]
  test.each([
    ['예산보다 많음', lines, 1500000, 529000],
    ['예산보다 적음', lines, 3000000, -971000],
    ['고른 부품이 없음', [], 1500000, null],
    ['예산이 없음', lines, null, null],
  ])('화면 표시용 예상 예산 차이: %s', (_name, value, budget, gap) => expect(estimatedBudgetGap(value, budget)).toBe(gap))

  test('부품 목록이 있는 댓글만 견적이고, 나눠도 순서는 그대로', () => {
    const quoteA = { id: 1, items: [{ product_id: 1, quantity: 1 }] }
    const plain = { id: 2, items: [] }
    const noItems = { id: 3 }
    const quoteB = { id: 4, items: [{ product_id: 2, quantity: 2 }] }
    expect([quoteA, plain, noItems, quoteB].map(isQuote)).toEqual([true, false, false, true])
    expect(splitBuildComments([quoteA, plain, noItems, quoteB])).toEqual({ quotes: [quoteA, quoteB], comments: [plain, noItems] })
    expect(splitBuildComments()).toEqual({ quotes: [], comments: [] })
  })
})

describe('예산 입력(만 원 단위)', () => {
  test.each([
    ['150', 1500000],
    [' 1,500 ', 15000000],
    ['10', 100000],
    ['10000', 100000000],
    ['123.4567', 1234567],
    ['', null],
    ['150만', NaN],
    ['-10', NaN],
    ['1.23456', NaN],
  ])('입력 %p → budget_krw %p', (value, krw) => expect(budgetKrwFromInput(value)).toBe(krw))

  test.each([
    [1500000, '150'], [1234567, '123.4567'], [null, ''],
  ])('budget_krw %p → 입력 %p', (krw, value) => expect(budgetInputFromKrw(krw)).toBe(value))

  test.each([
    ['150', ''],
    ['10', ''],
    ['10000', ''],
    ['', '예산을 만 원 단위로 입력해 주세요.'],
    ['백오십', '예산은 숫자로만 입력해 주세요. 예: 150 (150만 원)'],
    ['9', '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'],
    ['10001', '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'],
  ])('예산 검사 %p → %p', (value, message) => expect(validateBudgetInput(value)).toBe(message))
})

describe('글 검사·요청 값', () => {
  test('글자 수는 앞뒤 공백을 빼고 코드 포인트로 센다', () => {
    expect(textLength('  👍 좋아요  ')).toBe(5)
    expect(textLength(null)).toBe(0)
  })

  const build = { board: 'build', title: '150만 원 게임용 견적', content: '배그 QHD', budgetInput: '150', purpose: 'gaming' }
  test.each([
    ['견적 글 정상', build, ''],
    ['자유 글 정상(예산·용도 무시)', { board: 'free', title: '후기', content: '내용', budgetInput: '', purpose: '' }, ''],
    ['모르는 게시판', { ...build, board: 'notice' }, '게시판을 찾을 수 없습니다. 커뮤니티 홈에서 게시판을 다시 골라 주세요.'],
    ['빈 제목', { ...build, title: '   ' }, '제목을 입력해 주세요.'],
    ['201자 제목', { ...build, title: '가'.repeat(201) }, '제목은 200자까지 입력할 수 있습니다.'],
    ['예산 없음', { ...build, budgetInput: '' }, '예산을 만 원 단위로 입력해 주세요.'],
    ['예산 범위 밖', { ...build, budgetInput: '5' }, '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'],
    ['용도 없음', { ...build, purpose: '' }, '용도를 골라 주세요.'],
    ['빈 내용', { ...build, content: ' ' }, '내용을 입력해 주세요.'],
    ['10,001자 내용', { ...build, content: '가'.repeat(10001) }, '내용은 10,000자까지 입력할 수 있습니다.'],
  ])('글쓰기 폼 %s', (_name, draft, message) => expect(validatePostDraft(draft)).toBe(message))

  test('견적 요청 폼은 화면 순서(예산 → 용도 → 제목 → 내용)대로 첫 오류를 알려 준다', () => {
    expect(validatePostDraft({ board: 'build', title: '', content: '', budgetInput: '', purpose: '' })).toBe('예산을 만 원 단위로 입력해 주세요.')
    expect(validatePostDraft({ board: 'build', title: '', content: '', budgetInput: '150', purpose: '' })).toBe('용도를 골라 주세요.')
    expect(validatePostDraft({ board: 'build', title: '', content: '', budgetInput: '150', purpose: 'gaming' })).toBe('제목을 입력해 주세요.')
    expect(validatePostDraft({ board: 'free', title: '', content: '' })).toBe('제목을 입력해 주세요.')
  })

  test('폼 값 → 요청 값: 견적 글은 budgetKrw·purpose, 자유 글은 없음', () => {
    expect(postFromDraft({ ...build, title: ' 제목 ' })).toEqual({ board: 'build', title: '제목', content: '배그 QHD', budgetKrw: 1500000, purpose: 'gaming' })
    expect(postFromDraft({ board: 'free', title: '후기', content: '내용', budgetInput: '150', purpose: 'gaming' })).toEqual({ board: 'free', title: '후기', content: '내용' })
  })

  test.each([
    [{ board: 'build', title: '제목', content: '내용', budgetKrw: 1500000, purpose: 'gaming' }, ''],
    [{ board: 'free', title: '제목', content: '내용' }, ''],
    [{ board: 'build', title: '제목', content: '내용', budgetKrw: 100000001, purpose: 'gaming' }, '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'],
    [{ board: 'free', title: '제목', content: '내용', purpose: 'gaming' }, '예산과 용도는 견적 게시판 글에만 적을 수 있습니다.'],
  ])('요청 값 검사 %o → %p', (post, message) => expect(validateCommunityPost(post)).toBe(message))

  const original = { id: 3, board: 'build', title: '150만 원 게임용 견적', content: '배그 QHD', budget_krw: 1500000, purpose: 'gaming' }
  test.each([
    ['아무것도 안 바꿈', draftFromPost(original), {}],
    ['앞뒤 공백만 추가', { ...draftFromPost(original), title: ' 150만 원 게임용 견적 ' }, {}],
    ['제목만', { ...draftFromPost(original), title: '200만 원 게임용' }, { title: '200만 원 게임용' }],
    ['예산·용도', { ...draftFromPost(original), budgetInput: '200', purpose: 'creative' }, { budgetKrw: 2000000, purpose: 'creative' }],
    ['내용', { ...draftFromPost(original), content: '로아도 합니다' }, { content: '로아도 합니다' }],
  ])('견적 글 수정의 바뀐 필드: %s', (_name, draft, changes) => expect(changedPostFields(original, draft)).toEqual(changes))

  test('자유 글 수정에는 예산·용도를 넣지 않는다', () => {
    const free = { id: 4, board: 'free', title: '후기', content: '내용', budget_krw: null, purpose: null }
    expect(draftFromPost(free)).toEqual({ board: 'free', title: '후기', content: '내용', budgetInput: '', purpose: '', monitorResolution: '', preferences: [] })
    expect(changedPostFields(free, { ...draftFromPost(free), budgetInput: '150', purpose: 'gaming', content: '바뀐 내용' })).toEqual({ content: '바뀐 내용' })
  })

  test.each([
    [{}, '바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.'],
    [{ title: '' }, '제목을 입력해 주세요.'],
    [{ purpose: 'mining' }, '용도를 골라 주세요.'],
    [{ budgetKrw: NaN }, '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'],
    [{ content: '고친 내용' }, ''],
  ])('수정 값 검사 %o → %p', (changes, message) => expect(validatePostChanges(changes)).toBe(message))
})

describe('댓글·부품 목록', () => {
  const cpu = { id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', price_krw: 739000, stock: 12, thumbnail_url: '/images/products/amd-ryzen7-9800x3d.webp' }
  const gpu = { id: 7, name: '지포스 RTX 5070 Ti 벤투스 3X OC 16GB', brand: 'MSI', category: 'gpu', price_krw: 1290000, stock: 0, thumbnail_url: '' }

  test.each([
    [{ content: '이렇게 맞춰 보세요' }, ''],
    [{ content: '가'.repeat(5000), items: [{ product_id: 1, quantity: 10 }] }, ''],
    [{ content: '  ' }, '댓글 내용을 입력해 주세요.'],
    [{ content: '가'.repeat(5001) }, '댓글은 5,000자까지 입력할 수 있습니다.'],
    [{ content: '견적', items: [{ product_id: 1, quantity: 0 }] }, '수량은 1개부터 10개까지 고를 수 있습니다.'],
    [{ content: '견적', items: [{ product_id: 1, quantity: 1.5 }] }, '수량은 1개부터 10개까지 고를 수 있습니다.'],
    [{ content: '견적', items: [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 1 }] }, '같은 상품을 두 줄로 넣을 수 없습니다. 줄을 빼고 수량을 바꿔 다시 추가해 주세요.'],
    [{ content: '견적', items: Array.from({ length: 16 }, (_, index) => ({ product_id: index, quantity: 1 })) }, '부품은 15줄까지 붙일 수 있습니다.'],
  ])('댓글 검사 %#', (values, message) => expect(validateComment(values)).toBe(message))

  test('줄 추가: 상품 정보를 줄에 담고, 요청 본문에는 product_id·quantity 만 넣는다', () => {
    const first = addPartLine([], cpu, 2)
    expect(first.error).toBe('')
    expect(first.lines).toEqual([{ product_id: 1, name: cpu.name, brand: 'AMD', category: 'cpu', thumbnail_url: cpu.thumbnail_url, price_krw: 739000, stock: 12, quantity: 2 }])
    const second = addPartLine(first.lines, gpu, 1)
    expect(partItemsPayload(second.lines)).toEqual([{ product_id: 1, quantity: 2 }, { product_id: 7, quantity: 1 }])
    expect(removePartLine(second.lines, 1).map((line) => line.product_id)).toEqual([7])
  })

  const full = Array.from({ length: MAX_PART_LINES }, (_, index) => ({ product_id: 100 + index, quantity: 1, price_krw: 1000 }))
  test.each([
    ['상품을 안 고름', [], null, 1, '추가할 상품을 골라 주세요.'],
    ['수량 0', [], cpu, 0, '수량은 1개부터 10개까지 고를 수 있습니다.'],
    ['수량 11', [], cpu, 11, '수량은 1개부터 10개까지 고를 수 있습니다.'],
    ['이미 있는 상품', [{ product_id: 1, quantity: 1 }], cpu, 3, '이미 목록에 있는 상품입니다. 수량을 바꾸려면 줄을 빼고 다시 추가해 주세요.'],
    ['15줄이 참', full, cpu, 1, '부품은 15줄까지 붙일 수 있습니다. 줄을 빼고 다시 추가해 주세요.'],
  ])('줄을 추가하지 않는 경우: %s', (_name, lines, product, quantity, message) => {
    const result = addPartLine(lines, product, quantity)
    expect(result.error).toBe(message)
    expect(result.lines).toBe(lines)
  })

  test('예상 합계는 상품 목록 가격 × 수량의 합(화면 표시용)', () => {
    expect(estimatedPartsTotal([{ price_krw: 739000, quantity: 2 }, { price_krw: 1290000, quantity: 1 }])).toBe(2768000)
    expect(estimatedPartsTotal([])).toBe(0)
  })

  const comment = {
    id: 10, content: '이렇게 맞춰 보세요',
    items: [
      { product_id: 1, name: cpu.name, brand: 'AMD', category: 'cpu', thumbnail_url: cpu.thumbnail_url, price_krw: 739000, stock: 12, quantity: 1, line_total_krw: 739000 },
      { product_id: 7, name: gpu.name, brand: 'MSI', category: 'gpu', thumbnail_url: '', price_krw: 1290000, stock: 0, quantity: 1, line_total_krw: 1290000 },
    ],
  }
  test('서버 댓글의 items → 수정 폼의 줄(서버 금액 필드는 버린다)', () => {
    expect(partLinesFromItems(comment.items)[0]).toEqual({ product_id: 1, name: cpu.name, brand: 'AMD', category: 'cpu', thumbnail_url: cpu.thumbnail_url, price_krw: 739000, stock: 12, quantity: 1 })
    expect(samePartItems(partItemsPayload(comment.items), partItemsPayload(partLinesFromItems(comment.items)))).toBe(true)
    expect(samePartItems([{ product_id: 1, quantity: 1 }], [{ product_id: 1, quantity: 2 }])).toBe(false)
  })

  test.each([
    ['아무것도 안 바꿈', { content: comment.content, lines: partLinesFromItems(comment.items) }, 'build', {}],
    ['내용만', { content: ' 고친 내용 ', lines: partLinesFromItems(comment.items) }, 'build', { content: '고친 내용' }],
    ['줄 하나 빼기', { content: comment.content, lines: partLinesFromItems(comment.items).slice(1) }, 'build', { items: [{ product_id: 7, quantity: 1 }] }],
    ['줄 모두 빼기', { content: comment.content, lines: [] }, 'build', { items: [] }],
    ['자유 게시판은 items 를 보내지 않는다', { content: comment.content, lines: [] }, 'free', {}],
  ])('댓글 수정의 바뀐 필드: %s', (_name, draft, board, changes) => expect(changedCommentFields(comment, draft, board)).toEqual(changes))
})

describe('오류 문구', () => {
  const fallback = '게시글을 불러오지 못했습니다. 다시 시도해 주세요.'
  test.each([
    ['401 은 로그인 만료', { response: { status: 401 } }, 'post', '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    ['403 남의 글', { response: { status: 403, data: { message: 'Forbidden' } } }, 'post', '본인이 작성한 글만 수정하거나 삭제할 수 있습니다.'],
    ['403 남의 댓글', { response: { status: 403 } }, 'comment', '본인이 작성한 댓글만 수정하거나 삭제할 수 있습니다.'],
    ['403 작성은 요청 확인 실패(Origin)', { response: { status: 403 } }, 'write', '이 페이지에서 보낸 요청을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'],
    ['404 는 서버 문구 + 새로고침 안내', { response: { status: 404, data: { message: '댓글을 찾을 수 없습니다.' } } }, 'comment', '댓글을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
    ['404 문구가 없으면 우리 문구', { response: { status: 404 } }, 'post', '글을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.'],
    ['422 는 서버 문구', { response: { status: 422, data: { message: '목록에 없는 상품이 있습니다. 상품을 다시 골라 주세요.' } } }, 'write', '목록에 없는 상품이 있습니다. 상품을 다시 골라 주세요.'],
    ['422 문구가 없으면 우리 문구', { response: { status: 422, data: {} } }, 'post', fallback],
    ['500 은 우리 문구', { response: { status: 500, data: { message: 'Internal Server Error' } } }, 'post', fallback],
    ['네트워크 오류는 우리 문구', { isAxiosError: true, code: 'ERR_NETWORK' }, 'post', fallback],
  ])('%s', (_name, error, subject, message) => expect(communityError(error, fallback, subject)).toBe(message))
})

describe('이동', () => {
  test('글 상세·게시판 목록으로 location.assign 한다', () => {
    const location = { assign: jest.fn() }
    goToCommunityPost(12, location)
    goToCommunityBoard('build', location)
    goToCommunityBoard('notice', location)
    expect(location.assign.mock.calls).toEqual([['/community/posts/12'], ['/community/build'], ['/community']])
  })
})

describe('견적 요청의 모니터 해상도·선호 사항(CONTRACT §10)', () => {
  test('이름 표: 해상도 4개(fhd·qhd·uhd·none), 선호 5개(quiet·small·white·rgb·upgradable)', () => {
    expect(MONITOR_RESOLUTIONS.map((item) => [item.code, item.name])).toEqual([
      ['fhd', 'FHD (1920×1080)'], ['qhd', 'QHD (2560×1440)'], ['uhd', '4K (3840×2160)'], ['none', '아직 없음'],
    ])
    expect(BUILD_PREFERENCES.map((item) => [item.code, item.name])).toEqual([
      ['quiet', '조용한 PC'], ['small', '작은 케이스'], ['white', '화이트'], ['rgb', 'RGB'], ['upgradable', '업그레이드 여유'],
    ])
  })

  test.each([
    ['fhd', 'FHD (1920×1080)'], ['uhd', '4K (3840×2160)'], ['none', '아직 없음'], [null, ''], ['8k', ''],
  ])('해상도 %p → %p', (code, name) => expect(resolutionName(code)).toBe(name))

  test.each([
    [['rgb', 'quiet'], ['quiet', 'rgb'], ['조용한 PC', 'RGB'], '조용한 PC · RGB'],
    [['white', 'white', 'neon'], ['white'], ['화이트'], '화이트'],
    [[], [], [], '선호 없음'],
    [null, [], [], '선호 없음'],
    ['quiet', [], [], '선호 없음'],
  ])('선호 %p → 코드 %p, 이름 %p, 한 줄 %p', (list, codes, names, line) => {
    expect(normalizePreferences(list)).toEqual(codes)
    expect(preferenceNames(list)).toEqual(names)
    expect(preferenceLine(list)).toBe(line)
  })

  test('선호 한 줄의 빈 값 문구를 바꿀 수 있다', () => expect(preferenceLine([], '-')).toBe('-'))

  const build = { board: 'build', title: '견적', content: '내용', budgetInput: '150', purpose: 'gaming' }
  test.each([
    ['고르지 않으면 넣지 않는다', { ...build, monitorResolution: '', preferences: [] }, { board: 'build', title: '견적', content: '내용', budgetKrw: 1500000, purpose: 'gaming' }],
    ['고르면 넣는다(선호는 화면 순서, 모르는 값은 버림)', { ...build, monitorResolution: 'qhd', preferences: ['rgb', 'quiet', 'neon'] }, { board: 'build', title: '견적', content: '내용', budgetKrw: 1500000, purpose: 'gaming', monitorResolution: 'qhd', preferences: ['quiet', 'rgb'] }],
    ['자유 글에는 넣지 않는다', { board: 'free', title: '후기', content: '내용', monitorResolution: 'qhd', preferences: ['rgb'] }, { board: 'free', title: '후기', content: '내용' }],
  ])('폼 값 → 등록 값: %s', (_name, draft, post) => expect(postFromDraft(draft)).toEqual(post))

  const original = { id: 3, board: 'build', title: '견적', content: '내용', budget_krw: 1500000, purpose: 'gaming', monitor_resolution: 'fhd', preferences: ['rgb', 'quiet'] }
  test.each([
    ['그대로', {}, {}],
    ['해상도만', { monitorResolution: 'uhd' }, { monitorResolution: 'uhd' }],
    ['선호 순서만 바뀜', { preferences: ['quiet', 'rgb'] }, {}],
    ['선호만', { preferences: ['white'] }, { preferences: ['white'] }],
    ['선호를 모두 뺌', { preferences: [] }, { preferences: [] }],
    ['해상도를 비워도(값이 있던 글) 보내지 않는다', { monitorResolution: '' }, {}],
  ])('견적 글 수정의 바뀐 필드(모니터·선호): %s', (_name, patch, changes) => {
    expect(draftFromPost(original)).toMatchObject({ monitorResolution: 'fhd', preferences: ['quiet', 'rgb'] })
    expect(changedPostFields(original, { ...draftFromPost(original), ...patch })).toEqual(changes)
  })

  test('해상도가 없던 글에 처음 고르면 보낸다', () => {
    const plain = { ...original, monitor_resolution: null, preferences: null }
    expect(draftFromPost(plain)).toMatchObject({ monitorResolution: '', preferences: [] })
    expect(changedPostFields(plain, { ...draftFromPost(plain), monitorResolution: 'none' })).toEqual({ monitorResolution: 'none' })
  })

  test.each([
    [{ monitorResolution: 'qhd' }, ''],
    [{ preferences: ['quiet', 'rgb'] }, ''],
    [{ preferences: [] }, ''],
    [{ monitorResolution: '8k' }, '모니터 해상도를 목록에서 골라 주세요.'],
    [{ monitorResolution: null }, '모니터 해상도를 목록에서 골라 주세요.'],
    [{ preferences: ['quiet', 'quiet'] }, '선호 사항을 목록에서 다시 골라 주세요.'],
    [{ preferences: ['neon'] }, '선호 사항을 목록에서 다시 골라 주세요.'],
    [{ preferences: 'quiet' }, '선호 사항을 목록에서 다시 골라 주세요.'],
  ])('모니터·선호만 바뀐 수정도 검사해서 보낸다 %o → %p', (changes, message) => expect(validatePostChanges(changes)).toBe(message))

  test.each([
    [{ board: 'build', title: '제목', content: '내용', budgetKrw: 1500000, purpose: 'gaming', monitorResolution: 'qhd', preferences: ['rgb'] }, ''],
    [{ board: 'build', title: '제목', content: '내용', budgetKrw: 1500000, purpose: 'gaming', monitorResolution: '8k' }, '모니터 해상도를 목록에서 골라 주세요.'],
    [{ board: 'free', title: '제목', content: '내용', preferences: ['rgb'] }, '예산과 용도는 견적 게시판 글에만 적을 수 있습니다.'],
  ])('등록 값 검사(모니터·선호) %o → %p', (post, message) => expect(validateCommunityPost(post)).toBe(message))
})

describe('견적 요청 글쓰기: 예산 슬라이더·제목 안내·장바구니로 채우기', () => {
  test('슬라이더는 50~500만 원, 10 단위, 새 요청은 150만 원에서 시작', () => {
    expect(BUDGET_SLIDER).toEqual({ min: 50, max: 500, step: 10 })
    expect(DEFAULT_BUDGET_MANWON).toBe(150)
  })

  test.each([
    ['150', 150], ['155', 160], ['154', 150], ['30', 50], ['1000', 500], ['', 150], ['abc', 150], ['49.5', 50],
  ])('만 원 입력 %p → 슬라이더 %p', (input, value) => expect(budgetSliderValue(input)).toBe(value))

  test.each([
    [{ budgetInput: '150', purpose: 'gaming' }, '150만 원 게임 PC 견적 부탁드립니다'],
    [{ budgetInput: '1,200', purpose: 'creative' }, '1,200만 원 영상·그래픽 작업 PC 견적 부탁드립니다'],
    [{ budgetInput: '150', purpose: '' }, '150만 원 PC 견적 부탁드립니다'],
    [{ budgetInput: '', purpose: 'office' }, '사무·학습 PC 견적 부탁드립니다'],
    [{}, 'PC 견적 부탁드립니다'],
  ])('제목 안내 %o → %p', (draft, hint) => expect(buildTitleHint(draft)).toBe(hint))

  test.each([
    ['?from=cart', true], ['?from=cart&x=1', true], ['?from=detail', false], ['', false], [undefined, false],
  ])('주소 %p 는 장바구니로 채우기 %p', (search, expected) => expect(readCartPrefillQuery(search ?? '')).toBe(expected))

  test.each([
    ['담긴 상품마다 한 줄(2개 이상이면 수량), 제목의 N 은 서버 item_count', { items: [{ name: '라이젠7 9800X3D', price_krw: 739000, quantity: 1 }, { name: 'DDR5 32GB', price_krw: 129000, quantity: 2 }], item_count: 3 },
      { title: '이 구성 괜찮을까요? (장바구니 3개)', content: '- 라이젠7 9800X3D 739,000원\n- DDR5 32GB 129,000원 × 2개' }],
    ['item_count 가 없으면 줄 수', { items: [{ name: '케이스', price_krw: 99000, quantity: 1 }] }, { title: '이 구성 괜찮을까요? (장바구니 1개)', content: '- 케이스 99,000원' }],
    ['빈 장바구니', { items: [], item_count: 0 }, null],
    ['응답 없음', null, null],
  ])('장바구니 → 견적 요청 처음 값: %s', (_name, cart, draft) => expect(cartPrefillDraft(cart)).toEqual(draft))
})

describe('커뮤니티 홈·받은 견적 카드 표시', () => {
  test.each([
    [[{ quote_count: 0 }, { quote_count: 2 }, { quote_count: null }, {}], 3],
    [[{ quote_count: 1 }], 0],
    [[], 0],
    [null, 0],
  ])('견적을 기다리는 글 수 %o → %p', (items, count) => expect(waitingQuoteCount(items)).toBe(count))

  test.each([
    [{ questions: 31, build: 0 }, 'questions', '31'],
    [{ questions: 1234 }, 'questions', '1,234'],
    [{ build: 0 }, 'build', '0'],
    [{ free: null }, 'free', ''],
    [{}, 'free', ''],
    [undefined, 'free', ''],
    [{ free: -1 }, 'free', ''],
  ])('메뉴 글 수 %o[%p] → %p', (counts, key, label) => expect(navCount(counts, key)).toBe(label))

  test.each([
    [1350000, 1500000, { percent: 90, width: 90, over: false, label: '90% / 150만 원', ariaLabel: '예산 150만 원 중 90% 사용' }],
    [1500000, 1500000, { percent: 100, width: 100, over: false, label: '100% / 150만 원', ariaLabel: '예산 150만 원 중 100% 사용' }],
    [2029000, 1500000, { percent: 135, width: 100, over: true, label: '135% / 150만 원', ariaLabel: '예산 150만 원 중 135% 사용(예산 초과)' }],
    [0, 1000000, { percent: 0, width: 0, over: false, label: '0% / 100만 원', ariaLabel: '예산 100만 원 중 0% 사용' }],
    [1000, 3000000, { percent: 0, width: 0, over: false, label: '0% / 300만 원', ariaLabel: '예산 300만 원 중 0% 사용' }],
    [500000, null, null],
    [null, 1500000, null],
    [500000, 0, null],
  ])('예산 사용 막대: 합계 %p / 예산 %p → %o', (total, budget, usage) => expect(budgetUsage(total, budget)).toEqual(usage))

  test.each([
    ['조립왕', '조'], ['  kim ', 'K'], ['😀웃음', '😀'], ['', '회'], [null, '회'],
  ])('아바타 첫 글자 %p → %p', (name, initial) => expect(authorInitial(name)).toBe(initial))

  test.each([
    [{ added: [{ product_id: 1 }, { product_id: 2 }] }, '부품 2개를 장바구니에 담았어요'],
    [{ added: [] }, '장바구니에 담았어요'],
    [null, '장바구니에 담았어요'],
  ])('견적 담기 토스트 %o → %p', (result, message) => expect(buildToastMessage(result)).toBe(message))
})

describe('장바구니 구성으로 견적 보내기(partLinesFromCart)', () => {
  const item = (id, extra = {}) => ({ product_id: id, name: `부품 ${id}`, brand: 'B', category: 'cpu', thumbnail_url: '', price_krw: 1000, stock: 5, quantity: 1, subtotal_krw: 1000, ...extra })
  test.each([
    ['그대로 줄로', { items: [item(1), item(2, { quantity: 3 })] }, [[1, 1], [2, 3]], 0, 0],
    ['수량은 10개까지', { items: [item(1, { quantity: 12 })] }, [[1, 10]], 0, 1],
    ['15줄까지', { items: Array.from({ length: 17 }, (_, index) => item(index + 1)) }, Array.from({ length: 15 }, (_, index) => [index + 1, 1]), 2, 0],
    ['빈 장바구니', { items: [] }, [], 0, 0],
    ['응답 없음', null, [], 0, 0],
  ])('%s', (_name, cart, lines, skipped, clamped) => {
    const result = partLinesFromCart(cart)
    expect(result.lines.map((line) => [line.product_id, line.quantity])).toEqual(lines)
    expect([result.skipped, result.clamped]).toEqual([skipped, clamped])
  })

  test('줄은 부품 고르기 모양(가격·합계는 화면 표시용, 서버로는 product_id·quantity 만)', () => {
    expect(partLinesFromCart({ items: [item(7, { name: 'RTX', brand: 'MSI', category: 'gpu', thumbnail_url: '/g.webp', price_krw: 1290000, stock: 3, quantity: 2 })] }).lines).toEqual([
      { product_id: 7, name: 'RTX', brand: 'MSI', category: 'gpu', thumbnail_url: '/g.webp', price_krw: 1290000, stock: 3, quantity: 2 },
    ])
  })
})

describe('핵심 부품 비교(quoteCompareProducts)', () => {
  const part = (id, category, lineTotal, extra = {}) => ({ product_id: id, name: `부품 ${id}`, category, thumbnail_url: `/p${id}.webp`, price_krw: lineTotal, quantity: 1, line_total_krw: lineTotal, ...extra })
  test('핵심 카테고리는 CPU·그래픽카드·메인보드', () => expect(CORE_COMPARE_CATEGORIES).toEqual(['cpu', 'gpu', 'mainboard']))

  test.each([
    ['금액이 가장 큰 카테고리(그래픽카드)', [part(1, 'cpu', 739000), part(7, 'gpu', 1290000), part(60, 'mainboard', 300000)], 'gpu', [7]],
    ['같은 카테고리가 여러 개면 모두(줄 금액 합으로 비교)', [part(1, 'cpu', 400000), part(2, 'cpu', 400000), part(7, 'gpu', 700000)], 'cpu', [1, 2]],
    ['금액이 같으면 CPU → 그래픽카드 → 메인보드 순', [part(60, 'mainboard', 500000), part(7, 'gpu', 500000)], 'gpu', [7]],
    ['4개까지', [5, 6, 7, 8, 9].map((id) => part(id, 'gpu', 100000)), 'gpu', [5, 6, 7, 8]],
    ['핵심 부품이 없으면 빈 목록', [part(200, 'psu', 150000), part(300, 'case', 90000)], null, []],
    ['line_total_krw 가 없으면 가격 × 수량', [part(1, 'cpu', 0, { line_total_krw: undefined, price_krw: 300000, quantity: 3 }), part(7, 'gpu', 800000)], 'cpu', [1]],
  ])('%s', (_name, items, category, ids) => {
    const result = quoteCompareProducts(items)
    expect(result.category).toBe(category)
    expect(result.products.map((product) => product.id)).toEqual(ids)
  })

  test('비교함에 넣는 모양은 { id, name, category, thumbnail_url }', () => {
    expect(quoteCompareProducts([part(7, 'gpu', 1)]).products).toEqual([{ id: 7, name: '부품 7', category: 'gpu', thumbnail_url: '/p7.webp' }])
  })

  test('비교 화면으로 location.assign 한다', () => {
    const location = { assign: jest.fn() }
    goToCompare(location)
    expect(location.assign).toHaveBeenCalledWith('/compare')
  })
})

describe('경로(resolveCommunityRoute)', () => {
  test.each([
    ['/community', { name: 'community' }],
    ['/community/', { name: 'community' }],
    ['/community/free', { name: 'community-list', board: 'free' }],
    ['/community/build/', { name: 'community-list', board: 'build' }],
    ['/community/notice', { name: 'community-list', board: null }],
    ['/community/a/b/c', { name: 'community-list', board: null }],
    ['/community/free/new', { name: 'community-new', board: 'free' }],
    ['/community/build/new/', { name: 'community-new', board: 'build' }],
    ['/community/notice/new', { name: 'community-new', board: null }],
    ['/community/posts/3', { name: 'community-detail', id: 3 }],
    ['/community/posts/3/edit', { name: 'community-edit', id: 3 }],
    ['/community/posts/abc', { name: 'community-detail', id: null }],
    ['/community/posts/0', { name: 'community-detail', id: null }],
    ['/community/posts/-1/edit', { name: 'community-edit', id: null }],
    ['/community/posts/99999999999999999999', { name: 'community-detail', id: null }],
    ['/communityx', null],
    ['/questions', null],
    ['/', null],
  ])('%s → %o', (pathname, route) => expect(resolveCommunityRoute(pathname)).toEqual(route))

  test.each([
    ['/community', 'community'],
    ['/community/build', 'community-list'],
    ['/community/free/new', 'community-new'],
    ['/community/posts/3', 'community-detail'],
    ['/community/posts/3/edit', 'community-edit'],
    ['/questions', 'questions'],
  ])('화면 이름(page_view route) %s → %s', (pathname, name) => expect(resolveRouteName(pathname)).toBe(name))
})
