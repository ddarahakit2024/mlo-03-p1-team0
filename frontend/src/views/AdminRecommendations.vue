<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchRecommendationComparison, fetchRecommendationModels, trainRecommendations } from '../api/adminApi.js'
import { SiteLayout } from '../components/index.js'
import { categoryName, formatPrice, productPath } from '../stores/productViewModel.js'
import {
  COMPARE_NOT_FOUND_MESSAGE, DEFAULT_COMPARE_PRODUCT_ID, RECOMMENDATION_COMPARE_LIMIT, eventPeriodLabel, formatCount, formatDuration,
  formatRecommendationScore, formatSeoulDateTime, getComparisonState, getRecommendationsPageState, modelLabel, parseProductNumber, rankChanges,
  recommendationError, toSeoulInputValue, trainingSince, trainingSuccessMessage, validateProductNumber,
} from '../stores/recommendationViewModel.js'

// 관리자 추천 학습(spec docs/specs/2026-11-03-product-recommendations.md "화면"). 관리자 여부는 서버가 판단한다:
// GET /admin/recommendations/models 가 401 이면 로그인 안내, 403 이면 "관리자만 볼 수 있습니다."
// ① 학습: "전체" / "이 시각 이후"(datetime-local. 기본값 = 학습 기록의 server_time 을 서울 시각으로, 보낼 때 +09:00 을 붙인다).
//    학습 중에는 fieldset·버튼을 막고("학습 중..."), 성공하면 role="status" 문구 뒤 ②·③ 을 다시 부른다. 실패(409·422·503)는 role="alert" 서버 문구, 입력은 그대로
// ② 학습 기록: 최근 모델 5개(최신 먼저). 0개면 기본 추천 안내(빈 목록 상태에서도 학습·비교는 쓸 수 있다)
// ③ 상품별 순위 비교: 상품 번호(기본 1) → 현재 / 이전 표. 현재 표의 칸마다 이전 표와 product_id 로 비교한 ▲n·▼n·새로(글자)
// 학습 기록·순위 비교는 요청 번호로 늦게 온 이전 응답을 버린다. 점수·개수·시각은 서버 값을 그대로 보여 준다
const TRAIN_FAILED_MESSAGE = '추천 모델을 학습하지 못했습니다. 잠시 후 다시 시도해 주세요.'

const models = ref(null)
const loading = ref(true)
const error = ref('')
const needsLogin = ref(false)
const forbidden = ref(false)
const refreshError = ref('')
const modelItems = computed(() => (Array.isArray(models.value?.items) ? models.value.items : []))
const pageState = computed(() => getRecommendationsPageState({
  loading: loading.value, needsLogin: needsLogin.value, forbidden: forbidden.value, error: error.value, items: modelItems.value,
}))
let modelsRequestId = 0

// ① 학습: scope 'all'(전체) | 'since'(이 시각 이후), sinceText 는 datetime-local 값(서울 시각)
const scope = ref('all')
const sinceText = ref('')
const training = ref(false)
const trainNotice = ref('')
const trainError = ref('')
const trainNeedsLogin = ref(false)

// ③ 상품별 순위 비교
const productInput = ref(DEFAULT_COMPARE_PRODUCT_ID)
const productInputError = ref('')
const comparedId = ref(DEFAULT_COMPARE_PRODUCT_ID)
const comparison = ref(null)
const compareLoading = ref(false)
const compareError = ref('')
const compareMissing = ref(false)
const compareNeedsLogin = ref(false)
const compareState = computed(() => getComparisonState({
  loading: compareLoading.value, missing: compareMissing.value, error: compareError.value, comparison: comparison.value,
}))
const currentItems = computed(() => (Array.isArray(comparison.value?.current?.items) ? comparison.value.current.items : []))
// 이전 순위가 없으면(모델 0개) null: 순위 변화를 표시하지 않는다
const previousItems = computed(() => {
  const previous = comparison.value?.previous
  if (!previous) return null
  return Array.isArray(previous.items) ? previous.items : []
})
const changes = computed(() => rankChanges(currentItems.value, previousItems.value))
let compareRequestId = 0

/**
 * 학습 기록을 부른다. 처음 열 때는 화면 전체 상태(로딩·401·403·오류)를 바꾸고, quiet(학습 뒤 다시 부르기)면 지금 표를 둔 채 바꾸며
 * 실패하면 표 위에 오류와 다시 시도를 보여 준다. "이 시각 이후"가 비어 있으면 server_time 을 기본값으로 넣는다(입력한 값은 바꾸지 않는다).
 * 성공하면 true.
 */
