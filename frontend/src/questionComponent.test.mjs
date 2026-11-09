import * as Vue from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_ANSWER_LENGTH, PRODUCT_SEARCH_PAGE_SIZE, acceptAction, acceptError, answerError, answerLength, formatQuestionDate, formatViewCount, isAcceptedAnswer, orderAnswers,
  productChange, questionError, questionProductName, validateAnswer, validateQuestion, validateQuestionImages,
} from './stores/questionViewModel.js'
import { createAuthSession, memberProfile } from './stores/authSession.js'
import { QUESTION_BOARD, authorInitial, boardPageCount, boardPageItems, boardRowNumber, formatBoardDate, formatBoardDateTime, isEdited } from './stores/communityViewModel.js'
import { categoryName, formatPrice, getProductImage, productPath } from './stores/productViewModel.js'

const root = dirname(fileURLToPath(import.meta.url))
const fetchQuestions = jest.fn()
const fetchQuestion = jest.fn()
const createQuestion = jest.fn()
const updateQuestion = jest.fn()
const deleteQuestion = jest.fn()
const fetchCurrentUser = jest.fn()
const createAnswer = jest.fn()
const updateAnswer = jest.fn()
const deleteAnswer = jest.fn()
const goToQuestion = jest.fn()
const track = jest.fn()
const acceptAnswer = jest.fn()
const unacceptAnswer = jest.fn()
const fetchProducts = jest.fn()
const fetchProduct = jest.fn()
// 글쓰기 주소의 ?product={id}(브라우저 객체라 가짜로 넘긴다)
const readProductQuery = jest.fn()
const authSession = createAuthSession({ fetchCurrentUser })
const SiteLayout = { setup(_, { slots }) { return () => Vue.h('main', slots.default?.()) } }
// 화면 안 확인 상자: 넘긴 props(message, busy, onConfirm, onCancel)를 노드에 남겨 테스트가 예/아니요를 누를 수 있게 한다
const InlineConfirm = { inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('div', { ...attrs, 'data-stub': 'InlineConfirm' }) } }
// 커뮤니티 2단 레이아웃(왼쪽 게시판 메뉴, spec 2026-11-01-community-dark-theme 2차 개편). 넘긴 props 를 남기고 본문(slot)은 그대로 그린다
const CommunityShell = { inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', { ...attrs, 'data-stub': 'CommunityShell' }, slots.default?.()) } }
const PriceChangeBadge = { inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('span', { ...attrs, 'data-stub': 'PriceChangeBadge' }) } }
// 관련 부품 검색을 모으는 시간(화면이 import 한 0.3초 대신 짧게)
const SEARCH_DEBOUNCE = 20

function compileView(name, overrides = {}) {
  const filename = resolve(root, 'views', name)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  expect(errors).toEqual([])
  const script = compileScript(descriptor, { id: name })
  // import 문(여러 줄 import { … } from '…' 포함)을 지우고 dependencies 의 값으로 넣는다
  const code = script.content.replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '').replace('export default', 'return')
  const dependencies = {
    computed: Vue.computed, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, ref: Vue.ref, watch: Vue.watch,
    SiteLayout, CommunityShell, PriceChangeBadge, fetchQuestions, fetchQuestion, createQuestion, updateQuestion, deleteQuestion, fetchCurrentUser,
    formatQuestionDate, goToQuestion, questionError, validateQuestion, validateQuestionImages,
    InlineConfirm, createAnswer, updateAnswer, deleteAnswer, MAX_ANSWER_LENGTH, answerError, answerLength, validateAnswer,
    acceptAnswer, unacceptAnswer, acceptAction, acceptError, isAcceptedAnswer, orderAnswers, formatViewCount, questionProductName,
    fetchProducts, fetchProduct, readProductQuery, productChange, PRODUCT_SEARCH_DEBOUNCE_MS: SEARCH_DEBOUNCE, PRODUCT_SEARCH_PAGE_SIZE,
    categoryName, formatPrice, getProductImage, productPath, authorInitial,
    authSession, memberProfile, track,
    QUESTION_BOARD, boardPageCount, boardPageItems, boardRowNumber, formatBoardDate, formatBoardDateTime, isEdited,
    ...overrides,
  }
  const component = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
  const template = compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { bindingMetadata: script.bindings, mode: 'function' } })
  expect(template.errors).toEqual([])
  component.render = new Function('Vue', template.code)(Vue)
  return component
}

