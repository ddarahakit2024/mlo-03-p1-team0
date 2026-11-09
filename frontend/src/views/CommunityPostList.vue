<script setup>
import { computed, onMounted, ref } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import { fetchCommunityPosts } from '../api/communityApi.js'
import {
  COMMUNITY_PAGE_SIZE, MAX_COMMUNITY_SEARCH_LENGTH, PURPOSE_FILTERS, boardPageCount, boardPageItems, communityBoard, communityError, communityListRequest,
  communityPostPath, formatBoardDate, formatBudget, isCommunityBoard, preferenceLine, purposeName, quoteStatus, readPurposeQuery, replacePurposeQuery,
} from '../stores/communityViewModel.js'
import { MAX_PROP_LIST_LENGTH, track } from '../stores/tracking.js'

// 자유·견적 게시판 목록(/community/free, /community/build, 디자인 "free board"·"estimates list"). 아래에 번호 쪽 이동과 검색, 늦게 온 이전 응답은 버린다.
// 자유 게시판 줄: 제목 [댓글] | 글쓴이 | 날짜.
// 견적 게시판: 용도 필터 칩(purpose 쿼리, 주소 ?purpose= 로도 연다) + 줄마다 상태 알약(견적 대기 / 견적 N개) | 제목과 "글쓴이 · 선호 사항" | 용도 | 예산 "N만 원" | 날짜.
// 모르는 게시판(경로 해석이 board null)은 API 를 부르지 않고 "찾을 수 없음"을 보여 준다.
const props = defineProps({ board: { type: String, default: null } })
const info = computed(() => (isCommunityBoard(props.board) ? communityBoard(props.board) : null))
const isBuild = computed(() => props.board === 'build')
const items = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const activeSearch = ref('')
const purpose = ref(props.board === 'build' ? readPurposeQuery() : '')
const page = ref(1)
const total = ref(0)
const pageCount = computed(() => boardPageCount(total.value, COMMUNITY_PAGE_SIZE))
const pageItems = computed(() => boardPageItems(page.value, pageCount.value))
// 검색·용도 필터 없이 받은 전체 수만 왼쪽 메뉴 숫자로 넘긴다
const loaded = ref(false)
const shellCounts = computed(() => (info.value && loaded.value && !activeSearch.value && !purpose.value ? { [props.board]: total.value } : {}))
const totalLabel = computed(() => {
  if (activeSearch.value) return '검색 결과'
  if (purpose.value) return `${purposeName(purpose.value)} ${info.value?.countLabel || '글'}`
  return `전체 ${info.value?.countLabel || '글'}`
})
let requestId = 0

