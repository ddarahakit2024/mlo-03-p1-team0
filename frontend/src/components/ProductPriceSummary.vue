<script setup>
import { computed } from 'vue'
import PriceChangeBadge from './PriceChangeBadge.vue'
import { priceTiles, storeSummary } from '../stores/productDetailViewModel.js'
import { formatPrice } from '../stores/productViewModel.js'

// 상품 상세 가격 카드의 윗부분: 판매가(32px)와 30일 변동 배지, 세 칸(1년 최저가·30일 평균·지금 살 때?), 판매처 문구.
// 숫자는 서버 값(price_krw, price_trend)을 그대로 보여 준다. 색만으로 구분하지 않게 판단·판매처 문구는 글자로 적는다.
const props = defineProps({
  price: { type: Number, required: true },
  trend: { type: Object, default: null },
})

const tiles = computed(() => priceTiles(props.trend))
const store = computed(() => storeSummary(props.trend))
</script>

<template>
  <div class="price-summary">
    <div class="price-summary__head">
      <p class="price-summary__price">{{ formatPrice(price) }}</p>
      <PriceChangeBadge :pct="trend?.change_30d_pct ?? null" />
    </div>
    <dl class="price-summary__tiles">
      <div class="price-summary__tile">
        <dt>1년 최저가</dt>
        <dd><strong>{{ tiles.lowest.text }}</strong><span>{{ tiles.lowest.note }}</span></dd>
      </div>
      <div class="price-summary__tile">
        <dt>30일 평균</dt>
        <dd><strong>{{ tiles.average.text }}</strong><span>{{ tiles.average.note }}</span></dd>
      </div>
      <div class="price-summary__tile">
        <dt>지금 살 때?</dt>
        <dd><strong :class="`price-summary__verdict--${tiles.verdict.tone}`">{{ tiles.verdict.text }}</strong><span>{{ tiles.verdict.note }}</span></dd>
      </div>
    </dl>
    <p v-if="store" class="price-summary__store" :class="`price-summary__store--${store.tone}`">
      <svg v-if="store.tone === 'good'" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12l4 4L19 6" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
      <span>{{ store.text }}</span>
    </p>
  </div>
</template>

<style scoped>
.price-summary { display: grid; gap: 14px; min-width: 0; }
.price-summary__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.price-summary__price { margin: 0; color: var(--ink); font-size: 32px; font-variant-numeric: tabular-nums; font-weight: 800; letter-spacing: -.02em; line-height: 1; overflow-wrap: anywhere; }
.price-summary__head .price-change { padding: 4px 10px; font-size: var(--text-sm); }
.price-summary__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 0; }
.price-summary__tile { min-width: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg); }
.price-summary__tile dt { color: var(--muted); font-size: 11px; }
.price-summary__tile dd { display: grid; gap: 1px; margin: 3px 0 0; }
.price-summary__tile strong { color: var(--ink); font-size: var(--text-body); font-variant-numeric: tabular-nums; font-weight: 700; overflow-wrap: anywhere; }
.price-summary__tile span { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.price-summary__tile .price-summary__verdict--good { color: var(--success); }
.price-summary__tile .price-summary__verdict--near { color: var(--warning); }
.price-summary__store { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: var(--text-sm); line-height: 1.4; overflow-wrap: anywhere; }
.price-summary__store svg { flex: none; width: 16px; height: 16px; margin-top: 1px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.price-summary__store--good { color: var(--success); }
.price-summary__store--warn { color: var(--warning); }
</style>
