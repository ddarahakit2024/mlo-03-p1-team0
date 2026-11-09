<script setup>
import { computed, onMounted, ref } from 'vue'
import { addCartItem } from '../api/cartApi.js'
import { fetchProduct } from '../api/productApi.js'
import { PriceSparkline, SiteLayout } from '../components/index.js'
import { CART_TOASTS, cartAddFailureToast } from '../stores/cartViewModel.js'
import {
  COMPARE_MESSAGES, COMPARE_PATH, MAX_COMPARE_ITEMS, browserCompareStorage, compareRows, compareViewProps, createCompareBox, getComparePageState, readCompareQuery, removedNotice,
} from '../stores/compareViewModel.js'
import { PRODUCT_PLACEHOLDER, categoryName, getProductImage, productError, productPath } from '../stores/productViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { track } from '../stores/tracking.js'

// 부품 비교 화면(/compare, spec docs/specs/2026-11-01-event-enrichment.md "화면").
// 비교함(localStorage)의 상품마다 GET /products/{id} 를 함께 부른다(최대 4개). 404 는 그 상품을 비교함에서 빼고 안내하고,
// 그 밖의 실패가 하나라도 있으면 오류 + 다시 시도. 받은 뒤 compare_view 를 한 번 남긴다.
// 표(table, 자기 영역 안에서만 가로 스크롤, 항목 칸은 왼쪽에 붙어 있다): 열 = 상품(사진·브랜드 · 카테고리·이름 링크·× 빼기),
// 행 = 가격(가장 저렴)·30일 추이(추세선 + 변동률)·1년 최저 대비·타몰 비교·평점·성능 점수·가성비 지수·출시일·specs 합집합("—"),
// 마지막 줄은 열마다 "장바구니 담기"(POST /cart/items 1개 → 헤더 수량·토스트). 배지는 글자("가장 저렴"·"최고").
// 주소에 ?ids=3,5 가 있으면(공유 링크) 그 상품들로 비교함을 채운 뒤 주소를 /compare 로 바꾼다.
// 비교 화면에서는 비교함 막대(트레이)를 두지 않는다: 빼기는 열의 ×, 비우기는 "모두 비우기".
const compareState = ref(null)
const compareBox = createCompareBox({
  storage: browserCompareStorage(),
  track,
  onChange: ({ state }) => {
    compareState.value = state
    siteStatus.setCompareCount(state.items.length)
  },
})
compareState.value = compareBox.state()
let linkIds = readCompareQuery(window.location.search)

const products = ref([])
// 비교할 상품이 있으면 처음부터 로딩으로 그린다(빈 비교함 안내가 잠깐 보이지 않게)
const loading = ref(targetIds().length > 0)
const error = ref('')
const removedCount = ref(0)
const brokenImages = ref([])
// 장바구니에 담는 중인 상품 id. 한 번에 하나만 보낸다
const adding = ref(null)
// 담기에서 로그인이 필요했을 때 표 위에 남기는 로그인 링크(토스트는 잠깐 보이고 사라진다)
const addNeedsLogin = ref(false)
const pageState = computed(() => getComparePageState({ loading: loading.value, error: error.value, products: products.value }))
const rows = computed(() => compareRows(products.value))
const category = computed(() => products.value[0]?.category || '')
const notice = computed(() => removedNotice(removedCount.value))
const canClear = computed(() => !loading.value && (products.value.length > 0 || compareState.value.items.length > 0))
let requestId = 0

function image(product) {
  return brokenImages.value.includes(product.id) ? PRODUCT_PLACEHOLDER : getProductImage(product)
}

function markBroken(product) {
  if (!brokenImages.value.includes(product.id)) brokenImages.value = [...brokenImages.value, product.id]
}

// 공유 링크로 연 경우 한 번만 그 id 를 쓰고, 그 뒤(다시 시도 포함)에는 비교함을 쓴다
function targetIds() {
  return linkIds || compareState.value.items.map((item) => item.id)
}

