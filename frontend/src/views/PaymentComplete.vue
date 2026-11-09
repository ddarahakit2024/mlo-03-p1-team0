<script setup>
import { computed, onMounted, ref } from 'vue'
import { confirmOrder } from '../api/orderApi.js'
import { SiteLayout } from '../components/index.js'
import { canRetryConfirm, confirmError, confirmedPaymentResult, getPaymentResultView, initialPaymentState, orderPath, paymentFailureDetail, paymentWindowResult, readPaymentRedirect } from '../stores/orderViewModel.js'
import { track } from '../stores/tracking.js'

// PortOne 이 모바일 결제 후 돌려보내는 주소(?paymentId=&code=&message=). 결제를 서버에서 확인(POST /orders/confirm)한다.
const redirect = readPaymentRedirect(window.location.search)
const state = ref(initialPaymentState(redirect))
const order = ref(null)
const error = ref('')
const failureStatus = ref(null)
const retryable = ref(false)
const view = computed(() => getPaymentResultView(state.value))
const message = computed(() => {
  if (state.value === 'cancelled') return redirect.failureMessage || view.value.message
  if (state.value === 'failed') return error.value
  return view.value.message
})
const needsLogin = computed(() => state.value === 'failed' && failureStatus.value === 401)
const canRetry = computed(() => state.value === 'failed' && retryable.value)
// 결제창 취소·결제 정보 없음·결제 미완료(409)는 장바구니에서 다시 주문하도록 안내한다
const showCartLink = computed(() => ['cancelled', 'missing'].includes(state.value) || (state.value === 'failed' && failureStatus.value === 409))
const detailPath = computed(() => orderPath(order.value?.payment_id || redirect.paymentId))
let confirming = false

async function confirmPayment() {
  if (confirming || !redirect.paymentId) return
  confirming = true
  state.value = 'confirming'
  error.value = ''
  failureStatus.value = null
  try {
    order.value = await confirmOrder(redirect.paymentId)
    track('payment_result', { payment_id: order.value?.payment_id || redirect.paymentId, result: confirmedPaymentResult(order.value) })
    state.value = 'paid'
  } catch (failure) {
    track('payment_result', { payment_id: redirect.paymentId, result: 'failed', ...paymentFailureDetail(failure) })
    error.value = confirmError(failure)
    retryable.value = canRetryConfirm(failure)
    failureStatus.value = failure?.response?.status ?? null
    state.value = 'failed'
  } finally {
    confirming = false
  }
}

// 결제창이 취소·실패(?code=)로 돌려보낸 경우도 결제 결과 이벤트를 남긴다(결제 정보가 없는 주소는 남기지 않는다)
onMounted(() => {
  if (state.value === 'cancelled') {
    track('payment_result', {
      payment_id: redirect.paymentId || null,
      result: paymentWindowResult({ code: redirect.failureCode, message: redirect.failureMessage }),
      error_code: redirect.failureCode,
    })
  }
  if (state.value === 'confirming') confirmPayment()
})
</script>

<template>
  <SiteLayout active-page="orders">
    <section class="payment-result" :class="{ 'payment-result--error': view.failed }" aria-labelledby="payment-result-title">
      <span class="payment-result__mark" aria-hidden="true">{{ view.mark }}</span>
      <h1 id="payment-result-title">{{ view.heading }}</h1>
      <p v-if="state === 'confirming'" class="payment-result__message" role="status">결제 결과를 확인하고 있습니다...</p>
      <p v-else-if="state === 'paid'" class="payment-result__message" role="status">결제가 확인되었습니다. 주문 상세에서 주문한 상품과 배송지를 확인할 수 있습니다.</p>
      <p v-else class="payment-result__message" role="alert">{{ message }}</p>
      <p v-if="state === 'paid' && order?.order_name" class="payment-result__order">{{ order.order_name }}</p>
      <p v-if="canRetry" class="payment-result__help">결제가 이미 끝났다면 다시 시도해도 중복으로 결제되지 않습니다.</p>
      <div v-if="state !== 'confirming'" class="payment-result__actions">
        <a v-if="state === 'paid'" class="shop-button" :href="detailPath">주문 상세 보기</a>
        <button v-if="canRetry" class="shop-button" type="button" @click="confirmPayment">다시 시도</button>
        <a v-if="needsLogin" class="shop-button shop-button--secondary" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
        <a v-if="showCartLink" class="shop-button" :class="{ 'shop-button--secondary': state === 'failed' }" href="/cart">장바구니로</a>
        <a v-if="state !== 'cancelled'" class="shop-button" :class="{ 'shop-button--secondary': state === 'paid' || canRetry || state === 'missing' }" href="/orders">{{ state === 'paid' ? '주문 내역' : '주문 내역 보기' }}</a>
      </div>
    </section>
  </SiteLayout>
</template>

<style scoped>
.payment-result { display: grid; justify-items: center; width: min(540px, 100%); margin: clamp(55px, 12vh, 120px) auto 30px; padding: 42px 28px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); text-align: center; word-break: keep-all; }
.payment-result__mark { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 50%; background: var(--brand-soft); color: var(--brand); font-size: 23px; font-weight: 800; }
.payment-result--error .payment-result__mark { background: var(--danger-soft); color: var(--danger); }
.payment-result h1 { margin: 9px 0; color: var(--ink); font-size: 24px; letter-spacing: -.8px; overflow-wrap: anywhere; }
.payment-result__message { max-width: 38ch; margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.7; overflow-wrap: anywhere; }
.payment-result--error .payment-result__message { color: var(--danger); }
.payment-result__order { max-width: 100%; margin: 14px 0 0; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font-size: var(--text-sm); font-weight: 700; overflow-wrap: anywhere; }
.payment-result__help { max-width: 38ch; margin: 10px 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
.payment-result__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 23px; }
.payment-result :is(a, button):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (max-width: 640px) { .payment-result { padding: 34px 18px; } }
</style>
