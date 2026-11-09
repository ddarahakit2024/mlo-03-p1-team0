// 커뮤니티(자유·견적 게시판) 화면의 표시 값·검증·바뀐 필드·오류 문구·부품 고르기·이동 함수.
// spec: docs/specs/2026-11-01-community-dark-theme.md. Vue·axios 를 import 하지 않는다. 브라우저 객체(location)는 인자로 받는다.
// 부품 목록의 "예상 합계"는 화면 표시용이다. 서버로 보내지 않고, 등록 뒤에는 서버가 계산한 items_total_krw 를 보여 준다.

export const COMMUNITY_PAGE_SIZE = 10
export const COMMUNITY_HOME_PAGE_SIZE = 5
export const MAX_COMMUNITY_SEARCH_LENGTH = 200
export const MAX_POST_TITLE_LENGTH = 200
export const MAX_POST_CONTENT_LENGTH = 10000
export const MAX_COMMENT_LENGTH = 5000
// 견적 글의 예산(budget_krw): 100,000~100,000,000원. 화면은 만 원 단위로 입력받는다
export const MIN_BUDGET_KRW = 100000
export const MAX_BUDGET_KRW = 100000000
export const MANWON = 10000
// 견적 답글의 부품 목록: 최대 15줄, 줄마다 수량 1~10, 같은 상품 두 줄 금지
export const MAX_PART_LINES = 15
export const MAX_PART_QUANTITY = 10
// 부품 고르기가 카테고리별로 불러오는 상품 수(GET /products 의 page_size 최대값)
export const PARTS_PRODUCT_PAGE_SIZE = 50

// 게시판 정보. writeLabel 은 글쓰기 버튼 이름, countLabel 은 목록 머리의 "전체 ○○ N개" 에 쓰는 이름. description 은 디자인 시안(MOA Parts)의 게시판 설명
export const COMMUNITY_BOARDS = [
  { code: 'free', name: '자유 게시판', path: '/community/free', newPath: '/community/free/new', writeLabel: '글쓰기', countLabel: '글', description: '조립기, 후기, 잡담 — PC 이야기는 무엇이든.' },
  { code: 'build', name: '견적 게시판', path: '/community/build', newPath: '/community/build/new', writeLabel: '견적 요청하기', countLabel: '견적 요청', description: '예산과 용도를 올리면 회원들이 MOA 판매 부품으로 견적을 보내드려요. 마음에 들면 바로 장바구니에.' },
]
// 질문 게시판은 질문 API(/questions)를 그대로 쓴다. 커뮤니티 홈과 왼쪽 게시판 메뉴에 함께 나온다
export const QUESTION_BOARD = { code: 'questions', name: '질문 게시판', path: '/questions', newPath: '/questions/new', writeLabel: '질문하기', countLabel: '질문', description: '부품을 지정해서 물어보면 답변이 빨라요. 견적표나 오류 화면은 이미지로 첨부할 수 있어요.' }

// 왼쪽 게시판 메뉴(CommunityShell). 링크 이름은 시뮬레이터가 그대로 찾는다(spec 2차 개편 "레이아웃")
export const COMMUNITY_NAV_LINKS = [
  { key: 'home', label: '커뮤니티 홈', href: '/community' },
  { key: 'questions', label: QUESTION_BOARD.name, href: QUESTION_BOARD.path },
  ...COMMUNITY_BOARDS.map((board) => ({ key: board.code, label: board.name, href: board.path })),
]
// 게시판 메뉴 아래의 "바로 쓰기"(디자인: 질문하기 + 견적 요청하기(강조)). 자유 게시판 글쓰기는 자유 게시판 목록 머리에 있다
export const COMMUNITY_WRITE_LINKS = [
  { key: QUESTION_BOARD.code, label: QUESTION_BOARD.writeLabel, href: QUESTION_BOARD.newPath, primary: false },
  { key: 'build', label: '견적 요청하기', href: '/community/build/new', primary: true },
]

/** 게시판 메뉴 옆 글 수: 화면이 이미 받은 전체 수(total)만 넘긴다. 숫자가 아니면 ''(그리지 않는다). */
export function navCount(counts, key) {
  const value = Number(counts?.[key])
  return counts?.[key] != null && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('ko-KR') : ''
}

