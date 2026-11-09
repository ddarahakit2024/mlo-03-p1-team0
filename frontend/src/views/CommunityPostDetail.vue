<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import InlineConfirm from '../components/InlineConfirm.vue'
import CommunityShell from '../components/CommunityShell.vue'
import CommunityPartsTable from '../components/CommunityPartsTable.vue'
import CommunityPartsPicker from '../components/CommunityPartsPicker.vue'
import CompatibilityPanel from '../components/CompatibilityPanel.vue'
import { createCommunityComment, deleteCommunityComment, deleteCommunityPost, fetchCommunityPost, updateCommunityComment } from '../api/communityApi.js'
import { addBuildToCart, fetchCart } from '../api/cartApi.js'
import { checkCompatibility } from '../api/compatibilityApi.js'
import { fetchProducts } from '../api/productApi.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import { BUILD_ADD_FAILED_MESSAGE, buildAddEventProps, buildResultMessage, cartError } from '../stores/cartViewModel.js'
import { browserCompareStorage, createCompareBox } from '../stores/compareViewModel.js'
import { COMPATIBILITY_DEBOUNCE_MS, compatibilityEventProps, compatibilityItems, compatibilityKey, shouldCheckCompatibility } from '../stores/compatibilityViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { MAX_PROP_LIST_LENGTH, track } from '../stores/tracking.js'
import { formatPrice } from '../stores/productViewModel.js'
import {
  MAX_COMMENT_LENGTH, PARTS_PRODUCT_PAGE_SIZE, authorInitial, boardName, boardPath, budgetGapBadge, budgetUsage, buildToastMessage, changedCommentFields,
  communityEditPath, communityError, formatBoardDateTime, formatBudget, goToCommunityBoard, goToCompare, isEdited, isQuote, partItemsPayload, partLinesFromCart,
  partLinesFromItems, preferenceLine, purposeName, quoteCompareProducts, quoteStatus, resolutionName, splitBuildComments, textLength, validateComment,
} from '../stores/communityViewModel.js'

// 글 상세(/community/posts/{id}, 디자인 "estimate detail").
// 자유 게시판(일반 게시판 모양): ← 게시판 링크, 제목, 글쓴이·날짜·댓글 수 줄, 본문, 목록·수정·삭제, 댓글 목록과 댓글 쓰기.
// 견적 게시판: 견적 요청 카드(상태 알약, 제목, 글쓴이 · 날짜, 예산·용도·모니터·선호 4칸, 요청 내용)
//   → "받은 견적 N개"(부품 목록이 있는 댓글을 견적 카드로: 아바타·글쓴이·날짜·예산 배지(budget_gap_krw), 견적 합계 + 예산 사용 막대,
//      호환성 한 줄, 부품 줄, 설명, "전체 장바구니에 담기"·"핵심 부품 비교")
//   → "댓글"(부품 목록이 없는 댓글) → "견적 보내기 · 댓글"(부품 고르기 먼저, 설명, "장바구니 구성으로 견적 보내기"는 GET /cart 를 고르기 줄로 넣는다).
// 핵심 부품 비교: 비교함은 같은 카테고리만 담으므로 견적의 CPU·그래픽카드·메인보드 중 금액이 가장 큰 카테고리의 상품(4개까지)으로 비교함을 바꾸고 /compare 로 간다.
// 부품 호환성(POST /compatibility/check): 받은 견적 카드마다 본문을 받은 뒤 한 번 확인해 요약 한 줄(카드마다 로딩·오류·다시 시도),
//   견적 보내기는 고른 부품이 바뀌면 0.4초 모아서 다시 확인한다(늦게 온 이전 응답은 버린다. 같은 구성은 이벤트 한 번). 실패해도 본문은 그대로다.
// 수정·삭제 버튼은 서버가 준 is_owner 로만 보여 주고, 금액·예산 차이(items_total_krw, budget_gap_krw)는 서버 값을 그대로 보여 준다.
// 받은 견적 카드마다 "전체 장바구니에 담기"(POST /cart/builds, spec docs/specs/2026-11-01-build-id-purpose.md): 비로그인은 로그인 안내,
//   담는 중에는 그 카드의 버튼을 막고, 결과(담은 줄 수·뺀 부품)와 실패(다시 시도, 401 은 로그인 안내)는 카드 안에 보여 준다. 남의 견적·내 견적 모두 담을 수 있다.
//   담으면 헤더 장바구니 수(siteStatus.setCartCount)를 맞추고 토스트를 띄운다.
const props = defineProps({ postId: { type: Number, default: null } })
const post = ref(null)
const loading = ref(true)
const error = ref('')
const missing = ref(false)
const confirmingPost = ref(false)
const deletingPost = ref(false)
const actionError = ref('')
const actionNeedsLogin = ref(false)

