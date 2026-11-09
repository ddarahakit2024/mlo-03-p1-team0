<script setup>
// 상품 상세의 제목 부분: 윗줄 "브랜드 · 카테고리"(기본 slot 이 뒤에 붙는다. 상세는 " · ★ 평점 (리뷰 수)"), 상품 이름 h1(화면의 하나뿐인 h1), 한 줄 요약.
defineProps({ name: { type: String, required: true }, brand: { type: String, default: '' }, categoryName: { type: String, default: '' }, summary: { type: String, default: '' } })
</script>

<template>
  <header class="product-summary">
    <p class="product-summary__meta">
      <span v-if="brand">{{ brand }}</span>
      <span v-if="brand && categoryName" aria-hidden="true">·</span>
      <span v-if="categoryName">{{ categoryName }}</span>
      <slot />
    </p>
    <h1>{{ name }}</h1>
    <p v-if="summary" class="product-summary__text">{{ summary }}</p>
  </header>
</template>

<style scoped>
.product-summary { min-width: 0; }
.product-summary__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0; color: var(--muted); font-size: var(--text-sm); }
.product-summary h1 { margin: 6px 0 0; color: var(--ink); font-size: 26px; font-weight: 800; letter-spacing: -.02em; line-height: 1.25; overflow-wrap: anywhere; text-wrap: pretty; }
.product-summary__text { margin: 8px 0 0; color: var(--ink); font-size: var(--text-body); line-height: 1.5; overflow-wrap: anywhere; }
@media (max-width: 640px) { .product-summary h1 { font-size: 22px; } }
</style>
