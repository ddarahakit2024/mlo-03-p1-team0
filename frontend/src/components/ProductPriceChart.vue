<script setup>
import { computed, ref, watch } from 'vue'
import { chartIndexAt, formatChartDate, priceTrendChart, priceTrendChartLabel, stepChartIndex } from '../stores/priceHistoryViewModel.js'
import { changeArrow, formatChangePct } from '../stores/priceTrendViewModel.js'
import { formatPrice } from '../stores/productViewModel.js'

// 상품 상세 "가격 추이"의 선 그래프(SVG, 라이브러리 없음)와 아래 통계 줄(현재가·기간 변동·최저·최고·평균).
// - points: 날마다 MOA Parts 판매가([{ date: 'YYYY-MM-DD', price }], priceHistoryViewModel.dailyStorePrices)
// - lowest: 1년 최저가(점선, price_trend.lowest_1y_krw), periodLabel: '1주'·'1달'·'3달'·'1년', days: 기간 일수(기록이 더 짧으면 안내)
// 마우스·손가락(pointer)으로 그래프 위를 움직이거나, 그래프에 초점을 두고 ←·→(Home·End·Esc)로 날을 고르면 세로선·점·툴팁을 보여 준다.
// 좌표 계산은 stores 순수 함수(priceTrendChart)가 맡고, 텍스트 대안은 svg 의 aria-label(기간·처음과 마지막·최저·최고·평균)이다.
const props = defineProps({
  points: { type: Array, default: () => [] },
  lowest: { type: Number, default: null },
  periodLabel: { type: String, default: '' },
  days: { type: Number, default: 0 },
})

const hoverIndex = ref(null)
// 키보드로 고른 날만 읽어 준다(마우스로 움직일 때마다 읽지 않게)
const announcement = ref('')
const chart = computed(() => priceTrendChart(props.points, { lowest: props.lowest, hoverIndex: hoverIndex.value }))
const label = computed(() => priceTrendChartLabel(chart.value, props.points, { periodLabel: props.periodLabel, lowest: props.lowest }))
const shorter = computed(() => props.days > 0 && props.points.length > 0 && props.points.length < props.days)
const stats = computed(() => chart.value?.stats || null)

watch(() => props.points, () => {
  hoverIndex.value = null
  announcement.value = ''
})

function pointAt(event) {
  const rect = event.currentTarget?.getBoundingClientRect?.()
  if (!rect?.width) return
  hoverIndex.value = chartIndexAt(chart.value, (event.clientX - rect.left) / rect.width)
}

function clearHover() {
  hoverIndex.value = null
}

function moveByKey(event) {
  const next = stepChartIndex(hoverIndex.value, event.key, chart.value?.count || 0)
  if (next === undefined) return
  event.preventDefault()
  hoverIndex.value = next
  const point = next === null ? null : props.points[next]
  announcement.value = point ? `${formatChartDate(point.date)} ${formatPrice(point.price)}` : ''
}

function leave() {
  hoverIndex.value = null
  announcement.value = ''
}
</script>