function mount(component, props = {}) {
  const make = (type, text = '') => ({ type, props: {}, children: [], text, parent: null, tagName: type.toUpperCase(), addEventListener() {}, removeEventListener() {}, getRootNode() { return { activeElement: null } } })
  const renderer = Vue.createRenderer({
    patchProp: (node, key, _, value) => { node.props[key] = value },
    insert: (node, parent, anchor = null) => {
      if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove: (node) => { if (node?.parent) node.parent.children = node.parent.children.filter((child) => child !== node) },
    createElement: (type) => make(type), createText: (text) => make('#text', text), createComment: () => make('#comment'),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    insertStaticContent: (content, parent) => { const node = make('#static', content); node.parent = parent; parent.children.push(node); return [node, node] },
    parentNode: (node) => node.parent, nextSibling: (node) => node?.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  })
  const target = make('root')
  const app = renderer.createApp(component, props)
  app.mount(target)
  return { root: target, unmount: () => app.unmount() }
}

function text(node) { return `${node.text}${node.children.map(text).join('')}` }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children) { const match = find(child, predicate); if (match) return match } return null }
const button = (node, label) => find(node, (item) => item.type === 'button' && text(item).includes(label))
const input = (node, id) => find(node, (item) => item.props.id === id)
async function flush() { for (let i = 0; i < 5; i++) { await Promise.resolve(); await Vue.nextTick() } }
function setValue(node, value) { node.props['onUpdate:modelValue'](value) }
async function submit(node) { await find(node, (item) => item.type === 'form').props.onSubmit({ preventDefault() {} }); await flush() }
const question = { id: 7, title: 'S3 이미지 업로드 질문', content: '첫 줄\n둘째 줄 <script>bad()</script>', author: { id: '1', name: '학습자' }, created_at: '2026-10-27T00:00:00', updated_at: '2026-10-27T00:00:00', images: [{ id: 3, filename: '오류.png', url: 'https://images.example.test/file?signature=abc' }], is_owner: false }
let List, Detail, Editor

beforeAll(() => { List = compileView('QuestionList.vue'); Detail = compileView('QuestionDetail.vue'); Editor = compileView('QuestionEditor.vue') })
beforeEach(() => {
  jest.resetAllMocks()
  authSession.reset()
  fetchCurrentUser.mockResolvedValue({ name: '학습자' })
  fetchQuestion.mockResolvedValue(question)
  fetchQuestions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  readProductQuery.mockReturnValue(null)
  global.window = {}
  global.Document = class Document {}
  global.ShadowRoot = class ShadowRoot {}
  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks(); delete global.window; delete global.Document; delete global.ShadowRoot })

test('list shows loading, failure, retry, and empty invitation', async () => {
  let reject
  fetchQuestions.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const view = mount(List)
  expect(text(view.root)).toContain('질문을 불러오는 중')
  reject(new Error('network')); await flush()
  expect(text(view.root)).toContain('질문 목록을 불러오지 못했습니다.')
  await button(view.root, '다시 시도').props.onClick(); await flush()
  expect(text(view.root)).toContain('아직 등록된 질문이 없습니다.')
  expect(find(view.root, (node) => node.props.href === '/questions/new')).toBeTruthy()
})