// 견적 글의 용도. hint 는 글쓰기 화면의 용도 카드 설명
export const COMMUNITY_PURPOSES = [
  { code: 'gaming', name: '게임', hint: '고사양 게임, 높은 주사율' },
  { code: 'office', name: '사무·학습', hint: '문서, 인강, 웹 서핑' },
  { code: 'creative', name: '영상·그래픽 작업', hint: '영상 편집, 3D, 디자인' },
  { code: 'development', name: '개발·AI', hint: '코딩, 가상 머신, 로컬 AI' },
  { code: 'other', name: '기타', hint: '홈 서버, 방송, 그 밖의 용도' },
]
// 견적 게시판 목록의 용도 필터 칩. code '' 는 전체(purpose 쿼리를 보내지 않는다)
export const PURPOSE_FILTERS = [{ code: '', name: '전체' }, ...COMMUNITY_PURPOSES.map(({ code, name }) => ({ code, name }))]
// 견적 요청 글쓰기의 예산 빠른 선택(만 원)
export const BUDGET_PRESETS_MANWON = [50, 100, 150, 200, 300]
// 예산 슬라이더(만 원): 50~500, 10 단위. 새 견적 요청은 150만 원에서 시작한다(디자인 기본값). 만 원 입력칸은 그대로 10만~1억 원을 받는다
export const BUDGET_SLIDER = { min: 50, max: 500, step: 10 }
export const DEFAULT_BUDGET_MANWON = 150
// 견적 요청의 모니터 해상도·선호 사항(CONTRACT §10). 코드는 서버 값, 이름은 화면 문구
export const MONITOR_RESOLUTIONS = [
  { code: 'fhd', name: 'FHD (1920×1080)' },
  { code: 'qhd', name: 'QHD (2560×1440)' },
  { code: 'uhd', name: '4K (3840×2160)' },
  { code: 'none', name: '아직 없음' },
]
export const BUILD_PREFERENCES = [
  { code: 'quiet', name: '조용한 PC' },
  { code: 'small', name: '작은 케이스' },
  { code: 'white', name: '화이트' },
  { code: 'rgb', name: 'RGB' },
  { code: 'upgradable', name: '업그레이드 여유' },
]

const BOARD_CODES = COMMUNITY_BOARDS.map((board) => board.code)
const PURPOSE_CODES = COMMUNITY_PURPOSES.map((purpose) => purpose.code)
const RESOLUTION_CODES = MONITOR_RESOLUTIONS.map((item) => item.code)
const PREFERENCE_CODES = BUILD_PREFERENCES.map((item) => item.code)

/** 모니터 해상도 코드 → 이름. 모르는 값·null 은 ''. */
export function resolutionName(code) {
  return MONITOR_RESOLUTIONS.find((item) => item.code === code)?.name || ''
}

/** 선호 사항 목록 → 아는 코드만, 한 번씩, 화면 순서대로. 배열이 아니면 []. */
export function normalizePreferences(list) {
  if (!Array.isArray(list)) return []
  return PREFERENCE_CODES.filter((code) => list.includes(code))
}

/** 선호 사항 목록 → 이름 목록(화면 순서). */
export function preferenceNames(list) {
  return normalizePreferences(list).map((code) => BUILD_PREFERENCES.find((item) => item.code === code).name)
}

/** 선호 사항 한 줄: '조용한 PC · 화이트'. 없으면 empty(기본 '선호 없음'). */
export function preferenceLine(list, empty = '선호 없음') {
  return preferenceNames(list).join(' · ') || empty
}

/** 만 원 입력 → 슬라이더 값(50~500, 10 단위로 맞춘다). 비었거나 숫자가 아니면 기본값(150). */
export function budgetSliderValue(budgetInput) {
  const krw = budgetKrwFromInput(budgetInput)
  if (krw == null || Number.isNaN(krw)) return DEFAULT_BUDGET_MANWON
  const manwon = Math.round(krw / MANWON / BUDGET_SLIDER.step) * BUDGET_SLIDER.step
  return Math.min(BUDGET_SLIDER.max, Math.max(BUDGET_SLIDER.min, manwon))
}

/** 제목 칸 안내(placeholder): '150만 원 게임 PC 견적 부탁드립니다'. 예산·용도가 없으면 그 부분을 뺀다. */
export function buildTitleHint({ budgetInput = '', purpose = '' } = {}) {
  const krw = budgetKrwFromInput(budgetInput)
  const budget = Number.isSafeInteger(krw) && krw > 0 ? formatBudget(krw) : ''
  return [budget, purposeName(purpose), 'PC 견적 부탁드립니다'].filter(Boolean).join(' ')
}

export function isCommunityBoard(code) {
  return BOARD_CODES.includes(code)
}

/** 게시판 코드(free, build, questions) → 게시판 정보. 모르는 코드는 null. */
export function communityBoard(code) {
  if (code === QUESTION_BOARD.code) return QUESTION_BOARD
  return COMMUNITY_BOARDS.find((board) => board.code === code) || null
}

export function boardName(code) {
  return communityBoard(code)?.name || '커뮤니티'
}

/** 게시판 목록 주소. 모르는 게시판이면 커뮤니티 홈. */
export function boardPath(code) {
  return communityBoard(code)?.path || '/community'
}

/** 글쓰기 주소. 질문 게시판은 /questions/new. 모르는 게시판이면 커뮤니티 홈. */
export function boardNewPath(code) {
  return communityBoard(code)?.newPath || '/community'
}

export function communityPostPath(id) {
  return `/community/posts/${encodeURIComponent(id)}`
}

