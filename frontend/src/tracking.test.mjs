// 이벤트 추적 모듈(src/stores/tracking.js): 큐·묶음 전송(10개 또는 3초)·실패 시 한 번 다시 시도·페이지를 떠날 때 keepalive·
// anonymous_id/session_id(30분 규칙)·저장소가 막힌 브라우저·props 정리·테스트 환경에서는 보내지 않기.
import axios from 'axios'
import { jest } from '@jest/globals'
import {
  ANONYMOUS_ID_KEY, BATCH_SIZE, EVENT_TYPES, FLUSH_DELAY_MS, LOGOUT_FLUSH_TIMEOUT_MS, SCHEMA_VERSION, SESSION_KEY, SESSION_TIMEOUT_MS,
  chunkEvents, cleanProps, createTracker, createUuid, eventPath, eventReferrer, flushEvents, isPersonalKey, isRetryableError, onExit, redactQuery, safeStorage, track,
} from './stores/tracking.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const START = Date.parse('2026-10-30T01:00:00.000Z')

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { values, getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) }
}

function fakeTimers() {
  const timers = []
  return {
    schedule: jest.fn((callback, delay) => {
      const timer = { callback, delay, cancelled: false }
      timers.push(timer)
      return timer
    }),
    cancel: jest.fn((timer) => { timer.cancelled = true }),
    active: () => timers.filter((timer) => !timer.cancelled && !timer.done),
    run() {
      for (const timer of this.active()) {
        timer.done = true
        timer.callback()
      }
    },
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

function setup(options = {}) {
  let clock = START
  let count = 0
  const timers = fakeTimers()
  const send = jest.fn().mockResolvedValue({ accepted: 1 })
  const sendOnExit = jest.fn(() => true)
  const local = memoryStorage()
  const session = memoryStorage()
  const tracker = createTracker({
    send, sendOnExit, storage: { local, session },
    now: () => clock,
    uuid: () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
    page: () => ({ path: '/products?category=gpu', referrer: 'https://www.mlops.kro.kr/' }),
    schedule: timers.schedule, cancel: timers.cancel,
    ...options,
  })
  return { tracker, send, sendOnExit, local, session, timers, tick: (ms) => { clock += ms } }
}

describe('이벤트 모양', () => {
  // schema_version 5: spec docs/specs/2026-11-03-product-recommendations.md(추천 칸 노출·클릭의 source_product_id·model_version)
  test('track 은 계약(Event)의 모양으로 큐에 넣는다: event_id, type, occurred_at(ISO·UTC), session_id, anonymous_id, page, props, schema_version(5)', async () => {
    const { tracker, send, local, session } = setup()
    tracker.track('product_view', { product_id: 3, price_krw: 899000, is_new: true, rating_average: null })
    await tracker.flush()
    expect(send).toHaveBeenCalledTimes(1)
    const [event] = send.mock.calls[0][0]
    expect(event).toEqual({
      event_id: '00000000-0000-4000-8000-000000000001',
      type: 'product_view',
      occurred_at: '2026-10-30T01:00:00.000Z',
      session_id: '00000000-0000-4000-8000-000000000002',
      anonymous_id: '00000000-0000-4000-8000-000000000003',
      page: { path: '/products?category=gpu', referrer: 'https://www.mlops.kro.kr/' },
      props: { product_id: 3, price_krw: 899000, is_new: true, rating_average: null },
      schema_version: 5,
    })
    expect(SCHEMA_VERSION).toBe(5)
    expect(local.values.get(ANONYMOUS_ID_KEY)).toBe(event.anonymous_id)
    expect(JSON.parse(session.values.get(SESSION_KEY))).toEqual({ id: event.session_id, last: START })
  })

  test('props 를 주지 않으면 빈 객체(signup, logout)', async () => {
    const { tracker, send } = setup()
    tracker.track('logout')
    await tracker.flush()
    expect(send.mock.calls[0][0][0].props).toEqual({})
  })

  test('spec 표의 37개 type 만 받는다. 모르는 type 은 버린다', async () => {
    expect(EVENT_TYPES).toHaveLength(37)
    expect(EVENT_TYPES).toContain('compatibility_check')
    // 2026-11-01 event-enrichment(schema_version 2)에서 더한 11개
    expect(EVENT_TYPES).toEqual(expect.arrayContaining([
      'product_impression', 'product_click', 'product_dwell', 'compare_add', 'compare_remove', 'compare_clear', 'compare_view',
      'community_list_view', 'community_post_view', 'community_post_submit', 'community_comment_submit',
    ]))
    // 2026-11-01 build-id-purpose(schema_version 3)에서 더한 1개
    expect(EVENT_TYPES).toContain('build_add_to_cart')
    // 2026-11-01 returns-refunds(schema_version 4)에서 더한 2개
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(['return_request', 'return_withdraw']))
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length)
    const { tracker, send } = setup()
    tracker.track('mouse_move', { x: 1 })
    expect(tracker.pending()).toBe(0)
    await tracker.flush()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('묶음 전송', () => {
  test(`${BATCH_SIZE}개가 되면 바로 한 묶음으로 보내고 타이머를 멈춘다`, async () => {
    const { tracker, send, timers } = setup()
    for (let index = 0; index < BATCH_SIZE - 1; index++) tracker.track('page_view', { route: 'products' })
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(timers.schedule).toHaveBeenCalledTimes(1)
    expect(timers.schedule.mock.calls[0][1]).toBe(FLUSH_DELAY_MS)
    tracker.track('page_view', { route: 'products' })
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(BATCH_SIZE)
    expect(timers.active()).toHaveLength(0)
    expect(tracker.pending()).toBe(0)
  })

  test(`${FLUSH_DELAY_MS / 1000}초가 지나면 쌓인 만큼 보낸다`, async () => {
    const { tracker, send, timers } = setup()
    tracker.track('page_view', { route: 'cart' })
    tracker.track('cart_view', { item_count: 3 })
    expect(send).not.toHaveBeenCalled()
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].map((event) => event.type)).toEqual(['page_view', 'cart_view'])
  })

  test('실패한 묶음은 다음 전송 때 한 번만 다시 보내고(같은 event_id), 또 실패하면 버린다', async () => {
    const { tracker, send, timers } = setup()
    send.mockRejectedValue(new Error('Network Error'))
    tracker.track('search', { search: 'rtx', result_count: 3 })
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(tracker.pending()).toBe(1)
    expect(timers.active()).toHaveLength(1)
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0][0].event_id).toBe(send.mock.calls[0][0][0].event_id)
    expect(tracker.pending()).toBe(0)
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
  })

  test.each([
    ['422(형식)', { response: { status: 422 } }],
    ['413(본문 초과)', { response: { status: 413 } }],
    ['403(Origin)', { response: { status: 403 } }],
  ])('%s 처럼 다시 보내도 같은 실패는 다시 보내지 않고 바로 버린다', async (_name, failure) => {
    const { tracker, send, timers } = setup()
    send.mockRejectedValue(failure)
    tracker.track('page_view', { route: 'products' })
    timers.run()
    await settle()
    expect(tracker.pending()).toBe(0)
    expect(timers.active()).toHaveLength(0)
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('5xx 는 한 번 다시 보낸다', async () => {
    const { tracker, send, timers } = setup()
    send.mockRejectedValueOnce({ response: { status: 503 } })
    tracker.track('page_view', { route: 'products' })
    timers.run()
    await settle()
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(tracker.pending()).toBe(0)
  })

  test.each([
    ['네트워크(응답 없음)', { isAxiosError: true, code: 'ERR_NETWORK' }, true],
    ['시간 초과', new Error('timeout'), true],
    ['500', { response: { status: 500 } }, true],
    ['502', { response: { status: 502 } }, true],
    ['422', { response: { status: 422 } }, false],
    ['413', { response: { status: 413 } }, false],
    ['403', { response: { status: 403 } }, false],
    ['400', { response: { status: 400 } }, false],
  ])('isRetryableError(%s) → %s', (_name, error, expected) => expect(isRetryableError(error)).toBe(expected))

  test('다시 보내기에 성공하면 그 뒤로는 보내지 않는다. 새 이벤트와 함께 간다', async () => {
    const { tracker, send, timers } = setup()
    send.mockRejectedValueOnce(new Error('Network Error'))
    tracker.track('add_to_cart', { product_id: 3, quantity: 1, price_krw: 899000 })
    timers.run()
    await settle()
    tracker.track('cart_view', { item_count: 1 })
    timers.run()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].map((event) => event.type)).toEqual(['add_to_cart', 'cart_view'])
    expect(tracker.pending()).toBe(0)
  })

  test('전송 함수가 바로 던져도 flush 는 reject 하지 않는다', async () => {
    const { tracker } = setup({ send: () => { throw new Error('boom') } })
    tracker.track('page_view', { route: 'products' })
    await expect(tracker.flush()).resolves.toBeUndefined()
  })
})

