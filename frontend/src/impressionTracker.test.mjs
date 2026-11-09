// 상품 목록 노출·클릭 추적기(src/stores/impressionTracker.js, spec docs/specs/2026-11-01-event-enrichment.md "정한 것"):
// 50% 이상 보인 카드만, 목록 결과(list_view_id)마다 상품당 한 번, 1초 묶음, 20개 초과는 나눔, 쪽을 넘어 이어지는 위치,
// 목록을 다시 부르면 새 list_view_id, IntersectionObserver 가 없으면 노출을 보내지 않음, 클릭은 노출과 같은 id·위치.
// 2026-11-03(spec docs/specs/2026-11-03-product-recommendations.md): start() 의 추가 값(source_product_id·model_version)을 노출·클릭에 싣는다.
import { jest } from '@jest/globals'
import { IMPRESSION_BATCH_MS, IMPRESSION_THRESHOLD, browserObserver, createImpressionTracker, listPosition } from './stores/impressionTracker.js'

function fakeObservers() {
  const created = []
  return {
    created,
    create: jest.fn((callback, options) => {
      const observer = {
        callback, options, targets: new Set(),
        observe: jest.fn((element) => observer.targets.add(element)),
        unobserve: jest.fn((element) => observer.targets.delete(element)),
        disconnect: jest.fn(() => observer.targets.clear()),
      }
      created.push(observer)
      return observer
    }),
    /** 요소들이 ratio 만큼 보였다고 알린다(관찰 중인 요소만). */
    show(elements, ratio = 1) {
      for (const observer of created) {
        const entries = elements.filter((element) => observer.targets.has(element)).map((target) => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio }))
        if (entries.length) observer.callback(entries)
      }
    },
  }
}

function fakeTimers() {
  const timers = []
  return {
    schedule: jest.fn((callback, delay) => {
      const timer = { callback, delay, cancelled: false, done: false }
      timers.push(timer)
      return timer
    }),
    cancel: jest.fn((timer) => { timer.cancelled = true }),
    active: () => timers.filter((timer) => !timer.cancelled && !timer.done),
    run() {
      for (const timer of timers.filter((item) => !item.cancelled && !item.done)) {
        timer.done = true
        timer.callback()
      }
    },
  }
}

const card = (id) => ({ id: `card-${id}` })
const product = (id) => ({ id, name: `상품 ${id}` })

function setup(options = {}) {
  const track = jest.fn()
  const io = fakeObservers()
  const timers = fakeTimers()
  let views = 0
  const exits = []
  const stopExit = jest.fn()
  const tracker = createImpressionTracker({
    list: 'catalog', track, pageSize: 20, createObserver: io.create, schedule: timers.schedule, cancel: timers.cancel,
    uuid: () => `list-view-${++views}`, onExit: (callback) => { exits.push(callback); return stopExit }, ...options,
  })
  const impressions = () => track.mock.calls.filter(([type]) => type === 'product_impression').map(([, props]) => props)
  const clicks = () => track.mock.calls.filter(([type]) => type === 'product_click').map(([, props]) => props)
  return { tracker, track, io, timers, exits, stopExit, impressions, clicks }
}

describe('위치', () => {
  test.each([
    [1, 0, 20, 1],
    [1, 19, 20, 20],
    [2, 0, 20, 21],
    [3, 4, 20, 45],
    [null, 2, 20, 3],
    [0, 0, 20, 1],
  ])('page %s 의 %s번째 칸(쪽 크기 %s) → %s', (page, index, size, expected) => {
    expect(listPosition(page, index, size)).toBe(expected)
  })
})

