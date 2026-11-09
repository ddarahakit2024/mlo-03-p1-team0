import axios from 'axios'
import { baseUrl } from './config.js'

// 사용자 이벤트 수집(POST /events). 쿠키를 실어 보내 서버가 로그인 사용자(subject)를 판단하게 한다.
// 사용자 값(이름·이메일·subject 등)은 보내지 않는다. 묶음은 1~50개, 본문 64KB 이하(spec API 계약).
const credentials = { withCredentials: true }

/** POST /events { events } → { accepted }. 실패하면 던진다(다시 시도·버리기는 추적 모듈이 정한다). */
export async function sendEvents(events, { apiBaseUrl } = {}) {
  const response = await axios.post(`${baseUrl(apiBaseUrl)}/events`, { events }, credentials)
  return response.data.result
}

/**
 * 페이지를 떠날 때(pagehide·visibilitychange) 보내는 POST /events. fetch keepalive 는 페이지가 닫혀도 요청을 끝까지 보낸다.
 * 본문은 JSON 이지만 Content-Type 은 text/plain 이다(서버가 JSON 으로 받는다): 다른 도메인(api.)으로 보내도 CORS 사전 요청(OPTIONS)이
 * 필요 없어 떠나는 중에도 바로 보낼 수 있다. 쿠키는 credentials include 로 싣는다(서버가 subject 를 기록).
 * 응답을 기다리지 않고 실패는 조용히 버린다. 요청을 보냈으면 true, 보낼 수 없으면 false. 절대 던지지 않는다.
 */
export function sendEventsOnExit(events, { apiBaseUrl } = {}) {
  const request = globalThis.fetch
  if (typeof request !== 'function') return false
  try {
    const pending = request(`${baseUrl(apiBaseUrl)}/events`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ events }),
    })
    pending?.catch?.(() => {})
    return true
  } catch {
    return false
  }
}
