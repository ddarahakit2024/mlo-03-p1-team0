import axios from 'axios'
import { baseUrl } from './config.js'

// 알림(목표가 도달·1년 최저가 갱신·새 답변·견적 도착). 로그인 사용자 본인 것만. 모든 요청에 쿠키를 싣는다.
// Notification = { id, kind(price_target·price_low·answer·quote), title, body, product_id, question_id, post_id, created_at, read }
const credentials = { withCredentials: true }

export const NOTIFICATION_PAGE_SIZE = 20

/** GET /notifications?page=&page_size= → { items, total, unread_count, page, page_size } (최근 순) */
export async function fetchNotifications({ page = 1, pageSize = NOTIFICATION_PAGE_SIZE, apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/notifications`, { ...credentials, params: { page, page_size: pageSize } })
  return response.data.result
}

/** GET /notifications/unread-count → { unread_count } */
export async function fetchUnreadCount({ apiBaseUrl } = {}) {
  const response = await axios.get(`${baseUrl(apiBaseUrl)}/notifications/unread-count`, credentials)
  return response.data.result
}

/** POST /notifications/{id}/read → Notification */
export async function markNotificationRead(notificationId, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/notifications/${encodeURIComponent(notificationId)}/read`, null, credentials)
  return response.data.result
}

/** POST /notifications/read-all → { unread_count: 0 } */
export async function markAllNotificationsRead({ apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/notifications/read-all`, null, credentials)
  return response.data.result
}
