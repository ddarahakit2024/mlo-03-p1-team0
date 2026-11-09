import axios from 'axios'
import { baseUrl } from './config.js'
import { COMMUNITY_PAGE_SIZE, partItemsPayload, validateComment, validateCommunityPost, validatePartItems, validatePostChanges } from '../stores/communityViewModel.js'

// 커뮤니티(자유·견적 게시판) API. spec: docs/specs/2026-11-01-community-dark-theme.md "API 계약"
// 목록은 공개라 쿠키를 싣지 않는다. 상세는 로그인했으면 is_owner 를 받으려고 쿠키를 싣는다.
// 상태를 바꾸는 요청은 로그인(401)·Origin 검사(403)·본인 확인(403)을 서버가 한다.
const credentials = { withCredentials: true }

/**
 * GET /community/posts?board=&page=&page_size=&search=&purpose= → { items(quote_count 포함), total, page, page_size }.
 * 빈 검색어는 보내지 않는다. purpose(용도 필터)는 견적 게시판에서 고른 때만 보낸다(자유 게시판과 함께 보내면 서버가 422).
 */
export async function fetchCommunityPosts({ board, page = 1, pageSize = COMMUNITY_PAGE_SIZE, search = '', purpose = '', apiBaseUrl } = {}) {
  const params = { board, page, page_size: pageSize }
  if (search.trim()) params.search = search.trim()
  if (purpose && board === 'build') params.purpose = purpose
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/community/posts`, { params })
  return response.data.result
}

/** GET /community/posts/{post_id} → 글 상세(댓글·부품 목록 포함, 오래된 순). */
export async function fetchCommunityPost(postId, { apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/community/posts/${encodeURIComponent(postId)}`, credentials)
  return response.data.result
}

/**
 * POST /community/posts { board, title, content, budget_krw?, purpose?, monitor_resolution?, preferences? } → 글 상세.
 * 예산·용도·모니터 해상도(fhd·qhd·uhd·none)·선호 사항(quiet·small·white·rgb·upgradable)은 견적 글에만 넣는다.
 */
export async function createCommunityPost({ board, title, content, budgetKrw = null, purpose = null, monitorResolution = null, preferences = [] }, { apiBaseUrl } = {}) {
  const error = validateCommunityPost({ board, title, content, budgetKrw, purpose })
  if (error) throw new Error(error)
  const body = { board, title: title.trim(), content: content.trim() }
  if (board === 'build') {
    body.budget_krw = budgetKrw
    body.purpose = purpose
    if (monitorResolution) body.monitor_resolution = monitorResolution
    if (preferences?.length) body.preferences = [...new Set(preferences)]
  }
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/community/posts`, body, credentials)
  return response.data.result
}

/** PATCH /community/posts/{post_id} 바뀐 필드만 { title?, content?, budget_krw?, purpose? } → 글 상세. 빈 수정은 보내지 않는다. */
export async function updateCommunityPost(postId, changes = {}, { apiBaseUrl } = {}) {
  const error = validatePostChanges(changes)
  if (error) throw new Error(error)
  const body = {}
  if ('title' in changes) body.title = changes.title.trim()
  if ('content' in changes) body.content = changes.content.trim()
  if ('budgetKrw' in changes) body.budget_krw = changes.budgetKrw
  if ('purpose' in changes) body.purpose = changes.purpose
  if ('monitorResolution' in changes) body.monitor_resolution = changes.monitorResolution
  if ('preferences' in changes) body.preferences = [...new Set(changes.preferences || [])]
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/community/posts/${encodeURIComponent(postId)}`, body, credentials)
  return response.data.result
}

/** DELETE /community/posts/{post_id} → null(댓글·부품 목록도 지워진다). */
export async function deleteCommunityPost(postId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/community/posts/${encodeURIComponent(postId)}`, credentials)
  return response.data.result
}

/** POST /community/posts/{post_id}/comments { content, items?: [{ product_id, quantity }] } → 댓글. 부품이 없으면 items 를 빼고 보낸다. */
export async function createCommunityComment(postId, { content, items = [] }, { apiBaseUrl } = {}) {
  const payload = partItemsPayload(items)
  const error = validateComment({ content, items: payload })
  if (error) throw new Error(error)
  const body = { content: content.trim() }
  if (payload.length) body.items = payload
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/community/posts/${encodeURIComponent(postId)}/comments`, body, credentials)
  return response.data.result
}

/** PATCH /community/comments/{comment_id} 바뀐 필드만 { content?, items? } → 댓글. items 는 목록 전체를 바꾼다([] 는 비움). */
export async function updateCommunityComment(commentId, changes = {}, { apiBaseUrl } = {}) {
  const body = {}
  if ('content' in changes) body.content = String(changes.content ?? '').trim()
  if ('items' in changes) body.items = partItemsPayload(changes.items || [])
  const error = !Object.keys(body).length
    ? '바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.'
    : ('content' in body ? validateComment({ content: body.content, items: body.items || [] }) : validatePartItems(body.items))
  if (error) throw new Error(error)
  const response = await axios.patch(`${baseUrl(apiBaseUrl)}/community/comments/${encodeURIComponent(commentId)}`, body, credentials)
  return response.data.result
}

/** DELETE /community/comments/{comment_id} → null. */
export async function deleteCommunityComment(commentId, { apiBaseUrl } = {}) {
  const response = await axios.delete(`${baseUrl(apiBaseUrl)}/community/comments/${encodeURIComponent(commentId)}`, credentials)
  return response.data.result
}
