<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { authSession, memberProfile } from '../stores/authSession.js'
import { goToMain, logoutError, profileInitial } from '../stores/authViewModel.js'
import { countBadge, siteStatus } from '../stores/siteStatus.js'
import { flushEvents, track } from '../stores/tracking.js'

// activePage: products(상품), alerts(가격 추적 = 마이페이지 가격 추적 탭), community(커뮤니티), compare(비교), cart·orders(프로필 메뉴),
// my(마이페이지), auth(로그인, 하단 탭 "마이"만). questions(질문 게시판 화면)는 커뮤니티 안의 게시판이라 community 와 같이 강조한다.
// 관리자 반품 관리(/admin/returns)·추천 학습(/admin/recommendations)은 spec 대로 active-page 가 없어 빈 값('')을 넘긴다(아무것도 강조하지 않는다)
const props = defineProps({ activePage: { type: String, default: 'products' }, showSearch: { type: Boolean, default: true } })

// 패널로 옮겨 가는 동안(버튼과 패널 사이 틈) 닫히지 않게 조금 기다렸다 닫는다
const MENU_CLOSE_DELAY_MS = 180

const profile = ref(null)
// 헤더 배지·토스트(장바구니 수량·비교함 개수·읽지 않은 알림 수·안내 문구). 화면이 siteStatus 의 setter·showToast 로 바꾼다
const status = ref(siteStatus.state)
const loggingOut = ref(false)
const logoutMessage = ref('')
const menuOpen = ref(false)
const menuRoot = ref(null)
const menuButton = ref(null)
let openedByHover = false
let skipFocusOpen = false
let closeTimer = null
let unsubscribe = null
let unsubscribeStatus = null

const communityActive = computed(() => props.activePage === 'community' || props.activePage === 'questions')
const myActive = computed(() => props.activePage === 'my' || props.activePage === 'alerts')
const compareBadge = computed(() => countBadge(status.value.compareCount))
const cartBadge = computed(() => countBadge(status.value.cartCount))
const unreadBadge = computed(() => countBadge(status.value.unreadCount))
const compareLabel = computed(() => (compareBadge.value ? `상품 비교, 비교함 ${compareBadge.value}개` : '상품 비교'))
const cartLabel = computed(() => (cartBadge.value ? `장바구니, ${cartBadge.value}개 담김` : '장바구니'))
const notificationLabel = computed(() => (unreadBadge.value ? `알림, 읽지 않은 알림 ${unreadBadge.value}개` : '알림'))
const toast = computed(() => status.value.toast)
const initial = computed(() => profileInitial(profile.value?.name))
const year = new Date().getFullYear()

// 로그아웃(POST /user/logout)에 성공하면 첫 화면으로 간다. 이동하는 동안에도 버튼을 막아 두 번 보내지 않는다.
// 그 전에 쌓인 이벤트를 먼저 보낸다: 쿠키가 있을 때 도착해야 서버가 subject 를 기록한다(최대 2초, 실패·시간 초과여도 로그아웃은 계속).
// logout 이벤트 자체는 성공 뒤에 남겨 subject 가 null 이지만 session_id·anonymous_id 로 이어진다
async function signOut() {
  if (loggingOut.value) return
  loggingOut.value = true
  logoutMessage.value = ''
  await flushEvents()
  try {
    await authSession.logout()
    track('logout')
    goToMain()
  } catch (failure) {
    logoutMessage.value = logoutError(failure)
    loggingOut.value = false
  }
}

// 프로필 메뉴(disclosure: 버튼 + aria-expanded + aria-controls). 마우스를 올리거나, 누르거나, 키보드로 포커스하면 열린다
function clearCloseTimer() {
  clearTimeout(closeTimer)
  closeTimer = null
}

function openMenu() {
  clearCloseTimer()
  menuOpen.value = true
}

function closeMenu() {
  clearCloseTimer()
  menuOpen.value = false
  openedByHover = false
}

function isInsideMenu(node) {
  return Boolean(node && menuRoot.value?.contains?.(node))
}

// 터치 기기는 누를 때 mouseenter 가 click 보다 먼저 온다. 그래서 마우스로 열린 메뉴를 누르면 닫지 않고 열어 둔다
function openByHover() {
  if (!menuOpen.value) openedByHover = true
  openMenu()
}

function closeSoon() {
  clearCloseTimer()
  closeTimer = setTimeout(closeMenu, MENU_CLOSE_DELAY_MS)
}

