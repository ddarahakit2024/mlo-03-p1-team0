<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SiteLayout from '../components/SiteLayout.vue'
import CommunityShell from '../components/CommunityShell.vue'
import { createQuestion, fetchQuestion, updateQuestion } from '../api/questionApi.js'
import { fetchProduct, fetchProducts } from '../api/productApi.js'
import { authSession, memberProfile } from '../stores/authSession.js'
import { categoryName, formatPrice, getProductImage } from '../stores/productViewModel.js'
import {
  PRODUCT_SEARCH_DEBOUNCE_MS, PRODUCT_SEARCH_PAGE_SIZE, goToQuestion, productChange, questionError, readProductQuery, validateQuestion, validateQuestionImages,
} from '../stores/questionViewModel.js'

// 질문 글쓰기·수정(디자인 "새 질문": 제목 → 관련 부품(선택) → 내용, 그리고 이미지 첨부·취소·등록).
// 관련 부품: 검색어를 0.3초 모아 GET /products?search=&page_size=10(늦게 온 이전 응답은 버린다) → 고르면 칩(지우기).
// 상품 상세에서 ?product={id} 로 열면 그 상품(GET /products/{id})을 미리 고른다(실패하면 고르지 않은 채로 둔다).
// 등록은 고른 부품이 있을 때만 productId 를, 수정은 부품이 바뀌었을 때만 productId 를 보낸다(지우면 null = 연결 해제).
// 시뮬레이터가 쓰는 이름은 바꾸지 않는다: 입력 "제목…"·"내용…", 버튼 "질문 등록".

const props = defineProps({ questionId: { type: Number, default: null }, editing: { type: Boolean, default: false } })
const title = ref('')
const content = ref('')
const attachments = ref([])
const existingImages = ref([])
const profile = ref(null)
const loading = ref(true)
const loadError = ref('')
const blocked = ref(false)
const submitting = ref(false)
const error = ref('')
const imageError = ref('')
const needsLogin = ref(false)
const canEdit = ref(false)
const returnPath = computed(() => props.editing && props.questionId ? `/questions/${props.questionId}` : '/questions')

// 관련 부품(선택): product = 고른 상품(ProductSummary 의 id·name·brand·category·thumbnail_url·price_krw), originalProductId = 수정 전 연결된 부품
const product = ref(null)
const originalProductId = ref(null)
const productSearch = ref('')
const productResults = ref([])
const productState = ref('idle')
const productError = ref('')
const productNotice = ref('')
const searchedTerm = ref('')
let productTimer = null
let productRequest = 0

function productSummary(item) {
  return { id: item.id, name: item.name || '', brand: item.brand || '', category: item.category || '', thumbnail_url: item.thumbnail_url || '', price_krw: item.price_krw }
}

