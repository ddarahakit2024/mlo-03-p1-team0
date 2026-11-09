// 상품 상세(views/ProductDetail.vue)의 표시 값: 가격 카드의 세 칸(1년 최저가·30일 평균·지금 살 때?)과 판매처 문구,
// 판매처 비교 줄, 목표가 알림(빠른 선택·입력 해석·문구), 관련 질문 줄, 주소, 요청 실패 문구.
// Vue·axios 를 import 하지 않는다. 가격은 서버 값(price_trend, store_prices)을 그대로 보여 주고 여기서는 글자·톤만 만든다.
import { formatPrice } from './productViewModel.js'
import { buyVerdict, lowestLine, storeLine, storeName } from './priceTrendViewModel.js'

// 목표가 빠른 선택: 지금 판매가의 -5%·-10%(100원 단위 반올림, 디자인 시안과 같다)
export const ALERT_PRESET_RATES = [{ label: '-5%', rate: 0.95 }, { label: '-10%', rate: 0.9 }]
// 상세의 "이 부품에 대한 질문" 개수
export const RELATED_QUESTION_LIMIT = 5
export const ALERT_LOGIN_MESSAGE = '로그인하면 목표가 알림을 받을 수 있어요.'
export const PRICE_MATCH_LOGIN_MESSAGE = '로그인하면 최저가 매칭을 요청할 수 있어요.'
export const SESSION_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/** UTC 시각 → 서울 시각의 Date(getUTC* 로 읽는다). 틀리면 null. */
function seoulClock(value) {
  if (!value) return null
  const time = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(time) ? null : new Date(time + SEOUL_OFFSET_MS)
}

const two = (value) => String(value).padStart(2, '0')

/** 날짜 글자 'YYYY.MM.DD'. 날짜만 있는 값('2026-11-05')은 그대로 바꾸고, 시각(UTC)은 서울 날짜로 바꾼다. 틀리면 ''. */
export function formatDotDate(value) {
  const match = DATE_ONLY.exec(String(value || ''))
  if (match) return `${match[1]}.${match[2]}.${match[3]}`
  const date = seoulClock(value)
  return date ? `${date.getUTCFullYear()}.${two(date.getUTCMonth() + 1)}.${two(date.getUTCDate())}` : ''
}

/** 판매처 가격 기준 시각: '11월 5일 12:00 기준'(서울). 틀리면 ''. */
export function formatStoreUpdatedAt(value) {
  const date = seoulClock(value)
  return date ? `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} 기준` : ''
}

/** 판매처 가격 기록일: '11월 5일 기록'. 틀리면 ''. */
function recordedLabel(value) {
  const date = seoulClock(value)
  return date ? `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 기록` : ''
}

/**
 * 가격 카드의 세 칸. 값이 없으면 '—'.
 * - lowest: 1년 최저가(lowest_1y_krw)와 그 날짜(lowest_1y_on)
 * - average: 30일 평균(average_30d_krw)과 '1년 최고 N원'
 * - verdict: '지금 살 때?' 판단(buyVerdict, tone good·near·neutral)과 아래 줄 1년 최저가 문구(lowestLine)
 */
export function priceTiles(trend) {
  const lowest = finite(trend?.lowest_1y_krw) ? Number(trend.lowest_1y_krw) : null
  const average = finite(trend?.average_30d_krw) ? Number(trend.average_30d_krw) : null
  const highest = finite(trend?.highest_1y_krw) ? Number(trend.highest_1y_krw) : null
  const verdict = buyVerdict(trend)
  const line = lowestLine(trend)
  return {
    lowest: { text: lowest === null ? '—' : formatPrice(lowest), note: lowest === null ? '기록 없음' : formatDotDate(trend.lowest_1y_on) || '날짜 기록 없음' },
    average: { text: average === null ? '—' : formatPrice(average), note: `1년 최고 ${highest === null ? '—' : formatPrice(highest)}` },
    verdict: { text: verdict?.text || '기록이 더 필요해요', tone: verdict?.tone || 'neutral', note: line?.text || '가격 기록이 쌓이면 알려 드려요' },
  }
}

/**
 * 가격 카드 아래 판매처 문구: MOA Parts 가 최저면 '타몰 최저가보다 N원 저렴 · 무료배송 · 오늘 출발'(good),
 * 아니면 '쿠팡에서 N원 더 저렴'(warn) 만. 외부 가격이 없으면 null.
 */
export function storeSummary(trend) {
  const line = storeLine(trend)
  if (!line) return null
  return { text: line.tone === 'good' ? `${line.text} · 무료배송 · 오늘 출발` : line.text, tone: line.tone }
}

/**
 * 판매처 비교(store_prices). 가격 낮은 순(같으면 MOA Parts 먼저).
 * rows: [{ source, name, price, isStore, isLowest(판매처가 둘 이상일 때 맨 위), note, diffText, diffTone(store·higher·lower·same) }]
 * - MOA Parts 줄이 없으면 지금 판매가로 만든다. 차이는 MOA Parts 판매가 기준 '+N원'·'−N원'
 * updatedAt: 가장 늦은 기록 시각, storeIsLowest: 서버 값(price_trend.store_is_lowest), 없으면 줄 순서로, hasExternal: 다른 판매처가 있는지.
 */