export function communityEditPath(id) {
  return `/community/posts/${encodeURIComponent(id)}/edit`
}

/** 용도 코드 → 한글 이름. 모르는 코드는 ''(표시하지 않는다). */
export function purposeName(code) {
  return COMMUNITY_PURPOSES.find((purpose) => purpose.code === code)?.name || ''
}

/**
 * 예산 표시: 1500000 → '150만 원', 100000000 → '1억 원', 만 원 단위가 아니면 '1,234,567원'. 값이 없으면 ''.
 * 금액은 서버 값을 그대로 보여 주기만 한다.
 */
export function formatBudget(krw) {
  const value = Number(krw)
  if (krw == null || krw === '' || !Number.isSafeInteger(value) || value < 0) return ''
  if (value % MANWON) return `${value.toLocaleString('ko-KR')}원`
  const eok = Math.floor(value / 100000000)
  const man = Math.floor((value % 100000000) / MANWON)
  const parts = []
  if (eok) parts.push(`${eok.toLocaleString('ko-KR')}억`)
  if (man || !eok) parts.push(`${man.toLocaleString('ko-KR')}만`)
  return `${parts.join(' ')} 원`
}

/** 만 원 단위 입력 → budget_krw. 빈 칸은 null, 숫자가 아니면 NaN. 쉼표·공백은 지우고 소수 넷째 자리(1원)까지 받는다. */
export function budgetKrwFromInput(value) {
  const text = String(value ?? '').replace(/[,\s]/g, '')
  if (!text) return null
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return NaN
  return Math.round(Number(text) * MANWON)
}

/** budget_krw → 만 원 단위 입력값(수정 화면에 채운다). 1500000 → '150'. 값이 없으면 ''. */
export function budgetInputFromKrw(krw) {
  const value = Number(krw)
  if (krw == null || krw === '' || !Number.isFinite(value)) return ''
  return String(value / MANWON)
}

/** 예산 입력 검사. 맞으면 '', 틀리면 다음 행동을 적은 문구. */
export function validateBudgetInput(value) {
  const krw = budgetKrwFromInput(value)
  if (krw == null) return '예산을 만 원 단위로 입력해 주세요.'
  if (Number.isNaN(krw)) return '예산은 숫자로만 입력해 주세요. 예: 150 (150만 원)'
  if (krw < MIN_BUDGET_KRW || krw > MAX_BUDGET_KRW) return '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'
  return ''
}

/** 서버(파이썬)와 같이 코드 포인트로 센 글자 수(앞뒤 공백 제외). */
export function textLength(value) {
  return [...String(value ?? '').trim()].length
}

/**
 * 글 검사(서버 422 전에 막는다). 값은 API 로 보내는 모양(camelCase): { board, title, content, budgetKrw, purpose }.
 * 견적 글은 예산·용도가 필수, 자유 글은 둘 다 없어야 한다.
 */
export function validateCommunityPost({ board = '', title = '', content = '', budgetKrw = null, purpose = null, monitorResolution = null, preferences = [] } = {}) {
  if (!isCommunityBoard(board)) return '게시판을 찾을 수 없습니다. 커뮤니티 홈에서 게시판을 다시 골라 주세요.'
  const titleError = validateTitle(title)
  if (titleError) return titleError
  if (board === 'build') {
    if (!Number.isSafeInteger(budgetKrw) || budgetKrw < MIN_BUDGET_KRW || budgetKrw > MAX_BUDGET_KRW) return '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'
    if (!PURPOSE_CODES.includes(purpose)) return '용도를 골라 주세요.'
    const extraError = validateBuildExtras({ monitorResolution: monitorResolution || null, preferences: preferences || [] })
    if (extraError) return extraError
  } else if (budgetKrw != null || purpose != null || monitorResolution || preferences?.length) {
    return '예산과 용도는 견적 게시판 글에만 적을 수 있습니다.'
  }
  return validateContent(content)
}

/** 모니터 해상도(null 은 고르지 않음)·선호 사항(아는 값, 중복 없이 5개까지) 검사. */
function validateBuildExtras({ monitorResolution, preferences }) {
  if (monitorResolution !== null && monitorResolution !== undefined && !RESOLUTION_CODES.includes(monitorResolution)) return '모니터 해상도를 목록에서 골라 주세요.'
  if (preferences !== undefined) {
    if (!Array.isArray(preferences) || preferences.length > PREFERENCE_CODES.length || new Set(preferences).size !== preferences.length
      || preferences.some((code) => !PREFERENCE_CODES.includes(code))) return '선호 사항을 목록에서 다시 골라 주세요.'
  }
  return ''
}

function validateTitle(title) {
  const length = textLength(title)
  if (!length) return '제목을 입력해 주세요.'
  if (length > MAX_POST_TITLE_LENGTH) return '제목은 200자까지 입력할 수 있습니다.'
  return ''
}

