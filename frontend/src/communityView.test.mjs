// 커뮤니티 화면·컴포넌트: 왼쪽 게시판 메뉴(CommunityShell), 커뮤니티 홈, 게시판 목록(일반·견적), 글쓰기·수정(견적 요청), 글 상세(댓글·받은 견적), 부품 표, 부품 고르기.
// spec 2026-11-01-community-dark-theme "화면" 상태표(로딩·정상·빈 목록·오류→다시 시도·404·401·403)와 "2차 개편"(aside·일반 게시판 모양·견적 게시판 전용 화면)을 화면마다 확인한다.
import * as Vue from 'vue'
import { jest } from '@jest/globals'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SRC, button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'
import { formatBoardDate } from './stores/communityViewModel.js'

const author = (id, name) => ({ id: `user:${id}`, name })
const CREATED = '2026-11-01T03:00:00Z' // 한국 시간 2026-11-01 12:00
// 목록 날짜는 "오늘이면 시:분" 이라 시계에 따라 달라진다. 화면 테스트는 지금 시각을 고정한 formatBoardDate 를 넘긴다
const NOW = '2026-11-02T01:00:00Z' // 한국 시간 2026-11-02 10:00
const TODAY = '2026-11-02T00:30:00Z' // 한국 시간 2026-11-02 09:30 → '09:30'
const boardDate = (value) => formatBoardDate(value, NOW)
const buildItem = (id = 3, extra = {}) => ({
  id, board: 'build', title: '150만 원 게임용 견적 부탁드립니다', preview: '배그·로아를 QHD 로 즐기고 싶습니다.',
  author: author(7, '민지'), budget_krw: 1500000, purpose: 'gaming', comment_count: 2, quote_count: 1, created_at: CREATED, updated_at: CREATED, ...extra,
})
const freeItem = (id = 5, extra = {}) => ({
  id, board: 'free', title: '첫 조립 후기 남깁니다', preview: '생각보다 선 정리가 어렵네요.',
  author: author(8, '첫PC'), budget_krw: null, purpose: null, comment_count: 0, quote_count: 0, created_at: CREATED, updated_at: CREATED, ...extra,
})
const questionItem = { id: 7, title: 'B650 보드에 DDR5-6000 을 써도 되나요?', content: '내용', author: { id: '9', name: '질문자' }, created_at: CREATED, image_count: 0, answer_count: 1 }
const page = (items, extra = {}) => ({ items, total: items.length, page: 1, page_size: 10, ...extra })
const cpuItem = { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '/images/products/amd-ryzen7-9800x3d.webp', price_krw: 739000, stock: 12, quantity: 1, line_total_krw: 739000 }
const gpuItem = { product_id: 7, name: '지포스 RTX 5070 Ti 벤투스 3X OC 16GB', brand: 'MSI', category: 'gpu', thumbnail_url: '/images/products/msi-rtx5070ti-ventus-3x-oc.webp', price_krw: 1290000, stock: 0, quantity: 1, line_total_krw: 1290000 }
const comment = (id, extra = {}) => ({
  id, post_id: 3, author: author(id, `댓글러${id}`), content: `댓글 내용 ${id}`, is_owner: false, created_at: CREATED, updated_at: CREATED,
  items: [], items_total_krw: 0, budget_gap_krw: null, ...extra,
})
// 견적(부품 목록이 있는 댓글): budget_gap_krw = items_total_krw − 글의 budget_krw(서버 계산값)
const quote = (id, extra = {}) => comment(id, { author: author(9, '조립왕'), content: '이렇게 맞춰 보세요', items: [cpuItem, gpuItem], items_total_krw: 2029000, budget_gap_krw: 529000, ...extra })
const buildDetail = (extra = {}) => ({
  id: 3, board: 'build', title: '150만 원 게임용 견적 부탁드립니다', content: '배그·로아를 QHD 로 즐기고 싶습니다.\n모니터는 있습니다.',
  author: author(7, '민지'), budget_krw: 1500000, purpose: 'gaming', is_owner: false, created_at: CREATED, updated_at: CREATED,
  comments: [quote(10), comment(11, { is_owner: true, content: '저도 궁금합니다', updated_at: '2026-11-02T03:00:00Z' })],
  ...extra,
})
const freeDetail = (extra = {}) => ({ ...buildDetail(), id: 5, board: 'free', budget_krw: null, purpose: null, comments: [comment(20, { post_id: 5 })], ...extra })

const cardOf = (root, code) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === `board-${code}-title`)
const hrefs = (root) => findAll(root, (node) => node.type === 'a').map((node) => node.props.href)
const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name)
const byClass = (root, name) => find(root, (node) => hasClass(node, name))
const allByClass = (root, name) => findAll(root, (node) => hasClass(node, name))
const elements = (node) => node.children.filter((child) => !String(child.type).startsWith('#'))

describe('CommunityShell(왼쪽 게시판 메뉴)', () => {
  let Shell
  beforeAll(async () => { Shell = await compileSfc('components/CommunityShell.vue') })

  test('aside 안의 nav: 링크 이름은 정확히 게시판 이름(아이콘은 aria-hidden), 지금 게시판에만 aria-current="page"', () => {
    const view = mount(Shell, { active: 'build' })
    const aside = find(view.root, (node) => node.type === 'aside')
    const nav = find(aside, (node) => node.type === 'nav')
    expect(nav.props['aria-label']).toBe('커뮤니티 게시판')
    const links = findAll(nav, (node) => node.type === 'a')
    expect(links.map((node) => [text(node), node.props.href])).toEqual([
      ['커뮤니티 홈', '/community'], ['질문 게시판', '/questions'], ['자유 게시판', '/community/free'], ['견적 게시판', '/community/build'],
    ])
    expect(links.map((node) => node.props['aria-current'])).toEqual([undefined, undefined, undefined, 'page'])
    expect(findAll(aside, (node) => node.type === 'svg').every((node) => node.props['aria-hidden'] === 'true')).toBe(true)
  })

  test('게시판 메뉴 아래 "바로 쓰기"(질문하기 · 견적 요청하기(강조)) + 모바일 "+ 견적 요청", 본문은 slot 으로 그린다', () => {
    const Host = { setup() { return () => Vue.h(Shell, { active: 'questions' }, { default: () => Vue.h('p', null, '본문 내용') }) } }
    const view = mount(Host)
    const aside = find(view.root, (node) => node.type === 'aside')
    const write = findAll(aside, (node) => node.type === 'a').slice(4)
    expect(write.map((node) => [text(node), node.props.href])).toEqual([
      ['질문하기', '/questions/new'], ['견적 요청하기', '/community/build/new'], ['+ 견적 요청', '/community/build/new'],
    ])
    expect(write.map((node) => hasClass(node, 'cm-shell__write-link--primary'))).toEqual([false, true, false])
    expect(hasClass(write[2], 'cm-shell__quick')).toBe(true)
    expect(find(view.root, (node) => node.props['aria-current'] === 'page').props.href).toBe('/questions')
    expect(text(find(view.root, (node) => hasClass(node, 'cm-shell__main')))).toBe('본문 내용')
  })

  test('모르는 값이면 아무 게시판도 강조하지 않는다', () => {
    const view = mount(Shell, { active: '' })
    expect(findAll(view.root, (node) => node.props['aria-current'] === 'page')).toEqual([])
  })

  test('counts 를 넘긴 게시판만 글 수를 그린다(aria-hidden 이라 링크 이름은 그대로)', () => {
    const view = mount(Shell, { active: 'build', counts: { questions: 1234, build: 0, free: null } })
    const nav = find(view.root, (node) => node.type === 'nav')
    const counts = findAll(nav, (node) => hasClass(node, 'cm-shell__count'))
    expect(counts.map((node) => [text(node.parent).replace(text(node), ''), text(node), node.props['aria-hidden']])).toEqual([
      ['질문 게시판', '1,234', 'true'], ['견적 게시판', '0', 'true'],
    ])
  })
})

describe('CommunityPartsTable', () => {
  let Table
  beforeAll(async () => { Table = await compileSfc('components/CommunityPartsTable.vue') })

  test('부품 줄: 사진(alt)·상품 링크·"브랜드 · 카테고리 · N개"·줄 금액(서버 값), 재고 0 이면 품절, 목록 이름에 줄 수', async () => {
    const view = mount(Table, { items: [cpuItem, gpuItem], total: 2029000, caption: '조립왕님의 부품 목록' })
    const images = findAll(view.root, (node) => node.type === 'img')
    expect(images.map((node) => [node.props.src, node.props.alt])).toEqual([
      [cpuItem.thumbnail_url, `${cpuItem.name} 이미지`], [gpuItem.thumbnail_url, `${gpuItem.name} 이미지`],
    ])
    expect(link(view.root, cpuItem.name).props.href).toBe('/products/1')
    expect(find(view.root, (node) => node.type === 'ul').props['aria-label']).toBe('조립왕님의 부품 목록 2줄')
    const rows = findAll(view.root, (node) => node.type === 'li' && node.props.class === 'cm-parts__row')
    expect(text(byClass(rows[0], 'cm-parts__meta'))).toBe('AMD · CPU · 1개')
    expect(text(byClass(rows[0], 'cm-parts__line'))).toBe('739,000원')
    expect(text(rows[0])).not.toContain('품절')
    expect(text(byClass(rows[1], 'cm-parts__sold-out'))).toBe('품절')
    expect(text(byClass(view.root, 'cm-parts__total'))).toBe('합계2,029,000원')
    expect(text(view.root)).toContain('금액은 지금 MOA Parts 판매가 기준입니다.')
    images[0].props.onError()
    await flush()
    expect(findAll(view.root, (node) => node.type === 'img')[0].props.src).toBe('/product-placeholder.svg')
  })

  test('2개 이상이면 개당 판매가, 30일 변동률이 줄에 있으면 PriceChangeBadge(없으면 그리지 않음)', () => {
    const view = mount(Table, { items: [{ ...cpuItem, quantity: 2, line_total_krw: 1478000, change_30d_pct: -4.2 }, gpuItem], total: 2768000 })
    const rows = findAll(view.root, (node) => node.type === 'li')
    expect(text(byClass(rows[0], 'cm-parts__line'))).toBe('1,478,000원')
    expect(text(byClass(rows[0], 'cm-parts__unit'))).toBe('개당 739,000원')
    expect(stub(rows[0], 'PriceChangeBadge').props.pct).toBe(-4.2)
    expect(byClass(rows[1], 'cm-parts__unit')).toBeNull()
    expect(stub(rows[1], 'PriceChangeBadge')).toBeNull()
  })

  test('showNote=false·showTotal=false 면 판매가 기준 안내·합계 줄을 그리지 않는다(견적 카드가 위에 합계를 보여 줄 때)', () => {
    const view = mount(Table, { items: [cpuItem], total: 739000, showNote: false, showTotal: false })
    expect(text(view.root)).not.toContain('금액은 지금 MOA Parts 판매가 기준입니다.')
    expect(byClass(view.root, 'cm-parts__total')).toBeNull()
  })
})

