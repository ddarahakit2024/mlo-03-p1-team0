<script setup>
import { ref, watch } from 'vue'
import { MAX_SEARCH_LENGTH } from '../stores/productViewModel.js'

const props = defineProps({ keyword: { type: String, default: '' } })
const emit = defineEmits(['update:keyword', 'search'])
const value = ref(props.keyword)
watch(() => props.keyword, (next) => { value.value = next })

function submit() {
  emit('update:keyword', value.value)
  emit('search', value.value.trim())
}
</script>

<template>
  <form class="product-search" role="search" @submit.prevent="submit">
    <label class="sr-only" for="product-search">상품 검색</label>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></svg>
    <input id="product-search" v-model="value" type="search" :maxlength="MAX_SEARCH_LENGTH" placeholder="부품 이름, 모델명 검색 (예: RTX 4070)" />
    <button type="submit">검색</button>
  </form>
</template>

<style scoped>
.product-search { position: relative; display: flex; align-items: center; min-width: 0; height: 40px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.product-search:focus-within { border-color: var(--brand); }
.product-search svg { position: absolute; top: 50%; left: 12px; width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; transform: translateY(-50%); pointer-events: none; }
.product-search input { min-width: 0; flex: 1; height: 100%; padding: 0 8px 0 38px; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: var(--text-body); }
.product-search input::placeholder { color: var(--muted); }
.product-search button { flex: none; height: 30px; margin-right: 4px; padding: 0 12px; border: 0; border-radius: 7px; background: var(--brand); color: var(--brand-ink); font-size: var(--text-xs); font-weight: 700; cursor: pointer; }
.product-search button:hover { background: var(--brand-strong); }
.product-search button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 480px) { .product-search input { font-size: var(--text-sm); } }
</style>