async function loadProducts() {
  const request = ++requestId
  const fromLink = Boolean(linkIds)
  const ids = targetIds()
  error.value = ''
  if (!ids.length) {
    products.value = []
    loading.value = false
    return
  }
  loading.value = true
  const results = await Promise.allSettled(ids.map((id) => fetchProduct(id)))
  if (request !== requestId) return
  const failure = results.find((result) => result.status === 'rejected' && result.reason?.response?.status !== 404)
  if (failure) {
    error.value = productError(failure.reason, COMPARE_MESSAGES.error)
    loading.value = false
    return
  }
  const found = results.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value)
  const missing = ids.filter((id) => !found.some((product) => product.id === id))
  if (fromLink) {
    linkIds = null
    window.history?.replaceState?.({}, '', COMPARE_PATH)
  } else {
    for (const id of missing) compareBox.remove(id, { source: 'compare', reason: 'unavailable' })
  }
  // 비교함 항목(이름·사진·카테고리)을 서버 값으로 맞춘다. 비교함을 쓸 수 없는 브라우저(공유 링크)는 받은 상품을 그대로 보여 준다
  compareBox.refresh(found)
  products.value = compareBox.available ? found.filter((product) => compareBox.has(product.id)) : found
  removedCount.value = missing.length
  loading.value = false
  if (products.value.length) track('compare_view', compareViewProps(products.value))
}

function removeProduct(productId) {
  compareBox.remove(productId, { source: 'compare' })
  products.value = products.value.filter((product) => product.id !== productId)
}

// 진행 중인 불러오기 결과는 버리고 빈 비교함 안내로 바꾼다
function clearAll() {
  requestId += 1
  linkIds = null
  compareBox.clear()
  products.value = []
  error.value = ''
  removedCount.value = 0
  loading.value = false
}

// 열의 "장바구니 담기": 1개를 담는다. 성공하면 헤더 수량을 서버 값으로 맞추고 토스트, 실패는 토스트(401 은 로그인 안내 + 링크)
async function addToCart(product) {
  if (adding.value) return
  adding.value = product.id
  addNeedsLogin.value = false
  try {
    const cart = await addCartItem({ productId: product.id, quantity: 1 })
    siteStatus.setCartCount(cart?.item_count)
    siteStatus.showToast(CART_TOASTS.added)
    const line = cart?.items?.find((item) => item.product_id === product.id)
    track('add_to_cart', { product_id: product.id, quantity: 1, price_krw: line?.price_krw ?? product.price_krw })
  } catch (failure) {
    addNeedsLogin.value = failure?.response?.status === 401
    siteStatus.showToast(cartAddFailureToast(failure))
  } finally {
    adding.value = null
  }
}

onMounted(loadProducts)
</script>