function validateContent(content) {
  const length = textLength(content)
  if (!length) return '내용을 입력해 주세요.'
  if (length > MAX_POST_CONTENT_LENGTH) return '내용은 10,000자까지 입력할 수 있습니다.'
  return ''
}

/**
 * 글쓰기 폼 검사. 폼 값: { board, title, content, budgetInput(만 원), purpose }. 화면 순서대로 첫 오류를 돌려준다
 * (견적 요청: 예산 → 용도 → 제목 → 내용, 자유 글: 제목 → 내용).
 */
export function validatePostDraft({ board = '', title = '', content = '', budgetInput = '', purpose = '' } = {}) {
  if (!isCommunityBoard(board)) return validateCommunityPost({ board })
  if (board === 'build') {
    const budgetError = validateBudgetInput(budgetInput)
    if (budgetError) return budgetError
    if (!PURPOSE_CODES.includes(purpose)) return '용도를 골라 주세요.'
  }
  const titleError = validateTitle(title)
  if (titleError) return titleError
  return validateContent(content)
}

/**
 * 글쓰기 폼 값 → createCommunityPost 인자. 자유 글에는 예산·용도를 넣지 않는다.
 * 견적 글의 모니터 해상도·선호 사항은 고른 때만 넣는다(고르지 않으면 서버 기본값 null·[]).
 */
export function postFromDraft({ board = '', title = '', content = '', budgetInput = '', purpose = '', monitorResolution = '', preferences = [] } = {}) {
  const post = { board, title: title.trim(), content: content.trim() }
  if (board === 'build') {
    post.budgetKrw = budgetKrwFromInput(budgetInput)
    post.purpose = purpose
    if (monitorResolution) post.monitorResolution = monitorResolution
    const prefs = normalizePreferences(preferences)
    if (prefs.length) post.preferences = prefs
  }
  return post
}

/** 서버 글(PostDetail) → 수정 폼 값. */
export function draftFromPost(post) {
  return {
    board: post?.board || '',
    title: post?.title || '',
    content: post?.content || '',
    budgetInput: budgetInputFromKrw(post?.budget_krw),
    purpose: post?.purpose || '',
    monitorResolution: post?.monitor_resolution || '',
    preferences: normalizePreferences(post?.preferences),
  }
}

function samePreferences(left, right) {
  const a = normalizePreferences(left)
  const b = normalizePreferences(right)
  return a.length === b.length && a.every((code, index) => code === b[index])
}

/**
 * 수정(PATCH)에 보낼 바뀐 필드만(camelCase). 아무것도 바뀌지 않았으면 {}(서버는 빈 본문을 422 로 거절한다).
 * 자유 글은 예산·용도·모니터·선호를 보내지 않는다. board 는 바꿀 수 없다.
 * 모니터 해상도는 고른 값이 원래 값과 다를 때만(빈 값으로 되돌리지는 않는다: 화면이 이미 값이 있는 글에는 "선택 안 함"을 주지 않는다),
 * 선호 사항은 순서와 상관없이 목록이 달라졌을 때 목록 전체([] 는 비움).
 */
export function changedPostFields(original, draft) {
  const changes = {}
  const title = String(draft?.title ?? '').trim()
  const content = String(draft?.content ?? '').trim()
  if (title !== (original?.title ?? '')) changes.title = title
  if (content !== (original?.content ?? '')) changes.content = content
  if (original?.board === 'build') {
    const budgetKrw = budgetKrwFromInput(draft?.budgetInput)
    if (budgetKrw !== original.budget_krw) changes.budgetKrw = budgetKrw
    if ((draft?.purpose ?? '') !== (original.purpose ?? '')) changes.purpose = draft.purpose
    const resolution = draft?.monitorResolution || ''
    if (resolution && resolution !== (original.monitor_resolution || '')) changes.monitorResolution = resolution
    if (draft?.preferences !== undefined && !samePreferences(draft.preferences, original.preferences)) changes.preferences = normalizePreferences(draft.preferences)
  }
  return changes
}

/** 수정할 필드 검사(updateCommunityPost 가 쓴다). 빈 수정은 요청하지 않는다. 모니터 해상도·선호 사항만 바뀐 수정도 보낸다. */
export function validatePostChanges(changes = {}) {
  const keys = Object.keys(changes)
  if (!keys.length) return '바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.'
  if ('title' in changes) {
    const error = validateTitle(changes.title)
    if (error) return error
  }
  if ('budgetKrw' in changes && (!Number.isSafeInteger(changes.budgetKrw) || changes.budgetKrw < MIN_BUDGET_KRW || changes.budgetKrw > MAX_BUDGET_KRW)) {
    return '예산은 10만 원부터 1억 원(10,000만 원)까지 입력할 수 있습니다.'
  }
  if ('purpose' in changes && !PURPOSE_CODES.includes(changes.purpose)) return '용도를 골라 주세요.'
  if ('monitorResolution' in changes && !RESOLUTION_CODES.includes(changes.monitorResolution)) return '모니터 해상도를 목록에서 골라 주세요.'
  if ('preferences' in changes) {
    const error = validateBuildExtras({ monitorResolution: null, preferences: changes.preferences })
    if (error) return error
  }
  if ('content' in changes) return validateContent(changes.content)
  return ''
}

