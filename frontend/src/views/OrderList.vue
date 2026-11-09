<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { fetchOrders } from '../api/orderApi.js'
import { SiteLayout } from '../components/index.js'
import { LOGIN_REQUIRED_MESSAGE } from '../stores/cartViewModel.js'
import { ORDER_PAGE_SIZE, formatOrderDate, getOrderPageState, getOrderStatus, orderError, orderPath } from '../stores/orderViewModel.js'
import { PRODUCT_PLACEHOLDER, formatPrice, getProductImage } from '../stores/productViewModel.js'

const orders = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const error = ref('')
const needsLogin = ref(false)
// 깨진 이미지(주문 번호별)는 기본 이미지로 바꾼다
const brokenImages = reactive({})
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / ORDER_PAGE_SIZE)))
const pageState = computed(() => getOrderPageState({ loading: loading.value, needsLogin: needsLogin.value, error: error.value, orders: orders.value }))
let requestId = 0

async function loadOrders(targetPage = page.value) {
  const request = ++requestId
  loading.value = true
  error.value = ''
  needsLogin.value = false
  try {
    const data = await fetchOrders({ page: targetPage, pageSize: ORDER_PAGE_SIZE })
    if (request !== requestId) return
    orders.value = data.items
    total.value = data.total
    page.value = data.page
  } catch (failure) {
    if (request !== requestId) return
    needsLogin.value = failure?.response?.status === 401
    if (!needsLogin.value) error.value = orderError(failure, '주문 내역을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === requestId) loading.value = false
  }
}

function imageOf(order) {
  return brokenImages[order.payment_id] ? PRODUCT_PLACEHOLDER : getProductImage(order)
}

onMounted(() => loadOrders())
</script>

<template>
  <SiteLayout active-page="orders">
    <section class="shop-page shop-page--narrow" aria-labelledby="orders-title">
      <div class="orders-heading">
        <h1 id="orders-title">주문 내역</h1>
        <p>결제를 마친 주문과 취소된 주문을 최근 주문부터 보여 드립니다.</p>
      </div>
      <div :aria-busy="loading">
        <p v-if="pageState === 'loading'" class="shop-state" role="status">주문 내역을 불러오는 중입니다...</p>
        <div v-else-if="pageState === 'guest'" class="shop-state">
          <h2>{{ LOGIN_REQUIRED_MESSAGE }}</h2><p>로그인하면 주문한 상품과 결제 상태를 확인할 수 있습니다.</p>
          <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="loadOrders()">로그인 상태 다시 확인</button></div>
        </div>
        <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
          <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadOrders()">다시 시도</button>
        </div>
        <div v-else-if="pageState === 'empty'" class="shop-state">
          <h2>아직 주문한 상품이 없습니다.</h2><p>필요한 부품을 골라 첫 주문을 해 보세요.</p><a class="shop-button" href="/products">상품 보러 가기</a>
        </div>
        <template v-else>
          <p class="orders-total">전체 주문 {{ total }}건</p>
          <ol class="orders-list">
            <li v-for="order in orders" :key="order.payment_id">
              <a class="order-row" :href="orderPath(order.payment_id)">
                <img class="order-row__image" :src="imageOf(order)" alt="" loading="lazy" @error="brokenImages[order.payment_id] = true" />
                <div class="order-row__info">
                  <p class="order-row__meta">
                    <span class="shop-order-status" :class="{ 'shop-order-status--paid': getOrderStatus(order.status).tone === 'paid', 'shop-order-status--cancelled': getOrderStatus(order.status).tone === 'cancelled' }">{{ getOrderStatus(order.status).label }}</span>
                    <time :datetime="order.created_at">{{ formatOrderDate(order.created_at) }} 주문</time>
                  </p>
                  <h2 class="order-row__name">{{ order.order_name }}</h2>
                  <p class="order-row__count">상품 {{ order.item_count }}개</p>
                </div>
                <p class="order-row__total"><span class="sr-only">총 결제 금액 </span>{{ formatPrice(order.total_krw) }}</p>
              </a>
            </li>
          </ol>
          <nav v-if="pageCount > 1" class="shop-pagination" aria-label="주문 내역 페이지">
            <button class="shop-button shop-button--secondary" type="button" :disabled="page <= 1" @click="loadOrders(page - 1)">이전</button>
            <span aria-live="polite">{{ page }} / {{ pageCount }}</span>
            <button class="shop-button shop-button--secondary" type="button" :disabled="page >= pageCount" @click="loadOrders(page + 1)">다음</button>
          </nav>
        </template>
      </div>
    </section>
  </SiteLayout>
</template>

<style scoped>
.orders-heading { margin: 0 0 26px; }
.orders-heading h1 { margin: 0 0 8px; color: var(--ink); font-size: var(--text-title); letter-spacing: -.8px; }
.orders-heading p { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.7; word-break: keep-all; }
.orders-total { margin: 0 0 12px; color: var(--muted); font-size: var(--text-xs); }
.orders-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.orders-list li { overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.order-row { display: grid; grid-template-columns: 88px minmax(0, 1fr) auto; align-items: center; gap: 18px; padding: 20px; color: inherit; text-decoration: none; }
.order-row:hover { background: var(--surface-2); }
.order-row__image { width: 88px; height: 66px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--image-bg); object-fit: contain; }
.order-row__info { min-width: 0; }
.order-row__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 6px; color: var(--muted); font-size: var(--text-xs); }
.order-row__name { margin: 0; color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.5; word-break: keep-all; overflow-wrap: anywhere; }
.order-row:hover .order-row__name { color: var(--brand); text-decoration: underline; }
.order-row__count { margin: 4px 0 0; color: var(--muted); font-size: var(--text-xs); }
.order-row__total { margin: 0; color: var(--ink); font-size: 16px; font-weight: 800; text-align: right; white-space: nowrap; }
@media (max-width: 640px) {
  .order-row { grid-template-columns: 64px minmax(0, 1fr); gap: 8px 12px; padding: 16px 2px; }
  .order-row__image { width: 64px; height: 48px; align-self: start; }
  .order-row__total { grid-column: 2; text-align: left; }
}
</style>
