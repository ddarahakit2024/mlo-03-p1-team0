<script setup>
import { computed, ref } from 'vue'
import PriceChangeBadge from './PriceChangeBadge.vue'
import PriceSparkline from './PriceSparkline.vue'
import ProductRating from './ProductRating.vue'
import { lowestLine, priceBadge } from '../stores/priceTrendViewModel.js'
import { PRODUCT_PLACEHOLDER, categoryName, formatPrice, getProductImage, getStockStatus, productPath, ratingSummary } from '../stores/productViewModel.js'

// 상품 카드의 링크 부분(사진·배지·브랜드·카테고리·평점·이름·30일 추세선·변동률·가격·1년 최저가 문구). 카드 전체가 상세 링크라서
// 버튼(비교·담기)은 ProductGrid 가 링크 밖에 둔다. 가격 추세(price_trend)가 없으면 추세 줄과 최저가 문구를 그리지 않는다.
const props = defineProps({ product: { type: Object, required: true } })
const imageBroken = ref(false)
const image = computed(() => (imageBroken.value ? PRODUCT_PLACEHOLDER : getProductImage(props.product)))
const stock = computed(() => getStockStatus(props.product.stock))
const trend = computed(() => props.product.price_trend || null)
const badge = computed(() => priceBadge(props.product))
const lowest = computed(() => lowestLine(trend.value))
const rated = computed(() => Boolean(ratingSummary(props.product.rating_average, props.product.review_count)))
</script>

<template>
  <a class="product-card" :href="productPath(product.id)">
    <div class="product-card__image">
      <img :src="image" :alt="`${product.name || '상품'} 이미지`" loading="lazy" @error="imageBroken = true" />
      <b v-if="badge" class="product-card__badge" :class="`product-card__badge--${badge.kind}`">{{ badge.label }}</b>
    </div>
    <div class="product-card__body">
      <p class="product-card__meta">
        {{ product.brand || 'MOA Parts' }}<span aria-hidden="true"> · </span>{{ categoryName(product.category) }}<span v-if="rated" aria-hidden="true"> · </span>
        <ProductRating class="product-card__rating" :average="product.rating_average ?? null" :count="product.review_count || 0" />
      </p>
      <h3>{{ product.name || '상품 이름' }}</h3>
      <div v-if="trend" class="product-card__trend">
        <PriceSparkline class="product-card__spark" :values="trend.sparkline_30d || []" :change-pct="trend.change_30d_pct ?? null" />
        <PriceChangeBadge :pct="trend.change_30d_pct ?? null" />
      </div>
      <div class="product-card__price">
        <strong>{{ formatPrice(product.price_krw) }}</strong>
        <span v-if="stock.tone !== 'ok'" class="shop-stock" :class="{ 'shop-stock--low': stock.tone === 'low', 'shop-stock--sold-out': stock.soldOut }">{{ stock.label }}</span>
      </div>
      <p v-if="lowest" class="product-card__lowest" :class="`product-card__lowest--${lowest.tone}`">{{ lowest.text }}</p>
    </div>
  </a>
</template>

<style scoped>
.product-card { display: flex; flex: 1; flex-direction: column; min-width: 0; color: inherit; text-decoration: none; }
.product-card:hover { color: inherit; text-decoration: none; }
.product-card:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; border-radius: var(--radius-md); }
.product-card__image { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: var(--image-bg); }
.product-card__image img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 18px; transition: transform var(--motion-fast) ease; }
.product-card:hover .product-card__image img { transform: scale(1.03); }
.product-card__badge { position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 6px; background: var(--ink); color: var(--brand-ink); font-size: 11px; font-weight: 800; line-height: 1.3; }
.product-card__badge--low { background: var(--success); }
.product-card__badge--drop { background: var(--brand); }
.product-card__body { display: flex; flex: 1; flex-direction: column; gap: 8px; padding: 14px 16px 12px; }
.product-card__meta { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; overflow-wrap: anywhere; }
.product-card__rating { color: var(--muted); font-weight: 600; }
.product-card h3 { margin: 0; color: var(--ink); font-size: 15px; font-weight: 700; letter-spacing: -.2px; line-height: 1.35; overflow-wrap: anywhere; text-wrap: pretty; }
.product-card__trend { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px; }
.product-card__trend .product-card__spark { flex: 0 1 110px; min-width: 64px; width: 110px; height: 32px; }
.product-card__price { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 8px; margin-top: auto; }
.product-card__price strong { color: var(--ink); font-size: 20px; font-weight: 800; letter-spacing: -.2px; font-variant-numeric: tabular-nums; }
.product-card__lowest { margin: -6px 0 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; font-variant-numeric: tabular-nums; }
.product-card__lowest--good { color: var(--success); }
.product-card__lowest--near { color: var(--warning); }
@media (max-width: 560px) {
  .product-card__image img { padding: 12px; }
  .product-card__body { gap: 6px; padding: 12px 12px 10px; }
  .product-card h3 { font-size: var(--text-sm); }
  .product-card__price strong { font-size: 17px; }
  .product-card__trend .product-card__spark { flex-basis: 100%; width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .product-card__image img { transition: none; } }
</style>