function toggleMenu() {
  if (menuOpen.value && openedByHover) {
    openedByHover = false
    openMenu()
  } else if (menuOpen.value) {
    closeMenu()
  } else {
    openMenu()
  }
}

// 키보드(Tab)로 버튼에 오면 연다. 마우스로 누를 때의 포커스는 :focus-visible 이 아니라서 click 의 토글과 겹치지 않는다
function openByFocus(event) {
  if (skipFocusOpen || !event?.target?.matches?.(':focus-visible')) return
  openMenu()
}

function focusMenuButton() {
  skipFocusOpen = true
  menuButton.value?.focus?.()
  skipFocusOpen = false
}

// Esc: 닫고 버튼으로 포커스를 돌려준다
function closeOnEscape(event) {
  if (event?.key !== 'Escape' || !menuOpen.value) return
  closeMenu()
  focusMenuButton()
}

// Tab 으로 메뉴 밖으로 나가면 닫는다(relatedTarget 이 없는 경우는 바깥 누르기가 맡는다)
function closeOnFocusLeave(event) {
  const next = event?.relatedTarget
  if (menuOpen.value && next && !isInsideMenu(next)) closeMenu()
}

function closeOnOutsideClick(event) {
  if (menuOpen.value && !isInsideMenu(event?.target)) closeMenu()
}

function closeOnDocumentEscape(event) {
  if (event?.key === 'Escape' && menuOpen.value) closeMenu()
}

