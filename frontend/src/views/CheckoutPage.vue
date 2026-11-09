<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { fetchCart } from '../api/cartApi.js'
import { confirmOrder, createOrder } from '../api/orderApi.js'
import { launchPortOnePayment } from '../api/portonePayment.js'
import { fetchProduct } from '../api/productApi.js'
import { SiteLayout } from '../components/index.js'
import { authSession } from '../stores/authSession.js'
import { LOGIN_REQUIRED_MESSAGE } from '../stores/cartViewModel.js'
import { SHIPPING_LIMITS, buyNowSummary, canRetryConfirm, checkoutProblem, confirmError, confirmedPaymentResult, emptyShipping, getCheckoutPageState, goToOrder, isMockPayment, isPaymentFailed, orderError, orderLines, paymentFailureDetail, paymentFailureMessage, paymentWindowResult, readCheckoutQuery, validateShippingFields } from '../stores/orderViewModel.js'
import { categoryName, formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { MAX_PROP_LIST_LENGTH, track } from '../stores/tracking.js'

// 주소 query 로 장바구니 전체(/checkout)인지 바로 구매(/checkout?product=&quantity=)인지 정한다. 바로 구매는 장바구니를 건드리지 않는다.
const request = readCheckoutQuery(window.location.search)
const buyNow = request.mode === 'buy-now'
const SHIPPING_FIELDS = [
  { key: 'recipientName', id: 'shipping-recipient', label: '받는 분', required: true, type: 'text', autocomplete: 'name', maxlength: SHIPPING_LIMITS.recipientName, placeholder: '예: 홍길동' },
  { key: 'phone', id: 'shipping-phone', label: '연락처', required: true, type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 13, placeholder: '010-1234-5678' },
  { key: 'postalCode', id: 'shipping-postal-code', label: '우편번호', required: true, type: 'text', autocomplete: 'postal-code', inputmode: 'numeric', maxlength: 5, placeholder: '예: 06236' },
  { key: 'address1', id: 'shipping-address1', label: '주소', required: true, type: 'text', autocomplete: 'address-line1', maxlength: SHIPPING_LIMITS.address1, placeholder: '예: 서울특별시 강남구 테헤란로 123' },
  { key: 'address2', id: 'shipping-address2', label: '상세 주소', required: false, type: 'text', autocomplete: 'address-line2', maxlength: SHIPPING_LIMITS.address2, placeholder: '예: 4층 401호' },
  { key: 'deliveryMemo', id: 'shipping-memo', label: '배송 메모', required: false, type: 'text', autocomplete: 'off', maxlength: SHIPPING_LIMITS.deliveryMemo, placeholder: '예: 부재 시 문 앞에 놓아 주세요.' },
]

const summary = ref(null)
const loading = ref(true)
const loadError = ref('')
const needsLogin = ref(false)
const missing = ref(false)
const shipping = reactive(emptyShipping())
// 처음 결제하기를 누른 뒤부터 입력 칸마다 오류를 보여 주고, 고치면 바로 사라진다
const showFieldErrors = ref(false)
const fieldErrors = computed(() => (showFieldErrors.value ? validateShippingFields(shipping) : {}))
const shippingInvalid = computed(() => Object.keys(fieldErrors.value).length > 0)
const paying = ref(false)
const payError = ref('')
const payNeedsLogin = ref(false)
// 주문서에서 고칠 수 없는 오류(재고 부족·없는 상품)는 고칠 곳으로 가는 링크를 준다
const payFix = ref(null)
// 결제는 끝났는데 확인(POST /orders/confirm)에 실패한 주문. 새로 결제하지 않고 이 주문의 확인만 다시 한다
const pendingPaymentId = ref('')
const problem = computed(() => checkoutProblem(summary.value, { buyNow }))
const pageState = computed(() => getCheckoutPageState({
  invalid: request.mode === 'invalid', loading: loading.value, needsLogin: needsLogin.value, missing: missing.value,
  error: loadError.value, summary: summary.value, problem: problem.value,
}))
const fixPath = computed(() => (buyNow ? productPath(request.productId) : '/cart'))

// recheck: "다시 시도"·"로그인 상태 다시 확인"으로 부르면 로그인 상태도 다시 확인한다(처음에는 공용 상태를 그대로 쓴다)
async function loadCheckout(recheck = false) {
  if (request.mode === 'invalid') {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ''
  needsLogin.value = false
  missing.value = false
  try {
    if (buyNow) {
      // 상품 조회는 로그인 없이 되므로 로그인 여부를 먼저 확인한다. 비로그인(401)·오류는 원래 오류로 아래에서 나눈다
      const auth = await (recheck ? authSession.refresh() : authSession.load())
      if (auth.status !== 'member') throw auth.error || { response: { status: 401 } }
      summary.value = buyNowSummary(await fetchProduct(request.productId), request.quantity)
    } else {
      summary.value = await fetchCart()
      siteStatus.setCartCount(summary.value?.item_count ?? 0) // 헤더의 장바구니 수량을 서버 값으로 맞춘다
    }
    track('checkout_view', {
      source: buyNow ? 'buy_now' : 'cart', item_count: summary.value?.item_count ?? 0, total_krw: summary.value?.total_krw ?? 0,
      product_ids: (summary.value?.items || []).slice(0, MAX_PROP_LIST_LENGTH).map((item) => item.product_id),
    })
  } catch (failure) {
    const status = failure?.response?.status
    needsLogin.value = status === 401
    missing.value = buyNow && status === 404
    if (!needsLogin.value && !missing.value) {
      loadError.value = orderError(failure, buyNow ? '주문할 상품을 불러오지 못했습니다. 다시 시도해 주세요.' : '장바구니를 불러오지 못했습니다. 다시 시도해 주세요.')
    }
  } finally {
    loading.value = false
  }
}

function failPayment(message, { login = false, fix = null } = {}) {
  payError.value = message
  payNeedsLogin.value = login
  payFix.value = fix
  paying.value = false
}

async function confirmPayment(paymentId) {
  try {
    const order = await confirmOrder(paymentId)
    track('payment_result', { payment_id: order?.payment_id || paymentId, result: confirmedPaymentResult(order) })
    pendingPaymentId.value = ''
    goToOrder(order?.payment_id || paymentId) // 이동하는 동안 paying 을 풀지 않아 다시 누를 수 없다
  } catch (failure) {
    track('payment_result', { payment_id: paymentId, result: 'failed', ...paymentFailureDetail(failure) })
    pendingPaymentId.value = canRetryConfirm(failure) ? paymentId : ''
    failPayment(confirmError(failure), { login: failure?.response?.status === 401 })
  }
}

async function pay() {
  if (paying.value || pendingPaymentId.value) return
  showFieldErrors.value = true
  if (shippingInvalid.value) {
    failPayment('')
    return
  }
  paying.value = true
  payError.value = ''
  payNeedsLogin.value = false
  payFix.value = null
  let order
  try {
    order = await createOrder({ items: orderLines(summary.value), shipping: { ...shipping } })
  } catch (failure) {
    const status = failure?.response?.status
    const fix = [404, 409].includes(status) ? { href: fixPath.value, label: buyNow ? '상품 페이지에서 확인하기' : '장바구니에서 수량 조정하기' } : null
    failPayment(orderError(failure, '주문을 만들지 못했습니다. 입력한 내용은 그대로 있으니 다시 시도해 주세요.'), { login: status === 401, fix })
    return
  }
  // 결제창을 열기(모의 결제는 확인하기) 직전. 금액은 POST /orders 응답의 total_amount, 수량은 주문서(서버 장바구니·상품)의 item_count
  track('payment_start', { payment_id: order.payment_id, total_amount: order.total_amount, item_count: summary.value?.item_count ?? 0 })
  // 모의 결제(provider 'mock', 시뮬레이션 계정 전용)는 PortOne 결제창 없이 바로 확인한다. 확인 실패 처리는 PortOne 과 같다
  if (isMockPayment(order)) {
    await confirmPayment(order.payment_id)
    return
  }
  let payment
  try {
    payment = await launchPortOnePayment(order)
  } catch (failure) {
    track('payment_result', { payment_id: order.payment_id, result: 'failed', ...paymentFailureDetail(failure) })
    failPayment('결제창을 열지 못했습니다. 잠시 후 다시 결제하기를 눌러 주세요.')
    return
  }
  if (isPaymentFailed(payment)) {
    track('payment_result', { payment_id: order.payment_id, result: paymentWindowResult(payment), error_code: payment.code })
    failPayment(paymentFailureMessage(payment))
    return
  }
  await confirmPayment(order.payment_id)
}

async function retryConfirm() {
  if (paying.value || !pendingPaymentId.value) return
  paying.value = true
  payError.value = ''
  payNeedsLogin.value = false
  await confirmPayment(pendingPaymentId.value)
}

function describedBy(field) {
  return fieldErrors.value[field.key] ? `${field.id}-error` : undefined
}

onMounted(() => loadCheckout())
</script>

<template>
  <SiteLayout active-page="cart">
    <section class="shop-page" aria-labelledby="checkout-title">
      <h1 id="checkout-title" class="checkout-title">주문서</h1>
      <section v-if="pageState === 'invalid'" class="shop-state" role="alert">
        <h2>올바르지 않은 주문 주소입니다.</h2><p>상품 페이지에서 수량을 고른 뒤 바로 구매를 다시 눌러 주세요.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/products">상품 보러 가기</a><a class="shop-button shop-button--secondary" href="/cart">장바구니로</a></div>
      </section>
      <p v-else-if="pageState === 'loading'" class="shop-state" role="status">주문할 상품을 불러오는 중입니다...</p>
      <div v-else-if="pageState === 'guest'" class="shop-state">
        <h2>{{ LOGIN_REQUIRED_MESSAGE }}</h2><p>로그인하면 담아 둔 상품을 주문하고 결제할 수 있습니다.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="loadCheckout(true)">로그인 상태 다시 확인</button></div>
      </div>
      <section v-else-if="pageState === 'missing'" class="shop-state" role="alert">
        <h2>주문할 상품을 찾을 수 없습니다.</h2><p>판매가 끝났거나 주소가 바뀌었을 수 있습니다. 상품 목록에서 다시 찾아 주세요.</p><a class="shop-button" href="/products">상품 목록 보기</a>
      </section>
      <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
        <p>{{ loadError }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadCheckout(true)">다시 시도</button>
      </div>
      <div v-else-if="pageState === 'empty'" class="shop-state">
        <h2>주문할 상품이 없습니다.</h2><p>장바구니에 상품을 담은 뒤 주문해 주세요.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/cart">장바구니로</a><a class="shop-button shop-button--secondary" href="/products">상품 보러 가기</a></div>
      </div>
      <section v-else-if="pageState === 'unavailable'" class="shop-state" role="alert">
        <h2>{{ buyNow ? '주문할 수 없는 상품입니다.' : '주문할 수 없는 상품이 있습니다.' }}</h2><p>{{ problem }}</p>
        <div class="shop-state__actions"><a class="shop-button" :href="fixPath">{{ buyNow ? '상품 페이지로' : '장바구니로' }}</a><a class="shop-button shop-button--secondary" href="/products">상품 목록 보기</a></div>
      </section>
      <form v-else class="checkout-layout" :aria-busy="paying" novalidate @submit.prevent="pay">
        <div class="checkout-main">
          <section class="checkout-section" aria-labelledby="checkout-items-title">
            <h2 id="checkout-items-title" class="checkout-section__title">주문 상품 <span>{{ summary.items.length }}종</span></h2>
            <ul class="checkout-items">
              <li v-for="item in summary.items" :key="item.product_id" class="checkout-item">
                <img class="checkout-item__image" :src="getProductImage(item)" alt="" loading="lazy" />
                <div class="checkout-item__info">
                  <p class="checkout-item__meta">{{ categoryName(item.category) }} · {{ item.brand }}</p>
                  <a class="checkout-item__name" :href="productPath(item.product_id)">{{ item.name }}</a>
                  <p class="checkout-item__price">{{ formatPrice(item.price_krw) }} · {{ item.quantity }}개</p>
                </div>
                <p class="checkout-item__subtotal"><span class="sr-only">소계 </span>{{ formatPrice(item.subtotal_krw) }}</p>
              </li>
            </ul>
          </section>
          <section class="checkout-section" aria-labelledby="checkout-shipping-title">
            <h2 id="checkout-shipping-title" class="checkout-section__title">배송지</h2>
            <p class="checkout-help">필수 표시가 있는 칸은 꼭 입력해 주세요. 우편번호는 숫자 5자리로 직접 입력합니다.</p>
            <fieldset class="checkout-fields" :disabled="paying || Boolean(pendingPaymentId)">
              <legend class="sr-only">배송지 입력</legend>
              <div v-for="field in SHIPPING_FIELDS" :key="field.key" class="checkout-field" :class="`checkout-field--${field.key}`">
                <label :for="field.id">{{ field.label }} <span :class="field.required ? 'checkout-field__required' : 'checkout-field__optional'">{{ field.required ? '필수' : '선택' }}</span></label>
                <input :id="field.id" v-model="shipping[field.key]" :type="field.type" :autocomplete="field.autocomplete" :inputmode="field.inputmode" :maxlength="field.maxlength" :placeholder="field.placeholder" :required="field.required" :aria-invalid="fieldErrors[field.key] ? 'true' : undefined" :aria-describedby="describedBy(field)" />
                <p v-if="fieldErrors[field.key]" :id="`${field.id}-error`" class="checkout-field__error">{{ fieldErrors[field.key] }}</p>
              </div>
            </fieldset>
          </section>
        </div>
        <aside class="checkout-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title">결제 금액</h2>
          <dl>
            <div><dt>상품 수량</dt><dd>{{ summary.item_count }}개</dd></div>
            <div><dt>배송비</dt><dd>무료</dd></div>
            <div class="checkout-summary__total"><dt>총 결제 금액</dt><dd>{{ formatPrice(summary.total_krw) }}</dd></div>
          </dl>
          <p v-if="buyNow" class="checkout-summary__note">결제 금액은 주문할 때 현재 판매 가격으로 다시 확인합니다.</p>
          <p v-if="paying" class="checkout-summary__progress" role="status">결제를 진행하는 중입니다...</p>
          <p v-if="shippingInvalid" class="shop-message shop-message--error" role="alert">배송지에 고칠 칸이 있습니다. 칸 아래의 안내를 따라 고쳐 주세요.</p>
          <p v-if="payError" class="shop-message shop-message--error" role="alert">
            {{ payError }}<a v-if="payNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a><a v-else-if="payFix" :href="payFix.href">{{ payFix.label }}</a>
          </p>
          <template v-if="pendingPaymentId">
            <p class="checkout-summary__note">결제가 이미 끝났다면 다시 시도해도 중복으로 결제되지 않습니다.</p>
            <button class="shop-button checkout-summary__pay" type="button" :disabled="paying" :aria-busy="paying" @click="retryConfirm">{{ paying ? '결제 확인 중...' : '결제 확인 다시 시도' }}</button>
            <a class="shop-text-link checkout-summary__orders" href="/orders">주문 내역 보기</a>
          </template>
          <button v-else class="shop-button checkout-summary__pay" type="submit" :disabled="paying" :aria-busy="paying">{{ paying ? '결제 진행 중...' : '결제하기' }}</button>
        </aside>
      </form>
    </section>
  </SiteLayout>
</template>

<style scoped>
.checkout-title { margin: 0 0 20px; color: var(--ink); font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
.checkout-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; align-items: start; gap: 20px; }
.checkout-main { display: grid; gap: 20px; min-width: 0; }
/* 주문 상품·배송지는 장바구니 줄 카드와 같은 표면(카드) */
.checkout-main > section { min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.checkout-section__title { margin: 0 0 14px; color: var(--ink); font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
.checkout-section__title span { margin-left: 6px; color: var(--muted); font-size: var(--text-sm); font-weight: 600; }
.checkout-items { margin: 0; padding: 0; list-style: none; }
.checkout-item { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 0; border-top: 1px solid var(--line); }
.checkout-item:first-child { padding-top: 0; border-top: 0; }
.checkout-item:last-child { padding-bottom: 0; }
.checkout-item__image { width: 64px; height: 64px; padding: 4px; border-radius: var(--radius-sm); background: var(--image-bg); object-fit: contain; }
.checkout-item__info { display: grid; gap: 4px; min-width: 0; }
.checkout-item__meta { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.checkout-item__name { color: var(--ink); font-size: var(--text-body); font-weight: 700; line-height: 1.4; text-decoration: none; overflow-wrap: anywhere; }
.checkout-item__name:hover { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.checkout-item__price { margin: 0; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.checkout-item__subtotal { margin: 0; color: var(--ink); font-size: 16px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-help { margin: 0 0 16px; color: var(--muted); font-size: var(--text-xs); line-height: 1.7; word-break: keep-all; }
/* 배송지 칸 묶음: 카드 안이라 따로 테두리를 두지 않는다 */
.checkout-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-width: 0; margin: 0; padding: 0; border: 0; }
.checkout-fields:disabled { opacity: .7; }
.checkout-field { display: grid; gap: 7px; min-width: 0; }
.checkout-field--address1, .checkout-field--address2, .checkout-field--deliveryMemo { grid-column: 1 / -1; }
.checkout-field label { color: var(--ink); font-size: var(--text-sm); font-weight: 700; }
.checkout-field__required, .checkout-field__optional { margin-left: 4px; font-size: var(--text-xs); font-weight: 650; }
.checkout-field__required { color: var(--brand); }
.checkout-field__optional { color: var(--muted); font-weight: 500; }
.checkout-field input { width: 100%; min-height: 44px; padding: 10px 13px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-body); }
.checkout-field input:hover:not(:disabled) { border-color: var(--muted); }
.checkout-field input:focus-visible { border-color: var(--brand); outline: 3px solid var(--focus); outline-offset: 1px; }
.checkout-field input[aria-invalid="true"] { border-color: var(--danger); background: var(--danger-soft); }
.checkout-field input:disabled { background: var(--surface); cursor: wait; }
.checkout-field__error { margin: 0; color: var(--danger); font-size: var(--text-xs); line-height: 1.6; word-break: keep-all; }
/* 결제 요약: 장바구니 요약 카드와 같은 모양(데스크톱에서 따라 내려온다) */
.checkout-summary { position: sticky; top: 88px; display: grid; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.checkout-summary h2 { margin: 0; color: var(--ink); font-size: 17px; font-weight: 800; }
.checkout-summary dl { display: grid; gap: 14px; margin: 0; }
.checkout-summary dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--ink); font-size: var(--text-body); }
.checkout-summary dd { margin: 0; color: var(--ink); text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.checkout-summary .checkout-summary__total { padding-top: 14px; border-top: 1px solid var(--line); }
.checkout-summary__total dt { font-weight: 700; }
.checkout-summary__total dd { font-size: 24px; font-weight: 800; letter-spacing: -.01em; }
.checkout-summary__note { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; word-break: keep-all; }
.checkout-summary__progress { margin: 0; color: var(--brand); font-size: var(--text-sm); font-weight: 650; }
.checkout-summary__pay { width: 100%; min-height: 48px; font-size: 15px; font-weight: 800; }
.checkout-summary__orders { justify-self: center; }
.checkout-summary :is(a, button):focus-visible, .checkout-item__name:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 860px) { .checkout-layout { grid-template-columns: minmax(0, 1fr); } .checkout-summary { position: static; } }
@media (max-width: 640px) {
  .checkout-title { font-size: 22px; }
  .checkout-main > section { padding: 16px; }
  .checkout-fields { grid-template-columns: minmax(0, 1fr); }
  .checkout-item { grid-template-columns: 56px minmax(0, 1fr); gap: 8px 12px; }
  .checkout-item__image { width: 56px; height: 56px; align-self: start; }
  .checkout-item__subtotal { grid-column: 2; text-align: left; }
}
</style>