const profile = ref(null)
const loginChecked = ref(false)
const comments = computed(() => post.value?.comments || [])
const isBuild = computed(() => post.value?.board === 'build')
const groups = computed(() => (isBuild.value ? splitBuildComments(comments.value) : { quotes: [], comments: comments.value }))
const quotes = computed(() => groups.value.quotes)
const plainComments = computed(() => groups.value.comments)
// 등록·수정·삭제 결과 문구. area: 문구를 보여 줄 영역(받은 견적 'quotes' / 댓글 'comments')
const notice = ref({ text: '', area: '' })

const commentContent = ref('')
const commentLines = ref([])
const commentSaving = ref(false)
const commentError = ref('')
const commentNeedsLogin = ref(false)
const submitLabel = computed(() => (isBuild.value && commentLines.value.length ? '견적 보내기' : '댓글 등록'))

const editingId = ref(null)
const editContent = ref('')
const editLines = ref([])
const editSaving = ref(false)
const editError = ref('')
const editNeedsLogin = ref(false)

const confirmingId = ref(null)
const deletingId = ref(null)
const deleteErrorId = ref(null)
const deleteErrorMessage = ref('')

// 부품 고르기의 상품 목록: 카테고리마다 한 번 불러와 작성·수정 폼이 함께 쓴다. { [카테고리]: { status, items, error } }
const catalog = ref({})
const catalogRequests = {}

// 받은 견적 카드의 호환성 요약: { [댓글 id]: { state: 'loading' | 'ready' | 'error', result } }. 카테고리가 1개뿐인 견적은 넣지 않는다(보여 주지 않음)
const quoteCompatibility = ref({})
const quoteCompatibilityRequests = {}
// 견적 보내기의 호환성: state ''(보여 주지 않음) | 'loading' | 'ready' | 'error'
const composeCompatibility = ref({ state: '', result: null })
// 받은 견적 카드의 장바구니 담기: { [댓글 id]: { state: 'saving' | 'done' | 'error', result, message, needsLogin } }
const buildCart = ref({})
// 핵심 부품 비교 실패 문구: { [댓글 id]: 문구 }(비교함을 쓸 수 없는 브라우저)
const compareErrors = ref({})
// "장바구니 구성으로 견적 보내기": state '' | 'loading' | 'done' | 'empty' | 'error'
const cartLoad = ref({ state: '', message: '' })
let composeRequest = 0
let composeTimer = null
const trackedCompositions = new Set()
let postRequest = 0

