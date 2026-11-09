// 이벤트 수집 API(src/api/eventApi.js): POST /events 묶음 전송(axios)과 페이지를 떠날 때의 keepalive 전송(fetch).
import axios from 'axios'
import { jest } from '@jest/globals'
import { sendEvents, sendEventsOnExit } from './api/eventApi.js'

const event = {
  event_id: '0f8fad5b-d9cb-469f-a165-70867728950e', type: 'page_view', occurred_at: '2026-10-30T01:00:00.000Z',
  session_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', anonymous_id: '16fd2706-8baf-433b-82eb-8c7fada847da',
  page: { path: '/products', referrer: '' }, props: { route: 'products' },
}
const realFetch = globalThis.fetch

afterEach(() => {
  jest.restoreAllMocks()
  globalThis.fetch = realFetch
})

describe('sendEvents (POST /events)', () => {
  test('쿠키를 실어 { events } 를 보내고 result({ accepted })만 돌려준다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 202, message: '이벤트를 받았습니다.', result: { accepted: 1 } } })
    await expect(sendEvents([event])).resolves.toEqual({ accepted: 1 })
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/events', { events: [event] }, { withCredentials: true })
  })

  test('apiBaseUrl 을 넘기면 그 주소를 쓰고 끝의 / 를 지운다', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: { accepted: 0 } } })
    await sendEvents([event], { apiBaseUrl: 'https://api.example.test/' })
    expect(post).toHaveBeenCalledWith('https://api.example.test/events', { events: [event] }, { withCredentials: true })
  })

  test('실패(422·403·네트워크)는 잡지 않고 던진다(다시 시도는 추적 모듈이 정한다)', async () => {
    const failure = { response: { status: 422 } }
    jest.spyOn(axios, 'post').mockRejectedValue(failure)
    await expect(sendEvents([event])).rejects.toBe(failure)
  })
})

describe('sendEventsOnExit (keepalive)', () => {
  test('fetch keepalive + credentials include 로 JSON 본문을 text/plain(CORS 사전 요청 없음)으로 보내고 true 를 돌려준다', () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 202 })
    expect(sendEventsOnExit([event], { apiBaseUrl: 'https://api.example.test/' })).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.test/events', {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ events: [event] }),
    })
  })

  test('기본 주소는 개발 주소(http://127.0.0.1:8000)다', () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 202 })
    sendEventsOnExit([event])
    expect(globalThis.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/events')
  })

  test('요청이 실패해도 던지지 않는다(응답을 기다리지 않고 버린다)', async () => {
    const failed = Promise.reject(new TypeError('Failed to fetch'))
    globalThis.fetch = jest.fn(() => failed)
    expect(sendEventsOnExit([event])).toBe(true)
    await expect(failed).rejects.toThrow('Failed to fetch')
  })

  test.each([
    ['fetch 가 없는 브라우저', undefined],
    ['fetch 가 바로 던지는 경우', () => { throw new TypeError('keepalive not supported') }],
  ])('%s 면 false 를 돌려주고 던지지 않는다', (_name, fetchImpl) => {
    globalThis.fetch = fetchImpl
    expect(sendEventsOnExit([event])).toBe(false)
  })
})
