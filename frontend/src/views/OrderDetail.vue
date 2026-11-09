<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { confirmOrder, createReturn, fetchOrder, withdrawReturn } from '../api/orderApi.js'
import { InlineConfirm, SiteLayout } from '../components/index.js'
import { LOGIN_REQUIRED_MESSAGE } from '../stores/cartViewModel.js'
import { canRetryConfirm, confirmError, confirmedPaymentResult, formatOrderDateTime, getOrderPageState, getOrderStatus, orderError, paymentFailureDetail } from '../stores/orderViewModel.js'
import { formatPrice, productPath } from '../stores/productViewModel.js'
import {
  CHANGED_MIND_NOTICE, MAX_RETURN_DETAIL_LENGTH, RETURN_REASONS, currentTime, formatReturnDeadline, getReturnFormState, returnError, returnLines,
  returnQuantityOptions, returnReasonName, returnRequestEventProps, returnSelection, returnStatus, selectedReturnQuantity, textLength, upsertReturn, validateReturnRequest,
} from '../stores/returnViewModel.js'
import { track } from '../stores/tracking.js'

// 경로 해석(resolveOrderRoute)이 형식이 틀린 주문 번호를 null 로 준다
const props = defineProps({ paymentId: { type: String, default: null } })
const order = ref(null)
const loading = ref(true)
const error = ref('')
const missing = ref(false)
const needsLogin = ref(false)
const invalid = computed(() => !props.paymentId)
const pageState = computed(() => getOrderPageState({
  invalid: invalid.value, loading: loading.value, needsLogin: needsLogin.value, missing: missing.value, error: error.value, order: order.value, detail: true,
}))
const status = computed(() => getOrderStatus(order.value?.status))
// 결제 대기(READY) 주문의 결제 확인(POST /orders/confirm). 서버가 멱등이라 다시 눌러도 중복 결제되지 않는다
const confirming = ref(false)
const confirmMessage = ref('')
const confirmFailed = ref(false)
const confirmNeedsLogin = ref(false)

// 반품(spec docs/specs/2026-11-01-returns-refunds.md). 신청 가능 수량(returnable)·기한(return_deadline)·환불 금액은 서버 값을 그대로 쓴다.
// 신청서는 PAID 이고 returnable 이 있고 기한 전일 때만 보인다. 시뮬레이터가 상품 표(table) 안의 링크를 읽으므로 반품 영역에는 표·상품 링크를 두지 않는다
const returnFormState = computed(() => getReturnFormState(order.value, currentTime()))
const returnFormLines = computed(() => returnLines(order.value))
const returnDeadlineText = computed(() => formatReturnDeadline(order.value?.return_deadline))
const returns = computed(() => (Array.isArray(order.value?.returns) ? order.value.returns : []))
const returnQuantities = reactive({})
const returnReason = ref('')
const returnDetail = ref('')
const returnSubmitting = ref(false)
const returnFormError = ref('')
const returnNeedsLogin = ref(false)
const returnResult = ref('')
const selectedQuantity = computed(() => selectedReturnQuantity(returnQuantities, returnFormLines.value))
// 반품 내역의 신청 철회(화면 안 확인 InlineConfirm)
const withdrawTarget = ref(null)
const withdrawing = ref(false)
const withdrawMessage = ref('')
const withdrawFailed = ref(false)
const withdrawNeedsLogin = ref(false)

