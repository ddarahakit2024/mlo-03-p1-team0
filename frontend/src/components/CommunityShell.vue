<script setup>
import { onMounted, ref } from 'vue'
import { COMMUNITY_NAV_LINKS, COMMUNITY_WRITE_LINKS, navCount } from '../stores/communityViewModel.js'

// 커뮤니티 화면(/community, /community/*, /questions/*)의 2단 레이아웃(디자인 MOA Parts "COMMUNITY SHELL"):
// 왼쪽 240px sticky aside(게시판 메뉴 + "바로 쓰기") + 오른쪽 본문(default slot).
// 링크 이름은 정확히 "커뮤니티 홈"·"질문 게시판"·"자유 게시판"·"견적 게시판"(시뮬레이터가 이 이름으로 찾는다). 아이콘·글 수는 aria-hidden 이라 이름에 들어가지 않는다.
// counts: 화면이 이미 받은 게시판 전체 수({ questions, free, build }). 없으면 숫자를 그리지 않는다(이것 때문에 따로 부르지 않는다).
// 760px 이하에서는 본문 위 가로 알약 목록 + "+ 견적 요청". 목록 안에서만 가로로 넘기고, 처음 그릴 때 지금 게시판 링크가 보이도록 목록만 옆으로 넘긴다.
defineProps({
  active: { type: String, default: '' },
  counts: { type: Object, default: () => ({}) },
})

const PENCIL = ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
const PLUS = ['M12 5v14', 'M5 12h14']

const links = ref(null)

onMounted(() => {
  const list = links.value
  const current = list?.querySelector?.('[aria-current="page"]')
  if (!current || !(list.scrollWidth > list.clientWidth)) return
  list.scrollLeft = Math.max(0, current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2)
})
</script>

<template>
  <div class="cm-shell">
    <aside class="cm-shell__aside" aria-label="커뮤니티 메뉴">
      <nav class="cm-shell__nav" aria-label="커뮤니티 게시판">
        <p class="cm-shell__label" aria-hidden="true">커뮤니티</p>
        <ul ref="links" class="cm-shell__links">
          <li v-for="link in COMMUNITY_NAV_LINKS" :key="link.key">
            <a class="cm-shell__link" :href="link.href" :aria-current="link.key === active ? 'page' : undefined">{{ link.label }}<span v-if="navCount(counts, link.key)" class="cm-shell__count" aria-hidden="true">{{ navCount(counts, link.key) }}</span></a>
          </li>
        </ul>
      </nav>
      <div class="cm-shell__write">
        <p id="cm-shell-write-label" class="cm-shell__label">바로 쓰기</p>
        <ul class="cm-shell__write-links" aria-labelledby="cm-shell-write-label">
          <li v-for="link in COMMUNITY_WRITE_LINKS" :key="link.key">
            <a class="cm-shell__write-link" :class="{ 'cm-shell__write-link--primary': link.primary }" :href="link.href"><svg class="cm-shell__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path v-for="d in (link.primary ? PLUS : PENCIL)" :key="d" :d="d" /></svg>{{ link.label }}</a>
          </li>
        </ul>
      </div>
      <a class="cm-shell__quick" href="/community/build/new">+ 견적 요청</a>
    </aside>
    <div class="cm-shell__main"><slot /></div>
  </div>
</template>

<style scoped>
.cm-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); align-items: start; gap: 24px; margin: 24px 0 80px; }
/* 열 폭을 0 이상으로 묶어야 모바일의 가로 게시판 목록이 aside 를 넓히지 않고 목록 안에서만 넘어간다 */
.cm-shell__aside { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.cm-shell__aside > * { min-width: 0; }
.cm-shell__nav { padding: 0; }
.cm-shell__label { margin: 0; padding: 0 12px 8px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; }
.cm-shell__links, .cm-shell__write-links { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.cm-shell__link { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px; border-left: 3px solid transparent; border-radius: var(--radius-sm); color: var(--ink); font-size: var(--text-body); font-weight: 700; text-decoration: none; white-space: nowrap; transition: background-color .18s ease, color .18s ease; }
.cm-shell__link:hover { background: var(--surface-2); }
.cm-shell__link[aria-current="page"] { border-left-color: var(--brand); background: var(--brand-soft); color: var(--brand-strong); }
.cm-shell__count { margin-left: auto; color: var(--muted); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
.cm-shell__write { display: flex; flex-direction: column; gap: 4px; padding-top: 16px; border-top: 1px solid var(--line); }
.cm-shell__write .cm-shell__label { padding-bottom: 4px; }
.cm-shell__write-links { gap: 8px; }
.cm-shell__write-link { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-size: var(--text-body); font-weight: 700; text-decoration: none; transition: border-color .18s ease, color .18s ease, background-color .18s ease; }
.cm-shell__write-link:hover { border-color: var(--brand); color: var(--brand-strong); }
.cm-shell__write-link--primary { border-color: var(--brand); background: var(--brand); color: var(--brand-ink); font-weight: 800; }
.cm-shell__write-link--primary:hover { border-color: var(--brand-strong); background: var(--brand-strong); color: var(--brand-ink); }
.cm-shell__icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.cm-shell__quick { display: none; }
.cm-shell a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
/* 본문 폭에 맞춰 목록·카드 모양을 바꾼다(community.css 의 @container cm-main) */
.cm-shell__main { display: flex; flex-direction: column; gap: 20px; min-width: 0; container: cm-main / inline-size; }
@media (max-width: 760px) {
  .cm-shell { grid-template-columns: minmax(0, 1fr); gap: 20px; margin-top: 20px; }
  .cm-shell__aside { position: static; flex-direction: row; align-items: center; gap: 6px; }
  .cm-shell__nav { flex: 1 1 auto; }
  .cm-shell__label, .cm-shell__write { display: none; }
  .cm-shell__links { flex-direction: row; gap: 6px; padding: 2px 0 4px; overflow-x: auto; scrollbar-width: none; }
  .cm-shell__links::-webkit-scrollbar { display: none; }
  .cm-shell__links li { flex: none; }
  .cm-shell__link { height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: var(--text-sm); }
  .cm-shell__link[aria-current="page"] { border-color: var(--brand); background: var(--brand); color: var(--brand-ink); }
  .cm-shell__count { display: none; }
  .cm-shell__quick { display: inline-flex; flex: none; align-items: center; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--brand); color: var(--brand-ink); font-size: var(--text-sm); font-weight: 800; text-decoration: none; white-space: nowrap; }
  .cm-shell a:focus-visible { outline-offset: -3px; }
}
</style>