describe('CommunityPartsPicker', () => {
  const cpus = [
    { id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', price_krw: 739000, stock: 12, thumbnail_url: '' },
    { id: 2, name: '코어 울트라7 265K', brand: 'Intel', category: 'cpu', price_krw: 519000, stock: 0, thumbnail_url: '' },
  ]
  let Picker
  beforeAll(async () => { Picker = await compileSfc('components/CommunityPartsPicker.vue') })

  // v-model 과 catalog 를 들고 있는 화면 역할. request-products 를 받으면 catalog 를 바꾼다
  function host({ lines = [], budgetKrw = null, respond = () => ({ status: 'ready', items: cpus, error: '' }) } = {}) {
    const updates = []
    const requested = []
    const state = { lines: Vue.ref(lines), catalog: Vue.ref({}) }
    const Host = {
      setup() {
        return () => Vue.h(Picker, {
          modelValue: state.lines.value, catalog: state.catalog.value, idPrefix: 'parts', budgetKrw,
          'onUpdate:modelValue': (value) => { updates.push(value); state.lines.value = value },
          onRequestProducts: (category) => { requested.push(category); state.catalog.value = { ...state.catalog.value, [category]: respond(category) } },
        })
      },
    }
    return { view: mount(Host), updates, requested, state }
  }
  const choose = async (root, id, value) => { byId(root, id).props.onChange({ target: { value } }); await flush() }

  test('카테고리 → 상품 → 수량 → 추가: 줄을 알리고 예상 합계(목록 가격 × 수량)를 보여 준다', async () => {
    const { view, updates, requested } = host()
    expect(byId(view.root, 'parts-product').props.disabled).toBe(true)
    expect(text(view.root)).toContain('아직 고른 부품이 없습니다.')
    await choose(view.root, 'parts-category', 'cpu')
    expect(requested).toEqual(['cpu'])
    const options = findAll(byId(view.root, 'parts-product'), (node) => node.type === 'option').map(text)
    expect(options).toEqual(['상품 선택', '라이젠7 9800X3D · 739,000원', '코어 울트라7 265K · 519,000원 (품절)'])
    await choose(view.root, 'parts-product', '1')
    await choose(view.root, 'parts-quantity', '2')
    await click(button(view.root, '추가'))
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual([{ product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 2 }])
    expect(text(find(view.root, (node) => node.props.class === 'cm-picker__total'))).toBe('예상 합계1,478,000원')
    expect(text(view.root)).toContain('1 / 15줄')
    expect(byId(view.root, 'parts-product').props.value).toBe('')
    expect(byClass(view.root, 'cm-gap')).toBeNull()
  })

  test.each([
    ['예산보다 비싸면 예산 초과', 1500000, '예산 초과 · 529,000원', 'cm-gap--over'],
    ['예산보다 싸면 남는 금액', 3000000, '예산 안 · 971,000원 남음', 'cm-gap--under'],
    ['예산과 같으면 딱 맞음', 2029000, '예산에 딱 맞음', 'cm-gap--exact'],
  ])('글의 예산(budgetKrw)을 넘기면 예상 합계와 비교한 배지(화면 표시용): %s', (_name, budgetKrw, label, tone) => {
    const lines = [{ product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', price_krw: 739000, quantity: 1 }, { product_id: 7, name: 'RTX 5070 Ti', brand: 'MSI', price_krw: 1290000, quantity: 1 }]
    const { view } = host({ lines, budgetKrw })
    const badge = byClass(view.root, 'cm-gap')
    expect(text(badge)).toBe(label)
    expect(hasClass(badge, tone)).toBe(true)
    expect(text(byClass(view.root, 'cm-picker__budget'))).toContain('과 비교')
  })

  test('고른 부품이 없으면 예산이 있어도 비교 배지를 그리지 않는다', () => {
    const { view } = host({ lines: [], budgetKrw: 1500000 })
    expect(byClass(view.root, 'cm-gap')).toBeNull()
  })

  test('상품을 안 골랐거나 이미 있는 상품이면 추가하지 않고 이유를 알린다', async () => {
    const { view, updates } = host({ lines: [{ product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', price_krw: 739000, quantity: 1 }] })
    await click(button(view.root, '추가'))
    expect(text(byRole(view.root, 'alert')[0])).toBe('추가할 상품을 골라 주세요.')
    await choose(view.root, 'parts-category', 'cpu')
    await choose(view.root, 'parts-product', '1')
    await click(button(view.root, '추가'))
    expect(text(byRole(view.root, 'alert')[0])).toContain('이미 목록에 있는 상품입니다.')
    expect(updates).toEqual([])
  })

  test('15줄이 차면 추가 버튼을 막고, 줄 빼기는 그 줄만 뺀 목록을 알린다', async () => {
    const lines = Array.from({ length: 15 }, (_, index) => ({ product_id: 100 + index, name: `부품${index}`, brand: 'B', price_krw: 1000, quantity: 1 }))
    const { view, updates } = host({ lines })
    expect(button(view.root, '추가').props.disabled).toBe(true)
    expect(text(view.root)).toContain('부품은 15줄까지 붙일 수 있습니다.')
    const remove = find(view.root, (node) => node.props['aria-label'] === '부품3 빼기')
    await click(remove)
    expect(updates[0].map((line) => line.product_id)).not.toContain(103)
    expect(updates[0]).toHaveLength(14)
    expect(button(view.root, '추가').props.disabled).toBe(false)
  })

  test('상품 목록 로딩·오류: 오류면 다시 시도로 다시 요청한다', async () => {
    let status = 'loading'
    const { view, requested } = host({ respond: () => (status === 'error' ? { status: 'error', items: [], error: '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.' } : { status, items: [], error: '' }) })
    await choose(view.root, 'parts-category', 'gpu')
    expect(text(byRole(view.root, 'status')[0])).toBe('상품을 불러오는 중입니다...')
    status = 'error'
    await choose(view.root, 'parts-category', 'gpu')
    expect(text(byRole(view.root, 'alert')[0])).toContain('상품 목록을 불러오지 못했습니다.')
    status = 'ready'
    await click(button(byRole(view.root, 'alert')[0], '다시 시도'))
    expect(requested).toEqual(['gpu', 'gpu', 'gpu'])
    expect(text(view.root)).toContain('이 카테고리에는 판매 중인 상품이 없습니다.')
  })
})

describe('CommunityHome', () => {
  const fetchQuestions = jest.fn()
  const fetchCommunityPosts = jest.fn()
  let Home
  beforeAll(async () => { Home = await compileSfc('views/CommunityHome.vue', { fetchQuestions, fetchCommunityPosts, formatBoardDate: boardDate }) })
  beforeEach(() => { fetchQuestions.mockReset(); fetchCommunityPosts.mockReset() })
  const rows = (root, code) => findAll(cardOf(root, code), (node) => node.type === 'a' && hasClass(node, 'cm-preview__row'))

  test('게시판 3개가 따로 로딩을 보여 주고, 질문은 질문 API·자유/견적은 커뮤니티 API 로 최신 5개를 부른다', async () => {
    fetchQuestions.mockReturnValue(deferred().promise)
    fetchCommunityPosts.mockReturnValue(deferred().promise)
    const view = mount(Home)
    await flush()
    expect(byRole(view.root, 'status').map(text)).toEqual(['게시글을 불러오는 중입니다...', '게시글을 불러오는 중입니다...', '게시글을 불러오는 중입니다...'])
    expect(fetchQuestions).toHaveBeenCalledWith({ page: 1, pageSize: 5 })
    expect(fetchCommunityPosts.mock.calls).toEqual([[{ board: 'free', page: 1, pageSize: 5 }], [{ board: 'build', page: 1, pageSize: 5 }]])
    expect(stub(view.root, 'SiteLayout').props['active-page']).toBe('community')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('home')
  })

  test('한 게시판이 실패해도 나머지는 보이고, 그 게시판만 다시 시도한다. 빈 게시판은 첫 글 안내', async () => {
    fetchQuestions.mockResolvedValue(page([questionItem]))
    fetchCommunityPosts.mockImplementation(async ({ board }) => {
      if (board === 'free') throw { response: { status: 500 } }
      return page([])
    })
    const view = mount(Home)
    await flush()
    expect(text(cardOf(view.root, 'questions'))).toContain(questionItem.title)
    expect(text(cardOf(view.root, 'questions'))).toContain('답변 1')
    expect(text(byRole(cardOf(view.root, 'free'), 'alert')[0])).toContain('게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
    expect(text(cardOf(view.root, 'build'))).toContain('아직 글이 없습니다. 첫 글을 남겨 보세요.')
    expect(link(cardOf(view.root, 'build'), '첫 글 쓰기').props.href).toBe('/community/build/new')
    fetchCommunityPosts.mockResolvedValue(page([freeItem()]))
    await click(button(cardOf(view.root, 'free'), '다시 시도'))
    expect(fetchQuestions).toHaveBeenCalledTimes(1)
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'free', page: 1, pageSize: 5 })
    expect(text(cardOf(view.root, 'free'))).toContain('첫 조립 후기 남깁니다')
    expect(byRole(view.root, 'alert')).toEqual([])
  })

  test('게시판 모양 미리보기(디자인): 질문은 제목·답변 알약·날짜, 자유는 제목 [댓글]·글쓴이, 견적은 상태 알약·제목·용도·예산·날짜. 게시판마다 더 보기', async () => {
    fetchQuestions.mockResolvedValue(page([questionItem, { ...questionItem, id: 8, answer_count: 0 }]))
    fetchCommunityPosts.mockImplementation(async ({ board }) => page(board === 'build'
      ? [buildItem(3, { quote_count: 2 }), buildItem(4, { quote_count: 0, comment_count: 0, purpose: 'office', budget_krw: 500000 })]
      : [freeItem(5, { comment_count: 3 })]))
    const view = mount(Home)
    await flush()
    const questions = rows(view.root, 'questions')
    expect(text(questions[0])).toBe(`${questionItem.title}답변 12026.11.01`)
    expect(hasClass(byClass(questions[0], 'cm-pill'), 'cm-pill--on')).toBe(true)
    expect(hasClass(byClass(questions[1], 'cm-pill'), 'cm-pill--on')).toBe(false)
    expect(text(rows(view.root, 'free')[0])).toBe('첫 조립 후기 남깁니다댓글 [3]첫PC')
    const build = rows(view.root, 'build')
    expect(text(build[0])).toBe('견적 2개150만 원 게임용 견적 부탁드립니다게임150만 원2026.11.01')
    expect(text(build[1])).toBe('견적 대기150만 원 게임용 견적 부탁드립니다사무·학습50만 원2026.11.01')
    expect(hasClass(byClass(build[0], 'cm-pill'), 'cm-pill--on')).toBe(true)
    expect(hasClass(byClass(build[1], 'cm-pill'), 'cm-pill--on')).toBe(false)
    expect(hrefs(cardOf(view.root, 'questions'))).toEqual(['/questions', '/questions/7', '/questions/8'])
    expect(hrefs(cardOf(view.root, 'free'))).toEqual(['/community/free', '/community/posts/5'])
    expect(hrefs(cardOf(view.root, 'build'))).toEqual(['/community/build', '/community/posts/3', '/community/posts/4'])
    expect(link(cardOf(view.root, 'build'), '더 보기').props['aria-label']).toBe('견적 게시판 더 보기')
    // 받은 전체 수(total)는 왼쪽 메뉴 숫자로 넘긴다
    expect(stub(view.root, 'CommunityShell').props.counts).toEqual({ questions: 2, free: 1, build: 2 })
  })

  test('주황 배너: 견적 게시판을 받기 전에는 숫자 없이, 받은 뒤에는 "최근 글 중 견적을 기다리는 요청 N건"(quote_count 0 인 글) + 견적 보내기 링크', async () => {
    const build = deferred()
    fetchQuestions.mockResolvedValue(page([]))
    fetchCommunityPosts.mockImplementation(({ board }) => (board === 'build' ? build.promise : Promise.resolve(page([]))))
    const view = mount(Home)
    await flush()
    const banner = () => byClass(view.root, 'cm-banner')
    expect(text(byClass(banner(), 'cm-banner__title'))).toBe('견적을 기다리는 요청')
    expect(link(banner(), '견적 보내기').props.href).toBe('/community/build')
    build.resolve(page([buildItem(3, { quote_count: 0 }), buildItem(4, { quote_count: 2 }), buildItem(5, { quote_count: null })]))
    await flush()
    expect(text(byClass(banner(), 'cm-banner__title'))).toBe('최근 글 중 견적을 기다리는 요청 2건')
  })
})

describe('CommunityPostList', () => {
  const fetchCommunityPosts = jest.fn()
  // 주소(?purpose=)는 브라우저 객체라 가짜로 넘긴다
  const readPurposeQuery = jest.fn()
  const replacePurposeQuery = jest.fn()
  let List
  beforeAll(async () => { List = await compileSfc('views/CommunityPostList.vue', { fetchCommunityPosts, formatBoardDate: boardDate, readPurposeQuery, replacePurposeQuery }) })
  beforeEach(() => {
    for (const mock of [fetchCommunityPosts, readPurposeQuery, replacePurposeQuery]) mock.mockReset()
    readPurposeQuery.mockReturnValue('')
  })
  const pager = (root) => find(root, (node) => node.type === 'nav')
  const chip = (root, name) => find(byClass(root, 'cm-filter'), (node) => node.type === 'button' && text(node) === name)

  test('로딩 → 오류 → 다시 시도 → 빈 목록(견적 요청하기 링크)', async () => {
    const first = deferred()
    fetchCommunityPosts.mockReturnValueOnce(first.promise).mockResolvedValue(page([]))
    const view = mount(List, { board: 'build' })
    await flush()
    expect(text(byRole(view.root, 'status')[0])).toBe('게시글을 불러오는 중입니다...')
    first.reject({ response: { status: 500, data: { message: 'Internal Server Error' } } })
    await flush()
    expect(text(byRole(view.root, 'alert')[0])).toContain('게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(view.root, '다시 시도'))
    expect(fetchCommunityPosts).toHaveBeenCalledTimes(2)
    expect(text(view.root)).toContain('아직 글이 없습니다. 첫 글을 남겨 보세요.')
    const writeLinks = findAll(view.root, (node) => node.type === 'a' && node.props.href === '/community/build/new')
    expect(writeLinks.map(text)).toEqual(['견적 요청하기', '견적 요청하기'])
    expect(pager(view.root)).toBeNull()
    expect(stub(view.root, 'SiteLayout').props['active-page']).toBe('community')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('build')
  })

  test('자유 게시판(디자인 "free board"): 제목 [댓글] | 글쓴이 | 날짜(오늘은 시:분), 전체 수, 번호 쪽 이동', async () => {
    fetchCommunityPosts.mockResolvedValueOnce(page([freeItem(21, { comment_count: 3 }), freeItem(22, { created_at: TODAY })], { total: 23 }))
    const view = mount(List, { board: 'free' })
    await flush()
    expect(fetchCommunityPosts).toHaveBeenCalledWith({ board: 'free', page: 1, pageSize: 10, search: '' })
    expect(readPurposeQuery).not.toHaveBeenCalled()
    expect(text(find(view.root, (node) => node.type === 'h1'))).toBe('자유 게시판')
    expect(text(view.root)).toContain('조립기, 후기, 잡담 — PC 이야기는 무엇이든.')
    const rows = () => findAll(view.root, (node) => node.type === 'a' && hasClass(node, 'cm-board-row'))
    expect(rows().map((node) => node.props.href)).toEqual(['/community/posts/21', '/community/posts/22'])
    expect(text(rows()[0])).toBe('첫 조립 후기 남깁니다댓글 [3]첫PC2026.11.01')
    expect(text(rows()[1])).toBe('첫 조립 후기 남깁니다첫PC09:30')
    expect(text(find(rows()[0], (node) => node.type === 'h2'))).toBe('첫 조립 후기 남깁니다')
    expect(text(view.root)).toContain('전체 글 23개')
    expect(text(view.root)).not.toContain('예산')
    expect(stub(view.root, 'CommunityShell').props.counts).toEqual({ free: 23 })
    const pageButtons = () => findAll(pager(view.root), (node) => node.type === 'button')
    expect(pager(view.root).props['aria-label']).toBe('자유 게시판 페이지')
    expect(pageButtons().map(text)).toEqual(['‹이전', '1', '2', '3', '다음›'])
    expect(pageButtons()[0].props.disabled).toBe(true)
    expect(text(find(pager(view.root), (node) => node.props['aria-current'] === 'page'))).toBe('1')
    fetchCommunityPosts.mockResolvedValueOnce(page([freeItem(11)], { total: 23, page: 2 }))
    await click(button(pager(view.root), '다음'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'free', page: 2, pageSize: 10, search: '' })
    expect(rows().map((node) => node.props.href)).toEqual(['/community/posts/11'])
    expect(text(find(pager(view.root), (node) => node.props['aria-current'] === 'page'))).toBe('2')
    fetchCommunityPosts.mockResolvedValueOnce(page([freeItem(1)], { total: 23, page: 3 }))
    await click(find(pager(view.root), (node) => node.props['aria-label'] === '3쪽'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'free', page: 3, pageSize: 10, search: '' })
    expect(pageButtons().at(-1).props.disabled).toBe(true)
  })

  test('견적 게시판(디자인 "estimates list"): 상태 알약 | 제목 + "글쓴이 · 선호 사항" | 용도 | 예산 | 날짜', async () => {
    fetchCommunityPosts.mockResolvedValueOnce(page([
      buildItem(3, { quote_count: 2, preferences: [] }),
      buildItem(4, { quote_count: 0, comment_count: 0, purpose: 'creative', budget_krw: 100000000, preferences: ['white', 'quiet', 'mystery'] }),
    ], { total: 13 }))
    const view = mount(List, { board: 'build' })
    await flush()
    expect(fetchCommunityPosts).toHaveBeenCalledWith({ board: 'build', page: 1, pageSize: 10, search: '' })
    const rows = findAll(view.root, (node) => node.type === 'a' && hasClass(node, 'cm-build-row'))
    expect(rows.map((node) => node.props.href)).toEqual(['/community/posts/3', '/community/posts/4'])
    expect(text(rows[0])).toBe('견적 2개150만 원 게임용 견적 부탁드립니다민지 · 선호 없음게임150만 원2026.11.01')
    expect(text(rows[1])).toBe('견적 대기150만 원 게임용 견적 부탁드립니다민지 · 조용한 PC · 화이트영상·그래픽 작업1억 원2026.11.01')
    expect(text(find(rows[1], (node) => node.type === 'h2'))).toBe('150만 원 게임용 견적 부탁드립니다')
    expect(hasClass(byClass(rows[0], 'cm-build-row__status'), 'cm-pill--on')).toBe(true)
    expect(hasClass(byClass(rows[1], 'cm-build-row__status'), 'cm-pill--on')).toBe(false)
    expect(text(view.root)).toContain('전체 견적 요청 13개')
    expect(text(view.root)).not.toContain('2026년')
    expect(stub(view.root, 'CommunityShell').props.counts).toEqual({ build: 13 })
  })

  test('견적 게시판 용도 필터: 칩을 고르면 1쪽부터 purpose 로 다시 부르고, 빈 결과는 전체 보기로 돌아간다', async () => {
    fetchCommunityPosts.mockResolvedValueOnce(page([buildItem()], { total: 13 }))
    const view = mount(List, { board: 'build' })
    await flush()
    expect(byClass(view.root, 'cm-filter').props.role).toBe('group')
    expect(findAll(byClass(view.root, 'cm-filter'), (node) => node.type === 'button').map((node) => [text(node), node.props['aria-pressed']])).toEqual([
      ['전체', true], ['게임', false], ['사무·학습', false], ['영상·그래픽 작업', false], ['개발·AI', false], ['기타', false],
    ])
    fetchCommunityPosts.mockResolvedValueOnce(page([buildItem(5)], { total: 1 }))
    await click(chip(view.root, '게임'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'build', page: 1, pageSize: 10, search: '', purpose: 'gaming' })
    expect(replacePurposeQuery).toHaveBeenLastCalledWith('gaming')
    expect(chip(view.root, '게임').props['aria-pressed']).toBe(true)
    expect(chip(view.root, '전체').props['aria-pressed']).toBe(false)
    expect(text(view.root)).toContain('게임 견적 요청 1개')
    fetchCommunityPosts.mockResolvedValueOnce(page([]))
    await click(chip(view.root, '개발·AI'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'build', page: 1, pageSize: 10, search: '', purpose: 'development' })
    expect(text(view.root)).toContain('개발·AI 용도의 견적 요청이 아직 없습니다.')
    fetchCommunityPosts.mockResolvedValueOnce(page([buildItem()], { total: 13 }))
    await click(button(view.root, '전체 보기'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'build', page: 1, pageSize: 10, search: '' })
    expect(replacePurposeQuery).toHaveBeenLastCalledWith('')
    expect(chip(view.root, '전체').props['aria-pressed']).toBe(true)
  })

  test('주소에 용도(?purpose=)가 있으면 그 용도로 처음부터 거른다', async () => {
    readPurposeQuery.mockReturnValue('creative')
    fetchCommunityPosts.mockResolvedValueOnce(page([buildItem(4, { purpose: 'creative' })]))
    const view = mount(List, { board: 'build' })
    await flush()
    expect(fetchCommunityPosts).toHaveBeenCalledWith({ board: 'build', page: 1, pageSize: 10, search: '', purpose: 'creative' })
    expect(chip(view.root, '영상·그래픽 작업').props['aria-pressed']).toBe(true)
    expect(text(view.root)).toContain('영상·그래픽 작업 견적 요청 1개')
    expect(replacePurposeQuery).not.toHaveBeenCalled()
  })

  test('자유 게시판에는 용도 필터가 없고, 검색은 1쪽부터·결과가 없으면 다른 검색어 안내·검색 지우기', async () => {
    fetchCommunityPosts.mockResolvedValueOnce(page([freeItem()])).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([freeItem()]))
    const view = mount(List, { board: 'free' })
    await flush()
    expect(byClass(view.root, 'cm-filter')).toBeNull()
    await setValue(byId(view.root, 'community-search'), '  선 정리  ')
    await submit(view.root)
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'free', page: 1, pageSize: 10, search: '선 정리' })
    expect(text(view.root)).toContain('검색 결과가 없습니다.')
    expect(text(view.root)).toContain('다른 검색어로 찾아보세요.')
    expect(text(view.root)).toContain('검색 결과 0개')
    await click(button(view.root, '검색 지우기'))
    expect(fetchCommunityPosts).toHaveBeenLastCalledWith({ board: 'free', page: 1, pageSize: 10, search: '' })
    expect(byId(view.root, 'community-search').value).toBe('')
    expect(text(view.root)).toContain('전체 글 1개')
  })

  test('늦게 온 이전 응답은 화면을 덮지 않는다', async () => {
    const slow = deferred()
    fetchCommunityPosts.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([freeItem(6, { title: '검색한 글' })]))
    const view = mount(List, { board: 'free' })
    await flush()
    await setValue(byId(view.root, 'community-search'), '검색')
    await submit(view.root)
    expect(text(view.root)).toContain('검색한 글')
    slow.resolve(page([freeItem(1, { title: '이전 응답' })]))
    await flush()
    expect(text(view.root)).toContain('검색한 글')
    expect(text(view.root)).not.toContain('이전 응답')
  })

  test('모르는 게시판은 API 를 부르지 않고 찾을 수 없음 + 커뮤니티 홈 링크', async () => {
    const view = mount(List, { board: null })
    await flush()
    expect(fetchCommunityPosts).not.toHaveBeenCalled()
    expect(text(byRole(view.root, 'alert')[0])).toContain('게시판을 찾을 수 없습니다.')
    expect(link(view.root, '커뮤니티 홈으로').props.href).toBe('/community')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('')
  })
})

describe('CommunityPostEditor', () => {
  const fetchCurrentUser = jest.fn()
  const createCommunityPost = jest.fn()
  const fetchCommunityPost = jest.fn()
  const updateCommunityPost = jest.fn()
  const goToCommunityPost = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let Editor
  beforeAll(async () => { Editor = await compileSfc('views/CommunityPostEditor.vue', { authSession, createCommunityPost, fetchCommunityPost, updateCommunityPost, goToCommunityPost }) })
  beforeEach(() => {
    for (const mock of [fetchCurrentUser, createCommunityPost, fetchCommunityPost, updateCommunityPost, goToCommunityPost]) mock.mockReset()
    fetchCurrentUser.mockResolvedValue({ id: 7, name: '민지' })
    authSession.reset()
  })
  async function open(props) {
    const view = mount(Editor, props)
    await flush()
    return view
  }
  const fieldset = (root) => find(root, (node) => node.type === 'fieldset')
  const heading = (root) => text(find(root, (node) => node.type === 'h1'))
  const preset = (root, name) => find(root, (node) => node.type === 'button' && hasClass(node, 'cm-preset') && text(node) === name)

  test('비로그인이면 폼 대신 로그인 안내, 로그인 상태 다시 확인 뒤 폼', async () => {
    fetchCurrentUser.mockRejectedValueOnce({ response: { status: 401 } })
    const view = await open({ board: 'free' })
    expect(text(view.root)).toContain('로그인한 후 글을 쓸 수 있습니다.')
    expect(link(view.root, '로그인').props.href).toBe('/login')
    expect(byId(view.root, 'post-title')).toBeNull()
    await click(button(view.root, '로그인 상태 다시 확인'))
    expect(byId(view.root, 'post-title')).not.toBeNull()
  })

  test('로그인 확인이 401 이 아닌 이유로 실패하면 오류와 다시 시도', async () => {
    fetchCurrentUser.mockRejectedValueOnce({ response: { status: 503 } })
    const view = await open({ board: 'free' })
    expect(text(byRole(view.root, 'alert')[0])).toContain('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
    expect(text(view.root)).not.toContain('로그인한 후 글을 쓸 수 있습니다.')
    await click(button(view.root, '다시 시도'))
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
    expect(byId(view.root, 'post-title')).not.toBeNull()
  })

  test('모르는 게시판은 로그인 확인 없이 찾을 수 없음 + 게시판 목록 링크', async () => {
    const view = await open({ board: null })
    expect(fetchCurrentUser).not.toHaveBeenCalled()
    expect(text(byRole(view.root, 'alert')[0])).toContain('게시판을 찾을 수 없습니다.')
    expect(link(view.root, '게시판 목록 보기').props.href).toBe('/community')
  })

  test('견적 요청하기: 예산 → 용도(라디오 카드) → 제목 → 요청 내용 순서, 요청 내용 안내(게임·해상도·가진 부품·브랜드)', async () => {
    const view = await open({ board: 'build' })
    expect(heading(view.root)).toBe('견적 요청하기')
    expect(stub(view.root, 'SiteLayout').props['active-page']).toBe('community')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('build')
    const order = ['post-budget', 'post-purpose-gaming', 'post-title', 'post-content']
    expect(findAll(view.root, (node) => order.includes(node.props.id)).map((node) => node.props.id)).toEqual(order)
    expect(findAll(view.root, (node) => node.type === 'input' && node.props.type === 'radio').map((node) => [node.props.value, node.props.name])).toEqual([
      ['gaming', 'post-purpose'], ['office', 'post-purpose'], ['creative', 'post-purpose'], ['development', 'post-purpose'], ['other', 'post-purpose'],
    ])
    expect(find(view.root, (node) => node.props.role === 'radiogroup').props['aria-labelledby']).toBe('post-purpose-label')
    expect(text(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-content'))).toContain('요청 내용')
    const placeholder = byId(view.root, 'post-content').props.placeholder
    for (const hint of ['게임', '모니터 해상도', '가진 부품', '브랜드']) expect(placeholder).toContain(hint)
    expect(findAll(view.root, (node) => hasClass(node, 'cm-preset')).map(text)).toEqual(['50만 원', '100만 원', '150만 원', '200만 원', '300만 원'])
    // 선호 사항(체크박스 칩)·모니터 해상도(select, 고르지 않음이 기본)
    expect(find(view.root, (node) => node.props.role === 'group' && node.props['aria-labelledby'] === 'post-pref-label')).not.toBeNull()
    expect(findAll(view.root, (node) => node.type === 'input' && node.props.type === 'checkbox').map((node) => [node.props.id, text(node.parent)])).toEqual([
      ['post-pref-quiet', '조용한 PC'], ['post-pref-small', '작은 케이스'], ['post-pref-white', '화이트'], ['post-pref-rgb', 'RGB'], ['post-pref-upgradable', '업그레이드 여유'],
    ])
    expect(text(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-monitor'))).toContain('모니터 해상도')
    expect(findAll(byId(view.root, 'post-monitor'), (node) => node.type === 'option').map((node) => [node.props.value, text(node)])).toEqual([
      ['', '선택 안 함'], ['fhd', 'FHD (1920×1080)'], ['qhd', 'QHD (2560×1440)'], ['uhd', '4K (3840×2160)'], ['none', '아직 없음'],
    ])
    expect(byId(view.root, 'post-monitor').props.value).toBe('')
    expect(button(view.root, '견적 요청 등록')).not.toBeNull()
    expect(text(view.root)).toContain('등록하면 견적 게시판에 공개돼요.')
  })

  test('예산: 새 요청은 150만 원에서 시작하고, 슬라이더(50~500, 10 단위)·만 원 입력칸·빠른 선택 칩이 같은 값을 쓴다(둘 다 이름이 있다)', async () => {
    const view = await open({ board: 'build' })
    const range = () => byId(view.root, 'post-budget-range')
    expect(byId(view.root, 'post-budget').value).toBe('150')
    expect(range().props).toMatchObject({ type: 'range', min: 50, max: 500, step: 10, value: 150, 'aria-valuetext': '150만 원' })
    expect(text(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-budget-range'))).toContain('예산 슬라이더')
    expect(text(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-budget'))).toContain('예산')
    expect(text(byClass(view.root, 'cm-range__value'))).toBe('150만 원')
    range().props.onInput({ target: { value: '300' } })
    await flush()
    expect(byId(view.root, 'post-budget').value).toBe('300')
    expect(preset(view.root, '300만 원').props['aria-pressed']).toBe(true)
    expect(text(byClass(view.root, 'cm-range__value'))).toBe('300만 원')
    await setValue(byId(view.root, 'post-budget'), '1000')
    expect(range().props.value).toBe(500)
    expect(text(byClass(view.root, 'cm-range__value'))).toBe('1,000만 원')
    await click(preset(view.root, '50만 원'))
    expect(range().props.value).toBe(50)
    // 제목 안내는 예산·용도를 따라간다
    expect(byId(view.root, 'post-title').props.placeholder).toBe('50만 원 PC 견적 부탁드립니다')
    await setValue(byId(view.root, 'post-purpose-office'), 'office')
    expect(byId(view.root, 'post-title').props.placeholder).toBe('50만 원 사무·학습 PC 견적 부탁드립니다')
  })

  test('견적 요청: 예산 칩·용도 칩 검사 뒤 budget_krw 로 등록, 저장 중에는 잠그고 두 번 보내지 않는다', async () => {
    const view = await open({ board: 'build' })
    await setValue(byId(view.root, 'post-title'), ' 150만 원 게임용 견적 ')
    await setValue(byId(view.root, 'post-content'), '배그 QHD')
    await setValue(byId(view.root, 'post-budget'), '')
    expect(text(byClass(view.root, 'cm-range__value'))).toBe('—')
    await submit(view.root)
    expect(text(byRole(view.root, 'alert')[0]).trim()).toBe('예산을 만 원 단위로 입력해 주세요.')
    await click(preset(view.root, '150만 원'))
    expect(byId(view.root, 'post-budget').value).toBe('150')
    expect(preset(view.root, '150만 원').props['aria-pressed']).toBe(true)
    expect(preset(view.root, '100만 원').props['aria-pressed']).toBe(false)
    expect(text(view.root)).toContain('150만 원으로 등록됩니다.')
    await submit(view.root)
    expect(text(byRole(view.root, 'alert')[0]).trim()).toBe('용도를 골라 주세요.')
    expect(createCommunityPost).not.toHaveBeenCalled()
    await setValue(byId(view.root, 'post-purpose-gaming'), 'gaming')
    expect(byId(view.root, 'post-purpose-gaming').checked).toBe(true)
    expect(hasClass(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-purpose-gaming'), 'cm-chip--solid')).toBe(true)
    const response = deferred()
    createCommunityPost.mockReturnValue(response.promise)
    const form = find(view.root, (node) => node.type === 'form')
    form.props.onSubmit({ preventDefault() {} })
    form.props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createCommunityPost).toHaveBeenCalledTimes(1)
    expect(createCommunityPost).toHaveBeenCalledWith({ board: 'build', title: '150만 원 게임용 견적', content: '배그 QHD', budgetKrw: 1500000, purpose: 'gaming' })
    expect(button(view.root, '저장 중...').props.disabled).toBe(true)
    expect(fieldset(view.root).props.disabled).toBe(true)
    response.resolve({ id: 9 })
    await flush()
    expect(goToCommunityPost).toHaveBeenCalledWith(9)
  })

  test('자유 게시판 글쓰기: 제목·내용만(예산·용도 없음), 401 이면 입력을 지키고 새 탭 로그인 링크', async () => {
    createCommunityPost.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ id: 12 })
    const view = await open({ board: 'free' })
    expect(heading(view.root)).toBe('자유 게시판 글쓰기')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('free')
    expect(byId(view.root, 'post-budget')).toBeNull()
    expect(byId(view.root, 'post-purpose-gaming')).toBeNull()
    expect(link(view.root, '취소').props.href).toBe('/community/free')
    await setValue(byId(view.root, 'post-title'), '첫 조립 후기')
    await setValue(byId(view.root, 'post-content'), '선 정리가 어렵네요')
    await submit(view.root)
    expect(createCommunityPost).toHaveBeenCalledWith({ board: 'free', title: '첫 조립 후기', content: '선 정리가 어렵네요' })
    expect(text(byRole(view.root, 'alert')[0])).toContain('로그인이 만료되었습니다.')
    expect(find(view.root, (node) => node.props.href === '/login' && node.props.target === '_blank').props.rel).toBe('noopener noreferrer')
    expect(byId(view.root, 'post-title').value).toBe('첫 조립 후기')
    expect(goToCommunityPost).not.toHaveBeenCalled()
    await submit(view.root)
    expect(goToCommunityPost).toHaveBeenCalledWith(12)
  })

  test('수정: 내 견적 요청을 채우고(예산·용도 카드) 바뀐 필드만 PATCH, 아무것도 안 바꾸면 요청하지 않는다', async () => {
    fetchCommunityPost.mockResolvedValue({ ...buildDetail(), is_owner: true })
    updateCommunityPost.mockResolvedValue({ ...buildDetail(), purpose: 'creative' })
    const view = await open({ postId: 3, editing: true })
    expect(fetchCommunityPost).toHaveBeenCalledWith(3)
    expect(heading(view.root)).toBe('견적 요청 수정')
    expect(byId(view.root, 'post-title').value).toBe('150만 원 게임용 견적 부탁드립니다')
    expect(byId(view.root, 'post-budget').value).toBe('150')
    expect(byId(view.root, 'post-purpose-gaming').checked).toBe(true)
    expect(byId(view.root, 'post-purpose-creative').checked).toBe(false)
    expect(stub(view.root, 'CommunityShell').props.active).toBe('build')
    await submit(view.root)
    expect(text(byRole(view.root, 'alert')[0]).trim()).toBe('바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.')
    expect(updateCommunityPost).not.toHaveBeenCalled()
    await setValue(byId(view.root, 'post-purpose-creative'), 'creative')
    await submit(view.root)
    expect(updateCommunityPost).toHaveBeenCalledWith(3, { purpose: 'creative' })
    expect(createCommunityPost).not.toHaveBeenCalled()
    expect(goToCommunityPost).toHaveBeenCalledWith(3)
  })

  test('남의 글 수정은 403 문구와 글로 돌아가기 링크(폼 없음)', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail())
    const view = await open({ postId: 3, editing: true })
    expect(text(byRole(view.root, 'alert')[0])).toContain('본인이 작성한 글만 수정할 수 있습니다.')
    expect(find(byRole(view.root, 'alert')[0], (node) => node.type === 'a').props.href).toBe('/community/posts/3')
    expect(text(byRole(view.root, 'alert')[0])).toContain('글로 돌아가기')
    expect(byId(view.root, 'post-title')).toBeNull()
  })

  test('없는 글·잘못된 주소는 게시판 목록 링크, 서버 오류는 다시 시도', async () => {
    fetchCommunityPost.mockRejectedValueOnce({ response: { status: 404, data: { message: '글을 찾을 수 없습니다.' } } })
    const missing = await open({ postId: 404, editing: true })
    expect(text(byRole(missing.root, 'alert')[0])).toContain('글을 찾을 수 없습니다.')
    expect(link(missing.root, '게시판 목록 보기').props.href).toBe('/community')
    fetchCommunityPost.mockClear()
    const invalid = await open({ postId: null, editing: true })
    expect(text(invalid.root)).toContain('올바르지 않은 글 주소입니다.')
    expect(fetchCommunityPost).not.toHaveBeenCalled()
    fetchCommunityPost.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ ...freeDetail(), is_owner: true })
    const failed = await open({ postId: 5, editing: true })
    expect(text(byRole(failed.root, 'alert')[0])).toContain('게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(failed.root, '다시 시도'))
    expect(byId(failed.root, 'post-title')).not.toBeNull()
    expect(byId(failed.root, 'post-budget')).toBeNull()
    expect(heading(failed.root)).toBe('글 수정')
  })

  test('수정 저장이 403 이면 권한 문구를 보여 주고 입력을 지킨다', async () => {
    fetchCommunityPost.mockResolvedValue({ ...freeDetail(), is_owner: true })
    updateCommunityPost.mockRejectedValue({ response: { status: 403 } })
    const view = await open({ postId: 5, editing: true })
    await setValue(byId(view.root, 'post-content'), '바꾼 내용')
    await submit(view.root)
    expect(updateCommunityPost).toHaveBeenCalledWith(5, { content: '바꾼 내용' })
    expect(text(byRole(view.root, 'alert')[0])).toContain('본인이 작성한 글만 수정하거나 삭제할 수 있습니다.')
    expect(byId(view.root, 'post-content').value).toBe('바꾼 내용')
  })

  test('견적 요청 등록: 고른 선호 사항(화면 순서)·모니터 해상도를 함께 보낸다', async () => {
    createCommunityPost.mockResolvedValue({ id: 15, board: 'build' })
    const view = await open({ board: 'build' })
    await setValue(byId(view.root, 'post-purpose-creative'), 'creative')
    await setValue(byId(view.root, 'post-pref-white'), ['white', 'quiet'])
    expect(hasClass(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-pref-white'), 'cm-chip--on')).toBe(true)
    expect(hasClass(find(view.root, (node) => node.type === 'label' && node.props.for === 'post-pref-rgb'), 'cm-chip--on')).toBe(false)
    byId(view.root, 'post-monitor').props.onChange({ target: { value: 'uhd' } })
    await flush()
    await setValue(byId(view.root, 'post-title'), '영상 편집용')
    await setValue(byId(view.root, 'post-content'), '프리미어 4K')
    await submit(view.root)
    expect(createCommunityPost).toHaveBeenCalledWith({
      board: 'build', title: '영상 편집용', content: '프리미어 4K', budgetKrw: 1500000, purpose: 'creative', monitorResolution: 'uhd', preferences: ['quiet', 'white'],
    })
    expect(goToCommunityPost).toHaveBeenCalledWith(15)
  })

  test('수정: 모니터 해상도·선호 사항을 채우고, 그것만 바꿔도 바뀐 필드만 PATCH. 이미 해상도가 있으면 "선택 안 함"이 없다', async () => {
    fetchCommunityPost.mockResolvedValue({ ...buildDetail(), is_owner: true, monitor_resolution: 'fhd', preferences: ['rgb', 'quiet'] })
    updateCommunityPost.mockResolvedValue({ ...buildDetail(), monitor_resolution: 'qhd' })
    const view = await open({ postId: 3, editing: true })
    expect(byId(view.root, 'post-monitor').props.value).toBe('fhd')
    expect(findAll(byId(view.root, 'post-monitor'), (node) => node.type === 'option').map((node) => node.props.value)).toEqual(['fhd', 'qhd', 'uhd', 'none'])
    expect(byId(view.root, 'post-pref-quiet').checked).toBe(true)
    expect(byId(view.root, 'post-pref-rgb').checked).toBe(true)
    expect(byId(view.root, 'post-pref-white').checked).toBe(false)
    // 순서만 바뀐 선호 사항은 바뀐 것이 아니다
    await setValue(byId(view.root, 'post-pref-rgb'), ['quiet', 'rgb'])
    await submit(view.root)
    expect(updateCommunityPost).not.toHaveBeenCalled()
    expect(text(byRole(view.root, 'alert')[0]).trim()).toBe('바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.')
    byId(view.root, 'post-monitor').props.onChange({ target: { value: 'qhd' } })
    await flush()
    await submit(view.root)
    expect(updateCommunityPost).toHaveBeenLastCalledWith(3, { monitorResolution: 'qhd' })
    await setValue(byId(view.root, 'post-pref-rgb'), [])
    byId(view.root, 'post-monitor').props.onChange({ target: { value: 'fhd' } })
    await flush()
    await submit(view.root)
    expect(updateCommunityPost).toHaveBeenLastCalledWith(3, { preferences: [] })
  })

  describe('?from=cart(장바구니 구성으로 견적 요청)', () => {
    const fetchCart = jest.fn()
    let CartEditor
    beforeAll(async () => {
      CartEditor = await compileSfc('views/CommunityPostEditor.vue', { authSession, createCommunityPost, fetchCommunityPost, updateCommunityPost, goToCommunityPost, fetchCart, readCartPrefillQuery: () => true })
    })
    beforeEach(() => fetchCart.mockReset())
    const cart = { items: [{ product_id: 1, name: '라이젠7 9800X3D', price_krw: 739000, quantity: 1 }, { product_id: 7, name: 'RTX 5070 Ti', price_krw: 1290000, quantity: 2 }], item_count: 3, total_krw: 3319000 }

    test('회원이면 장바구니로 제목 "이 구성 괜찮을까요? (장바구니 N개)"·내용(상품마다 "- 이름 가격원")을 채운다', async () => {
      fetchCart.mockResolvedValue(cart)
      const view = mount(CartEditor, { board: 'build' })
      await flush()
      expect(fetchCart).toHaveBeenCalledTimes(1)
      expect(byId(view.root, 'post-title').value).toBe('이 구성 괜찮을까요? (장바구니 3개)')
      expect(byId(view.root, 'post-content').value).toBe('- 라이젠7 9800X3D 739,000원\n- RTX 5070 Ti 1,290,000원 × 2개')
      expect(text(byRole(view.root, 'status')[0])).toContain('장바구니 구성을 제목과 요청 내용에 넣었어요.')
    })

    test('장바구니를 못 불러오거나 비었으면 조용히 빈 칸 그대로, 비로그인은 부르지 않는다', async () => {
      fetchCart.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce({ items: [], item_count: 0, total_krw: 0 })
      const failed = mount(CartEditor, { board: 'build' })
      await flush()
      expect(byId(failed.root, 'post-title').value).toBe('')
      expect(byRole(failed.root, 'alert')).toEqual([])
      const empty = mount(CartEditor, { board: 'build' })
      await flush()
      expect(byId(empty.root, 'post-content').value).toBe('')
      authSession.reset()
      fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
      fetchCart.mockClear()
      mount(CartEditor, { board: 'build' })
      await flush()
      expect(fetchCart).not.toHaveBeenCalled()
    })
  })
})

describe('CommunityPostDetail', () => {
  const fetchCurrentUser = jest.fn()
  const fetchCommunityPost = jest.fn()
  const createCommunityComment = jest.fn()
  const updateCommunityComment = jest.fn()
  const deleteCommunityComment = jest.fn()
  const deleteCommunityPost = jest.fn()
  const fetchProducts = jest.fn()
  const goToCommunityBoard = jest.fn()
  const checkCompatibility = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  const mocks = [fetchCurrentUser, fetchCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, deleteCommunityPost, fetchProducts, goToCommunityBoard, checkCompatibility]
  let Detail
  beforeAll(async () => {
    Detail = await compileSfc('views/CommunityPostDetail.vue', { authSession, fetchCommunityPost, createCommunityComment, updateCommunityComment, deleteCommunityComment, deleteCommunityPost, fetchProducts, goToCommunityBoard, checkCompatibility })
  })
  beforeEach(() => {
    for (const mock of mocks) mock.mockReset()
    // 부품 호환성(견적 카드 요약·견적 보내기)은 src/compatibilityView.test.mjs 에서 확인한다. 여기서는 실제 API 대신 가짜 결과만 넣는다
    checkCompatibility.mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: ['cpu', 'gpu'] })
    fetchCurrentUser.mockResolvedValue({ id: 11, name: '댓글러11' })
    fetchCommunityPost.mockResolvedValue(buildDetail())
    authSession.reset()
  })
  async function open(postId = 3) {
    const view = mount(Detail, { postId })
    await flush()
    return view
  }
  const section = (root, id) => find(root, (node) => node.type === 'section' && node.props['aria-labelledby'] === id)
  const quotesOf = (root) => section(root, 'quotes-title')
  const commentsOf = (root) => section(root, 'comments-title')
  const sendOf = (root) => section(root, 'send-title')
  const quoteCards = (root) => findAll(quotesOf(root), (node) => node.type === 'li' && node.props.class === 'cm-quote')
  const commentItems = (root) => findAll(commentsOf(root), (node) => node.type === 'li' && node.props.class === 'cm-comment')
  const newForm = (root) => find(root, (node) => node.type === 'form' && Boolean(find(node, (child) => child.props.id === 'comment-content')))
  const actions = (root) => byClass(root, 'cm-post__actions')

  test('로딩 → 오류 → 다시 시도 → 본문', async () => {
    const first = deferred()
    fetchCommunityPost.mockReturnValueOnce(first.promise)
    const view = mount(Detail, { postId: 3 })
    await flush()
    expect(text(byRole(view.root, 'status')[0])).toBe('글을 불러오는 중입니다...')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('')
    first.reject({ isAxiosError: true, code: 'ERR_NETWORK' })
    await flush()
    expect(text(byRole(view.root, 'alert')[0])).toContain('게시글을 불러오지 못했습니다. 다시 시도해 주세요.')
    await click(button(view.root, '다시 시도'))
    expect(text(view.root)).toContain('150만 원 게임용 견적 부탁드립니다')
    expect(stub(view.root, 'SiteLayout').props['active-page']).toBe('community')
    expect(stub(view.root, 'CommunityShell').props.active).toBe('build')
  })

  test('없는 글은 404 문구 + 게시판 목록 링크, 잘못된 주소는 API 를 부르지 않는다', async () => {
    fetchCommunityPost.mockRejectedValueOnce({ response: { status: 404, data: { message: '글을 찾을 수 없습니다.' } } })
    const missing = await open(404)
    expect(text(byRole(missing.root, 'alert')[0])).toContain('글을 찾을 수 없습니다.')
    expect(link(byRole(missing.root, 'alert')[0], '게시판 목록 보기').props.href).toBe('/community')
    expect(button(missing.root, '다시 시도')).toBeNull()
    expect(fetchCurrentUser).not.toHaveBeenCalled()
    fetchCommunityPost.mockClear()
    const invalid = await open(null)
    expect(text(invalid.root)).toContain('올바르지 않은 글 주소입니다.')
    expect(fetchCommunityPost).not.toHaveBeenCalled()
  })

  test('견적 글: ← 견적 게시판, 견적 요청 카드(상태 알약·제목·글쓴이 · 날짜·예산/용도/모니터/선호 4칸·요청 내용), 남의 글이면 수정·삭제 없음', async () => {
    const view = await open()
    expect(link(view.root, '견적 게시판').props.href).toBe('/community/build')
    expect(hasClass(link(view.root, '견적 게시판'), 'cm-back')).toBe(true)
    const request = byClass(view.root, 'cm-request')
    expect(text(byClass(request, 'cm-post__kicker'))).toBe('견적 게시판견적 1개')
    expect(hasClass(byClass(request, 'cm-pill'), 'cm-pill--on')).toBe(true)
    expect(text(find(request, (node) => node.type === 'h1'))).toBe('150만 원 게임용 견적 부탁드립니다')
    expect(text(byClass(request, 'cm-post__byline'))).toBe('민지2026.11.01 12:00')
    expect(text(find(request, (node) => node.type === 'dl'))).toBe('예산150만 원용도게임모니터정하지 않음선호선호 없음')
    expect(text(byClass(request, 'cm-request__fact--budget'))).toBe('예산150만 원')
    expect(text(byClass(request, 'cm-post__body'))).toBe('배그·로아를 QHD 로 즐기고 싶습니다.\n모니터는 있습니다.')
    expect(link(actions(view.root), '목록').props.href).toBe('/community/build')
    expect(find(view.root, (node) => node.props.href === '/community/posts/3/edit')).toBeNull()
  })

  test('견적 요청 카드의 모니터·선호는 이름으로(선호는 화면 순서, 모르는 값은 버림)', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ monitor_resolution: 'qhd', preferences: ['rgb', 'quiet', 'neon'], comments: [] }))
    const view = await open()
    expect(text(find(view.root, (node) => node.type === 'dl'))).toBe('예산150만 원용도게임모니터QHD (2560×1440)선호조용한 PC · RGB')
    expect(text(byClass(view.root, 'cm-post__kicker'))).toBe('견적 게시판견적 대기')
  })

  test('받은 견적: 부품 목록이 있는 댓글만 견적 카드(아바타·글쓴이·날짜, 예산 배지, 합계 + 예산 사용 막대, 부품 줄, 설명), 나머지는 댓글 영역', async () => {
    const view = await open()
    expect(text(find(quotesOf(view.root), (node) => node.type === 'h2'))).toBe('받은 견적 1개')
    expect(text(byClass(quotesOf(view.root), 'cm-section-help'))).toBe('금액은 지금 MOA Parts 판매가 기준 · 가격이 바뀌면 합계도 바뀌어요')
    const [card] = quoteCards(view.root)
    expect(text(byClass(card, 'cm-comment__head'))).toBe('조립왕2026.11.01 12:00')
    expect(byClass(card, 'cm-avatar').props['aria-hidden']).toBe('true')
    expect(text(byClass(card, 'cm-avatar'))).toBe('조')
    expect(text(byClass(card, 'cm-quote__total'))).toBe('견적 합계2,029,000원')
    const badge = byClass(card, 'cm-gap')
    expect(text(badge)).toBe('예산 초과 · 529,000원')
    expect(hasClass(badge, 'cm-gap--over')).toBe(true)
    // 예산 사용: 2,029,000 ÷ 1,500,000 = 135%(막대는 100% 에서 멈추고 글자가 실제 비율을 말한다)
    expect(text(byClass(card, 'cm-usage__labels'))).toBe('예산 사용135% / 150만 원')
    const track = byClass(card, 'cm-usage__track')
    expect(track.props).toMatchObject({ role: 'img', 'aria-label': '예산 150만 원 중 135% 사용(예산 초과)' })
    expect(byClass(card, 'cm-usage__bar').props.style).toEqual({ width: '100%' })
    expect(hasClass(byClass(card, 'cm-usage__bar'), 'cm-usage__bar--over')).toBe(true)
    const table = stub(card, 'CommunityPartsTable')
    expect(table.props.items).toEqual([cpuItem, gpuItem])
    expect(table.props.total).toBe(2029000)
    expect(table.props['show-note']).toBe(false)
    expect(table.props['show-total']).toBe(false)
    expect(table.props.caption).toBe('조립왕님의 부품 목록')
    expect(text(byClass(card, 'cm-quote__body'))).toBe('이렇게 맞춰 보세요')
    expect(button(card, '수정')).toBeNull()
    expect(text(find(commentsOf(view.root), (node) => node.type === 'h2'))).toBe('댓글 1')
    const [mine] = commentItems(view.root)
    expect(text(mine)).toContain('저도 궁금합니다')
    expect(text(mine)).toContain('수정됨')
    expect(stub(mine, 'CommunityPartsTable')).toBeNull()
    expect(button(mine, '수정')).not.toBeNull()
  })

  test.each([
    ['예산보다 싸면 남는 금액', -310000, '예산 안 · 310,000원 남음', 'cm-gap--under'],
    ['예산과 같으면 딱 맞음', 0, '예산에 딱 맞음', 'cm-gap--exact'],
  ])('예산 비교 배지는 서버의 budget_gap_krw 그대로: %s', async (_name, gap, label, tone) => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10, { budget_gap_krw: gap })] }))
    const view = await open()
    const badge = byClass(quoteCards(view.root)[0], 'cm-gap')
    expect(text(badge)).toBe(label)
    expect(hasClass(badge, tone)).toBe(true)
  })

  test('budget_gap_krw 가 없으면 배지를 그리지 않고, 견적·댓글이 없으면 각각 안내', async () => {
    fetchCommunityPost.mockResolvedValueOnce(buildDetail({ comments: [quote(10, { budget_gap_krw: null })] }))
    const view = await open()
    expect(byClass(quoteCards(view.root)[0], 'cm-gap')).toBeNull()
    expect(text(commentsOf(view.root))).toContain('아직 댓글이 없습니다.')
    fetchCommunityPost.mockResolvedValueOnce(buildDetail({ comments: [] }))
    const empty = await open()
    expect(text(quotesOf(empty.root))).toContain('아직 받은 견적이 없습니다.')
    expect(text(byClass(empty.root, 'cm-post__kicker'))).toBe('견적 게시판견적 대기')
  })

  test('견적 보내기 · 댓글 폼: 부품 고르기가 먼저, 그다음 설명. 고른 부품이 없으면 "댓글 등록", 있으면 "견적 보내기"', async () => {
    const view = await open()
    const submitButton = () => find(newForm(view.root), (node) => node.type === 'button' && node.props.type === 'submit')
    expect(text(find(sendOf(view.root), (node) => node.type === 'h2'))).toBe('견적 보내기 · 댓글')
    const form = newForm(view.root)
    const fieldsetNode = find(form, (node) => node.type === 'fieldset')
    const order = elements(fieldsetNode).map((node) => (node.props['data-stub'] === 'CommunityPartsPicker' ? 'picker' : find(node, (child) => child.props.id === 'comment-content') ? 'content' : node.type))
    expect(order).toEqual(['picker', 'content'])
    const picker = () => stub(newForm(view.root), 'CommunityPartsPicker')
    expect(picker().props['id-prefix']).toBe('comment-new-parts')
    expect(picker().props['budget-krw']).toBe(1500000)
    expect(text(find(form, (node) => node.type === 'label' && node.props.for === 'comment-content'))).toContain('설명')
    expect(text(submitButton())).toBe('댓글 등록')
    picker().props['onUpdate:modelValue']([{ product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 1 }])
    await flush()
    expect(text(submitButton())).toBe('견적 보내기')
  })

  test('비로그인이면 견적 보내기 폼 대신 로그인 안내', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const view = await open()
    expect(text(sendOf(view.root))).toContain('로그인한 후 글을 쓸 수 있습니다.')
    expect(link(sendOf(view.root), '로그인').props.href).toBe('/login')
    expect(newForm(view.root)).toBeNull()
  })

  test('내 글: 수정 링크, 삭제는 화면 안 확인(아니요 → 실패 → 다시 예 → 게시판으로 이동)', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ is_owner: true }))
    const view = await open()
    expect(link(actions(view.root), '수정').props.href).toBe('/community/posts/3/edit')
    await click(button(actions(view.root), '삭제'))
    await stub(actions(view.root), 'InlineConfirm').props.onCancel()
    await flush()
    expect(deleteCommunityPost).not.toHaveBeenCalled()
    deleteCommunityPost.mockRejectedValueOnce({ response: { status: 500 } })
    await click(button(actions(view.root), '삭제'))
    await stub(actions(view.root), 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(view.root)).toContain('글을 삭제하지 못했습니다. 다시 시도해 주세요.')
    expect(stub(actions(view.root), 'InlineConfirm').props.busy).toBe(false)
    expect(goToCommunityBoard).not.toHaveBeenCalled()
    deleteCommunityPost.mockResolvedValueOnce(null)
    await stub(actions(view.root), 'InlineConfirm').props.onConfirm()
    await flush()
    expect(deleteCommunityPost).toHaveBeenLastCalledWith(3)
    expect(goToCommunityBoard).toHaveBeenCalledWith('build')
  })

  test('견적 보내기: 고른 부품(product_id·quantity)과 설명을 보내고, 저장 중 잠금, 성공하면 받은 견적에 붙이고 비운다', async () => {
    const view = await open()
    const picker = () => stub(newForm(view.root), 'CommunityPartsPicker')
    const lines = [{ product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 739000, stock: 12, quantity: 2 }]
    picker().props['onUpdate:modelValue'](lines)
    await flush()
    expect(picker().props.modelValue).toEqual(lines)
    await setValue(byId(view.root, 'comment-content'), '  CPU 는 이걸로  ')
    const response = deferred()
    createCommunityComment.mockReturnValue(response.promise)
    newForm(view.root).props.onSubmit({ preventDefault() {} })
    newForm(view.root).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createCommunityComment).toHaveBeenCalledTimes(1)
    expect(createCommunityComment).toHaveBeenCalledWith(3, { content: '  CPU 는 이걸로  ', items: [{ product_id: 1, quantity: 2 }] })
    expect(button(newForm(view.root), '저장 중...').props.disabled).toBe(true)
    expect(find(newForm(view.root), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    expect(picker().props.disabled).toBe(true)
    response.resolve(quote(12, { is_owner: true, author: author(11, '댓글러11'), content: 'CPU 는 이걸로', items: [{ ...cpuItem, quantity: 2, line_total_krw: 1478000 }], items_total_krw: 1478000, budget_gap_krw: -22000 }))
    await flush()
    expect(quoteCards(view.root)).toHaveLength(2)
    expect(text(byClass(quoteCards(view.root)[1], 'cm-gap'))).toBe('예산 안 · 22,000원 남음')
    expect(stub(quoteCards(view.root)[1], 'CommunityPartsTable').props.total).toBe(1478000)
    expect(byId(view.root, 'comment-content').value).toBe('')
    expect(picker().props.modelValue).toEqual([])
    expect(text(byRole(quotesOf(view.root), 'status')[0])).toBe('견적을 보냈습니다.')
    expect(byRole(commentsOf(view.root), 'status')).toEqual([])
  })

  test('부품 없이 등록하면 댓글 영역에 붙는다', async () => {
    createCommunityComment.mockResolvedValue(comment(13, { is_owner: true, content: '모니터 해상도는요?' }))
    const view = await open()
    await setValue(byId(view.root, 'comment-content'), '모니터 해상도는요?')
    await submit(newForm(view.root))
    expect(createCommunityComment).toHaveBeenCalledWith(3, { content: '모니터 해상도는요?', items: [] })
    expect(quoteCards(view.root)).toHaveLength(1)
    expect(commentItems(view.root)).toHaveLength(2)
    expect(text(byRole(commentsOf(view.root), 'status')[0])).toBe('댓글이 등록되었습니다.')
  })

  test('빈 설명은 요청하지 않고, 실패(422)하면 서버 문구와 함께 입력·부품을 지킨다', async () => {
    const view = await open()
    await submit(newForm(view.root))
    expect(createCommunityComment).not.toHaveBeenCalled()
    expect(text(byRole(newForm(view.root), 'alert')[0]).trim()).toBe('댓글 내용을 입력해 주세요.')
    const lines = [{ product_id: 99, name: '단종 부품', brand: 'X', category: 'cpu', thumbnail_url: '', price_krw: 1000, stock: 1, quantity: 1 }]
    stub(newForm(view.root), 'CommunityPartsPicker').props['onUpdate:modelValue'](lines)
    await setValue(byId(view.root, 'comment-content'), '이 부품 추천')
    createCommunityComment.mockRejectedValueOnce({ response: { status: 422, data: { message: '목록에 없는 상품이 있습니다. 상품을 다시 골라 주세요.' } } })
    await submit(newForm(view.root))
    expect(text(byRole(newForm(view.root), 'alert')[0]).trim()).toBe('목록에 없는 상품이 있습니다. 상품을 다시 골라 주세요.')
    expect(byId(view.root, 'comment-content').value).toBe('이 부품 추천')
    expect(stub(newForm(view.root), 'CommunityPartsPicker').props.modelValue).toEqual(lines)
  })

  test('부품 고르기가 카테고리 상품을 요청하면 GET /products(page_size 50)를 한 번만 부르고, 실패하면 다시 시도할 수 있다', async () => {
    fetchProducts.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue({ items: [{ id: 1, name: '라이젠7 9800X3D' }], total: 1, page: 1, page_size: 50 })
    const view = await open()
    const picker = () => stub(newForm(view.root), 'CommunityPartsPicker')
    await picker().props.onRequestProducts('cpu')
    await flush()
    expect(fetchProducts).toHaveBeenCalledWith({ category: 'cpu', pageSize: 50 })
    expect(picker().props.catalog.cpu).toEqual({ status: 'error', items: [], error: '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.' })
    await picker().props.onRequestProducts('cpu')
    await flush()
    expect(picker().props.catalog.cpu).toEqual({ status: 'ready', items: [{ id: 1, name: '라이젠7 9800X3D' }], error: '' })
    await picker().props.onRequestProducts('cpu')
    await flush()
    expect(fetchProducts).toHaveBeenCalledTimes(2)
  })

  test('내 견적 수정: 부품을 채운 고르기(예산 함께), 바뀐 필드(부품 목록 전체)만 보내고, 바뀐 게 없으면 요청하지 않는다', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10, { is_owner: true })] }))
    updateCommunityComment.mockResolvedValue(quote(10, { is_owner: true, items: [gpuItem], items_total_krw: 1290000, budget_gap_krw: -210000, updated_at: '2026-11-02T03:00:00Z' }))
    const view = await open()
    await click(button(quoteCards(view.root)[0], '수정'))
    const editForm = () => find(quoteCards(view.root)[0], (node) => node.type === 'form')
    const picker = () => stub(editForm(), 'CommunityPartsPicker')
    expect(byId(view.root, 'comment-edit-10').value).toBe('이렇게 맞춰 보세요')
    expect(picker().props['id-prefix']).toBe('comment-edit-10-parts')
    expect(picker().props['budget-krw']).toBe(1500000)
    expect(picker().props.modelValue.map((line) => [line.product_id, line.quantity])).toEqual([[1, 1], [7, 1]])
    await submit(editForm())
    expect(text(byRole(editForm(), 'alert')[0]).trim()).toBe('바뀐 내용이 없습니다. 고칠 내용을 입력한 뒤 저장해 주세요.')
    expect(updateCommunityComment).not.toHaveBeenCalled()
    picker().props['onUpdate:modelValue'](picker().props.modelValue.slice(1))
    await flush()
    await submit(editForm())
    expect(updateCommunityComment).toHaveBeenCalledWith(10, { items: [{ product_id: 7, quantity: 1 }] })
    expect(editForm()).toBeNull()
    expect(stub(quoteCards(view.root)[0], 'CommunityPartsTable').props.total).toBe(1290000)
    expect(text(byClass(quoteCards(view.root)[0], 'cm-gap'))).toBe('예산 안 · 210,000원 남음')
    expect(text(quoteCards(view.root)[0])).toContain('수정됨')
    expect(text(byRole(quotesOf(view.root), 'status')[0])).toBe('견적이 수정되었습니다.')
  })

  test('견적에서 부품을 모두 빼면 댓글 영역으로 옮겨 간다', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10, { is_owner: true })] }))
    updateCommunityComment.mockResolvedValue(comment(10, { is_owner: true, author: author(9, '조립왕'), content: '이렇게 맞춰 보세요', items: [], items_total_krw: 0, budget_gap_krw: null }))
    const view = await open()
    await click(button(quoteCards(view.root)[0], '수정'))
    const editForm = find(quoteCards(view.root)[0], (node) => node.type === 'form')
    stub(editForm, 'CommunityPartsPicker').props['onUpdate:modelValue']([])
    await flush()
    await submit(find(quoteCards(view.root)[0], (node) => node.type === 'form'))
    expect(updateCommunityComment).toHaveBeenCalledWith(10, { items: [] })
    expect(quoteCards(view.root)).toHaveLength(0)
    expect(commentItems(view.root)).toHaveLength(1)
    expect(text(byRole(commentsOf(view.root), 'status')[0])).toBe('댓글이 수정되었습니다.')
  })

  test('댓글 수정이 403 이면 권한 문구, 입력은 그대로', async () => {
    updateCommunityComment.mockRejectedValue({ response: { status: 403 } })
    const view = await open()
    await click(button(commentItems(view.root)[0], '수정'))
    await setValue(byId(view.root, 'comment-edit-11'), '고친 댓글')
    await submit(find(commentItems(view.root)[0], (node) => node.type === 'form'))
    expect(updateCommunityComment).toHaveBeenCalledWith(11, { content: '고친 댓글' })
    expect(text(commentItems(view.root)[0])).toContain('본인이 작성한 댓글만 수정하거나 삭제할 수 있습니다.')
    expect(byId(view.root, 'comment-edit-11').value).toBe('고친 댓글')
  })

  test('내 댓글 삭제: 화면 안 확인, 실패하면 문구, 성공하면 목록에서 뺀다', async () => {
    deleteCommunityComment.mockRejectedValueOnce({ response: { status: 404, data: { message: '댓글을 찾을 수 없습니다.' } } }).mockResolvedValueOnce(null)
    const view = await open()
    await click(button(commentItems(view.root)[0], '삭제'))
    expect(stub(commentItems(view.root)[0], 'InlineConfirm').props.message).toBe('이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없습니다.')
    await stub(commentItems(view.root)[0], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(commentItems(view.root)[0])).toContain('댓글을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.')
    await stub(commentItems(view.root)[0], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(deleteCommunityComment).toHaveBeenLastCalledWith(11)
    expect(commentItems(view.root)).toHaveLength(0)
    expect(quoteCards(view.root)).toHaveLength(1)
    expect(text(byRole(commentsOf(view.root), 'status')[0])).toBe('댓글이 삭제되었습니다.')
  })

  test('내 견적 삭제는 견적 문구로 확인한다', async () => {
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10, { is_owner: true })] }))
    deleteCommunityComment.mockResolvedValue(null)
    const view = await open()
    await click(button(quoteCards(view.root)[0], '삭제'))
    expect(stub(quoteCards(view.root)[0], 'InlineConfirm').props.message).toBe('이 견적을 삭제할까요? 삭제한 견적은 되돌릴 수 없습니다.')
    await stub(quoteCards(view.root)[0], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(quoteCards(view.root)).toHaveLength(0)
    expect(text(byRole(quotesOf(view.root), 'status')[0])).toBe('견적이 삭제되었습니다.')
  })

  test('자유 글(일반 게시판 모양): 게시판 링크·제목·글쓴이·날짜·댓글 수 줄, 견적 영역·부품 표·고르기 없음, 댓글은 items 없이. 401 이면 새 탭 로그인 링크', async () => {
    fetchCommunityPost.mockResolvedValue(freeDetail())
    createCommunityComment.mockRejectedValueOnce({ response: { status: 401 } })
    const view = await open(5)
    expect(link(view.root, '자유 게시판').props.href).toBe('/community/free')
    expect(text(byClass(view.root, 'cm-post__meta'))).toBe('민지2026.11.01 12:00댓글 1')
    expect(byClass(view.root, 'cm-request')).toBeNull()
    expect(quotesOf(view.root)).toBeNull()
    expect(find(view.root, (node) => node.type === 'dl')).toBeNull()
    expect(stub(view.root, 'CommunityPartsTable')).toBeNull()
    expect(stub(view.root, 'CommunityPartsPicker')).toBeNull()
    expect(stub(view.root, 'CommunityShell').props.active).toBe('free')
    expect(link(actions(view.root), '목록').props.href).toBe('/community/free')
    expect(text(find(sendOf(view.root), (node) => node.type === 'h2'))).toBe('댓글 쓰기')
    expect(find(sendOf(view.root), (node) => node.type === 'h2').props.class).toBe('sr-only')
    expect(text(find(newForm(view.root), (node) => node.type === 'label' && node.props.for === 'comment-content'))).toContain('댓글 남기기')
    await setValue(byId(view.root, 'comment-content'), '좋은 후기네요')
    await submit(newForm(view.root))
    expect(createCommunityComment).toHaveBeenCalledWith(5, { content: '좋은 후기네요', items: [] })
    expect(text(newForm(view.root))).toContain('로그인이 만료되었습니다.')
    expect(find(newForm(view.root), (node) => node.props.href === '/login' && node.props.target === '_blank')).toBeTruthy()
    expect(byId(view.root, 'comment-content').value).toBe('좋은 후기네요')
  })

  test('자유 글에 댓글이 없으면 첫 댓글 안내', async () => {
    fetchCommunityPost.mockResolvedValue(freeDetail({ comments: [] }))
    const view = await open(5)
    expect(text(commentsOf(view.root))).toContain('아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.')
  })
})

