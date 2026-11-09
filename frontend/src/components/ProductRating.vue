<script setup>
import { computed } from 'vue'
import { ratingSummary } from '../stores/productViewModel.js'

// 평점 요약 "★ 4.5 (12)". 평균·리뷰 수는 서버 값(rating_average, review_count)이고, 리뷰가 없으면 아무것도 그리지 않는다.
const props = defineProps({ average: { type: Number, default: null }, count: { type: Number, default: 0 } })
const summary = computed(() => ratingSummary(props.average, props.count))
</script>

<template>
  <span v-if="summary" class="product-rating" role="img" :aria-label="summary.label"><span class="product-rating__star" aria-hidden="true">★</span> {{ summary.average }} <span class="product-rating__count">({{ summary.count }})</span></span>
</template>

<style scoped>
.product-rating { display: inline-block; color: var(--ink); font-size: var(--text-xs); font-weight: 750; white-space: nowrap; }
.product-rating__star { color: var(--warning); }
.product-rating__count { color: var(--muted); font-weight: 600; }
</style>