test('list renders server items with image count, search, and pagination', async () => {
  fetchQuestions.mockResolvedValue({ items: [{ ...question, image_count: 1 }], total: 12, page: 1, page_size: 10 })
  const view = mount(List); await flush()
  expect(text(view.root)).toContain(question.title)
  expect(find(view.root, (node) => node.props['aria-label'] === '이미지 1장 첨부')).toBeTruthy()
  await button(view.root, '다음').props.onClick(); await flush()
  expect(fetchQuestions).toHaveBeenLastCalledWith({ page: 2, pageSize: 10, search: '' })
  setValue(input(view.root, 'question-search'), '  S3  ')
  await submit(view.root)
  expect(fetchQuestions).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: 'S3' })
})

test('public detail renders text and private signed image links without owner actions', async () => {
  const view = mount(Detail, { questionId: 7 }); await flush()
  expect(text(view.root)).toContain(question.content)
  expect(find(view.root, (node) => node.type === 'img').props.src).toBe(question.images[0].url)
  expect(find(view.root, (node) => node.type === 'script')).toBeNull()
  expect(button(view.root, '삭제')).toBeNull()
  expect(find(view.root, (node) => node.props.href === '/questions/7/edit')).toBeNull()
})

test('owner can cancel deletion, recover failed delete, then delete and navigate', async () => {
  fetchQuestion.mockResolvedValue({ ...question, is_owner: true })
  const view = mount(Detail, { questionId: 7 }); await flush()
  expect(find(view.root, (node) => node.props.href === '/questions/7/edit')).toBeTruthy()
  const confirmBox = () => find(view.root, (node) => node.props['data-stub'] === 'InlineConfirm')
  await button(view.root, '삭제').props.onClick(); await flush()
  await confirmBox().props.onCancel(); await flush()
  expect(deleteQuestion).not.toHaveBeenCalled()
  deleteQuestion.mockRejectedValueOnce({ response: { status: 503, data: { message: '이미지를 삭제할 수 없습니다.' } } })
  await button(view.root, '삭제').props.onClick(); await flush()
  await confirmBox().props.onConfirm(); await flush()
  expect(text(view.root)).toContain('이미지를 삭제할 수 없습니다.')
  expect(goToQuestion).not.toHaveBeenCalled()
  deleteQuestion.mockResolvedValueOnce(null)
  await confirmBox().props.onConfirm(); await flush()
  expect(deleteQuestion).toHaveBeenLastCalledWith(7)
  expect(goToQuestion).toHaveBeenCalledWith()
})

test('missing and invalid question details provide list recovery', async () => {
  fetchQuestion.mockRejectedValue({ response: { status: 404 } })
  const missing = mount(Detail, { questionId: 700 }); await flush()
  expect(text(missing.root)).toContain('질문을 찾을 수 없습니다.')
  fetchQuestion.mockClear()
  const invalid = mount(Detail, { questionId: null }); await flush()
  expect(text(invalid.root)).toContain('올바르지 않은 질문 주소')
  expect(fetchQuestion).not.toHaveBeenCalled()
})

test('editor requires login and can recheck after login', async () => {
  fetchCurrentUser.mockRejectedValueOnce({ response: { status: 401 } })
  const view = mount(Editor); await flush()
  expect(text(view.root)).toContain('로그인하고 질문을 남겨 주세요.')
  expect(input(view.root, 'question-title')).toBeNull()
  await button(view.root, '로그인 상태 다시 확인').props.onClick(); await flush()
  expect(input(view.root, 'question-title')).toBeTruthy()
})

test.each([
  ['server error', { response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } }, '서버 내부 오류가 발생했습니다.'],
  ['network failure', Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }), '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.'],
])('editor shows a retryable alert instead of the login prompt when the login check fails with a %s', async (_name, failure, message) => {
  fetchCurrentUser.mockRejectedValueOnce(failure)
  const view = mount(Editor); await flush()
  expect(text(find(view.root, (node) => node.props.role === 'alert'))).toContain(message)
  expect(text(view.root)).not.toContain('로그인하고 질문을 남겨 주세요.')
  expect(input(view.root, 'question-title')).toBeNull()
  await button(view.root, '다시 시도').props.onClick(); await flush()
  expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
  expect(find(view.root, (node) => node.props.role === 'alert')).toBeNull()
  expect(input(view.root, 'question-title')).toBeTruthy()
})