// 시간 제한을 손으로 끝내는 가짜 delay
function fakeDelay() {
  const timers = []
  const delay = jest.fn((ms) => {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    const timer = { ms, resolve, cancel: jest.fn() }
    timers.push(timer)
    return { promise, cancel: timer.cancel }
  })
  return { delay, timers }
}

function watch(promise) {
  const state = { done: false }
  promise.then(() => { state.done = true })
  return state
}

describe('로그아웃 전에 지금 보내기(flushNow)', () => {
  test('큐를 지금 일반 전송으로 보내고, 전송이 끝난 뒤에 resolve 한다(3초 타이머·시간 제한 타이머는 멈춘다)', async () => {
    let finish
    const send = jest.fn(() => new Promise((done) => { finish = done }))
    const { delay, timers: limits } = fakeDelay()
    const { tracker, timers } = setup({ send, delay })
    tracker.track('cart_view', { item_count: 1 })
    tracker.track('add_to_cart', { product_id: 3 })
    const state = watch(tracker.flushNow())
    await settle()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].map((event) => event.type)).toEqual(['cart_view', 'add_to_cart'])
    expect(timers.active()).toHaveLength(0)
    expect(delay).toHaveBeenCalledWith(LOGOUT_FLUSH_TIMEOUT_MS)
    expect(state.done).toBe(false)
    finish({ accepted: 2 })
    await settle()
    expect(state.done).toBe(true)
    expect(limits[0].cancel).toHaveBeenCalled()
    expect(tracker.pending()).toBe(0)
  })

  test('이미 보내는 중인 묶음도 끝날 때까지 기다린다', async () => {
    const responses = []
    const send = jest.fn(() => new Promise((done) => { responses.push(done) }))
    const { delay } = fakeDelay()
    const { tracker } = setup({ send, delay })
    tracker.track('page_view', { route: 'products' })
    tracker.flush()
    tracker.track('product_list_view', { result_count: 3 })
    const state = watch(tracker.flushNow())
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    responses[1]({ accepted: 1 })
    await settle()
    expect(state.done).toBe(false)
    responses[0]({ accepted: 1 })
    await settle()
    expect(state.done).toBe(true)
  })

  test('응답이 시간 제한(2초) 안에 오지 않으면 기다리지 않고 resolve 한다', async () => {
    const send = jest.fn(() => new Promise(() => {}))
    const { delay, timers } = fakeDelay()
    const { tracker } = setup({ send, delay })
    tracker.track('page_view', { route: 'cart' })
    const state = watch(tracker.flushNow())
    await settle()
    expect(state.done).toBe(false)
    timers[0].resolve()
    await settle()
    expect(state.done).toBe(true)
  })

  test('시간 제한을 바꿀 수 있다', () => {
    const { delay } = fakeDelay()
    const { tracker } = setup({ delay, send: jest.fn(() => new Promise(() => {})) })
    tracker.track('page_view', { route: 'cart' })
    tracker.flushNow({ timeout: 500 })
    expect(delay).toHaveBeenCalledWith(500)
  })

  test('전송이 실패해도(던지거나 reject) resolve 하고, 네트워크 오류면 다음 전송 때 다시 보낼 수 있게 큐에 남긴다', async () => {
    const { delay } = fakeDelay()
    const rejecting = setup({ delay, send: jest.fn().mockRejectedValue(new Error('Network Error')) })
    rejecting.tracker.track('page_view', { route: 'cart' })
    await expect(rejecting.tracker.flushNow()).resolves.toBeUndefined()
    expect(rejecting.tracker.pending()).toBe(1)
    const throwing = setup({ delay, send: () => { throw new Error('boom') } })
    throwing.tracker.track('page_view', { route: 'cart' })
    await expect(throwing.tracker.flushNow()).resolves.toBeUndefined()
  })

  test('보낼 것이 없거나 꺼져 있으면 보내지 않고 바로 resolve 한다', async () => {
    const empty = setup()
    await expect(empty.tracker.flushNow()).resolves.toBeUndefined()
    expect(empty.send).not.toHaveBeenCalled()
    const disabled = setup({ enabled: false })
    disabled.tracker.track('page_view', { route: 'cart' })
    await expect(disabled.tracker.flushNow()).resolves.toBeUndefined()
    expect(disabled.send).not.toHaveBeenCalled()
  })

  test('앱이 쓰는 flushEvents 는 테스트 환경에서 보내지 않고 바로 끝난다', async () => {
    const post = jest.spyOn(axios, 'post')
    track('page_view', { route: 'products' })
    await expect(flushEvents()).resolves.toBeUndefined()
    expect(post).not.toHaveBeenCalled()
    post.mockRestore()
  })
})

