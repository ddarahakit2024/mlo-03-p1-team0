<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addCartItem } from '../api/cartApi.js'
import { fetchPriceSummary, fetchProductFacets, fetchProducts, fetchProducts as fetchDropProducts } from '../api/productApi.js'
import { ProductCompareBar, ProductDropList, ProductGrid, ProductSearchBar, SiteLayout } from '../components/index.js'
import { cartError } from '../stores/cartViewModel.js'
import { browserCompareStorage, createCompareBox } from '../stores/compareViewModel.js'
import { createImpressionTracker } from '../stores/impressionTracker.js'
import { CART_ADDED_TOAST, CART_ADD_FAILED_MESSAGE, DROP_ROW_REQUEST, LOGIN_NEEDED_TOAST, MAX_PRICE_FILTER, PRICE_TREND_FILTERS, PRODUCT_CATEGORIES, PRODUCT_PAGE_SIZE, brandLabel, brandOptions, catalogIntro, catalogRequest, catalogSearch, catalogTitle, clearDetailFilters, compareToast, dropsLinkHref, formatCount, formatPrice, getProductPageState, getSectionState, hasCatalogFilter, hasDetailFilter, isCatalogHome, productError, productSorts, pushCatalogQuery, readCatalogQuery, trendFilterChange, validatePriceRange } from '../stores/productViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { MAX_PROP_LIST_LENGTH, onExit, track } from '../stores/tracking.js'

// 첫 화면(/, /products): 소개·가격 요약(GET /products/price-summary) → 30일 하락폭 큰 부품 줄(조건 없는 1쪽에서만) → 카테고리·검색 →
// 필터(브랜드·가격대·가격 추세 스위치) + 상품 목록. 요약과 하락 줄은 따로 불러오는 보조 영역이라 실패해도 목록은 보인다.
// 하락 줄도 GET /products 지만 목록과 따로 부르는 요청이라 이름을 나눠 둔다(fetchDropProducts, 테스트에서 따로 바꿔 넣는다).
const categoryTabs = [{ code: '', name: '전체' }, ...PRODUCT_CATEGORIES]
const trendFilters = PRICE_TREND_FILTERS.map((filter) => ({ ...filter, id: `filter-${filter.param.replaceAll('_', '-')}` }))
// 목록 상태(카테고리·검색어·필터·정렬·쪽)는 주소 query 에 남긴다: 새로고침·공유·뒤로 가기에도 같은 목록을 본다
const query = ref(readCatalogQuery(window.location.search))
const keyword = ref(query.value.search)
// 가격대는 입력 중인 값(minPriceText)과 적용된 값(query.minPrice)을 나눈다. 적용 버튼을 눌러야 다시 부른다
const minPriceText = ref(priceText(query.value.minPrice))
const maxPriceText = ref(priceText(query.value.maxPrice))
const priceError = ref('')
const filtersOpen = ref(false)
const facets = ref(null)
const facetsFailed = ref(false)
const products = ref([])
const total = ref(0)
const loading = ref(true)
const error = ref('')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PRODUCT_PAGE_SIZE)))
const pageState = computed(() => getProductPageState({ loading: loading.value, error: error.value, products: products.value }))
const canReset = computed(() => hasCatalogFilter(query.value) || query.value.page > 1)
const canClearFilters = computed(() => hasDetailFilter(query.value))
const sorts = computed(() => productSorts(query.value.category))
const brands = computed(() => brandOptions(facets.value, query.value.brand))
const priceHint = computed(() => {
  const min = facets.value?.price_min
  const max = facets.value?.price_max
  return min == null || max == null ? '' : `${formatPrice(min)} ~ ${formatPrice(max)}`
})
const heading = computed(() => catalogTitle(query.value))
let requestId = 0
let facetsRequestId = 0

// 가격 요약: 소개 문구의 상품 수와 숫자 칸 두 개
const summary = ref(null)
const summaryLoading = ref(true)
const summaryError = ref('')
const summaryState = computed(() => getSectionState({ loading: summaryLoading.value, error: summaryError.value }))
const intro = computed(() => catalogIntro(summaryState.value === 'ready' ? summary.value?.product_count : null))
let summaryRequestId = 0