describe('노출', () => {
  test(`카드가 ${IMPRESSION_THRESHOLD * 100}% 이상 보이면 ${IMPRESSION_BATCH_MS / 1000}초 동안 모아 한 번에 보낸다(목록 조건·쪽을 넘어 이어지는 위치)`, () => {
    const { tracker, io, timers, impressions } = setup()
    const id = tracker.start({ page: 2, sort: 'price_asc', category: 'gpu', search: 'RTX' })
    expect(id).toBe('list-view-1')
    expect(io.create.mock.calls[0][1]).toEqual({ threshold: 0.5 })
    const [first, second, third] = [card(3), card(4), card(5)]
    tracker.observe(first, product(3), 0)
    tracker.observe(second, product(4), 1)
    tracker.observe(third, product(5), 2)
    io.show([first])
    io.show([second], 0.5)
    io.show([third], 0.49)
    expect(impressions()).toEqual([])
    expect(timers.schedule).toHaveBeenCalledTimes(1)
    expect(timers.schedule.mock.calls[0][1]).toBe(1000)
    timers.run()
    expect(impressions()).toEqual([{
      list: 'catalog', list_view_id: 'list-view-1', product_ids: [3, 4], positions: [21, 22], page: 2, sort: 'price_asc', category: 'gpu', search: 'RTX',
    }])
  })

  test('같은 목록 결과 안에서는 상품마다 한 번만 센다. 목록을 다시 부르면 새 list_view_id 로 다시 센다(빈 조건은 null)', () => {
    const { tracker, io, timers, impressions } = setup()
    tracker.start({ page: 1, sort: 'recommended' })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    io.show([element], 0)
    io.show([element])
    timers.run()
    expect(impressions()).toHaveLength(1)
    const next = tracker.start({ page: 1, sort: 'price_desc', category: null, search: '' })
    expect(next).toBe('list-view-2')
    // 같은 요소를 그대로 다시 쓰는 경우에도 새 결과로 다시 관찰한다
    expect(io.created[0].observe).toHaveBeenCalledTimes(2)
    io.show([element])
    timers.run()
    expect(impressions()).toEqual([
      { list: 'catalog', list_view_id: 'list-view-1', product_ids: [3], positions: [1], page: 1, sort: 'recommended', category: null, search: null },
      { list: 'catalog', list_view_id: 'list-view-2', product_ids: [3], positions: [1], page: 1, sort: 'price_desc', category: null, search: null },
    ])
  })

  test('20개가 넘으면 20개씩 나눠 보낸다', () => {
    const { tracker, io, timers, impressions } = setup({ pageSize: 30 })
    tracker.start({ page: 1, sort: 'recommended' })
    const elements = Array.from({ length: 25 }, (_, index) => card(index + 1))
    elements.forEach((element, index) => tracker.observe(element, product(index + 1), index))
    io.show(elements)
    timers.run()
    expect(impressions().map((props) => props.product_ids.length)).toEqual([20, 5])
    expect(impressions()[1].positions).toEqual([21, 22, 23, 24, 25])
    expect(impressions().every((props) => props.list_view_id === 'list-view-1')).toBe(true)
  })

  test('목록이 바뀌기 전에 모아 둔 노출은 이전 list_view_id 로 먼저 보낸다', () => {
    const { tracker, io, impressions, timers } = setup()
    tracker.start({ page: 1, sort: 'recommended' })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    tracker.start({ page: 2, sort: 'recommended' })
    expect(impressions()).toEqual([expect.objectContaining({ list_view_id: 'list-view-1', positions: [1] })])
    expect(timers.active()).toHaveLength(0)
  })

  test('카드가 사라지면(요소 null) 관찰을 멈추고, 칸이 바뀌면 새 위치로 다시 관찰한다', () => {
    const { tracker, io, timers, impressions } = setup()
    tracker.start({ page: 1, sort: 'recommended' })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    tracker.observe(element, product(3), 0)
    expect(io.created[0].observe).toHaveBeenCalledTimes(1)
    tracker.observe(element, product(3), 4)
    expect(io.created[0].observe).toHaveBeenCalledTimes(2)
    io.show([element])
    timers.run()
    expect(impressions()[0].positions).toEqual([5])
    tracker.observe(null, product(3), 4)
    expect(io.created[0].unobserve).toHaveBeenLastCalledWith(element)
    expect(io.created[0].targets.has(element)).toBe(false)
  })

  test('목록 결과를 받기 전(start 전)에 보인 카드는 세지 않는다', () => {
    const { tracker, io, timers, impressions } = setup()
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    timers.run()
    expect(impressions()).toEqual([])
  })

  test('IntersectionObserver 가 없으면 노출을 보내지 않는다(추측하지 않는다). 클릭은 남긴다', () => {
    const { tracker, track, clicks } = setup({ createObserver: () => null })
    tracker.start({ page: 1, sort: 'recommended' })
    tracker.observe(card(3), product(3), 0)
    tracker.flush()
    expect(tracker.supported()).toBe(false)
    expect(track.mock.calls.filter(([type]) => type === 'product_impression')).toEqual([])
    tracker.click(product(3), 0)
    expect(clicks()).toEqual([{ list: 'catalog', list_view_id: 'list-view-1', product_id: 3, position: 1 }])
    // 노출을 재지 않는 브라우저에서는 누른 카드도 노출로 세지 않는다
    expect(track.mock.calls.filter(([type]) => type === 'product_impression')).toEqual([])
  })

  test('browserObserver: 브라우저에 IntersectionObserver 가 없거나 만들 때 던지면 null', () => {
    const original = globalThis.IntersectionObserver
    try {
      delete globalThis.IntersectionObserver
      expect(browserObserver(() => {}, {})).toBeNull()
      globalThis.IntersectionObserver = function Broken() { throw new Error('nope') }
      expect(browserObserver(() => {}, {})).toBeNull()
      globalThis.IntersectionObserver = function Fake(callback, options) { this.callback = callback; this.options = options }
      expect(browserObserver(() => {}, { threshold: 0.5 })).toMatchObject({ options: { threshold: 0.5 } })
    } finally {
      if (original) globalThis.IntersectionObserver = original
      else delete globalThis.IntersectionObserver
    }
  })
})