describe('페이지를 떠날 때', () => {
  test('큐에 남은 이벤트를 keepalive 로 보내고 타이머를 멈춘다', () => {
    const { tracker, send, sendOnExit, timers } = setup()
    tracker.track('buy_now', { product_id: 3, quantity: 2, price_krw: 899000 })
    tracker.flushOnExit()
    expect(sendOnExit).toHaveBeenCalledTimes(1)
    expect(sendOnExit.mock.calls[0][0].map((event) => event.type)).toEqual(['buy_now'])
    expect(send).not.toHaveBeenCalled()
    expect(timers.active()).toHaveLength(0)
    expect(tracker.pending()).toBe(0)
  })

  test('아직 응답을 받지 못한 묶음도 함께 보낸다(서버가 event_id 로 중복을 무시한다)', async () => {
    let finish
    const { tracker, sendOnExit } = setup({ send: jest.fn(() => new Promise((done) => { finish = done })) })
    tracker.track('login', { method: 'email' })
    const flushing = tracker.flush()
    tracker.track('page_view', { route: 'products' })
    tracker.flushOnExit()
    expect(sendOnExit.mock.calls[0][0].map((event) => event.type)).toEqual(['login', 'page_view'])
    finish()
    await flushing
  })

  test('보낼 것이 없으면 부르지 않고, keepalive 가 던지거나 reject 해도 던지지 않는다', async () => {
    const { tracker, sendOnExit } = setup()
    tracker.flushOnExit()
    expect(sendOnExit).not.toHaveBeenCalled()
    sendOnExit.mockImplementationOnce(() => { throw new Error('quota') })
    tracker.track('logout')
    expect(() => tracker.flushOnExit()).not.toThrow()
    const rejected = setup({ sendOnExit: jest.fn(() => Promise.reject(new Error('offline'))) })
    rejected.tracker.track('logout')
    expect(() => rejected.tracker.flushOnExit()).not.toThrow()
    await settle()
  })

  test('listen: pagehide 와 visibilitychange(hidden)에 보내고, visible 이면 보내지 않는다. 해제할 수 있다', () => {
    const { tracker, sendOnExit } = setup()
    const handlers = {}
    const target = { addEventListener: jest.fn((name, handler) => { handlers[name] = handler }), removeEventListener: jest.fn() }
    const doc = { visibilityState: 'visible', addEventListener: jest.fn((name, handler) => { handlers[name] = handler }), removeEventListener: jest.fn() }
    const stop = tracker.listen(target, doc)
    tracker.track('page_view', { route: 'cart' })
    handlers.visibilitychange()
    expect(sendOnExit).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    handlers.visibilitychange()
    expect(sendOnExit).toHaveBeenCalledTimes(1)
    tracker.track('page_view', { route: 'orders' })
    handlers.pagehide()
    expect(sendOnExit).toHaveBeenCalledTimes(2)
    stop()
    expect(target.removeEventListener).toHaveBeenCalledWith('pagehide', handlers.pagehide)
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', handlers.visibilitychange)
  })
})

