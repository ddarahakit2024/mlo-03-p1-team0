<script setup>
import { computed, onMounted, ref } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import { fetchQuestions } from '../api/questionApi.js'
import { formatViewCount, questionError, questionProductName } from '../stores/questionViewModel.js'
import { QUESTION_BOARD, boardPageCount, boardPageItems, formatBoardDate } from '../stores/communityViewModel.js'

// 질문 게시판 목록(디자인 "questions list"): 줄마다 답변 수 알약(답변이 있으면 주황) | 제목 + 관련 부품 이름("부품 미지정")·첨부 이미지·채택 표시 | 글쓴이 | 조회 N | 날짜.
// 아래에 번호 쪽 이동과 검색. 늦게 온 이전 응답은 버린다.
// 시뮬레이터가 쓰는 모양은 바꾸지 않는다: 줄마다 li > a[href=/questions/{id}] 안의 h2(제목만) + 다음 형제 div 의 첫 span(글쓴이) + "답변 N".
const items = ref([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const activeSearch = ref('')
const page = ref(1)
const total = ref(0)
const loaded = ref(false)
const pageSize = 10
const pageCount = computed(() => boardPageCount(total.value, pageSize))
const pageItems = computed(() => boardPageItems(page.value, pageCount.value))
// 검색하지 않은 목록의 전체 수만 왼쪽 메뉴 숫자로 넘긴다(검색 결과 수는 게시판 전체 수가 아니다)
const shellCounts = computed(() => (loaded.value && !activeSearch.value ? { questions: total.value } : {}))
let requestId = 0

async function loadQuestions(targetPage = page.value) {
  const request = ++requestId
  loading.value = true
  error.value = ''
  try {
    const data = await fetchQuestions({ page: targetPage, pageSize, search: activeSearch.value })
    if (request !== requestId) return
    items.value = data?.items || []
    total.value = data?.total || 0
    page.value = data?.page || targetPage
    loaded.value = true
  } catch (failure) {
    if (request === requestId) error.value = questionError(failure, '질문 목록을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === requestId) loading.value = false
  }
}

function goToPage(target) {
  if (target < 1 || target > pageCount.value || target === page.value) return
  loadQuestions(target)
}

function runSearch() {
  activeSearch.value = search.value.trim()
  loadQuestions(1)
}

function clearSearch() {
  search.value = ''
  activeSearch.value = ''
  loadQuestions(1)
}

onMounted(() => loadQuestions())
</script>

<template>
  <SiteLayout active-page="questions">
    <CommunityShell active="questions" :counts="shellCounts">
      <section class="cm-page" aria-labelledby="questions-title">
        <header class="cm-board-head">
          <div><h1 id="questions-title">{{ QUESTION_BOARD.name }}</h1><p>{{ QUESTION_BOARD.description }}</p></div>
          <a class="cm-button" href="/questions/new">질문하기</a>
        </header>
        <div v-if="!loading && !error && (items.length || activeSearch)" class="cm-board-toolbar">
          <p class="cm-board-total" aria-live="polite">{{ activeSearch ? '검색 결과' : '전체 질문' }} <strong>{{ total }}</strong>개</p>
          <button v-if="activeSearch" class="cm-button cm-button--secondary cm-button--compact" type="button" @click="clearSearch">검색 지우기</button>
        </div>
        <div class="cm-board" :aria-busy="loading">
          <p v-if="loading" class="cm-state" role="status">질문을 불러오는 중입니다...</p>
          <div v-else-if="error" class="cm-state" role="alert"><p>{{ error }}</p><button class="cm-button cm-button--secondary" type="button" @click="loadQuestions()">다시 시도</button></div>
          <div v-else-if="!items.length" class="cm-state">
            <h2>{{ activeSearch ? '검색 결과가 없습니다.' : '아직 등록된 질문이 없습니다.' }}</h2>
            <p>{{ activeSearch ? '다른 검색어로 찾아보세요.' : '첫 질문을 남겨 보세요. 부품을 고르고 이미지도 함께 첨부할 수 있어요.' }}</p>
            <a v-if="!activeSearch" class="cm-button" href="/questions/new">질문 작성하기</a>
          </div>
          <ol v-else class="cm-board__list" aria-label="질문 목록">
            <li v-for="question in items" :key="question.id">
              <a class="q-board-row" :class="{ 'q-board-row--waiting': !question.answer_count }" :href="`/questions/${question.id}`">
                <span :class="question.answer_count ? 'q-answer-count' : 'q-answer-count q-answer-count--empty'">답변 {{ question.answer_count || 0 }}</span>
                <h2 class="q-board-row__title">{{ question.title }}</h2>
                <p class="q-board-row__sub">
                  <span class="q-board-row__product" :class="{ 'q-board-row__product--none': !question.product }">{{ questionProductName(question) }}</span>
                  <span v-if="question.image_count" class="q-image-count" role="img" :aria-label="`이미지 ${question.image_count}장 첨부`"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-3L20 16" /></svg>{{ question.image_count }}</span>
                  <span v-if="question.accepted_answer_id != null" class="q-accepted-mark"><span aria-hidden="true">✓</span>채택</span>
                </p>
                <div class="q-board-row__meta"><span class="q-board-row__author">{{ question.author?.name || '회원' }}</span><span class="q-board-row__views">{{ formatViewCount(question.view_count) }}</span><time class="q-board-row__date" :datetime="question.created_at">{{ formatBoardDate(question.created_at) }}</time></div>
              </a>
            </li>
          </ol>
        </div>
        <nav v-if="!loading && !error && items.length" class="cm-pager" aria-label="질문 목록 페이지">
          <button class="cm-pager__button cm-pager__step" type="button" :disabled="page <= 1" @click="goToPage(page - 1)"><span aria-hidden="true">‹</span><span class="cm-pager__step-label">이전</span></button>
          <template v-for="item in pageItems" :key="item">
            <span v-if="typeof item === 'string'" class="cm-pager__gap" aria-hidden="true">…</span>
            <button v-else class="cm-pager__button" type="button" :aria-current="item === page ? 'page' : undefined" :aria-label="`${item}쪽`" @click="goToPage(item)">{{ item }}</button>
          </template>
          <button class="cm-pager__button cm-pager__step" type="button" :disabled="page >= pageCount" @click="goToPage(page + 1)"><span class="cm-pager__step-label">다음</span><span aria-hidden="true">›</span></button>
          <p class="sr-only" aria-live="polite">{{ pageCount }}쪽 중 {{ page }}쪽</p>
        </nav>
        <form class="cm-board-search" role="search" @submit.prevent="runSearch">
          <label class="sr-only" for="question-search">질문 검색</label>
          <input id="question-search" v-model="search" type="search" maxlength="200" placeholder="부품 이름이나 증상으로 질문 검색" />
          <button class="cm-button cm-button--secondary" type="submit">검색</button>
        </form>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
