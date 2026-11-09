<script setup>
import { ref } from 'vue'
import PriceChangeBadge from './PriceChangeBadge.vue'
import { PRODUCT_PLACEHOLDER, categoryName, formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'

// 견적 답글의 부품 목록(디자인 "받은 견적" 카드의 부품 줄): 사진 · 상품 이름 링크 · "브랜드 · 카테고리 · N개" · 줄 금액(2개 이상이면 개당 판매가) · 30일 변동(값이 있을 때만).
// 금액은 서버가 계산한 값(price_krw, line_total_krw, items_total_krw)을 그대로 보여 준다. 재고가 0 이면 "품절".
// caption 은 목록 이름(aria-label). showTotal=false 면 합계 줄을 그리지 않는다(견적 카드가 위에 합계를 크게 보여 줄 때).
// 견적 카드처럼 한 화면에 여러 개를 둘 때는 showNote=false 로 가격 기준 안내를 한 번만 보여 준다.
defineProps({
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  caption: { type: String, default: '부품 목록' },
  showNote: { type: Boolean, default: true },
  showTotal: { type: Boolean, default: true },
})
const brokenImages = ref([])

function imageSource(item) {
  return brokenImages.value.includes(item.product_id) ? PRODUCT_PLACEHOLDER : getProductImage(item)
}

function markBroken(item) {
  if (!brokenImages.value.includes(item.product_id)) brokenImages.value = [...brokenImages.value, item.product_id]
}

function isSoldOut(item) {
  return item.stock != null && Number(item.stock) <= 0
}

// 30일 변동률: 줄에 있으면(change_30d_pct 또는 price_trend.change_30d_pct) 보여 주고, 없으면 그리지 않는다
function changePct(item) {
  const value = item.change_30d_pct ?? item.price_trend?.change_30d_pct
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value)
}

function lineTotal(item) {
  return item.line_total_krw ?? (Number(item.price_krw) || 0) * (Number(item.quantity) || 0)
}
</script>

<template>
  <div class="cm-parts">
    <ul class="cm-parts__list" :aria-label="`${caption} ${items.length}줄`">
      <li v-for="item in items" :key="item.product_id" class="cm-parts__row">
        <span class="cm-parts__photo"><img :src="imageSource(item)" :alt="`${item.name || '상품'} 이미지`" width="44" height="44" loading="lazy" @error="markBroken(item)" /></span>
        <span class="cm-parts__copy">
          <a class="cm-parts__name" :href="productPath(item.product_id)">{{ item.name || '상품' }}</a>
          <span class="cm-parts__meta">{{ [item.brand, categoryName(item.category), `${item.quantity}개`].filter(Boolean).join(' · ') }}<span v-if="isSoldOut(item)" class="cm-parts__sold-out">품절</span></span>
        </span>
        <span class="cm-parts__price">
          <strong class="cm-parts__line">{{ formatPrice(lineTotal(item)) }}</strong>
          <span v-if="Number(item.quantity) > 1" class="cm-parts__unit">개당 {{ formatPrice(item.price_krw) }}</span>
          <PriceChangeBadge v-if="changePct(item) !== null" :pct="changePct(item)" />
        </span>
      </li>
    </ul>
    <p v-if="showTotal" class="cm-parts__total"><span>합계</span><strong>{{ formatPrice(total) }}</strong></p>
    <p v-if="showNote" class="cm-parts__note">금액은 지금 MOA Parts 판매가 기준입니다. 가격이 바뀌면 합계도 바뀝니다.</p>
  </div>
</template>

<style scoped>
.cm-parts { min-width: 0; }
.cm-parts__list { margin: 0; padding: 0; list-style: none; }
.cm-parts__row { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 20px; border-bottom: 1px solid var(--line); transition: background-color .18s ease; }
.cm-parts__row:hover { background: var(--surface-2); }
.cm-parts__photo { display: flex; flex: none; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 3px; border-radius: 8px; background: var(--image-bg); }
.cm-parts__photo img { display: block; width: 100%; height: 100%; object-fit: contain; }
.cm-parts__copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
.cm-parts__name { overflow: hidden; color: var(--ink); font-size: var(--text-body); font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.cm-parts__name:hover { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.cm-parts__name:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.cm-parts__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
.cm-parts__sold-out { padding: 1px 7px; border: 1px solid var(--danger); border-radius: 999px; background: var(--danger-soft); color: var(--danger); font-size: 11px; font-weight: 700; }
.cm-parts__price { display: grid; flex: none; justify-items: end; gap: 2px; text-align: right; }
.cm-parts__line { color: var(--ink); font-size: var(--text-body); font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cm-parts__unit { color: var(--muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cm-parts__total { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0; padding: 12px 20px; color: var(--muted); font-size: var(--text-sm); }
.cm-parts__total strong { color: var(--brand-strong); font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
.cm-parts__note { margin: 8px 20px 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
/* 커뮤니티 본문 칸(CommunityShell 의 cm-main 컨테이너)이 좁으면 여백을 줄이고 이름을 두 줄까지 보여 준다 */
@container cm-main (max-width: 620px) {
  .cm-parts__row { align-items: flex-start; padding: 10px 14px; }
  .cm-parts__name { white-space: normal; overflow-wrap: anywhere; }
  .cm-parts__total { padding: 12px 14px; }
  .cm-parts__note { margin: 8px 14px 0; }
}
</style>