test('editor validates image types, previews selected image, removes and releases preview', async () => {
  const view = mount(Editor); await flush()
  const picker = input(view.root, 'question-images')
  picker.props.onChange({ target: { files: [new File(['svg'], 'x.svg', { type: 'image/svg+xml' })], value: 'x.svg' } }); await flush()
  expect(text(view.root)).toContain('JPG, PNG, GIF, WebP 이미지만')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  picker.props.onChange({ target: { files: [new File(['png'], 'image.png', { type: 'image/png' })], value: 'image.png' } }); await flush()
  expect(find(view.root, (node) => node.type === 'img').props.src).toBe('blob:preview')
  await button(view.root, '삭제').props.onClick(); await flush()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  expect(find(view.root, (node) => node.type === 'img')).toBeNull()
})

test('editor submits selected images with text and navigates after success', async () => {
  createQuestion.mockResolvedValue({ id: 21 })
  const view = mount(Editor); await flush()
  setValue(input(view.root, 'question-title'), '질문 제목')
  setValue(input(view.root, 'question-content'), '질문 내용')
  const image = new File(['png'], 'screen.png', { type: 'image/png' })
  input(view.root, 'question-images').props.onChange({ target: { files: [image], value: 'screen.png' } })
  await submit(view.root)
  expect(createQuestion).toHaveBeenCalledWith({ title: '질문 제목', content: '질문 내용', images: [image] })
  expect(goToQuestion).toHaveBeenCalledWith(21)
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})

test('expired write keeps draft, shows login link, and allows retry', async () => {
  createQuestion.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ id: 22 })
  const view = mount(Editor); await flush()
  setValue(input(view.root, 'question-title'), '내 제목')
  setValue(input(view.root, 'question-content'), '내 내용')
  await submit(view.root)
  expect(text(view.root)).toContain('로그인이 만료되었습니다.')
  expect(find(view.root, (node) => node.props.href === '/login' && node.props.target === '_blank')).toBeTruthy()
  expect(input(view.root, 'question-title').value).toBe('내 제목')
  expect(goToQuestion).not.toHaveBeenCalled()
  await submit(view.root)
  expect(goToQuestion).toHaveBeenCalledWith(22)
})

test('image upload failure keeps draft and preview for retry and shows upload progress', async () => {
  let rejectUpload
  createQuestion.mockImplementationOnce(() => new Promise((_, reject) => { rejectUpload = reject }))
    .mockResolvedValueOnce({ id: 23 })
  const view = mount(Editor); await flush()
  const image = new File(['png'], 'retry.png', { type: 'image/png' })
  setValue(input(view.root, 'question-title'), '업로드 질문')
  setValue(input(view.root, 'question-content'), '입력 내용 유지')
  input(view.root, 'question-images').props.onChange({ target: { files: [image], value: 'retry.png' } })
  const pending = submit(view.root)
  await flush()
  expect(text(view.root)).toContain('이미지를 업로드하고 질문을 등록하는 중')
  expect(find(view.root, (node) => node.type === 'fieldset').props.disabled).toBe(true)
  rejectUpload(Object.assign(new Error('이미지를 업로드하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 등록해 주세요.'), { code: 'QUESTION_IMAGE_UPLOAD_FAILED' }))
  await pending
  expect(text(view.root)).toContain('네트워크 연결을 확인한 뒤 다시 등록')
  expect(input(view.root, 'question-title').value).toBe('업로드 질문')
  expect(input(view.root, 'question-content').value).toBe('입력 내용 유지')
  expect(find(view.root, (node) => node.type === 'img').props.src).toBe('blob:preview')
  expect(goToQuestion).not.toHaveBeenCalled()
  await submit(view.root)
  expect(createQuestion).toHaveBeenLastCalledWith({ title: '업로드 질문', content: '입력 내용 유지', images: [image] })
  expect(goToQuestion).toHaveBeenCalledWith(23)
})

