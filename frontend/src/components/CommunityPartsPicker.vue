<script setup>
import { computed, ref } from 'vue'
import { MAX_PART_LINES, MAX_PART_QUANTITY, addPartLine, budgetGapBadge, estimatedBudgetGap, estimatedPartsTotal, formatBudget, removePartLine } from '../stores/communityViewModel.js'
import { PRODUCT_CATEGORIES, formatPrice } from '../stores/productViewModel.js'

// 견적 답글의 부품 고르기: 카테고리 → 상품 → 수량 → 추가, 줄 빼기, 예상 합계. 화면이 줄을 통째로 넘길 수도 있다(장바구니 구성으로 견적 보내기).
// API 를 부르지 않는다. 카테고리를 고르면 request-products(카테고리)를 알리고, 화면이 GET /products 결과를 catalog 로 넘긴다.
// catalog: { [카테고리]: { status: 'loading' | 'error' | 'ready', items, error } }
// 예상 합계는 화면 표시용(상품 목록 가격 × 수량)이다. 서버로 보내지 않는다. budgetKrw(글의 예산)를 넘기면 예상 합계와 예산을 비교한 배지도 보여 준다(표시용).
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  catalog: { type: Object, default: () => ({}) },
  idPrefix: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  budgetKrw: { type: Number, default: null },
})
const emit = defineEmits(['update:modelValue', 'request-products'])
const category = ref('')
const productId = ref('')
const quantity = ref(1)
const pickError = ref('')

const state = computed(() => props.catalog[category.value] || { status: 'idle', items: [], error: '' })
const products = computed(() => (state.value.status === 'ready' ? state.value.items || [] : []))
const full = computed(() => props.modelValue.length >= MAX_PART_LINES)
const total = computed(() => estimatedPartsTotal(props.modelValue))
const budgetBadge = computed(() => budgetGapBadge(estimatedBudgetGap(props.modelValue, props.budgetKrw)))
// 예산 비교 배지 색(community.css 의 cm-gap--*)
const GAP_CLASSES = { under: 'cm-gap--under', exact: 'cm-gap--exact', over: 'cm-gap--over' }
const productPlaceholder = computed(() => {
  if (!category.value) return '카테고리를 먼저 골라 주세요'
  if (state.value.status === 'loading') return '상품을 불러오는 중...'
  return products.value.length ? '상품 선택' : '고를 상품이 없습니다'
})

function productLabel(product) {
  const soldOut = product.stock != null && Number(product.stock) <= 0 ? ' (품절)' : ''
  return `${product.name} · ${formatPrice(product.price_krw)}${soldOut}`
}

function chooseCategory(value) {
  category.value = value
  productId.value = ''
  pickError.value = ''
  if (value) emit('request-products', value)
}

function chooseProduct(value) {
  productId.value = value
  pickError.value = ''
}

function addLine() {
  const product = products.value.find((item) => String(item.id) === String(productId.value)) || null
  const result = addPartLine(props.modelValue, product, quantity.value)
  pickError.value = result.error
  if (result.error) return
  emit('update:modelValue', result.lines)
  productId.value = ''
  quantity.value = 1
}

function removeLine(line) {
  pickError.value = ''
  emit('update:modelValue', removePartLine(props.modelValue, line.product_id))
}
</script>

