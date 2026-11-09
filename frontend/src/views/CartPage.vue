<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchCart, removeCartItem, updateCartItem } from '../api/cartApi.js'
import { checkCompatibility } from '../api/compatibilityApi.js'
import { CompatibilityPanel, ProductQuantitySelect, SiteLayout } from '../components/index.js'
import {
  CART_QUOTE_PATH, LOGIN_REQUIRED_MESSAGE, canCheckout, cartBuildSource, cartError, cartStockWarning, checkoutPath, externalSavingText, getCartPageState, priceChangeLine, steppedQuantity,
} from '../stores/cartViewModel.js'
import { compatibilityEventProps, compatibilityItems, compatibilityKey, shouldCheckCompatibility } from '../stores/compatibilityViewModel.js'
import { storeLine } from '../stores/priceTrendViewModel.js'
import { categoryName, formatPrice, getProductImage, maxOrderQuantity, productPath } from '../stores/productViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { MAX_PROP_LIST_LENGTH, track } from '../stores/tracking.js'

// 장바구니(/cart). 줄마다 사진·카테고리 · 브랜드·이름 링크·담은 뒤 가격 변동(서버 price_change_krw)·수량(−/선택/+)·삭제·소계,
// 요약에 상품 수·배송비·타몰 최저가 대비(서버 external_saving_krw, 0 이면 숨김)·총 결제 금액·주문하기·"이 구성으로 견적 의견 받기".
// 금액은 모두 서버 값이다. 장바구니 응답을 받을 때마다 헤더의 장바구니 수량(siteStatus)을 item_count 로 맞춘다.
const cart = ref(null)
const loading = ref(true)
const error = ref('')
const needsLogin = ref(false)
// 진행 중인 변경: { productId, action: 'update' | 'remove', quantity }. 한 번에 하나만 보낸다
const busy = ref(null)
const actionError = ref('')
const actionNeedsLogin = ref(false)
const pageState = computed(() => getCartPageState({ loading: loading.value, needsLogin: needsLogin.value, error: error.value, cart: cart.value }))
const orderable = computed(() => canCheckout(cart.value))
const savingText = computed(() => externalSavingText(cart.value))
// 부품 호환성(상품 목록 아래 보조 영역). state: ''(카테고리가 1개뿐이라 보여 주지 않음) | 'loading' | 'ready' | 'error'.
// 실패해도 장바구니와 주문하기는 그대로다. 늦게 온 이전 응답은 버리고, 같은 구성의 결과는 이벤트를 한 번만 남긴다
const compatibility = ref({ state: '', result: null })
let compatibilityRequest = 0
let cartRequest = 0
const trackedCompositions = new Set()

function applyCart(next) {
  cart.value = next
  siteStatus.setCartCount(next?.item_count ?? 0)
}