/** 댓글 검사: 내용 1~5,000자, 부품 15줄 이하·수량 1~10·같은 상품 두 줄 금지. items 는 [{ product_id, quantity }]. */
export function validateComment({ content = '', items = [] } = {}) {
  const length = textLength(content)
  if (!length) return '댓글 내용을 입력해 주세요.'
  if (length > MAX_COMMENT_LENGTH) return '댓글은 5,000자까지 입력할 수 있습니다.'
  return validatePartItems(items)
}

export function validatePartItems(items = []) {
  if (items.length > MAX_PART_LINES) return '부품은 15줄까지 붙일 수 있습니다.'
  const seen = new Set()
  for (const item of items) {
    if (!Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > MAX_PART_QUANTITY) return '수량은 1개부터 10개까지 고를 수 있습니다.'
    if (seen.has(item.product_id)) return '같은 상품을 두 줄로 넣을 수 없습니다. 줄을 빼고 수량을 바꿔 다시 추가해 주세요.'
    seen.add(item.product_id)
  }
  return ''
}

/** 부품 줄 → 요청 본문의 items([{ product_id, quantity }]). 가격·합계는 보내지 않는다. */
export function partItemsPayload(lines = []) {
  return lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity }))
}

/** 두 부품 목록이 같은지(순서·상품·수량). */
export function samePartItems(left = [], right = []) {
  if (left.length !== right.length) return false
  return left.every((item, index) => item.product_id === right[index].product_id && item.quantity === right[index].quantity)
}

/**
 * 댓글 수정(PATCH)에 보낼 바뀐 필드만. items 는 목록 전체를 바꾼다([] 는 비움). 견적 게시판이 아니면 items 를 보내지 않는다.
 * draft: { content, lines }
 */
export function changedCommentFields(original, draft, board) {
  const changes = {}
  const content = String(draft?.content ?? '').trim()
  if (content !== (original?.content ?? '')) changes.content = content
  if (board === 'build') {
    const items = partItemsPayload(draft?.lines || [])
    if (!samePartItems(partItemsPayload(original?.items || []), items)) changes.items = items
  }
  return changes
}

/** 상품(GET /products 의 ProductSummary) + 수량 → 부품 줄(댓글 items 와 같은 필드 이름). */
export function partLineFromProduct(product, quantity) {
  return {
    product_id: product.id,
    name: product.name || '',
    brand: product.brand || '',
    category: product.category || '',
    thumbnail_url: product.thumbnail_url || '',
    price_krw: Number(product.price_krw) || 0,
    stock: product.stock,
    quantity,
  }
}

/** 서버 댓글의 items → 부품 줄(수정 폼에 채운다). */
export function partLinesFromItems(items = []) {
  return items.map((item) => ({
    product_id: item.product_id,
    name: item.name || '',
    brand: item.brand || '',
    category: item.category || '',
    thumbnail_url: item.thumbnail_url || '',
    price_krw: Number(item.price_krw) || 0,
    stock: item.stock,
    quantity: item.quantity,
  }))
}

/**
 * 부품 줄 추가. { lines, error }: 틀리면 lines 는 그대로이고 error 에 문구.
 * 상품을 안 골랐거나, 수량이 1~10 이 아니거나, 이미 있는 상품이거나, 15줄이 찼으면 추가하지 않는다.
 */
export function addPartLine(lines = [], product = null, quantity = 1) {
  if (lines.length >= MAX_PART_LINES) return { lines, error: '부품은 15줄까지 붙일 수 있습니다. 줄을 빼고 다시 추가해 주세요.' }
  if (!product || product.id == null) return { lines, error: '추가할 상품을 골라 주세요.' }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_PART_QUANTITY) return { lines, error: '수량은 1개부터 10개까지 고를 수 있습니다.' }
  if (lines.some((line) => line.product_id === product.id)) return { lines, error: '이미 목록에 있는 상품입니다. 수량을 바꾸려면 줄을 빼고 다시 추가해 주세요.' }
  return { lines: [...lines, partLineFromProduct(product, quantity)], error: '' }
}

export function removePartLine(lines = [], productId) {
  return lines.filter((line) => line.product_id !== productId)
}

/** 화면 표시용 예상 합계(상품 목록 가격 × 수량). 서버로 보내지 않는다. */
export function estimatedPartsTotal(lines = []) {
  return lines.reduce((sum, line) => sum + (Number(line.price_krw) || 0) * (Number(line.quantity) || 0), 0)
}

