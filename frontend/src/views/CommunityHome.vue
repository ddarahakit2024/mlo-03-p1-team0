<script setup>
import { computed, onMounted, reactive } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import { fetchQuestions } from '../api/questionApi.js'
import { fetchCommunityPosts } from '../api/communityApi.js'
import { getSectionState } from '../stores/productViewModel.js'
import {
  COMMUNITY_BOARDS, COMMUNITY_HOME_PAGE_SIZE, QUESTION_BOARD, communityError, communityPostPath, formatBoardDate, formatBudget, purposeName, quoteStatus,
  waitingQuoteCount,
} from '../stores/communityViewModel.js'

// 커뮤니티 홈(디자인 "community home"): 제목·설명 → 주황 배너("최근 글 중 견적을 기다리는 요청 N건" + 견적 보내기)
// → 질문 게시판·자유 게시판 카드(나란히) → 견적 게시판 카드(상태·제목·용도·예산·날짜).
// 게시판마다 최신 글 5개를 따로 불러오고 따로 로딩·오류·다시 시도를 갖는다(한 게시판이 실패해도 나머지는 보인다).
// 배너의 N 은 불러온 견적 게시판 최신 글 중 받은 견적이 0개인 글 수다(전체 수가 아니라서 "최근 글 중"이라고 적는다).
// 게시판 전체 수(total)는 이미 받았으므로 왼쪽 메뉴 옆 숫자로 넘긴다.
const LOAD_ERROR = '게시글을 불러오지 못했습니다. 다시 시도해 주세요.'
const boards = [QUESTION_BOARD, ...COMMUNITY_BOARDS]
const sections = reactive(Object.fromEntries(boards.map((board) => [board.code, { loading: true, error: '', items: [], total: null }])))
const requests = {}

const waitingCount = computed(() => waitingQuoteCount(sections.build.items))
const buildReady = computed(() => !sections.build.loading && !sections.build.error)
const counts = computed(() => Object.fromEntries(boards.map((board) => [board.code, sections[board.code].total])))

async function loadBoard(code) {
  const request = (requests[code] || 0) + 1
  requests[code] = request
  const section = sections[code]
  section.loading = true
  section.error = ''
  try {
    const data = code === QUESTION_BOARD.code
      ? await fetchQuestions({ page: 1, pageSize: COMMUNITY_HOME_PAGE_SIZE })
      : await fetchCommunityPosts({ board: code, page: 1, pageSize: COMMUNITY_HOME_PAGE_SIZE })
    if (request !== requests[code]) return
    section.items = (data?.items || []).slice(0, COMMUNITY_HOME_PAGE_SIZE)
    section.total = Number.isSafeInteger(data?.total) ? data.total : null
  } catch (failure) {
    if (request === requests[code]) section.error = communityError(failure, LOAD_ERROR)
  } finally {
    if (request === requests[code]) section.loading = false
  }
}

function sectionState(code) {
  const section = sections[code]
  return getSectionState({ loading: section.loading, error: section.error, empty: !section.items.length })
}

onMounted(() => boards.forEach((board) => loadBoard(board.code)))
</script>

<template>
  <SiteLayout active-page="community">
    <CommunityShell active="home" :counts="counts">
      <section class="cm-page" aria-labelledby="community-title">
        <header class="cm-board-head">
          <div><h1 id="community-title">커뮤니티</h1><p>궁금한 점을 묻고, 예산에 맞는 조립 견적을 받아 보세요. 질문과 견적은 MOA 판매 부품과 연결돼요.</p></div>
        </header>

        <div class="cm-banner">
          <div>
            <p class="cm-banner__title" aria-live="polite">{{ buildReady ? `최근 글 중 견적을 기다리는 요청 ${waitingCount}건` : '견적을 기다리는 요청' }}</p>
            <p class="cm-banner__text">예산과 용도를 보고 부품 구성을 제안해 주세요. 견적은 MOA 판매가 기준으로 자동 합산돼요.</p>
          </div>
          <a class="cm-button" href="/community/build">견적 보내기</a>
        </div>

        <div class="cm-home">
          <section v-for="board in boards" :key="board.code" class="cm-preview" :class="{ 'cm-preview--wide': board.code === 'build' }" :aria-labelledby="`board-${board.code}-title`" :aria-busy="sections[board.code].loading">
            <header class="cm-preview__head">
              <h2 :id="`board-${board.code}-title`">{{ board.name }}</h2>
              <a class="cm-preview__more" :href="board.path" :aria-label="`${board.name} 더 보기`">더 보기<span aria-hidden="true">›</span></a>
            </header>
            <div class="cm-preview__body">
              <p v-if="sectionState(board.code) === 'loading'" class="cm-state cm-state--compact" role="status">게시글을 불러오는 중입니다...</p>
              <div v-else-if="sectionState(board.code) === 'error'" class="cm-state cm-state--compact" role="alert">
                <p>{{ sections[board.code].error }}</p>
                <button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="loadBoard(board.code)">다시 시도</button>
              </div>
              <div v-else-if="sectionState(board.code) === 'empty'" class="cm-state cm-state--compact">
                <p>아직 글이 없습니다. 첫 글을 남겨 보세요.</p>
                <a class="cm-text-link" :href="board.newPath">첫 글 쓰기</a>
              </div>
              <ol v-else-if="board.code === 'questions'" class="cm-preview__list" :aria-label="`${board.name} 최신 글`">
                <li v-for="item in sections.questions.items" :key="item.id">
                  <a class="cm-preview__row" :class="{ 'cm-preview__row--quiet': !item.answer_count }" :href="`/questions/${encodeURIComponent(item.id)}`">
                    <span class="cm-preview__title">{{ item.title }}</span>
                    <span class="cm-pill" :class="{ 'cm-pill--on': item.answer_count > 0 }">답변 {{ item.answer_count || 0 }}</span>
                    <time class="cm-preview__date" :datetime="item.created_at">{{ formatBoardDate(item.created_at) }}</time>
                  </a>
                </li>
              </ol>
              <ol v-else-if="board.code === 'free'" class="cm-preview__list" :aria-label="`${board.name} 최신 글`">
                <li v-for="item in sections.free.items" :key="item.id">
                  <a class="cm-preview__row" :href="communityPostPath(item.id)">
                    <span class="cm-preview__title">{{ item.title }}</span>
                    <span v-if="item.comment_count" class="cm-preview__count"><span class="sr-only">댓글 </span>[{{ item.comment_count }}]</span>
                    <span class="cm-preview__author">{{ item.author?.name || '회원' }}</span>
                  </a>
                </li>
              </ol>
              <ol v-else class="cm-preview__list" :aria-label="`${board.name} 최신 글`">
                <li v-for="item in sections.build.items" :key="item.id">
                  <a class="cm-preview__row cm-preview__row--build" :href="communityPostPath(item.id)">
                    <span class="cm-pill" :class="{ 'cm-pill--on': !quoteStatus(item.quote_count).waiting }">{{ quoteStatus(item.quote_count).label }}</span>
                    <span class="cm-preview__title cm-preview__title--strong">{{ item.title }}</span>
                    <span v-if="purposeName(item.purpose)" class="cm-preview__purpose">{{ purposeName(item.purpose) }}</span>
                    <span v-if="formatBudget(item.budget_krw)" class="cm-preview__budget">{{ formatBudget(item.budget_krw) }}</span>
                    <time class="cm-preview__date" :datetime="item.created_at">{{ formatBoardDate(item.created_at) }}</time>
                  </a>
                </li>
              </ol>
            </div>
          </section>
        </div>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