describe('CommunityPostDetail: 받은 견적 장바구니에 담기', () => {
  // spec docs/specs/2026-11-01-build-id-purpose.md "화면": 비로그인·담는 중·성공·일부 제외·실패(다시 시도)·401(로그인 안내). 결과는 카드 안에 보인다
  const BUILD_ID = '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7'
  const fetchCurrentUser = jest.fn()
  const fetchCommunityPost = jest.fn()
  const addBuildToCart = jest.fn()
  const checkCompatibility = jest.fn()
  const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
  const authSession = createAuthSession({ fetchCurrentUser })
  const mine = quote(12, { author: author(11, '댓글러11'), is_owner: true, items: [cpuItem], items_total_krw: 739000, budget_gap_krw: -761000 })
  const result = (extra = {}) => ({
    build_id: BUILD_ID, post_id: 3, comment_id: 10,
    added: [{ product_id: 1, quantity: 1 }, { product_id: 7, quantity: 1 }], skipped: [],
    cart: { items: [], item_count: 2, total_krw: 2029000 }, ...extra,
  })
  let Detail
  beforeAll(async () => {
    Detail = await compileSfc('views/CommunityPostDetail.vue', { authSession, fetchCommunityPost, addBuildToCart, checkCompatibility, siteStatus, fetchProducts: jest.fn().mockResolvedValue({ items: [] }) })
  })
  beforeEach(() => {
    for (const mock of [fetchCurrentUser, fetchCommunityPost, addBuildToCart, checkCompatibility, ...Object.values(siteStatus)]) mock.mockReset()
    checkCompatibility.mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: ['cpu', 'gpu'] })
    fetchCurrentUser.mockResolvedValue({ id: 11, name: '댓글러11' })
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10), mine, comment(11)] }))
    authSession.reset()
  })
  async function open() {
    const view = mount(Detail, { postId: 3 })
    await flush()
    return view
  }
  const cards = (root) => findAll(root, (node) => node.type === 'li' && node.props.class === 'cm-quote')
  const cartArea = (card) => byClass(card, 'cm-quote__cart')
  const addButton = (card) => find(cartArea(card), (node) => node.type === 'button' && /담기|담는 중/.test(text(node)))

  test('로그인하면 받은 견적 카드마다(내 견적 포함) "전체 장바구니에 담기" 버튼, 댓글에는 없다', async () => {
    const view = await open()
    expect(cards(view.root)).toHaveLength(2)
    for (const card of cards(view.root)) {
      expect(text(addButton(card))).toBe('전체 장바구니에 담기')
      expect(addButton(card).props.type).toBe('button')
      expect(addButton(card).props.disabled).toBe(false)
    }
    expect(byClass(byClass(view.root, 'cm-comments'), 'cm-quote__cart')).toBeNull()
    expect(addBuildToCart).not.toHaveBeenCalled()
  })

  test('비로그인(401)이면 버튼 대신 "로그인하면 장바구니에 담을 수 있습니다." 와 로그인 링크', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const view = await open()
    for (const card of cards(view.root)) {
      expect(text(byClass(cartArea(card), 'cm-quote__cart-guest'))).toBe('로그인하면 장바구니에 담을 수 있습니다. 로그인')
      expect(link(cartArea(card), '로그인').props.href).toBe('/login')
      expect(addButton(card)).toBeNull()
    }
  })

  test('로그인 여부를 확인하는 동안에는 버튼도 로그인 안내도 그리지 않는다', async () => {
    const pending = deferred()
    fetchCurrentUser.mockReturnValue(pending.promise)
    const view = await open()
    expect(cartArea(cards(view.root)[0])).toBeNull()
    pending.resolve({ id: 11, name: '댓글러11' })
    await flush()
    expect(text(addButton(cards(view.root)[0]))).toBe('전체 장바구니에 담기')
  })

  test('담는 중: 그 카드의 버튼만 비활성화 + "담는 중...", 두 번 보내지 않는다 → 성공하면 카드 안 status 와 장바구니 보기 링크', async () => {
    const response = deferred()
    addBuildToCart.mockReturnValue(response.promise)
    const view = await open()
    const [first] = cards(view.root)
    addButton(first).props.onClick()
    addButton(first).props.onClick()
    await flush()
    expect(addBuildToCart).toHaveBeenCalledTimes(1)
    expect(addBuildToCart).toHaveBeenCalledWith(10)
    expect(text(addButton(cards(view.root)[0]))).toBe('담는 중...')
    expect(addButton(cards(view.root)[0]).props.disabled).toBe(true)
    expect(addButton(cards(view.root)[1]).props.disabled).toBe(false)
    response.resolve(result())
    await flush()
    const card = cards(view.root)[0]
    const [status] = byRole(card, 'status')
    expect(text(status)).toBe('부품 2개를 장바구니에 담았습니다. 장바구니 보기')
    expect(link(status, '장바구니 보기').props.href).toBe('/cart')
    expect(text(addButton(card))).toBe('전체 장바구니에 담기')
    expect(addButton(card).props.disabled).toBe(false)
    expect(byRole(cards(view.root)[1], 'status')).toHaveLength(0)
    // 헤더 장바구니 수는 서버 응답(cart.item_count) 그대로, 토스트는 담은 줄 수
    expect(siteStatus.setCartCount).toHaveBeenCalledWith(2)
    expect(siteStatus.showToast).toHaveBeenCalledWith('부품 2개를 장바구니에 담았어요')
  })

  test('일부 제외: 뺀 부품을 이유별로 "(품절 1개, 최대 수량 1개 제외)" 처럼 함께 보여 준다', async () => {
    addBuildToCart.mockResolvedValue(result({ comment_id: 12, added: [{ product_id: 1, quantity: 1 }], skipped: [{ product_id: 7, reason: 'sold_out' }, { product_id: 6, reason: 'limit' }] }))
    const view = await open()
    await click(addButton(cards(view.root)[1]))
    expect(addBuildToCart).toHaveBeenCalledWith(12)
    expect(text(byRole(cards(view.root)[1], 'status')[0])).toBe('부품 1개를 장바구니에 담았습니다. (품절 1개, 최대 수량 1개 제외) 장바구니 보기')
  })

  test('실패(500): 카드 안 alert + 다시 시도(버튼은 숨김) → 다시 시도가 성공하면 결과로 바뀐다. 본문은 그대로', async () => {
    addBuildToCart.mockRejectedValueOnce({ response: { status: 500, data: { message: 'Internal Server Error' } } }).mockResolvedValueOnce(result())
    const view = await open()
    await click(addButton(cards(view.root)[0]))
    const card = cards(view.root)[0]
    const [alert] = byRole(card, 'alert')
    expect(text(alert)).toContain('견적을 장바구니에 담지 못했습니다. 다시 시도해 주세요.')
    expect(addButton(card)).toBeNull()
    expect(find(alert, (node) => node.props.href === '/login')).toBeNull()
    expect(text(card)).toContain('견적 합계')
    await click(button(alert, '다시 시도'))
    expect(addBuildToCart).toHaveBeenCalledTimes(2)
    expect(siteStatus.setCartCount).toHaveBeenCalledTimes(1)
    expect(byRole(cards(view.root)[0], 'alert')).toHaveLength(0)
    expect(text(byRole(cards(view.root)[0], 'status')[0])).toContain('부품 2개를 장바구니에 담았습니다.')
  })

  test('409(담을 수 있는 부품 없음)는 서버 문구를 그대로 보여 준다', async () => {
    addBuildToCart.mockRejectedValue({ response: { status: 409, data: { message: '담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.' } } })
    const view = await open()
    await click(addButton(cards(view.root)[0]))
    expect(text(byRole(cards(view.root)[0], 'alert')[0])).toContain('담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.')
  })

  test('401(로그인 만료): 로그인 안내와 새 탭 로그인 링크, 다시 시도', async () => {
    addBuildToCart.mockRejectedValue({ response: { status: 401, data: { message: '로그인이 필요합니다.' } } })
    const view = await open()
    await click(addButton(cards(view.root)[0]))
    const [alert] = byRole(cards(view.root)[0], 'alert')
    expect(text(alert)).toContain('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
    const login = link(alert, '새 탭에서 다시 로그인')
    expect(login.props).toMatchObject({ href: '/login', target: '_blank', rel: 'noopener noreferrer' })
    expect(button(alert, '다시 시도')).not.toBeNull()
  })

  test('견적을 지우면 그 카드의 담기 결과도 함께 없어진다', async () => {
    addBuildToCart.mockResolvedValue(result({ comment_id: 12 }))
    const deleteCommunityComment = jest.fn().mockResolvedValue(null)
    const View = await compileSfc('views/CommunityPostDetail.vue', { authSession, fetchCommunityPost, addBuildToCart, checkCompatibility, deleteCommunityComment, siteStatus, fetchProducts: jest.fn().mockResolvedValue({ items: [] }) })
    const view = mount(View, { postId: 3 })
    await flush()
    await click(addButton(cards(view.root)[1]))
    expect(byRole(cards(view.root)[1], 'status')).toHaveLength(1)
    await click(button(cards(view.root)[1], '삭제'))
    await stub(cards(view.root)[1], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(cards(view.root)).toHaveLength(1)
    expect(deleteCommunityComment).toHaveBeenCalledWith(12)
    expect(findAll(view.root, (node) => String(node.props.class || '').includes('cm-quote__cart-result'))).toHaveLength(0)
  })
})

