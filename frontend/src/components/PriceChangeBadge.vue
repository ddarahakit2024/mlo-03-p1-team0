<script setup>
import { computed } from 'vue'
import { changeArrow, changeTone, formatChangePct } from '../stores/priceTrendViewModel.js'

// 가격 변동률 배지: "30일 ▼ -5.2%". 내림은 초록, 오름은 빨강, 변동 없음은 회색이고 방향 글자(▲▼)를 함께 적는다.
const props = defineProps({
  pct: { type: Number, default: null },
  prefix: { type: String, default: '30일' },
})

const tone = computed(() => changeTone(props.pct))
const arrow = computed(() => changeArrow(props.pct))
const value = computed(() => formatChangePct(props.pct))
</script>

<template>
  <span class="price-change" :class="`price-change--${tone}`">
    <span v-if="prefix">{{ prefix }}</span><span v-if="arrow" aria-hidden="true">{{ arrow }}</span><span>{{ value }}</span>
  </span>
</template>

<style scoped>
.price-change { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: var(--surface-3); color: var(--muted); font-size: var(--text-xs); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.price-change--down { background: var(--success-soft); color: var(--success); }
.price-change--up { background: var(--danger-soft); color: var(--danger); }
</style>
