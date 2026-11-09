<script setup>
import { computed } from 'vue'
import ProductCard from './ProductCard.vue'
import { storeLine } from '../stores/priceTrendViewModel.js'
import { getStockStatus } from '../stores/productViewModel.js'

// 상품 카드 목록. 카드(ProductCard)는 링크 하나라서 버튼(비교·담기)은 카드 링크 밖(li 안, 카드 뒤)에 둔다(대화형 요소 중첩 금지).
// li 가 카드의 테두리이고, 링크 아래 줄에 타몰 비교 문구(price_trend 의 storeLine)와 "담기" 버튼이 있다.
// - compareIds: 비교함에 담긴 상품 id 목록. null 이면 비교 버튼을 그리지 않는다(비교함을 쓸 수 없는 브라우저)
// - addingIds: 장바구니에 담는 중인 상품 id 목록(그 카드의 담기 버튼을 막는다). null 이면 담기 버튼을 그리지 않는다
// - observeItem(element, product, index): 카드 li 를 받는 함수(노출 측정). 카드가 사라지면 element 가 null 이다
// - select(product, index): 카드를 눌렀을 때(이동 직전), toggle-compare(product): 비교 버튼, add-to-cart(product): 담기 버튼
const props = defineProps({
  products: { type: Array, default: () => [] },
  label: { type: String, default: '상품 목록' },
  compareIds: { type: Array, default: null },
  addingIds: { type: Array, default: null },
  observeItem: { type: Function, default: null },
})
const emit = defineEmits(['select', 'toggle-compare', 'add-to-cart'])
// 상품마다 타몰 비교 문구({ text, tone good·warn } 또는 null)
const storeLines = computed(() => props.products.map((product) => storeLine(product?.price_trend)))

function soldOut(product) {
  return getStockStatus(product.stock).soldOut
}
</script>

<template>
  <ul class="product-grid" :aria-label="label">
    <li v-for="(product, index) in products" :key="product.id" :ref="(element) => observeItem?.(element, product, index)" class="product-grid__item">
      <ProductCard :product="product" @click="emit('select', product, index)" />
      <button
        v-if="compareIds"
        class="product-grid__compare"
        type="button"
        :aria-pressed="compareIds.includes(product.id)"
        :aria-label="`${product.name || '상품'} ${compareIds.includes(product.id) ? '비교함에서 빼기' : '비교함에 담기'}`"
        @click="emit('toggle-compare', product)"
      >{{ compareIds.includes(product.id) ? '비교 중' : '+ 비교' }}</button>
      <div v-if="storeLines[index] || addingIds" class="product-grid__foot">
        <p class="product-grid__store" :class="storeLines[index] ? `product-grid__store--${storeLines[index].tone}` : ''">{{ storeLines[index]?.text || '' }}</p>
        <button
          v-if="addingIds"
          class="product-grid__add"
          type="button"
          :disabled="addingIds.includes(product.id) || soldOut(product)"
          :aria-busy="addingIds.includes(product.id)"
          :aria-label="`${product.name || '상품'} ${soldOut(product) ? '품절' : addingIds.includes(product.id) ? '장바구니에 담는 중' : '장바구니에 담기'}`"
          @click="emit('add-to-cart', product)"
        >{{ soldOut(product) ? '품절' : addingIds.includes(product.id) ? '담는 중...' : '담기' }}</button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; margin: 0; padding: 0; list-style: none; }
.product-grid__item { position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); transition: border-color .15s ease, transform .15s ease; }
.product-grid__item:hover { border-color: var(--line-strong); transform: translateY(-2px); }
/* 사진 오른쪽 위에 겹쳐 둔다(DOM 은 카드 뒤) */
.product-grid__compare { position: absolute; z-index: 1; top: 10px; right: 10px; min-height: 28px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--bg); color: var(--ink); font-size: var(--text-xs); font-weight: 700; cursor: pointer; opacity: .9; }
.product-grid__compare:hover { opacity: 1; }
.product-grid__compare[aria-pressed="true"] { background: var(--brand); color: var(--brand-ink); opacity: 1; }
.product-grid__compare:focus-visible, .product-grid__add:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.product-grid__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 0 16px; padding: 10px 0 14px; border-top: 1px solid var(--line); }
.product-grid__store { flex: 1 1 120px; min-width: 0; margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.3; font-variant-numeric: tabular-nums; }
.product-grid__store--good { color: var(--success); }
.product-grid__store--warn { color: var(--warning); }
.product-grid__add { flex: none; min-height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--ink); font-size: var(--text-xs); font-weight: 700; cursor: pointer; }
.product-grid__add:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-strong); }
.product-grid__add:disabled { opacity: .55; cursor: not-allowed; }
.product-grid__add[aria-busy="true"]:disabled { cursor: wait; }
@media (max-width: 560px) {
  .product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .product-grid__compare { top: 8px; right: 8px; padding: 0 8px; }
  .product-grid__foot { margin: 0 12px; padding: 8px 0 12px; }
  .product-grid__add { flex: 1 1 100%; min-height: 36px; }
}
@media (prefers-reduced-motion: reduce) { .product-grid__item { transition: none; } .product-grid__item:hover { transform: none; } }
</style>
