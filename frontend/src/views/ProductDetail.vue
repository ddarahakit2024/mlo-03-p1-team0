<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { deleteAlert, fetchAlerts, saveAlert, validateTargetPrice } from '../api/alertApi.js'
import { addCartItem } from '../api/cartApi.js'
import { fetchPriceHistory, fetchProduct, fetchProductRecommendations, requestPriceMatch } from '../api/productApi.js'
import { fetchQuestions } from '../api/questionApi.js'
import { createReview, deleteReview, fetchProductReviews, updateReview } from '../api/reviewApi.js'
import { InlineConfirm, ProductCompareBar, ProductPriceChart, ProductPriceSummary, ProductPurchaseCard, ProductRating, ProductRecommendations, ProductSummary, SiteLayout } from '../components/index.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import { LOGIN_REQUIRED_MESSAGE, cartError, goToCheckout } from '../stores/cartViewModel.js'
import { browserCompareStorage, createCompareBox } from '../stores/compareViewModel.js'
import { createDwellTracker } from '../stores/dwellTracker.js'
import { createImpressionTracker } from '../stores/impressionTracker.js'
import { DEFAULT_PRICE_PERIOD, PRICE_PERIODS, currentTime, dailyStorePrices, formatPriceDate, priceHistoryRows, pricePeriod } from '../stores/priceHistoryViewModel.js'
import { ALERT_LOGIN_MESSAGE, PRICE_MATCH_LOGIN_MESSAGE, RELATED_QUESTION_LIMIT, alertButtonLabel, alertPresets, alertSavedMessage, askQuestionPath, categoryPath, detailRequestError, findAlert, formatStoreUpdatedAt, parseTargetPrice, relatedQuestionRows, storeComparison } from '../stores/productDetailViewModel.js'
import { priceBadge } from '../stores/priceTrendViewModel.js'
import { PRODUCT_PLACEHOLDER, VALUE_SCORE_HELP, categoryName, formatPrice, formatReleaseDate, formatScore, formatValueScore, getProductImage, getProductPageState, getSectionState, lowestPriceInfo, maxOrderQuantity, productError, ratingSummary } from '../stores/productViewModel.js'
import { RECOMMENDATION_LIMIT, recommendationListContext } from '../stores/recommendationViewModel.js'
import { MAX_REVIEW_LENGTH, REVIEW_PAGE_SIZE, REVIEW_RATINGS, formatRatingAverage, formatReviewDate, getReviewWriteState, isEdited, ratingDistribution, ratingStars, reviewChanges, reviewError, reviewLength, validateReview, validateReviewChanges } from '../stores/reviewViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { onExit, track } from '../stores/tracking.js'

const props = defineProps({ productId: { type: Number, default: null } })
const product = ref(null)
const loading = ref(true)
const missing = ref(false)
const error = ref('')
const quantity = ref(1)
const adding = ref(false)
const cartMessage = ref('')
const cartFailed = ref(false)
const needsLogin = ref(false)
const imageBroken = ref(false)
const invalidId = computed(() => !Number.isSafeInteger(props.productId) || props.productId < 1)
const pageState = computed(() => getProductPageState({ loading: loading.value, error: error.value, missing: missing.value, product: product.value, detail: true }))
const image = computed(() => (imageBroken.value ? PRODUCT_PLACEHOLDER : getProductImage(product.value)))
const badge = computed(() => priceBadge(product.value))
const lowest = computed(() => lowestPriceInfo(product.value))
const hasRating = computed(() => Boolean(ratingSummary(product.value?.rating_average, product.value?.review_count)))
const stores = computed(() => storeComparison(product.value))

// 로그인 상태(authSession: 페이지에서 한 번). 리뷰 작성·목표가 알림·최저가 매칭이 함께 쓴다
const profile = ref(null)
const authStatus = ref('loading')
const loginChecked = ref(false)

// 가격 추이 영역: 상품 본문과 따로 불러오고, 실패해도 이 영역만 오류·다시 시도를 보여 준다. 기간을 바꾸면 그 기간으로 다시 부른다(늦게 온 이전 응답은 버린다)
const period = ref(DEFAULT_PRICE_PERIOD)
const history = ref(null)
const historyLoading = ref(false)
const historyError = ref('')
const currentPeriod = computed(() => pricePeriod(period.value))
const historyPoints = computed(() => (history.value ? dailyStorePrices(history.value, {
  days: currentPeriod.value.days,
  price: product.value?.price_krw,
  sparkline: product.value?.price_trend?.sparkline_30d,
  releasedOn: product.value?.released_on,
  now: currentTime(),
}) : []))
const historyState = computed(() => getSectionState({ loading: historyLoading.value, error: historyError.value, empty: !historyPoints.value.length }))
const historyRows = computed(() => priceHistoryRows(history.value?.items))
let historyRequestId = 0