export function storeComparison(product) {
  const moa = finite(product?.price_krw) ? Number(product.price_krw) : null
  const list = (Array.isArray(product?.store_prices) ? product.store_prices : []).filter((item) => item && finite(item.price_krw))
  if (moa !== null && !list.some((item) => item.source === 'store')) list.push({ source: 'store', price_krw: moa, recorded_at: null })
  const sorted = [...list].sort((a, b) => Number(a.price_krw) - Number(b.price_krw) || (b.source === 'store') - (a.source === 'store'))
  const base = moa ?? Number(sorted.find((item) => item.source === 'store')?.price_krw)
  const rows = sorted.map((item, index) => {
    const price = Number(item.price_krw)
    const isStore = item.source === 'store'
    const gap = price - base
    const diff = isStore ? { diffText: 'MOA 판매가', diffTone: 'store' }
      : gap > 0 ? { diffText: `+${gap.toLocaleString('ko-KR')}원`, diffTone: 'higher' }
        : gap < 0 ? { diffText: `−${Math.abs(gap).toLocaleString('ko-KR')}원`, diffTone: 'lower' }
          : { diffText: '같은 가격', diffTone: 'same' }
    return {
      source: item.source, name: storeName(item.source), price, isStore, isLowest: index === 0 && sorted.length > 1,
      note: isStore ? '무료 배송' : recordedLabel(item.recorded_at) || '최근 기록', ...diff,
    }
  })
  const times = list.map((item) => item.recorded_at).filter((value) => seoulClock(value))
  const updatedAt = times.sort((a, b) => seoulClock(a) - seoulClock(b)).pop() || null
  const serverLowest = product?.price_trend?.store_is_lowest
  return {
    rows,
    updatedAt,
    storeIsLowest: typeof serverLowest === 'boolean' ? serverLowest : rows.length ? rows[0].isStore : true,
    hasExternal: rows.some((row) => !row.isStore),
  }
}

/** 목표가 빠른 선택: 1년 최저가, 지금 판매가 -5%, -10%(100원 단위). 값이 없는 것은 뺀다. */
export function alertPresets(product) {
  const presets = []
  const lowest = product?.price_trend?.lowest_1y_krw
  if (finite(lowest) && Number(lowest) > 0) presets.push({ label: '1년 최저가', value: Number(lowest) })
  if (finite(product?.price_krw)) {
    for (const { label, rate } of ALERT_PRESET_RATES) {
      const value = Math.round((Number(product.price_krw) * rate) / 100) * 100
      if (value > 0) presets.push({ label, value })
    }
  }
  return presets
}

/** 목표가 입력 → 원 단위 정수('389,000원' → 389000). 숫자가 없으면 null. 범위 검사는 validateTargetPrice 가 한다. */
export function parseTargetPrice(text) {
  const digits = String(text ?? '').replace(/[^0-9]/g, '')
  return digits ? Number(digits) : null
}

/** 알림 목록(GET /alerts 의 items)에서 이 상품의 알림. 없으면 null. */
export function findAlert(items, productId) {
  return (Array.isArray(items) ? items : []).find((item) => item?.product_id === productId) || null
}

/** 목표가 알림 버튼 글자: 알림이 있으면 '알림 389,000원', 없으면 '목표가 알림'. */
export function alertButtonLabel(alert) {
  return alert && finite(alert.target_price_krw) ? `알림 ${formatPrice(alert.target_price_krw)}` : '목표가 알림'
}

/** 목표가를 저장했을 때 안내(토스트). */
export function alertSavedMessage(target) {
  return `${formatPrice(target)} 이하로 내려오면 알려드릴게요`
}

/**
 * 상세 화면의 요청(목표가 알림·최저가 매칭) 실패 → { message, needsLogin }.
 * 401 로그인 만료(로그인 링크), 403 서버 문구(권한·출처), 5xx·네트워크 fallback, 그 밖(404·409·422)은 서버 문구.
 */
export function detailRequestError(error, fallback) {
  const status = error?.response?.status
  const message = error?.response?.data?.message
  const server = typeof message === 'string' && message ? message : ''
  if (status === 401) return { message: SESSION_EXPIRED_MESSAGE, needsLogin: true }
  if (status === 403) return { message: server || '요청할 권한이 없습니다. 새로 고친 뒤 다시 시도해 주세요.', needsLogin: false }
  if (!status || status >= 500) return { message: fallback, needsLogin: false }
  return { message: server || fallback, needsLogin: false }
}

/** 관련 질문(GET /questions?product_id=) 줄: [{ id, href, title, answerCount, accepted, author, date, createdAt }]. */
export function relatedQuestionRows(page) {
  return (Array.isArray(page?.items) ? page.items : []).map((question) => ({
    id: question.id,
    href: `/questions/${encodeURIComponent(question.id)}`,
    title: question.title || '제목 없는 질문',
    answerCount: Math.max(0, Math.floor(Number(question.answer_count) || 0)),
    accepted: question.accepted_answer_id != null,
    author: question.author?.name || '회원',
    date: formatDotDate(question.created_at),
    createdAt: question.created_at || '',
  }))
}

/** 이 부품에 대해 질문하기: 질문 작성 화면이 product 를 관련 부품으로 고른다. */
export function askQuestionPath(productId) {
  return `/questions/new?product=${encodeURIComponent(productId)}`
}

/** 브레드크럼의 카테고리 링크: 상품 목록을 그 카테고리로 연다. */
export function categoryPath(code) {
  return code ? `/products?category=${encodeURIComponent(code)}` : '/products'
}