// 게시판 날짜는 서버 시각(UTC, 시간대가 없으면 UTC 로 본다)을 한국 시간으로 보여 준다(질문 날짜와 같은 기준)
const SEOUL_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function serverDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (!value || typeof value !== 'string') return null
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function seoulParts(date) {
  return Object.fromEntries(SEOUL_PARTS.formatToParts(date).map((part) => [part.type, part.value]))
}

/** 목록 날짜: 오늘(한국 시간) 쓴 글은 '14:05', 그 전 글은 '2026.10.31'. 값이 없거나 틀리면 ''. now 는 테스트에서 넘긴다. */
export function formatBoardDate(value, now = new Date()) {
  const date = serverDate(value)
  const today = serverDate(now)
  if (!date || !today) return ''
  const day = seoulParts(date)
  const current = seoulParts(today)
  if (day.year === current.year && day.month === current.month && day.day === current.day) return `${day.hour}:${day.minute}`
  return `${day.year}.${day.month}.${day.day}`
}

/** 상세 날짜: '2026.11.01 12:00'(한국 시간). 값이 없거나 틀리면 ''. */
export function formatBoardDateTime(value) {
  const date = serverDate(value)
  if (!date) return ''
  const day = seoulParts(date)
  return `${day.year}.${day.month}.${day.day} ${day.hour}:${day.minute}`
}

/** 쪽 수(언제나 1 이상). */
export function boardPageCount(total, pageSize = COMMUNITY_PAGE_SIZE) {
  const count = Math.ceil((Number(total) || 0) / (Number(pageSize) || COMMUNITY_PAGE_SIZE))
  return Math.max(1, Number.isFinite(count) ? count : 1)
}

/**
 * 목록 번호(최신 글이 가장 큰 번호): 전체 수 − (쪽 − 1) × 쪽 크기 − 순서(0부터).
 * 계산한 값이 1보다 작으면(전체 수가 목록과 맞지 않을 때) ''.
 */
export function boardRowNumber(total, page = 1, pageSize = COMMUNITY_PAGE_SIZE, index = 0) {
  const value = Number(total) - (Number(page) - 1) * Number(pageSize) - Number(index)
  return Number.isSafeInteger(value) && value > 0 ? value : ''
}

function pageRange(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

/**
 * 번호 쪽 이동에 보여 줄 쪽 목록. 쪽이 7개 이하면 모두, 많으면 첫 쪽·끝 쪽·지금 쪽 주변을 보여 주고
 * 사이를 'start-gap'(앞 생략)·'end-gap'(뒤 생략)으로 둔다. 언제나 7칸 이하라 모바일에서도 한 줄에 들어간다.
 * 예: (5, 20) → [1, 'start-gap', 4, 5, 6, 'end-gap', 20]
 */
export function boardPageItems(page, pageCount) {
  const count = Math.max(1, Math.floor(Number(pageCount)) || 1)
  const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), count)
  if (count <= 7) return pageRange(1, count)
  if (current <= 4) return [...pageRange(1, 5), 'end-gap', count]
  if (current >= count - 3) return [1, 'start-gap', ...pageRange(count - 4, count)]
  return [1, 'start-gap', current - 1, current, current + 1, 'end-gap', count]
}

/** 용도 필터 값: 아는 용도 코드만, 그 밖은 ''(전체). */
export function normalizePurposeFilter(value) {
  return PURPOSE_CODES.includes(value) ? value : ''
}

/** 견적 게시판 주소의 용도 필터(/community/build?purpose=gaming). 모르는 값·빈 값은 ''(전체). */
export function readPurposeQuery(search = window.location.search) {
  return normalizePurposeFilter(new URLSearchParams(search || '').get('purpose'))
}

/** 고른 용도를 주소에 남긴다(새로고침·공유). 칩을 누를 때마다 뒤로 가기 기록이 쌓이지 않게 replaceState 를 쓴다. */
export function replacePurposeQuery(purpose, history = window.history) {
  const code = normalizePurposeFilter(purpose)
  history.replaceState({}, '', `/community/build${code ? `?purpose=${code}` : ''}`)
}

/**
 * 게시판 목록 요청(fetchCommunityPosts 인자). 용도(purpose)는 견적 게시판에서 고른 때만 넣는다
 * (서버는 자유 게시판에 purpose 를 보내면 422 로 거절한다).
 */
export function communityListRequest({ board = '', page = 1, search = '', purpose = '' } = {}) {
  const request = { board, page, pageSize: COMMUNITY_PAGE_SIZE, search }
  const code = board === 'build' ? normalizePurposeFilter(purpose) : ''
  if (code) request.purpose = code
  return request
}

/** 견적 게시판 목록의 상태 칸: 받은 견적(quote_count)이 없으면 '견적 대기', 있으면 '견적 N개'. */
export function quoteStatus(quoteCount) {
  const count = Number(quoteCount)
  if (!Number.isSafeInteger(count) || count < 1) return { waiting: true, label: '견적 대기' }
  return { waiting: false, label: `견적 ${count.toLocaleString('ko-KR')}개` }
}