// 30일 하락폭 큰 부품 줄: 조건 없는 1쪽(첫 화면)일 때만 보이고, 처음 보일 때 한 번 부른다. 비어 있으면 영역을 숨긴다
const atHome = computed(() => isCatalogHome(query.value))
const drops = ref([])
const dropsLoading = ref(false)
const dropsError = ref('')
// 0 이면 아직 부르지 않았다(로딩으로 본다)
const dropsRequestId = ref(0)
const dropsState = computed(() => getSectionState({ loading: dropsLoading.value || dropsRequestId.value === 0, error: dropsError.value, empty: !drops.value.length }))
const showDrops = computed(() => atHome.value && dropsState.value !== 'empty')
const dropsHref = computed(() => dropsLinkHref(showDrops.value))

// 비교함(localStorage). 쓸 수 없는 브라우저면 비교 버튼과 막대를 숨긴다(compareIds null). 담긴 수는 헤더에도 알린다
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
const compareIds = computed(() => (compareBox.available ? compareState.value.items.map((item) => item.id) : null))
// 카드 노출·클릭(product_impression·product_click). 목록 결과마다 새 list_view_id 로 목록 이벤트와 잇는다
const impressions = createImpressionTracker({ list: 'catalog', track, onExit, pageSize: PRODUCT_PAGE_SIZE })
// 카드의 "담기": 담는 중인 상품 id(그 카드의 버튼만 막는다)
const addingIds = ref([])

function priceText(value) {
  return value == null ? '' : String(value)
}

