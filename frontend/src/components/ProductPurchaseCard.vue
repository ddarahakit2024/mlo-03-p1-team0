<script setup>
import { computed } from 'vue'
import ProductQuantitySelect from './ProductQuantitySelect.vue'
import { getStockStatus, maxOrderQuantity } from '../stores/productViewModel.js'

// 상품 상세 가격 카드의 구매 영역(section "구매하기"): 재고 표시·수량 선택(1~min(10, 재고)) → 버튼 줄(장바구니 담기·바로 구매) → 기본 slot.
// 가격은 위의 ProductPriceSummary 가 보여 준다. 품절이면 수량 선택 없이 안내하고 두 버튼을 막는다. 담는 중에는 "담는 중..." 과 수량 선택 잠금.
// 비교함·목표가 알림 버튼은 구매 영역 밖(화면이 이 카드 옆에 둔다)이다.
const props = defineProps({ stock: { type: Number, default: 0 }, quantity: { type: Number, default: 1 }, adding: { type: Boolean, default: false } })
const emit = defineEmits(['update:quantity', 'add-to-cart', 'buy-now'])
const stockStatus = computed(() => getStockStatus(props.stock))
const maxQuantity = computed(() => maxOrderQuantity(props.stock))
</script>

<template>
  <section class="product-purchase" aria-label="구매하기">
    <div class="product-purchase__options">
      <span class="shop-stock" :class="{ 'shop-stock--low': stockStatus.tone === 'low', 'shop-stock--sold-out': stockStatus.soldOut }">{{ stockStatus.label }}</span>
      <ProductQuantitySelect v-if="!stockStatus.soldOut" id="product-quantity" :model-value="quantity" :max="maxQuantity" :disabled="adding" @update:model-value="emit('update:quantity', $event)" />
    </div>
    <p v-if="stockStatus.soldOut" class="product-purchase__sold-out">품절된 상품입니다. 재입고되면 구매할 수 있습니다.</p>
    <div class="product-purchase__actions">
      <button class="product-purchase__cart" type="button" :disabled="stockStatus.soldOut || adding" :aria-busy="adding" @click="emit('add-to-cart')">{{ adding ? '담는 중...' : '장바구니 담기' }}</button>
      <button class="product-purchase__buy" type="button" :disabled="stockStatus.soldOut || adding" @click="emit('buy-now')">바로 구매</button>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.product-purchase { display: grid; gap: 12px; min-width: 0; }
.product-purchase__options { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.product-purchase__sold-out { margin: 0; color: var(--danger); font-size: var(--text-sm); }
.product-purchase__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.product-purchase__actions > button { display: inline-flex; align-items: center; justify-content: center; height: 46px; padding: 0 16px; border-radius: var(--radius-sm); font-size: var(--text-body); font-weight: 600; cursor: pointer; }
.product-purchase__cart { flex: 1 1 160px; padding: 0 18px; border: 0; background: var(--brand); color: var(--brand-ink); font-size: 15px; font-weight: 700; }
.product-purchase__actions > .product-purchase__cart { font-size: 15px; font-weight: 700; }
.product-purchase__cart:hover:not(:disabled) { background: var(--brand-strong); }
.product-purchase__buy { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.product-purchase__buy:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-strong); }
.product-purchase__actions > button:disabled { opacity: .55; cursor: not-allowed; }
.product-purchase__actions > button[aria-busy='true'] { cursor: wait; }
@media (max-width: 420px) { .product-purchase__actions > button { flex: 1 1 calc(50% - 4px); } }
</style>
