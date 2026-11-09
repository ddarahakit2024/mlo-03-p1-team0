<script setup>
import { computed, onMounted, ref } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import { createCommunityPost, fetchCommunityPost, updateCommunityPost } from '../api/communityApi.js'
import { fetchCart } from '../api/cartApi.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import {
  BUDGET_PRESETS_MANWON, BUDGET_SLIDER, BUILD_PREFERENCES, COMMUNITY_PURPOSES, DEFAULT_BUDGET_MANWON, MAX_POST_CONTENT_LENGTH, MAX_POST_TITLE_LENGTH,
  MONITOR_RESOLUTIONS, boardPath, budgetKrwFromInput, budgetSliderValue, buildTitleHint, cartPrefillDraft, changedPostFields, communityBoard, communityError,
  communityPostPath, draftFromPost, formatBudget, goToCommunityPost, isCommunityBoard, postFromDraft, readCartPrefillQuery, textLength, validatePostChanges,
  validatePostDraft,
} from '../stores/communityViewModel.js'
import { track } from '../stores/tracking.js'

// 글쓰기(/community/{board}/new)와 수정(/community/posts/{id}/edit).
// 자유 게시판: "자유 게시판 글쓰기" 제목, 제목·내용.
// 견적 게시판(디자인 "estimate new"): 예산(50~500만 원 슬라이더 + 큰 주황 금액, 만 원 입력칸·빠른 선택 칩과 같은 값) → 용도 칩(라디오)
//   → 선호 사항(여러 개, 체크박스 칩) → 모니터 해상도(select)·제목(안내: "150만 원 게임 PC 견적 부탁드립니다") → 요청 내용.
// /community/build/new?from=cart 로 열면(회원) 장바구니(GET /cart)로 제목·내용을 채운다(실패하면 빈 칸 그대로).
// 수정은 바뀐 필드만 PATCH 한다(모니터·선호만 바뀌어도 보낸다. 서버는 빈 본문·null 을 422 로 거절한다). 게시판은 바꿀 수 없다.
const props = defineProps({
  board: { type: String, default: null },
  postId: { type: Number, default: null },
  editing: { type: Boolean, default: false },
})
const BUILD_CONTENT_PLACEHOLDER = '주로 하는 게임이나 작업, 모니터 해상도·주사율, 지금 쓰는 부품 중 다시 쓸 것(가진 부품), 꼭 넣고 싶은 부품이나 선호하는 브랜드를 적어 주세요.'

const title = ref('')
const content = ref('')
const budgetInput = ref(props.editing || props.board !== 'build' ? '' : String(DEFAULT_BUDGET_MANWON))
const purpose = ref('')
const monitorResolution = ref('')
const preferences = ref([])
const original = ref(null)
const profile = ref(null)
const loading = ref(true)
const loadError = ref('')
const blocked = ref(false)
const forbidden = ref(false)
const canEdit = ref(false)
const submitting = ref(false)
const error = ref('')
const needsLogin = ref(false)
const prefillNotice = ref('')

const currentBoard = computed(() => (props.editing ? original.value?.board || '' : props.board || ''))
const info = computed(() => (isCommunityBoard(currentBoard.value) ? communityBoard(currentBoard.value) : null))
const isBuild = computed(() => currentBoard.value === 'build')
const returnPath = computed(() => (props.editing && props.postId ? communityPostPath(props.postId) : boardPath(props.board)))
const pageTitle = computed(() => {
  if (props.editing) return isBuild.value ? '견적 요청 수정' : '글 수정'
  return isBuild.value ? '견적 요청하기' : `${info.value?.name || '커뮤니티'} 글쓰기`
})
const description = computed(() => {
  if (props.editing) return '제목과 내용을 고칠 수 있어요. 견적 요청은 예산·용도·선호 사항·모니터도 고칠 수 있고, 게시판은 바꿀 수 없습니다.'
  if (isBuild.value) return '예산과 용도만 적어도 돼요. 자세할수록 딱 맞는 견적이 와요.'
  return '조립 후기, 부품 사용기, PC 이야기를 자유롭게 남겨 주세요.'
})
const submitLabel = computed(() => {
  if (props.editing) return '수정 내용 저장'
  return isBuild.value ? '견적 요청 등록' : '글 등록'
})
const budgetPreview = computed(() => {
  const krw = budgetKrwFromInput(budgetInput.value)
  return Number.isSafeInteger(krw) && krw > 0 ? formatBudget(krw) : ''
})
const sliderValue = computed(() => budgetSliderValue(budgetInput.value))
const titleHint = computed(() => (isBuild.value ? buildTitleHint({ budgetInput: budgetInput.value, purpose: purpose.value }) : '예: 첫 조립 후기 남깁니다'))
// 이미 모니터 해상도가 있는 글을 고칠 때는 "선택 안 함"을 주지 않는다(서버는 PATCH 의 null 을 받지 않는다)
const allowNoResolution = computed(() => !props.editing || !original.value?.monitor_resolution)