// searched: 검색어를 제출해서 부른 것이면 결과(개수)를 받은 뒤 search 이벤트를 남긴다
async function loadProducts({ searched = false } = {}) {
  const request = ++requestId
  const applied = query.value
  loading.value = true
  error.value = ''
  try {
    const data = await fetchProducts(catalogRequest(applied, PRODUCT_PAGE_SIZE))
    if (request !== requestId) return
    products.value = data.items
    total.value = data.total
    const listViewId = impressions.start({ page: data.page ?? applied.page, sort: applied.sort, category: applied.category || null, search: applied.search || null })
    trackResult(applied, data, searched, listViewId)
  } catch (failure) {
    if (request !== requestId) return
    error.value = productError(failure, '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
    if (searched) track('search', { search: applied.search, category: applied.category || null, result_count: null })
  } finally {
    if (request === requestId) loading.value = false
  }
}

// 이벤트 값은 이번 요청 조건과 서버 응답(쪽, 전체 개수, 이번 쪽 상품 id)을 그대로 쓴다. 빈 조건(꺼진 스위치 포함)은 null.
// list_view_id 는 이번 목록 결과의 무작위 id(노출·클릭 이벤트와 같다)
function trackResult(applied, data, searched, listViewId) {
  track('product_list_view', {
    category: applied.category || null,
    brand: applied.brand || null,
    min_price: applied.minPrice ?? null,
    max_price: applied.maxPrice ?? null,
    dropping: applied.dropping ? true : null,
    near_low: applied.nearLow ? true : null,
    store_lowest: applied.storeLowest ? true : null,
    sort: applied.sort,
    page: data.page ?? applied.page,
    search: applied.search || null,
    result_count: data.total,
    product_ids: (data.items || []).slice(0, MAX_PROP_LIST_LENGTH).map((item) => item.id),
    list_view_id: listViewId,
  })
  if (searched) track('search', { search: applied.search, category: applied.category || null, result_count: data.total })
}

// 사용자가 바꾼 조건 하나(category/brand/price/sort). 값이 그대로면 남기지 않는다. 해제(전체)는 null
function trackFilter(field, value, previous) {
  if (JSON.stringify(value) !== JSON.stringify(previous)) track('filter_change', { field, value })
}

// 브랜드 선택지(GET /products/facets)는 카테고리마다 다르다. 카테고리가 바뀔 때마다 다시 부르고 늦게 온 이전 응답은 버린다
async function loadFacets() {
  const request = ++facetsRequestId
  facetsFailed.value = false
  try {
    const data = await fetchProductFacets({ category: query.value.category })
    if (request === facetsRequestId) facets.value = data
  } catch {
    if (request !== facetsRequestId) return
    facets.value = null
    facetsFailed.value = true
  }
}

async function loadSummary() {
  const request = ++summaryRequestId
  summaryLoading.value = true
  summaryError.value = ''
  try {
    const data = await fetchPriceSummary()
    if (request !== summaryRequestId) return
    summary.value = data
  } catch (failure) {
    if (request !== summaryRequestId) return
    summaryError.value = productError(failure, '가격 요약을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === summaryRequestId) summaryLoading.value = false
  }
}

async function loadDrops() {
  const request = ++dropsRequestId.value
  dropsLoading.value = true
  dropsError.value = ''
  try {
    const data = await fetchDropProducts({ ...DROP_ROW_REQUEST })
    if (request !== dropsRequestId.value) return
    drops.value = data?.items || []
  } catch (failure) {
    if (request !== dropsRequestId.value) return
    drops.value = []
    dropsError.value = productError(failure, '하락한 부품을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === dropsRequestId.value) dropsLoading.value = false
  }
}

// 첫 화면이 처음 보일 때 한 번만(실패하면 영역의 "다시 시도")
function loadDropsOnce() {
  if (atHome.value && dropsRequestId.value === 0) loadDrops()
}

function applyQuery(changes, options) {
  query.value = { ...query.value, ...changes }
  pushCatalogQuery(query.value)
  loadProducts(options)
}

// 카테고리를 바꾸면 그 카테고리에 없을 수 있는 브랜드를 지우고, 가성비순은 전체 보기에서 쓸 수 없으므로 추천순으로 돌린다
function selectCategory(code) {
  trackFilter('category', code || null, query.value.category || null)
  const changes = { category: code, brand: undefined, page: 1 }
  if (!productSorts(code).some((item) => item.value === query.value.sort)) changes.sort = 'recommended'
  applyQuery(changes)
  loadFacets()
}
// 빈 검색어 제출은 검색을 지우는 것이라 search 이벤트를 남기지 않는다(목록 이벤트만)
function runSearch(value) { applyQuery({ search: value, page: 1 }, { searched: Boolean(value) }) }
function changeSort(event) {
  trackFilter('sort', event.target.value, query.value.sort)
  applyQuery({ sort: event.target.value, page: 1 })
}
function changeBrand(event) {
  trackFilter('brand', event.target.value || null, query.value.brand || null)
  applyQuery({ brand: event.target.value || undefined, page: 1 })
}
function changePage(page) {
  applyQuery({ page })
  window.scrollTo?.({ top: 0 })
}

// 가격 추세 스위치(가격 하락 중·1년 최저가 근접·MOA가 최저가): 켜고 끌 때마다 1쪽부터 다시 부르고 주소에 남긴다
function toggleTrendFilter(key, event) {
  const result = trendFilterChange(query.value, key, event.target.checked)
  if (!result?.event) return
  track('filter_change', result.event)
  applyQuery(result.changes)
}

// 가격대 적용: 숫자·범위(0~1억)·최소 ≤ 최대를 확인하고, 틀리면 요청하지 않고 안내한다. 빈 칸은 그 쪽 제한을 없앤다
function applyPrice() {
  const range = validatePriceRange(minPriceText.value, maxPriceText.value)
  priceError.value = range.error
  if (range.error) return
  minPriceText.value = priceText(range.minPrice)
  maxPriceText.value = priceText(range.maxPrice)
  trackFilter('price', [range.minPrice, range.maxPrice], [query.value.minPrice ?? null, query.value.maxPrice ?? null])
  applyQuery({ minPrice: range.minPrice ?? undefined, maxPrice: range.maxPrice ?? undefined, page: 1 })
}

// 필터 초기화: 브랜드·가격대·스위치만 지운다(카테고리·검색어·정렬은 그대로)
function clearFilters() {
  minPriceText.value = ''
  maxPriceText.value = ''
  priceError.value = ''
  const { changes, events } = clearDetailFilters(query.value)
  for (const props of events) track('filter_change', props)
  applyQuery(changes)
}

// 비교 토글: 담기·빼기는 토스트로, 꽉 참·다른 카테고리는 비교함 막대의 안내로 알린다
function toggleCompare(product) {
  const message = compareToast(compareBox.toggle(product, 'catalog'))
  if (message) siteStatus.showToast(message)
}

// 카드의 "담기"(1개): 성공하면 헤더 장바구니 수와 토스트, 비로그인(401)은 로그인 안내 토스트(화면은 그대로), 그 밖의 실패는 오류 문구 토스트
async function addToCart(product) {
  const productId = product?.id
  if (productId == null || addingIds.value.includes(productId)) return
  addingIds.value = [...addingIds.value, productId]
  try {
    const cart = await addCartItem({ productId, quantity: 1 })
    if (cart?.item_count != null) siteStatus.setCartCount(cart.item_count)
    siteStatus.showToast(CART_ADDED_TOAST)
    // 가격은 담기 응답(장바구니)의 그 상품 가격, 없으면 목록의 서버 가격
    const line = cart?.items?.find((item) => item.product_id === productId)
    track('add_to_cart', { product_id: productId, quantity: 1, price_krw: line?.price_krw ?? product.price_krw })
  } catch (failure) {
    siteStatus.showToast(failure?.response?.status === 401 ? LOGIN_NEEDED_TOAST : cartError(failure, CART_ADD_FAILED_MESSAGE))
  } finally {
    addingIds.value = addingIds.value.filter((id) => id !== productId)
  }
}

// 뒤로·앞으로 가기: 주소의 query 로 목록을 다시 맞춘다. 목록 조건이 같으면(#drops 같은 쪽 안 이동) 다시 부르지 않는다
function syncFromAddress() {
  const next = readCatalogQuery(window.location.search)
  if (catalogSearch(next) === catalogSearch(query.value)) return
  const previousCategory = query.value.category
  query.value = next
  keyword.value = query.value.search
  minPriceText.value = priceText(query.value.minPrice)
  maxPriceText.value = priceText(query.value.maxPrice)
  priceError.value = ''
  loadProducts()
  if (query.value.category !== previousCategory) loadFacets()
}

watch(atHome, loadDropsOnce)

onMounted(() => {
  window.addEventListener('popstate', syncFromAddress)
  const params = new URLSearchParams(window.location.search)
  const submitted = params.get('search_action') === 'submit'
  if (submitted) {
    params.delete('search_action')
    window.history.replaceState?.({}, '', `/products${params.size ? `?${params}` : ''}`)
  }
  loadProducts({ searched: submitted && Boolean(query.value.search) })
  loadFacets()
  loadSummary()
  loadDropsOnce()
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncFromAddress)
  impressions.stop()
})
</script>

<template>
  <SiteLayout active-page="products" :show-search="false">
    <div class="shop-page catalog-page">
      <section class="catalog-hero" aria-labelledby="catalog-hero-title">
        <div class="catalog-hero__card">
          <span class="catalog-hero__glow" aria-hidden="true"></span>
          <img class="catalog-hero__logo" src="/images/logo.png" alt="" />
          <p class="catalog-hero__eyebrow">MOA PARTS · 가격 추적</p>
          <h1 id="catalog-hero-title">부품 가격,<br />떨어질 때 사세요</h1>
          <p class="catalog-hero__intro">{{ intro }}</p>
          <div class="catalog-hero__actions">
            <a class="shop-button" :href="dropsHref">하락 중인 부품 보기</a>
            <a class="shop-button shop-button--secondary" href="/community/build/new">예산으로 견적 받기</a>
          </div>
        </div>
        <div class="catalog-stats">
          <p v-if="summaryState === 'loading'" class="catalog-stat catalog-stat--state" role="status">가격 요약을 불러오는 중입니다...</p>
          <div v-else-if="summaryState === 'error'" class="catalog-stat catalog-stat--state" role="alert">
            <p>{{ summaryError }}</p>
            <button class="catalog-link-button" type="button" @click="loadSummary">다시 시도</button>
          </div>
          <dl class="catalog-stats__list">
            <template v-if="summaryState === 'ready'">
              <div class="catalog-stat"><dt>30일 동안 내려간 부품</dt><dd class="catalog-stat__value catalog-stat__value--down">{{ formatCount(summary?.dropping_count) }}<span>개</span></dd></div>
              <div class="catalog-stat"><dt>지금 1년 최저가인 부품</dt><dd class="catalog-stat__value catalog-stat__value--low">{{ formatCount(summary?.lowest_1y_count) }}<span>개</span></dd></div>
            </template>
            <div class="catalog-stat"><dt>가격 기록</dt><dd class="catalog-stat__value">365<span>일 · 매일 자정 갱신</span></dd></div>
          </dl>
        </div>
      </section>

      <ProductDropList v-if="showDrops" id="drops" :state="dropsState" :items="drops" :error="dropsError" @retry="loadDrops" />

      <section class="catalog" aria-labelledby="catalog-title">
        <div class="catalog-bar">
          <div class="catalog-categories" role="group" aria-label="카테고리">
            <button v-for="item in categoryTabs" :key="item.code || 'all'" type="button" :aria-pressed="query.category === item.code" @click="selectCategory(item.code)">{{ item.name }}</button>
          </div>
          <ProductSearchBar class="catalog-search" v-model:keyword="keyword" @search="runSearch" />
        </div>
        <div class="catalog-toolbar">
          <div class="catalog-toolbar__title"><h2 id="catalog-title">{{ heading }}</h2><span v-if="pageState === 'ready' || pageState === 'empty'">{{ total.toLocaleString('ko-KR') }}개</span></div>
          <div class="catalog-sort">
            <button class="catalog-filter-toggle" type="button" :aria-expanded="filtersOpen" aria-controls="catalog-filters" @click="filtersOpen = !filtersOpen">필터</button>
            <label class="sr-only" for="product-sort">정렬</label>
            <select id="product-sort" :value="query.sort" @change="changeSort">
              <option v-for="item in sorts" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </div>
        </div>
        <aside id="catalog-filters" class="catalog-filters" :class="{ 'catalog-filters--open': filtersOpen }" aria-label="상품 필터">
          <h3>필터</h3>
          <div class="catalog-filter">
            <label for="product-brand">브랜드</label>
            <select id="product-brand" :value="query.brand || ''" @change="changeBrand">
              <option value="">전체 브랜드</option>
              <option v-for="item in brands" :key="item.name" :value="item.name">{{ brandLabel(item) }}</option>
            </select>
            <p v-if="facetsFailed" class="catalog-filter__note">브랜드 목록을 불러오지 못했습니다. <button class="catalog-link-button" type="button" @click="loadFacets">다시 불러오기</button></p>
          </div>
          <form class="catalog-price" aria-labelledby="catalog-price-title" novalidate @submit.prevent="applyPrice">
            <span id="catalog-price-title" class="catalog-price__title">가격대 (원)</span>
            <div class="catalog-price__inputs">
              <label class="sr-only" for="product-min-price">최소 가격(원)</label>
              <input id="product-min-price" v-model="minPriceText" type="text" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="최소" :aria-invalid="Boolean(priceError)" aria-describedby="catalog-price-help catalog-price-error" />
              <span aria-hidden="true">~</span>
              <label class="sr-only" for="product-max-price">최대 가격(원)</label>
              <input id="product-max-price" v-model="maxPriceText" type="text" inputmode="numeric" autocomplete="off" maxlength="15" placeholder="최대" :aria-invalid="Boolean(priceError)" aria-describedby="catalog-price-help catalog-price-error" />
              <button class="catalog-price__apply" type="submit">적용</button>
            </div>
            <p id="catalog-price-help" class="catalog-filter__note">{{ priceHint ? `이 조건의 가격 ${priceHint}` : `0원 ~ ${formatPrice(MAX_PRICE_FILTER)}` }}</p>
            <p v-if="priceError" id="catalog-price-error" class="catalog-filter__error" role="alert">{{ priceError }}</p>
          </form>
          <fieldset class="catalog-switches">
            <legend class="sr-only">가격 조건</legend>
            <div v-for="filter in trendFilters" :key="filter.key" class="catalog-switch">
              <label :for="filter.id">{{ filter.label }}</label>
              <input :id="filter.id" type="checkbox" role="switch" :checked="Boolean(query[filter.key])" @change="toggleTrendFilter(filter.key, $event)" />
            </div>
          </fieldset>
          <button v-if="canClearFilters" class="catalog-filters__reset" type="button" @click="clearFilters">필터 초기화</button>
        </aside>

        <div class="catalog-results" :aria-busy="loading">
          <p v-if="pageState === 'loading'" class="shop-state" role="status">상품을 불러오는 중입니다...</p>
          <div v-else-if="pageState === 'error'" class="shop-state" role="alert"><p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadProducts()">다시 시도</button></div>
          <div v-else-if="pageState === 'empty'" class="catalog-empty">
            <p v-if="canReset">조건에 맞는 부품이 없어요. 필터를 조정하거나 다른 검색어를 입력해 보세요.</p>
            <p v-else>상품을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.</p>
            <div v-if="canReset" class="catalog-empty__actions">
              <button v-if="canClearFilters" class="shop-button shop-button--secondary" type="button" @click="clearFilters">필터 초기화</button>
              <a class="shop-text-link" href="/products">전체 보기</a>
            </div>
          </div>
          <template v-else>
            <ProductGrid
              :products="products"
              :label="`${heading} 목록`"
              :compare-ids="compareIds"
              :adding-ids="addingIds"
              :observe-item="impressions.observe"
              @select="impressions.click"
              @toggle-compare="toggleCompare"
              @add-to-cart="addToCart"
            />
            <nav v-if="pageCount > 1" class="shop-pagination" aria-label="상품 목록 페이지">
              <button class="shop-button shop-button--secondary" type="button" :disabled="query.page <= 1" @click="changePage(query.page - 1)">이전</button>
              <span aria-live="polite">{{ query.page }} / {{ pageCount }}</span>
              <button class="shop-button shop-button--secondary" type="button" :disabled="query.page >= pageCount" @click="changePage(query.page + 1)">다음</button>
            </nav>
          </template>
        </div>
      </section>
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
.catalog-page { display: flex; flex-direction: column; gap: 28px; min-width: 0; }

/* 소개 카드 + 가격 요약 숫자 칸 */
.catalog-hero { display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; }
.catalog-hero__card { position: relative; flex: 1 1 420px; min-width: 0; overflow: hidden; padding: 32px 32px 28px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.catalog-hero__glow { position: absolute; top: -80px; right: -60px; width: 280px; height: 280px; border-radius: 50%; background: radial-gradient(closest-side, var(--brand-soft), transparent); background: radial-gradient(closest-side, color-mix(in srgb, var(--brand) 22%, transparent), transparent); pointer-events: none; }
.catalog-hero__logo { position: absolute; right: 28px; bottom: -30px; width: 180px; height: 180px; object-fit: contain; opacity: .18; pointer-events: none; }
.catalog-hero__eyebrow { position: relative; margin: 0; color: var(--brand-strong); font-size: var(--text-xs); font-weight: 700; letter-spacing: .14em; }
.catalog-hero h1 { position: relative; margin: 12px 0 0; color: var(--ink); font-size: clamp(28px, 4vw, 40px); font-weight: 800; line-height: 1.15; letter-spacing: -.03em; text-wrap: pretty; }
.catalog-hero__intro { position: relative; max-width: 460px; margin: 14px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; text-wrap: pretty; word-break: keep-all; }
.catalog-hero__actions { position: relative; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.catalog-hero__actions .shop-button { font-size: var(--text-body); }
.catalog-stats { display: grid; flex: 0 1 300px; align-content: start; gap: 12px; min-width: 240px; }
.catalog-stats__list { display: grid; gap: 12px; margin: 0; }
.catalog-stat { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.catalog-stat dt { color: var(--muted); font-size: var(--text-xs); }
.catalog-stat__value { margin: 0; color: var(--ink); font-size: 28px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.catalog-stat__value span { margin-left: 4px; color: var(--muted); font-size: var(--text-body); font-weight: 600; letter-spacing: 0; }
.catalog-stat__value--down { color: var(--success); }
.catalog-stat__value--low { color: var(--brand-strong); }
.catalog-stat--state { flex-flow: row wrap; align-items: center; gap: 8px 12px; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; }
.catalog-stat--state p { margin: 0; }

/* 카테고리 칩 + 검색 */
.catalog { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 0 20px; align-items: start; }
.catalog-bar { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; margin-bottom: 20px; }
.catalog-categories { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.catalog-categories button { height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink); font-size: var(--text-sm); font-weight: 700; white-space: nowrap; cursor: pointer; }
.catalog-categories button:hover { border-color: var(--brand); }
.catalog-categories button[aria-pressed="true"] { border-color: var(--brand); background: var(--brand); color: var(--brand-ink); }
.catalog-search { flex: 0 1 380px; min-width: 0; }

/* 목록 머리(제목·개수·필터 열기·정렬) */
.catalog-toolbar { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.catalog-toolbar__title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; min-width: 0; }
.catalog-toolbar__title h2 { margin: 0; color: var(--ink); font-size: 18px; font-weight: 800; overflow-wrap: anywhere; }
.catalog-toolbar__title span { color: var(--muted); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.catalog-sort { display: flex; align-items: center; gap: 8px; }
.catalog-filter-toggle { display: none; height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--ink); font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.catalog-filter-toggle[aria-expanded="true"] { border-color: var(--brand); color: var(--brand-strong); }
.catalog-sort select { height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font-size: var(--text-sm); cursor: pointer; }

/* 필터 칸 */
.catalog-filters { position: sticky; top: 84px; grid-column: 1; grid-row: 2 / span 2; display: flex; flex-direction: column; gap: 18px; min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.catalog-filters h3 { margin: 0; color: var(--ink); font-size: var(--text-body); font-weight: 800; }
.catalog-filter, .catalog-price { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.catalog-filter label, .catalog-price__title { color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.catalog-filter select, .catalog-price input { width: 100%; min-width: 0; height: 40px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); font-size: var(--text-sm); }
.catalog-filter select:focus, .catalog-price input:focus { border-color: var(--brand); }
.catalog-price__inputs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center; }
.catalog-price__inputs > span { color: var(--muted); }
.catalog-price__apply { grid-column: 1 / -1; height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--ink); font-size: var(--text-xs); font-weight: 700; cursor: pointer; }
.catalog-price__apply:hover { border-color: var(--brand); }
.catalog-price input[aria-invalid="true"] { border-color: var(--danger); }
.catalog-filter__note { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
.catalog-filter__error { margin: 0; color: var(--danger); font-size: var(--text-xs); line-height: 1.6; }
.catalog-switches { display: flex; flex-direction: column; gap: 12px; min-width: 0; margin: 0; padding: 16px 0 0; border: 0; border-top: 1px solid var(--line); }
.catalog-switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.catalog-switch label { flex: 1; color: var(--ink); font-size: var(--text-sm); cursor: pointer; }
/* 스위치: checkbox 를 그대로 쓰고 모양만 바꾼다(손잡이는 배경 원, 켜면 오른쪽으로). 고대비 모드에서는 기본 checkbox 로 돌아간다 */
.catalog-switch input { flex: none; width: 36px; height: 20px; margin: 0; border-radius: 10px; background: radial-gradient(circle, var(--ink) 0 7.5px, transparent 8px) 0 0 / 20px 20px no-repeat, var(--surface-3); cursor: pointer; transition: background-position .15s ease, background-color .15s ease; appearance: none; -webkit-appearance: none; }
.catalog-switch input:checked { background-color: var(--brand); background-position: 16px 0; }
.catalog-switch input:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (forced-colors: active) { .catalog-switch input { width: 18px; height: 18px; appearance: auto; -webkit-appearance: auto; } }
.catalog-filters__reset { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); font-size: var(--text-xs); font-weight: 600; cursor: pointer; }
.catalog-filters__reset:hover { border-color: var(--line-strong); color: var(--ink); }
.catalog-link-button { min-height: 32px; padding: 0; border: 0; background: transparent; color: var(--brand-strong); font-size: var(--text-sm); text-align: left; text-decoration: underline; text-underline-offset: 4px; cursor: pointer; }

/* 목록·상태 */
.catalog-results { grid-column: 2; min-width: 0; }
.catalog-empty { display: grid; justify-items: center; gap: 14px; padding: 48px 20px; border: 1px dashed var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--muted); font-size: var(--text-body); line-height: 1.7; text-align: center; word-break: keep-all; }
.catalog-empty p { margin: 0; }
.catalog-empty__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px 16px; }

@media (max-width: 1024px) { .catalog { grid-template-columns: 220px minmax(0, 1fr); } }
@media (max-width: 760px) {
  .catalog-page { gap: 22px; }
  .catalog-hero__card { padding: 24px 20px; }
  .catalog-hero__logo { right: 12px; width: 120px; height: 120px; }
  .catalog-stats { flex-basis: 100%; }
  .catalog { grid-template-columns: minmax(0, 1fr); }
  .catalog-bar, .catalog-toolbar, .catalog-filters, .catalog-results { grid-column: 1; grid-row: auto; }
  .catalog-search { flex: 1 1 100%; }
  .catalog-filter-toggle { display: inline-flex; align-items: center; }
  .catalog-filters { position: static; display: none; margin-bottom: 16px; }
  .catalog-filters--open { display: flex; }
}
@media (prefers-reduced-motion: reduce) { .catalog-switch input { transition: none; } }
</style>