describe('클릭·떠날 때', () => {
  test('카드를 누르면 모아 둔 노출을 먼저 보내고 product_click(노출과 같은 list_view_id·position)', () => {
    const { tracker, io, track } = setup()
    tracker.start({ page: 3, sort: 'newest' })
    const element = card(9)
    tracker.observe(element, product(9), 6)
    io.show([element])
    tracker.click(product(9), 6)
    expect(track.mock.calls).toEqual([
      ['product_impression', expect.objectContaining({ list_view_id: 'list-view-1', product_ids: [9], positions: [47] })],
      ['product_click', { list: 'catalog', list_view_id: 'list-view-1', product_id: 9, position: 47 }],
    ])
  })

  test('아직 노출로 세지 않은 카드를 누르면 노출로도 센다(누르면서 스크롤돼 관찰자가 알리기 전). 이미 센 카드는 다시 세지 않는다', () => {
    const { tracker, io, track, timers } = setup()
    tracker.start({ page: 2, sort: 'price_asc', category: 'gpu' })
    const seen = card(4)
    const hidden = card(5)
    tracker.observe(seen, product(4), 0)
    tracker.observe(hidden, product(5), 1)
    io.show([seen])
    timers.run()
    tracker.click(product(5), 1)
    tracker.click(product(4), 0)
    io.show([hidden])
    timers.run()
    expect(track.mock.calls).toEqual([
      ['product_impression', expect.objectContaining({ list_view_id: 'list-view-1', product_ids: [4], positions: [21] })],
      ['product_impression', expect.objectContaining({ list_view_id: 'list-view-1', product_ids: [5], positions: [22], category: 'gpu' })],
      ['product_click', { list: 'catalog', list_view_id: 'list-view-1', product_id: 5, position: 22 }],
      ['product_click', { list: 'catalog', list_view_id: 'list-view-1', product_id: 4, position: 21 }],
    ])
  })

  test('목록 결과를 받기 전(start 전)에 누른 카드는 노출로 세지 않는다', () => {
    const { tracker, track } = setup()
    tracker.click(product(5), 0)
    expect(track.mock.calls).toEqual([['product_click', { list: 'catalog', list_view_id: null, product_id: 5, position: 1 }]])
  })

  test('페이지를 떠날 때(onExit) 남은 노출을 보내고, stop 은 남은 것을 보내고 관찰·등록을 해제한다', () => {
    const { tracker, io, exits, stopExit, impressions } = setup()
    tracker.start({ page: 1, sort: 'recommended' })
    const first = card(1)
    const second = card(2)
    tracker.observe(first, product(1), 0)
    tracker.observe(second, product(2), 1)
    io.show([first])
    exits[0]('hidden')
    expect(impressions()).toHaveLength(1)
    io.show([second])
    tracker.stop()
    expect(impressions()).toHaveLength(2)
    expect(io.created[0].disconnect).toHaveBeenCalled()
    expect(stopExit).toHaveBeenCalled()
  })

  test('track·관찰자·타이머가 던져도 던지지 않는다', () => {
    const broken = setup({ track: () => { throw new Error('track') }, schedule: () => { throw new Error('timer') } })
    broken.tracker.start({ page: 1 })
    const element = card(1)
    broken.tracker.observe(element, product(1), 0)
    expect(() => broken.io.show([element])).not.toThrow()
    expect(() => broken.tracker.flush()).not.toThrow()
    expect(() => broken.tracker.click(product(1), 0)).not.toThrow()
    const noObserver = setup({ createObserver: () => { throw new Error('io') }, uuid: () => { throw new Error('uuid') } })
    expect(noObserver.tracker.start({ page: 1 })).toEqual(expect.any(String))
    expect(() => noObserver.tracker.observe(card(1), product(1), 0)).not.toThrow()
    expect(() => noObserver.tracker.stop()).not.toThrow()
  })
})