async function loadCart() {
  const request = ++cartRequest
  loading.value = true
  error.value = ''
  needsLogin.value = false
  try {
    const next = await fetchCart()
    if (request !== cartRequest) return
    applyCart(next)
    track('cart_view', { item_count: cart.value?.item_count ?? 0, total_krw: cart.value?.total_krw ?? 0, product_ids: (cart.value?.items || []).slice(0, MAX_PROP_LIST_LENGTH).map((item) => item.product_id) })
    checkCartCompatibility()
  } catch (failure) {
    if (request !== cartRequest) return
    needsLogin.value = failure?.response?.status === 401
    if (!needsLogin.value) error.value = cartError(failure, '장바구니를 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === cartRequest) loading.value = false
  }
}

// 장바구니를 받은 뒤·수량 변경·삭제 뒤에 부른다. 카테고리가 2개 이상일 때만 확인한다
async function checkCartCompatibility() {
  const request = ++compatibilityRequest
  const lines = cart.value?.items || []
  if (!shouldCheckCompatibility(lines)) {
    compatibility.value = { state: '', result: null }
    return
  }
  const items = compatibilityItems(lines)
  compatibility.value = { state: 'loading', result: null }
  try {
    const result = await checkCompatibility(items)
    if (request !== compatibilityRequest) return
    compatibility.value = { state: 'ready', result }
    const key = compatibilityKey(items)
    if (!trackedCompositions.has(key)) {
      trackedCompositions.add(key)
      track('compatibility_check', compatibilityEventProps('cart', items, result))
    }
  } catch {
    if (request === compatibilityRequest) compatibility.value = { state: 'error', result: null }
  }
}

function isBusy(item, action) {
  return busy.value?.productId === item.product_id && busy.value.action === action
}

// 서버 응답 전에는 고른 수량을, 실패하면 원래 수량을 보여 준다
function shownQuantity(item) {
  return isBusy(item, 'update') ? busy.value.quantity : item.quantity
}

// −/+ 가 보낼 수량(진행 중이면 막는다)
function stepTarget(item, delta) {
  return busy.value ? null : steppedQuantity(item, delta)
}

// 성공하면 true. 이벤트는 성공했을 때만 남긴다
async function runAction(next, request, fallback) {
  if (busy.value) return false
  busy.value = next
  actionError.value = ''
  actionNeedsLogin.value = false
  try {
    applyCart(await request())
    checkCartCompatibility()
    return true
  } catch (failure) {
    const status = failure?.response?.status
    actionNeedsLogin.value = status === 401
    actionError.value = cartError(failure, fallback)
    if (status === 404) {
      busy.value = null
      await loadCart() // 이미 장바구니에 없는 상품: 목록을 서버와 다시 맞춘다
    }
    return false
  } finally {
    busy.value = null
  }
}

// 바뀐 수량은 서버가 돌려준 장바구니의 값을 쓴다(없으면 고른 수량)
async function changeQuantity(item, quantity) {
  if (quantity == null || quantity === item.quantity) return
  const done = await runAction({ productId: item.product_id, action: 'update', quantity }, () => updateCartItem(item.product_id, { quantity }), '수량을 바꾸지 못했습니다. 다시 시도해 주세요.')
  if (!done) return
  const line = cart.value?.items?.find((row) => row.product_id === item.product_id)
  track('cart_update', { product_id: item.product_id, from_quantity: item.quantity, to_quantity: line?.quantity ?? quantity })
}

function stepQuantity(item, delta) {
  return changeQuantity(item, stepTarget(item, delta))
}

async function removeItem(item) {
  const done = await runAction({ productId: item.product_id, action: 'remove' }, () => removeCartItem(item.product_id), '상품을 삭제하지 못했습니다. 다시 시도해 주세요.')
  if (done) track('cart_remove', { product_id: item.product_id, quantity: item.quantity })
}

onMounted(loadCart)
</script>

<template>
  <SiteLayout active-page="cart">
    <section class="shop-page cart-page" aria-labelledby="cart-title">
      <header class="cart-head">
        <h1 id="cart-title" class="cart-title">장바구니</h1>
        <p>담은 뒤 가격이 바뀌면 알려드려요. 결제 금액은 지금 가격 기준이에요.</p>
      </header>
      <p v-if="pageState === 'loading'" class="shop-state" role="status">장바구니를 불러오는 중입니다...</p>
      <div v-else-if="pageState === 'guest'" class="shop-state cart-panel">
        <h2>{{ LOGIN_REQUIRED_MESSAGE }}</h2><p>로그인하면 담아 둔 상품을 어느 기기에서나 볼 수 있습니다.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="loadCart">로그인 상태 다시 확인</button></div>
      </div>
      <div v-else-if="pageState === 'error'" class="shop-state cart-panel" role="alert">
        <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadCart">다시 시도</button>
      </div>
      <div v-else-if="pageState === 'empty'" class="cart-empty">
        <h2>장바구니가 비어 있어요.</h2>
        <a class="shop-button" href="/products">상품 보러 가기</a>
      </div>
      <div v-else class="cart-layout">
        <div class="cart-list">
          <p v-if="actionError" class="shop-message shop-message--error" role="alert">
            {{ actionError }}<a v-if="actionNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
          </p>
          <ul class="cart-items">
            <li v-for="item in cart.items" :key="item.product_id" class="cart-item" :aria-busy="busy?.productId === item.product_id">
              <!-- 시뮬레이터가 줄의 첫 링크를 상품 이름 링크로 읽으므로 이름 링크를 사진 링크보다 앞(DOM)에 두고, 사진은 grid 로 왼쪽에 놓는다 -->
              <div class="cart-item__info">
                <p class="cart-item__meta">{{ categoryName(item.category) }} · {{ item.brand }}</p>
                <a class="cart-item__name" :href="productPath(item.product_id)">{{ item.name }}</a>
                <p v-if="priceChangeLine(item)" class="cart-item__change" :class="`cart-item__change--${priceChangeLine(item).tone}`">
                  <span v-if="priceChangeLine(item).arrow" class="cart-item__arrow" aria-hidden="true">{{ priceChangeLine(item).arrow }}</span>{{ priceChangeLine(item).text }}
                </p>
                <p v-if="storeLine(item.price_trend)" class="cart-item__store" :class="`cart-item__store--${storeLine(item.price_trend).tone}`">{{ storeLine(item.price_trend).text }}</p>
                <p v-if="cartStockWarning(item)" class="cart-item__warning">{{ cartStockWarning(item) }}</p>
                <!-- 견적에서 담은 줄(item.build). 시뮬레이터가 줄의 첫 링크를 상품 링크로 읽으므로 상품 이름 링크 뒤에 둔다 -->
                <p v-if="cartBuildSource(item)" class="cart-item__build">
                  <a v-if="cartBuildSource(item).href" class="cart-item__build-link" :href="cartBuildSource(item).href">{{ cartBuildSource(item).label }}<span class="sr-only"> · 견적 글 보기</span></a>
                  <span v-else class="cart-item__build-label">{{ cartBuildSource(item).label }}</span>
                </p>
              </div>
              <a class="cart-item__image" :href="productPath(item.product_id)" tabindex="-1" aria-hidden="true"><img :src="getProductImage(item)" alt="" loading="lazy" /></a>
              <div class="cart-item__side">
                <p class="cart-item__subtotal"><span class="sr-only">소계 </span>{{ formatPrice(item.subtotal_krw) }}</p>
                <p class="cart-item__price">개당 {{ formatPrice(item.price_krw) }}</p>
                <div class="cart-item__controls">
                  <div class="cart-stepper">
                    <button class="cart-stepper__button" type="button" :aria-label="`수량 줄이기: ${item.name}`" :disabled="stepTarget(item, -1) === null" @click="stepQuantity(item, -1)"><span aria-hidden="true">−</span></button>
                    <ProductQuantitySelect :id="`cart-quantity-${item.product_id}`" class="cart-stepper__select" :model-value="shownQuantity(item)" :max="maxOrderQuantity(item.stock)" :label="`${item.name} 수량`" hide-label :disabled="Boolean(busy)" @update:model-value="changeQuantity(item, $event)" />
                    <button class="cart-stepper__button" type="button" :aria-label="`수량 늘리기: ${item.name}`" :disabled="stepTarget(item, 1) === null" @click="stepQuantity(item, 1)"><span aria-hidden="true">+</span></button>
                  </div>
                  <button class="cart-item__remove" type="button" :disabled="Boolean(busy)" @click="removeItem(item)">{{ isBusy(item, 'remove') ? '삭제 중...' : '삭제' }}<span class="sr-only">: {{ item.name }}</span></button>
                </div>
              </div>
              <p v-if="isBusy(item, 'update')" class="cart-item__progress" role="status">수량을 바꾸는 중입니다...</p>
            </li>
          </ul>
          <CompatibilityPanel v-if="compatibility.state" class="cart-compat" :state="compatibility.state" :result="compatibility.result" context="cart" @retry="checkCartCompatibility" />
        </div>
        <aside class="cart-summary" aria-labelledby="cart-summary-title">
          <h2 id="cart-summary-title">결제 금액</h2>
          <dl>
            <div><dt>상품 {{ cart.item_count }}개</dt><dd>{{ formatPrice(cart.total_krw) }}</dd></div>
            <div><dt>배송비</dt><dd class="cart-summary__good">무료</dd></div>
            <div v-if="savingText"><dt>타몰 최저가 대비</dt><dd class="cart-summary__good">{{ savingText }}</dd></div>
            <div class="cart-summary__total"><dt>총 결제 금액</dt><dd>{{ formatPrice(cart.total_krw) }}</dd></div>
          </dl>
          <a v-if="orderable && !busy" class="shop-button cart-summary__order" :href="checkoutPath()">주문하기</a>
          <button v-else class="shop-button cart-summary__order" type="button" disabled>주문하기</button>
          <p v-if="!orderable" class="cart-summary__help">품절되었거나 재고보다 많이 담은 상품을 정리하면 주문할 수 있습니다.</p>
          <a class="shop-button shop-button--secondary cart-summary__quote" :href="CART_QUOTE_PATH">이 구성으로 견적 의견 받기</a>
          <p class="cart-summary__note">장바구니에 담긴 부품 가격은 매일 자정 갱신돼요. 내려가면 알림을 보내드립니다.</p>
        </aside>
      </div>
    </section>
  </SiteLayout>
</template>

<style scoped>
.cart-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.cart-head { min-width: 0; }
.cart-title { margin: 0; color: var(--ink); font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
.cart-head p { margin: 6px 0 0; color: var(--muted); font-size: var(--text-body); line-height: 1.6; word-break: keep-all; }
.cart-panel { border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.cart-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 20px; border: 1px dashed var(--line); border-radius: var(--radius-md); background: var(--surface); text-align: center; }
.cart-empty h2 { margin: 0; color: var(--ink); font-size: 15px; font-weight: 500; }
.cart-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; align-items: start; gap: 20px; }
.cart-list { display: grid; gap: 10px; min-width: 0; }
.cart-items { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }

/* 줄 카드: 사진 | 정보 | 소계·수량·삭제. DOM 순서는 정보(이름 링크) → 사진 → 오른쪽(시뮬레이터 규칙) */
.cart-item { display: grid; grid-template-columns: 84px minmax(0, 1fr) auto; grid-template-areas: "image info side" "progress progress progress"; align-items: start; gap: 0 14px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.cart-item__image { grid-area: image; display: grid; place-items: center; width: 84px; height: 84px; overflow: hidden; border-radius: 12px; background: var(--image-bg); }
.cart-item__image img { display: block; width: 100%; height: 100%; padding: 6px; object-fit: contain; }
.cart-item__info { grid-area: info; display: grid; gap: 6px; align-content: start; min-width: 0; }
.cart-item__info p { margin: 0; }
.cart-item__meta { color: var(--muted); font-size: var(--text-xs); }
.cart-item__name { color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.35; text-decoration: none; overflow-wrap: anywhere; }
.cart-item__name:hover { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.cart-item__change, .cart-item__store { font-size: var(--text-xs); line-height: 1.5; font-variant-numeric: tabular-nums; }
.cart-item__arrow { margin-right: 4px; }
.cart-item__change--down, .cart-item__store--good { color: var(--success); }
.cart-item__change--up { color: var(--danger); }
.cart-item__change--flat { color: var(--muted); }
.cart-item__store--warn { color: var(--warning); }
.cart-item__warning { color: var(--danger); font-size: var(--text-xs); font-weight: 650; }
.cart-item__build { margin-top: 2px; }
.cart-item__build-link, .cart-item__build-label { display: inline-flex; align-items: center; min-height: 26px; padding: 2px 10px; border: 1px solid var(--brand-line); border-radius: 999px; background: var(--brand-soft); color: var(--brand); font-size: var(--text-xs); font-weight: 700; line-height: 1.4; }
.cart-item__build-link { text-decoration: none; }
/* 견적 글이 없는(post_id null) 표시는 누를 수 없으니 링크와 다르게 흐린 배지로 둔다 */
.cart-item__build-label { border-color: var(--line-strong); background: var(--surface-2); color: var(--muted); }
.cart-item__build-link:hover { text-decoration: underline; }
.cart-item__build-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.cart-item__side { grid-area: side; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; }
.cart-item__subtotal { margin: 0; color: var(--ink); font-size: 18px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.cart-item__price { margin: -6px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; font-variant-numeric: tabular-nums; }
.cart-item__controls { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.cart-stepper { display: flex; align-items: stretch; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; }
.cart-stepper__button { display: grid; place-items: center; width: 36px; min-height: 36px; padding: 0; border: 0; background: transparent; color: var(--ink); font-size: 16px; line-height: 1; cursor: pointer; }
.cart-stepper__button:hover:not(:disabled) { background: var(--surface-3); }
.cart-stepper__button:disabled { color: var(--muted); opacity: .45; cursor: not-allowed; }
.cart-stepper .cart-stepper__select :deep(select) { min-width: 64px; min-height: 36px; padding: 0 6px; border: 0; border-inline: 1px solid var(--line); border-radius: 0; background: transparent; font-weight: 700; text-align: center; text-align-last: center; font-variant-numeric: tabular-nums; }
.cart-item__remove { min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--muted); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.cart-item__remove:hover:not(:disabled) { color: var(--danger); text-decoration: underline; text-underline-offset: 3px; }
.cart-item__remove:disabled { opacity: .5; cursor: wait; }
.cart-item__progress { grid-area: progress; margin: 10px 0 0; color: var(--brand); font-size: var(--text-xs); text-align: right; }
.cart-compat { margin-top: 10px; }
.cart-item :is(a, button, select):focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

.cart-summary { position: sticky; top: 88px; display: grid; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.cart-summary h2 { margin: 0; color: var(--ink); font-size: 17px; font-weight: 800; }
.cart-summary dl { display: grid; gap: 14px; margin: 0; }
.cart-summary dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--ink); font-size: var(--text-body); }
.cart-summary dt { color: var(--ink); }
.cart-summary dd { margin: 0; color: var(--ink); text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.cart-summary .cart-summary__good { color: var(--success); }
.cart-summary .cart-summary__total { padding-top: 14px; border-top: 1px solid var(--line); }
.cart-summary__total dt { font-weight: 700; }
.cart-summary__total dd { font-size: 24px; font-weight: 800; letter-spacing: -.01em; }
.cart-summary__order { width: 100%; min-height: 48px; font-size: 15px; font-weight: 800; }
.cart-summary__quote { width: 100%; min-height: 42px; }
.cart-summary__quote:hover { color: var(--brand-strong); }
.cart-summary__help { margin: 0; color: var(--danger); font-size: var(--text-xs); line-height: 1.6; }
.cart-summary__note { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; word-break: keep-all; }
.cart-summary :is(a, button):focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 860px) { .cart-layout { grid-template-columns: minmax(0, 1fr); } .cart-summary { position: static; } }
@media (max-width: 640px) {
  .cart-title { font-size: 22px; }
  .cart-item { grid-template-columns: 72px minmax(0, 1fr); grid-template-areas: "image info" "side side" "progress progress"; gap: 12px; }
  .cart-item__image { width: 72px; height: 72px; }
  .cart-item__side { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "subtotal controls" "price controls"; align-items: center; gap: 0 12px; padding-top: 12px; border-top: 1px solid var(--line); }
  .cart-item__subtotal { grid-area: subtotal; font-size: 16px; text-align: left; }
  .cart-item__price { grid-area: price; margin: 0; text-align: left; }
  .cart-item__controls { grid-area: controls; flex-direction: row; align-items: center; gap: 4px; }
}
</style>
