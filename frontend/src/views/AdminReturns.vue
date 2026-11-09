<script setup>
import { computed, onMounted, ref } from 'vue'
import { approveReturn, fetchAdminReturns, rejectReturn } from '../api/adminApi.js'
import { InlineConfirm, SiteLayout } from '../components/index.js'
import { LOGIN_REQUIRED_MESSAGE } from '../stores/cartViewModel.js'
import { formatOrderDateTime } from '../stores/orderViewModel.js'
import { formatPrice } from '../stores/productViewModel.js'
import {
  ADMIN_RETURN_PAGE_SIZE, ADMIN_RETURN_TABS, MAX_REJECT_REASON_LENGTH, adminReturnError, adminReturnTabName, getAdminReturnsPageState, paymentProviderName,
  readAdminReturnsQuery, replaceAdminReturnsQuery, returnReasonName, returnStatus, textLength, validateRejectReason,
} from '../stores/returnViewModel.js'

// 관리자 반품 관리(spec docs/specs/2026-11-01-returns-refunds.md "화면"). 관리자 여부는 서버가 판단한다: GET /admin/returns 가 401 이면 로그인 안내, 403 이면 "관리자만 볼 수 있습니다."
// 상태 탭은 주소 ?status= 와 같이 바뀌고(replaceState), 쪽당 20개. 금액(상품 합계·배송비 차감·환불 금액)은 서버 값을 그대로 보여 준다.
// 승인·거절은 한 번에 하나만 처리하고(처리 중에는 모든 처리 버튼을 막는다), 결과는 목록 위 안내(성공 role="status", 실패 role="alert")로 남긴다.
// "승인하고 환불"·"다시 환불"은 돈이 나가는 동작이라 그 카드 안의 화면 안 확인(InlineConfirm, "환불 N원을 승인할까요?")에서 "예"일 때만 요청한다
// (N 은 서버 값 refund_amount_krw 그대로)
const status = ref(readAdminReturnsQuery().status)
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const error = ref('')
const needsLogin = ref(false)
const forbidden = ref(false)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / ADMIN_RETURN_PAGE_SIZE)))
const pageState = computed(() => getAdminReturnsPageState({
  loading: loading.value, needsLogin: needsLogin.value, forbidden: forbidden.value, error: error.value, items: items.value,
}))
// 처리 중인 신청과 동작('approve' | 'reject'), 승인 확인 상자를 연 신청, 거절 사유 입력, 처리 결과 안내
const busyId = ref(null)
const busyAction = ref('')
const approvingId = ref(null)
const rejectingId = ref(null)
const rejectReason = ref('')
const rejectError = ref('')
const notice = ref(null)
let requestId = 0