<template>
  <div v-if="chart" class="trend-chart">
    <div class="trend-chart__plot">
      <svg
        class="trend-chart__svg"
        :viewBox="`0 0 ${chart.width} ${chart.height}`"
        role="img"
        :aria-label="label"
        aria-describedby="trend-chart-help"
        tabindex="0"
        @pointermove="pointAt"
        @pointerdown="pointAt"
        @pointerleave="clearHover"
        @keydown="moveByKey"
        @blur="leave"
      >
        <defs>
          <linearGradient id="trend-chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop class="trend-chart__stop" offset="0" stop-opacity=".32" />
            <stop class="trend-chart__stop" offset="1" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g v-for="row in chart.grid" :key="row.label + row.y">
          <line class="trend-chart__grid" :x1="chart.left" :x2="chart.width - chart.right" :y1="row.y" :y2="row.y" />
          <text class="trend-chart__axis" x="0" :y="row.labelY">{{ row.label }}</text>
        </g>
        <line v-if="chart.lowY !== null" class="trend-chart__low" :x1="chart.left" :x2="chart.width - chart.right" :y1="chart.lowY" :y2="chart.lowY" />
        <path class="trend-chart__area" :d="chart.area" fill="url(#trend-chart-area)" />
        <path class="trend-chart__line" :d="chart.line" />
        <text v-for="tick in chart.xLabels" :key="tick.x" class="trend-chart__axis" :x="tick.x" :y="chart.height - 8" :text-anchor="tick.anchor">{{ tick.label }}</text>
        <g v-if="chart.hover" class="trend-chart__hover">
          <line class="trend-chart__cross" :x1="chart.hover.x" :x2="chart.hover.x" :y1="chart.top - 4" :y2="chart.base" />
          <circle class="trend-chart__hover-dot" :cx="chart.hover.x" :cy="chart.hover.y" r="5" />
        </g>
        <circle class="trend-chart__last" :cx="chart.last.x" :cy="chart.last.y" r="4" />
      </svg>
      <div v-if="chart.hover" class="trend-chart__tip" :style="{ left: `${chart.hover.left}%` }" aria-hidden="true">
        <span>{{ chart.hover.date }}</span><strong>{{ formatPrice(chart.hover.price) }}</strong>
      </div>
    </div>
    <p id="trend-chart-help" class="sr-only">그래프에 초점을 두고 왼쪽·오른쪽 화살표로 날짜를 옮기면 그날 가격을 읽어 줍니다.</p>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <p v-if="shorter" class="trend-chart__note">가격 기록은 {{ formatChartDate(points[0].date) }}부터 있어요.</p>
    <dl class="trend-chart__stats">
      <div><dt>현재가</dt><dd>{{ formatPrice(stats.last) }}</dd></div>
      <div><dt>{{ periodLabel }} 변동</dt><dd :class="`trend-chart__change--${stats.tone}`"><span v-if="changeArrow(stats.changePct)" class="trend-chart__arrow" aria-hidden="true">{{ changeArrow(stats.changePct) }}</span>{{ formatChangePct(stats.changePct) }}</dd></div>
      <div><dt>{{ periodLabel }} 최저</dt><dd class="trend-chart__min">{{ formatPrice(stats.min) }}</dd></div>
      <div><dt>{{ periodLabel }} 최고</dt><dd>{{ formatPrice(stats.max) }}</dd></div>
      <div><dt>{{ periodLabel }} 평균</dt><dd>{{ formatPrice(stats.average) }}</dd></div>
    </dl>
  </div>
</template>

<style scoped>
.trend-chart { display: grid; gap: 16px; min-width: 0; }
.trend-chart__plot { position: relative; min-width: 0; }
.trend-chart__svg { display: block; width: 100%; height: auto; overflow: visible; cursor: crosshair; touch-action: pan-y; border-radius: var(--radius-sm); }
.trend-chart__svg:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
.trend-chart__stop { stop-color: var(--brand); }
.trend-chart__grid { stroke: var(--line); vector-effect: non-scaling-stroke; }
.trend-chart__axis { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.trend-chart__low { stroke: var(--success); stroke-dasharray: 4 4; opacity: .7; vector-effect: non-scaling-stroke; }
.trend-chart__line { fill: none; stroke: var(--brand); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.trend-chart__cross { stroke: var(--muted); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.trend-chart__hover-dot { fill: var(--brand); stroke: var(--bg); stroke-width: 2; }
.trend-chart__last { fill: var(--brand); stroke: var(--surface); stroke-width: 2; }
.trend-chart__tip { position: absolute; top: 0; display: grid; gap: 1px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); pointer-events: none; transform: translateX(-50%); white-space: nowrap; }
.trend-chart__tip span { color: var(--muted); font-size: 11px; }
.trend-chart__tip strong { color: var(--ink); font-size: var(--text-body); font-variant-numeric: tabular-nums; font-weight: 800; }
.trend-chart__note { margin: -6px 0 0; color: var(--muted); font-size: var(--text-xs); }
.trend-chart__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 0; padding-top: 16px; border-top: 1px solid var(--line); }
.trend-chart__stats div { min-width: 0; }
.trend-chart__stats dt { color: var(--muted); font-size: 11px; }
.trend-chart__stats dd { margin: 3px 0 0; color: var(--ink); font-size: 16px; font-variant-numeric: tabular-nums; font-weight: 800; overflow-wrap: anywhere; }
.trend-chart__stats .trend-chart__min, .trend-chart__stats .trend-chart__change--down { color: var(--success); }
.trend-chart__stats .trend-chart__change--up { color: var(--danger); }
.trend-chart__stats .trend-chart__change--flat { color: var(--muted); }
.trend-chart__arrow { margin-right: 3px; font-size: .8em; }
/* 좁은 화면에서는 viewBox 가 줄어 글자가 작아지므로 축 글자를 키운다(SVG 의 px 는 viewBox 단위) */
@media (max-width: 640px) {
  .trend-chart__axis { font-size: 17px; }
  .trend-chart__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
