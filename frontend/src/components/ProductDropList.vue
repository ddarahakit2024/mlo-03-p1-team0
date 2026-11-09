<script setup>
import { ref } from 'vue'
import PriceChangeBadge from './PriceChangeBadge.vue'
import PriceSparkline from './PriceSparkline.vue'
import { lowestLine } from '../stores/priceTrendViewModel.js'
import { PRODUCT_PLACEHOLDER, formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'

// 첫 화면의 "30일 하락폭 큰 부품" 가로 줄(GET /products?dropping=true&sort=drop_desc 를 화면이 불러 넘긴다).
// 카드는 링크 하나(작은 사진·변동률 배지·이름·30일 추세선·가격·1년 최저가 문구). 줄은 자기 영역 안에서만 가로로 넘긴다.
// state: loading | error | empty | ready(getSectionState). empty 면 아무것도 그리지 않는다(화면도 영역을 숨긴다)
defineProps({
  state: { type: String, default: 'loading' },
  items: { type: Array, default: () => [] },
  error: { type: String, default: '' },
})
const emit = defineEmits(['retry'])
const broken = ref([])

function image(product) {
  return broken.value.includes(product.id) ? PRODUCT_PLACEHOLDER : getProductImage(product)
}
</script>

<template>
  <section v-if="state !== 'empty'" class="drop-list" aria-labelledby="drop-list-title">
    <div class="drop-list__head">
      <h2 id="drop-list-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 17l-7.5-7.5-4 4L2 6" /><path d="M16 17h6v-6" /></svg>30일 하락폭 큰 부품</h2>
      <span>30일 전 가격 기준</span>
    </div>
    <p v-if="state === 'loading'" class="drop-list__state" role="status">하락한 부품을 불러오는 중입니다...</p>
    <div v-else-if="state === 'error'" class="drop-list__state" role="alert">
      <p>{{ error || '하락한 부품을 불러오지 못했습니다. 다시 시도해 주세요.' }}</p>
      <button class="shop-button shop-button--secondary" type="button" @click="emit('retry')">다시 시도</button>
    </div>
    <ul v-else class="drop-list__items" aria-labelledby="drop-list-title">
      <li v-for="product in items" :key="product.id">
        <a class="drop-card" :href="productPath(product.id)">
          <span class="drop-card__top">
            <span class="drop-card__thumb"><img :src="image(product)" alt="" loading="lazy" @error="broken = [...broken, product.id]" /></span>
            <PriceChangeBadge :pct="product.price_trend?.change_30d_pct ?? null" prefix="" />
          </span>
          <h3 class="drop-card__name">{{ product.name || '상품 이름' }}</h3>
          <PriceSparkline class="drop-card__spark" :values="product.price_trend?.sparkline_30d || []" :change-pct="product.price_trend?.change_30d_pct ?? null" />
          <span class="drop-card__bottom">
            <strong>{{ formatPrice(product.price_krw) }}</strong>
            <span v-if="lowestLine(product.price_trend)" class="drop-card__lowest" :class="`drop-card__lowest--${lowestLine(product.price_trend).tone}`">{{ lowestLine(product.price_trend).text }}</span>
          </span>
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.drop-list { display: flex; flex-direction: column; gap: 12px; min-width: 0; scroll-margin-top: 80px; }
.drop-list__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
.drop-list__head h2 { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--ink); font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
.drop-list__head svg { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--success); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.drop-list__head > span { color: var(--muted); font-size: var(--text-sm); }
.drop-list__state { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0; padding: 20px; border: 1px dashed var(--line); border-radius: 14px; color: var(--muted); font-size: var(--text-body); }
.drop-list__state p { margin: 0; }
.drop-list__items { display: flex; gap: 12px; margin: 0; padding: 0 0 6px; overflow-x: auto; list-style: none; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; }
.drop-list__items > li { flex: 0 0 220px; min-width: 0; scroll-snap-align: start; }
.drop-card { display: flex; flex-direction: column; gap: 10px; height: 100%; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--ink); text-decoration: none; transition: border-color .15s ease; }
.drop-card:hover { border-color: var(--success); color: var(--ink); text-decoration: none; }
.drop-card:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
.drop-card__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.drop-card__thumb { display: flex; width: 56px; height: 40px; flex: none; overflow: hidden; border-radius: 8px; background: var(--image-bg); }
.drop-card__thumb img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
.drop-card__name { display: -webkit-box; min-height: 35px; margin: 0; overflow: hidden; color: var(--ink); font-size: var(--text-sm); font-weight: 600; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.drop-card .drop-card__spark { width: 100%; height: 32px; }
.drop-card__bottom { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-top: auto; }
.drop-card__bottom strong { font-size: 17px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.drop-card__lowest { color: var(--muted); font-size: 11px; text-align: right; }
.drop-card__lowest--good { color: var(--success); }
.drop-card__lowest--near { color: var(--warning); }
@media (max-width: 760px) { .drop-list__items > li { flex-basis: 200px; } }
@media (prefers-reduced-motion: reduce) { .drop-card { transition: none; } }
</style>
