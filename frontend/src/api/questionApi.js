import axios from 'axios'
import { baseUrl } from './config.js'
import { validateAnswer, validateQuestion, validateQuestionImages } from '../stores/questionViewModel.js'

const credentials = { withCredentials: true }

function imageUploadError() {
  const error = new Error('이미지를 업로드하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 등록해 주세요. 계속 실패하면 관리자에게 문의해 주세요.')
  error.code = 'QUESTION_IMAGE_UPLOAD_FAILED'
  return error
}

function createImageTransport() {
  // Axios.create merges global defaults, including auth headers. Start with clean
  // defaults so the signed storage request never inherits backend credentials.
  return new axios.Axios({
    adapter: axios.getAdapter(['xhr', 'http', 'fetch']),
    withCredentials: false,
    withXSRFToken: false,
    headers: {},
    transformRequest: [],
    transformResponse: [],
    timeout: 120000,
    validateStatus: (status) => status >= 200 && status < 300,
  })
}

/** GET /questions?page=&page_size=&search=&product_id= (product_id: 그 부품과 연결된 질문만. 없으면 보내지 않는다) */
export async function fetchQuestions({ page = 1, pageSize = 10, search = '', productId = null, apiBaseUrl } = {}) {
  const params = { page, page_size: pageSize, search }
  if (productId != null) params.product_id = productId
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/questions`, { ...credentials, params })
  return response.data.result
}

export async function fetchQuestion(id, { apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(id)}`, credentials)
  return response.data.result
}

/** POST /questions { title, content, upload_ids, product_id? }. productId(관련 부품)는 골랐을 때만 보낸다. */
export async function createQuestion({ title, content, images = [], productId = null }, { apiBaseUrl } = {}) {
  const error = validateQuestion({ title, content }) || validateQuestionImages(images)
  if (error) throw new Error(error)
  const uploadIds = []
  const transport = images.length ? createImageTransport() : null
  for (const image of images) {
    const signed = await axios.post(`${baseUrl(apiBaseUrl)}/questions/uploads/presign`, {
      filename: image.name, content_type: image.type, size: image.size,
    }, credentials)
    const upload = signed.data.result
    try {
      const url = new URL(upload.url)
      if (url.protocol !== 'https:' || url.username || url.password || upload.method !== 'PUT' || !upload.upload_id || upload.headers?.['Content-Type'] !== image.type) {
        throw imageUploadError()
      }
      await transport.put(upload.url, image, { headers: upload.headers, withCredentials: false })
    } catch {
      // Discard the transport error: it may contain a signed URL or storage XML.
      throw imageUploadError()
    }
    uploadIds.push(upload.upload_id)
  }
  const body = { title: title.trim(), content: content.trim(), upload_ids: uploadIds }
  if (productId != null) body.product_id = productId
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/questions`, body, credentials)
  return response.data.result
}

/**
 * PATCH /questions/{id} { title, content, product_id? }. 관련 부품은 productId 를 넘겼을 때만 보낸다
 * (null 이면 연결을 지운다. 넘기지 않으면 그대로 둔다).
 */
export async function updateQuestion(id, { title, content, ...rest }, { apiBaseUrl } = {}) {
  const error = validateQuestion({ title, content })
  if (error) throw new Error(error)
  const body = { title: title.trim(), content: content.trim() }
  if ('productId' in rest) body.product_id = rest.productId ?? null
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(id)}`, body, credentials)
  return response.data.result
}

/** POST /questions/{id}/answers/{answer_id}/accept → QuestionDetail. 질문 작성자만 답변을 채택한다(다른 답변을 채택하면 바뀐다). */
export async function acceptAnswer(questionId, answerId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(questionId)}/answers/${encodeURIComponent(answerId)}/accept`, null, credentials)
  return response.data.result
}

/** DELETE /questions/{id}/answers/{answer_id}/accept → QuestionDetail. 채택을 취소한다. */
export async function unacceptAnswer(questionId, answerId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(questionId)}/answers/${encodeURIComponent(answerId)}/accept`, credentials)
  return response.data.result
}

export async function deleteQuestion(id, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(id)}`, credentials)
  return response.data.result
}

// 답변(spec 추가분): 로그인 필요(401), 서버가 Origin 을 검사한다(403). 본인 답변만 수정·삭제(403).

/** POST /questions/{id}/answers { content } → Answer. */
export async function createAnswer(questionId, { content }, { apiBaseUrl } = {}) {
  const error = validateAnswer({ content })
  if (error) throw new Error(error)
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(questionId)}/answers`, {
    content: content.trim(),
  }, credentials)
  return response.data.result
}

/** PATCH /questions/{id}/answers/{answer_id} { content } → Answer. */
export async function updateAnswer(questionId, answerId, { content }, { apiBaseUrl } = {}) {
  const error = validateAnswer({ content })
  if (error) throw new Error(error)
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(questionId)}/answers/${encodeURIComponent(answerId)}`, {
    content: content.trim(),
  }, credentials)
  return response.data.result
}

/** DELETE /questions/{id}/answers/{answer_id} → null. */
export async function deleteAnswer(questionId, answerId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(questionId)}/answers/${encodeURIComponent(answerId)}`, credentials)
  return response.data.result
}