describe('CommunityPostDetail: 핵심 부품 비교·장바구니 구성으로 견적 보내기', () => {
  const fetchCurrentUser = jest.fn()
  const fetchCommunityPost = jest.fn()
  const checkCompatibility = jest.fn()
  const fetchCart = jest.fn()
  const goToCompare = jest.fn()
  const track = jest.fn()
  const siteStatus = { setCartCount: jest.fn(), setCompareCount: jest.fn(), showToast: jest.fn() }
  const authSession = createAuthSession({ fetchCurrentUser })
  // 비교함 저장소(localStorage moa.compare)를 흉내 낸다. available=false 면 쓸 수 없는 브라우저
  let stored = null
  let available = true
  const browserCompareStorage = () => ({ available, get: () => stored, set: (value) => { stored = value; return true } })
  const mocks = [fetchCurrentUser, fetchCommunityPost, checkCompatibility, fetchCart, goToCompare, track, ...Object.values(siteStatus)]
  let Detail
  beforeAll(async () => {
    Detail = await compileSfc('views/CommunityPostDetail.vue', {
      authSession, fetchCommunityPost, checkCompatibility, fetchCart, goToCompare, track, siteStatus, browserCompareStorage, fetchProducts: jest.fn().mockResolvedValue({ items: [] }),
    })
  })
  beforeEach(() => {
    for (const mock of mocks) mock.mockReset()
    stored = null
    available = true
    checkCompatibility.mockResolvedValue({ status: 'ok', issues: [], balance: null, power: null, categories: ['cpu', 'gpu'] })
    fetchCurrentUser.mockResolvedValue({ id: 11, name: '댓글러11' })
    fetchCommunityPost.mockResolvedValue(buildDetail())
    authSession.reset()
  })
  async function open() {
    const view = mount(Detail, { postId: 3 })
    await flush()
    return view
  }
  const cards = (root) => findAll(root, (node) => node.type === 'li' && node.props.class === 'cm-quote')
  const newForm = (root) => find(root, (node) => node.type === 'form' && Boolean(find(node, (child) => child.props.id === 'comment-content')))
  const events = (type) => track.mock.calls.filter(([name]) => name === type).map(([, props]) => props)

  test('핵심 부품 비교: CPU·그래픽카드·메인보드 중 금액이 가장 큰 카테고리(여기선 그래픽카드)로 비교함을 바꾸고 /compare 로 간다', async () => {
    stored = JSON.stringify({ category: 'cpu', items: [{ id: 2, name: '코어 울트라7 265K', category: 'cpu', thumbnail_url: '' }] })
    const view = await open()
    await click(button(cards(view.root)[0], '핵심 부품 비교'))
    expect(JSON.parse(stored)).toEqual({ category: 'gpu', items: [{ id: 7, name: gpuItem.name, category: 'gpu', thumbnail_url: gpuItem.thumbnail_url }] })
    expect(events('compare_clear')).toEqual([{ category: 'cpu', product_ids: [2], reason: 'user' }])
    expect(events('compare_add')).toEqual([{ product_id: 7, category: 'gpu', count: 1, source: 'quote' }])
    expect(siteStatus.setCompareCount).toHaveBeenCalledWith(1)
    expect(goToCompare).toHaveBeenCalledTimes(1)
  })

  test('핵심 부품이 없는 견적에는 비교 버튼이 없고, 비교함을 쓸 수 없는 브라우저면 카드 안 alert(이동하지 않음)', async () => {
    const psu = { ...cpuItem, product_id: 200, name: '파워 850W', category: 'psu' }
    fetchCommunityPost.mockResolvedValue(buildDetail({ comments: [quote(10), quote(13, { items: [psu], items_total_krw: 739000, budget_gap_krw: -761000 })] }))
    available = false
    const view = await open()
    expect(button(cards(view.root)[1], '핵심 부품 비교')).toBeNull()
    await click(button(cards(view.root)[0], '핵심 부품 비교'))
    expect(text(byRole(cards(view.root)[0], 'alert')[0])).toContain('이 브라우저에서는 비교함을 쓸 수 없습니다.')
    expect(goToCompare).not.toHaveBeenCalled()
    expect(events('compare_add')).toEqual([])
  })

  test('비로그인도 핵심 부품 비교는 할 수 있다(장바구니 담기 대신 로그인 안내)', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const view = await open()
    expect(text(byClass(cards(view.root)[0], 'cm-quote__cart-guest'))).toContain('로그인하면 장바구니에 담을 수 있습니다.')
    expect(button(cards(view.root)[0], '핵심 부품 비교')).not.toBeNull()
  })

  test('장바구니 구성으로 견적 보내기: GET /cart 의 상품을 부품 고르기 줄로 넣고(수량은 10개까지), 헤더 수를 맞춘다. 보내기는 직접 누른다', async () => {
    const response = deferred()
    fetchCart.mockReturnValue(response.promise)
    const view = await open()
    const load = () => button(newForm(view.root), '장바구니 구성으로 견적 보내기') || button(newForm(view.root), '장바구니를 불러오는 중...')
    load().props.onClick()
    await flush()
    expect(text(load())).toBe('장바구니를 불러오는 중...')
    expect(load().props.disabled).toBe(true)
    response.resolve({
      items: [
        { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '/a.webp', price_krw: 739000, stock: 12, quantity: 1, subtotal_krw: 739000 },
        { product_id: 7, name: 'RTX 5070 Ti', brand: 'MSI', category: 'gpu', thumbnail_url: '/b.webp', price_krw: 1290000, stock: 30, quantity: 12, subtotal_krw: 15480000 },
      ],
      item_count: 13, total_krw: 16219000,
    })
    await flush()
    expect(siteStatus.setCartCount).toHaveBeenCalledWith(13)
    expect(stub(newForm(view.root), 'CommunityPartsPicker').props.modelValue).toEqual([
      { product_id: 1, name: '라이젠7 9800X3D', brand: 'AMD', category: 'cpu', thumbnail_url: '/a.webp', price_krw: 739000, stock: 12, quantity: 1 },
      { product_id: 7, name: 'RTX 5070 Ti', brand: 'MSI', category: 'gpu', thumbnail_url: '/b.webp', price_krw: 1290000, stock: 30, quantity: 10 },
    ])
    expect(text(byRole(newForm(view.root), 'status')[0])).toBe('장바구니 부품 2개를 넣었어요. 수량은 10개까지만 넣었어요. 설명을 적고 견적을 보내 주세요.')
    expect(text(find(newForm(view.root), (node) => node.type === 'button' && node.props.type === 'submit'))).toBe('견적 보내기')
  })

  test('장바구니 구성으로 견적 보내기: 빈 장바구니는 안내, 실패는 alert(고른 부품은 그대로), 자유 글·비로그인에는 버튼이 없다', async () => {
    fetchCart.mockResolvedValueOnce({ items: [], item_count: 0, total_krw: 0 }).mockRejectedValueOnce({ response: { status: 500 } })
    const view = await open()
    await click(button(newForm(view.root), '장바구니 구성으로 견적 보내기'))
    expect(text(byRole(newForm(view.root), 'status')[0])).toBe('장바구니가 비어 있어요. 부품을 먼저 담아 주세요.')
    expect(stub(newForm(view.root), 'CommunityPartsPicker').props.modelValue).toEqual([])
    await click(button(newForm(view.root), '장바구니 구성으로 견적 보내기'))
    expect(text(byRole(newForm(view.root), 'alert')[0])).toBe('장바구니를 불러오지 못했습니다. 다시 시도해 주세요.')
    fetchCommunityPost.mockResolvedValue(freeDetail())
    const free = await open()
    expect(button(newForm(free.root), '장바구니 구성으로')).toBeNull()
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    authSession.reset()
    fetchCommunityPost.mockResolvedValue(buildDetail())
    const guest = await open()
    expect(newForm(guest.root)).toBeNull()
    expect(fetchCart).toHaveBeenCalledTimes(2)
  })
})