// 로그인 상태는 공용 저장소(GET /user/me 를 페이지에서 한 번)에서 받는다. 화면이 다시 확인하면 헤더도 함께 바뀐다.
// 배지 숫자는 siteStatus.load()(회원이면 GET /cart·GET /notifications/unread-count 한 번)로 채우고, 화면이 바꾸면 따라간다
onMounted(() => {
  unsubscribe = authSession.subscribe((state) => {
    profile.value = memberProfile(state)
    if (!profile.value) closeMenu()
  })
  unsubscribeStatus = siteStatus.subscribe((state) => { status.value = state })
  authSession.load()
  siteStatus.load()
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnDocumentEscape)
  }
})
onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeStatus?.()
  clearCloseTimer()
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', closeOnOutsideClick)
    document.removeEventListener('keydown', closeOnDocumentEscape)
  }
})
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <a class="site-skip" href="#site-content">본문으로 이동</a>
      <div class="site-header__inner">
        <a class="site-brand" href="/" aria-label="MOA Parts 홈">
          <img class="site-brand__logo" src="/images/logo.png" alt="" width="40" height="40" />
          <span class="site-brand__name" aria-hidden="true">MOA <b>Parts</b></span>
        </a>
        <nav class="site-nav" aria-label="주요 메뉴">
          <a href="/products" :aria-current="activePage === 'products' ? 'page' : undefined">상품</a>
          <a href="/my?tab=alerts" :aria-current="activePage === 'alerts' ? 'page' : undefined">가격 추적</a>
          <a href="/community" :aria-current="communityActive ? 'page' : undefined">커뮤니티</a>
        </nav>
        <div class="site-header__search">
          <form v-if="showSearch" class="site-search" action="/products" role="search" aria-label="전체 상품 검색">
            <input name="search_action" type="hidden" value="submit" />
            <label class="sr-only" for="site-search">부품 이름, 모델명 검색</label>
            <input id="site-search" name="search" type="search" maxlength="200" placeholder="부품 이름, 모델명 검색 (예: RTX 4070, DDR5)" />
            <button type="submit" aria-label="상품 검색"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></svg></button>
          </form>
        </div>
        <div class="site-tools">
          <a class="site-icon site-icon--wide" href="/compare" title="비교" :aria-label="compareLabel" :aria-current="activePage === 'compare' ? 'page' : undefined">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>
            <span v-if="compareBadge" class="site-badge" aria-hidden="true">{{ compareBadge }}</span>
          </a>
          <a class="site-icon site-icon--wide" href="/cart" title="장바구니" :aria-label="cartLabel" :aria-current="activePage === 'cart' ? 'page' : undefined">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.5L22 7H6" /><circle cx="9.5" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /></svg>
            <span v-if="cartBadge" class="site-badge" aria-hidden="true">{{ cartBadge }}</span>
          </a>
          <a class="site-icon" href="/my?tab=notifications" title="알림" :aria-label="notificationLabel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
            <span v-if="unreadBadge" class="site-dot" aria-hidden="true"></span>
          </a>
          <a v-if="!profile" class="site-account" href="/login">로그인</a>
          <div
            v-else
            ref="menuRoot"
            class="site-menu"
            @mouseenter="openByHover"
            @mouseleave="closeSoon"
            @keydown="closeOnEscape"
            @focusout="closeOnFocusLeave"
          >
            <button
              ref="menuButton"
              class="site-profile"
              :class="{ 'site-profile--current': activePage === 'cart' || activePage === 'orders' || myActive }"
              type="button"
              :aria-expanded="menuOpen"
              aria-controls="site-profile-menu"
              title="마이페이지"
              @click="toggleMenu"
              @focus="openByFocus"
            >
              <span class="site-profile__avatar" aria-hidden="true">{{ initial }}</span>
              <span class="sr-only">{{ profile.name }} 계정 메뉴</span>
            </button>
            <div id="site-profile-menu" class="site-menu__panel" :hidden="!menuOpen">
              <p class="site-menu__name">{{ profile.name }}님</p>
              <ul class="site-menu__links">
                <li><a href="/my" :aria-current="myActive ? 'page' : undefined">마이페이지</a></li>
                <li><a href="/cart" :aria-current="activePage === 'cart' ? 'page' : undefined">장바구니</a></li>
                <li><a href="/orders" :aria-current="activePage === 'orders' ? 'page' : undefined">주문 내역</a></li>
                <!-- 관리자(GET /user/me 의 role 이 admin)만. 시뮬레이터는 메뉴 링크를 이름(exact)으로 찾으므로 장바구니·주문 내역의 이름·순서는 그대로 둔다 -->
                <li v-if="profile.role === 'admin'"><a href="/admin/returns">반품 관리</a></li>
                <!-- 추천 학습(spec docs/specs/2026-11-03-product-recommendations.md): 반품 관리와 같은 규칙으로 관리자만 -->
                <li v-if="profile.role === 'admin'"><a href="/admin/recommendations">추천 학습</a></li>
              </ul>
              <button class="site-menu__logout" type="button" :disabled="loggingOut" :aria-busy="loggingOut" @click="signOut">{{ loggingOut ? '로그아웃 중...' : '로그아웃' }}</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <p v-if="logoutMessage" class="site-alert" role="alert">{{ logoutMessage }}</p>
    <main id="site-content" class="site-main" tabindex="-1"><slot /></main>
    <footer class="site-footer">
      <div class="site-footer__inner">
        <a class="site-footer__brand" href="/"><img src="/images/logo.png" alt="" width="22" height="22" /><b>MOA Parts</b></a>
        <span>내 PC에 맞는 부품을 가장 좋은 가격에</span>
        <span>© {{ year }} MOA Parts</span>
      </div>
    </footer>
    <!-- 760px 아래의 하단 탭 막대(넓은 화면에서는 숨긴다). 비교·장바구니 숫자는 배지(aria-hidden)와 같은 내용의 숨김 글자로 읽힌다 -->
    <nav class="site-tabbar" aria-label="하단 메뉴">
      <a href="/products" :aria-current="activePage === 'products' ? 'page' : undefined">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg><span>상품</span>
      </a>
      <a href="/community" :aria-current="communityActive ? 'page' : undefined">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg><span>커뮤니티</span>
      </a>
      <a href="/compare" :aria-current="activePage === 'compare' ? 'page' : undefined">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg><span>비교</span>
        <span v-if="compareBadge" class="site-badge site-tabbar__badge" aria-hidden="true">{{ compareBadge }}</span><span v-if="compareBadge" class="sr-only">, 비교함 {{ compareBadge }}개</span>
      </a>
      <a href="/cart" :aria-current="activePage === 'cart' ? 'page' : undefined">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.5L22 7H6" /><circle cx="9.5" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /></svg><span>장바구니</span>
        <span v-if="cartBadge" class="site-badge site-tabbar__badge" aria-hidden="true">{{ cartBadge }}</span><span v-if="cartBadge" class="sr-only">, {{ cartBadge }}개 담김</span>
      </a>
      <a :href="profile ? '/my' : '/login'" :aria-current="myActive || activePage === 'auth' ? 'page' : undefined">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg><span>마이</span>
      </a>
    </nav>
    <!-- 화면이 siteStatus.showToast 로 띄우는 짧은 안내. 영역은 늘 두고(role=status) 문구만 바꾼다 -->
    <div class="site-toast-region" role="status" aria-live="polite">
      <p v-if="toast" :key="toast.id" class="site-toast">{{ toast.text }}</p>
    </div>
  </div>