async function loadModels({ quiet = false } = {}) {
  const request = ++modelsRequestId
  if (!quiet) {
    loading.value = true
    error.value = ''
    needsLogin.value = false
    forbidden.value = false
  }
  refreshError.value = ''
  try {
    const data = await fetchRecommendationModels()
    if (request !== modelsRequestId) return false
    models.value = data
    if (!sinceText.value) sinceText.value = toSeoulInputValue(data?.server_time)
    return true
  } catch (failure) {
    if (request !== modelsRequestId) return false
    if (quiet) {
      refreshError.value = recommendationError(failure, '학습 기록을 다시 불러오지 못했습니다. 다시 시도해 주세요.')
      return false
    }
    const code = failure?.response?.status
    needsLogin.value = code === 401
    forbidden.value = code === 403
    if (!needsLogin.value && !forbidden.value) error.value = recommendationError(failure, '추천 학습 정보를 불러오지 못했습니다. 다시 시도해 주세요.')
    return false
  } finally {
    if (request === modelsRequestId && !quiet) loading.value = false
  }
}

/** 상품 하나의 현재·이전 추천 순위를 부른다. 404 는 번호 확인 안내, 그 밖의 실패는 오류와 다시 시도. */
async function loadComparison(productId = comparedId.value) {
  const request = ++compareRequestId
  comparedId.value = productId
  compareLoading.value = true
  compareError.value = ''
  compareMissing.value = false
  compareNeedsLogin.value = false
  try {
    const data = await fetchRecommendationComparison(productId, { limit: RECOMMENDATION_COMPARE_LIMIT })
    if (request !== compareRequestId) return
    comparison.value = data
  } catch (failure) {
    if (request !== compareRequestId) return
    const code = failure?.response?.status
    comparison.value = null
    compareMissing.value = code === 404
    compareNeedsLogin.value = code === 401
    if (!compareMissing.value) compareError.value = recommendationError(failure, '추천 순위를 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    if (request === compareRequestId) compareLoading.value = false
  }
}

// 처음 열 때·다시 시도·로그인 상태 다시 확인: 학습 기록(권한 확인)을 받은 뒤 순위 비교를 부른다
async function openPage() {
  if (await loadModels()) loadComparison()
}

function chooseScope(value) {
  scope.value = value
  trainError.value = ''
}

// ① 학습: 두 번 보내지 않고, 실패해도 고른 기간·시각은 그대로 둔다
async function train() {
  if (training.value) return
  trainNotice.value = ''
  trainError.value = ''
  trainNeedsLogin.value = false
  const { since, error: problem } = trainingSince({ scope: scope.value, sinceText: sinceText.value })
  if (problem) {
    trainError.value = problem
    return
  }
  training.value = true
  let trained = null
  try {
    trained = { model: await trainRecommendations({ since }) }
  } catch (failure) {
    trainNeedsLogin.value = failure?.response?.status === 401
    trainError.value = recommendationError(failure, TRAIN_FAILED_MESSAGE)
  } finally {
    training.value = false
  }
  if (!trained) return
  trainNotice.value = trainingSuccessMessage(trained.model)
  await Promise.all([loadModels({ quiet: true }), loadComparison()])
}

// ③ 비교하기: 번호를 검증한 뒤에만 요청한다
function submitCompare() {
  productInputError.value = validateProductNumber(productInput.value)
  if (productInputError.value) return
  loadComparison(parseProductNumber(productInput.value))
}

/** 현재·이전 표 위의 설명: 모델이면 학습 시각, 기본 추천이면 계산 방식. */
function sideDescription(side) {
  const trainedAt = formatSeoulDateTime(side?.model?.trained_at)
  if (side?.model) return trainedAt ? `${trainedAt} 학습` : '학습한 모델'
  return '같은 카테고리·비슷한 가격으로 계산한 순위'
}

onMounted(openPage)
</script>

<template>
  <SiteLayout active-page="">
    <section class="shop-page admin-recs" aria-labelledby="admin-recs-title">
      <div class="admin-recs__heading">
        <h1 id="admin-recs-title">추천 학습</h1>
        <p>상품 조회 이벤트로 "함께 본 상품" 추천(Item-CF)을 학습합니다. 학습하면 상품 상세의 추천 상품이 새 모델의 순위로 바뀝니다.</p>
      </div>
      <div :aria-busy="loading">
        <p v-if="pageState === 'loading'" class="shop-state" role="status">추천 학습 정보를 불러오는 중입니다...</p>
        <div v-else-if="pageState === 'guest'" class="shop-state">
          <h2>로그인한 관리자만 볼 수 있습니다.</h2><p>관리자 계정으로 로그인한 뒤 다시 열어 주세요.</p>
          <div class="shop-state__actions"><a class="shop-button" href="/login">로그인</a><button class="shop-button shop-button--secondary" type="button" @click="openPage">로그인 상태 다시 확인</button></div>
        </div>
        <div v-else-if="pageState === 'forbidden'" class="shop-state">
          <h2>관리자만 볼 수 있습니다.</h2><p>추천 학습은 관리자 계정에서만 쓸 수 있습니다. 관리자 계정으로 로그인했는지 확인해 주세요.</p>
          <a class="shop-button shop-button--secondary" href="/products">상품 보러 가기</a>
        </div>
        <div v-else-if="pageState === 'error'" class="shop-state" role="alert">
          <p>{{ error }}</p><button class="shop-button shop-button--secondary" type="button" @click="openPage">다시 시도</button>
        </div>
        <div v-else class="admin-recs__sections">
          <section class="admin-recs__panel" aria-labelledby="admin-recs-train-title">
            <h2 id="admin-recs-train-title"><span class="admin-recs__step" aria-hidden="true">1</span>학습</h2>
            <form class="admin-recs__train" :aria-busy="training" novalidate @submit.prevent="train">
              <fieldset class="admin-recs__scope" :disabled="training">
                <legend>학습에 쓸 이벤트</legend>
                <div class="admin-recs__options">
                  <label class="admin-recs__option" :class="{ 'admin-recs__option--checked': scope === 'all' }">
                    <input id="recommendation-scope-all" type="radio" name="recommendation-scope" value="all" :checked="scope === 'all'" @change="chooseScope('all')" />전체
                  </label>
                  <label class="admin-recs__option" :class="{ 'admin-recs__option--checked': scope === 'since' }">
                    <input id="recommendation-scope-since" type="radio" name="recommendation-scope" value="since" :checked="scope === 'since'" @change="chooseScope('since')" />이 시각 이후
                  </label>
                </div>
                <div class="admin-recs__since">
                  <label for="recommendation-since">시작 시각(한국 시간)</label>
                  <input id="recommendation-since" v-model="sinceText" type="datetime-local" step="1" :disabled="scope !== 'since'" aria-describedby="recommendation-since-help" />
                  <p id="recommendation-since-help">기본값은 서버 시각입니다(로컬 Docker 는 가상 시계 시각). "이 시각 이후"를 고르면 이 시각 뒤에 받은 상품 조회 이벤트만 학습에 씁니다.</p>
                </div>
              </fieldset>
              <div class="admin-recs__actions">
                <button class="shop-button" type="submit" :disabled="training" :aria-busy="training">{{ training ? '학습 중...' : '추천 학습하기' }}</button>
              </div>
            </form>
            <p v-if="trainNotice" class="shop-message admin-recs__notice" role="status">{{ trainNotice }}</p>
            <p v-if="trainError" class="shop-message shop-message--error admin-recs__notice" role="alert">
              {{ trainError }}<a v-if="trainNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>
            </p>
          </section>

          <section class="admin-recs__panel" aria-labelledby="admin-recs-history-title">
            <h2 id="admin-recs-history-title"><span class="admin-recs__step" aria-hidden="true">2</span>학습 기록</h2>
            <div v-if="refreshError" class="shop-message shop-message--error admin-recs__refresh" role="alert">
              <p>{{ refreshError }}</p><button class="shop-button shop-button--secondary" type="button" @click="loadModels({ quiet: true })">다시 시도</button>
            </div>
            <p v-if="!modelItems.length" class="admin-recs__empty">아직 학습한 모델이 없습니다. 지금은 기본 추천(같은 카테고리·비슷한 가격)을 보여 줍니다.</p>
            <div v-else class="admin-recs__table-wrap" role="region" aria-label="학습 기록 표" tabindex="0">
              <table class="admin-recs__table">
                <caption class="sr-only">최근 학습한 추천 모델(최신 먼저, 최대 5개). 맨 위 모델을 상품 상세 추천에 씁니다.</caption>
                <thead>
                  <tr>
                    <th scope="col">버전</th><th scope="col">학습 시각</th><th scope="col">이벤트 기간</th>
                    <th scope="col" class="admin-recs__num">상품 조회 이벤트</th><th scope="col" class="admin-recs__num">세션</th><th scope="col" class="admin-recs__num">걸린 시간</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(model, index) in modelItems" :key="model.id ?? model.version">
                    <th scope="row"><span class="admin-recs__version">{{ model.version }}</span><span v-if="index === 0" class="admin-recs__badge">사용 중</span></th>
                    <td><time :datetime="model.trained_at">{{ formatSeoulDateTime(model.trained_at) || '-' }}</time></td>
                    <td>{{ eventPeriodLabel(model.events_since) }}</td>
                    <td class="admin-recs__num">{{ formatCount(model.event_count) }}건</td>
                    <td class="admin-recs__num">{{ formatCount(model.session_count) }}개</td>
                    <td class="admin-recs__num">{{ formatDuration(model.duration_ms) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="admin-recs__panel" aria-labelledby="admin-recs-compare-title">
            <h2 id="admin-recs-compare-title"><span class="admin-recs__step" aria-hidden="true">3</span>상품별 순위 비교</h2>
            <form class="admin-recs__compare-form" novalidate @submit.prevent="submitCompare">
              <div class="admin-recs__field">
                <label for="recommendation-product">상품 번호</label>
                <input
                  id="recommendation-product"
                  v-model="productInput"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
                  :aria-invalid="productInputError ? 'true' : undefined"
                  :aria-describedby="productInputError ? 'recommendation-product-error' : undefined"
                />
              </div>
              <button class="shop-button" type="submit">비교하기</button>
            </form>
            <p v-if="productInputError" id="recommendation-product-error" class="shop-message shop-message--error admin-recs__notice" role="alert">{{ productInputError }}</p>
            <div class="admin-recs__compare" :aria-busy="compareLoading">
              <p v-if="compareState === 'loading'" class="admin-recs__state" role="status">추천 순위를 불러오는 중입니다...</p>
              <div v-else-if="compareState === 'missing'" class="admin-recs__state admin-recs__state--error" role="alert">
                <p>{{ COMPARE_NOT_FOUND_MESSAGE }}</p>
              </div>
              <div v-else-if="compareState === 'error'" class="admin-recs__state admin-recs__state--error" role="alert">
                <p>{{ compareError }}<a v-if="compareNeedsLogin" href="/login" target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a></p>
                <button class="shop-button shop-button--secondary" type="button" @click="loadComparison()">다시 시도</button>
              </div>
              <template v-else-if="compareState === 'ready'">
                <p class="admin-recs__product">
                  <strong>{{ comparison.product?.id }}번 {{ comparison.product?.name }}</strong>
                  <span>{{ categoryName(comparison.product?.category) }} · {{ formatPrice(comparison.product?.price_krw) }}</span>
                </p>
                <div class="admin-recs__sides">
                  <section class="admin-recs__side" aria-labelledby="admin-recs-current-title">
                    <h3 id="admin-recs-current-title">현재 <span class="admin-recs__model">{{ modelLabel(comparison.current?.model) }}</span></h3>
                    <p class="admin-recs__meta">{{ sideDescription(comparison.current) }}</p>
                    <p v-if="!currentItems.length" class="admin-recs__empty">추천할 상품이 없습니다.</p>
                    <div v-else class="admin-recs__table-wrap" role="region" aria-label="현재 순위 표" tabindex="0">
                      <table class="admin-recs__table admin-recs__table--rank">
                        <caption class="sr-only">{{ previousItems ? '현재 추천 순위. 순위 옆의 표시는 이전 순위와 비교한 변화입니다.' : '현재 추천 순위' }}</caption>
                        <thead>
                          <tr>
                            <th scope="col">순위</th><th scope="col">상품</th><th scope="col" class="admin-recs__num">점수</th>
                            <th scope="col" class="admin-recs__num">CF</th><th scope="col" class="admin-recs__num">기본</th><th scope="col" class="admin-recs__num">함께 본 세션</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(item, index) in currentItems" :key="item.product_id">
                            <td class="admin-recs__rank">
                              <span>{{ item.rank }}</span>
                              <span v-if="changes[index]" class="admin-recs__mark" :class="`admin-recs__mark--${changes[index].tone}`">
                                <span aria-hidden="true">{{ changes[index].text }}</span><span class="sr-only">{{ changes[index].label }}</span>
                              </span>
                            </td>
                            <td class="admin-recs__item"><a :href="productPath(item.product_id)">{{ item.name }}</a><span>{{ item.product_id }}번 · {{ formatPrice(item.price_krw) }}</span></td>
                            <td class="admin-recs__num">{{ formatRecommendationScore(item.score) }}</td>
                            <td class="admin-recs__num">{{ formatRecommendationScore(item.cf_score) }}</td>
                            <td class="admin-recs__num">{{ formatRecommendationScore(item.base_score) }}</td>
                            <td class="admin-recs__num">{{ formatCount(item.co_sessions) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section class="admin-recs__side" aria-labelledby="admin-recs-previous-title">
                    <h3 id="admin-recs-previous-title">이전 <span class="admin-recs__model">{{ comparison.previous ? modelLabel(comparison.previous.model) : '없음' }}</span></h3>
                    <template v-if="comparison.previous">
                      <p class="admin-recs__meta">{{ sideDescription(comparison.previous) }}</p>
                      <p v-if="!previousItems.length" class="admin-recs__empty">추천할 상품이 없습니다.</p>
                      <div v-else class="admin-recs__table-wrap" role="region" aria-label="이전 순위 표" tabindex="0">
                        <table class="admin-recs__table admin-recs__table--rank">
                          <caption class="sr-only">이전 추천 순위</caption>
                          <thead>
                            <tr>
                              <th scope="col">순위</th><th scope="col">상품</th><th scope="col" class="admin-recs__num">점수</th>
                              <th scope="col" class="admin-recs__num">CF</th><th scope="col" class="admin-recs__num">기본</th><th scope="col" class="admin-recs__num">함께 본 세션</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="item in previousItems" :key="item.product_id">
                              <td class="admin-recs__rank"><span>{{ item.rank }}</span></td>
                              <td class="admin-recs__item"><a :href="productPath(item.product_id)">{{ item.name }}</a><span>{{ item.product_id }}번 · {{ formatPrice(item.price_krw) }}</span></td>
                              <td class="admin-recs__num">{{ formatRecommendationScore(item.score) }}</td>
                              <td class="admin-recs__num">{{ formatRecommendationScore(item.cf_score) }}</td>
                              <td class="admin-recs__num">{{ formatRecommendationScore(item.base_score) }}</td>
                              <td class="admin-recs__num">{{ formatCount(item.co_sessions) }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </template>
                    <p v-else class="admin-recs__empty">비교할 이전 순위가 없습니다. 처음 학습하면 지금 순위(기본 추천)가 이전 순위가 됩니다.</p>
                  </section>
                </div>
              </template>
            </div>
          </section>
        </div>
      </div>
    </section>
  </SiteLayout>
</template>

<style scoped>
.admin-recs__heading { margin: 0 0 22px; }
.admin-recs__heading h1 { margin: 0 0 8px; color: var(--ink); font-size: var(--text-title); letter-spacing: -.8px; }
.admin-recs__heading p { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.7; word-break: keep-all; }
.admin-recs__sections { display: grid; gap: 20px; }
.admin-recs__panel { display: grid; gap: 16px; min-width: 0; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.admin-recs__panel h2 { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--ink); font-size: 17px; letter-spacing: -.4px; }
.admin-recs__step { display: inline-grid; place-items: center; width: 26px; height: 26px; flex: none; border: 1px solid var(--brand-line); border-radius: 50%; background: var(--brand-soft); color: var(--brand); font-size: var(--text-sm); font-weight: 800; }
.admin-recs__notice { margin: 0; }

/* ① 학습 */
.admin-recs__train { display: grid; gap: 14px; }
.admin-recs__scope { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 0; border: 0; }
.admin-recs__scope legend { margin-bottom: 8px; padding: 0; color: var(--ink); font-size: var(--text-sm); font-weight: 700; }
.admin-recs__options { display: flex; flex-wrap: wrap; gap: 8px; }
.admin-recs__option { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); color: var(--ink); font-size: var(--text-sm); font-weight: 650; cursor: pointer; }
.admin-recs__option input { margin: 0; accent-color: var(--brand); }
.admin-recs__option--checked { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }
.admin-recs__option:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
.admin-recs__scope:disabled .admin-recs__option { opacity: .6; cursor: wait; }
.admin-recs__since { display: grid; gap: 6px; max-width: 420px; }
.admin-recs__since label, .admin-recs__field label { color: var(--ink); font-size: var(--text-sm); font-weight: 700; }
.admin-recs__since input, .admin-recs__field input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-body); color-scheme: dark; }
.admin-recs__since input:disabled { opacity: .55; }
.admin-recs__since p { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; word-break: keep-all; }
.admin-recs__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }

/* ② 학습 기록 */
.admin-recs__refresh { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.admin-recs__refresh p { margin: 0; }
.admin-recs__empty { margin: 0; padding: 14px 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: var(--text-sm); line-height: 1.7; word-break: keep-all; }
/* 표는 자기 영역 안에서만 가로로 넘긴다(375px 에서 페이지 가로 스크롤 없음) */
.admin-recs__table-wrap { position: relative; max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.admin-recs__table { width: 100%; min-width: 600px; border-collapse: collapse; font-size: var(--text-sm); }
.admin-recs__table--rank { min-width: 520px; }
.admin-recs__table th, .admin-recs__table td { padding: 11px 12px; border-bottom: 1px solid var(--line); color: var(--ink); text-align: left; vertical-align: middle; }
.admin-recs__table thead th { background: var(--surface-2); color: var(--muted); font-size: var(--text-xs); font-weight: 650; white-space: nowrap; }
.admin-recs__table tbody tr:last-child > * { border-bottom: 0; }
.admin-recs__table .admin-recs__num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.admin-recs__table tbody th { font-weight: 700; white-space: nowrap; }
.admin-recs__table time, .admin-recs__table td { white-space: nowrap; }
.admin-recs__version { font-family: var(--font-numeric); font-size: var(--text-xs); }
.admin-recs__badge { margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: var(--success-soft); color: var(--success); font-size: var(--text-xs); font-weight: 750; }

/* ③ 상품별 순위 비교 */
.admin-recs__compare-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.admin-recs__field { display: grid; gap: 6px; width: min(200px, 100%); }
.admin-recs__compare { display: grid; gap: 14px; min-width: 0; }
.admin-recs__state { display: grid; justify-items: center; gap: 10px; margin: 0; padding: 24px 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--muted); font-size: var(--text-sm); line-height: 1.7; text-align: center; overflow-wrap: anywhere; }
.admin-recs__state p { margin: 0; }
.admin-recs__state a { margin-left: 6px; color: inherit; font-weight: 750; }
.admin-recs__state--error { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--danger-soft); color: var(--danger); }
.admin-recs__product { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0; color: var(--muted); font-size: var(--text-sm); }
.admin-recs__product strong { color: var(--ink); font-size: 15px; overflow-wrap: anywhere; }
.admin-recs__sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.admin-recs__side { display: grid; align-content: start; gap: 8px; min-width: 0; }
.admin-recs__side h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; color: var(--ink); font-size: 15px; }
.admin-recs__model { padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); color: var(--ink); font-size: var(--text-xs); font-weight: 650; }
.admin-recs__meta { margin: 0; color: var(--muted); font-size: var(--text-xs); }
.admin-recs__rank { white-space: nowrap; }
.admin-recs__rank > span:first-child { display: inline-block; min-width: 18px; font-weight: 750; }
.admin-recs__mark { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 800; }
.admin-recs__mark--up { background: var(--success-soft); color: var(--success); }
.admin-recs__mark--down { background: var(--danger-soft); color: var(--danger); }
.admin-recs__mark--new { background: var(--brand-soft); color: var(--brand); }
.admin-recs__mark--same { color: var(--muted); }
.admin-recs__item a { display: block; color: var(--ink); font-weight: 650; text-decoration: none; white-space: normal; overflow-wrap: anywhere; }
.admin-recs__item a:hover { color: var(--brand); text-decoration: underline; }
.admin-recs__item span { display: block; margin-top: 2px; color: var(--muted); font-size: var(--text-xs); }
.admin-recs__table .admin-recs__item { min-width: 160px; white-space: normal; }
.admin-recs :is(button, a, input):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.admin-recs__table-wrap:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 1040px) { .admin-recs__sides { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) {
  .admin-recs__panel { padding: 16px 14px; }
  .admin-recs__actions .shop-button { flex: 1 1 auto; }
  .admin-recs__since { max-width: none; }
}
</style>