async function loadReturns(targetPage = page.value, { quiet = false } = {}) {
  const request = ++requestId
  if (!quiet) {
    loading.value = true
    error.value = ''
    needsLogin.value = false
    forbidden.value = false
  }
  try {
    const data = await fetchAdminReturns({ status: status.value, page: targetPage })
    if (request !== requestId) return
    items.value = Array.isArray(data?.items) ? data.items : []
    total.value = Number(data?.total) || 0
    page.value = Number(data?.page) || targetPage
  } catch (failure) {
    // 조용히 다시 부르기(처리 뒤 최신 상태 맞추기)가 실패하면 지금 목록과 안내를 그대로 둔다
    if (request !== requestId || quiet) return
    const code = failure?.response?.status
    needsLogin.value = code === 401
    forbidden.value = code === 403
    if (!needsLogin.value && !forbidden.value) error.value = adminReturnError(failure, '반품 신청 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === requestId && !quiet) loading.value = false
  }
}

function chooseStatus(code) {
  if (status.value === code || busyId.value !== null) return
  status.value = code
  replaceAdminReturnsQuery(code)
  notice.value = null
  closeApprove()
  closeReject()
  loadReturns(1)
}

function changePage(targetPage) {
  notice.value = null
  closeApprove()
  closeReject()
  loadReturns(targetPage)
}

function replaceItem(updated) {
  if (!updated) return
  items.value = items.value.map((item) => (item.id === updated.id ? updated : item))
}

function failureNotice(failure, id, fallback) {
  const code = failure?.response?.status
  return { failed: true, needsLogin: code === 401, text: `신청 #${id}: ${adminReturnError(failure, fallback)}` }
}

/** 승인 확인 문구. 금액은 서버가 신청할 때 저장한 refund_amount_krw 그대로다. */
function approveConfirmMessage(item) {
  return `환불 ${formatPrice(item.refund_amount_krw)}을 승인할까요?`
}

// "승인하고 환불"·"다시 환불": 바로 요청하지 않고 그 카드에 확인 상자를 연다(한 번에 한 카드만)
function askApprove(item) {
  if (busyId.value !== null) return
  closeReject()
  approvingId.value = item.id
  notice.value = null
}

function closeApprove() {
  if (busyAction.value !== 'approve') approvingId.value = null
}

// 확인 상자의 "예": 승인하고 환불(REQUESTED) / 다시 환불(APPROVED, 환불 실패 뒤). 성공하면 응답(REFUNDED)으로 그 신청을 바꾼다.
// 처리 중에는 확인 상자(busy)와 모든 처리 버튼을 막고, 끝나면 상자를 닫는다(결과는 목록 위 안내).
// 실패(502 환불 실패·409 상태 바뀜·404)는 서버 상태가 바뀌었을 수 있으니 목록을 조용히 다시 부른다(502 면 APPROVED + refund_error 로 보인다)
async function approve(item) {
  if (busyId.value !== null || approvingId.value !== item.id) return
  busyId.value = item.id
  busyAction.value = 'approve'
  notice.value = null
  try {
    const updated = await approveReturn(item.id)
    replaceItem(updated)
    notice.value = { failed: false, text: `신청 #${item.id} 환불을 마쳤습니다(환불 금액 ${formatPrice(updated?.refund_amount_krw ?? item.refund_amount_krw)}).` }
  } catch (failure) {
    notice.value = failureNotice(failure, item.id, '환불을 처리하지 못했습니다. 잠시 후 다시 승인해 주세요.')
    const code = failure?.response?.status
    if (code !== 401 && code !== 403) await loadReturns(page.value, { quiet: true })
  } finally {
    busyId.value = null
    busyAction.value = ''
    approvingId.value = null
  }
}

function startReject(item) {
  if (busyId.value !== null) return
  closeApprove()
  rejectingId.value = item.id
  rejectReason.value = ''
  rejectError.value = ''
  notice.value = null
}

function closeReject() {
  rejectingId.value = null
  rejectReason.value = ''
  rejectError.value = ''
}

// 거절(REQUESTED): 사유 1~200자. 실패해도 입력한 사유는 그대로 둔다
async function submitReject(item) {
  if (busyId.value !== null) return
  const problem = validateRejectReason(rejectReason.value)
  if (problem) {
    rejectError.value = problem
    return
  }
  busyId.value = item.id
  busyAction.value = 'reject'
  rejectError.value = ''
  notice.value = null
  try {
    const updated = await rejectReturn(item.id, { reason: rejectReason.value })
    replaceItem(updated)
    closeReject()
    notice.value = { failed: false, text: `신청 #${item.id} 거절을 마쳤습니다. 구매자의 반품 내역에 거절 사유가 보입니다.` }
  } catch (failure) {
    const code = failure?.response?.status
    rejectError.value = adminReturnError(failure, '거절하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    if (code === 409 || code === 404) {
      closeReject()
      notice.value = failureNotice(failure, item.id, '거절하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      await loadReturns(page.value, { quiet: true })
    }
  } finally {
    busyId.value = null
    busyAction.value = ''
  }
}

function isBusy(item, action) {
  return busyId.value === item.id && busyAction.value === action
}

onMounted(() => loadReturns(1))
</script>

<template>
  <SiteLayout active-page="">
    <section class="shop-page admin-returns" aria-labelledby="admin-returns-title">
      <div class="admin-returns__heading">
        <h1 id="admin-returns-title">반품 관리</h1>
        <p>구매자의 반품 신청을 확인합니다. 승인하면 바로 환불하고, 불량이 아닌 상품은 재고로 되돌립니다.</p>
      </div>
      <div v-if="pageState !== 'guest' && pageState !== 'forbidden'" class="admin-returns__tabs" role="group" aria-label="반품 상태">
        <button
          v-for="tab in ADMIN_RETURN_TABS"
          :key="tab.status || 'all'"
          class="admin-returns__tab"
          type="button"
          :aria-pressed="status === tab.status"
          :disabled="busyId !== null"
          @click="chooseStatus(tab.status)"
        >{{ tab.name }}</button>
      </div>
      <div :aria-busy="loading">
        <p v-if="pageState === 'loading'" class="shop-state" role="status">반품 신청을 불러오는 중입니다...</p>
        <div v-else-if="pageState === 'guest'" class="shop-state">
          <h2>{{ LOGIN_REQUIRED_MESSAGE }}</h2><p>관리자 계정으로 로그인하면 반품 신청을 확인할 수 있습니다.</p>
          <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="loadReturns(1)">로그인 상태 다시 확인</button></div>
        </div>
        <div v-else-if="pageState === 'forbidden'" class="shop-state">
          <h2>관리자만 볼 수 있습니다.</h2><p>반품 관리는 관리자 계정에서만 쓸 수 있습니다. 관리자 계정으로 로그인했는지 확인해 주세요.</p>
          <a class="shop-button shop-button--secondary" href="/products">상품 보러 가기</a>
        </div>
        <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
          <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadReturns()">다시 시도</button>
        </div>
        <div v-else-if="pageState === 'empty'" class="shop-state">
          <template v-if="status">
            <h2>{{ adminReturnTabName(status) }} 상태의 반품 신청이 없습니다.</h2><p>다른 상태를 고르거나 전체 목록을 확인해 주세요.</p>
            <button class="shop-button shop-button--secondary" type="button" @click="chooseStatus(null)">전체 보기</button>
          </template>
          <template v-else>
            <h2>아직 반품 신청이 없습니다.</h2><p>구매자가 주문 상세에서 반품을 신청하면 여기에 보입니다.</p>
          </template>
        </div>
        <template v-else>
          <p v-if="notice" class="shop-message admin-returns__notice" :class="{ 'shop-message--error': notice.failed }" :role="notice.failed ? 'alert' : 'status'">
            {{ notice.text }}<a v-if="notice.needsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
          </p>
          <p class="admin-returns__total">반품 신청 {{ total.toLocaleString('ko-KR') }}건</p>
          <ol class="admin-returns__list">
            <li v-for="item in items" :key="item.id">
              <article class="admin-return" :aria-labelledby="`admin-return-${item.id}-title`">
                <header class="admin-return__header">
                  <div class="admin-return__badges">
                    <span class="shop-order-status" :class="returnStatus(item.status).className">{{ returnStatus(item.status).label }}</span>
                    <span class="admin-return__number">신청 #{{ item.id }}</span>
                    <span class="admin-return__date"><time :datetime="item.requested_at">{{ formatOrderDateTime(item.requested_at) }}</time> 신청</span>
                  </div>
                  <h2 :id="`admin-return-${item.id}-title`">{{ item.order_name }}</h2>
                </header>
                <dl class="admin-return__facts">
                  <div><dt>주문 번호</dt><dd class="admin-return__code">{{ item.payment_id }}</dd></div>
                  <div><dt>결제 시각</dt><dd><time :datetime="item.paid_at">{{ formatOrderDateTime(item.paid_at) || '-' }}</time></dd></div>
                  <div><dt>결제 방식</dt><dd>{{ paymentProviderName(item.payment_provider) }}</dd></div>
                  <div><dt>구매자</dt><dd class="admin-return__code">{{ item.buyer_subject || '-' }}</dd></div>
                </dl>
                <ul class="admin-return__products" :aria-label="`신청 #${item.id} 반품 상품`">
                  <li v-for="line in item.items" :key="line.product_id">
                    <span class="admin-return__product-name">{{ line.product_name }}</span>
                    <span class="admin-return__product-qty">{{ line.quantity }}개 × {{ formatPrice(line.unit_price_krw) }}</span>
                  </li>
                </ul>
                <dl class="admin-return__facts">
                  <div><dt>사유</dt><dd>{{ returnReasonName(item.reason) }}</dd></div>
                  <div v-if="item.detail"><dt>자세한 내용</dt><dd class="admin-return__detail">{{ item.detail }}</dd></div>
                  <div v-if="item.reject_reason"><dt>거절 사유</dt><dd>{{ item.reject_reason }}</dd></div>
                  <div v-if="item.decided_at"><dt>처리 시각</dt><dd><time :datetime="item.decided_at">{{ formatOrderDateTime(item.decided_at) }}</time></dd></div>
                  <div v-if="item.refunded_at"><dt>환불 시각</dt><dd><time :datetime="item.refunded_at">{{ formatOrderDateTime(item.refunded_at) }}</time></dd></div>
                </dl>
                <dl class="admin-return__amounts">
                  <div><dt>상품 합계</dt><dd>{{ formatPrice(item.items_total_krw) }}</dd></div>
                  <div><dt>배송비 차감</dt><dd>{{ item.shipping_deduction_krw > 0 ? `− ${formatPrice(item.shipping_deduction_krw)}` : '없음' }}</dd></div>
                  <div class="admin-return__refund"><dt>환불 금액</dt><dd>{{ formatPrice(item.refund_amount_krw) }}</dd></div>
                </dl>
                <p v-if="item.refund_error" class="shop-message shop-message--error admin-return__refund-error">환불 실패: {{ item.refund_error }}</p>
                <div v-if="item.status === 'REQUESTED' || item.status === 'APPROVED'" class="admin-return__actions">
                  <form v-if="rejectingId === item.id" class="admin-return__reject" :aria-busy="isBusy(item, 'reject')" novalidate @submit.prevent="submitReject(item)">
                    <fieldset :disabled="busyId !== null">
                      <label class="admin-return__reject-label" :for="`reject-reason-${item.id}`">거절 사유</label>
                      <input
                        :id="`reject-reason-${item.id}`"
                        v-model="rejectReason"
                        type="text"
                        :maxlength="MAX_REJECT_REASON_LENGTH"
                        placeholder="구매자에게 보이는 거절 사유를 적어 주세요."
                        :aria-describedby="`reject-reason-${item.id}-count`"
                      />
                      <p :id="`reject-reason-${item.id}-count`" class="admin-return__count">{{ textLength(rejectReason) }} / {{ MAX_REJECT_REASON_LENGTH }}</p>
                    </fieldset>
                    <p v-if="rejectError" class="shop-message shop-message--error" role="alert">{{ rejectError }}</p>
                    <div class="admin-return__buttons">
                      <button class="shop-button shop-button--secondary" type="button" :disabled="busyId !== null" @click="closeReject">취소</button>
                      <button class="shop-button" type="submit" :disabled="busyId !== null" :aria-busy="isBusy(item, 'reject')">{{ isBusy(item, 'reject') ? '거절 중...' : '거절 확인' }}</button>
                    </div>
                  </form>
                  <InlineConfirm
                    v-else-if="approvingId === item.id"
                    :message="approveConfirmMessage(item)"
                    busy-label="환불 처리 중..."
                    :busy="isBusy(item, 'approve')"
                    @confirm="approve(item)"
                    @cancel="closeApprove"
                  />
                  <div v-else class="admin-return__buttons">
                    <template v-if="item.status === 'REQUESTED'">
                      <button class="shop-button shop-button--secondary" type="button" :disabled="busyId !== null" @click="startReject(item)">거절</button>
                      <button class="shop-button" type="button" :disabled="busyId !== null" @click="askApprove(item)">승인하고 환불</button>
                    </template>
                    <button v-else class="shop-button" type="button" :disabled="busyId !== null" @click="askApprove(item)">다시 환불</button>
                  </div>
                </div>
              </article>
            </li>
          </ol>
          <nav v-if="pageCount > 1" class="shop-pagination" aria-label="반품 신청 페이지">
            <button class="shop-button shop-button--secondary" type="button" :disabled="page <= 1 || busyId !== null" @click="changePage(page - 1)">이전</button>
            <span aria-live="polite">{{ page }} / {{ pageCount }}</span>
            <button class="shop-button shop-button--secondary" type="button" :disabled="page >= pageCount || busyId !== null" @click="changePage(page + 1)">다음</button>
          </nav>
        </template>
      </div>
    </section>
  </SiteLayout>
</template>

<style scoped>
.admin-returns { max-width: var(--content-width); margin-right: auto; margin-left: auto; }
.admin-returns__heading { margin: 0 0 22px; }
.admin-returns__heading h1 { margin: 0 0 8px; color: var(--ink); font-size: var(--text-title); letter-spacing: -.8px; }
.admin-returns__heading p { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.7; word-break: keep-all; }
.admin-returns__tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
.admin-returns__tab { min-height: 40px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface); color: var(--ink); font-size: var(--text-sm); font-weight: 600; white-space: nowrap; cursor: pointer; }
.admin-returns__tab:hover:not(:disabled) { border-color: var(--brand-line); background: var(--surface-2); }
.admin-returns__tab[aria-pressed="true"] { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); font-weight: 750; }
.admin-returns__tab:disabled { opacity: .6; cursor: wait; }
.admin-returns__notice { margin-bottom: 14px; }
.admin-returns__total { margin: 0 0 12px; color: var(--muted); font-size: var(--text-xs); }
.admin-returns__list { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.admin-return { display: grid; gap: 16px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.admin-return__header { display: grid; gap: 8px; }
.admin-return__badges { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; color: var(--muted); font-size: var(--text-xs); }
.admin-return__number { color: var(--ink); font-weight: 750; }
.admin-return__header h2 { margin: 0; color: var(--ink); font-size: 16px; line-height: 1.5; letter-spacing: -.3px; word-break: keep-all; overflow-wrap: anywhere; }
.admin-return__facts { display: grid; gap: 6px; margin: 0; font-size: var(--text-sm); }
.admin-return__facts div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; }
.admin-return__facts dt { color: var(--muted); }
.admin-return__facts dd { margin: 0; color: var(--ink); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.admin-return__code { font-family: var(--font-numeric); font-size: var(--text-xs); overflow-wrap: anywhere; word-break: break-all; }
.admin-return__detail { white-space: pre-line; }
.admin-return__products { display: grid; gap: 6px; margin: 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); list-style: none; font-size: var(--text-sm); }
.admin-return__products li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.admin-return__product-name { min-width: 0; color: var(--ink); font-weight: 650; word-break: keep-all; overflow-wrap: anywhere; }
.admin-return__product-qty { color: var(--muted); white-space: nowrap; }
.admin-return__amounts { display: grid; gap: 6px; width: min(320px, 100%); margin: 0 0 0 auto; font-size: var(--text-sm); }
.admin-return__amounts div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--muted); }
.admin-return__amounts dd { margin: 0; color: var(--ink); font-weight: 650; }
.admin-return__amounts .admin-return__refund { padding-top: 8px; border-top: 1px solid var(--line); color: var(--ink); font-weight: 700; }
.admin-return__refund dd { color: var(--brand); font-size: 18px; font-weight: 800; }
.admin-return__refund-error { margin: 0; }
.admin-return__actions { padding-top: 12px; border-top: 1px solid var(--line); }
.admin-return__buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.admin-return__reject { display: grid; gap: 10px; }
.admin-return__reject fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.admin-return__reject-label { display: block; margin-bottom: 6px; color: var(--ink); font-size: var(--text-sm); font-weight: 700; }
.admin-return__reject input { display: block; box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-sm); }
.admin-return__reject input::placeholder { color: var(--muted); }
.admin-return__count { margin: 6px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: right; }
.admin-returns :is(button, a, input):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (max-width: 640px) {
  .admin-return { padding: 14px; }
  .admin-return__facts div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .admin-return__amounts { width: 100%; }
  .admin-return__buttons .shop-button { flex: 1 1 0; }
}
</style>