</template>

<style scoped>
.site-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--ink); }
.site-header { position: sticky; z-index: 40; top: 0; border-bottom: 1px solid var(--line); background: var(--bg); background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(14px); }
.site-header__inner { display: flex; align-items: center; gap: 14px; max-width: calc(var(--content-width) + 40px); height: 64px; margin: 0 auto; padding: 0 20px; }
.site-skip { position: absolute; top: 8px; left: 24px; z-index: 50; padding: 12px 16px; transform: translateY(-160%); border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-ink); font-size: var(--text-body); }
.site-skip:focus { transform: none; }
.site-brand { display: inline-flex; flex: none; align-items: center; gap: 8px; color: var(--ink); font-size: 17px; font-weight: 800; letter-spacing: -.01em; text-decoration: none; white-space: nowrap; }
.site-brand__logo { display: block; width: 40px; height: 40px; object-fit: contain; }
.site-brand b { color: var(--brand); }
.site-nav { display: flex; flex: none; gap: 2px; margin-left: 6px; }
.site-nav a { display: inline-flex; align-items: center; min-height: 36px; padding: 8px 12px; border-radius: 8px; color: var(--muted); font-size: var(--text-body); font-weight: 600; text-decoration: none; white-space: nowrap; }
.site-nav a:hover, .site-nav a[aria-current="page"] { color: var(--ink); }
.site-nav a:hover { background: var(--surface-2); }
.site-header__search { display: flex; flex: 1; justify-content: center; min-width: 0; }
.site-search { position: relative; width: 100%; max-width: 460px; }
.site-search input[type="search"] { width: 100%; height: 40px; padding: 0 12px 0 40px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-size: var(--text-body); outline: none; }
.site-search input[type="search"]:focus { border-color: var(--brand); }
.site-search button { position: absolute; top: 0; left: 0; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); background: transparent; color: var(--muted); cursor: pointer; }
.site-search button:hover { color: var(--brand); }
.site-header svg, .site-tabbar svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.site-search svg { width: 18px; height: 18px; stroke-width: 2; }
.site-tools { display: flex; flex: none; align-items: center; gap: 2px; }
.site-icon { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-sm); color: var(--ink); }
.site-icon:hover, .site-icon[aria-current="page"] { background: var(--surface-2); }
.site-icon svg { width: 20px; height: 20px; }
.site-badge { position: absolute; top: 4px; right: 4px; display: flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--brand); color: var(--brand-ink); font-size: 10px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.site-dot { position: absolute; top: 6px; right: 8px; width: 10px; height: 10px; border: 2px solid var(--bg); border-radius: 50%; background: var(--danger); }
.site-account { display: inline-flex; align-items: center; height: 36px; margin-left: 6px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--ink); font-size: var(--text-sm); font-weight: 700; text-decoration: none; white-space: nowrap; }
.site-account:hover { border-color: var(--brand); color: var(--brand-strong); }
.site-menu { position: relative; margin-left: 6px; }
.site-profile { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
.site-profile__avatar { display: grid; place-items: center; width: 34px; height: 34px; border: 2px solid transparent; border-radius: 50%; background: var(--surface-3); color: var(--ink); font-size: var(--text-body); font-weight: 800; transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease; }
.site-profile:hover .site-profile__avatar, .site-profile[aria-expanded="true"] .site-profile__avatar { background: var(--brand); color: var(--brand-ink); }
.site-profile--current .site-profile__avatar { border-color: var(--brand); }
.site-menu__panel { position: absolute; z-index: 30; top: calc(100% + 10px); right: 0; display: grid; gap: 4px; width: max-content; min-width: 200px; max-width: calc(100vw - 32px); padding: 8px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow); }
/* 버튼과 패널 사이 틈에서도 마우스가 메뉴 안에 있는 것으로 본다 */
.site-menu__panel::before { position: absolute; top: -11px; right: 0; left: 0; height: 11px; content: ''; }
.site-menu__panel[hidden] { display: none; }
.site-menu__name { margin: 0; padding: 8px 14px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: var(--text-xs); font-weight: 700; overflow-wrap: anywhere; }
.site-menu__links { display: grid; gap: 2px; margin: 0; padding: 0 0 6px; border-bottom: 1px solid var(--line); list-style: none; }
.site-menu__links a, .site-menu__logout { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 0 14px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--ink); font-size: var(--text-sm); font-weight: 600; text-align: left; text-decoration: none; white-space: nowrap; cursor: pointer; }
.site-menu__links a:hover, .site-menu__logout:hover:not(:disabled) { background: var(--surface-2); }
.site-menu__links a[aria-current="page"] { background: var(--brand-soft); color: var(--brand); font-weight: 750; }
.site-menu__logout { margin-top: 2px; color: var(--muted); }
.site-menu__logout:hover:not(:disabled) { color: var(--ink); }
.site-menu__logout:disabled { opacity: .6; cursor: wait; }