// recheck: "다시 시도"·"로그인 상태 다시 확인"이면 로그인 상태를 다시 부른다(처음에는 레이아웃과 같은 공용 상태를 쓴다)
async function loadEditor(recheck = false) {
  loading.value = true
  loadError.value = ''
  blocked.value = false
  const auth = await (recheck ? authSession.refresh() : authSession.load())
  profile.value = memberProfile(auth)
  // 401 만 비로그인(guest)이다. 서버 다운·5xx 는 로그인 안내 대신 오류와 다시 시도를 보여 준다
  if (auth.status === 'error') loadError.value = questionError(auth.error, '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
  if (!profile.value) { loading.value = false; return }
  if (props.editing) {
    if (!Number.isSafeInteger(props.questionId) || props.questionId < 1) {
      loadError.value = '올바르지 않은 질문 주소입니다.'
      blocked.value = true
    } else {
      try {
        const question = await fetchQuestion(props.questionId)
        canEdit.value = Boolean(question.is_owner)
        if (!canEdit.value) { loadError.value = '본인이 작성한 질문만 수정할 수 있습니다.'; blocked.value = true }
        else {
          title.value = question.title
          content.value = question.content
          existingImages.value = question.images
          product.value = question.product ? productSummary(question.product) : null
          originalProductId.value = question.product?.id ?? null
        }
      } catch (failure) {
        blocked.value = failure?.response?.status === 404
        loadError.value = blocked.value ? '질문을 찾을 수 없습니다.' : questionError(failure, '질문을 불러오지 못했습니다. 다시 시도해 주세요.')
      }
    }
  } else {
    canEdit.value = true
    preselectProduct()
  }
  loading.value = false
}

// 상품 상세의 "질문하기"(?product={id}): 그 상품을 미리 고른다. 실패해도 글쓰기는 그대로(검색해서 고르면 된다)
async function preselectProduct() {
  const id = readProductQuery()
  if (id == null || product.value) return
  try {
    const item = await fetchProduct(id)
    if (!product.value && item?.id != null) product.value = productSummary(item)
  } catch {
    productNotice.value = '연결하려던 부품을 불러오지 못했습니다. 검색해서 골라 주세요.'
  }
}

function resetProductSearch() {
  clearTimeout(productTimer)
  productTimer = null
  productRequest++
  productResults.value = []
  productState.value = 'idle'
  productError.value = ''
}

// 검색어가 바뀌면 0.3초 모아서 찾는다. 비우면 결과를 지우고 진행 중인 검색은 버린다
function scheduleProductSearch() {
  const term = productSearch.value.trim()
  resetProductSearch()
  if (!term) return
  productState.value = 'loading'
  productTimer = setTimeout(searchProducts, PRODUCT_SEARCH_DEBOUNCE_MS)
}

// 지금 검색어로 바로 찾는다(모으는 시간이 끝났을 때·Enter·다시 시도)
async function searchProducts() {
  clearTimeout(productTimer)
  productTimer = null
  const term = productSearch.value.trim()
  const request = ++productRequest
  if (!term) {
    resetProductSearch()
    return
  }
  productState.value = 'loading'
  productError.value = ''
  try {
    const data = await fetchProducts({ search: term, pageSize: PRODUCT_SEARCH_PAGE_SIZE })
    if (request !== productRequest) return
    productResults.value = data?.items || []
    searchedTerm.value = term
    productState.value = 'ready'
  } catch (failure) {
    if (request !== productRequest) return
    productState.value = 'error'
    productError.value = questionError(failure, '부품을 찾지 못했습니다. 다시 시도해 주세요.')
  }
}

watch(productSearch, scheduleProductSearch)

function chooseProduct(item) {
  product.value = productSummary(item)
  productNotice.value = ''
  productSearch.value = ''
}

function clearProduct() {
  product.value = null
}

function selectImages(event) {
  const files = Array.from(event.target.files || [])
  const validation = validateQuestionImages([...attachments.value.map((item) => item.file), ...files])
  event.target.value = ''
  imageError.value = validation
  if (validation) return
  attachments.value = [...attachments.value, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))]
}

function removeImage(index) {
  URL.revokeObjectURL(attachments.value[index].preview)
  attachments.value = attachments.value.filter((_, itemIndex) => itemIndex !== index)
  imageError.value = ''
}

async function submitQuestion() {
  if (submitting.value) return
  error.value = validateQuestion({ title: title.value, content: content.value })
  if (error.value) return
  submitting.value = true
  needsLogin.value = false
  try {
    const data = { title: title.value, content: content.value }
    let question
    if (props.editing) {
      question = await updateQuestion(props.questionId, { ...data, ...productChange(originalProductId.value, product.value?.id) })
    } else {
      const payload = { ...data, images: attachments.value.map((item) => item.file) }
      if (product.value) payload.productId = product.value.id
      question = await createQuestion(payload)
    }
    goToQuestion(question.id)
  } catch (failure) {
    needsLogin.value = failure?.response?.status === 401
    error.value = questionError(failure, '질문을 저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.')
  } finally { submitting.value = false }
}