test('edit loads owner content, retains images, and updates only text', async () => {
  fetchQuestion.mockResolvedValue({ ...question, is_owner: true })
  updateQuestion.mockResolvedValue({ ...question, is_owner: true })
  const view = mount(Editor, { questionId: 7, editing: true }); await flush()
  expect(text(view.root)).toContain('기존 이미지는 그대로 유지')
  expect(input(view.root, 'question-images')).toBeNull()
  setValue(input(view.root, 'question-content'), '변경된 내용')
  await submit(view.root)
  expect(updateQuestion).toHaveBeenCalledWith(7, { title: question.title, content: '변경된 내용' })
  expect(createQuestion).not.toHaveBeenCalled()
})

test('editing another author question is blocked', async () => {
  const view = mount(Editor, { questionId: 7, editing: true }); await flush()
  expect(text(view.root)).toContain('본인이 작성한 질문만 수정')
  expect(input(view.root, 'question-title')).toBeNull()
})

// ---------------------------------------------------------------- 관련 부품(CONTRACT §9)
const product = (id, extra = {}) => ({ id, name: `부품 ${id}`, brand: 'AMD', category: 'cpu', thumbnail_url: `/images/products/p${id}.webp`, price_krw: 259000 + id, ...extra })
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const settle = async () => { await wait(SEARCH_DEBOUNCE * 3); await flush() }
const findAll = (node, predicate) => [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => findAll(child, predicate))]
const chip = (root) => find(root, (node) => node.props.class === 'q-product-chip')
const results = (root) => findAll(root, (node) => node.props.class === 'q-product-option')

test('detail shows the linked part card (photo, 관련 부품 · brand, name link, price, 30-day badge) and view count', async () => {
  fetchQuestion.mockResolvedValue({ ...question, view_count: 1234, product: { ...product(3), change_30d_pct: -5.2 } })
  const view = mount(Detail, { questionId: 7 }); await flush()
  const card = find(view.root, (node) => node.props.class === 'q-part')
  expect(find(card, (node) => node.type === 'img').props).toMatchObject({ src: '/images/products/p3.webp', alt: '부품 3 이미지' })
  expect(text(card)).toContain('관련 부품 · AMD')
  expect(find(card, (node) => node.type === 'a').props.href).toBe('/products/3')
  expect(text(card)).toContain('259,003원')
  expect(find(card, (node) => node.props['data-stub'] === 'PriceChangeBadge').props.pct).toBe(-5.2)
  expect(text(find(view.root, (node) => node.props.class === 'cm-post__byline'))).toContain('조회 1,234')
  fetchQuestion.mockResolvedValue({ ...question, product: { ...product(3), change_30d_pct: null } })
  const noChange = mount(Detail, { questionId: 7 }); await flush()
  expect(find(noChange.root, (node) => node.props['data-stub'] === 'PriceChangeBadge')).toBeNull()
  fetchQuestion.mockResolvedValue({ ...question, product: null })
  const none = mount(Detail, { questionId: 7 }); await flush()
  expect(find(none.root, (node) => node.props.class === 'q-part')).toBeNull()
  expect(text(find(none.root, (node) => node.props.class === 'cm-post__byline'))).toContain('조회 0')
})