describe('떠나기 전 할 일(onExit)', () => {
  test('떠날 때 등록한 할 일을 먼저 부르고, 할 일이 남긴 이벤트가 같은 keepalive 전송에 함께 실린다(큐의 이벤트 뒤)', () => {
    const { tracker, send, sendOnExit } = setup()
    const order = []
    tracker.track('product_view', { product_id: 3 })
    tracker.onExit((reason) => {
      order.push(`exit:${reason}`)
      tracker.track('product_dwell', { product_id: 3, view_id: 'view-1234', dwell_ms: 5200, reason })
    })
    sendOnExit.mockImplementation((events) => { order.push('send'); return true })
    tracker.flushOnExit('hidden')
    expect(order).toEqual(['exit:hidden', 'send'])
    expect(sendOnExit).toHaveBeenCalledTimes(1)
    expect(sendOnExit.mock.calls[0][0].map((event) => event.type)).toEqual(['product_view', 'product_dwell'])
    expect(sendOnExit.mock.calls[0][0][1].props).toEqual({ product_id: 3, view_id: 'view-1234', dwell_ms: 5200, reason: 'hidden' })
    expect(send).not.toHaveBeenCalled()
    expect(tracker.pending()).toBe(0)
  })

  test('할 일이 던져도 다른 할 일과 전송은 계속한다', () => {
    const { tracker, sendOnExit } = setup()
    const second = jest.fn(() => tracker.track('product_impression', { list: 'catalog', product_ids: [3], positions: [1] }))
    tracker.onExit(() => { throw new Error('broken') })
    tracker.onExit(second)
    tracker.track('page_view', { route: 'products' })
    expect(() => tracker.flushOnExit()).not.toThrow()
    expect(second).toHaveBeenCalledWith('leave')
    expect(sendOnExit.mock.calls[0][0].map((event) => event.type)).toEqual(['page_view', 'product_impression'])
  })

  test('listen: 탭이 숨겨지면 reason hidden, 페이지를 떠나면 leave 로 할 일을 부른다. 해제한 할 일은 부르지 않는다', () => {
    const { tracker } = setup()
    const handlers = {}
    const target = { addEventListener: jest.fn((name, handler) => { handlers[name] = handler }), removeEventListener: jest.fn() }
    const doc = { visibilityState: 'visible', addEventListener: jest.fn((name, handler) => { handlers[name] = handler }), removeEventListener: jest.fn() }
    tracker.listen(target, doc)
    const callback = jest.fn()
    const stop = tracker.onExit(callback)
    handlers.visibilitychange()
    expect(callback).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    handlers.visibilitychange()
    handlers.pagehide()
    expect(callback.mock.calls).toEqual([['hidden'], ['leave']])
    stop()
    handlers.pagehide()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('함수가 아니면 무시하고, 꺼져 있으면(테스트 환경) 할 일을 부르지 않는다. 앱의 onExit 는 해제 함수를 돌려준다', () => {
    const { tracker } = setup({ enabled: false })
    const callback = jest.fn()
    expect(tracker.onExit('nope')).toEqual(expect.any(Function))
    tracker.onExit(callback)
    tracker.flushOnExit('hidden')
    expect(callback).not.toHaveBeenCalled()
    const stop = onExit(callback)
    expect(stop).toEqual(expect.any(Function))
    expect(() => stop()).not.toThrow()
  })
})

describe('anonymous_id·session_id', () => {
  test('같은 탭에서 30분 안에 이어진 이벤트는 같은 세션이고, 이벤트가 있을 때마다 30분이 다시 시작된다', async () => {
    const { tracker, send, tick } = setup()
    tracker.track('page_view', { route: 'products' })
    tick(SESSION_TIMEOUT_MS - 1000)
    tracker.track('product_view', { product_id: 3 })
    tick(SESSION_TIMEOUT_MS - 1000)
    tracker.track('add_to_cart', { product_id: 3 })
    await tracker.flush()
    const ids = send.mock.calls[0][0].map((event) => event.session_id)
    expect(new Set(ids).size).toBe(1)
  })

  test('30분 동안 이벤트가 없으면 새 세션을 만든다. anonymous_id 는 그대로다', async () => {
    const { tracker, send, tick } = setup()
    tracker.track('page_view', { route: 'products' })
    tick(SESSION_TIMEOUT_MS + 1)
    tracker.track('page_view', { route: 'products' })
    await tracker.flush()
    const [first, second] = send.mock.calls[0][0]
    expect(second.session_id).not.toBe(first.session_id)
    expect(second.anonymous_id).toBe(first.anonymous_id)
  })

  test('새로 고침해도(새 추적기) 저장소의 anonymous_id·session_id 를 이어 쓴다', async () => {
    const local = memoryStorage({ [ANONYMOUS_ID_KEY]: 'anon-1234-abcd' })
    const session = memoryStorage({ [SESSION_KEY]: JSON.stringify({ id: 'sess-5678-efgh', last: START - 60000 }) })
    const { tracker, send } = setup({ storage: { local, session } })
    tracker.track('page_view', { route: 'cart' })
    await tracker.flush()
    expect(send.mock.calls[0][0][0]).toMatchObject({ anonymous_id: 'anon-1234-abcd', session_id: 'sess-5678-efgh' })
  })

  test.each([
    ['형식이 틀린 값', 'bad id!', 'not json'],
    ['너무 짧은 값', 'short', JSON.stringify({ id: 'x', last: START })],
  ])('저장된 값이 %s 이면 새로 만든다', async (_name, anonymous, saved) => {
    const { tracker, send } = setup({ storage: { local: memoryStorage({ [ANONYMOUS_ID_KEY]: anonymous }), session: memoryStorage({ [SESSION_KEY]: saved }) } })
    tracker.track('page_view', { route: 'cart' })
    await tracker.flush()
    const [event] = send.mock.calls[0][0]
    expect(event.anonymous_id).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(event.anonymous_id).not.toBe(anonymous)
    expect(event.session_id).toMatch(/^[A-Za-z0-9-]{8,64}$/)
  })

  test('저장소 접근이 막힌 브라우저(접근·읽기·쓰기 모두 던짐)에서도 던지지 않고, 이 페이지 동안 같은 id 를 쓴다', async () => {
    const blocked = () => { throw new DOMException('denied', 'SecurityError') }
    const throwing = { getItem: blocked, setItem: blocked }
    const { tracker, send } = setup({ storage: { local: blocked, session: throwing } })
    expect(() => tracker.track('page_view', { route: 'products' })).not.toThrow()
    tracker.track('product_list_view', { result_count: 3 })
    await tracker.flush()
    const [first, second] = send.mock.calls[0][0]
    expect(second.anonymous_id).toBe(first.anonymous_id)
    expect(second.session_id).toBe(first.session_id)
  })
})

describe('예외를 던지지 않는다', () => {
  test.each([
    ['uuid 실패', { uuid: () => { throw new Error('no crypto') } }],
    ['page 실패', { page: () => { throw new Error('no location') } }],
    ['now 실패', { now: () => { throw new Error('clock') } }],
    ['타이머 실패', { schedule: () => { throw new Error('no timers') } }],
  ])('%s 이면 그 이벤트만 버리거나 묶음 전송만 못 한다', (_name, options) => {
    const { tracker } = setup(options)
    expect(() => tracker.track('page_view', { route: 'products' })).not.toThrow()
    expect(() => tracker.flushOnExit()).not.toThrow()
  })

  test('enabled 가 false 면 아무것도 하지 않는다(저장소도 건드리지 않는다)', async () => {
    const { tracker, send, sendOnExit, local, session } = setup({ enabled: false })
    tracker.track('page_view', { route: 'products' })
    await tracker.flush()
    tracker.flushOnExit()
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()
    expect(local.values.size + session.values.size).toBe(0)
    expect(tracker.listen({ addEventListener: jest.fn() })).toEqual(expect.any(Function))
  })

  test('앱이 쓰는 track 은 테스트 환경(import.meta.env 없음)에서 실제로 보내지 않는다', async () => {
    const post = jest.spyOn(axios, 'post')
    for (let index = 0; index < BATCH_SIZE + 2; index++) expect(track('page_view', { route: 'products' })).toBeUndefined()
    await settle()
    expect(post).not.toHaveBeenCalled()
    post.mockRestore()
  })
})

describe('props 정리(서버 계약)', () => {
  test.each([
    ['허용하는 값', { product_id: 3, value_score: 272.52, is_new: false, brand: 'MSI', rating_average: null }, { product_id: 3, value_score: 272.52, is_new: false, brand: 'MSI', rating_average: null }],
    ['배열(20개까지, 기본값만)', { product_ids: Array.from({ length: 25 }, (_, index) => index + 1), value: [100, null, { x: 1 }] }, { product_ids: Array.from({ length: 20 }, (_, index) => index + 1), value: [100, null] }],
    ['문자열은 200자까지', { search: 'a'.repeat(250) }, { search: 'a'.repeat(200) }],
    ['숫자가 아닌 수는 null', { total: Number.NaN, price_krw: Number.POSITIVE_INFINITY }, { total: null, price_krw: null }],
    ['64비트 밖의 정수(정수로 표현되는 아주 큰 수 포함)는 null, 범위 안 정수·실수는 그대로', { big: 2 ** 63, small: -(2 ** 63), huge: 1.5e300, ok: 2 ** 53, ratio: 272.52 }, { big: null, small: null, huge: null, ok: 2 ** 53, ratio: 272.52 }],
    ['이모지는 반으로 자르지 않는다(코드 포인트 200자)', { search: '😀'.repeat(201) }, { search: '😀'.repeat(200) }],
    ['형식이 틀린 키·객체·undefined 는 버린다', { ProductId: 1, '1st': 2, 'a-b': 3, nested: { a: 1 }, missing: undefined, ok: 1 }, { ok: 1 }],
    ['개인정보 키는 버린다', { name: '김학습', email: 'a@b.c', phone: '010', recipient_name: '김철수', address1: '서울', content: '본문', title: '제목', delivery_memo: '메모', route: 'cart' }, { route: 'cart' }],
    ['객체가 아니면 빈 props', 'route', {}],
  ])('%s', (_name, input, expected) => expect(cleanProps(input)).toEqual(expected))

  test('키는 20개까지', () => {
    const props = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]))
    expect(Object.keys(cleanProps(props))).toHaveLength(20)
  })

  test.each(['name', 'product_name', 'email', 'phone', 'address2', 'content', 'review_content', 'password', 'subject', 'sub', 'user', 'user_id', 'userid', 'username', 'member_id', 'account_id'])('%s 는 보내지 않는 키다(개인정보·사용자)', (key) => expect(isPersonalKey(key)).toBe(true))
  test.each(['product_id', 'brand', 'route', 'search', 'result_count', 'payment_id', 'error_code'])('%s 는 보내도 되는 키다', (key) => expect(isPersonalKey(key)).toBe(false))
})