async function loadPosts(targetPage = page.value) {
  if (!info.value) {
    loading.value = false
    return
  }
  const request = ++requestId
  const applied = communityListRequest({ board: props.board, page: targetPage, search: activeSearch.value, purpose: purpose.value })
  loading.value = true
  error.value = ''
  try {
    const data = await fetchCommunityPosts(applied)
    if (request !== requestId) return
    items.value = data?.items || []
    total.value = data?.total || 0
    page.value = data?.page || targetPage
    loaded.value = true
    trackList(applied)
  } catch (failure) {
    if (request === requestId) error.value = communityError(failure, '게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === requestId) loading.value = false
  }
}

// 목록을 받아 화면에 반영한 뒤(늦게 온 이전 응답·실패는 남기지 않는다). 제목·글쓴이는 넣지 않고 글 id 만. 빈 조건은 null
function trackList(applied) {
  track('community_list_view', {
    board: props.board,
    purpose: applied.purpose || null,
    page: page.value,
    search: applied.search || null,
    result_count: total.value,
    post_ids: items.value.slice(0, MAX_PROP_LIST_LENGTH).map((post) => post.id),
  })
}

function goToPage(target) {
  if (target < 1 || target > pageCount.value || target === page.value) return
  loadPosts(target)
}

function runSearch() {
  activeSearch.value = search.value.trim()
  loadPosts(1)
}

function clearSearch() {
  search.value = ''
  activeSearch.value = ''
  loadPosts(1)
}

// 용도 칩을 고르면 1쪽부터 다시 부른다(검색어는 그대로 함께 보낸다)
function choosePurpose(code) {
  if (purpose.value === code) return
  purpose.value = code
  replacePurposeQuery(code)
  loadPosts(1)
}

onMounted(() => loadPosts())
</script>

<template>
  <SiteLayout active-page="community">
    <CommunityShell :active="info ? board : ''" :counts="shellCounts">
      <div v-if="!info" class="cm-page cm-state" role="alert">
        <h1 id="community-list-title">게시판을 찾을 수 없습니다.</h1>
        <p>주소를 다시 확인하거나 왼쪽 메뉴에서 게시판을 골라 주세요.</p>
        <a class="cm-text-link" href="/community">커뮤니티 홈으로</a>
      </div>
      <section v-else class="cm-page" aria-labelledby="community-list-title">
        <header class="cm-board-head">
          <div><h1 id="community-list-title">{{ info.name }}</h1><p>{{ info.description }}</p></div>
          <a class="cm-button" :href="info.newPath">{{ info.writeLabel }}</a>
        </header>
        <div v-if="isBuild" class="cm-filter" role="group" aria-label="용도로 거르기">
          <button v-for="item in PURPOSE_FILTERS" :key="item.code || 'all'" class="cm-filter__chip" type="button" :aria-pressed="purpose === item.code" @click="choosePurpose(item.code)">{{ item.name }}</button>
        </div>
        <div v-if="!loading && !error && (items.length || activeSearch)" class="cm-board-toolbar">
          <p class="cm-board-total" aria-live="polite">{{ totalLabel }} <strong>{{ total }}</strong>개</p>
          <button v-if="activeSearch" class="cm-button cm-button--secondary cm-button--compact" type="button" @click="clearSearch">검색 지우기</button>
        </div>
        <div class="cm-board" :aria-busy="loading">
          <p v-if="loading" class="cm-state" role="status">게시글을 불러오는 중입니다...</p>
          <div v-else-if="error" class="cm-state" role="alert">
            <p>{{ error }}</p>
            <button class="cm-button cm-button--secondary" type="button" @click="loadPosts()">다시 시도</button>
          </div>
          <div v-else-if="!items.length" class="cm-state">
            <template v-if="activeSearch">
              <h2>검색 결과가 없습니다.</h2>
              <p>다른 검색어로 찾아보세요.</p>
            </template>
            <template v-else-if="purpose">
              <h2>{{ purposeName(purpose) }} 용도의 견적 요청이 아직 없습니다.</h2>
              <p>다른 용도를 고르거나 첫 견적을 요청해 보세요.</p>
              <div class="cm-state__actions">
                <button class="cm-button cm-button--secondary" type="button" @click="choosePurpose('')">전체 보기</button>
                <a class="cm-button" :href="info.newPath">{{ info.writeLabel }}</a>
              </div>
            </template>
            <template v-else>
              <h2>아직 글이 없습니다. 첫 글을 남겨 보세요.</h2>
              <a class="cm-button" :href="info.newPath">{{ info.writeLabel }}</a>
            </template>
          </div>
          <ol v-else-if="isBuild" class="cm-board__list" :aria-label="`${info.name} 글 목록`">
            <li v-for="post in items" :key="post.id">
              <a class="cm-build-row" :href="communityPostPath(post.id)">
                <span class="cm-pill cm-build-row__status" :class="{ 'cm-pill--on': !quoteStatus(post.quote_count).waiting }">{{ quoteStatus(post.quote_count).label }}</span>
                <div class="cm-build-row__subject">
                  <h2 class="cm-board-row__title">{{ post.title }}</h2>
                  <p class="cm-build-row__sub"><span class="cm-board-row__author">{{ post.author?.name || '회원' }}</span> · {{ preferenceLine(post.preferences) }}</p>
                </div>
                <span class="cm-build-row__purpose">{{ purposeName(post.purpose) || '-' }}</span>
                <span class="cm-build-row__budget">{{ formatBudget(post.budget_krw) || '-' }}</span>
                <time class="cm-board-row__date" :datetime="post.created_at">{{ formatBoardDate(post.created_at) }}</time>
              </a>
            </li>
          </ol>
          <ol v-else class="cm-board__list" :aria-label="`${info.name} 글 목록`">
            <li v-for="post in items" :key="post.id">
              <a class="cm-board-row" :href="communityPostPath(post.id)">
                <h2 class="cm-board-row__title">{{ post.title }}</h2>
                <span v-if="post.comment_count" class="cm-board-row__count"><span class="sr-only">댓글 </span>[{{ post.comment_count }}]</span>
                <div class="cm-board-row__meta"><span class="cm-board-row__author">{{ post.author?.name || '회원' }}</span><time class="cm-board-row__date" :datetime="post.created_at">{{ formatBoardDate(post.created_at) }}</time></div>
              </a>
            </li>
          </ol>
        </div>
        <nav v-if="!loading && !error && items.length" class="cm-pager" :aria-label="`${info.name} 페이지`">
          <button class="cm-pager__button cm-pager__step" type="button" :disabled="page <= 1" @click="goToPage(page - 1)"><span aria-hidden="true">‹</span><span class="cm-pager__step-label">이전</span></button>
          <template v-for="item in pageItems" :key="item">
            <span v-if="typeof item === 'string'" class="cm-pager__gap" aria-hidden="true">…</span>
            <button v-else class="cm-pager__button" type="button" :aria-current="item === page ? 'page' : undefined" :aria-label="`${item}쪽`" @click="goToPage(item)">{{ item }}</button>
          </template>
          <button class="cm-pager__button cm-pager__step" type="button" :disabled="page >= pageCount" @click="goToPage(page + 1)"><span class="cm-pager__step-label">다음</span><span aria-hidden="true">›</span></button>
          <p class="sr-only" aria-live="polite">{{ pageCount }}쪽 중 {{ page }}쪽</p>
        </nav>
        <form class="cm-board-search" role="search" @submit.prevent="runSearch">
          <label class="sr-only" for="community-search">{{ info.name }} 검색</label>
          <input id="community-search" v-model="search" type="search" :maxlength="MAX_COMMUNITY_SEARCH_LENGTH" placeholder="제목이나 내용으로 검색" />
          <button class="cm-button cm-button--secondary" type="submit">검색</button>
        </form>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