// spec docs/specs/2026-11-03-product-recommendations.md "이벤트"(schema_version 5): 상품 상세 추천 칸(list 'recommendation')은
// start() 에 보고 있는 상품(source_product_id)·모델 버전(model_version, 기본 추천이면 null)을 넘겨 노출·클릭에 함께 싣는다
describe('start 의 추가 값(추천 칸)', () => {
  test('추가 값은 그 목록 결과의 노출·클릭 props 에 함께 실린다(위치 1~6, page 1, sort·category·search null)', () => {
    const { tracker, io, timers, impressions, clicks } = setup({ list: 'recommendation', pageSize: 6 })
    tracker.start({ page: 1, source_product_id: 1, model_version: 'itemcf-4' })
    const [first, second] = [card(3), card(28)]
    tracker.observe(first, product(3), 0)
    tracker.observe(second, product(28), 1)
    io.show([first, second])
    timers.run()
    tracker.click(product(28), 1)
    expect(impressions()).toEqual([{
      list: 'recommendation', list_view_id: 'list-view-1', product_ids: [3, 28], positions: [1, 2], page: 1, sort: null, category: null, search: null,
      source_product_id: 1, model_version: 'itemcf-4',
    }])
    expect(clicks()).toEqual([{ list: 'recommendation', list_view_id: 'list-view-1', product_id: 28, position: 2, source_product_id: 1, model_version: 'itemcf-4' }])
  })

  test('null(기본 추천)은 그대로 싣고, undefined 와 추적기가 정하는 키(list·list_view_id·위치 등)는 덮어쓰지 못한다', () => {
    const { tracker, io, timers, impressions, clicks } = setup({ list: 'recommendation', pageSize: 6 })
    tracker.start({ page: 1, source_product_id: 1, model_version: null, extra_note: undefined, list: 'catalog', list_view_id: 'fake', position: 99, product_ids: [1] })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    timers.run()
    tracker.click(product(3), 0)
    expect(impressions()).toEqual([expect.objectContaining({ list: 'recommendation', list_view_id: 'list-view-1', product_ids: [3], positions: [1], model_version: null, source_product_id: 1 })])
    expect(Object.keys(impressions()[0])).not.toContain('extra_note')
    expect(clicks()).toEqual([{ list: 'recommendation', list_view_id: 'list-view-1', product_id: 3, position: 1, source_product_id: 1, model_version: null }])
  })

  test('새 목록 결과(start)는 이전 결과의 추가 값을 이어받지 않는다. 모아 둔 노출은 이전 값으로 보낸다', () => {
    const { tracker, io, impressions, clicks } = setup({ list: 'recommendation', pageSize: 6 })
    tracker.start({ page: 1, source_product_id: 1, model_version: 'itemcf-3' })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    tracker.start({ page: 1, source_product_id: 1, model_version: 'itemcf-4' })
    tracker.click(product(3), 0)
    expect(impressions().map((props) => [props.list_view_id, props.model_version])).toEqual([['list-view-1', 'itemcf-3'], ['list-view-2', 'itemcf-4']])
    expect(clicks()).toEqual([expect.objectContaining({ list_view_id: 'list-view-2', model_version: 'itemcf-4' })])
  })

  test('추가 값이 없으면(상품 목록) 노출·클릭 props 는 예전 그대로다', () => {
    const { tracker, io, timers, impressions, clicks } = setup()
    tracker.start({ page: 1, sort: 'recommended', category: 'gpu', search: null })
    const element = card(3)
    tracker.observe(element, product(3), 0)
    io.show([element])
    timers.run()
    tracker.click(product(3), 0)
    expect(impressions()).toEqual([{ list: 'catalog', list_view_id: 'list-view-1', product_ids: [3], positions: [1], page: 1, sort: 'recommended', category: 'gpu', search: null }])
    expect(clicks()).toEqual([{ list: 'catalog', list_view_id: 'list-view-1', product_id: 3, position: 1 }])
  })
})