describe('page 정리', () => {
  test.each([
    ['/products?category=gpu&search=rtx', '/products?category=gpu&search=rtx'],
    ['/login/kakao/callback?code=abc&state=xyz', '/login/kakao/callback?code=&state='],
    ['/reset?token=secret&password=pw&next=%2Fcart', '/reset?token=&password=&next=%2Fcart'],
    ['/cart#top', '/cart'],
    ['', '/'],
    ['products', '/products'],
    [`/products?search=${'x'.repeat(600)}`, `/products?search=${'x'.repeat(600)}`.slice(0, 500)],
  ])('eventPath(%s)', (input, expected) => expect(eventPath(input)).toBe(expected))

  test.each([
    ['https://www.mlops.kro.kr/products/3?code=abc#reviews', 'https://www.mlops.kro.kr/products/3?code='],
    ['https://www.google.com/', 'https://www.google.com/'],
    ['', ''],
    ['not a url', ''],
  ])('eventReferrer(%s)', (input, expected) => expect(eventReferrer(input)).toBe(expected))

  test('비밀값이 없는 query 는 그대로 둔다', () => {
    expect(redactQuery('?search=%EB%A1%9C%EA%B7%B8&page=2')).toBe('?search=%EB%A1%9C%EA%B7%B8&page=2')
    expect(redactQuery('')).toBe('')
  })
})