function applyDraft(draft) {
  title.value = draft.title
  content.value = draft.content
  budgetInput.value = draft.budgetInput
  purpose.value = draft.purpose
  monitorResolution.value = draft.monitorResolution || ''
  preferences.value = [...(draft.preferences || [])]
}

function pickBudget(manwon) {
  budgetInput.value = String(manwon)
}

function slideBudget(event) {
  budgetInput.value = String(event.target.value)
}

// recheck: "다시 시도"·"로그인 상태 다시 확인"이면 로그인 상태를 다시 부른다(처음에는 레이아웃과 같은 공용 상태를 쓴다)
async function loadEditor(recheck = false) {
  loading.value = true
  loadError.value = ''
  blocked.value = false
  forbidden.value = false
  if (!props.editing && !isCommunityBoard(props.board)) {
    loadError.value = '게시판을 찾을 수 없습니다.'
    blocked.value = true
    loading.value = false
    return
  }
  const auth = await (recheck ? authSession.refresh() : authSession.load())
  profile.value = memberProfile(auth)
  // 401 만 비로그인(guest)이다. 서버 다운·5xx 는 로그인 안내 대신 오류와 다시 시도를 보여 준다
  if (auth.status === 'error') loadError.value = communityError(auth.error, '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
  if (!profile.value) {
    loading.value = false
    return
  }
  if (!props.editing) {
    canEdit.value = true
    if (props.board === 'build' && readCartPrefillQuery()) prefillFromCart()
  } else if (!Number.isSafeInteger(props.postId) || props.postId < 1) {
    loadError.value = '올바르지 않은 글 주소입니다.'
    blocked.value = true
  } else {
    try {
      const post = await fetchCommunityPost(props.postId)
      original.value = post
      canEdit.value = Boolean(post.is_owner)
      if (canEdit.value) applyDraft(draftFromPost(post))
      else {
        loadError.value = '본인이 작성한 글만 수정할 수 있습니다.'
        forbidden.value = true
      }
    } catch (failure) {
      blocked.value = failure?.response?.status === 404
      loadError.value = blocked.value ? '글을 찾을 수 없습니다.' : communityError(failure, '게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
    }
  }
  loading.value = false
}

// 장바구니에서 "이 구성으로 견적 요청"(?from=cart): 비어 있는 제목·내용만 채운다. 실패·빈 장바구니는 조용히 넘어간다(글은 그대로 쓸 수 있다)
async function prefillFromCart() {
  try {
    const draft = cartPrefillDraft(await fetchCart())
    if (!draft) return
    if (!title.value.trim()) title.value = draft.title
    if (!content.value.trim()) content.value = draft.content
    prefillNotice.value = '장바구니 구성을 제목과 요청 내용에 넣었어요. 예산과 용도를 고른 뒤 등록해 주세요.'
  } catch { /* 장바구니를 못 불러와도 견적 요청은 쓸 수 있다 */ }
}

// 두 번 보내지 않고, 검사에 걸리면 요청하지 않는다. 실패해도 입력값은 그대로 둔다. 성공하면 글 상세로 이동한다
async function submitPost() {
  if (submitting.value) return
  needsLogin.value = false
  const draft = {
    board: currentBoard.value, title: title.value, content: content.value, budgetInput: budgetInput.value, purpose: purpose.value,
    monitorResolution: monitorResolution.value, preferences: preferences.value,
  }
  error.value = validatePostDraft(draft)
  if (error.value) return
  const changes = props.editing ? changedPostFields(original.value, draft) : null
  if (changes) {
    error.value = validatePostChanges(changes)
    if (error.value) return
  }
  submitting.value = true
  try {
    const post = props.editing ? await updateCommunityPost(props.postId, changes) : await createCommunityPost(postFromDraft(draft))
    // 저장에 성공했을 때, 이동하기 전. 값은 서버 응답(글 상세) 그대로이고 제목·본문은 넣지 않는다
    track('community_post_submit', {
      action: props.editing ? 'update' : 'create',
      post_id: post?.id ?? props.postId,
      board: post?.board ?? currentBoard.value,
      purpose: post?.purpose ?? null,
      budget_krw: post?.budget_krw ?? null,
    })
    goToCommunityPost(post?.id ?? props.postId)
  } catch (failure) {
    needsLogin.value = failure?.response?.status === 401
    error.value = communityError(failure, '글을 저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.', props.editing ? 'post' : 'write')
  } finally {
    submitting.value = false
  }
}

onMounted(() => loadEditor())
</script>

<template>
  <SiteLayout active-page="community">
    <CommunityShell :active="info ? currentBoard : ''">
      <section class="cm-page" aria-labelledby="editor-title">
        <header class="cm-board-head"><div><h1 id="editor-title">{{ pageTitle }}</h1><p>{{ description }}</p></div></header>
        <p v-if="loading" class="cm-state" role="status">작성 화면을 준비하는 중입니다...</p>
        <div v-else-if="loadError" class="cm-state" role="alert">
          <p>{{ loadError }}</p>
          <a v-if="forbidden" class="cm-button cm-button--secondary" :href="returnPath">글로 돌아가기</a>
          <a v-else-if="blocked" class="cm-text-link" href="/community">게시판 목록 보기</a>
          <button v-else class="cm-button cm-button--secondary" type="button" @click="loadEditor(true)">다시 시도</button>
        </div>
        <div v-else-if="!profile" class="cm-state">
          <h2>로그인한 후 글을 쓸 수 있습니다.</h2>
          <p>게시글 목록과 내용은 누구나 볼 수 있어요.</p>
          <div class="cm-state__actions">
            <a class="cm-button" href="/login">로그인</a>
            <button class="cm-button cm-button--secondary" type="button" @click="loadEditor(true)">로그인 상태 다시 확인</button>
          </div>
        </div>
        <form v-else-if="canEdit" class="cm-editor" :aria-busy="submitting" @submit.prevent="submitPost">
          <p v-if="prefillNotice" class="cm-notice" role="status">{{ prefillNotice }}</p>
          <fieldset :disabled="submitting">
            <template v-if="isBuild">
              <div class="cm-field">
                <label class="cm-field__label" for="post-budget">예산 <span>필수 · 만 원 단위</span></label>
                <div class="cm-field__control">
                  <div class="cm-range">
                    <label class="sr-only" for="post-budget-range">예산 슬라이더 (50만 원~500만 원, 10만 원 단위)</label>
                    <input id="post-budget-range" class="cm-range__input" type="range" :min="BUDGET_SLIDER.min" :max="BUDGET_SLIDER.max" :step="BUDGET_SLIDER.step" :value="sliderValue" :aria-valuetext="budgetPreview || '예산 없음'" @input="slideBudget" />
                    <p class="cm-range__value" aria-hidden="true">{{ budgetPreview || '—' }}</p>
                  </div>
                  <div class="cm-range__scale" aria-hidden="true"><span>{{ BUDGET_SLIDER.min }}만 원</span><span>{{ BUDGET_SLIDER.max }}만 원</span></div>
                  <div class="cm-budget-row">
                    <div class="cm-budget"><input id="post-budget" v-model="budgetInput" inputmode="decimal" autocomplete="off" placeholder="예: 150" aria-describedby="post-budget-help" /><span>만 원</span></div>
                    <div class="cm-presets" role="group" aria-label="예산 빠른 선택">
                      <button v-for="manwon in BUDGET_PRESETS_MANWON" :key="manwon" class="cm-preset" type="button" :aria-pressed="budgetInput.trim() === String(manwon)" @click="pickBudget(manwon)">{{ manwon }}만 원</button>
                    </div>
                  </div>
                  <p id="post-budget-help" class="cm-help">{{ budgetPreview ? `${budgetPreview}으로 등록됩니다. 500만 원이 넘으면 칸에 직접 적어 주세요(1억 원까지).` : '10만 원부터 1억 원까지 입력할 수 있어요.' }}</p>
                </div>
              </div>
              <div class="cm-field" role="radiogroup" aria-labelledby="post-purpose-label" aria-required="true">
                <p id="post-purpose-label" class="cm-field__label">용도 <span>필수</span></p>
                <div class="cm-field__control">
                  <div class="cm-chips">
                    <label v-for="item in COMMUNITY_PURPOSES" :key="item.code" class="cm-chip" :class="{ 'cm-chip--solid': purpose === item.code }" :for="`post-purpose-${item.code}`" :title="item.hint">
                      <input :id="`post-purpose-${item.code}`" v-model="purpose" class="cm-chip__input" type="radio" name="post-purpose" :value="item.code" />{{ item.name }}
                    </label>
                  </div>
                </div>
              </div>
              <div class="cm-field" role="group" aria-labelledby="post-pref-label">
                <p id="post-pref-label" class="cm-field__label">선호 사항 <span>선택 · 여러 개 고를 수 있어요</span></p>
                <div class="cm-field__control">
                  <div class="cm-chips">
                    <label v-for="item in BUILD_PREFERENCES" :key="item.code" class="cm-chip" :class="{ 'cm-chip--on': preferences.includes(item.code) }" :for="`post-pref-${item.code}`">
                      <input :id="`post-pref-${item.code}`" v-model="preferences" class="cm-chip__input" type="checkbox" :value="item.code" />{{ item.name }}
                    </label>
                  </div>
                </div>
              </div>
            </template>
            <div class="cm-field-grid" :class="{ 'cm-field-grid--single': !isBuild }">
              <div v-if="isBuild" class="cm-field">
                <label class="cm-field__label" for="post-monitor">모니터 해상도 <span>선택</span></label>
                <div class="cm-field__control">
                  <select id="post-monitor" :value="monitorResolution" @change="monitorResolution = $event.target.value">
                    <option v-if="allowNoResolution" value="">선택 안 함</option>
                    <option v-for="item in MONITOR_RESOLUTIONS" :key="item.code" :value="item.code">{{ item.name }}</option>
                  </select>
                </div>
              </div>
              <div class="cm-field">
                <label class="cm-field__label" for="post-title">제목 <span>필수</span></label>
                <div class="cm-field__control">
                  <input id="post-title" v-model="title" required :maxlength="MAX_POST_TITLE_LENGTH" :placeholder="titleHint" aria-describedby="post-title-count" />
                  <p id="post-title-count" class="cm-count">{{ textLength(title) }} / 200</p>
                </div>
              </div>
            </div>
            <div class="cm-field">
              <label class="cm-field__label" for="post-content">{{ isBuild ? '요청 내용' : '내용' }} <span>필수</span></label>
              <div class="cm-field__control">
                <textarea id="post-content" v-model="content" required :maxlength="MAX_POST_CONTENT_LENGTH" rows="8" :placeholder="isBuild ? BUILD_CONTENT_PLACEHOLDER : '자유롭게 이야기를 남겨 주세요.'" aria-describedby="post-content-count"></textarea>
                <p id="post-content-count" class="cm-count">{{ textLength(content).toLocaleString('ko-KR') }} / 10,000</p>
              </div>
            </div>
          </fieldset>
          <div v-if="error" class="cm-error" role="alert">{{ error }} <a v-if="needsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
          <p v-if="submitting" class="cm-help" role="status">글을 저장하는 중입니다...</p>
          <div class="cm-form-actions">
            <p v-if="isBuild && !editing" class="cm-form-actions__note">등록하면 견적 게시판에 공개돼요. 견적이 도착하면 알림을 보내드립니다.</p>
            <div class="cm-form-actions__buttons">
              <a class="cm-button cm-button--secondary" :href="returnPath">취소</a>
              <button class="cm-button" type="submit" :disabled="submitting">{{ submitting ? '저장 중...' : submitLabel }}</button>
            </div>
          </div>
        </form>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
