// 알림 API(src/api/notificationApi.js): 목록·읽지 않은 수·하나 읽음·모두 읽음. 모두 쿠키를 싣는다.
import axios from 'axios'
import { jest } from '@jest/globals'
import { fetchNotifications, fetchUnreadCount, markAllNotificationsRead, markNotificationRead } from './api/notificationApi.js'

afterEach(() => jest.restoreAllMocks())

const ok = (result) => ({ data: { code: 200, message: '', result } })

test('목록은 page·page_size 를 params 로 보낸다', async () => {
  const page = { items: [], total: 0, unread_count: 0, page: 2, page_size: 20 }
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok(page))
  await expect(fetchNotifications({ page: 2 })).resolves.toEqual(page)
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/notifications', { withCredentials: true, params: { page: 2, page_size: 20 } })
})

test('읽지 않은 수', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ unread_count: 3 }))
  await expect(fetchUnreadCount()).resolves.toEqual({ unread_count: 3 })
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/notifications/unread-count', { withCredentials: true })
})

test('하나 읽음은 경로 값을 인코딩하고 본문 없이 POST', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ id: 5, read: true }))
  await expect(markNotificationRead(5)).resolves.toEqual({ id: 5, read: true })
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/notifications/5/read', null, { withCredentials: true })
  await markNotificationRead('a/b')
  expect(post).toHaveBeenLastCalledWith('http://127.0.0.1:8000/notifications/a%2Fb/read', null, { withCredentials: true })
})

test('모두 읽음', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue(ok({ unread_count: 0 }))
  await expect(markAllNotificationsRead()).resolves.toEqual({ unread_count: 0 })
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/notifications/read-all', null, { withCredentials: true })
})