describe('도구 함수', () => {
  test('createUuid: randomUUID 가 있으면 그것을, 없으면 getRandomValues 로 uuid v4 를 만든다', () => {
    expect(createUuid({ randomUUID: () => 'from-random-uuid' })).toBe('from-random-uuid')
    expect(createUuid({ getRandomValues: (bytes) => bytes.fill(7) })).toMatch(UUID)
    expect(createUuid(undefined)).toMatch(UUID)
    expect(createUuid({ randomUUID: () => { throw new Error('insecure context') }, getRandomValues: (bytes) => bytes.fill(1) })).toMatch(UUID)
  })

  test('chunkEvents: 한 요청은 50개·60KB 이하, 혼자서도 큰 이벤트는 버린다', () => {
    const small = Array.from({ length: 120 }, (_, index) => ({ id: index }))
    expect(chunkEvents(small).map((chunk) => chunk.length)).toEqual([50, 50, 20])
    const big = { id: 'big', text: 'x'.repeat(200) }
    expect(chunkEvents([big, big, big], { maxBytes: 500 }).map((chunk) => chunk.length)).toEqual([2, 1])
    expect(chunkEvents([{ text: 'x'.repeat(1000) }, { id: 1 }], { maxBytes: 500 })).toEqual([[{ id: 1 }]])
  })

  test('safeStorage: 저장소가 없거나 던지면 메모리에 둔다', () => {
    const storage = safeStorage(null)
    expect(storage.get('a')).toBeNull()
    storage.set('a', '1')
    expect(storage.get('a')).toBe('1')
  })
})