describe('질문 게시판(일반 게시판 모양)', () => {
  test.each([
    ['views/QuestionList.vue', {}, { fetchQuestions: jest.fn().mockResolvedValue(page([])) }],
    ['views/QuestionDetail.vue', { questionId: 7 }, { fetchQuestion: jest.fn().mockResolvedValue({ ...questionItem, updated_at: CREATED, images: [], answers: [], is_owner: false }), authSession: createAuthSession({ fetchCurrentUser: jest.fn().mockResolvedValue(null) }) }],
    ['views/QuestionEditor.vue', {}, { authSession: createAuthSession({ fetchCurrentUser: jest.fn().mockResolvedValue({ name: '학습자' }) }) }],
  ])('%s 는 커뮤니티 레이아웃 안에서 질문 게시판을 강조한다(헤더 강조 값은 questions 그대로)', async (path, props, deps) => {
    const View = await compileSfc(path, deps)
    const view = mount(View, props)
    await flush()
    expect(stub(view.root, 'CommunityShell').props.active).toBe('questions')
    expect(stub(view.root, 'SiteLayout').props['active-page']).toBe('questions')
  })

  test('목록(디자인 "questions list"): 게시판 머리(이름·설명·전체 수·질문하기), 답변 알약·제목·관련 부품·첨부·채택·글쓴이·조회·날짜, 번호 쪽 이동', async () => {
    const product = { id: 3, name: '라이젠5 7600', brand: 'AMD', category: 'cpu', thumbnail_url: '', price_krw: 259000, change_30d_pct: -2.1 }
    const fetchQuestions = jest.fn().mockResolvedValueOnce(page([
      { ...questionItem, image_count: 2, product, view_count: 1234, accepted_answer_id: 40 },
      { ...questionItem, id: 8, answer_count: 0, created_at: TODAY, product: null, view_count: null, accepted_answer_id: null },
    ], { total: 31 }))
    const QuestionList = await compileSfc('views/QuestionList.vue', { fetchQuestions, formatBoardDate: boardDate })
    const view = mount(QuestionList)
    await flush()
    expect(text(find(view.root, (node) => node.type === 'h1'))).toBe('질문 게시판')
    expect(text(view.root)).toContain('부품을 지정해서 물어보면 답변이 빨라요.')
    expect(text(view.root)).toContain('전체 질문 31개')
    expect(find(view.root, (node) => node.type === 'a' && text(node) === '질문하기').props.href).toBe('/questions/new')
    expect(stub(view.root, 'CommunityShell').props.counts).toEqual({ questions: 31 })
    const rows = findAll(view.root, (node) => node.type === 'a' && hasClass(node, 'q-board-row'))
    expect(text(rows[0])).toBe(`답변 1${questionItem.title}라이젠5 76002✓채택질문자조회 1,2342026.11.01`)
    expect(text(rows[1])).toBe(`답변 0${questionItem.title}부품 미지정질문자조회 009:30`)
    expect(hasClass(byClass(rows[1], 'q-board-row__product'), 'q-board-row__product--none')).toBe(true)
    expect(byClass(rows[1], 'q-accepted-mark')).toBeNull()
    expect(find(rows[0], (node) => node.props.role === 'img').props['aria-label']).toBe('이미지 2장 첨부')
    const pager = find(view.root, (node) => node.type === 'nav')
    expect(pager.props['aria-label']).toBe('질문 목록 페이지')
    expect(findAll(pager, (node) => node.type === 'button').map(text)).toEqual(['‹이전', '1', '2', '3', '4', '다음›'])
    fetchQuestions.mockResolvedValueOnce(page([questionItem], { total: 31, page: 4 }))
    await click(find(pager, (node) => node.props['aria-label'] === '4쪽'))
    expect(fetchQuestions).toHaveBeenLastCalledWith({ page: 4, pageSize: 10, search: '' })
    expect(findAll(view.root, (node) => node.type === 'a' && hasClass(node, 'q-board-row')).map((node) => node.props.href)).toEqual(['/questions/7'])
  })

  test('목록 줄은 시뮬레이터가 쓰는 모양 그대로: li > a[href=/questions/{id}] 안의 h2(제목만) + 다음 형제 div 의 첫 span(글쓴이) + "답변 N"', async () => {
    const fetchQuestions = jest.fn().mockResolvedValue(page([{ ...questionItem, image_count: 1, answer_count: 3 }]))
    const QuestionList = await compileSfc('views/QuestionList.vue', { fetchQuestions })
    const view = mount(QuestionList)
    await flush()
    const li = find(view.root, (node) => node.type === 'li')
    const anchor = elements(li).find((node) => node.type === 'a')
    expect(anchor.props.href).toBe('/questions/7')
    const children = elements(anchor)
    const titleIndex = children.findIndex((node) => node.type === 'h2')
    expect(text(children[titleIndex])).toBe(questionItem.title)
    const meta = children.slice(titleIndex + 1).find((node) => node.type === 'div')
    expect(text(elements(meta).find((node) => node.type === 'span'))).toBe('질문자')
    expect(text(li)).toMatch(/답변\s*3/)
    expect(text(byRole(view.root, 'status')[0] || { text: '', children: [] })).not.toContain('불러오는 중')
  })
})

