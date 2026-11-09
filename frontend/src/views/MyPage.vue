<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { deleteAlert, fetchAlerts } from '../api/alertApi.js'
import { fetchMyPosts } from '../api/authApi.js'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api/notificationApi.js'
import { PriceChangeBadge, SiteLayout } from '../components/index.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import { goToMain, logoutError, profileInitial } from '../stores/authViewModel.js'
import { MY_PAGE_SIZE, MY_PAGE_TABS, alertGap, alertProgress, currentTime, formatMyDate, formatNotificationTime, isPlainClick, myPageError, myPagePath, myPageState, myPageSummary, myPageTab, myPostKindLabel, myPostPath, myPostReplyLabel, notificationIcon, notificationPath, openPath, pageCount, progressPercent, tabState } from '../stores/myPageViewModel.js'
import { PRODUCT_PLACEHOLDER, categoryName, formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'
import { siteStatus } from '../stores/siteStatus.js'
import { flushEvents, track } from '../stores/tracking.js'

// 마이페이지(/my): 머리말(이름·추적 수·읽지 않은 알림 수·로그아웃)과 탭 알림·가격 추적·내 글(주소 ?tab=notifications|alerts|posts, 바꾸면 replaceState).
// 로그인 상태는 공용 저장소(authSession)에서 받는다: 비로그인(또는 탭 요청의 401)은 로그인 안내, 확인 실패는 오류 + 다시 시도.
// 회원이면 가격 추적(GET /alerts, 머리말의 "추적 중 N개")과 지금 탭을 부르고, 다른 탭은 처음 열 때 부른다. 탭마다 로딩·오류·빈 목록·요청 경합을 따로 맡는다.
// 읽지 않은 알림 수는 헤더와 같은 siteStatus 를 쓰고, 알림을 받거나 읽으면 siteStatus.setUnreadCount 로 맞춘다.
const tab = ref(myPageTab(window.location.search))
const auth = ref(authSession.getState())
const expired = ref(false)
const unreadCount = ref(siteStatus.state.unreadCount)
const notifications = reactive({ status: 'idle', items: [], total: 0, page: 1, pageSize: MY_PAGE_SIZE, error: '' })
const alerts = reactive({ status: 'idle', items: [], error: '' })
const posts = reactive({ status: 'idle', items: [], total: 0, page: 1, pageSize: MY_PAGE_SIZE, error: '' })
const sections = { notifications, alerts, posts }
const requests = { notifications: 0, alerts: 0, posts: 0 }
const actionMessage = ref('')
const readingAll = ref(false)
const removing = ref([])
const opening = ref(null)
const loggingOut = ref(false)
const logoutMessage = ref('')
const brokenImages = reactive({})
const panelTitle = ref(null)
let unsubscribe = null
let unsubscribeStatus = null
let wasMember = false

const pageState = computed(() => myPageState({ authStatus: auth.value.status, expired: expired.value }))
const profile = computed(() => memberProfile(auth.value))
const initial = computed(() => profileInitial(profile.value?.name))
const summary = computed(() => myPageSummary({ alertCount: alerts.status === 'ready' ? alerts.items.length : null, unreadCount: unreadCount.value }))
const authErrorMessage = computed(() => myPageError(auth.value.error, '로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.'))
const notificationState = computed(() => tabState(notifications))
const alertState = computed(() => tabState(alerts))
const postState = computed(() => tabState(posts))
const notificationPages = computed(() => pageCount(notifications.total, notifications.pageSize))
const postPages = computed(() => pageCount(posts.total, posts.pageSize))
const hasUnread = computed(() => unreadCount.value > 0 || notifications.items.some((item) => !item.read))
const now = currentTime()

// 탭 요청 실패: 401 은 로그인이 만료된 것이라 화면 전체를 로그인 안내로 바꾸고, 그 밖은 그 탭의 오류 + 다시 시도
function fail(section, failure, fallback) {
  if (failure?.response?.status === 401) {
    expired.value = true
    section.status = 'idle'
    return
  }
  section.status = 'error'
  section.error = myPageError(failure, fallback)
}

async function loadNotifications(page = notifications.page) {
  const request = ++requests.notifications
  notifications.status = 'loading'
  notifications.error = ''
  try {
    const data = await fetchNotifications({ page, pageSize: MY_PAGE_SIZE })
    if (request !== requests.notifications) return
    notifications.items = data?.items || []
    notifications.total = data?.total ?? notifications.items.length
    notifications.page = data?.page ?? page
    notifications.pageSize = data?.page_size ?? MY_PAGE_SIZE
    notifications.status = 'ready'
    siteStatus.setUnreadCount(data?.unread_count)
  } catch (failure) {
    if (request !== requests.notifications) return
    fail(notifications, failure, '알림을 불러오지 못했어요. 다시 시도해 주세요.')
  }
}

async function loadAlerts() {
  const request = ++requests.alerts
  alerts.status = 'loading'
  alerts.error = ''
  try {
    const data = await fetchAlerts()
    if (request !== requests.alerts) return
    alerts.items = data?.items || []
    alerts.status = 'ready'
  } catch (failure) {
    if (request !== requests.alerts) return
    fail(alerts, failure, '가격 추적 목록을 불러오지 못했어요. 다시 시도해 주세요.')
  }
}

async function loadPosts(page = posts.page) {
  const request = ++requests.posts
  posts.status = 'loading'
  posts.error = ''
  try {
    const data = await fetchMyPosts({ page, pageSize: MY_PAGE_SIZE })
    if (request !== requests.posts) return
    posts.items = data?.items || []
    posts.total = data?.total ?? posts.items.length
    posts.page = data?.page ?? page
    posts.pageSize = data?.page_size ?? MY_PAGE_SIZE
    posts.status = 'ready'
  } catch (failure) {
    if (request !== requests.posts) return
    fail(posts, failure, '내 글을 불러오지 못했어요. 다시 시도해 주세요.')
  }
}

const loaders = { notifications: () => loadNotifications(), alerts: () => loadAlerts(), posts: () => loadPosts() }

// 회원으로 확인되면: 가격 추적(머리말 숫자)과 지금 탭
function start() {
  expired.value = false
  for (const section of Object.values(sections)) section.status = 'idle'
  loadAlerts()
  if (tab.value !== 'alerts') loaders[tab.value]()
}

function selectTab(next) {
  if (next === tab.value) return
  tab.value = next
  actionMessage.value = ''
  window.history?.replaceState?.(null, '', myPagePath(next))
  if (sections[next].status === 'idle') loaders[next]()
}

function recheckLogin() {
  expired.value = false
  wasMember = false
  authSession.refresh()
}

// 알림 누르기: 읽지 않은 알림은 읽음으로 바꾼 뒤(실패해도) 대상 화면으로 간다. 새 탭으로 여는 누르기는 막지 않고 읽음만 보낸다
async function markRead(item) {
  try {
    await markNotificationRead(item.id)
    if (!item.read) {
      item.read = true
      siteStatus.setUnreadCount(unreadCount.value - 1)
    }
  } catch { /* 읽음 표시는 보조 동작이다. 실패해도 이동한다 */ }
}

async function openNotification(event, item) {
  const path = notificationPath(item)
  if (!path || item.read) return
  if (!isPlainClick(event)) {
    markRead(item)
    return
  }
  event?.preventDefault?.()
  if (opening.value !== null) return
  opening.value = item.id
  await markRead(item)
  openPath(path)
}

async function readAll() {
  if (readingAll.value) return
  readingAll.value = true
  actionMessage.value = ''
  try {
    await markAllNotificationsRead()
    notifications.items = notifications.items.map((item) => ({ ...item, read: true }))
    siteStatus.setUnreadCount(0)
    siteStatus.showToast('알림을 모두 읽었어요')
  } catch (failure) {
    if (failure?.response?.status === 401) expired.value = true
    else actionMessage.value = myPageError(failure, '알림을 읽음으로 바꾸지 못했어요. 다시 시도해 주세요.')
  } finally {
    readingAll.value = false
  }
}

function dropAlert(productId) {
  alerts.items = alerts.items.filter((alert) => alert.product_id !== productId)
  siteStatus.showToast('추적을 해제했어요')
  panelTitle.value?.focus?.()
}

// 추적 해제(DELETE /alerts/{product_id}). 이미 없으면(404) 목록에서도 뺀다
async function removeAlert(alert) {
  const id = alert.product_id
  if (removing.value.includes(id)) return
  removing.value = [...removing.value, id]
  actionMessage.value = ''
  try {
    await deleteAlert(id)
    dropAlert(id)
  } catch (failure) {
    const status = failure?.response?.status
    if (status === 404) dropAlert(id)
    else if (status === 401) expired.value = true
    else actionMessage.value = myPageError(failure, '추적을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.')
  } finally {
    removing.value = removing.value.filter((value) => value !== id)
  }
}

function imageOf(product) {
  return brokenImages[product?.id] ? PRODUCT_PLACEHOLDER : getProductImage(product || {})
}

// SiteLayout 의 로그아웃과 같다: 쌓인 이벤트를 먼저 보내고 → 로그아웃 → logout 이벤트 → 첫 화면
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

onMounted(() => {
  unsubscribe = authSession.subscribe((state) => {
    auth.value = state
    const member = state.status === 'member'
    if (member && !wasMember) start()
    wasMember = member
  })
  unsubscribeStatus = siteStatus.subscribe((state) => { unreadCount.value = state.unreadCount })
  authSession.load()
})
onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeStatus?.()
})
</script>

