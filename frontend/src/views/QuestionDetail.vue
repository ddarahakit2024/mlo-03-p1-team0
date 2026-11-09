<script setup>
import { computed, onMounted, ref } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import InlineConfirm from '../components/InlineConfirm.vue'
import PriceChangeBadge from '../components/PriceChangeBadge.vue'
import { acceptAnswer, createAnswer, deleteAnswer, deleteQuestion, fetchQuestion, unacceptAnswer, updateAnswer } from '../api/questionApi.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import {
  MAX_ANSWER_LENGTH, acceptAction, acceptError, answerError, answerLength, formatViewCount, goToQuestion, isAcceptedAnswer, orderAnswers, questionError,
  validateAnswer,
} from '../stores/questionViewModel.js'
import { authorInitial, formatBoardDateTime, isEdited } from '../stores/communityViewModel.js'
import { formatPrice, getProductImage, productPath } from '../stores/productViewModel.js'
import { track } from '../stores/tracking.js'

// 질문 상세(디자인 "question detail"): ← 질문 게시판 → 질문 카드(게시판 이름·답변 수 알약, 제목, 글쓴이 · 날짜 · 조회 N,
// 관련 부품 카드(사진·"관련 부품 · 브랜드"·이름 링크·판매가·30일 변동), 본문, 첨부 이미지, 목록·수정·삭제)
// → 답변 N(채택된 답변이 맨 위, "채택된 답변" 배지) → 답변 쓰기.
// 채택: 질문을 쓴 사람(is_owner)에게만 답변마다 "채택하기"/"채택 취소". 한 번에 하나, 결과(질문 상세)로 화면을 바꾸고 실패는 그 답변 아래 role=alert.
// 시뮬레이터가 쓰는 이름은 바꾸지 않는다: 로딩 "질문을 불러오는 중입니다...", 입력 "답변 남기기…", 버튼 "답변 등록".

const props = defineProps({ questionId: { type: Number, default: null } })
const question = ref(null)
const loading = ref(true)
const error = ref('')
const missing = ref(false)
const deleting = ref(false)
// 질문 삭제도 화면 안 확인(InlineConfirm)을 거친다. 확인 중에는 수정·삭제 버튼 자리에 "예/아니요"를 보여 준다
const confirmingQuestion = ref(false)
const actionError = ref('')
const needsLogin = ref(false)
const brokenImages = ref([])
const productImageBroken = ref(false)

// 답변: 목록(오래된 순)은 질문 상세에 함께 온다. 작성은 로그인한 누구나, 수정·삭제는 서버가 준 is_owner 일 때만
const profile = ref(null)
const loginChecked = ref(false)
const answers = computed(() => question.value?.answers || [])
const orderedAnswers = computed(() => orderAnswers(question.value))
const answerContent = ref('')
const answerSaving = ref(false)
const answerFormError = ref('')
const answerNeedsLogin = ref(false)
const answerNotice = ref('')
const editingId = ref(null)
const editContent = ref('')
const editSaving = ref(false)
const editError = ref('')
const editNeedsLogin = ref(false)
const confirmingId = ref(null)
const deletingId = ref(null)
const deleteErrorId = ref(null)
const deleteErrorMessage = ref('')
// 채택: 진행 중인 답변 id(하나만), 실패한 답변 id 와 문구
const acceptingId = ref(null)
const acceptErrorId = ref(null)
const acceptErrorMessage = ref('')