async function loadPost() {
  const request = ++postRequest
  loading.value = true
  error.value = ''
  missing.value = false
  if (!Number.isSafeInteger(props.postId) || props.postId < 1) {
    error.value = '올바르지 않은 글 주소입니다.'
    missing.value = true
    loading.value = false
    return
  }
  try {
    const data = await fetchCommunityPost(props.postId)
    if (request !== postRequest) return
    post.value = data
    buildCart.value = {}
    trackPost(data)
    checkLogin()
    checkQuotes()
  } catch (failure) {
    if (request !== postRequest) return
    missing.value = failure?.response?.status === 404
    error.value = missing.value ? '글을 찾을 수 없습니다.' : communityError(failure, '게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === postRequest) loading.value = false
  }
}

// 글 상세를 받았을 때. 댓글 수·받은 견적 수(부품 목록이 있는 댓글)는 응답의 comments 에서 센다. 제목·본문·글쓴이는 넣지 않는다
function trackPost(data) {
  const list = Array.isArray(data?.comments) ? data.comments : []
  track('community_post_view', {
    post_id: data?.id ?? props.postId,
    board: data?.board ?? null,
    purpose: data?.purpose ?? null,
    budget_krw: data?.budget_krw ?? null,
    comment_count: list.length,
    quote_count: list.filter(isQuote).length,
  })
}

// 글 삭제에 성공했을 때(이동하기 전). 값은 지운 글의 서버 값
function trackPostSubmit(action, data) {
  track('community_post_submit', { action, post_id: data?.id ?? props.postId, board: data?.board ?? null, purpose: data?.purpose ?? null, budget_krw: data?.budget_krw ?? null })
}

// 댓글·견적 등록·수정·삭제에 성공했을 때. 부품 줄 수·합계·상품 id 는 서버 응답(댓글 객체) 그대로이고 본문은 넣지 않는다
function trackCommentSubmit(action, comment) {
  const items = Array.isArray(comment?.items) ? comment.items : []
  track('community_comment_submit', {
    action,
    post_id: comment?.post_id ?? props.postId,
    comment_id: comment?.id ?? null,
    board: post.value?.board ?? null,
    kind: isQuote(comment) ? 'quote' : 'comment',
    item_count: items.length,
    items_total_krw: comment?.items_total_krw ?? null,
    product_ids: items.slice(0, MAX_PROP_LIST_LENGTH).map((item) => item.product_id),
  })
}

// 댓글 폼을 보여 줄지 정하려고 로그인 여부만 확인한다(레이아웃과 같은 공용 로그인 상태). 비로그인·오류면 로그인 링크를 보여 준다
async function checkLogin() {
  profile.value = memberProfile(await authSession.load())
  loginChecked.value = true
}

async function loadProducts(category) {
  if (!category) return
  const current = catalog.value[category]
  if (current && current.status !== 'error') return
  const request = (catalogRequests[category] || 0) + 1
  catalogRequests[category] = request
  catalog.value = { ...catalog.value, [category]: { status: 'loading', items: [], error: '' } }
  try {
    const data = await fetchProducts({ category, pageSize: PARTS_PRODUCT_PAGE_SIZE })
    if (request !== catalogRequests[category]) return
    catalog.value = { ...catalog.value, [category]: { status: 'ready', items: data?.items || [], error: '' } }
  } catch (failure) {
    if (request !== catalogRequests[category]) return
    catalog.value = { ...catalog.value, [category]: { status: 'error', items: [], error: communityError(failure, '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.') } }
  }
}

function setQuoteCompatibility(commentId, value) {
  const next = { ...quoteCompatibility.value }
  if (value) next[commentId] = value
  else delete next[commentId]
  quoteCompatibility.value = next
}

// 견적 카드 하나를 확인한다(본문을 받은 뒤·견적을 보내거나 고친 뒤·카드의 다시 시도). 남이 보낸 견적을 보는 것이라 이벤트는 남기지 않는다
async function checkQuote(comment) {
  const request = (quoteCompatibilityRequests[comment.id] || 0) + 1
  quoteCompatibilityRequests[comment.id] = request
  if (!isBuild.value || !shouldCheckCompatibility(comment.items)) {
    setQuoteCompatibility(comment.id, null)
    return
  }
  setQuoteCompatibility(comment.id, { state: 'loading', result: null })
  try {
    const result = await checkCompatibility(compatibilityItems(comment.items))
    if (request !== quoteCompatibilityRequests[comment.id]) return
    setQuoteCompatibility(comment.id, { state: 'ready', result })
  } catch {
    if (request === quoteCompatibilityRequests[comment.id]) setQuoteCompatibility(comment.id, { state: 'error', result: null })
  }
}

function checkQuotes() {
  for (const comment of quotes.value) checkQuote(comment)
}

function setBuildCart(commentId, value) {
  const next = { ...buildCart.value }
  if (value) next[commentId] = value
  else delete next[commentId]
  buildCart.value = next
}

function isAddingBuild(comment) {
  return buildCart.value[comment.id]?.state === 'saving'
}

// 받은 견적을 장바구니에 담는다. 그 카드가 담는 중이면 두 번 보내지 않는다. 성공했을 때만 이벤트를 남긴다(값은 서버 응답 그대로)
async function addQuoteToCart(comment) {
  if (isAddingBuild(comment)) return
  setBuildCart(comment.id, { state: 'saving', result: null, message: '', needsLogin: false })
  try {
    const result = await addBuildToCart(comment.id)
    setBuildCart(comment.id, { state: 'done', result, message: '', needsLogin: false })
    siteStatus.setCartCount(result?.cart?.item_count)
    siteStatus.showToast(buildToastMessage(result))
    track('build_add_to_cart', buildAddEventProps(result))
  } catch (failure) {
    const needsLogin = failure?.response?.status === 401
    setBuildCart(comment.id, { state: 'error', result: null, message: cartError(failure, BUILD_ADD_FAILED_MESSAGE), needsLogin })
  }
}

function compareProducts(comment) {
  return quoteCompareProducts(comment?.items).products
}

// 핵심 부품 비교: 비교함(localStorage)을 이 견적의 한 카테고리 상품으로 바꾸고 비교 화면으로 간다(compare_clear → compare_add, source quote)
function compareQuote(comment) {
  const products = compareProducts(comment)
  if (!products.length) return
  const box = createCompareBox({ storage: browserCompareStorage(), track })
  if (!box.available) {
    compareErrors.value = { ...compareErrors.value, [comment.id]: '이 브라우저에서는 비교함을 쓸 수 없습니다. 사생활 보호 모드를 끄거나 다른 브라우저에서 다시 시도해 주세요.' }
    return
  }
  box.clear('user')
  for (const product of products) box.add(product, 'quote')
  siteStatus.setCompareCount(box.state().items.length)
  goToCompare()
}

// 장바구니 구성으로 견적 보내기: 장바구니 상품을 부품 고르기 줄로 넣는다(15줄·수량 10개까지). 보내기는 사용자가 설명을 쓰고 직접 누른다
async function loadCartIntoPicker() {
  if (cartLoad.value.state === 'loading' || commentSaving.value) return
  cartLoad.value = { state: 'loading', message: '' }
  try {
    const cart = await fetchCart()
    siteStatus.setCartCount(cart?.item_count)
    const { lines, skipped, clamped } = partLinesFromCart(cart)
    if (!lines.length) {
      cartLoad.value = { state: 'empty', message: '장바구니가 비어 있어요. 부품을 먼저 담아 주세요.' }
      return
    }
    commentLines.value = lines
    const notes = [skipped ? `15줄을 넘는 ${skipped}개는 뺐어요.` : '', clamped ? '수량은 10개까지만 넣었어요.' : ''].filter(Boolean).join(' ')
    cartLoad.value = { state: 'done', message: `장바구니 부품 ${lines.length}개를 넣었어요. ${notes ? `${notes} ` : ''}설명을 적고 견적을 보내 주세요.` }
  } catch (failure) {
    cartLoad.value = { state: 'error', message: cartError(failure, '장바구니를 불러오지 못했습니다. 다시 시도해 주세요.') }
  }
}

// 견적 보내기: 부품을 넣거나 빼면 0.4초 모아서 확인한다. 카테고리가 1개 이하가 되면 영역을 숨기고 진행 중인 확인은 버린다
function scheduleComposeCheck() {
  clearTimeout(composeTimer)
  composeTimer = null
  composeRequest++
  if (!isBuild.value || !shouldCheckCompatibility(commentLines.value)) {
    composeCompatibility.value = { state: '', result: null }
    return
  }
  composeCompatibility.value = { state: 'loading', result: null }
  composeTimer = setTimeout(checkComposition, COMPATIBILITY_DEBOUNCE_MS)
}

// 지금 고른 부품을 바로 확인한다(모으는 시간이 끝났을 때·오류의 다시 시도)
async function checkComposition() {
  clearTimeout(composeTimer)
  composeTimer = null
  const request = ++composeRequest
  const items = compatibilityItems(commentLines.value)
  if (!isBuild.value || !shouldCheckCompatibility(commentLines.value)) {
    composeCompatibility.value = { state: '', result: null }
    return
  }
  composeCompatibility.value = { state: 'loading', result: null }
  try {
    const result = await checkCompatibility(items)
    if (request !== composeRequest) return
    composeCompatibility.value = { state: 'ready', result }
    const key = compatibilityKey(items)
    if (!trackedCompositions.has(key)) {
      trackedCompositions.add(key)
      track('compatibility_check', compatibilityEventProps('quote_compose', items, result))
    }
  } catch {
    if (request === composeRequest) composeCompatibility.value = { state: 'error', result: null }
  }
}

watch(commentLines, scheduleComposeCheck)

function authorName(item) {
  return item?.author?.name || '회원'
}

// 예산 비교 배지 색(community.css 의 cm-gap--*). 견적 합계 − 예산은 서버 값(budget_gap_krw)
const GAP_CLASSES = { under: 'cm-gap--under', exact: 'cm-gap--exact', over: 'cm-gap--over' }

function gapBadge(comment) {
  return budgetGapBadge(comment?.budget_gap_krw)
}

// 예산 사용 막대(견적 합계 ÷ 글의 예산). 둘 다 서버 값
function usage(comment) {
  return budgetUsage(comment?.items_total_krw, post.value?.budget_krw)
}

// 견적(부품 목록이 있는 댓글)이면 받은 견적 영역에, 아니면 댓글 영역에 문구를 보여 준다
function say(comment, quoteText, commentText) {
  const quote = isBuild.value && isQuote(comment)
  notice.value = { text: quote ? quoteText : commentText, area: quote ? 'quotes' : 'comments' }
}

function clearNotice() {
  notice.value = { text: '', area: '' }
}

function askDeletePost() {
  confirmingPost.value = true
  actionError.value = ''
  actionNeedsLogin.value = false
  confirmingId.value = null
}

// 삭제에 성공하면 게시판 목록으로 이동한다. 이동하는 동안에는 확인 상자를 막아 두 번 보내지 않는다. 실패하면 확인 상자를 그대로 두고 다시 시도할 수 있다
async function removePost() {
  if (deletingPost.value) return
  deletingPost.value = true
  actionError.value = ''
  actionNeedsLogin.value = false
  try {
    await deleteCommunityPost(props.postId)
    trackPostSubmit('delete', post.value)
    goToCommunityBoard(post.value.board)
  } catch (failure) {
    actionNeedsLogin.value = failure?.response?.status === 401
    actionError.value = communityError(failure, '글을 삭제하지 못했습니다. 다시 시도해 주세요.')
    deletingPost.value = false
  }
}

function replaceComments(next) {
  post.value = { ...post.value, comments: next }
}

// 댓글·견적 등록: 저장 중에는 두 번 보내지 않고, 실패하면 입력·고른 부품을 그대로 둔다. 성공하면 목록 끝(가장 최근)에 붙인다
async function submitComment() {
  if (commentSaving.value) return
  commentNeedsLogin.value = false
  clearNotice()
  const items = isBuild.value ? partItemsPayload(commentLines.value) : []
  commentError.value = validateComment({ content: commentContent.value, items })
  if (commentError.value) return
  commentSaving.value = true
  try {
    const created = await createCommunityComment(props.postId, { content: commentContent.value, items })
    replaceComments([...comments.value, created])
    trackCommentSubmit('create', created)
    if (isBuild.value && isQuote(created)) checkQuote(created)
    commentContent.value = ''
    commentLines.value = []
    cartLoad.value = { state: '', message: '' }
    say(created, '견적을 보냈습니다.', '댓글이 등록되었습니다.')
  } catch (failure) {
    commentNeedsLogin.value = failure?.response?.status === 401
    commentError.value = communityError(failure, '댓글을 등록하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.', 'write')
  } finally {
    commentSaving.value = false
  }
}

function startEdit(comment) {
  editingId.value = comment.id
  editContent.value = comment.content
  editLines.value = partLinesFromItems(comment.items || [])
  editError.value = ''
  editNeedsLogin.value = false
  confirmingId.value = null
  clearNotice()
}

function cancelEdit() {
  if (editSaving.value) return
  editingId.value = null
  editContent.value = ''
  editLines.value = []
  editError.value = ''
}

// 수정은 바뀐 필드만 보낸다(부품 목록은 바뀌었으면 목록 전체, 다 빼면 []). 아무것도 바뀌지 않았으면 요청하지 않는다
async function saveEdit(comment) {
  if (editSaving.value) return
  editNeedsLogin.value = false
  const lines = isBuild.value ? editLines.value : []
  editError.value = validateComment({ content: editContent.value, items: partItemsPayload(lines) })
  if (editError.value) return
  const changes = changedCommentFields(comment, { content: editContent.value, lines }, post.value.board)
  if (!Object.keys(changes).length) {
    editError.value = '바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.'
    return
  }
  editSaving.value = true
  try {
    const updated = await updateCommunityComment(comment.id, changes)
    const merged = { ...comment, ...updated }
    replaceComments(comments.value.map((item) => (item.id === comment.id ? merged : item)))
    trackCommentSubmit('update', merged)
    checkQuote(merged)
    if (buildCart.value[comment.id]?.state !== 'saving') setBuildCart(comment.id, null)
    editingId.value = null
    editContent.value = ''
    editLines.value = []
    say(merged, '견적이 수정되었습니다.', '댓글이 수정되었습니다.')
  } catch (failure) {
    editNeedsLogin.value = failure?.response?.status === 401
    editError.value = communityError(failure, '댓글을 수정하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.', 'comment')
  } finally {
    editSaving.value = false
  }
}

// 삭제는 화면 안 확인(InlineConfirm)을 거친다. 확인 중에는 그 댓글의 수정·삭제 버튼 대신 "예/아니요"를 보여 준다
function askDelete(comment) {
  confirmingId.value = comment.id
  confirmingPost.value = false
  editingId.value = null
  deleteErrorId.value = null
  clearNotice()
}

async function removeComment(comment) {
  if (deletingId.value != null) return
  deletingId.value = comment.id
  deleteErrorId.value = null
  try {
    await deleteCommunityComment(comment.id)
    replaceComments(comments.value.filter((item) => item.id !== comment.id))
    trackCommentSubmit('delete', comment)
    quoteCompatibilityRequests[comment.id] = (quoteCompatibilityRequests[comment.id] || 0) + 1
    setQuoteCompatibility(comment.id, null)
    setBuildCart(comment.id, null)
    confirmingId.value = null
    say(comment, '견적이 삭제되었습니다.', '댓글이 삭제되었습니다.')
  } catch (failure) {
    deleteErrorId.value = comment.id
    deleteErrorMessage.value = communityError(failure, '댓글을 삭제하지 못했습니다. 다시 시도해 주세요.', 'comment')
  } finally {
    deletingId.value = null
  }
}

onMounted(loadPost)
onBeforeUnmount(() => clearTimeout(composeTimer))
</script>

<template>
  <SiteLayout active-page="community">
    <CommunityShell :active="post?.board || ''">
      <section class="cm-page">
        <p v-if="loading" class="cm-state" role="status">글을 불러오는 중입니다...</p>
        <div v-else-if="error" class="cm-state" role="alert">
          <h1>{{ error }}</h1>
          <button v-if="!missing" class="cm-button cm-button--secondary" type="button" @click="loadPost">다시 시도</button>
          <a v-else class="cm-text-link" href="/community">게시판 목록 보기</a>
        </div>
        <template v-else-if="post">
          <a class="cm-back" :href="boardPath(post.board)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>{{ boardName(post.board) }}</a>
          <article class="cm-post" :class="{ 'cm-request': isBuild }" aria-labelledby="post-title">
            <header class="cm-post__head">
              <p class="cm-post__kicker"><span class="cm-kicker">{{ boardName(post.board) }}</span><span v-if="isBuild" class="cm-pill" :class="{ 'cm-pill--on': quotes.length > 0 }">{{ quoteStatus(quotes.length).label }}</span></p>
              <h1 id="post-title" class="cm-post__title">{{ post.title }}</h1>
              <p v-if="isBuild" class="cm-post__byline">
                <strong class="cm-post__author">{{ authorName(post) }}</strong>
                <time :datetime="post.created_at">{{ formatBoardDateTime(post.created_at) }}</time>
                <span v-if="isEdited(post)">수정됨</span>
              </p>
              <div v-else class="cm-post__meta">
                <span class="cm-post__author">{{ authorName(post) }}</span>
                <time :datetime="post.created_at">{{ formatBoardDateTime(post.created_at) }}</time>
                <span class="cm-post__count">댓글 {{ comments.length }}</span>
                <span v-if="isEdited(post)">수정됨</span>
              </div>
            </header>
            <template v-if="isBuild">
              <dl class="cm-request__facts">
                <div class="cm-request__fact cm-request__fact--budget"><dt>예산</dt><dd>{{ formatBudget(post.budget_krw) || '-' }}</dd></div>
                <div class="cm-request__fact"><dt>용도</dt><dd>{{ purposeName(post.purpose) || '-' }}</dd></div>
                <div class="cm-request__fact"><dt>모니터</dt><dd>{{ resolutionName(post.monitor_resolution) || '정하지 않음' }}</dd></div>
                <div class="cm-request__fact cm-request__fact--prefs"><dt>선호</dt><dd>{{ preferenceLine(post.preferences) }}</dd></div>
              </dl>
              <h2 class="cm-request__subtitle">요청 내용</h2>
            </template>
            <div class="cm-post__body">{{ post.content }}</div>
            <div class="cm-post__actions">
              <a class="cm-button cm-button--secondary" :href="boardPath(post.board)">목록</a>
              <div v-if="post.is_owner" class="cm-post__owner" :class="{ 'cm-post__owner--confirm': confirmingPost }">
                <InlineConfirm v-if="confirmingPost" class="cm-owner-confirm" message="이 글과 댓글을 모두 삭제할까요? 삭제한 글은 복구할 수 없습니다." :busy="deletingPost" @confirm="removePost" @cancel="confirmingPost = false" />
                <template v-else>
                  <a class="cm-button cm-button--secondary" :href="communityEditPath(post.id)">수정</a>
                  <button class="cm-button cm-button--danger" type="button" @click="askDeletePost">삭제</button>
                </template>
              </div>
            </div>
            <div v-if="actionError" class="cm-error" role="alert">{{ actionError }} <a v-if="actionNeedsLogin" class="cm-text-link" href="/login">다시 로그인</a></div>
          </article>

          <section v-if="isBuild" class="cm-quotes" aria-labelledby="quotes-title">
            <div class="cm-section-head">
              <h2 id="quotes-title" class="cm-section-title">받은 견적 <span>{{ quotes.length }}</span>개</h2>
              <p class="cm-section-help">금액은 지금 MOA Parts 판매가 기준 · 가격이 바뀌면 합계도 바뀌어요</p>
            </div>
            <p v-if="notice.area === 'quotes'" class="cm-notice" role="status">{{ notice.text }}</p>
            <p v-if="!quotes.length" class="cm-empty">아직 받은 견적이 없습니다. 아래 "견적 보내기"에서 첫 견적을 보내 주세요.</p>
            <ol v-else class="cm-quote-list">
              <li v-for="comment in quotes" :key="comment.id" class="cm-quote">
                <div class="cm-quote__head">
                  <span class="cm-avatar" aria-hidden="true">{{ authorInitial(authorName(comment)) }}</span>
                  <div class="cm-comment__head"><strong class="cm-comment__author">{{ authorName(comment) }}</strong><time :datetime="comment.created_at">{{ formatBoardDateTime(comment.created_at) }}</time><span v-if="isEdited(comment)">수정됨</span></div>
                  <span v-if="gapBadge(comment)" class="cm-gap" :class="GAP_CLASSES[gapBadge(comment).tone]">{{ gapBadge(comment).label }}</span>
                </div>
                <form v-if="editingId === comment.id" class="cm-comment-form cm-comment-form--inline cm-quote__edit" :aria-busy="editSaving" @submit.prevent="saveEdit(comment)">
                  <fieldset :disabled="editSaving">
                    <CommunityPartsPicker v-model="editLines" :catalog="catalog" :budget-krw="post.budget_krw" :id-prefix="`comment-edit-${comment.id}-parts`" :disabled="editSaving" @request-products="loadProducts" />
                    <div>
                      <label class="cm-comment-form__label" :for="`comment-edit-${comment.id}`">설명 수정</label>
                      <textarea :id="`comment-edit-${comment.id}`" v-model="editContent" rows="4" :maxlength="MAX_COMMENT_LENGTH" :aria-describedby="`comment-edit-count-${comment.id}`"></textarea>
                    </div>
                  </fieldset>
                  <div v-if="editError" class="cm-error" role="alert">{{ editError }} <a v-if="editNeedsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
                  <div class="cm-comment-form__foot">
                    <p :id="`comment-edit-count-${comment.id}`" class="cm-count">{{ textLength(editContent).toLocaleString('ko-KR') }} / 5,000</p>
                    <div class="cm-comment__actions">
                      <button class="cm-button cm-button--secondary cm-button--compact" type="button" :disabled="editSaving" @click="cancelEdit">취소</button>
                      <button class="cm-button cm-button--compact" type="submit" :disabled="editSaving">{{ editSaving ? '저장 중...' : '수정 완료' }}</button>
                    </div>
                  </div>
                </form>
                <template v-else>
                  <div class="cm-quote__summary">
                    <p class="cm-quote__total"><span>견적 합계</span><strong>{{ formatPrice(comment.items_total_krw || 0) }}</strong></p>
                    <div v-if="usage(comment)" class="cm-usage">
                      <p class="cm-usage__labels"><span>예산 사용</span><span>{{ usage(comment).label }}</span></p>
                      <div class="cm-usage__track" role="img" :aria-label="usage(comment).ariaLabel"><span class="cm-usage__bar" :class="{ 'cm-usage__bar--over': usage(comment).over }" :style="{ width: `${usage(comment).width}%` }"></span></div>
                    </div>
                  </div>
                  <div v-if="quoteCompatibility[comment.id]" class="cm-quote__compat"><CompatibilityPanel :state="quoteCompatibility[comment.id].state" :result="quoteCompatibility[comment.id].result" context="quote_card" @retry="checkQuote(comment)" /></div>
                  <CommunityPartsTable class="cm-quote__parts" :items="comment.items" :total="comment.items_total_krw || 0" :caption="`${authorName(comment)}님의 부품 목록`" :show-note="false" :show-total="false" />
                  <p v-if="comment.content" class="cm-quote__body">{{ comment.content }}</p>
                  <div v-if="profile || loginChecked" class="cm-quote__cart">
                    <div class="cm-quote__buttons">
                      <template v-if="profile">
                        <button v-if="buildCart[comment.id]?.state !== 'error'" class="cm-button" type="button" :disabled="isAddingBuild(comment)" @click="addQuoteToCart(comment)">{{ isAddingBuild(comment) ? '담는 중...' : '전체 장바구니에 담기' }}</button>
                      </template>
                      <p v-else class="cm-quote__cart-guest">로그인하면 장바구니에 담을 수 있습니다. <a class="cm-text-link" href="/login">로그인</a></p>
                      <button v-if="compareProducts(comment).length" class="cm-button cm-button--secondary" type="button" @click="compareQuote(comment)">핵심 부품 비교</button>
                    </div>
                    <p v-if="buildCart[comment.id]?.state === 'done'" class="cm-quote__cart-result" role="status">{{ buildResultMessage(buildCart[comment.id].result) }} <a class="cm-text-link" href="/cart">장바구니 보기</a></p>
                    <div v-else-if="buildCart[comment.id]?.state === 'error'" class="cm-quote__cart-error" role="alert">
                      <p>{{ buildCart[comment.id].message }}</p>
                      <a v-if="buildCart[comment.id].needsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
                      <button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="addQuoteToCart(comment)">다시 시도</button>
                    </div>
                    <div v-if="compareErrors[comment.id]" class="cm-quote__cart-error" role="alert"><p>{{ compareErrors[comment.id] }}</p></div>
                  </div>
                  <div v-if="comment.is_owner" class="cm-quote__owner">
                    <InlineConfirm v-if="confirmingId === comment.id" message="이 견적을 삭제할까요? 삭제한 견적은 되돌릴 수 없습니다." :busy="deletingId === comment.id" @confirm="removeComment(comment)" @cancel="confirmingId = null" />
                    <div v-else class="cm-comment__actions">
                      <button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="startEdit(comment)">수정</button>
                      <button class="cm-button cm-button--danger cm-button--compact" type="button" @click="askDelete(comment)">삭제</button>
                    </div>
                    <div v-if="deleteErrorId === comment.id" class="cm-error" role="alert">{{ deleteErrorMessage }}</div>
                  </div>
                </template>
              </li>
            </ol>
          </section>

          <section class="cm-comments" aria-labelledby="comments-title">
            <h2 id="comments-title" class="cm-section-title">댓글 <span>{{ plainComments.length }}</span></h2>
            <p v-if="notice.area === 'comments'" class="cm-notice" role="status">{{ notice.text }}</p>
            <p v-if="!plainComments.length" class="cm-empty">{{ isBuild ? '아직 댓글이 없습니다. 궁금한 점은 부품 없이 댓글로 남길 수 있어요.' : '아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.' }}</p>
            <ol v-else class="cm-comment-list">
              <li v-for="comment in plainComments" :key="comment.id" class="cm-comment">
                <div class="cm-comment__head"><strong class="cm-comment__author">{{ authorName(comment) }}</strong><time :datetime="comment.created_at">{{ formatBoardDateTime(comment.created_at) }}</time><span v-if="isEdited(comment)">수정됨</span></div>
                <form v-if="editingId === comment.id" class="cm-comment-form cm-comment-form--inline" :aria-busy="editSaving" @submit.prevent="saveEdit(comment)">
                  <fieldset :disabled="editSaving">
                    <CommunityPartsPicker v-if="isBuild" v-model="editLines" :catalog="catalog" :budget-krw="post.budget_krw" :id-prefix="`comment-edit-${comment.id}-parts`" :disabled="editSaving" @request-products="loadProducts" />
                    <div>
                      <label class="sr-only" :for="`comment-edit-${comment.id}`">댓글 수정</label>
                      <textarea :id="`comment-edit-${comment.id}`" v-model="editContent" rows="4" :maxlength="MAX_COMMENT_LENGTH" :aria-describedby="`comment-edit-count-${comment.id}`"></textarea>
                    </div>
                  </fieldset>
                  <div v-if="editError" class="cm-error" role="alert">{{ editError }} <a v-if="editNeedsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
                  <div class="cm-comment-form__foot">
                    <p :id="`comment-edit-count-${comment.id}`" class="cm-count">{{ textLength(editContent).toLocaleString('ko-KR') }} / 5,000</p>
                    <div class="cm-comment__actions">
                      <button class="cm-button cm-button--secondary cm-button--compact" type="button" :disabled="editSaving" @click="cancelEdit">취소</button>
                      <button class="cm-button cm-button--compact" type="submit" :disabled="editSaving">{{ editSaving ? '저장 중...' : '수정 완료' }}</button>
                    </div>
                  </div>
                </form>
                <template v-else>
                  <div class="cm-comment__body">{{ comment.content }}</div>
                  <template v-if="comment.is_owner">
                    <InlineConfirm v-if="confirmingId === comment.id" message="이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없습니다." :busy="deletingId === comment.id" @confirm="removeComment(comment)" @cancel="confirmingId = null" />
                    <div v-else class="cm-comment__actions">
                      <button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="startEdit(comment)">수정</button>
                      <button class="cm-button cm-button--danger cm-button--compact" type="button" @click="askDelete(comment)">삭제</button>
                    </div>
                  </template>
                  <div v-if="deleteErrorId === comment.id" class="cm-error" role="alert">{{ deleteErrorMessage }}</div>
                </template>
              </li>
            </ol>
          </section>

          <section class="cm-send" :class="{ 'cm-send--plain': !isBuild }" aria-labelledby="send-title">
            <h2 id="send-title" :class="isBuild ? 'cm-section-title' : 'sr-only'">{{ isBuild ? '견적 보내기 · 댓글' : '댓글 쓰기' }}</h2>
            <p v-if="isBuild" class="cm-section-help">MOA 판매 부품으로 구성을 골라 보내 주세요. 부품 없이 등록하면 댓글로 남아요.</p>
            <form v-if="profile" class="cm-comment-form" :aria-busy="commentSaving" @submit.prevent="submitComment">
              <fieldset :disabled="commentSaving">
                <CommunityPartsPicker v-if="isBuild" v-model="commentLines" :catalog="catalog" :budget-krw="post.budget_krw" id-prefix="comment-new-parts" :disabled="commentSaving" @request-products="loadProducts" />
                <CompatibilityPanel v-if="isBuild && composeCompatibility.state" :state="composeCompatibility.state" :result="composeCompatibility.result" context="quote_compose" @retry="checkComposition" />
                <div>
                  <label class="cm-comment-form__label" for="comment-content">{{ isBuild ? '설명' : '댓글 남기기' }} <span>최대 5,000자</span></label>
                  <textarea id="comment-content" v-model="commentContent" rows="4" :maxlength="MAX_COMMENT_LENGTH" :placeholder="isBuild ? '이 조합을 고른 이유, 조립할 때 주의할 점, 예산에 맞추려면 바꿀 부품을 알려 주세요.' : '의견을 남겨 주세요.'" aria-describedby="comment-content-count"></textarea>
                </div>
              </fieldset>
              <div v-if="commentError" class="cm-error" role="alert">{{ commentError }} <a v-if="commentNeedsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
              <p v-if="cartLoad.state === 'error'" class="cm-error" role="alert">{{ cartLoad.message }}</p>
              <p v-else-if="cartLoad.message" class="cm-help" role="status">{{ cartLoad.message }}</p>
              <div class="cm-comment-form__foot">
                <p id="comment-content-count" class="cm-count">{{ textLength(commentContent).toLocaleString('ko-KR') }} / 5,000</p>
                <div class="cm-comment-form__buttons">
                  <button v-if="isBuild" class="cm-button cm-button--secondary" type="button" :disabled="commentSaving || cartLoad.state === 'loading'" @click="loadCartIntoPicker">{{ cartLoad.state === 'loading' ? '장바구니를 불러오는 중...' : '장바구니 구성으로 견적 보내기' }}</button>
                  <button class="cm-button" type="submit" :disabled="commentSaving">{{ commentSaving ? '저장 중...' : submitLabel }}</button>
                </div>
              </div>
            </form>
            <div v-else-if="loginChecked" class="cm-login-box"><p>로그인한 후 글을 쓸 수 있습니다.</p><a class="cm-button cm-button--secondary" href="/login">로그인</a></div>
          </section>
        </template>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