/**
 * 예산 비교 배지. gap = 견적 합계 − 예산(서버의 budget_gap_krw, 또는 화면 표시용 예상 합계 − 예산).
 * 음수면 예산 안(남는 금액), 0 이면 딱 맞음, 양수면 예산 초과. 값이 없으면 null(배지를 그리지 않는다).
 */
export function budgetGapBadge(gap) {
  if (gap == null || gap === '') return null
  const value = Number(gap)
  if (!Number.isFinite(value)) return null
  if (value < 0) return { tone: 'under', label: `예산 안 · ${Math.abs(value).toLocaleString('ko-KR')}원 남음` }
  if (value === 0) return { tone: 'exact', label: '예산에 딱 맞음' }
  return { tone: 'over', label: `예산 초과 · ${value.toLocaleString('ko-KR')}원` }
}

/** 견적을 기다리는 글(quote_count 0) 수. 커뮤니티 홈은 불러온 최신 글 안에서만 센다(전체 수가 아니다). */
export function waitingQuoteCount(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => quoteStatus(item?.quote_count).waiting).length
}

/**
 * 견적 카드의 "예산 사용" 막대. total = 서버의 items_total_krw, budget = 글의 budget_krw.
 * { percent(반올림, 100 을 넘을 수 있다), width(막대 폭 0~100), over(예산 초과), label('135% / 150만 원'), ariaLabel } 또는 null(예산·합계가 없을 때).
 */
export function budgetUsage(totalKrw, budgetKrw) {
  const total = Number(totalKrw)
  const budget = Number(budgetKrw)
  if (totalKrw == null || budgetKrw == null || !Number.isFinite(total) || !Number.isFinite(budget) || total < 0 || budget <= 0) return null
  const ratio = (total / budget) * 100
  const percent = Math.round(ratio)
  return {
    percent,
    width: Math.min(100, Math.max(0, Math.round(ratio * 10) / 10)),
    over: total > budget,
    label: `${percent.toLocaleString('ko-KR')}% / ${formatBudget(budget)}`,
    ariaLabel: `예산 ${formatBudget(budget)} 중 ${percent.toLocaleString('ko-KR')}% 사용${total > budget ? '(예산 초과)' : ''}`,
  }
}

/** 이름의 첫 글자(아바타). 없으면 '회'(회원). */
export function authorInitial(name) {
  const first = [...String(name ?? '').trim()][0]
  return first ? first.toUpperCase() : '회'
}

function currentSearch() {
  return globalThis.window?.location?.search || ''
}

/** 견적 요청 글쓰기 주소의 ?from=cart(장바구니에서 "이 구성으로 견적 요청")인지. */
export function readCartPrefillQuery(search = currentSearch()) {
  return new URLSearchParams(search || '').get('from') === 'cart'
}

/**
 * 장바구니(GET /cart) → 견적 요청 글의 처음 값 { title, content }. 담긴 상품이 없으면 null.
 * 제목 '이 구성 괜찮을까요? (장바구니 N개)'(N = 서버 item_count, 없으면 줄 수), 내용은 상품마다 '- 이름 가격원'(2개 이상이면 ' × N개').
 */
export function cartPrefillDraft(cart) {
  const items = Array.isArray(cart?.items) ? cart.items.filter((item) => item && item.name) : []
  if (!items.length) return null
  const count = Number.isSafeInteger(cart?.item_count) && cart.item_count > 0 ? cart.item_count : items.length
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) > 1 ? ` × ${Number(item.quantity)}개` : ''
    return `- ${item.name} ${(Number(item.price_krw) || 0).toLocaleString('ko-KR')}원${quantity}`
  })
  return { title: `이 구성 괜찮을까요? (장바구니 ${count.toLocaleString('ko-KR')}개)`, content: lines.join('\n') }
}

/**
 * 장바구니 → 견적 보내기의 부품 줄(CommunityPartsPicker 모양). 15줄까지, 수량은 1~10 으로 맞춘다.
 * { lines, skipped(15줄을 넘어 뺀 줄 수), clamped(수량을 10 으로 줄인 줄 수) }
 */
export function partLinesFromCart(cart) {
  const items = Array.isArray(cart?.items) ? cart.items.filter((item) => Number.isSafeInteger(item?.product_id)) : []
  const lines = []
  let clamped = 0
  for (const item of items) {
    if (lines.length >= MAX_PART_LINES || lines.some((line) => line.product_id === item.product_id)) continue
    const quantity = Math.min(MAX_PART_QUANTITY, Math.max(1, Math.floor(Number(item.quantity)) || 1))
    if (quantity < Number(item.quantity)) clamped += 1
    lines.push(partLineFromProduct({ ...item, id: item.product_id }, quantity))
  }
  return { lines, skipped: Math.max(0, items.length - lines.length), clamped }
}

