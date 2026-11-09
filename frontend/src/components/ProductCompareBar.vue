<script setup>
import { ref } from 'vue'
import { COMPARE_PATH, MAX_COMPARE_ITEMS } from '../stores/compareViewModel.js'
import { PRODUCT_PLACEHOLDER, categoryName, getProductImage } from '../stores/productViewModel.js'

// 비교함 막대(spec docs/specs/2026-11-01-event-enrichment.md "화면")를 디자인의 떠 있는 비교 트레이로 그린다. 비교함에 1개 이상 있을 때만 보인다.
// floating(기본): 화면 아래 가운데에 떠 있는 트레이(좁은 화면에서는 하단 탭 막대 위). 레이아웃(SiteLayout)이 그만큼 페이지 아래를 비운다.
// 비교 화면에서는 표를 가리지 않게 페이지 끝 제자리에 둔다(floating false).
// "비교 n/4", 담은 상품(작은 사진·이름·빼기), "비교하기" 링크(/compare), × 비우기, 안내(4개 초과·다른 카테고리, role="status")와 "비교함 비우고 담기".
// API·저장소를 부르지 않는다: 비교함 상태는 화면이 넘기고, 사용자의 행동은 emit 으로 알린다.
// 시뮬레이터가 상품 목록을 이름이 " 목록"으로 끝나는 list 로 찾으므로 이 막대의 목록 이름은 " 목록"으로 끝나지 않게 한다.
defineProps({
  items: { type: Array, default: () => [] },
  notice: { type: Object, default: null },
  showLink: { type: Boolean, default: true },
  floating: { type: Boolean, default: true },
})
const emit = defineEmits(['remove', 'clear', 'replace', 'dismiss'])
const broken = ref([])

function image(item) {
  return broken.value.includes(item.id) ? PRODUCT_PLACEHOLDER : getProductImage(item)
}

function markBroken(item) {
  if (!broken.value.includes(item.id)) broken.value = [...broken.value, item.id]
}
</script>

<template>
  <section v-if="items.length" class="compare-bar" :class="{ 'compare-bar--floating': floating }" aria-labelledby="compare-bar-title">
    <div class="compare-bar__tray">
      <!-- 안내 줄(role="status")은 늘 두고 비어 있을 때는 높이가 0 이다: 안내가 생기면 화면 읽기 프로그램이 바로 읽는다 -->
      <div class="compare-bar__notice" :class="{ 'compare-bar__notice--active': notice }">
        <p class="compare-bar__message" role="status">{{ notice?.text || '' }}</p>
        <button v-if="notice?.kind === 'category'" class="compare-bar__replace" type="button" @click="emit('replace')">비교함 비우고 담기</button>
        <button v-if="notice" class="compare-bar__icon" type="button" aria-label="안내 닫기" @click="emit('dismiss')"><span aria-hidden="true">×</span></button>
      </div>
      <div class="compare-bar__row">
        <h2 id="compare-bar-title" class="compare-bar__title">
          비교 <span class="compare-bar__count">{{ items.length }}/{{ MAX_COMPARE_ITEMS }}</span>
          <span class="compare-bar__category">{{ categoryName(items[0].category) }}</span>
        </h2>
        <ul class="compare-bar__items" aria-label="비교함에 담은 상품">
          <li v-for="item in items" :key="item.id" class="compare-bar__item">
            <img :src="image(item)" alt="" loading="lazy" @error="markBroken(item)" />
            <span class="compare-bar__name">{{ item.name || '상품' }}</span>
            <button class="compare-bar__remove" type="button" :aria-label="`${item.name || '상품'} 비교함에서 빼기`" @click="emit('remove', item.id)"><span aria-hidden="true">×</span></button>
          </li>
        </ul>
        <a v-if="showLink" class="compare-bar__go" :href="COMPARE_PATH">비교하기</a>
        <button class="compare-bar__icon compare-bar__clear" type="button" title="비우기" @click="emit('clear')"><span aria-hidden="true">×</span><span class="sr-only">비교함 비우기</span></button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.compare-bar { margin-top: 32px; }
.compare-bar__tray { display: grid; gap: 0; width: 100%; padding: 10px 10px 10px 14px; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--surface); }
/* floating: 화면 아래 가운데에 떠 있는 트레이. 제자리 높이는 0 이고 레이아웃이 페이지 아래를 비운다 */
.compare-bar--floating { margin: 0; }
.compare-bar--floating .compare-bar__tray { position: fixed; z-index: 45; bottom: 16px; left: 50%; width: max-content; max-width: calc(100% - 32px); transform: translateX(-50%); box-shadow: var(--shadow); }
.compare-bar__row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.compare-bar__title { display: flex; flex: none; align-items: baseline; gap: 6px; margin: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 700; white-space: nowrap; }
.compare-bar__count { font-variant-numeric: tabular-nums; }
.compare-bar__category { color: var(--muted); font-size: var(--text-xs); font-weight: 600; }
.compare-bar__items { display: flex; flex: 0 1 auto; gap: 6px; min-width: 0; margin: 0; padding: 0; overflow-x: auto; list-style: none; scrollbar-width: thin; }
.compare-bar__item { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; height: 36px; padding: 0 2px 0 3px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
.compare-bar__item img { flex: none; width: 28px; height: 28px; border-radius: 6px; background: var(--image-bg); object-fit: contain; }
.compare-bar__name { max-width: 132px; overflow: hidden; color: var(--ink); font-size: var(--text-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.compare-bar__remove { display: grid; flex: none; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
.compare-bar__remove:hover { background: var(--surface-3); color: var(--ink); }
.compare-bar__go { display: inline-flex; flex: none; align-items: center; height: 36px; padding: 0 14px; border-radius: 8px; background: var(--brand); color: var(--brand-ink); font-size: var(--text-sm); font-weight: 800; text-decoration: none; white-space: nowrap; }
.compare-bar__go:hover { background: var(--brand-strong); color: var(--brand-ink); text-decoration: none; }
.compare-bar__icon { display: grid; flex: none; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; }
.compare-bar__icon:hover { background: var(--surface-3); color: var(--ink); }
.compare-bar__notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; max-width: 560px; }
.compare-bar__notice--active { margin-bottom: 10px; padding: 8px 8px 8px 12px; border: 1px solid var(--brand-line); border-radius: var(--radius-sm); background: var(--brand-soft); }
.compare-bar__message { flex: 1 1 220px; min-width: 0; margin: 0; color: var(--ink); font-size: var(--text-sm); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.compare-bar__replace { min-height: 32px; padding: 0 12px; border: 1px solid var(--brand); border-radius: 8px; background: var(--brand); color: var(--brand-ink); font-size: var(--text-xs); font-weight: 800; cursor: pointer; }
.compare-bar__replace:hover { background: var(--brand-strong); }
.compare-bar :is(a, button):focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 759px) {
  .compare-bar--floating .compare-bar__tray { bottom: calc(76px + env(safe-area-inset-bottom)); width: calc(100% - 32px); }
  .compare-bar__tray { padding: 8px 8px 8px 12px; }
  .compare-bar__row { gap: 8px; }
  .compare-bar__category, .compare-bar__name { display: none; }
  .compare-bar__items { flex: 1 1 auto; }
  .compare-bar__go { padding: 0 12px; }
}
</style>