async function loadOrder() {
  if (invalid.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  missing.value = false
  needsLogin.value = false
  try {
    order.value = await fetchOrder(props.paymentId)
    track('order_view', { payment_id: order.value?.payment_id || props.paymentId, status: order.value?.status ?? null, total_krw: order.value?.total_krw ?? null, item_count: order.value?.item_count ?? null })
  } catch (failure) {
    const code = failure?.response?.status
    needsLogin.value = code === 401
    missing.value = code === 404
    if (!needsLogin.value && !missing.value) error.value = orderError(failure, '주문 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    loading.value = false
  }
}

// 404·409(결제 미완료·취소됨·재고 부족으로 취소함)는 주문 상태가 바뀌었을 수 있으므로 상세만 조용히 다시 부른다
async function refreshOrder() {
  try {
    order.value = await fetchOrder(props.paymentId)
  } catch {
    // 상세를 다시 부르지 못하면 지금 화면과 안내 문구를 그대로 둔다
  }
}

async function confirmPayment() {
  if (confirming.value || order.value?.status !== 'READY') return
  confirming.value = true
  confirmMessage.value = ''
  confirmFailed.value = false
  confirmNeedsLogin.value = false
  try {
    const paymentId = order.value.payment_id
    order.value = await confirmOrder(paymentId)
    track('payment_result', { payment_id: order.value?.payment_id || paymentId, result: confirmedPaymentResult(order.value) })
    confirmMessage.value = order.value?.status === 'PAID' ? '결제가 확인되었습니다.' : ''
  } catch (failure) {
    track('payment_result', { payment_id: order.value?.payment_id || props.paymentId, result: 'failed', ...paymentFailureDetail(failure) })
    confirmFailed.value = true
    confirmNeedsLogin.value = failure?.response?.status === 401
    confirmMessage.value = confirmError(failure)
    if (!canRetryConfirm(failure)) await refreshOrder()
  } finally {
    confirming.value = false
  }
}

function setReturnQuantity(productId, value) {
  returnQuantities[productId] = Number(value) || 0
}

function resetReturnForm() {
  for (const key of Object.keys(returnQuantities)) delete returnQuantities[key]
  returnReason.value = ''
  returnDetail.value = ''
}

// 반품 신청(POST /orders/{payment_id}/returns). 저장 중에는 fieldset 과 버튼을 막아 한 번만 보내고, 실패해도 입력은 그대로 둔다.
// 성공하면 서버가 돌려준 신청(환불 금액 포함)을 내역에 더하고, 신청 가능 수량은 상세를 다시 불러 서버 값으로 바꾼다
async function submitReturn() {
  if (returnSubmitting.value || returnFormState.value !== 'open') return
  const request = { reason: returnReason.value, detail: returnDetail.value, items: returnSelection(returnQuantities, returnFormLines.value) }
  returnResult.value = ''
  returnNeedsLogin.value = false
  const problem = validateReturnRequest(request, returnFormLines.value)
  if (problem) {
    returnFormError.value = problem
    return
  }
  returnSubmitting.value = true
  returnFormError.value = ''
  try {
    const created = await createReturn(order.value.payment_id, request)
    order.value = { ...order.value, returns: upsertReturn(order.value.returns, created) }
    track('return_request', returnRequestEventProps(created, order.value))
    returnResult.value = `반품을 신청했습니다. 환불 예정 금액은 ${formatPrice(created?.refund_amount_krw)}이며, 관리자가 확인한 뒤 환불합니다.`
    resetReturnForm()
    await refreshOrder()
  } catch (failure) {
    const code = failure?.response?.status
    returnNeedsLogin.value = code === 401
    returnFormError.value = returnError(failure, '반품을 신청하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    // 409(기한 지남·신청 가능 수량 초과·PAID 아님)는 주문이 바뀌었을 수 있으니 상세만 조용히 다시 부른다(입력은 그대로 둔다)
    if (code === 409) await refreshOrder()
  } finally {
    returnSubmitting.value = false
  }
}

function askWithdraw(request) {
  if (withdrawing.value) return
  withdrawTarget.value = request.id
  withdrawMessage.value = ''
  withdrawFailed.value = false
  withdrawNeedsLogin.value = false
}

function cancelWithdraw() {
  if (!withdrawing.value) withdrawTarget.value = null
}

// 신청 철회(REQUESTED 만). 실패하면 확인 상자를 그대로 두고 오류를 보여 준다. 409·404 는 상태가 바뀐 것이라 상자를 닫고 상세를 다시 부른다
async function confirmWithdraw(request) {
  if (withdrawing.value) return
  withdrawing.value = true
  withdrawMessage.value = ''
  withdrawFailed.value = false
  withdrawNeedsLogin.value = false
  try {
    const updated = await withdrawReturn(order.value.payment_id, request.id)
    order.value = { ...order.value, returns: upsertReturn(order.value.returns, updated) }
    track('return_withdraw', { payment_id: updated?.payment_id || order.value.payment_id, return_id: updated?.id ?? request.id })
    withdrawTarget.value = null
    withdrawMessage.value = '반품 신청을 철회했습니다. 철회한 수량은 신청 기한 안에 다시 신청할 수 있습니다.'
    await refreshOrder()
  } catch (failure) {
    const code = failure?.response?.status
    withdrawFailed.value = true
    withdrawNeedsLogin.value = code === 401
    withdrawMessage.value = returnError(failure, '반품 신청을 철회하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    if (code === 409 || code === 404) {
      withdrawTarget.value = null
      await refreshOrder()
    }
  } finally {
    withdrawing.value = false
  }
}

onMounted(loadOrder)
</script>

<template>
  <SiteLayout active-page="orders">
    <div class="shop-page shop-page--narrow">
      <section v-if="pageState === 'invalid'" class="shop-state" role="alert">
        <h1>올바르지 않은 주문 주소입니다.</h1><p>주문 내역에서 확인할 주문을 다시 선택해 주세요.</p><a class="shop-button" href="/orders">주문 내역 보기</a>
      </section>
      <p v-else-if="pageState === 'loading'" class="shop-state" role="status">주문 정보를 불러오는 중입니다...</p>
      <div v-else-if="pageState === 'guest'" class="shop-state">
        <h1>{{ LOGIN_REQUIRED_MESSAGE }}</h1><p>주문할 때 사용한 계정으로 로그인하면 주문 정보를 확인할 수 있습니다.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="loadOrder">로그인 상태 다시 확인</button></div>
      </div>
      <section v-else-if="pageState === 'missing'" class="shop-state" role="alert">
        <h1>주문을 찾을 수 없습니다.</h1><p>주문 번호를 확인하거나, 주문할 때 사용한 계정으로 로그인했는지 확인해 주세요.</p><a class="shop-button" href="/orders">주문 내역 보기</a>
      </section>
      <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
        <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadOrder">다시 시도</button>
      </div>
      <article v-else class="order-detail" aria-labelledby="order-title">
        <a class="shop-back" href="/orders">← 주문 내역</a>
        <header class="order-detail__header">
          <span class="shop-order-status" :class="{ 'shop-order-status--paid': status.tone === 'paid', 'shop-order-status--cancelled': status.tone === 'cancelled' }">{{ status.label }}</span>
          <h1 id="order-title">{{ order.order_name }}</h1>
          <p class="order-detail__number">주문 번호 <span>{{ order.payment_id }}</span></p>
        </header>
        <p v-if="order.status === 'CANCELLED'" class="shop-message shop-message--error">취소된 주문입니다. 결제 금액은 자동으로 환불됩니다.</p>
        <div v-else-if="order.status === 'READY'" class="order-detail__confirm">
          <p class="shop-message">결제가 아직 확인되지 않은 주문입니다. 결제를 마쳤다면 결제 확인을 눌러 주세요.</p>
          <div class="order-detail__confirm-actions">
            <button class="shop-button" type="button" :disabled="confirming" :aria-busy="confirming" @click="confirmPayment">{{ confirming ? '결제 확인 중...' : '결제 확인' }}</button>
            <span>결제를 이미 마쳤다면 여러 번 눌러도 중복으로 결제되지 않습니다.</span>
          </div>
        </div>
        <p v-if="confirmMessage" class="shop-message order-detail__confirm-result" :class="{ 'shop-message--error': confirmFailed }" :role="confirmFailed ? 'alert' : 'status'">
          {{ confirmMessage }}<a v-if="confirmNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
        </p>
        <dl class="order-detail__dates">
          <div><dt>주문일</dt><dd><time :datetime="order.created_at">{{ formatOrderDateTime(order.created_at) }}</time></dd></div>
          <div v-if="order.paid_at"><dt>결제일</dt><dd><time :datetime="order.paid_at">{{ formatOrderDateTime(order.paid_at) }}</time></dd></div>
          <div v-if="order.cancelled_at"><dt>취소일</dt><dd><time :datetime="order.cancelled_at">{{ formatOrderDateTime(order.cancelled_at) }}</time></dd></div>
        </dl>
        <section class="order-detail__section" aria-labelledby="order-items-title">
          <h2 id="order-items-title">주문 상품 <span>{{ order.item_count }}개</span></h2>
          <table class="order-items">
            <caption class="sr-only">주문 당시 상품 이름, 단가, 수량, 소계</caption>
            <thead><tr><th scope="col">상품</th><th scope="col">단가</th><th scope="col">수량</th><th scope="col">소계</th></tr></thead>
            <tbody>
              <tr v-for="item in order.items" :key="item.product_id">
                <th scope="row"><a :href="productPath(item.product_id)">{{ item.product_name }}</a></th>
                <td data-label="단가">{{ formatPrice(item.unit_price_krw) }}</td>
                <td data-label="수량">{{ item.quantity }}개</td>
                <td data-label="소계">{{ formatPrice(item.subtotal_krw) }}</td>
              </tr>
            </tbody>
          </table>
          <dl class="order-detail__total">
            <div><dt>배송비</dt><dd>무료</dd></div>
            <div class="order-detail__total-amount"><dt>총 결제 금액</dt><dd>{{ formatPrice(order.total_krw) }}</dd></div>
          </dl>
        </section>
        <section v-if="returnFormState !== 'hidden'" class="order-detail__section order-return" aria-labelledby="order-return-title">
          <h2 id="order-return-title">반품 신청</h2>
          <p v-if="returnFormState === 'expired'" class="order-return__closed">
            반품 신청 기간이 지났습니다. 반품은 결제 후 7일 안에 신청할 수 있습니다.<span v-if="returnDeadlineText"> (신청 기한: {{ returnDeadlineText }})</span>
          </p>
          <form v-else class="order-return__form" :aria-busy="returnSubmitting" novalidate @submit.prevent="submitReturn">
            <p class="order-return__deadline">신청 기한 <time :datetime="order.return_deadline">{{ returnDeadlineText }}</time></p>
            <fieldset class="order-return__fieldset" :disabled="returnSubmitting">
              <legend class="sr-only">반품 신청서</legend>
              <div>
                <h3 id="order-return-items-title" class="order-return__label">반품할 상품과 수량</h3>
                <ul class="order-return__lines" aria-labelledby="order-return-items-title">
                  <li v-for="line in returnFormLines" :key="line.product_id" class="order-return__line">
                    <div class="order-return__product">
                      <label class="order-return__name" :for="`return-quantity-${line.product_id}`">{{ line.product_name }}<span class="sr-only"> 반품 수량</span></label>
                      <span :id="`return-quantity-${line.product_id}-help`" class="order-return__meta"><template v-if="line.unit_price_krw !== null">단가 {{ formatPrice(line.unit_price_krw) }} · </template>신청 가능 {{ line.quantity }}개</span>
                    </div>
                    <select
                      :id="`return-quantity-${line.product_id}`"
                      class="order-return__select"
                      :value="returnQuantities[line.product_id] || 0"
                      :aria-describedby="`return-quantity-${line.product_id}-help`"
                      @change="setReturnQuantity(line.product_id, $event.target.value)"
                    >
                      <option v-for="count in returnQuantityOptions(line.quantity)" :key="count" :value="count">{{ count }}개</option>
                    </select>
                  </li>
                </ul>
              </div>
              <fieldset class="order-return__reasons">
                <legend class="order-return__label">반품 사유</legend>
                <div class="order-return__reason-list">
                  <label v-for="reason in RETURN_REASONS" :key="reason.code" class="order-return__reason" :class="{ 'order-return__reason--checked': returnReason === reason.code }" :for="`return-reason-${reason.code}`">
                    <input :id="`return-reason-${reason.code}`" type="radio" name="return-reason" :value="reason.code" :checked="returnReason === reason.code" @change="returnReason = reason.code" />
                    <span>{{ reason.name }}</span>
                  </label>
                </div>
              </fieldset>
              <div class="order-return__field">
                <label class="order-return__label" for="return-detail">자세한 내용 <span>선택</span></label>
                <textarea id="return-detail" v-model="returnDetail" rows="3" :maxlength="MAX_RETURN_DETAIL_LENGTH" placeholder="어떤 문제가 있었는지 적어 주시면 확인이 빨라집니다." aria-describedby="return-detail-count"></textarea>
                <p id="return-detail-count" class="order-return__count">{{ textLength(returnDetail).toLocaleString('ko-KR') }} / 500</p>
              </div>
            </fieldset>
            <p class="shop-message order-return__notice">{{ CHANGED_MIND_NOTICE }}</p>
            <p v-if="returnFormError" class="shop-message shop-message--error" role="alert">
              {{ returnFormError }}<a v-if="returnNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
            </p>
            <div class="order-return__actions">
              <span class="order-return__selected" aria-live="polite">반품할 수량 {{ selectedQuantity }}개</span>
              <button class="shop-button" type="submit" :disabled="returnSubmitting || selectedQuantity === 0" :aria-busy="returnSubmitting">{{ returnSubmitting ? '저장 중...' : '반품 신청' }}</button>
            </div>
          </form>
        </section>
        <p v-if="returnResult" class="shop-message order-detail__return-result" role="status">{{ returnResult }}</p>
        <section v-if="returns.length" class="order-detail__section" aria-labelledby="order-return-history-title">
          <h2 id="order-return-history-title">반품 내역 <span>{{ returns.length }}건</span></h2>
          <p v-if="withdrawMessage" class="shop-message order-return-history__message" :class="{ 'shop-message--error': withdrawFailed }" :role="withdrawFailed ? 'alert' : 'status'">
            {{ withdrawMessage }}<a v-if="withdrawNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
          </p>
          <ol class="order-return-history">
            <li v-for="request in returns" :key="request.id" class="order-return-history__item">
              <div class="order-return-history__head">
                <span class="shop-order-status" :class="returnStatus(request.status).className">{{ returnStatus(request.status).label }}</span>
                <span class="order-return-history__date"><time :datetime="request.requested_at">{{ formatOrderDateTime(request.requested_at) }}</time> 신청</span>
              </div>
              <ul class="order-return-history__products">
                <li v-for="line in request.items" :key="line.product_id"><span>{{ line.product_name }}</span><span>{{ line.quantity }}개</span></li>
              </ul>
              <dl class="order-return-history__facts">
                <div><dt>사유</dt><dd>{{ returnReasonName(request.reason) }}</dd></div>
                <div v-if="request.detail"><dt>자세한 내용</dt><dd class="order-return-history__detail">{{ request.detail }}</dd></div>
                <div>
                  <dt>환불 금액</dt>
                  <dd>
                    <strong>{{ formatPrice(request.refund_amount_krw) }}</strong>
                    <span v-if="request.shipping_deduction_krw > 0" class="order-return-history__deduction"> (상품 {{ formatPrice(request.items_total_krw) }} − 왕복 배송비 {{ formatPrice(request.shipping_deduction_krw) }})</span>
                  </dd>
                </div>
                <div v-if="request.reject_reason"><dt>거절 사유</dt><dd>{{ request.reject_reason }}</dd></div>
                <div v-if="request.refunded_at"><dt>환불일</dt><dd><time :datetime="request.refunded_at">{{ formatOrderDateTime(request.refunded_at) }}</time></dd></div>
              </dl>
              <div v-if="request.status === 'REQUESTED'" class="order-return-history__actions">
                <InlineConfirm
                  v-if="withdrawTarget === request.id"
                  message="이 반품 신청을 철회할까요?"
                  confirm-label="철회"
                  busy-label="철회 중..."
                  :busy="withdrawing"
                  @confirm="confirmWithdraw(request)"
                  @cancel="cancelWithdraw"
                />
                <button v-else class="shop-button shop-button--secondary" type="button" :disabled="withdrawing" @click="askWithdraw(request)">신청 철회</button>
              </div>
            </li>
          </ol>
        </section>
        <section class="order-detail__section" aria-labelledby="order-shipping-title">
          <h2 id="order-shipping-title">배송지</h2>
          <dl class="order-shipping">
            <div><dt>받는 분</dt><dd>{{ order.shipping.recipient_name }}</dd></div>
            <div><dt>연락처</dt><dd>{{ order.shipping.phone }}</dd></div>
            <div><dt>주소</dt><dd>({{ order.shipping.postal_code }}) {{ order.shipping.address1 }} {{ order.shipping.address2 }}</dd></div>
            <div><dt>배송 메모</dt><dd>{{ order.shipping.delivery_memo || '없음' }}</dd></div>
          </dl>
        </section>
      </article>
    </div>
  </SiteLayout>
</template>

<style scoped>
.order-detail__header { display: grid; justify-items: start; gap: 10px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.order-detail__header h1 { margin: 0; color: var(--ink); font-size: clamp(22px, 3vw, 30px); line-height: 1.4; letter-spacing: -.8px; word-break: keep-all; overflow-wrap: anywhere; }
.order-detail__number { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.order-detail__number span { margin-left: 4px; color: var(--ink); font-family: var(--font-numeric); overflow-wrap: anywhere; }
.order-detail > .shop-message { margin-top: 18px; }
.order-detail__confirm { display: grid; gap: 12px; margin-top: 18px; }
.order-detail__confirm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
.order-detail > .order-detail__confirm-result { margin-top: 12px; }
.order-detail__dates { display: flex; flex-wrap: wrap; gap: 10px 32px; margin: 20px 0 0; font-size: var(--text-sm); }
.order-detail__dates div { display: flex; gap: 10px; }
.order-detail__dates dt { color: var(--muted); }
.order-detail__dates dd { margin: 0; color: var(--ink); font-weight: 650; }
.order-detail__section { margin-top: 0; min-width: 0; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.order-detail__section h2 { margin: 0 0 14px; color: var(--ink); font-size: 18px; letter-spacing: -.5px; }
.order-detail__section h2 span { margin-left: 6px; color: var(--muted); font-size: var(--text-sm); font-weight: 600; }
.order-items { width: 100%; border-collapse: collapse; border-top: 2px solid var(--line-strong); font-size: var(--text-sm); }
.order-items thead th { padding: 11px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--muted); font-size: var(--text-xs); font-weight: 650; text-align: right; }
.order-items thead th:first-child { text-align: left; }
.order-items tbody th, .order-items td { padding: 14px; border-bottom: 1px solid var(--line); color: var(--ink); text-align: right; vertical-align: top; }
.order-items tbody th { font-weight: 650; text-align: left; word-break: keep-all; overflow-wrap: anywhere; }
.order-items tbody th a { color: inherit; text-decoration: none; }
.order-items tbody th a:hover { color: var(--brand); text-decoration: underline; }
.order-items td { white-space: nowrap; }
.order-items td:last-child { font-weight: 800; }
.order-detail__total { display: grid; gap: 10px; width: min(320px, 100%); margin: 16px 0 0 auto; font-size: var(--text-sm); }
.order-detail__total div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--muted); }
.order-detail__total dd { margin: 0; color: var(--ink); font-weight: 650; }
.order-detail__total .order-detail__total-amount { padding-top: 12px; border-top: 1px solid var(--line); color: var(--ink); font-weight: 700; }
.order-detail__total-amount dd { color: var(--brand); font-size: 20px; font-weight: 800; }
.order-shipping { display: grid; margin: 0; border-top: 2px solid var(--line-strong); font-size: var(--text-sm); }
.order-shipping div { display: grid; grid-template-columns: 140px minmax(0, 1fr); border-bottom: 1px solid var(--line); }
.order-shipping dt { padding: 13px 16px; background: var(--surface-2); color: var(--muted); font-weight: 650; }
.order-shipping dd { margin: 0; padding: 13px 16px; color: var(--ink); line-height: 1.7; word-break: keep-all; overflow-wrap: anywhere; }
/* 반품 신청 */
.order-return__closed { margin: 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font-size: var(--text-sm); line-height: 1.7; word-break: keep-all; overflow-wrap: anywhere; }
.order-return__form { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.order-return__deadline { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.order-return__deadline time { margin-left: 6px; color: var(--ink); font-weight: 750; }
.order-return__fieldset { display: grid; gap: 22px; min-width: 0; margin: 0; padding: 0; border: 0; }
.order-return__fieldset:disabled { opacity: .7; }
.order-return__label { display: block; margin: 0 0 10px; padding: 0; color: var(--ink); font-size: var(--text-body); font-weight: 750; }
.order-return__label span { margin-left: 4px; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.order-return__lines { margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
.order-return__line { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 16px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.order-return__product { display: grid; gap: 4px; min-width: 0; }
.order-return__name { color: var(--ink); font-size: var(--text-body); font-weight: 650; line-height: 1.5; word-break: keep-all; overflow-wrap: anywhere; }
.order-return__meta { color: var(--muted); font-size: var(--text-xs); }
.order-return__select { min-width: 96px; min-height: 44px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-sm); }
.order-return__reasons { min-width: 0; margin: 0; padding: 0; border: 0; }
.order-return__reason-list { display: flex; flex-wrap: wrap; gap: 8px; }
.order-return__reason { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); color: var(--ink); font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.order-return__reason--checked { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 750; }
.order-return__reason input { margin: 0; accent-color: var(--brand); }
.order-return__field textarea { display: block; box-sizing: border-box; width: 100%; padding: 12px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-sm); line-height: 1.7; resize: vertical; }
.order-return__field textarea::placeholder { color: var(--muted); }
.order-return__field textarea:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.order-return__count { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }
.order-return__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px 16px; }
.order-return__selected { color: var(--muted); font-size: var(--text-sm); }
.order-detail > .order-detail__return-result { margin-top: 16px; }
/* 반품 내역 */
.order-return-history__message { margin-bottom: 12px; }
.order-return-history { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.order-return-history__item { display: grid; gap: 12px; padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.order-return-history__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.order-return-history__date { color: var(--muted); font-size: var(--text-xs); }
.order-return-history__products { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: var(--text-sm); }
.order-return-history__products li { display: flex; justify-content: space-between; gap: 12px; color: var(--ink); }
.order-return-history__products li span:first-child { min-width: 0; font-weight: 650; word-break: keep-all; overflow-wrap: anywhere; }
.order-return-history__products li span:last-child { flex-shrink: 0; color: var(--muted); }
.order-return-history__facts { display: grid; gap: 6px; margin: 0; padding-top: 12px; border-top: 1px solid var(--line); font-size: var(--text-sm); }
.order-return-history__facts div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; }
.order-return-history__facts dt { color: var(--muted); }
.order-return-history__facts dd { margin: 0; color: var(--ink); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.order-return-history__facts strong { color: var(--brand); font-weight: 800; }
.order-return-history__deduction { color: var(--muted); font-size: var(--text-xs); }
.order-return-history__detail { white-space: pre-line; }
.order-return-history__actions { display: flex; justify-content: flex-end; }
@media (max-width: 640px) {
  .order-return__form { padding: 16px 14px; }
  .order-return__actions .shop-button { flex: 1 1 100%; }
  .order-return-history__item { padding: 14px; }
  .order-return-history__facts div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .order-return-history__actions { justify-content: stretch; }
  .order-return-history__actions > * { flex: 1 1 100%; }
  .order-items thead { display: none; }
  .order-items tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; padding: 14px 4px; border-bottom: 1px solid var(--line); }
  .order-items tbody th, .order-items td { padding: 0; border-bottom: 0; text-align: left; white-space: normal; }
  .order-items tbody th { grid-column: 1 / -1; font-size: var(--text-body); }
  .order-items td::before { content: attr(data-label); display: block; color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
  .order-shipping div { grid-template-columns: minmax(0, 1fr); }
  .order-shipping dt { padding: 11px 12px 2px; background: transparent; color: var(--muted); font-size: var(--text-xs); }
  .order-shipping dd { padding: 0 12px 11px; }
}
.order-detail { display: grid; gap: 20px; }
@media (max-width: 640px) { .order-detail__header, .order-detail__section { padding: 16px; } }

</style>
