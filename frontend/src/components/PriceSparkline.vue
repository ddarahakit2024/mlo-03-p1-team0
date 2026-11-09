<script setup>
import { computed } from 'vue'
import { changeTone, sparklineLabel, sparklinePath } from '../stores/priceTrendViewModel.js'

// 최근 30일 가격 추세선. 색(내림 초록·오름 빨강·변동 없음 회색)만으로 구분하지 않도록 텍스트 대안(aria-label)에 시작가·현재가·변동률을 적는다.
const props = defineProps({
  values: { type: Array, default: () => [] },
  changePct: { type: Number, default: null },
  label: { type: String, default: '' },
})

const path = computed(() => sparklinePath(props.values))
const tone = computed(() => changeTone(props.changePct))
const description = computed(() => props.label || sparklineLabel(props.values, props.changePct))
</script>

<template>
  <svg v-if="path" class="price-sparkline" :class="`price-sparkline--${tone}`" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" :aria-label="description">
    <path :d="path" />
  </svg>
</template>

<style scoped>
.price-sparkline { display: block; width: 100%; height: 32px; overflow: visible; }
.price-sparkline path { fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.price-sparkline--down path { stroke: var(--success); }
.price-sparkline--up path { stroke: var(--danger); }
</style>
