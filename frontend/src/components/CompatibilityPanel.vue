<script setup>
import { computed, ref, useId } from 'vue'
import {
  BALANCE_BAR, COMPATIBILITY_TEXT, balanceAriaLabel, balanceLabelText, balanceX, balanceZone, compatibilityStatusText, compatibilityTone, formatBalanceScore,
  issueLevelLabel, powerText,
} from '../stores/compatibilityViewModel.js'

// 부품 호환성 결과(POST /compatibility/check 의 result)를 보여 준다. API 를 부르지 않는다: 화면이 확인하고 result·state 를 넘긴다.
// state: loading(확인 중) · ready(결과) · error(실패 → "다시 시도" 를 누르면 retry 를 알린다)
// context: cart(장바구니, 제목 h2)·quote_compose(견적 보내기, 제목 h3)는 전체 영역(상태 → 문제 목록 → 균형 막대 → 전력을 세로로 쌓는다),
//          quote_card(받은 견적 카드)는 디자인의 호환성 한 줄("✓ 부품 호환성 · 함께 쓸 수 있는 부품입니다", 상태 색 + 아이콘 글자)
//          + "호환성 자세히 보기"(aria-expanded)로 펼치는 문제 목록·균형·전력.
// 문제 목록은 수준 배지 글자(호환 안 됨·주의·안내)와 서버 문구를 그대로 보여 준다(색만으로 구분하지 않는다).
const props = defineProps({
  result: { type: Object, default: null },
  state: { type: String, default: 'loading' },
  context: { type: String, default: 'cart' },
})
const emit = defineEmits(['retry'])
const id = useId()
const titleId = `${id}-title`
const detailsId = `${id}-details`
const open = ref(false)

const compact = computed(() => props.context === 'quote_card')
const headingLevel = computed(() => (props.context === 'cart' ? 2 : 3))
const ready = computed(() => props.state === 'ready' && Boolean(props.result))
const statusText = computed(() => compatibilityStatusText(props.state, props.result))
const tone = computed(() => compatibilityTone(props.state, props.result))
const issues = computed(() => (ready.value && Array.isArray(props.result.issues) ? props.result.issues : []))
const balance = computed(() => (ready.value && props.result.balance && balanceX(props.result.balance.score) !== null ? props.result.balance : null))
const marker = computed(() => (balance.value ? balanceX(balance.value.score) : null))
const power = computed(() => (ready.value ? powerText(props.result.power) : ''))
const hasDetails = computed(() => issues.value.length > 0 || Boolean(balance.value) || Boolean(power.value))
const zone = balanceZone()
const STATUS_ICONS = { ok: '✓', warning: '!', error: '✕' }
</script>

<template>
  <component :is="compact ? 'div' : 'section'" class="compat" :class="[compact ? 'compat--compact' : 'compat--full', tone ? `compat--${tone}` : '']" :aria-labelledby="compact ? undefined : titleId">
    <template v-if="!compact">
      <h2 v-if="headingLevel === 2" :id="titleId" class="compat__title">{{ COMPATIBILITY_TEXT.title }}</h2>
      <h3 v-else :id="titleId" class="compat__title">{{ COMPATIBILITY_TEXT.title }}</h3>
    </template>
    <p v-if="state === 'loading'" class="compat__line" role="status"><span v-if="compact" class="compat__label">{{ COMPATIBILITY_TEXT.title }}</span><span>{{ statusText }}</span></p>
    <div v-else-if="state === 'error'" class="compat__line compat__line--fail" role="alert">
      <span v-if="compact" class="compat__label">{{ COMPATIBILITY_TEXT.title }}</span>
      <span class="compat__fail-text">{{ statusText }}</span>
      <button class="shop-button shop-button--secondary compat__retry" type="button" @click="emit('retry')">다시 시도</button>
    </div>
    <template v-else-if="ready">
      <div class="compat__line">
        <p class="compat__status" role="status"><span v-if="STATUS_ICONS[tone]" class="compat__icon" aria-hidden="true">{{ STATUS_ICONS[tone] }}</span><span v-if="compact" class="compat__label">{{ COMPATIBILITY_TEXT.title }}</span><span>{{ statusText }}</span></p>
        <button v-if="compact && hasDetails" class="compat__toggle" type="button" :aria-expanded="open ? 'true' : 'false'" :aria-controls="detailsId" @click="open = !open">{{ open ? '호환성 접기' : '호환성 자세히 보기' }}</button>
      </div>
      <div v-if="hasDetails" :id="detailsId" class="compat__details" :hidden="compact && !open">
        <ul v-if="issues.length" class="compat__issues">
          <li v-for="(issue, index) in issues" :key="`${issue.code}-${index}`" class="compat__issue">
            <span class="compat__badge" :class="`compat__badge--${issue.level}`">{{ issueLevelLabel(issue.level) }}</span>
            <span class="compat__message">{{ issue.message }}</span>
          </li>
        </ul>
        <div v-if="balance" class="compat__balance">
          <p class="compat__balance-title">
            <span>CPU ↔ 그래픽카드 균형</span>
            <strong>{{ balanceLabelText(balance.label) }}</strong>
            <span class="compat__score">점수 {{ formatBalanceScore(balance.score) }}</span>
          </p>
          <svg class="compat__bar" :viewBox="`0 0 ${BALANCE_BAR.width} ${BALANCE_BAR.height}`" role="img" :aria-label="balanceAriaLabel(balance)">
            <rect class="compat__track" :x="BALANCE_BAR.padding" y="10" :width="BALANCE_BAR.width - BALANCE_BAR.padding * 2" height="4" rx="2" />
            <rect class="compat__zone" :x="zone.x" y="7" :width="zone.width" height="10" rx="3" />
            <line class="compat__tick" :x1="BALANCE_BAR.width / 2" :x2="BALANCE_BAR.width / 2" y1="3" y2="21" />
            <circle class="compat__marker" :class="`compat__marker--${balance.label}`" :cx="marker" cy="12" r="7" />
          </svg>
          <div class="compat__scale" aria-hidden="true"><span>그래픽카드가 약함</span><span>균형 좋음</span><span>CPU 가 약함</span></div>
        </div>
        <p v-if="power" class="compat__power"><span class="compat__power-label">전력</span><span>{{ power }}</span></p>
      </div>
    </template>
  </component>