describe('community.css', () => {
  const css = readFileSync(join(SRC, 'assets', 'community.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const files = [
    ...readdirSync(join(SRC, 'views')).filter((name) => name.startsWith('Community')).map((name) => join(SRC, 'views', name)),
    ...readdirSync(join(SRC, 'components')).filter((name) => name.startsWith('Community')).map((name) => join(SRC, 'components', name)),
  ]
  const sources = files.map((file) => readFileSync(file, 'utf8'))

  test('main.js 에서 불러오고, 클래스는 모두 커뮤니티 화면·컴포넌트에서 쓴다', () => {
    expect(readFileSync(join(SRC, 'main.js'), 'utf8')).toContain("import './assets/community.css'")
    const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]))]
    expect(classes.every((name) => name.startsWith('cm-'))).toBe(true)
    const appSources = sources.join('\n')
    expect(classes.filter((name) => !new RegExp(`(^|[^\\w-])${name}(?![\\w-])`).test(appSources))).toEqual([])
  })

  test('색은 토큰만 쓴다(hex·흰색 하드코딩 없음)', () => {
    for (const source of [css, ...sources.map((value) => value.split('<style')[1] || '')]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source).not.toMatch(/(?<![\w-])white(?![\w-])/i)
    }
  })

  test('본문 폭이 좁으면(@container cm-main) 자유 게시판 줄은 두 줄(제목 / 글쓴이·날짜), 견적 줄은 세 줄(상태·용도·예산 / 제목 / 날짜)', () => {
    expect(css).toMatch(/@container cm-main \(max-width: 620px\)[\s\S]*\.cm-board-row \{[^}]*"title count \." "meta meta meta"/)
    expect(css).toMatch(/@container cm-main \(max-width: 620px\)[\s\S]*\.cm-build-row \{[^}]*"status purpose budget" "subject subject subject" "date date date"/)
    const shell = readFileSync(join(SRC, 'components', 'CommunityShell.vue'), 'utf8')
    expect(shell).toMatch(/\.cm-shell__main \{[^}]*container: cm-main \/ inline-size/)
    expect(shell).toMatch(/@media \(max-width: 760px\)[\s\S]*\.cm-shell__links \{[^}]*overflow-x: auto/)
  })
})
