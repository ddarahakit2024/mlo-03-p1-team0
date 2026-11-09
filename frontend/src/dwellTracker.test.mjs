// 상품 상세 체류 시간 추적기(src/stores/dwellTracker.js, spec docs/specs/2026-11-01-event-enrichment.md "정한 것"):
// 숨김·떠남마다 구간 전송, 숨긴 동안은 세지 않음, 1초 미만 생략, 30분에서 자름, 상세를 열 때마다 새 view_id.
// "추적기 전송보다 먼저 큐에 들어감"은 실제 추적기(createTracker)의 onExit 에 연결해 확인한다.
import { jest } from '@jest/globals'
import { MAX_DWELL_MS, MIN_DWELL_MS, createDwellTracker, dwellSegment } from './stores/dwellTracker.js'
import { createTracker } from './stores/tracking.js'

function fakeDocument(state = 'visible') {
  const listeners = new Set()
  return {
    visibilityState: state,
    addEventListener: jest.fn((name, listener) => { if (name === 'visibilitychange') listeners.add(listener) }),
    removeEventListener: jest.fn((name, listener) => listeners.delete(listener)),
    /** 보임 상태를 바꾸고 visibilitychange 를 알린다. */
    set(next) {
      this.visibilityState = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

function setup(options = {}) {
  let clock = 1_000_000
  const track = jest.fn()
  const doc = fakeDocument(options.state)
  const exits = []
  const stopExit = jest.fn()
  let views = 0
  const dwell = createDwellTracker({
    productId: 3, track, doc, now: () => clock, uuid: () => `view-${++views}`,
    onExit: (callback) => { exits.push(callback); return stopExit }, ...options,
  })
  const events = () => track.mock.calls.filter(([type]) => type === 'product_dwell').map(([, props]) => props)
  return { dwell, track, doc, exits, stopExit, events, tick: (ms) => { clock += ms }, exit: (reason) => exits.forEach((callback) => callback(reason)) }
}

describe('구간 길이', () => {
  test.each([
    [999, null],
    [1000, 1000],
    [5234.6, 5235],
    [MAX_DWELL_MS + 1, MAX_DWELL_MS],
    [-5, null],
    [NaN, null],
  ])('%s ms → %s', (elapsed, expected) => {
    expect(dwellSegment(elapsed)).toBe(expected)
  })

  test('기준: 1초 미만 생략, 30분(세션 기준)에서 자른다', () => {
    expect(MIN_DWELL_MS).toBe(1000)
    expect(MAX_DWELL_MS).toBe(30 * 60 * 1000)
  })
})

describe('체류 시간', () => {
  test('탭이 숨겨질 때와 페이지를 떠날 때 그때까지의 구간을 보낸다. 숨긴 동안은 세지 않는다(같은 view_id)', () => {
    const { tick, exit, doc, events } = setup()
    tick(5000)
    doc.set('hidden')
    exit('hidden')
    tick(60_000)
    doc.set('visible')
    tick(2500)
    exit('leave')
    expect(events()).toEqual([
      { product_id: 3, view_id: 'view-1', dwell_ms: 5000, reason: 'hidden' },
      { product_id: 3, view_id: 'view-1', dwell_ms: 2500, reason: 'leave' },
    ])
  })

  test('숨김 뒤 떠남이 이어지면(탭을 닫음) 숨김 구간 하나만 보낸다', () => {
    const { tick, exit, doc, events } = setup()
    tick(3000)
    doc.set('hidden')
    exit('hidden')
    exit('leave')
    expect(events()).toEqual([{ product_id: 3, view_id: 'view-1', dwell_ms: 3000, reason: 'hidden' }])
  })

  test('1초 미만 구간은 보내지 않고, 30분이 넘는 구간은 30분으로 자른다', () => {
    const { tick, exit, doc, events } = setup()
    tick(400)
    doc.set('hidden')
    exit('hidden')
    doc.set('visible')
    tick(MAX_DWELL_MS + 90_000)
    exit('leave')
    expect(events()).toEqual([{ product_id: 3, view_id: 'view-1', dwell_ms: MAX_DWELL_MS, reason: 'leave' }])
  })

  test('숨겨진 탭에서 열었으면 보일 때부터 잰다', () => {
    const { tick, exit, doc, events } = setup({ state: 'hidden' })
    tick(10_000)
    exit('hidden')
    expect(events()).toEqual([])
    doc.set('visible')
    tick(4000)
    exit('leave')
    expect(events()).toEqual([{ product_id: 3, view_id: 'view-1', dwell_ms: 4000, reason: 'leave' }])
  })

  test('stop: 지금 구간을 leave 로 보내고 해제한다(그 뒤로는 보내지 않는다)', () => {
    const { dwell, tick, exit, doc, stopExit, events } = setup()
    tick(1500)
    dwell.stop()
    dwell.stop()
    expect(events()).toEqual([{ product_id: 3, view_id: 'view-1', dwell_ms: 1500, reason: 'leave' }])
    expect(stopExit).toHaveBeenCalledTimes(1)
    expect(doc.listeners.size).toBe(0)
    doc.set('visible')
    tick(5000)
    exit('leave')
    expect(events()).toHaveLength(1)
  })

  test('상세를 열 때마다 새 view_id', () => {
    const first = setup()
    const second = setup({ uuid: () => 'view-other' })
    first.tick(2000)
    second.tick(2000)
    first.exit('leave')
    second.exit('leave')
    expect(first.events()[0].view_id).toBe('view-1')
    expect(second.events()[0].view_id).toBe('view-other')
  })

  test('document 가 없으면 늘 보이는 것으로 보고, 시계·track·onExit 가 던져도 던지지 않는다', () => {
    const noDoc = setup({ doc: undefined })
    noDoc.tick(2000)
    noDoc.exit('leave')
    expect(noDoc.events()).toEqual([{ product_id: 3, view_id: 'view-1', dwell_ms: 2000, reason: 'leave' }])
    const broken = setup({ now: () => { throw new Error('clock') }, track: () => { throw new Error('track') }, uuid: () => { throw new Error('uuid') } })
    expect(() => broken.exit('hidden')).not.toThrow()
    expect(() => broken.dwell.stop()).not.toThrow()
    expect(() => createDwellTracker({ productId: 3, onExit: () => { throw new Error('exit') } }).stop()).not.toThrow()
  })
})

describe('추적기와 함께', () => {
  test('숨김·떠남에서 체류 이벤트가 추적기의 keepalive 전송보다 먼저 큐에 들어가 같은 전송에 실린다', () => {
    let clock = Date.parse('2026-11-01T01:00:00.000Z')
    const sendOnExit = jest.fn(() => true)
    const tracker = createTracker({ send: jest.fn().mockResolvedValue({}), sendOnExit, now: () => clock, page: () => ({ path: '/products/3', referrer: '' }), schedule: () => 1, cancel: () => {} })
    const target = { addEventListener: () => {}, removeEventListener: () => {} }
    const doc = fakeDocument()
    tracker.listen(target, doc)
    tracker.track('product_view', { product_id: 3 })
    createDwellTracker({ productId: 3, track: tracker.track, onExit: tracker.onExit, now: () => clock, doc, uuid: () => 'view-1234' })
    clock += 7000
    doc.set('hidden')
    expect(sendOnExit).toHaveBeenCalledTimes(1)
    const [events] = sendOnExit.mock.calls[0]
    expect(events.map((event) => event.type)).toEqual(['product_view', 'product_dwell'])
    expect(events[1]).toMatchObject({ schema_version: 5, props: { product_id: 3, view_id: 'view-1234', dwell_ms: 7000, reason: 'hidden' } })
  })
})