// "핵심 부품 비교"에 쓰는 카테고리(디자인: CPU·그래픽카드·메인보드). 비교함은 같은 카테고리만 담으므로 한 카테고리를 고른다
export const CORE_COMPARE_CATEGORIES = ['cpu', 'gpu', 'mainboard']
export const COMPARE_PAGE_PATH = '/compare'

/**
 * 견적 부품 → 비교함에 넣을 상품. 핵심 카테고리 중 줄 금액 합(line_total_krw)이 가장 큰 카테고리(같으면 CPU → 그래픽카드 → 메인보드)의
 * 상품을 4개까지 { id, name, category, thumbnail_url } 로. 핵심 부품이 없으면 { category: null, products: [] }.
 */
export function quoteCompareProducts(items = []) {
  const groups = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !CORE_COMPARE_CATEGORIES.includes(item.category) || !Number.isSafeInteger(item.product_id) || item.product_id < 1) continue
    const group = groups.get(item.category) || { category: item.category, total: 0, products: [] }
    const lineTotal = Number(item.line_total_krw ?? (Number(item.price_krw) || 0) * (Number(item.quantity) || 1))
    group.total += Number.isFinite(lineTotal) ? lineTotal : 0
    if (!group.products.some((product) => product.id === item.product_id)) {
      group.products.push({ id: item.product_id, name: item.name || '', category: item.category, thumbnail_url: item.thumbnail_url || '' })
    }
    groups.set(item.category, group)
  }
  let best = null
  for (const code of CORE_COMPARE_CATEGORIES) {
    const group = groups.get(code)
    if (group && (!best || group.total > best.total)) best = group
  }
  return best ? { category: best.category, products: best.products.slice(0, 4) } : { category: null, products: [] }
}

/** 견적을 장바구니에 담은 뒤 토스트: '부품 N개를 장바구니에 담았어요'(N = 서버가 담은 줄 수). */
export function buildToastMessage(result) {
  const count = Array.isArray(result?.added) ? result.added.length : 0
  return count ? `부품 ${count.toLocaleString('ko-KR')}개를 장바구니에 담았어요` : '장바구니에 담았어요'
}

export function goToCompare(location = window.location) {
  location.assign(COMPARE_PAGE_PATH)
}

/** 화면 표시용 예상 예산 차이(예상 합계 − 예산). 고른 부품이 없거나 예산이 없으면 null. 서버로 보내지 않는다. */
export function estimatedBudgetGap(lines = [], budgetKrw = null) {
  const budget = Number(budgetKrw)
  if (!lines.length || budgetKrw == null || !Number.isSafeInteger(budget)) return null
  return estimatedPartsTotal(lines) - budget
}

/** 부품 목록이 한 줄 이상인 댓글 = 견적. */
export function isQuote(comment) {
  return Array.isArray(comment?.items) && comment.items.length > 0
}

/** 견적 글의 댓글을 받은 견적(부품 목록이 있음)과 일반 댓글로 나눈다. 순서(오래된 순)는 그대로. */
export function splitBuildComments(comments = []) {
  return { quotes: comments.filter(isQuote), comments: comments.filter((comment) => !isQuote(comment)) }
}

/** 글이 수정됐는지(수정됨 표시). */
export function isEdited(item) {
  return Boolean(item?.updated_at && item?.created_at && item.updated_at !== item.created_at)
}

const FORBIDDEN_MESSAGES = {
  post: '본인이 작성한 글만 수정하거나 삭제할 수 있습니다.',
  comment: '본인이 작성한 댓글만 수정하거나 삭제할 수 있습니다.',
  // 새 글·댓글 작성의 403 은 본인 확인이 아니라 Origin 검사(require_allowed_origin) 실패다
  write: '이 페이지에서 보낸 요청을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.',
}

/**
 * 커뮤니티 요청 실패 문구. subject: 'post'(글 조회·수정·삭제) | 'comment'(댓글 수정·삭제) | 'write'(새 글·댓글 작성).
 * 401 로그인 만료, 403 남의 글·댓글(작성은 요청 확인 실패), 404 서버 문구 + 새로고침 안내,
 * 5xx·네트워크 오류는 fallback, 그 밖(422 등)은 서버 문구(없으면 fallback).
 */
export function communityError(error, fallback, subject = 'post') {
  const status = error?.response?.status
  const message = error?.response?.data?.message
  const serverMessage = typeof message === 'string' && message ? message : ''
  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'
  if (status === 403) return FORBIDDEN_MESSAGES[subject] || FORBIDDEN_MESSAGES.post
  if (status === 404) return `${serverMessage || (subject === 'comment' ? '댓글을 찾을 수 없습니다.' : '글을 찾을 수 없습니다.')} 새로고침한 뒤 다시 확인해 주세요.`
  if (!status || status >= 500) return fallback
  return serverMessage || fallback
}

export function goToCommunityPost(id, location = window.location) {
  location.assign(communityPostPath(id))
}

export function goToCommunityBoard(board, location = window.location) {
  location.assign(boardPath(board))
}
