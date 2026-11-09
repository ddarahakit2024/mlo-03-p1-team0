<script setup>
import { ref } from 'vue'
import PriceChangeBadge from './PriceChangeBadge.vue'
import PriceSparkline from './PriceSparkline.vue'
import { PRODUCT_PLACEHOLDER, formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'
import { recommendationReason } from '../stores/recommendationViewModel.js'

// 상품 상세의 "함께 보는 부품" 영역(추천, spec docs/specs/2026-11-03-product-recommendations.md "화면"). API 를 부르지 않는다:
// 화면이 GET /products/{id}/recommendations 를 부르고 영역 상태(getSectionState)·추천 목록을 넘긴다.
// - state: loading(role="status") · error(role="alert" + "다시 시도" → retry) · empty · ready
// - items: 추천 항목(rank, reason, ProductSummary 필드 + price_trend). 카드 = 사진·30일 변동 배지·이름(h3)·근거(글자)·가격·30일 추세선, 카드 전체가 /products/{id} 링크
// - observeItem(element, item, index): 카드 li 를 받는 함수(노출 측정, 카드가 사라지면 element 가 null), select(item, index): 카드를 눌렀을 때(이동 직전)
// 시뮬레이터가 상세 화면의 첫 h1·모든 dt 를 읽으므로 여기에는 h1·dl/dt 를 쓰지 않는다. 목록 이름도 " 목록"으로 끝나지 않게 한다(목록 화면 카드 찾기 규칙)
defineProps({
  state: { type: String, default: 'loading' },
  items: { type: Array, default: () => [] },
  error: { type: String, default: '' },
  observeItem: { type: Function, default: null },
})
const emit = defineEmits(['retry', 'select'])
// 사진이 깨진 상품 id → 대체 그림
const broken = ref({})

function image(item) {
  return broken.value[item.id] ? PRODUCT_PLACEHOLDER : getProductImage(item)
}

function markBroken(item) {
  broken.value = { ...broken.value, [item.id]: true }
}
</script>

<template>
  <section class="product-recs" aria-labelledby="product-recommendations-title" :aria-busy="state === 'loading'">
    <h2 id="product-recommendations-title">함께 보는 부품</h2>
    <p v-if="state === 'loading'" class="product-recs__state" role="status">추천 상품을 불러오는 중입니다...</p>
    <div v-else-if="state === 'error'" class="product-recs__state product-recs__state--error" role="alert">
      <p>{{ error || '추천 상품을 불러오지 못했습니다. 다시 시도해 주세요.' }}</p>
      <button class="shop-button shop-button--secondary" type="button" @click="emit('retry')">다시 시도</button>
    </div>
    <p v-else-if="state === 'empty' || !items.length" class="product-recs__empty">추천할 상품이 아직 없습니다.</p>
    <ul v-else class="product-recs__list" aria-label="추천 상품">
      <li v-for="(item, index) in items" :key="item.id" :ref="(element) => observeItem?.(element, item, index)" class="product-recs__item">
        <a class="product-rec" :href="productPath(item.id)" @click="emit('select', item, index)">
          <span class="product-rec__top">
            <span class="product-rec__image"><img :src="image(item)" :alt="`${item.name || '상품'} 이미지`" loading="lazy" @error="markBroken(item)" /></span>
            <PriceChangeBadge v-if="item.price_trend" :pct="item.price_trend.change_30d_pct ?? null" prefix="" />
          </span>
          <h3>{{ item.name || '상품 이름' }}</h3>
          <span class="product-rec__reason" :class="`product-rec__reason--${item.reason === 'co_view' ? 'co-view' : 'similar'}`">{{ recommendationReason(item.reason) }}</span>
          <span class="product-rec__bottom">
            <strong>{{ formatPrice(item.price_krw) }}</strong>
            <span v-if="item.price_trend?.sparkline_30d?.length" class="product-rec__spark" aria-hidden="true">
              <PriceSparkline :values="item.price_trend.sparkline_30d" :change-pct="item.price_trend.change_30d_pct ?? null" />
            </span>
          </span>
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.product-recs { display: grid; gap: 12px; min-width: 0; }
.product-recs h2 { margin: 0; color: var(--ink); font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
.product-recs__state { display: grid; justify-items: center; gap: 10px; margin: 0; padding: 26px 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--muted); font-size: var(--text-sm); line-height: 1.7; text-align: center; overflow-wrap: anywhere; }
.product-recs__state p { margin: 0; }
.product-recs__state--error { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--danger-soft); color: var(--danger); }
.product-recs__empty { margin: 0; padding: 14px 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--text-sm); }
.product-recs__list { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.product-recs__item { min-width: 0; }
/* 카드 전체가 링크 하나(사진·변동 배지·이름·근거·가격·추세선) */
.product-rec { display: flex; flex-direction: column; gap: 10px; height: 100%; min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: inherit; text-decoration: none; transition: border-color .15s ease; }
.product-rec:hover { border-color: var(--line-strong); }
.product-rec:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.product-rec__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.product-rec__image { display: block; flex: none; width: 56px; height: 40px; overflow: hidden; border-radius: 8px; background: var(--image-bg); }
.product-rec__image img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 3px; }
.product-rec h3 { display: -webkit-box; min-height: 35px; margin: 0; overflow: hidden; color: var(--ink); font-size: var(--text-sm); font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.product-rec__reason { align-self: flex-start; margin-top: -4px; color: var(--muted); font-size: 11px; font-weight: 600; }
.product-rec__reason--co-view { color: var(--brand-strong); }
.product-rec__bottom { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; }
.product-rec__bottom strong { color: var(--ink); font-size: 17px; font-variant-numeric: tabular-nums; font-weight: 800; white-space: nowrap; }
.product-rec__spark { display: block; flex: none; width: 80px; height: 28px; }
.product-rec__spark :deep(.price-sparkline) { height: 28px; }
@media (max-width: 640px) {
  .product-recs__list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .product-rec { padding: 12px; }
  .product-rec__bottom { flex-wrap: wrap; }
  .product-rec__bottom strong { font-size: 15px; }
  .product-rec__spark { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .product-rec { transition: none; } }
</style>