</template>

<style scoped>
.compat { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); }
.compat--compact { gap: 10px; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-2); }
.compat__title { margin: 0; color: var(--ink); font-size: 15px; font-weight: 700; letter-spacing: -.2px; }
.compat__line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.compat__line--fail { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); }
.compat__fail-text { flex: 1 1 220px; min-width: 0; }
.compat__retry { min-height: 40px; padding: 8px 14px; }
.compat__label { color: var(--muted); font-size: var(--text-xs); font-weight: 650; }
.compat__status { display: inline-flex; flex: 1 1 auto; align-items: center; gap: 8px; min-width: 0; margin: 0; color: var(--ink); font-size: var(--text-body); font-weight: 700; }
.compat__icon { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid currentColor; border-radius: 999px; font-size: var(--text-xs); font-weight: 800; line-height: 1; }
.compat--ok .compat__status { color: var(--success); }
.compat--warning .compat__status { color: var(--warning); }
.compat--error .compat__status { color: var(--danger); }
.compat__toggle { min-height: 40px; margin-left: auto; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: transparent; color: var(--brand); font-size: var(--text-xs); font-weight: 700; cursor: pointer; }
.compat__toggle:hover { border-color: var(--brand-line); background: var(--brand-soft); }
.compat__toggle:focus-visible, .compat__retry:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.compat__details { display: grid; gap: 12px; min-width: 0; }
.compat__details[hidden] { display: none; }
.compat__issues { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.compat__issue { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
.compat--compact .compat__issue { background: var(--surface); }
.compat__badge { flex-shrink: 0; padding: 2px 8px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-3); color: var(--ink); font-size: var(--text-xs); font-weight: 700; line-height: 1.6; white-space: nowrap; }
.compat__badge--error { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--danger-soft); color: var(--danger); }
.compat__badge--warning { border-color: color-mix(in srgb, var(--warning) 45%, transparent); background: var(--warning-soft); color: var(--warning); }
.compat__badge--info { color: var(--muted); }
.compat__message { flex: 1; min-width: 0; color: var(--ink); font-size: var(--text-sm); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.compat__balance { display: grid; gap: 6px; width: 100%; max-width: 460px; min-width: 0; }
.compat__balance-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 0; color: var(--muted); font-size: var(--text-sm); }
.compat__balance-title strong { color: var(--ink); font-size: var(--text-body); }
.compat__score { color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.compat__bar { display: block; width: 100%; height: auto; overflow: visible; }
.compat__track { fill: var(--surface-3); }
.compat__zone { fill: var(--success-soft); stroke: color-mix(in srgb, var(--success) 45%, transparent); stroke-width: 1; }
.compat__tick { stroke: var(--line-strong); stroke-width: 1.5; }
.compat__marker { fill: var(--warning); stroke: var(--surface); stroke-width: 2; }
.compat__marker--balanced { fill: var(--success); }
.compat__scale { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; color: var(--muted); font-size: var(--text-xs); line-height: 1.4; word-break: keep-all; }
.compat__scale span:nth-child(2) { text-align: center; }
.compat__scale span:last-child { text-align: right; }
.compat__power { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0; color: var(--ink); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.compat__power-label { color: var(--muted); font-size: var(--text-xs); font-weight: 650; }
/* 받은 견적 카드(quote_card): 상자 없이 한 줄. "부품 호환성 · 문구" 전체를 상태 색으로(아이콘 글자 ✓ ! ✕ 가 함께 있어 색만으로 구분하지 않는다) */
.compat--compact { gap: 8px; padding: 0; border: 0; border-radius: 0; background: transparent; }
.compat--compact .compat__line { font-size: var(--text-sm); font-weight: 600; }
.compat--compact .compat__label { color: inherit; font-size: var(--text-sm); font-weight: 600; }
.compat--compact .compat__label::after { margin: 0 6px; content: '·'; }
.compat--compact .compat__status { gap: 8px; font-size: var(--text-sm); font-weight: 600; }
.compat--compact .compat__icon { width: 18px; height: 18px; border-width: 1.5px; font-size: 11px; }
.compat--compact .compat__line--fail { padding: 8px 12px; }
.compat--compact .compat__toggle { min-height: 36px; padding: 0 10px; border-color: var(--line); font-size: var(--text-xs); }
.compat--compact .compat__details { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); }
@media (max-width: 640px) {
  .compat--full { padding: 14px; }
  .compat__toggle { margin-left: 0; }
}
</style>