<template>
  <section class="cm-picker" :aria-labelledby="`${idPrefix}-title`">
    <div class="cm-picker__heading">
      <h3 :id="`${idPrefix}-title`">부품 목록 <span>선택</span></h3>
      <span class="cm-picker__count">{{ modelValue.length }} / {{ MAX_PART_LINES }}줄</span>
    </div>
    <p class="cm-picker__help">MOA Parts 판매 상품에서 카테고리 → 상품 → 수량 순서로 골라 추가해 주세요.</p>
    <div class="cm-picker__controls">
      <div class="cm-picker__field">
        <label :for="`${idPrefix}-category`">카테고리</label>
        <select :id="`${idPrefix}-category`" :value="category" :disabled="disabled" @change="chooseCategory($event.target.value)">
          <option value="">카테고리 선택</option>
          <option v-for="item in PRODUCT_CATEGORIES" :key="item.code" :value="item.code">{{ item.name }}</option>
        </select>
      </div>
      <div class="cm-picker__field cm-picker__field--product">
        <label :for="`${idPrefix}-product`">상품</label>
        <select :id="`${idPrefix}-product`" :value="productId" :disabled="disabled || !products.length" @change="chooseProduct($event.target.value)">
          <option value="">{{ productPlaceholder }}</option>
          <option v-for="product in products" :key="product.id" :value="String(product.id)">{{ productLabel(product) }}</option>
        </select>
      </div>
      <div class="cm-picker__field cm-picker__field--quantity">
        <label :for="`${idPrefix}-quantity`">수량</label>
        <select :id="`${idPrefix}-quantity`" :value="quantity" :disabled="disabled" @change="quantity = Number($event.target.value)">
          <option v-for="count in MAX_PART_QUANTITY" :key="count" :value="count">{{ count }}개</option>
        </select>
      </div>
      <button class="cm-button cm-button--secondary cm-picker__add" type="button" :disabled="disabled || full" @click="addLine">추가</button>
    </div>
    <p v-if="state.status === 'loading'" class="cm-picker__status" role="status">상품을 불러오는 중입니다...</p>
    <div v-else-if="state.status === 'error'" class="cm-picker__status cm-picker__status--error" role="alert">
      <span>{{ state.error }}</span>
      <button class="cm-button cm-button--secondary" type="button" :disabled="disabled" @click="emit('request-products', category)">다시 시도</button>
    </div>
    <p v-else-if="state.status === 'ready' && !products.length" class="cm-picker__status">이 카테고리에는 판매 중인 상품이 없습니다. 다른 카테고리를 골라 주세요.</p>
    <p v-if="full" class="cm-picker__status">부품은 {{ MAX_PART_LINES }}줄까지 붙일 수 있습니다.</p>
    <p v-if="pickError" class="cm-picker__error" role="alert">{{ pickError }}</p>
    <ol v-if="modelValue.length" class="cm-picker__lines">
      <li v-for="line in modelValue" :key="line.product_id" class="cm-picker__line">
        <span class="cm-picker__line-copy"><strong>{{ line.name }}</strong><span>{{ [line.brand, `${formatPrice(line.price_krw)} × ${line.quantity}개`].filter(Boolean).join(' · ') }}</span></span>
        <span class="cm-picker__line-total">{{ formatPrice(line.price_krw * line.quantity) }}</span>
        <button class="cm-picker__remove" type="button" :aria-label="`${line.name} 빼기`" :disabled="disabled" @click="removeLine(line)">빼기</button>
      </li>
    </ol>
    <p v-else class="cm-picker__empty">아직 고른 부품이 없습니다. 부품 없이 댓글만 남겨도 됩니다.</p>
    <p class="cm-picker__total"><span>예상 합계</span><strong>{{ formatPrice(total) }}</strong></p>
    <p v-if="budgetBadge" class="cm-picker__budget"><span>예산 {{ formatBudget(budgetKrw) }}과 비교</span><span class="cm-gap" :class="GAP_CLASSES[budgetBadge.tone]">{{ budgetBadge.label }}</span></p>
    <p class="cm-picker__help">예상 합계는 지금 상품 목록 가격으로 계산한 참고 금액입니다. 등록하면 판매가로 다시 계산한 합계가 보입니다.</p>
  </section>
</template>

<style scoped>
.cm-picker { display: grid; gap: 12px; margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
.cm-picker__heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.cm-picker__heading h3 { margin: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 800; }
.cm-picker__heading h3 span { margin-left: 6px; color: var(--muted); font-size: var(--text-xs); font-weight: 500; }
.cm-picker__count { color: var(--muted); font-size: var(--text-xs); }
.cm-picker__help { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.7; }
.cm-picker__controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 110px) auto; align-items: end; gap: 10px; }
.cm-picker__field { display: grid; gap: 6px; min-width: 0; }
.cm-picker__field label { color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.cm-picker__field select { width: 100%; min-width: 0; min-height: 44px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-size: var(--text-sm); text-overflow: ellipsis; cursor: pointer; }
.cm-picker__field select:focus { border-color: var(--brand); outline: none; }
.cm-picker__field select:disabled { opacity: .55; cursor: not-allowed; }
.cm-picker__field select:focus-visible, .cm-picker__remove:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.cm-picker__add { min-width: 72px; }
.cm-picker__status { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
.cm-picker__status--error { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); }
.cm-picker__error { margin: 0; color: var(--danger); font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
.cm-picker__lines { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.cm-picker__line { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.cm-picker__line-copy { display: grid; flex: 1; gap: 2px; min-width: 0; }
.cm-picker__line-copy strong { color: var(--ink); font-size: var(--text-sm); font-weight: 650; overflow-wrap: anywhere; }
.cm-picker__line-copy span { color: var(--muted); font-size: var(--text-xs); overflow-wrap: anywhere; }
.cm-picker__line-total { color: var(--ink); font-size: var(--text-sm); font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cm-picker__remove { min-width: 44px; min-height: 44px; padding: 4px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: transparent; color: var(--danger); font-size: var(--text-xs); font-weight: 600; cursor: pointer; }
.cm-picker__remove:hover:not(:disabled) { border-color: var(--danger); background: var(--danger-soft); }
.cm-picker__remove:disabled { opacity: .5; cursor: not-allowed; }
.cm-picker__empty { margin: 0; padding: 12px; border: 1px dashed var(--line); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--text-xs); text-align: center; }
.cm-picker__total { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: var(--text-sm); }
.cm-picker__total strong { color: var(--brand-strong); font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.cm-picker__budget { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin: -4px 0 0; color: var(--muted); font-size: var(--text-xs); }
/* 커뮤니티 본문 칸(CommunityShell 의 cm-main 컨테이너)이 좁으면 쌓는다 */
@container cm-main (max-width: 620px) {
  .cm-picker { padding: 14px; }
  .cm-picker__controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .cm-picker__field--product { grid-column: 1 / -1; grid-row: 2; }
  .cm-picker__add { grid-column: 1 / -1; }
  .cm-picker__line { flex-wrap: wrap; }
  .cm-picker__line-copy { flex-basis: 100%; }
  .cm-picker__line-total { flex: 1; }
}
</style>