async function loadQuestion() {
  loading.value = true
  error.value = ''
  missing.value = false
  if (!Number.isSafeInteger(props.questionId) || props.questionId < 1) {
    error.value = '올바르지 않은 질문 주소입니다.'
    missing.value = true
    loading.value = false
    return
  }
  try {
    question.value = await fetchQuestion(props.questionId)
    track('question_view', { question_id: question.value.id ?? props.questionId, answer_count: question.value.answer_count ?? answers.value.length })
    brokenImages.value = []
    productImageBroken.value = false
    checkLogin()
  } catch (failure) {
    missing.value = failure?.response?.status === 404
    error.value = missing.value ? '질문을 찾을 수 없습니다.' : questionError(failure, '질문을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally { loading.value = false }
}

// 답변 폼을 보여 줄지 정하려고 로그인 여부만 확인한다(레이아웃과 같은 공용 로그인 상태). 비로그인·오류면 로그인 링크를 보여 준다
async function checkLogin() {
  profile.value = memberProfile(await authSession.load())
  loginChecked.value = true
}

function askDeleteQuestion() {
  confirmingQuestion.value = true
  actionError.value = ''
  needsLogin.value = false
  confirmingId.value = null
}

// 삭제에 성공하면 목록으로 이동한다. 이동하는 동안에는 확인 상자를 막아 두 번 보내지 않는다. 실패하면 확인 상자를 그대로 두고 다시 시도할 수 있다
async function removeQuestion() {
  if (deleting.value) return
  deleting.value = true
  actionError.value = ''
  needsLogin.value = false
  try {
    await deleteQuestion(props.questionId)
    goToQuestion()
  } catch (failure) {
    needsLogin.value = failure?.response?.status === 401
    actionError.value = questionError(failure, '질문을 삭제하지 못했습니다. 다시 시도해 주세요.')
    deleting.value = false
  }
}

function replaceAnswers(next) {
  question.value = { ...question.value, answers: next }
}

// 답변 등록: 저장 중에는 두 번 보내지 않고, 실패하면 입력을 그대로 둔다. 성공하면 목록 끝(가장 최근)에 붙인다
async function submitAnswer() {
  if (answerSaving.value) return
  answerNeedsLogin.value = false
  answerNotice.value = ''
  answerFormError.value = validateAnswer({ content: answerContent.value })
  if (answerFormError.value) return
  answerSaving.value = true
  try {
    const created = await createAnswer(props.questionId, { content: answerContent.value })
    track('answer_submit', { question_id: props.questionId, action: 'create' })
    replaceAnswers([...answers.value, created])
    answerContent.value = ''
    answerNotice.value = '답변이 등록되었습니다.'
  } catch (failure) {
    answerNeedsLogin.value = failure?.response?.status === 401
    answerFormError.value = answerError(failure, '답변을 등록하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.')
  } finally { answerSaving.value = false }
}

function startEdit(answer) {
  editingId.value = answer.id
  editContent.value = answer.content
  editError.value = ''
  editNeedsLogin.value = false
  confirmingId.value = null
  answerNotice.value = ''
}

function cancelEdit() {
  if (editSaving.value) return
  editingId.value = null
  editContent.value = ''
  editError.value = ''
}

async function saveEdit(answer) {
  if (editSaving.value) return
  editNeedsLogin.value = false
  editError.value = validateAnswer({ content: editContent.value })
  if (editError.value) return
  editSaving.value = true
  try {
    const updated = await updateAnswer(props.questionId, answer.id, { content: editContent.value })
    track('answer_submit', { question_id: props.questionId, action: 'update' })
    replaceAnswers(answers.value.map((item) => (item.id === answer.id ? { ...item, ...updated } : item)))
    editingId.value = null
    editContent.value = ''
    answerNotice.value = '답변이 수정되었습니다.'
  } catch (failure) {
    editNeedsLogin.value = failure?.response?.status === 401
    editError.value = answerError(failure, '답변을 수정하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.')
  } finally { editSaving.value = false }
}

// 삭제는 화면 안 확인(InlineConfirm)을 거친다. 확인 중에는 그 답변의 수정·삭제 버튼 대신 "예/아니요"를 보여 준다
function askDelete(answer) {
  confirmingId.value = answer.id
  confirmingQuestion.value = false
  editingId.value = null
  deleteErrorId.value = null
  answerNotice.value = ''
}

async function removeAnswer(answer) {
  if (deletingId.value != null) return
  deletingId.value = answer.id
  deleteErrorId.value = null
  try {
    await deleteAnswer(props.questionId, answer.id)
    track('answer_submit', { question_id: props.questionId, action: 'delete' })
    // 채택된 답변을 지우면 서버가 채택을 지운다(CONTRACT §9). 화면도 같이 맞춘다
    const accepted = question.value?.accepted_answer_id === answer.id
    replaceAnswers(answers.value.filter((item) => item.id !== answer.id))
    if (accepted) question.value = { ...question.value, accepted_answer_id: null }
    confirmingId.value = null
    answerNotice.value = '답변이 삭제되었습니다.'
  } catch (failure) {
    deleteErrorId.value = answer.id
    deleteErrorMessage.value = answerError(failure, '답변을 삭제하지 못했습니다. 다시 시도해 주세요.')
  } finally { deletingId.value = null }
}

// 채택하기·채택 취소: 질문 작성자만(acceptAction 이 null 이면 버튼이 없다). 결과(질문 상세)로 화면을 바꾼다
async function toggleAccept(answer) {
  const action = acceptAction(question.value, answer)
  if (!action || acceptingId.value != null) return
  acceptingId.value = answer.id
  acceptErrorId.value = null
  answerNotice.value = ''
  try {
    const next = action === 'accept'
      ? await acceptAnswer(props.questionId, answer.id)
      : await unacceptAnswer(props.questionId, answer.id)
    if (next) question.value = next
    answerNotice.value = action === 'accept' ? '답변을 채택했습니다.' : '답변 채택을 취소했습니다.'
  } catch (failure) {
    acceptErrorId.value = answer.id
    acceptErrorMessage.value = acceptError(failure, action === 'accept' ? '답변을 채택하지 못했습니다. 다시 시도해 주세요.' : '채택을 취소하지 못했습니다. 다시 시도해 주세요.')
  } finally { acceptingId.value = null }
}

function acceptLabel(answer) {
  if (acceptingId.value === answer.id) return '처리 중...'
  return acceptAction(question.value, answer) === 'unaccept' ? '채택 취소' : '채택하기'
}

function productImage(product) {
  return productImageBroken.value ? '/product-placeholder.svg' : getProductImage(product)
}

onMounted(loadQuestion)
</script>

<template>
  <SiteLayout active-page="questions">
    <CommunityShell active="questions">
      <section class="cm-page">
        <p v-if="loading" class="cm-state" role="status">질문을 불러오는 중입니다...</p>
        <div v-else-if="error" class="cm-state" role="alert"><h1>{{ error }}</h1><button v-if="!missing" class="cm-button cm-button--secondary" type="button" @click="loadQuestion">다시 시도</button><a v-else class="cm-text-link" href="/questions">목록으로 돌아가기</a></div>
        <template v-else-if="question">
          <a class="cm-back" href="/questions"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>질문 게시판</a>
          <article class="cm-post" aria-labelledby="question-title">
            <header class="cm-post__head">
              <p class="cm-post__kicker"><span class="cm-kicker">질문 게시판</span><span class="cm-pill" :class="{ 'cm-pill--on': answers.length > 0 }">답변 {{ answers.length }}</span></p>
              <h1 id="question-title" class="cm-post__title">{{ question.title }}</h1>
              <p class="cm-post__byline">
                <strong class="cm-post__author">{{ question.author?.name || '회원' }}</strong>
                <time :datetime="question.created_at">{{ formatBoardDateTime(question.created_at) }}</time>
                <span>{{ formatViewCount(question.view_count) }}</span>
                <span v-if="isEdited(question)">수정됨</span>
              </p>
            </header>
            <div v-if="question.product" class="q-part">
              <span class="q-part__photo"><img :src="productImage(question.product)" :alt="`${question.product.name} 이미지`" width="52" height="52" @error="productImageBroken = true" /></span>
              <span class="q-part__copy">
                <span class="q-part__label">관련 부품{{ question.product.brand ? ` · ${question.product.brand}` : '' }}</span>
                <a class="q-part__name" :href="productPath(question.product.id)">{{ question.product.name }}</a>
              </span>
              <span class="q-part__price">
                <strong>{{ formatPrice(question.product.price_krw) }}</strong>
                <PriceChangeBadge v-if="question.product.change_30d_pct != null" :pct="question.product.change_30d_pct" />
              </span>
            </div>
            <div class="cm-post__body">{{ question.content }}</div>
            <section v-if="question.images?.length" class="q-attachments" aria-labelledby="attachments-title">
              <h2 id="attachments-title">첨부 이미지 <span>{{ question.images.length }}</span></h2>
              <figure v-for="image in question.images" :key="image.id" class="q-attachment">
                <a :href="image.url" target="_blank" rel="noopener noreferrer" :aria-label="`${image.filename} 새 탭에서 원본 보기`">
                  <img v-if="!brokenImages.includes(image.id)" :src="image.url" :alt="image.filename" loading="lazy" @error="brokenImages = [...brokenImages, image.id]" />
                  <span v-else class="q-image-error">이미지를 표시하지 못했습니다. 원본 보기</span>
                </a><figcaption>{{ image.filename }}</figcaption>
              </figure>
              <p class="q-attachments-help">이미지가 표시되지 않으면 페이지를 새로고침해 주세요.</p>
            </section>
            <div class="cm-post__actions">
              <a class="cm-button cm-button--secondary" href="/questions">목록</a>
              <div v-if="question.is_owner" class="cm-post__owner" :class="{ 'cm-post__owner--confirm': confirmingQuestion }">
                <InlineConfirm v-if="confirmingQuestion" class="cm-owner-confirm" message="질문과 첨부 이미지를 삭제할까요? 삭제한 질문은 복구할 수 없습니다." :busy="deleting" @confirm="removeQuestion" @cancel="confirmingQuestion = false" />
                <template v-else><a class="cm-button cm-button--secondary" :href="`/questions/${question.id}/edit`">수정</a><button class="cm-button cm-button--danger" type="button" @click="askDeleteQuestion">삭제</button></template>
              </div>
            </div>
            <div v-if="actionError" class="cm-error" role="alert">{{ actionError }} <a v-if="needsLogin" class="cm-text-link" href="/login">다시 로그인</a></div>
          </article>

          <section class="q-answers" aria-labelledby="answers-title">
            <h2 id="answers-title" class="cm-section-title">답변 <span>{{ answers.length }}</span></h2>
            <p v-if="question.is_owner && answers.length" class="cm-section-help">도움이 된 답변을 채택하면 맨 위에 "채택된 답변"으로 보여요.</p>
            <p v-if="answerNotice" class="cm-notice" role="status">{{ answerNotice }}</p>
            <p v-if="!answers.length" class="cm-empty">아직 답변이 없습니다. 첫 답변을 남겨 주세요.</p>
            <ol v-else class="q-answer-list">
              <li v-for="answer in orderedAnswers" :key="answer.id" :class="isAcceptedAnswer(question, answer) ? 'q-answer q-answer--accepted' : 'q-answer'">
                <div class="q-answer__head">
                  <span class="cm-avatar" aria-hidden="true">{{ authorInitial(answer.author?.name) }}</span>
                  <strong class="q-answer__author">{{ answer.author?.name || '회원' }}</strong>
                  <time :datetime="answer.created_at">{{ formatBoardDateTime(answer.created_at) }}</time>
                  <span v-if="isEdited(answer)">수정됨</span>
                  <span v-if="isAcceptedAnswer(question, answer)" class="q-accepted-badge"><span aria-hidden="true">✓ </span>채택된 답변</span>
                </div>
                <form v-if="editingId === answer.id" class="cm-comment-form cm-comment-form--inline" :aria-busy="editSaving" @submit.prevent="saveEdit(answer)">
                  <fieldset :disabled="editSaving">
                    <div>
                      <label class="sr-only" :for="`answer-edit-${answer.id}`">답변 수정</label>
                      <textarea :id="`answer-edit-${answer.id}`" v-model="editContent" rows="4" :maxlength="MAX_ANSWER_LENGTH" :aria-describedby="`answer-edit-count-${answer.id}`"></textarea>
                    </div>
                  </fieldset>
                  <div v-if="editError" class="cm-error" role="alert">{{ editError }} <a v-if="editNeedsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
                  <div class="cm-comment-form__foot">
                    <p :id="`answer-edit-count-${answer.id}`" class="cm-count">{{ answerLength(editContent).toLocaleString('ko-KR') }} / 5,000</p>
                    <div class="cm-comment__actions"><button class="cm-button cm-button--secondary cm-button--compact" type="button" :disabled="editSaving" @click="cancelEdit">취소</button><button class="cm-button cm-button--compact" type="submit" :disabled="editSaving">{{ editSaving ? '저장 중...' : '수정 완료' }}</button></div>
                  </div>
                </form>
                <template v-else>
                  <div class="q-answer__body">{{ answer.content }}</div>
                  <InlineConfirm v-if="answer.is_owner && confirmingId === answer.id" message="이 답변을 삭제할까요? 삭제한 답변은 되돌릴 수 없습니다." :busy="deletingId === answer.id" @confirm="removeAnswer(answer)" @cancel="confirmingId = null" />
                  <div v-else-if="answer.is_owner || acceptAction(question, answer)" class="cm-comment__actions">
                    <button v-if="acceptAction(question, answer)" class="cm-button cm-button--compact q-accept" :class="acceptAction(question, answer) === 'accept' ? 'q-accept--do' : 'cm-button--secondary'" type="button" :disabled="acceptingId != null" :aria-busy="acceptingId === answer.id" @click="toggleAccept(answer)">{{ acceptLabel(answer) }}</button>
                    <template v-if="answer.is_owner"><button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="startEdit(answer)">수정</button><button class="cm-button cm-button--danger cm-button--compact" type="button" @click="askDelete(answer)">삭제</button></template>
                  </div>
                  <div v-if="acceptErrorId === answer.id" class="cm-error" role="alert">{{ acceptErrorMessage }}</div>
                  <div v-if="deleteErrorId === answer.id" class="cm-error" role="alert">{{ deleteErrorMessage }}</div>
                </template>
              </li>
            </ol>

            <form v-if="profile" class="q-compose" :aria-busy="answerSaving" @submit.prevent="submitAnswer">
              <h3 class="q-compose__title">답변 쓰기</h3>
              <fieldset :disabled="answerSaving">
                <div>
                  <label class="sr-only" for="answer-content">답변 남기기 (최대 5,000자)</label>
                  <textarea id="answer-content" v-model="answerContent" rows="4" :maxlength="MAX_ANSWER_LENGTH" placeholder="해결 방법, 확인해 볼 설정, 비슷한 경험을 알려 주세요." aria-describedby="answer-content-count"></textarea>
                </div>
              </fieldset>
              <div v-if="answerFormError" class="cm-error" role="alert">{{ answerFormError }} <a v-if="answerNeedsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
              <div class="cm-comment-form__foot">
                <p id="answer-content-count" class="cm-count">{{ answerLength(answerContent).toLocaleString('ko-KR') }} / 5,000</p>
                <button class="cm-button" type="submit" :disabled="answerSaving">{{ answerSaving ? '저장 중...' : '답변 등록' }}</button>
              </div>
            </form>
            <div v-else-if="loginChecked" class="q-compose q-compose--guest">
              <h3 class="q-compose__title">답변 쓰기</h3>
              <p class="q-compose__placeholder">로그인하면 글을 쓸 수 있어요</p>
              <div class="q-compose__foot"><a class="cm-button" href="/login">로그인하고 쓰기</a></div>
            </div>
          </section>
        </template>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