onMounted(() => loadEditor())
onBeforeUnmount(() => {
  clearTimeout(productTimer)
  attachments.value.forEach((item) => URL.revokeObjectURL(item.preview))
})
</script>

<template>
  <SiteLayout active-page="questions">
    <CommunityShell active="questions">
      <section class="cm-page" aria-labelledby="editor-title">
        <header class="cm-board-head">
          <div><h1 id="editor-title">{{ editing ? '질문 수정' : '질문 게시판 글쓰기' }}</h1><p>{{ editing ? '제목·내용·관련 부품을 고칠 수 있어요. 첨부한 이미지는 그대로 유지됩니다.' : '부품을 지정해서 물어보면 답변이 빨라요. 쓰는 부품과 증상을 자세히 적을수록 답을 찾기 쉬워요.' }}</p></div>
        </header>
        <p v-if="loading" class="cm-state" role="status">작성 화면을 준비하는 중입니다...</p>
        <div v-else-if="loadError" class="cm-state" role="alert"><p>{{ loadError }}</p><button v-if="!blocked" class="cm-button cm-button--secondary" type="button" @click="loadEditor(true)">다시 시도</button><a v-else class="cm-text-link" href="/questions">목록으로 돌아가기</a></div>
        <div v-else-if="!profile" class="cm-state">
          <h2>로그인하고 질문을 남겨 주세요.</h2>
          <p>질문 목록과 상세 내용은 누구나 볼 수 있어요.</p>
          <div class="cm-state__actions"><a class="cm-button" href="/login">로그인</a><button class="cm-button cm-button--secondary" type="button" @click="loadEditor(true)">로그인 상태 다시 확인</button></div>
        </div>
        <form v-else-if="canEdit" class="cm-editor" :aria-busy="submitting" @submit.prevent="submitQuestion">
          <fieldset :disabled="submitting">
            <div class="cm-field">
              <label class="cm-field__label" for="question-title">제목 <span>필수</span></label>
              <div class="cm-field__control">
                <input id="question-title" v-model="title" required maxlength="200" placeholder="예: 7600에 4070 SUPER 병목 있을까요?" aria-describedby="title-count" />
                <p id="title-count" class="cm-count">{{ title.length }} / 200</p>
              </div>
            </div>
            <div class="cm-field">
              <label class="cm-field__label" for="question-product-search">관련 부품 <span>선택</span></label>
              <div class="cm-field__control">
                <div v-if="product" class="q-product-chip">
                  <span class="q-product-chip__photo"><img :src="getProductImage(product)" :alt="`${product.name} 이미지`" width="40" height="40" /></span>
                  <span class="q-product-chip__copy"><span>{{ [product.brand, categoryName(product.category)].filter(Boolean).join(' · ') }}</span><strong>{{ product.name }}</strong></span>
                  <button class="q-product-chip__clear" type="button" :aria-label="`관련 부품 ${product.name} 지우기`" @click="clearProduct">지우기</button>
                </div>
                <input id="question-product-search" v-model="productSearch" type="search" autocomplete="off" maxlength="200" :placeholder="product ? '다른 부품으로 바꾸려면 검색해 주세요' : '부품 이름이나 브랜드로 찾기 (예: 9800X3D)'" aria-describedby="question-product-help" @keydown.enter.prevent="searchProducts" />
                <p id="question-product-help" class="cm-help">{{ productNotice || '고르지 않아도 됩니다. 고른 부품은 질문 위에 카드로 보여요.' }}</p>
                <p v-if="productState === 'loading'" class="q-product-status" role="status">부품을 찾는 중입니다...</p>
                <div v-else-if="productState === 'error'" class="q-product-status q-product-status--error" role="alert"><span>{{ productError }}</span><button class="cm-button cm-button--secondary cm-button--compact" type="button" @click="searchProducts">다시 시도</button></div>
                <p v-else-if="productState === 'ready' && !productResults.length" class="q-product-status">'{{ searchedTerm }}'에 맞는 부품이 없습니다. 다른 이름으로 찾아보세요.</p>
                <ul v-if="productState === 'ready' && productResults.length" class="q-product-results" aria-label="부품 검색 결과">
                  <li v-for="item in productResults" :key="item.id">
                    <button class="q-product-option" type="button" :aria-pressed="product?.id === item.id" @click="chooseProduct(item)">
                      <span class="q-product-chip__photo"><img :src="getProductImage(item)" alt="" width="40" height="40" loading="lazy" /></span>
                      <span class="q-product-chip__copy"><span>{{ [item.brand, categoryName(item.category)].filter(Boolean).join(' · ') }}</span><strong>{{ item.name }}</strong></span>
                      <span class="q-product-option__price">{{ formatPrice(item.price_krw) }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>
            <div class="cm-field">
              <label class="cm-field__label" for="question-content">내용 <span>필수</span></label>
              <div class="cm-field__control">
                <textarea id="question-content" v-model="content" required maxlength="10000" rows="10" placeholder="현재 구성, 용도, 궁금한 점을 적어 주세요. 쓰는 부품(CPU, 메인보드, 그래픽카드, 파워 등)과 시도해 본 방법을 알려 주면 좋아요." aria-describedby="content-count" />
                <p id="content-count" class="cm-count">{{ content.length.toLocaleString('ko-KR') }} / 10,000</p>
              </div>
            </div>
            <div v-if="!editing" class="cm-field">
              <p id="image-label" class="cm-field__label">이미지 첨부 <span>선택 · {{ attachments.length }} / 5</span></p>
              <div class="cm-field__control" role="group" aria-labelledby="image-label">
                <p id="image-help" class="cm-help">JPG, PNG, GIF, WebP · 최대 5장 · 한 장당 5MB 이하</p>
                <label class="q-file-label" for="question-images">이미지 선택<input id="question-images" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple aria-describedby="image-help image-error" @change="selectImages" /></label>
                <p id="image-error" class="q-error" :role="imageError ? 'alert' : undefined">{{ imageError }}</p>
                <ul v-if="attachments.length" class="q-previews"><li v-for="(image, index) in attachments" :key="image.preview"><img :src="image.preview" :alt="image.file.name" /><div><span>{{ image.file.name }}</span><button class="q-remove-image" type="button" :aria-label="`${image.file.name} 첨부 취소`" @click="removeImage(index)">삭제</button></div></li></ul>
              </div>
            </div>
            <div v-else-if="existingImages.length" class="cm-field">
              <p id="existing-images-label" class="cm-field__label">첨부 이미지 <span>{{ existingImages.length }}장</span></p>
              <div class="cm-field__control" role="group" aria-labelledby="existing-images-label">
                <p class="cm-help">수정할 때 기존 이미지는 그대로 유지됩니다.</p>
                <ul class="q-existing-images"><li v-for="image in existingImages" :key="image.id"><a :href="image.url" target="_blank" rel="noopener noreferrer">{{ image.filename }}</a></li></ul>
              </div>
            </div>
          </fieldset>
          <div v-if="error" class="cm-error" role="alert">{{ error }} <a v-if="needsLogin" class="cm-text-link" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></div>
          <p v-if="submitting" class="cm-help" role="status">{{ attachments.length ? '이미지를 업로드하고 질문을 등록하는 중입니다. 잠시 기다려 주세요.' : '질문을 저장하는 중입니다...' }}</p>
          <div class="cm-form-actions"><a class="cm-button cm-button--secondary" :href="returnPath">취소</a><button class="cm-button" type="submit" :disabled="submitting">{{ submitting ? '저장 중...' : (editing ? '수정 내용 저장' : '질문 등록') }}</button></div>
        </form>
      </section>
    </CommunityShell>
  </SiteLayout>
</template>