<template>
  <SiteLayout active-page="compare">
    <div class="shop-page">
      <section class="compare-page" aria-labelledby="compare-title" :aria-busy="loading">
        <header class="compare-page__head">
          <div class="compare-page__intro">
            <h1 id="compare-title">부품 비교</h1>
            <p>최대 {{ MAX_COMPARE_ITEMS }}개까지 나란히 비교할 수 있어요. 가장 저렴한 가격과 하락 중인 부품은 초록색으로 표시돼요.</p>
          </div>
          <div v-if="canClear" class="compare-page__tools">
            <p v-if="pageState === 'ready'" class="compare-page__count">{{ categoryName(category) }} {{ products.length }}개를 비교합니다.</p>
            <button class="compare-page__clear" type="button" @click="clearAll">모두 비우기</button>
          </div>
        </header>
        <p v-if="notice && pageState !== 'loading'" class="shop-message compare-page__notice" role="status">{{ notice }}</p>

        <p v-if="pageState === 'loading'" class="shop-state" role="status">{{ COMPARE_MESSAGES.loading }}</p>
        <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
          <p>{{ error }}</p>
          <button class="shop-button shop-button--secondary" type="button" @click="loadProducts">다시 시도</button>
        </div>
        <div v-else-if="pageState === 'empty'" class="compare-empty">
          <p>비교할 부품이 없어요. 상품 카드의 <b>+ 비교</b> 버튼으로 담아 보세요.</p>
          <a class="shop-button" href="/products">상품 보러 가기</a>
        </div>
        <template v-else>
          <p v-if="products.length === 1" class="compare-page__single">
            {{ COMPARE_MESSAGES.single }} <a class="shop-text-link" :href="`/products?category=${encodeURIComponent(category)}`">{{ categoryName(category) }} 더 보기</a>
          </p>
          <p v-if="addNeedsLogin" class="shop-message compare-page__login">
            로그인하면 장바구니에 담을 수 있어요.<a href="/login">로그인</a>
          </p>
          <div class="compare-table-wrap" role="region" aria-label="부품 비교표" tabindex="0">
            <table class="compare-table" :style="{ '--compare-columns': products.length }">
              <caption class="sr-only">{{ categoryName(category) }} 부품 비교표. 열은 상품, 행은 가격·30일 추이·1년 최저 대비·타몰 비교·평점·성능 점수·가성비 지수·출시일·상세 사양입니다.</caption>
              <thead>
                <tr>
                  <th class="compare-table__corner" scope="col"><span class="sr-only">항목</span></th>
                  <th v-for="product in products" :key="product.id" class="compare-table__product" scope="col">
                    <a class="compare-table__image" :href="productPath(product.id)" tabindex="-1" aria-hidden="true"><img :src="image(product)" alt="" loading="lazy" @error="markBroken(product)" /></a>
                    <p class="compare-table__meta">{{ product.brand || '브랜드 미상' }} · {{ categoryName(product.category) }}</p>
                    <a class="compare-table__name" :href="productPath(product.id)">{{ product.name || '상품' }}</a>
                    <button class="compare-table__remove" type="button" title="비교에서 빼기" :aria-label="`${product.name || '상품'} 비교함에서 빼기`" @click="removeProduct(product.id)"><span aria-hidden="true">×</span></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.key" :class="`compare-row compare-row--${row.key.startsWith('spec-') ? 'spec' : row.key}`">
                  <th scope="row">{{ row.label }}</th>
                  <td v-for="(cell, index) in row.cells" :key="products[index].id">
                    <div class="compare-cell">
                      <span v-if="cell.values" class="compare-cell__spark"><PriceSparkline :values="cell.values" :change-pct="cell.changePct" /></span>
                      <span class="compare-cell__text" :class="{ [`compare-cell__text--${cell.tone}`]: cell.tone, 'compare-cell__text--missing': cell.missing }">{{ cell.text }}</span>
                      <span v-if="cell.note" class="compare-cell__note">({{ cell.note }})</span>
                      <b v-if="cell.badge" class="compare-badge" :class="{ 'compare-badge--good': cell.tone === 'good' }">{{ cell.badge }}</b>
                      <span v-if="cell.sub" class="compare-cell__sub">{{ cell.sub }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row"><span class="sr-only">장바구니</span></th>
                  <td v-for="product in products" :key="product.id">
                    <button class="shop-button compare-table__cart" type="button" :disabled="Boolean(adding)" :aria-busy="adding === product.id" @click="addToCart(product)">
                      {{ adding === product.id ? '담는 중...' : '장바구니 담기' }}<span class="sr-only">: {{ product.name || '상품' }}</span>
                    </button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p class="compare-page__note">가격·추이·최저가·타몰 비교는 지금 판매 정보 기준입니다. "가장 저렴"·"최고"는 이 비교표 안에서 가장 좋은 값입니다.</p>
        </template>
      </section>
    </div>
  </SiteLayout>
</template>

<style scoped>
.compare-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; min-width: 0; }
.compare-page__head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
.compare-page__intro { min-width: 0; }
.compare-page__intro h1 { margin: 0; color: var(--ink); font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
.compare-page__intro p { margin: 6px 0 0; color: var(--muted); font-size: var(--text-body); line-height: 1.6; word-break: keep-all; }
.compare-page__tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.compare-page__count { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.compare-page__clear { min-height: 38px; padding: 0 14px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.compare-page__clear:hover { border-color: var(--line-strong); color: var(--ink); }
.compare-page__notice, .compare-page__login { margin: 0; }
.compare-page__single { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0; padding: 12px 14px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--ink); font-size: var(--text-sm); line-height: 1.7; }
.compare-page__note { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.7; }
.compare-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 20px; border: 1px dashed var(--line); border-radius: var(--radius-md); background: var(--surface); text-align: center; }
.compare-empty p { margin: 0; color: var(--ink); font-size: 15px; line-height: 1.6; word-break: keep-all; }
.compare-empty b { color: var(--ink); font-weight: 800; }

/* 표는 자기 영역 안에서만 가로로 넘긴다(375px 에서 페이지 가로 스크롤 없음). 항목 칸은 왼쪽에 붙어 있다 */
/* position: relative 로 안쪽 절대 위치 요소(.sr-only 등)도 이 상자 안에서 잘리게 한다(없으면 375px 화면이 가로로 넓어진다) */
.compare-table-wrap { position: relative; min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.compare-table-wrap:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.compare-table { width: 100%; min-width: max(600px, calc(130px + var(--compare-columns, 2) * 180px)); border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: var(--text-sm); }
.compare-table th, .compare-table td { padding: 14px 16px; border-bottom: 1px solid var(--line); color: var(--ink); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.compare-table tr > * + * { border-left: 1px solid var(--line); }
.compare-table tfoot th, .compare-table tfoot td { padding: 16px; border-bottom: 0; }
.compare-table th[scope="row"], .compare-table__corner { position: sticky; z-index: 1; left: 0; width: 130px; background: var(--surface); color: var(--muted); font-size: var(--text-sm); font-weight: 500; }
.compare-table__corner { padding: 16px; }
.compare-table__product { position: relative; padding: 16px; font-weight: 400; }
.compare-table__image { display: grid; place-items: center; height: 72px; margin: 0 34px 10px 0; overflow: hidden; border-radius: var(--radius-sm); background: var(--image-bg); }
.compare-table__image img { display: block; width: 100%; height: 100%; padding: 6px; object-fit: contain; }
.compare-table__meta { margin: 0 0 10px; color: var(--muted); font-size: var(--text-xs); font-weight: 500; }
.compare-table__name { display: block; color: var(--ink); font-size: var(--text-body); font-weight: 700; line-height: 1.35; text-decoration: none; }
.compare-table__name:hover { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.compare-table__remove { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: var(--surface-3); color: var(--ink); font-size: 15px; line-height: 1; cursor: pointer; }
.compare-table__remove:hover { background: var(--danger); color: var(--bg); }
.compare-table__cart { width: 100%; min-height: 42px; font-size: var(--text-body); }

.compare-cell { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; min-width: 0; }
.compare-cell__text { font-size: var(--text-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
.compare-cell__text--good { color: var(--success); }
.compare-cell__text--bad { color: var(--danger); }
.compare-cell__text--warn { color: var(--warning); }
.compare-cell__text--missing { color: var(--muted); font-weight: 400; }
.compare-cell__note { color: var(--muted); font-size: var(--text-sm); }
.compare-cell__sub { flex-basis: 100%; margin-top: 2px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.compare-cell__spark { display: block; flex: none; align-self: center; width: 90px; }
.compare-row--price .compare-cell { flex-direction: column; align-items: flex-start; gap: 2px; }
.compare-row--price .compare-cell__text:not(.compare-cell__text--missing) { font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
.compare-row--trend .compare-cell { flex-wrap: nowrap; align-items: center; gap: 10px; }
.compare-row--trend .compare-cell__text { font-weight: 700; white-space: nowrap; }
.compare-row--rating .compare-cell__text, .compare-row--spec .compare-cell__text, .compare-row--performance .compare-cell__text, .compare-row--value .compare-cell__text, .compare-row--released .compare-cell__text { font-size: var(--text-body); }
.compare-row--spec th, .compare-row--spec td { padding-top: 12px; padding-bottom: 12px; }
.compare-badge { display: inline-flex; align-items: center; padding: 2px 8px; border: 1px solid var(--brand-line); border-radius: 999px; background: var(--brand-soft); color: var(--brand-strong); font-size: 11px; font-weight: 700; white-space: nowrap; }
.compare-row--price .compare-badge { padding: 0; border: 0; background: none; }
.compare-badge--good { border-color: var(--success); background: var(--success-soft); color: var(--success); }
.compare-page :is(a, button):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (max-width: 760px) {
  .compare-page__intro h1 { font-size: 22px; }
  .compare-page__head { align-items: flex-start; }
  .compare-table { min-width: calc(96px + var(--compare-columns, 2) * 168px); }
  .compare-table th, .compare-table td { padding: 12px; }
  .compare-table th[scope="row"], .compare-table__corner { width: 96px; font-size: var(--text-xs); }
  .compare-row--price .compare-cell__text:not(.compare-cell__text--missing) { font-size: 17px; }
  .compare-row--trend .compare-cell { flex-wrap: wrap; gap: 4px; }
  .compare-cell__spark { width: 72px; }
}
</style>