<template>
  <SiteLayout :active-page="tab === 'alerts' ? 'alerts' : 'my'">
    <div class="my-page">
      <p v-if="pageState === 'loading'" class="shop-state" role="status">마이페이지를 불러오는 중이에요...</p>
      <div v-else-if="pageState === 'guest'" class="shop-state">
        <h1>로그인이 필요해요</h1>
        <p>로그인하면 가격 추적, 알림, 내가 쓴 글을 한곳에서 볼 수 있어요.</p>
        <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="recheckLogin">로그인 상태 다시 확인</button></div>
      </div>
      <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
        <p>{{ authErrorMessage }}</p><button class="shop-button shop-button--secondary" type="button" @click="authSession.refresh()">다시 시도</button>
      </div>
      <template v-else>
        <header class="my-head">
          <span class="my-head__avatar" aria-hidden="true">{{ initial }}</span>
          <div class="my-head__text"><h1>{{ profile?.name }}님</h1><p>{{ summary }}</p></div>
          <button class="my-head__logout" type="button" :disabled="loggingOut" :aria-busy="loggingOut" @click="signOut">{{ loggingOut ? '로그아웃 중...' : '로그아웃' }}</button>
        </header>
        <p v-if="logoutMessage" class="shop-message shop-message--error" role="alert">{{ logoutMessage }}</p>
        <div class="my-tabs" role="group" aria-label="마이페이지 메뉴">
          <button v-for="item in MY_PAGE_TABS" :key="item.code" class="my-tabs__tab" type="button" :aria-pressed="tab === item.code" @click="selectTab(item.code)">{{ item.name }}</button>
        </div>

        <section v-if="tab === 'notifications'" class="my-panel" aria-labelledby="my-panel-title">
          <h2 id="my-panel-title" ref="panelTitle" class="sr-only" tabindex="-1">알림</h2>
          <div class="my-panel__bar">
            <p class="my-panel__hint">목표가 도달, 새 답변, 견적 도착 알림이 여기 모여요.</p>
            <button v-if="notificationState === 'ready'" class="my-text-button" type="button" :disabled="readingAll || !hasUnread" :aria-busy="readingAll" @click="readAll">{{ readingAll ? '읽는 중...' : '모두 읽음' }}</button>
          </div>
          <p v-if="actionMessage" class="shop-message shop-message--error" role="alert">{{ actionMessage }}</p>
          <p v-if="notificationState === 'loading'" class="shop-state" role="status">알림을 불러오는 중이에요...</p>
          <div v-else-if="notificationState === 'error'" class="shop-state" role="alert">
            <p>{{ notifications.error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadNotifications()">다시 시도</button>
          </div>
          <p v-else-if="notificationState === 'empty'" class="my-empty">아직 받은 알림이 없어요. 상품 상세에서 <b>목표가 알림</b>을 설정하거나 커뮤니티에 질문을 올려 보세요.</p>
          <template v-else>
            <ul class="my-list" aria-label="받은 알림">
              <li v-for="item in notifications.items" :key="item.id">
                <component
                  :is="notificationPath(item) ? 'a' : 'div'"
                  class="my-notif"
                  :class="{ 'my-notif--unread': !item.read }"
                  :href="notificationPath(item) || undefined"
                  :aria-busy="opening === item.id || undefined"
                  @click="openNotification($event, item)"
                >
                  <span class="my-notif__icon" :class="`my-notif__icon--${notificationIcon(item.kind)}`" aria-hidden="true">
                    <svg v-if="notificationIcon(item.kind) === 'trend'" viewBox="0 0 24 24"><path d="M22 17l-7.5-7.5-4 4L2 6" /><path d="M16 17h6v-6" /></svg>
                    <svg v-else-if="notificationIcon(item.kind) === 'chat'" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
                    <svg v-else-if="notificationIcon(item.kind) === 'document'" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 7h8M8 12h8M8 17h5" /></svg>
                    <svg v-else viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
                  </span>
                  <span class="my-notif__body">
                    <span class="my-notif__title"><b>{{ item.title }}</b><span v-if="!item.read" class="my-notif__unread"><span class="my-notif__dot" aria-hidden="true"></span>읽지 않음</span></span>
                    <span class="my-notif__text">{{ item.body }}</span>
                  </span>
                  <time class="my-notif__time" :datetime="item.created_at">{{ formatNotificationTime(item.created_at, now) }}</time>
                </component>
              </li>
            </ul>
            <nav v-if="notificationPages > 1" class="shop-pagination" aria-label="알림 페이지">
              <button class="shop-button shop-button--secondary" type="button" :disabled="notifications.page <= 1" @click="loadNotifications(notifications.page - 1)">이전</button>
              <span aria-live="polite">{{ notifications.page }} / {{ notificationPages }}</span>
              <button class="shop-button shop-button--secondary" type="button" :disabled="notifications.page >= notificationPages" @click="loadNotifications(notifications.page + 1)">다음</button>
            </nav>
          </template>
        </section>

        <section v-else-if="tab === 'alerts'" class="my-panel" aria-labelledby="my-panel-title">
          <h2 id="my-panel-title" ref="panelTitle" class="sr-only" tabindex="-1">가격 추적</h2>
          <p class="my-panel__hint">목표가에 도달하면 알림을 보내드려요. 막대는 1년 최고가에서 목표가까지의 진행도예요.</p>
          <p v-if="actionMessage" class="shop-message shop-message--error" role="alert">{{ actionMessage }}</p>
          <p v-if="alertState === 'loading'" class="shop-state" role="status">가격 추적 목록을 불러오는 중이에요...</p>
          <div v-else-if="alertState === 'error'" class="shop-state" role="alert">
            <p>{{ alerts.error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadAlerts()">다시 시도</button>
          </div>
          <div v-else-if="alertState === 'empty'" class="my-empty">
            <p>추적 중인 부품이 없어요. 상품 상세에서 <b>목표가 알림</b>을 설정해 보세요.</p>
            <a class="shop-button shop-button--secondary" href="/products">상품 보러 가기</a>
          </div>
          <ul v-else class="my-watch" aria-label="추적 중인 부품">
            <li v-for="alert in alerts.items" :key="alert.product_id" class="my-watch__card">
              <div class="my-watch__head">
                <a class="my-watch__product" :href="productPath(alert.product_id)">
                  <img :src="imageOf(alert.product)" alt="" loading="lazy" @error="brokenImages[alert.product?.id] = true" />
                  <span class="my-watch__name"><b>{{ alert.product?.name }}</b><span>{{ alert.product?.brand }} · {{ categoryName(alert.product?.category) }}</span></span>
                </a>
                <button
                  class="my-watch__remove"
                  type="button"
                  title="추적 해제"
                  :aria-label="`${alert.product?.name || '상품'} 추적 해제`"
                  :disabled="removing.includes(alert.product_id)"
                  :aria-busy="removing.includes(alert.product_id)"
                  @click="removeAlert(alert)"
                ><span aria-hidden="true">×</span></button>
              </div>
              <dl class="my-watch__prices">
                <div><dt>현재가</dt><dd>{{ formatPrice(alert.product?.price_krw) }}</dd></div>
                <div class="my-watch__target"><dt>목표가</dt><dd>{{ formatPrice(alert.target_price_krw) }}</dd></div>
              </dl>
              <div class="my-watch__bar" role="img" :aria-label="`목표가 진행도 ${progressPercent(alertProgress(alert))}%`">
                <span :class="{ 'my-watch__fill--reached': alertGap(alert).reached }" :style="{ width: `${progressPercent(alertProgress(alert))}%` }"></span>
              </div>
              <p class="my-watch__foot">
                <span :class="{ 'my-watch__gap--reached': alertGap(alert).reached }">{{ alertGap(alert).text }}</span>
                <PriceChangeBadge :pct="alert.product?.price_trend?.change_30d_pct ?? null" />
              </p>
            </li>
          </ul>
        </section>

        <section v-else class="my-panel" aria-labelledby="my-panel-title">
          <h2 id="my-panel-title" ref="panelTitle" class="sr-only" tabindex="-1">내 글</h2>
          <p v-if="postState === 'loading'" class="shop-state" role="status">내 글을 불러오는 중이에요...</p>
          <div v-else-if="postState === 'error'" class="shop-state" role="alert">
            <p>{{ posts.error }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadPosts()">다시 시도</button>
          </div>
          <div v-else-if="postState === 'empty'" class="my-empty">
            <p>아직 쓴 글이 없어요.</p>
            <div class="shop-state__actions"><a class="shop-button shop-button--secondary" href="/questions/new">질문하기</a><a class="shop-button shop-button--secondary" href="/community/build/new">견적 요청하기</a></div>
          </div>
          <template v-else>
            <ul class="my-list" aria-label="내가 쓴 글">
              <li v-for="post in posts.items" :key="`${post.kind}-${post.id}`" class="my-post">
                <span class="my-post__kind">{{ myPostKindLabel(post.kind) }}</span>
                <a v-if="myPostPath(post)" class="my-post__title" :href="myPostPath(post)">{{ post.title }}</a>
                <span v-else class="my-post__title">{{ post.title }}</span>
                <span class="my-post__meta"><span>{{ myPostReplyLabel(post) }}</span><time :datetime="post.created_at">{{ formatMyDate(post.created_at) }}</time></span>
              </li>
            </ul>
            <nav v-if="postPages > 1" class="shop-pagination" aria-label="내 글 페이지">
              <button class="shop-button shop-button--secondary" type="button" :disabled="posts.page <= 1" @click="loadPosts(posts.page - 1)">이전</button>
              <span aria-live="polite">{{ posts.page }} / {{ postPages }}</span>
              <button class="shop-button shop-button--secondary" type="button" :disabled="posts.page >= postPages" @click="loadPosts(posts.page + 1)">다음</button>
            </nav>
          </template>
        </section>
      </template>
    </div>
  </SiteLayout>
</template>

<style scoped>
.my-page { display: flex; flex-direction: column; gap: 20px; padding: 24px 0 80px; animation: moa-fade .25s ease; }
.my-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.my-head__avatar { display: grid; flex: none; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); font-size: 20px; font-weight: 800; }
.my-head__text { flex: 1; min-width: 0; }
.my-head__text h1 { margin: 0; color: var(--ink); font-size: 22px; font-weight: 800; letter-spacing: -.02em; overflow-wrap: anywhere; }
.my-head__text p { margin: 2px 0 0; color: var(--muted); font-size: var(--text-sm); }
.my-head__logout { height: 36px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: transparent; color: var(--muted); font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.my-head__logout:hover:not(:disabled) { border-color: var(--brand-line); color: var(--ink); }
.my-head__logout:disabled { opacity: .6; cursor: wait; }
.my-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--line); }
.my-tabs__tab { flex: none; height: 42px; margin-bottom: -1px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font-size: var(--text-body); font-weight: 700; cursor: pointer; }
.my-tabs__tab:hover { color: var(--ink); }
.my-tabs__tab[aria-pressed="true"] { border-bottom-color: var(--brand); color: var(--ink); }
.my-panel { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.my-panel h2:focus { outline: none; }
.my-panel__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 10px; }
.my-panel__hint { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.6; word-break: keep-all; }
.my-text-button { min-height: 32px; padding: 0; border: 0; background: none; color: var(--brand-strong); font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.my-text-button:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
.my-text-button:disabled { color: var(--muted); cursor: default; }
.my-empty { display: grid; justify-items: center; gap: 14px; margin: 0; padding: 40px 20px; border: 1px dashed var(--line-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--muted); font-size: var(--text-body); line-height: 1.7; text-align: center; word-break: keep-all; }
.my-empty p { margin: 0; }
.my-empty b { color: var(--ink); }

.my-list { margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); list-style: none; }
.my-list > li + li { border-top: 1px solid var(--line); }
.my-notif { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; color: var(--ink); text-decoration: none; }
.my-notif--unread { background: color-mix(in srgb, var(--brand) 5%, transparent); }
a.my-notif:hover { background: var(--surface-2); color: var(--ink); text-decoration: none; }
.my-notif__icon { display: grid; flex: none; place-items: center; width: 36px; height: 36px; border-radius: var(--radius-sm); background: var(--surface-3); color: var(--ink); }
.my-notif__icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.my-notif__icon--trend { background: var(--success-soft); color: var(--success); }
.my-notif__icon--chat { background: var(--brand-soft); color: var(--brand-strong); }
.my-notif__body { display: grid; flex: 1; gap: 3px; min-width: 0; }
.my-notif__title { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: var(--text-body); }
.my-notif__unread { display: inline-flex; align-items: center; gap: 5px; color: var(--brand-strong); font-size: 11px; font-weight: 700; }
.my-notif__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.my-notif__text { color: var(--ink); font-size: var(--text-sm); line-height: 1.5; overflow-wrap: anywhere; }
.my-notif__time { flex: none; color: var(--muted); font-size: var(--text-xs); white-space: nowrap; }

.my-watch { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 14px; margin: 0; padding: 0; list-style: none; }
.my-watch__card { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); transition: border-color var(--motion-fast) ease; }
.my-watch__card:hover { border-color: var(--line-strong); }
.my-watch__head { display: flex; align-items: center; gap: 12px; }
.my-watch__product { display: flex; flex: 1; align-items: center; gap: 12px; min-width: 0; color: var(--ink); text-decoration: none; }
.my-watch__product img { flex: none; width: 48px; height: 48px; padding: 3px; border-radius: var(--radius-sm); background: var(--image-bg); object-fit: contain; }
.my-watch__name { display: grid; gap: 2px; min-width: 0; }
.my-watch__name b { overflow: hidden; font-size: var(--text-body); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.my-watch__name span { color: var(--muted); font-size: var(--text-xs); }
.my-watch__product:hover b { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.my-watch__remove { display: grid; flex: none; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: var(--surface-3); color: var(--ink); font-size: 15px; line-height: 1; cursor: pointer; }
.my-watch__remove:hover:not(:disabled) { background: var(--danger); color: var(--brand-ink); }
.my-watch__remove:disabled { opacity: .6; cursor: wait; }
.my-watch__prices { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin: 0; }
.my-watch__prices dt { color: var(--muted); font-size: 11px; }
.my-watch__prices dd { margin: 0; color: var(--ink); font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
.my-watch__target { text-align: right; }
.my-watch__target dd { color: var(--brand-strong); font-size: 15px; font-weight: 700; }
.my-watch__bar { height: 6px; overflow: hidden; border-radius: 3px; background: var(--bg); }
.my-watch__bar span { display: block; height: 100%; border-radius: 3px; background: var(--brand); }
.my-watch__bar .my-watch__fill--reached { background: var(--success); }
.my-watch__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin: 0; color: var(--muted); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
.my-watch__foot .my-watch__gap--reached { color: var(--success); }

.my-post { display: flex; align-items: center; gap: 12px; padding: 14px 18px; }
.my-post__kind { flex: none; padding: 3px 9px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--ink); font-size: var(--text-xs); font-weight: 700; }
.my-post__title { flex: 1; min-width: 0; overflow: hidden; color: var(--ink); font-size: var(--text-body); font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
a.my-post__title:hover { color: var(--brand-strong); text-decoration: underline; text-underline-offset: 3px; }
.my-post__meta { display: flex; flex: none; gap: 10px; color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
@media (max-width: 640px) {
  .my-page { padding-top: 16px; }
  .my-notif { gap: 12px; padding: 14px; }
  .my-post { flex-wrap: wrap; gap: 6px 10px; padding: 14px; }
  .my-post__meta { width: 100%; }
}
</style>