.site-alert { width: min(var(--content-width), calc(100% - 40px)); margin: 16px auto 0; padding: 12px 16px; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); font-size: var(--text-body); line-height: 1.7; overflow-wrap: anywhere; }
.site-main { width: min(var(--content-width), calc(100% - 40px)); min-width: 0; flex: 1; margin: 0 auto; }
.site-main:focus { outline: none; }
.site-footer { margin-top: 64px; border-top: 1px solid var(--line); }
.site-footer__inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; max-width: calc(var(--content-width) + 40px); margin: 0 auto; padding: 22px 20px; color: var(--muted); font-size: var(--text-xs); }
.site-footer__brand { display: inline-flex; align-items: center; gap: 8px; color: var(--brand-strong); font-size: var(--text-sm); text-decoration: none; }
.site-footer__brand img { width: 22px; height: 22px; object-fit: contain; }

/* 하단 탭 막대: 760px 아래에서만 보인다 */
.site-tabbar { display: none; }
.site-tabbar a { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 0; color: var(--muted); font-size: 10px; font-weight: 700; text-decoration: none; }
.site-tabbar a[aria-current="page"] { color: var(--brand); }
.site-tabbar svg { width: 22px; height: 22px; }
.site-tabbar__badge { top: 6px; right: calc(50% - 20px); }

/* 토스트: 아래 가운데 알약. 비교함 막대(ProductCompareBar 의 떠 있는 막대)가 보이면 그 위로, 좁은 화면에서는 하단 탭 위로 올린다 */
.site-toast-region { position: fixed; z-index: 60; bottom: 24px; left: 50%; display: flex; justify-content: center; width: max-content; max-width: calc(100% - 32px); transform: translateX(-50%); pointer-events: none; }
.site-toast { margin: 0; padding: 10px 16px; border-radius: 999px; background: var(--ink); color: var(--bg); font-size: var(--text-sm); font-weight: 700; line-height: 1.5; text-align: center; box-shadow: var(--shadow); animation: site-toast-in .2s ease; overflow-wrap: anywhere; }
@keyframes site-toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
/* 떠 있는 비교함 막대가 페이지 끝(바닥글)을 가리지 않게 그만큼 아래를 비운다 */
.site-shell:has(.compare-bar--floating) { padding-bottom: 80px; }
.site-shell:has(.compare-bar--floating) .site-toast-region { bottom: 86px; }

@media (max-width: 1023px) {
  .site-brand__name { display: none; }
}
@media (max-width: 759px) {
  .site-shell { padding-bottom: calc(60px + env(safe-area-inset-bottom)); }
  .site-shell:has(.compare-bar--floating) { padding-bottom: calc(140px + env(safe-area-inset-bottom)); }
  .site-header__inner { gap: 10px; padding: 0 16px; }
  .site-nav, .site-icon--wide { display: none; }
  .site-menu, .site-account { margin-left: 2px; }
  .site-main, .site-alert { width: calc(100% - 32px); }
  .site-footer { margin-top: 40px; }
  .site-footer__inner { gap: 6px 16px; padding: 22px 16px; }
  .site-tabbar { position: fixed; z-index: 44; right: 0; bottom: 0; left: 0; display: grid; grid-template-columns: repeat(5, 1fr); height: calc(60px + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom); border-top: 1px solid var(--line); background: var(--bg); background: color-mix(in srgb, var(--bg) 96%, transparent); backdrop-filter: blur(14px); }
  .site-toast-region { bottom: calc(84px + env(safe-area-inset-bottom)); }
  .site-shell:has(.compare-bar--floating) .site-toast-region { bottom: calc(146px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) { .site-profile__avatar { transition: none; } }
</style>