// 목표가 알림: 회원만 GET /alerts 로 이 상품의 알림을 찾는다. 비회원이 열면 요청 없이 로그인 안내
const alert = ref(null)
const alertsLoading = ref(false)
const alertsError = ref('')
const alertOpen = ref(false)
const alertInput = ref('')
const alertSaving = ref(false)
const alertDeleting = ref(false)
const alertError = ref('')
const alertNeedsLogin = ref(false)
// 저장·해제로 패널이 닫히면 초점을 목표가 알림 버튼으로 돌려준다
const alertToggle = ref(null)
const presets = computed(() => alertPresets(product.value))
const alertPanelState = computed(() => {
  if (authStatus.value === 'guest') return 'guest'
  if (authStatus.value === 'loading' || alertsLoading.value) return 'loading'
  if (authStatus.value === 'error' || alertsError.value) return 'error'
  return 'ready'
})
const alertLoadMessage = computed(() => alertsError.value || '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
let alertsRequestId = 0

// 최저가 매칭 요청(다른 판매처가 더 쌀 때)
const matchSending = ref(false)
const matchDone = ref(false)
const matchError = ref('')
const matchNeedsLogin = ref(false)

// 이 부품에 대한 질문(GET /questions?product_id=): 본문을 받은 뒤 부르는 보조 영역. 질문이 없으면 영역을 숨긴다
const questions = ref(null)
const questionsLoading = ref(false)
const questionsError = ref('')
const questionsState = computed(() => getSectionState({ loading: questionsLoading.value, error: questionsError.value, empty: !questions.value?.items?.length }))
const questionRows = computed(() => relatedQuestionRows(questions.value))
let questionsRequestId = 0

// 함께 보는 부품(추천, spec docs/specs/2026-11-03-product-recommendations.md): 상품 본문을 받은 뒤 부르는 보조 영역이라 실패해도 본문은 그대로 보인다.
// 카드 노출·클릭은 목록과 같은 추적기(list 'recommendation')로 재고, 추천을 받을 때마다 새 list_view_id 와 보고 있는 상품·모델 버전을 싣는다
const recommendations = ref(null)
const recommendationsLoading = ref(false)
const recommendationsError = ref('')
const recommendationsState = computed(() => getSectionState({ loading: recommendationsLoading.value, error: recommendationsError.value, empty: !recommendations.value?.items?.length }))
const recommendationItems = computed(() => (Array.isArray(recommendations.value?.items) ? recommendations.value.items : []))
// 추적기는 추천을 처음 받았을 때 만든다(없는 상품·실패면 떠날 때 할 일(onExit)을 등록하지 않는다). 카드는 추천을 받은 뒤에만 그려진다
let recommendationTracker = null
let recommendationsRequestId = 0

// 리뷰 영역: 목록·평균·별점 분포·작성 가능 여부(can_review)·내 리뷰(my_review)는 서버 값
const reviews = ref(null)
const reviewsLoading = ref(false)
const reviewsError = ref('')
const reviewPage = ref(1)
const reviewsState = computed(() => getSectionState({ loading: reviewsLoading.value, error: reviewsError.value, empty: !reviews.value }))
const reviewPageCount = computed(() => Math.max(1, Math.ceil((reviews.value?.total || 0) / (reviews.value?.page_size || REVIEW_PAGE_SIZE))))
const writeState = computed(() => getReviewWriteState({ loggedIn: Boolean(profile.value), page: reviews.value }))
const myReview = computed(() => reviews.value?.my_review || null)
const distribution = computed(() => ratingDistribution(reviews.value?.rating_counts, reviews.value?.total))
const reviewRating = ref(0)
const reviewContent = ref('')
const reviewEditing = ref(false)
const reviewSaving = ref(false)
const reviewFormError = ref('')
const reviewNeedsLogin = ref(false)
const reviewNotice = ref('')
const confirmingDelete = ref(false)
const reviewDeleting = ref(false)
const reviewDeleteError = ref('')
const showReviewForm = computed(() => writeState.value === 'form' || (writeState.value === 'mine' && reviewEditing.value))
let reviewsRequestId = 0

// 비교함(localStorage). 쓸 수 없는 브라우저면 비교 버튼과 막대를 숨긴다. 바뀌면 헤더의 비교함 개수도 맞춘다
const compareState = ref(null)
const compareNotice = ref(null)
const compareBox = createCompareBox({
  storage: browserCompareStorage(),
  track,
  onChange: ({ state, notice }) => {
    compareState.value = state
    compareNotice.value = notice
    siteStatus.setCompareCount(state.items.length)
  },
})
compareState.value = compareBox.state()
const inCompare = computed(() => Boolean(product.value) && compareState.value.items.some((item) => item.id === product.value.id))
// 체류 시간(product_dwell): 상품을 받은 뒤 한 번 시작한다. 탭이 숨겨질 때·떠날 때 구간을 보낸다(추적기의 onExit)
let dwell = null

async function loadProduct() {
  if (invalidId.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  missing.value = false
  try {
    product.value = await fetchProduct(props.productId)
    trackProduct(product.value)
    if (!dwell) dwell = createDwellTracker({ productId: product.value.id, track, onExit })
    imageBroken.value = false
    quantity.value = Math.max(1, Math.min(quantity.value, maxOrderQuantity(product.value.stock)))
    // 상품이 있을 때만 영역들을 부른다(없는 상품이면 추천·가격 이력·질문·리뷰도 404 다)
    loadPriceHistory()
    loadQuestions()
    loadRecommendations()
    loadReviews(1)
    checkLogin()
  } catch (failure) {
    missing.value = failure?.response?.status === 404
    if (!missing.value) error.value = productError(failure, '상품 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    loading.value = false
  }
}

// 상품 상세를 받았을 때. 값은 서버 응답 그대로(이름·설명 같은 글은 넣지 않는다)
function trackProduct(item) {
  track('product_view', {
    product_id: item.id, category: item.category, brand: item.brand, price_krw: item.price_krw, stock: item.stock, is_new: item.is_new,
    performance_score: item.performance_score, value_score: item.value_score, rating_average: item.rating_average, review_count: item.review_count,
  })
}

/** 지금 기간의 가격 이력을 부른다. 기간을 빨리 바꿔도 마지막으로 고른 기간의 응답만 보여 주고, 받았을 때만 price_history_view 를 남긴다. */
async function loadPriceHistory() {
  const request = ++historyRequestId
  historyLoading.value = true
  historyError.value = ''
  try {
    const data = await fetchPriceHistory(props.productId, { days: currentPeriod.value.days })
    if (request !== historyRequestId) return
    history.value = data
    track('price_history_view', {
      product_id: props.productId, points: data?.items?.length ?? 0,
      lowest_price_krw: data?.lowest_price_krw ?? null, highest_price_krw: data?.highest_price_krw ?? null,
    })
  } catch (failure) {
    if (request === historyRequestId) historyError.value = productError(failure, '가격 이력을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === historyRequestId) historyLoading.value = false
  }
}

function selectPeriod(code) {
  if (code === period.value) return
  period.value = code
  loadPriceHistory()
}

/** 이 부품과 연결된 질문 5개. 늦게 온 이전 응답은 버린다. */
async function loadQuestions() {
  const request = ++questionsRequestId
  questionsLoading.value = true
  questionsError.value = ''
  try {
    const data = await fetchQuestions({ productId: props.productId, pageSize: RELATED_QUESTION_LIMIT })
    if (request === questionsRequestId) questions.value = data
  } catch (failure) {
    if (request === questionsRequestId) questionsError.value = productError(failure, '이 부품에 대한 질문을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === questionsRequestId) questionsLoading.value = false
  }
}

/** 추천 상품(6개)을 부른다. 늦게 온 이전 응답은 버리고, 받으면 추적기를 새 목록 결과로 시작한다(실패는 새 list_view_id 를 만들지 않는다). */
async function loadRecommendations() {
  const request = ++recommendationsRequestId
  recommendationsLoading.value = true
  recommendationsError.value = ''
  try {
    const data = await fetchProductRecommendations(props.productId, { limit: RECOMMENDATION_LIMIT })
    if (request !== recommendationsRequestId) return
    recommendations.value = data
    if (!recommendationTracker) recommendationTracker = createImpressionTracker({ list: 'recommendation', track, onExit, pageSize: RECOMMENDATION_LIMIT })
    recommendationTracker.start(recommendationListContext(data, props.productId))
  } catch (failure) {
    if (request === recommendationsRequestId) recommendationsError.value = productError(failure, '추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === recommendationsRequestId) recommendationsLoading.value = false
  }
}

// 추천 카드 노출 측정(카드 li)·클릭(이동 직전). 추적기는 추천을 받은 뒤에 있다
function observeRecommendation(element, item, index) {
  recommendationTracker?.observe(element, item, index)
}

function selectRecommendation(item, index) {
  recommendationTracker?.click(item, index)
}

/** 리뷰 목록을 부른다. quiet 면(저장 뒤 새로 고침) 지금 내용을 그대로 둔 채 바꾼다. 늦게 온 이전 응답은 버린다. */
async function loadReviews(targetPage = reviewPage.value, { quiet = false } = {}) {
  const request = ++reviewsRequestId
  if (!quiet) reviewsLoading.value = true
  reviewsError.value = ''
  try {
    const data = await fetchProductReviews(props.productId, { page: targetPage, pageSize: REVIEW_PAGE_SIZE })
    if (request !== reviewsRequestId) return
    reviews.value = data
    reviewPage.value = data?.page || targetPage
    track('review_list_view', { product_id: props.productId, page: reviewPage.value, total: data?.total ?? 0, rating_average: data?.rating_average ?? null })
  } catch (failure) {
    if (request === reviewsRequestId) reviewsError.value = productError(failure, '리뷰를 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === reviewsRequestId) reviewsLoading.value = false
  }
}

// 레이아웃과 같은 로그인 상태를 쓴다(GET /user/me 는 페이지에서 한 번). 회원이면 목표가 알림을 부른다
async function checkLogin({ refresh = false } = {}) {
  const state = await (refresh ? authSession.refresh() : authSession.load())
  profile.value = memberProfile(state)
  authStatus.value = state?.status || 'error'
  loginChecked.value = true
  if (authStatus.value === 'member') loadAlerts()
}

/** 내 목표가 알림 중 이 상품의 것. 401(그사이 로그아웃)은 로그인 안내로 바꾼다. */
async function loadAlerts() {
  const request = ++alertsRequestId
  alertsLoading.value = true
  alertsError.value = ''
  try {
    const data = await fetchAlerts()
    if (request === alertsRequestId) alert.value = findAlert(data?.items, props.productId)
  } catch (failure) {
    if (request !== alertsRequestId) return
    if (failure?.response?.status === 401) authStatus.value = 'guest'
    else alertsError.value = productError(failure, '목표가 알림을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === alertsRequestId) alertsLoading.value = false
  }
}

function retryAlerts() {
  if (authStatus.value === 'error') checkLogin({ refresh: true })
  else loadAlerts()
}

function toggleAlertPanel() {
  alertOpen.value = !alertOpen.value
  if (!alertOpen.value) return
  alertInput.value = alert.value ? String(alert.value.target_price_krw) : ''
  alertError.value = ''
}

function choosePreset(value) {
  alertInput.value = String(value)
  alertError.value = ''
}

// 저장: 입력 검사(1원~1억 원)에 걸리면 보내지 않는다. 저장 중에는 잠그고 두 번 보내지 않으며, 실패해도 입력을 그대로 둔다
async function submitAlert() {
  if (alertSaving.value || alertDeleting.value) return
  const target = parseTargetPrice(alertInput.value)
  alertNeedsLogin.value = false
  alertError.value = validateTargetPrice(target)
  if (alertError.value) return
  alertSaving.value = true
  try {
    const saved = await saveAlert(props.productId, { targetPriceKrw: target })
    alert.value = saved || { product_id: props.productId, target_price_krw: target }
    closeAlertPanel()
    siteStatus.showToast(alertSavedMessage(alert.value.target_price_krw))
  } catch (failure) {
    const result = detailRequestError(failure, '목표가 알림을 저장하지 못했습니다. 입력한 가격은 그대로 있습니다. 다시 시도해 주세요.')
    alertNeedsLogin.value = result.needsLogin
    alertError.value = result.message
  } finally {
    alertSaving.value = false
  }
}

// 해제: 이미 없으면(404) 해제된 것으로 본다
async function removeAlert() {
  if (alertDeleting.value || alertSaving.value || !alert.value) return
  alertDeleting.value = true
  alertError.value = ''
  alertNeedsLogin.value = false
  try {
    await deleteAlert(props.productId)
    finishRemove()
  } catch (failure) {
    if (failure?.response?.status === 404) finishRemove()
    else {
      const result = detailRequestError(failure, '목표가 알림을 해제하지 못했습니다. 다시 시도해 주세요.')
      alertNeedsLogin.value = result.needsLogin
      alertError.value = result.message
    }
  } finally {
    alertDeleting.value = false
  }
}

function closeAlertPanel() {
  alertOpen.value = false
  nextTick(() => alertToggle.value?.focus?.())
}

function finishRemove() {
  alert.value = null
  alertInput.value = ''
  closeAlertPanel()
  siteStatus.showToast('목표가 알림을 해제했어요')
}

// 최저가 매칭: 비회원은 요청하지 않고 로그인 안내. 보내는 중에는 버튼을 막고, 성공하면 토스트와 "요청했어요"
async function askPriceMatch() {
  if (matchSending.value || matchDone.value) return
  matchError.value = ''
  matchNeedsLogin.value = false
  if (authStatus.value === 'guest') {
    matchNeedsLogin.value = true
    return
  }
  matchSending.value = true
  try {
    await requestPriceMatch(props.productId)
    matchDone.value = true
    siteStatus.showToast('최저가 매칭을 요청했어요. 확인 후 알려드릴게요')
  } catch (failure) {
    const result = detailRequestError(failure, '최저가 매칭을 요청하지 못했습니다. 다시 시도해 주세요.')
    matchNeedsLogin.value = result.needsLogin
    if (!result.needsLogin) matchError.value = result.message
  } finally {
    matchSending.value = false
  }
}

// 리뷰를 바꾸면 상품의 평점 요약(rating_average, review_count)도 다시 부른다. 실패하면 예전 요약을 그대로 둔다
async function refreshRating() {
  try {
    const latest = await fetchProduct(props.productId)
    product.value = { ...product.value, rating_average: latest.rating_average, review_count: latest.review_count }
  } catch {
    // 평점 요약만 예전 값으로 남는다. 상품 본문은 그대로 보인다
  }
}

function toggleCompare() {
  if (!product.value) return
  const result = compareBox.toggle(product.value, 'detail')
  if (result === 'added') siteStatus.showToast('비교에 추가했어요')
  else if (result === 'removed') siteStatus.showToast('비교에서 제거했어요')
}

function selectQuantity(value) {
  quantity.value = value
}

async function addToCart() {
  if (adding.value || !product.value) return
  adding.value = true
  cartMessage.value = ''
  cartFailed.value = false
  needsLogin.value = false
  try {
    const added = { productId: product.value.id, quantity: quantity.value, price: product.value.price_krw }
    const cart = await addCartItem({ productId: added.productId, quantity: added.quantity })
    cartMessage.value = '장바구니에 담았습니다.'
    if (cart && cart.item_count != null) siteStatus.setCartCount(cart.item_count)
    siteStatus.showToast('장바구니에 담았어요')
    // 가격은 담기 응답(장바구니)의 그 상품 가격, 없으면 상품 상세의 서버 가격. 수량은 이번에 담은 개수
    const line = cart?.items?.find((item) => item.product_id === added.productId)
    track('add_to_cart', { product_id: added.productId, quantity: added.quantity, price_krw: line?.price_krw ?? added.price })
  } catch (failure) {
    cartFailed.value = true
    needsLogin.value = failure?.response?.status === 401
    // 409(재고 부족·10개 초과)는 서버 message 를 그대로 보여 준다
    cartMessage.value = needsLogin.value ? LOGIN_REQUIRED_MESSAGE : cartError(failure, '장바구니에 담지 못했습니다. 다시 시도해 주세요.')
  } finally {
    adding.value = false
  }
}

// 바로 구매는 주문서로 이동만 한다. 주문 생성·결제는 주문서 화면이 맡는다
function buyNow() {
  if (!product.value || adding.value) return
  track('buy_now', { product_id: product.value.id, quantity: quantity.value, price_krw: product.value.price_krw })
  goToCheckout({ productId: product.value.id, quantity: quantity.value })
}

function resetReviewForm() {
  reviewRating.value = 0
  reviewContent.value = ''
  reviewEditing.value = false
  reviewFormError.value = ''
  reviewNeedsLogin.value = false
}

function startEdit() {
  if (!myReview.value) return
  reviewRating.value = myReview.value.rating
  reviewContent.value = myReview.value.content
  reviewEditing.value = true
  reviewFormError.value = ''
  reviewNotice.value = ''
  confirmingDelete.value = false
}

function cancelEdit() {
  if (!reviewSaving.value) resetReviewForm()
}

function askDelete() {
  reviewDeleteError.value = ''
  reviewNotice.value = ''
  confirmingDelete.value = true
}

// 등록·수정: 저장 중에는 두 번 보내지 않고, 실패하면 입력을 그대로 둔다. 성공하면 리뷰 영역과 평점 요약을 다시 부른다
// 수정은 바뀐 필드만 보낸다(서버는 빈 본문·null 을 422 로 거절한다)
async function submitReview() {
  if (reviewSaving.value) return
  const editing = reviewEditing.value && Boolean(myReview.value)
  const values = { rating: reviewRating.value, content: reviewContent.value }
  const changes = editing ? reviewChanges(myReview.value, values) : null
  reviewNeedsLogin.value = false
  reviewFormError.value = validateReview(values) || (editing ? validateReviewChanges(changes) : '')
  if (reviewFormError.value) return
  reviewSaving.value = true
  reviewNotice.value = ''
  try {
    const saved = editing ? await updateReview(props.productId, myReview.value.id, changes) : await createReview(props.productId, values)
    track('review_submit', { product_id: props.productId, action: editing ? 'update' : 'create', rating: saved?.rating ?? values.rating })
    resetReviewForm()
    reviewNotice.value = editing ? '리뷰가 수정되었습니다.' : '리뷰가 등록되었습니다.'
    await Promise.all([loadReviews(editing ? reviewPage.value : 1, { quiet: true }), refreshRating()])
  } catch (failure) {
    reviewNeedsLogin.value = failure?.response?.status === 401
    reviewFormError.value = reviewError(failure, editing
      ? '리뷰를 수정하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.'
      : '리뷰를 등록하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.')
  } finally {
    reviewSaving.value = false
  }
}

async function removeReview() {
  if (reviewDeleting.value || !myReview.value) return
  const removed = myReview.value
  reviewDeleting.value = true
  reviewDeleteError.value = ''
  reviewNeedsLogin.value = false
  try {
    await deleteReview(props.productId, removed.id)
    track('review_submit', { product_id: props.productId, action: 'delete', rating: removed.rating })
    confirmingDelete.value = false
    reviewNotice.value = '리뷰가 삭제되었습니다.'
    await Promise.all([loadReviews(1, { quiet: true }), refreshRating()])
  } catch (failure) {
    reviewNeedsLogin.value = failure?.response?.status === 401
    reviewDeleteError.value = reviewError(failure, '리뷰를 삭제하지 못했습니다. 다시 시도해 주세요.')
  } finally {
    reviewDeleting.value = false
  }
}

onMounted(loadProduct)
onBeforeUnmount(() => {
  dwell?.stop()
  recommendationTracker?.stop()
})
</script>

<template>
  <SiteLayout active-page="products">
    <div class="shop-page">
      <section v-if="invalidId" class="shop-state" role="alert">
        <h1>올바르지 않은 상품 주소입니다.</h1><p>상품 목록에서 다른 상품을 선택해 주세요.</p><a class="shop-button" href="/products">상품 목록 보기</a>
      </section>
      <p v-else-if="pageState === 'loading'" class="shop-state" role="status">상품 정보를 불러오는 중입니다...</p>
      <section v-else-if="pageState === 'missing'" class="shop-state" role="alert">
        <h1>상품을 찾을 수 없습니다.</h1><p>판매가 끝났거나 주소가 바뀌었을 수 있습니다. 상품 목록에서 다시 찾아 주세요.</p><a class="shop-button" href="/products">상품 목록 보기</a>
      </section>
      <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
        <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadProduct">다시 시도</button>
      </div>
      <article v-else class="product-detail">
        <nav class="pd-crumbs" aria-label="현재 위치">
          <ol>
            <li><a href="/products">상품</a></li>
            <li><span class="pd-crumbs__sep" aria-hidden="true">›</span><a :href="categoryPath(product.category)">{{ categoryName(product.category) }}</a></li>
            <li><span class="pd-crumbs__sep" aria-hidden="true">›</span><span aria-current="page">{{ product.name }}</span></li>
          </ol>
        </nav>

        <div class="product-detail__top">
          <figure class="pd-image">
            <img :src="image" :alt="`${product.name} 이미지`" @error="imageBroken = true" />
            <span v-if="badge" class="pd-image__badge" :class="`pd-image__badge--${badge.kind}`">{{ badge.label }}</span>
          </figure>
          <div class="pd-info">
            <ProductSummary :name="product.name" :brand="product.brand" :category-name="categoryName(product.category)" :summary="product.summary">
              <template v-if="hasRating"><span aria-hidden="true">·</span><ProductRating :average="product.rating_average ?? null" :count="product.review_count || 0" /></template>
            </ProductSummary>

            <section class="pd-price-card" aria-label="가격">
              <ProductPriceSummary :price="product.price_krw" :trend="product.price_trend || null" />
              <div class="pd-buy">
                <ProductPurchaseCard class="pd-buy__main" :stock="product.stock" :quantity="quantity" :adding="adding" @update:quantity="selectQuantity" @add-to-cart="addToCart" @buy-now="buyNow" />
                <div class="pd-buy__more">
                  <button v-if="compareBox.available" class="pd-action" type="button" @click="toggleCompare">{{ inCompare ? '비교함에서 빼기' : '비교함에 담기' }}</button>
                  <button
                    ref="alertToggle"
                    class="pd-action"
                    :class="{ 'pd-action--on': alert }"
                    type="button"
                    :aria-expanded="alertOpen"
                    :aria-controls="alertOpen ? 'price-alert-panel' : undefined"
                    @click="toggleAlertPanel"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>{{ alertButtonLabel(alert) }}
                  </button>
                </div>
              </div>
              <p v-if="cartMessage" class="shop-message" :class="{ 'shop-message--error': cartFailed }" :role="cartFailed ? 'alert' : 'status'">
                {{ cartMessage }}<a v-if="needsLogin" href="/login">로그인하기</a><a v-else-if="!cartFailed" href="/cart">장바구니 보기</a>
              </p>

              <div v-if="alertOpen" id="price-alert-panel" class="pd-alert">
                <h2 class="pd-alert__title">목표가 알림</h2>
                <p v-if="alertPanelState === 'guest'" class="pd-alert__login">{{ ALERT_LOGIN_MESSAGE }} <a href="/login">로그인</a></p>
                <p v-else-if="alertPanelState === 'loading'" class="pd-alert__desc" role="status">목표가 알림을 불러오는 중입니다...</p>
                <div v-else-if="alertPanelState === 'error'" class="pd-alert__error" role="alert">
                  <p>{{ alertLoadMessage }}</p><button class="pd-small-button" type="button" @click="retryAlerts">다시 시도</button>
                </div>
                <template v-else>
                  <p class="pd-alert__desc">이 가격 이하로 내려오면 알림을 보내드려요.<template v-if="alert"> 지금 목표가는 {{ formatPrice(alert.target_price_krw) }}이에요.</template></p>
                  <form class="pd-alert__form" novalidate :aria-busy="alertSaving" @submit.prevent="submitAlert">
                    <fieldset class="pd-alert__fields" :disabled="alertSaving || alertDeleting">
                      <legend class="sr-only">목표 가격</legend>
                      <div v-if="presets.length" class="pd-alert__presets">
                        <button v-for="preset in presets" :key="preset.label" class="pd-preset" type="button" @click="choosePreset(preset.value)">{{ preset.label }} <span>{{ formatPrice(preset.value) }}</span></button>
                      </div>
                      <div class="pd-alert__row">
                        <label class="sr-only" for="price-alert-target">목표 가격(원)</label>
                        <input id="price-alert-target" v-model="alertInput" type="text" inputmode="numeric" autocomplete="off" placeholder="목표 가격 (원)" :aria-invalid="Boolean(alertError)" :aria-describedby="alertError ? 'price-alert-error' : undefined" />
                        <button class="pd-alert__save" type="submit" :aria-busy="alertSaving">{{ alertSaving ? '저장 중...' : '저장' }}</button>
                        <button v-if="alert" class="pd-small-button pd-alert__remove" type="button" :aria-busy="alertDeleting" @click="removeAlert">{{ alertDeleting ? '해제 중...' : '해제' }}</button>
                      </div>
                    </fieldset>
                    <p v-if="alertError" id="price-alert-error" class="pd-alert__error" role="alert">{{ alertError }}<a v-if="alertNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></p>
                  </form>
                </template>
              </div>
            </section>
          </div>
        </div>

        <section class="pd-card" aria-labelledby="price-history-title" :aria-busy="historyLoading">
          <div class="pd-card__head">
            <div>
              <h2 id="price-history-title">가격 추이</h2>
              <p class="pd-card__sub">MOA Parts 판매가 · 매일 자정 기록 · 점선은 1년 최저가</p>
            </div>
            <div class="pd-periods" role="radiogroup" aria-label="가격 추이 기간">
              <template v-for="item in PRICE_PERIODS" :key="item.code">
                <input :id="`price-period-${item.code}`" class="pd-periods__input" type="radio" name="price-period" :value="item.code" :checked="period === item.code" @change="selectPeriod(item.code)" />
                <label class="pd-periods__label" :for="`price-period-${item.code}`">{{ item.label }}</label>
              </template>
            </div>
          </div>
          <p v-if="historyState === 'loading'" class="pd-state pd-state--chart" role="status">가격 이력을 불러오는 중입니다...</p>
          <div v-else-if="historyState === 'error'" class="pd-state pd-state--chart pd-state--error" role="alert">
            <p>{{ historyError }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadPriceHistory">다시 시도</button>
          </div>
          <p v-else-if="historyState === 'empty'" class="pd-empty">아직 가격 이력이 없습니다.</p>
          <template v-else>
            <ProductPriceChart :points="historyPoints" :lowest="product.price_trend?.lowest_1y_krw ?? null" :period-label="currentPeriod.label" :days="currentPeriod.days" />
            <details v-if="historyRows.length" class="pd-history-table">
              <summary>가격 기록 표로 보기</summary>
              <table class="price-table">
                <caption class="sr-only">판매처별 최근 {{ currentPeriod.label }} 가격: 최근 가격, 최저가, 최고가, 마지막 기록일</caption>
                <thead><tr><th scope="col">판매처</th><th scope="col">최근 가격</th><th scope="col">최저가</th><th scope="col">최고가</th><th scope="col">마지막 기록</th></tr></thead>
                <tbody>
                  <tr v-for="row in historyRows" :key="row.source">
                    <th scope="row">{{ row.name }}</th>
                    <td data-label="최근 가격">{{ formatPrice(row.latest) }}</td>
                    <td data-label="최저가">{{ formatPrice(row.lowest) }}</td>
                    <td data-label="최고가">{{ formatPrice(row.highest) }}</td>
                    <td data-label="마지막 기록"><time :datetime="row.latestAt">{{ formatPriceDate(row.latestAt) }}</time></td>
                  </tr>
                </tbody>
              </table>
            </details>
          </template>
        </section>

        <div class="pd-grid">
          <section class="pd-card" aria-labelledby="store-prices-title">
            <div class="pd-card__head pd-card__head--inline">
              <h2 id="store-prices-title">판매처 비교</h2>
              <span v-if="stores.updatedAt" class="pd-card__sub">{{ formatStoreUpdatedAt(stores.updatedAt) }}</span>
            </div>
            <ul class="pd-stores" aria-label="판매처별 가격">
              <li v-for="row in stores.rows" :key="row.source" class="pd-store" :class="{ 'pd-store--mine': row.isStore }">
                <span class="pd-store__name"><strong>{{ row.name }}</strong><span>{{ row.note }}</span></span>
                <span v-if="row.isLowest" class="pd-store__best">최저가</span>
                <span class="pd-store__price"><strong>{{ formatPrice(row.price) }}</strong><span :class="`pd-store__diff--${row.diffTone}`">{{ row.diffText }}</span></span>
              </li>
            </ul>
            <p v-if="!stores.hasExternal" class="pd-card__sub">다른 판매처 가격 기록이 아직 없습니다.</p>
            <div v-if="!stores.storeIsLowest" class="pd-match">
              <p>다른 곳이 더 저렴해요. 최저가에 맞춰 드릴게요.</p>
              <button type="button" :disabled="matchSending || matchDone" :aria-busy="matchSending" @click="askPriceMatch">{{ matchSending ? '요청 중...' : (matchDone ? '매칭을 요청했어요' : '최저가 매칭 요청') }}</button>
            </div>
            <p v-if="matchNeedsLogin" class="pd-note" role="status">{{ authStatus === 'guest' ? PRICE_MATCH_LOGIN_MESSAGE : '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.' }} <a href="/login">로그인</a></p>
            <p v-if="matchError" class="pd-note pd-note--error" role="alert">{{ matchError }}</p>
          </section>

          <section class="pd-card" aria-labelledby="product-specs-title">
            <h2 id="product-specs-title">상세 스펙</h2>
            <div class="pd-spec-list">
              <dl class="product-facts">
                <div><dt>출시일</dt><dd>{{ formatReleaseDate(product.released_on) || '-' }} <b v-if="product.is_new" class="shop-new-badge">NEW</b></dd></div>
                <div><dt>성능 점수</dt><dd>{{ formatScore(product.performance_score) }}</dd></div>
                <div><dt>가성비 지수</dt><dd>{{ formatValueScore(product.value_score) }} <small>{{ VALUE_SCORE_HELP }}</small></dd></div>
                <div v-if="lowest"><dt>90일 최저가</dt><dd>{{ formatPrice(lowest.price) }} <b v-if="lowest.isLowest" class="product-facts__lowest">최근 90일 최저가</b></dd></div>
              </dl>
              <table v-if="product.specs?.length" class="product-specs">
                <caption class="sr-only">상세 스펙</caption>
                <tbody><tr v-for="(spec, index) in product.specs" :key="index"><th scope="row">{{ spec.label }}</th><td>{{ spec.value }}</td></tr></tbody>
              </table>
            </div>
            <p v-if="!product.specs?.length" class="pd-empty">등록된 사양 정보가 없습니다.</p>
          </section>
        </div>

        <section class="pd-card" aria-labelledby="product-description-title">
          <h2 id="product-description-title">상품 설명</h2>
          <p class="product-detail__description">{{ product.description || product.summary || '상품 설명을 준비하고 있습니다.' }}</p>
        </section>

        <section v-if="questionsState !== 'empty'" class="pd-card" aria-labelledby="product-questions-title" :aria-busy="questionsLoading">
          <div class="pd-card__head pd-card__head--inline">
            <h2 id="product-questions-title">이 부품에 대한 질문</h2>
            <a class="pd-small-button" :href="askQuestionPath(product.id)">질문하기</a>
          </div>
          <p v-if="questionsState === 'loading'" class="pd-state" role="status">질문을 불러오는 중입니다...</p>
          <div v-else-if="questionsState === 'error'" class="pd-state pd-state--error" role="alert">
            <p>{{ questionsError }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadQuestions">다시 시도</button>
          </div>
          <ul v-else class="pd-questions" aria-label="이 부품에 대한 질문">
            <li v-for="row in questionRows" :key="row.id">
              <a class="pd-question" :href="row.href">
                <span class="pd-question__count" :class="{ 'pd-question__count--answered': row.answerCount }">답변 {{ row.answerCount }}</span>
                <span class="pd-question__title">{{ row.title }}</span>
                <span class="pd-question__meta">{{ row.author }} · <time :datetime="row.createdAt">{{ row.date }}</time></span>
              </a>
            </li>
          </ul>
        </section>

        <ProductRecommendations
          :state="recommendationsState"
          :items="recommendationItems"
          :error="recommendationsError"
          :observe-item="observeRecommendation"
          @retry="loadRecommendations"
          @select="selectRecommendation"
        />

        <section class="pd-card product-reviews" aria-labelledby="product-reviews-title" :aria-busy="reviewsLoading">
          <h2 id="product-reviews-title">리뷰 <span v-if="reviews">{{ reviews.total }}개</span></h2>
          <p v-if="reviewNotice" class="shop-message product-reviews__notice" role="status">{{ reviewNotice }}</p>
          <p v-if="reviewsState === 'loading'" class="pd-state" role="status">리뷰를 불러오는 중입니다...</p>
          <div v-else-if="reviewsState === 'error'" class="pd-state pd-state--error" role="alert">
            <p>{{ reviewsError }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadReviews()">다시 시도</button>
          </div>
          <template v-else-if="reviewsState === 'ready'">
            <div v-if="reviews.total" class="review-overview">
              <div class="review-overview__score">
                <strong>{{ formatRatingAverage(reviews.rating_average) }}</strong>
                <span class="review-stars" role="img" :aria-label="`평점 5점 만점에 ${formatRatingAverage(reviews.rating_average)}점`">{{ ratingStars(reviews.rating_average) }}</span>
                <span>리뷰 {{ reviews.total.toLocaleString('ko-KR') }}개</span>
              </div>
              <ul class="review-bars" aria-label="별점 분포">
                <li v-for="row in distribution" :key="row.score"><span>{{ row.score }}점</span><span class="review-bars__track" aria-hidden="true"><i :style="{ width: `${row.percent}%` }"></i></span><span>{{ row.count }}개</span></li>
              </ul>
            </div>

            <div v-if="writeState === 'mine' && !reviewEditing" class="review-mine">
              <div class="review-mine__head"><h3>내가 쓴 리뷰</h3><span class="review-stars" role="img" :aria-label="`5점 만점에 ${myReview.rating}점`">{{ ratingStars(myReview.rating) }}</span></div>
              <p class="review-content">{{ myReview.content }}</p>
              <InlineConfirm v-if="confirmingDelete" message="내 리뷰를 삭제할까요? 삭제한 리뷰는 되돌릴 수 없습니다." :busy="reviewDeleting" @confirm="removeReview" @cancel="confirmingDelete = false" />
              <div v-else class="review-mine__actions">
                <button class="shop-button shop-button--secondary" type="button" @click="startEdit">수정</button>
                <button class="shop-button review-danger-button" type="button" @click="askDelete">삭제</button>
              </div>
              <p v-if="reviewDeleteError" class="shop-message shop-message--error" role="alert">{{ reviewDeleteError }}<a v-if="reviewNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></p>
            </div>
            <form v-else-if="showReviewForm" class="review-form" :aria-busy="reviewSaving" novalidate @submit.prevent="submitReview">
              <h3>{{ reviewEditing ? '리뷰 수정' : '리뷰 작성' }}</h3>
              <fieldset class="review-form__fields" :disabled="reviewSaving">
                <fieldset class="review-rating">
                  <legend>별점 <span>필수</span></legend>
                  <label v-for="score in REVIEW_RATINGS" :key="score" class="review-rating__option" :class="{ 'review-rating__option--checked': reviewRating === score }">
                    <input :id="`review-rating-${score}`" type="radio" name="review-rating" :value="score" :checked="reviewRating === score" @change="reviewRating = score" />
                    <span class="review-stars" aria-hidden="true">{{ ratingStars(score) }}</span> {{ score }}점
                  </label>
                </fieldset>
                <div class="review-form__field">
                  <label for="review-content">리뷰 내용 <span>10~2,000자</span></label>
                  <textarea id="review-content" v-model="reviewContent" rows="5" :maxlength="MAX_REVIEW_LENGTH" placeholder="성능, 소음, 발열, 조립 난이도처럼 직접 써 보며 느낀 점을 적어 주세요." aria-describedby="review-content-count"></textarea>
                  <p id="review-content-count" class="review-form__count">{{ reviewLength(reviewContent).toLocaleString('ko-KR') }} / 2,000</p>
                </div>
              </fieldset>
              <p v-if="reviewFormError" class="shop-message shop-message--error" role="alert">{{ reviewFormError }}<a v-if="reviewNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></p>
              <div class="review-form__actions">
                <button v-if="reviewEditing" class="shop-button shop-button--secondary" type="button" :disabled="reviewSaving" @click="cancelEdit">취소</button>
                <button class="shop-button" type="submit" :disabled="reviewSaving" :aria-busy="reviewSaving">{{ reviewSaving ? '저장 중...' : (reviewEditing ? '수정 완료' : '리뷰 등록') }}</button>
              </div>
            </form>
            <div v-else-if="loginChecked && writeState === 'guest'" class="review-note">
              <p>로그인하고 구매한 상품의 리뷰를 남겨 주세요.</p><a class="shop-button shop-button--secondary" href="/login">로그인</a>
            </div>
            <p v-else-if="loginChecked && writeState === 'not-purchased'" class="review-note">구매한 상품만 리뷰를 남길 수 있습니다.</p>

            <p v-if="!reviews.total" class="pd-empty">아직 리뷰가 없습니다.</p>
            <template v-else>
              <ol class="review-list">
                <li v-for="review in reviews.items" :key="review.id" class="review-item">
                  <div class="review-item__head">
                    <span class="review-stars" role="img" :aria-label="`5점 만점에 ${review.rating}점`">{{ ratingStars(review.rating) }}</span>
                    <strong>{{ review.author?.name || '구매자' }}</strong>
                    <span v-if="review.is_owner" class="review-item__mine">내 리뷰</span>
                  </div>
                  <p class="review-content">{{ review.content }}</p>
                  <p class="review-item__meta"><time :datetime="review.created_at">{{ formatReviewDate(review.created_at) }}</time><span v-if="isEdited(review)">수정됨</span></p>
                </li>
              </ol>
              <nav v-if="reviewPageCount > 1" class="shop-pagination" aria-label="리뷰 페이지">
                <button class="shop-button shop-button--secondary" type="button" :disabled="reviewPage <= 1" @click="loadReviews(reviewPage - 1)">이전</button>
                <span aria-live="polite">{{ reviewPage }} / {{ reviewPageCount }}</span>
                <button class="shop-button shop-button--secondary" type="button" :disabled="reviewPage >= reviewPageCount" @click="loadReviews(reviewPage + 1)">다음</button>
              </nav>
            </template>
          </template>
        </section>
      </article>
      <ProductCompareBar
        v-if="compareBox.available"
        :items="compareState.items"
        :notice="compareNotice"
        @remove="(id) => compareBox.remove(id, { source: 'bar' })"
        @clear="compareBox.clear()"
        @replace="compareBox.replace()"
        @dismiss="compareBox.dismiss()"
      />
    </div>
  </SiteLayout>
</template>

<style scoped>
.product-detail { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.product-detail > * { min-width: 0; }

/* 브레드크럼: 상품 › 카테고리 › 이름 */
.pd-crumbs ol { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; color: var(--muted); font-size: var(--text-sm); list-style: none; }
.pd-crumbs li { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.pd-crumbs a { color: var(--muted); text-decoration: none; }
.pd-crumbs a:hover { color: var(--ink); }
.pd-crumbs [aria-current='page'] { color: var(--ink); overflow-wrap: anywhere; }

/* 위: 사진 | 정보·가격 카드 */
.product-detail__top { display: flex; flex-wrap: wrap; gap: 20px; }
.pd-image { position: relative; flex: 1 1 360px; min-width: 0; align-self: flex-start; margin: 0; aspect-ratio: 4 / 3; overflow: hidden; border-radius: var(--radius-lg); background: var(--image-bg); }
.pd-image img { display: block; width: 100%; height: 100%; padding: 24px; object-fit: contain; }
.pd-image__badge { position: absolute; top: 14px; left: 14px; padding: 5px 10px; border-radius: 8px; background: var(--ink); color: var(--brand-ink); font-size: var(--text-xs); font-weight: 800; }
.pd-image__badge--low { background: var(--success); }
.pd-image__badge--drop { background: var(--brand); }
.pd-info { display: flex; flex: 1 1 400px; flex-direction: column; gap: 16px; min-width: 0; }
.pd-price-card { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }

/* 구매 영역(ProductPurchaseCard) 옆의 비교·목표가 알림 버튼. 넓으면 구매 버튼과 한 줄, 좁으면 아래 줄 */
.pd-buy { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
.pd-buy__main { flex: 1 1 300px; min-width: 0; }
.pd-buy__more { display: flex; flex: 0 1 auto; flex-wrap: wrap; gap: 8px; }
.pd-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 46px; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: transparent; color: var(--ink); font-size: var(--text-body); font-weight: 600; cursor: pointer; }
.pd-action:hover { border-color: var(--brand); color: var(--brand-strong); }
.pd-action svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pd-action--on { border-color: var(--brand-line); color: var(--brand-strong); }

/* 목표가 알림 패널 */
.pd-alert { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid var(--line); }
.pd-alert__title { margin: 0; color: var(--ink); font-size: var(--text-body); font-weight: 700; }
.pd-alert__desc, .pd-alert__login { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
.pd-alert__login a { color: var(--brand-strong); font-weight: 700; }
.pd-alert__form { display: grid; gap: 8px; }
.pd-alert__fields { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
.pd-alert__presets { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-preset { height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); font-size: var(--text-xs); font-weight: 600; cursor: pointer; }
.pd-preset:hover:not(:disabled) { border-color: var(--brand); }
.pd-preset span { margin-left: 4px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pd-alert__row { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-alert__row input { flex: 1 1 160px; min-width: 0; height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); font-size: var(--text-body); font-variant-numeric: tabular-nums; }
.pd-alert__row input:focus-visible { border-color: var(--brand); }
.pd-alert__save { height: 44px; padding: 0 18px; border: 0; border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-ink); font-size: var(--text-body); font-weight: 700; cursor: pointer; }
.pd-alert__save:hover:not(:disabled) { background: var(--brand-strong); }
.pd-alert__remove { height: 44px; }
.pd-alert__fields:disabled button, .pd-alert__fields:disabled input { opacity: .6; cursor: wait; }
.pd-alert__error { margin: 0; color: var(--danger); font-size: var(--text-sm); line-height: 1.5; }
.pd-alert__error p { margin: 0 0 8px; }
.pd-alert__error a { margin-left: 6px; color: inherit; font-weight: 700; }
.pd-small-button { display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--ink); font-size: var(--text-xs); font-weight: 700; text-decoration: none; white-space: nowrap; cursor: pointer; }
.pd-small-button:hover { border-color: var(--brand); color: var(--brand-strong); }

/* 카드 공통 */
.pd-card { display: flex; flex-direction: column; gap: 16px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.pd-card h2 { margin: 0; color: var(--ink); font-size: 17px; font-weight: 800; }
.pd-card h2 span { margin-left: 4px; color: var(--muted); font-size: var(--text-sm); font-weight: 600; }
.pd-card__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.pd-card__head--inline { gap: 8px; }
.pd-card__sub { margin: 3px 0 0; color: var(--muted); font-size: var(--text-xs); }
.pd-card__head--inline .pd-card__sub { margin: 0; }
.pd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 20px; }
.pd-state { display: grid; justify-items: center; gap: 10px; margin: 0; padding: 26px 16px; border-radius: var(--radius-sm); background: var(--bg); color: var(--muted); font-size: var(--text-sm); line-height: 1.7; text-align: center; overflow-wrap: anywhere; }
.pd-state p { margin: 0; }
.pd-state--chart { min-height: 200px; align-content: center; }
.pd-state--error { background: var(--danger-soft); color: var(--danger); }
.pd-empty { margin: 0; padding: 14px 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--text-sm); }

/* 기간 탭(라디오) */
.pd-periods { position: relative; display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-sm); background: var(--bg); }
.pd-periods__input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.pd-periods__label { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border-radius: 8px; color: var(--muted); font-size: var(--text-sm); font-weight: 700; cursor: pointer; }
.pd-periods__label:hover { color: var(--ink); }
.pd-periods__input:checked + .pd-periods__label { background: var(--surface-3); color: var(--ink); }
.pd-periods__input:focus-visible + .pd-periods__label { outline: 2px solid var(--focus); outline-offset: 2px; }

/* 표로 보기 */
.pd-history-table summary { width: fit-content; color: var(--muted); font-size: var(--text-sm); font-weight: 650; cursor: pointer; }
.pd-history-table summary:hover { color: var(--ink); }
.price-table { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: var(--text-sm); }
.price-table thead th { padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: var(--text-xs); font-weight: 650; text-align: right; }
.price-table thead th:first-child { text-align: left; }
.price-table tbody th, .price-table td { padding: 11px 12px; border-bottom: 1px solid var(--line); color: var(--ink); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.price-table tbody th { font-weight: 700; text-align: left; }

/* 판매처 비교 */
.pd-stores { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.pd-store { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius-sm); }
.pd-store--mine { background: var(--brand-soft); }
.pd-store__name { display: grid; flex: 1; gap: 1px; min-width: 0; }
.pd-store__name strong { color: var(--ink); font-size: var(--text-body); font-weight: 700; }
.pd-store--mine .pd-store__name strong { color: var(--brand-strong); }
.pd-store__name span { color: var(--muted); font-size: 11px; }
.pd-store__best { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--success-soft); color: var(--success); font-size: 11px; font-weight: 800; }
.pd-store__price { display: grid; gap: 1px; text-align: right; }
.pd-store__price strong { color: var(--ink); font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 800; white-space: nowrap; }
.pd-store__price span { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pd-store__price .pd-store__diff--store { color: var(--brand-strong); }
.pd-store__price .pd-store__diff--lower { color: var(--danger); }
.pd-match { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent); border-radius: var(--radius-sm); background: var(--warning-soft); }
.pd-match p { margin: 0; color: var(--warning); font-size: var(--text-sm); }
.pd-match button { height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--warning); color: var(--brand-ink); font-size: var(--text-xs); font-weight: 800; cursor: pointer; }
.pd-match button:disabled { opacity: .6; cursor: default; }
.pd-match button[aria-busy='true'] { cursor: wait; }
.pd-note { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
.pd-note a { color: var(--brand-strong); font-weight: 700; }
.pd-note--error { color: var(--danger); }

/* 상세 스펙: 정보(dl)와 사양(table)을 같은 줄 모양으로 */
.product-facts { display: flex; flex-direction: column; margin: 0; }
.product-facts > div, .product-specs tr { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: var(--text-body); }
.product-facts dt, .product-specs th { flex: none; color: var(--muted); font-weight: 400; text-align: left; }
.product-facts dd { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px 8px; margin: 0; color: var(--ink); font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.product-facts small { flex-basis: 100%; color: var(--muted); font-size: 11px; font-weight: 400; }
.product-facts__lowest { padding: 2px 8px; border-radius: 999px; background: var(--success-soft); color: var(--success); font-size: 11px; font-weight: 750; white-space: nowrap; }
.pd-spec-list { display: flex; flex-direction: column; min-width: 0; }
.product-specs { width: 100%; border-collapse: collapse; }
.product-specs tbody { display: block; }
.product-specs th { padding: 0; }
.product-specs td { padding: 0; color: var(--ink); font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.product-detail__description { margin: 0; color: var(--ink); font-size: var(--text-body); line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; }

/* 이 부품에 대한 질문 */
.pd-questions { display: flex; flex-direction: column; margin: -4px 0 0; padding: 0; list-style: none; }
.pd-question { display: flex; align-items: center; gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.pd-question:hover { background: var(--surface-2); }
.pd-question__count { flex: none; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: var(--text-xs); font-weight: 700; }
.pd-question__count--answered { border-color: var(--brand-line); background: var(--brand-soft); color: var(--brand-strong); }
.pd-question__title { flex: 1; min-width: 0; overflow: hidden; color: var(--ink); font-size: var(--text-body); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.pd-question__meta { flex: none; color: var(--muted); font-size: var(--text-xs); }

/* 리뷰(어두운 카드) */
.product-reviews__notice { margin: 0; }
.review-overview { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); align-items: center; gap: 18px 30px; padding: 0 0 20px; border-bottom: 1px solid var(--line); }
.review-overview__score { display: grid; justify-items: center; gap: 4px; color: var(--muted); font-size: var(--text-xs); text-align: center; }
.review-overview__score strong { color: var(--ink); font-size: 34px; line-height: 1.1; letter-spacing: -1px; }
.review-stars { color: var(--warning); letter-spacing: 1px; white-space: nowrap; }
.review-bars { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: var(--text-xs); }
.review-bars li { display: grid; grid-template-columns: 34px minmax(0, 1fr) 40px; align-items: center; gap: 10px; color: var(--muted); }
.review-bars li > span:last-child { text-align: right; }
.review-bars__track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--surface-3); }
.review-bars__track i { display: block; height: 100%; border-radius: inherit; background: var(--warning); }
.review-mine, .review-form, .review-note { display: grid; gap: 12px; margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.review-mine__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.review-mine h3, .review-form h3 { margin: 0; color: var(--ink); font-size: 15px; }
.review-mine__actions, .review-form__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
.review-danger-button { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--surface-2); color: var(--danger); }
.review-danger-button:hover:not(:disabled) { border-color: var(--danger); background: var(--danger-soft); }
.review-note { justify-items: start; color: var(--ink); font-size: var(--text-sm); }
.review-note p { margin: 0; }
.review-form__fields, .review-rating { min-width: 0; margin: 0; padding: 0; border: 0; }
.review-form__fields { display: grid; gap: 16px; }
.review-rating legend, .review-form__field > label { margin-bottom: 8px; padding: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 700; }
.review-rating legend span, .review-form__field > label span { margin-left: 6px; color: var(--muted); font-size: var(--text-xs); font-weight: 500; }
.review-rating { display: flex; flex-wrap: wrap; gap: 8px; }
.review-rating__option { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 12px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); color: var(--ink); font-size: var(--text-xs); font-weight: 650; cursor: pointer; }
.review-rating__option input { margin: 0; accent-color: var(--brand); }
.review-rating__option--checked { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
.review-rating__option:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
.review-form__field > label { display: block; }
.review-form__field textarea { display: block; width: 100%; min-height: 120px; padding: 12px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-body); line-height: 1.7; resize: vertical; }
.review-form__count { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }
.review-list { margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
.review-item { display: grid; gap: 8px; padding: 18px 4px; border-bottom: 1px solid var(--line); }
.review-item__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--text-sm); }
.review-item__head strong { color: var(--ink); overflow-wrap: anywhere; }
.review-item__mine { padding: 2px 8px; border-radius: 999px; background: var(--brand-soft); color: var(--brand); font-size: var(--text-xs); font-weight: 750; }
.review-content { margin: 0; color: var(--ink); font-size: var(--text-body); line-height: 1.8; white-space: pre-line; overflow-wrap: anywhere; }
.review-item__meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; color: var(--muted); font-size: var(--text-xs); }
.product-detail :is(textarea, input):focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

/* 760px 아래는 디자인 시안의 모바일 배치 */
@media (max-width: 760px) {
  .pd-card, .pd-price-card { padding: 16px; }
  .pd-periods { width: 100%; }
  .pd-periods__label { flex: 1; justify-content: center; padding: 0 8px; }
  .pd-buy__more { flex: 1 1 100%; }
  .pd-action { flex: 1 1 calc(50% - 4px); }
}
@media (max-width: 640px) {
  .pd-question { flex-wrap: wrap; row-gap: 4px; }
  .pd-question__title { flex-basis: calc(100% - 80px); }
  .pd-question__meta { flex-basis: 100%; padding-left: 2px; }
  .price-table thead { display: none; }
  .price-table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 2px; border-bottom: 1px solid var(--line); }
  .price-table tbody th, .price-table td { padding: 0; border-bottom: 0; text-align: left; white-space: normal; }
  .price-table tbody th { grid-column: 1 / -1; }
  .price-table td::before { content: attr(data-label); display: block; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
  .review-overview { grid-template-columns: minmax(0, 1fr); }
  .review-mine, .review-form, .review-note { padding: 16px 14px; }
  .review-mine__actions, .review-form__actions { justify-content: stretch; }
  .review-mine__actions .shop-button, .review-form__actions .shop-button { flex: 1 1 0; }
  .pd-store { gap: 8px; padding: 10px; }
}
</style>