test('editor part picker: debounced search (page_size 10), stale responses ignored, choose → chip, 지우기', async () => {
  const Picker = compileView('QuestionEditor.vue')
  const view = mount(Picker); await flush()
  const search = () => input(view.root, 'question-product-search')
  expect(text(find(view.root, (node) => node.type === 'label' && node.props.for === 'question-product-search'))).toContain('관련 부품')
  const slow = (() => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } })()
  fetchProducts.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ items: [product(3), product(4)], total: 2, page: 1, page_size: 10 })
  setValue(search(), '76'); await flush()
  expect(text(find(view.root, (node) => node.props.role === 'status'))).toBe('부품을 찾는 중입니다...')
  expect(fetchProducts).not.toHaveBeenCalled()
  await settle()
  expect(fetchProducts).toHaveBeenLastCalledWith({ search: '76', pageSize: 10 })
  setValue(search(), '7600'); await settle()
  expect(fetchProducts).toHaveBeenLastCalledWith({ search: '7600', pageSize: 10 })
  slow.resolve({ items: [product(99)], total: 1, page: 1, page_size: 10 }); await flush()
  expect(results(view.root).map((node) => text(node))).toEqual(['AMD · CPU부품 3259,003원', 'AMD · CPU부품 4259,004원'])
  await button(results(view.root)[1], '부품 4').props.onClick(); await flush()
  expect(text(chip(view.root))).toContain('부품 4')
  expect(search().value).toBe('')
  expect(results(view.root)).toEqual([])
  await find(chip(view.root), (node) => node.type === 'button').props.onClick(); await flush()
  expect(chip(view.root)).toBeNull()
})

test('editor part picker: Enter searches at once without submitting, empty results and failures are explained with retry', async () => {
  const view = mount(Editor); await flush()
  const search = () => input(view.root, 'question-product-search')
  fetchProducts.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 10 })
    .mockRejectedValueOnce({ response: { status: 500 } })
    .mockResolvedValueOnce({ items: [product(5)], total: 1, page: 1, page_size: 10 })
  setValue(search(), '없는부품'); await flush()
  await search().props.onKeydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); await flush()
  expect(createQuestion).not.toHaveBeenCalled()
  expect(fetchProducts).toHaveBeenCalledTimes(1)
  expect(text(view.root)).toContain("'없는부품'에 맞는 부품이 없습니다.")
  setValue(search(), '9800'); await settle()
  expect(text(find(view.root, (node) => node.props.role === 'alert'))).toContain('부품을 찾지 못했습니다. 다시 시도해 주세요.')
  await button(find(view.root, (node) => node.props.role === 'alert'), '다시 시도').props.onClick(); await flush()
  expect(results(view.root)).toHaveLength(1)
  await settle()
  expect(fetchProducts).toHaveBeenCalledTimes(3)
})

test('editor sends productId only when a part is chosen; ?product={id} preselects it', async () => {
  createQuestion.mockResolvedValue({ id: 31 })
  readProductQuery.mockReturnValue(3)
  fetchProduct.mockResolvedValue(product(3))
  const view = mount(Editor); await flush()
  expect(fetchProduct).toHaveBeenCalledWith(3)
  expect(text(chip(view.root))).toContain('부품 3')
  setValue(input(view.root, 'question-title'), '7600 에 4070 SUPER')
  setValue(input(view.root, 'question-content'), '병목 있을까요?')
  await submit(view.root)
  expect(createQuestion).toHaveBeenCalledWith({ title: '7600 에 4070 SUPER', content: '병목 있을까요?', images: [], productId: 3 })
  expect(goToQuestion).toHaveBeenCalledWith(31)
  fetchProduct.mockRejectedValueOnce({ response: { status: 404 } })
  const missing = mount(Editor); await flush()
  expect(chip(missing.root)).toBeNull()
  expect(text(missing.root)).toContain('연결하려던 부품을 불러오지 못했습니다.')
})

test('edit keeps the linked part, sends productId only when it changes (null clears the link)', async () => {
  fetchQuestion.mockResolvedValue({ ...question, is_owner: true, product: product(3) })
  updateQuestion.mockResolvedValue({ ...question, is_owner: true })
  const view = mount(Editor, { questionId: 7, editing: true }); await flush()
  expect(text(chip(view.root))).toContain('부품 3')
  setValue(input(view.root, 'question-title'), '바뀐 제목')
  await submit(view.root)
  expect(updateQuestion).toHaveBeenLastCalledWith(7, { title: '바뀐 제목', content: question.content })
  await find(chip(view.root), (node) => node.type === 'button').props.onClick(); await flush()
  await submit(view.root)
  expect(updateQuestion).toHaveBeenLastCalledWith(7, { title: '바뀐 제목', content: question.content, productId: null })
})
