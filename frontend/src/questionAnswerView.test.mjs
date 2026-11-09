// 질문 목록의 답변 수와 질문 상세(views/QuestionDetail.vue)의 답변: 목록(오래된 순), 작성(로그인 필요), 본인 답변 수정·삭제(화면 안 확인).
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, link, mount, setValue, stub, text } from './testing/sfc.mjs'
import { createAuthSession } from './stores/authSession.js'

const answer = (id, extra = {}) => ({ id, question_id: 7, author: { id: String(id), name: `답변자${id}` }, content: `답변 내용 ${id}`, created_at: '2026-10-28T01:00:00', updated_at: '2026-10-28T01:00:00', is_owner: false, ...extra })
const question = (answers = []) => ({
  id: 7, title: 'B650 보드에 DDR5-6000 을 써도 되나요?', content: '내용', author: { id: '9', name: '질문자' },
  created_at: '2026-10-27T01:00:00', updated_at: '2026-10-27T01:00:00', image_count: 0, images: [], is_owner: false,
  answer_count: answers.length, answers,
})

describe('질문 목록의 답변 수', () => {
  test('답변 수(answer_count)를 보여 주고, 없으면 0 으로 보여 준다', async () => {
    const fetchQuestions = jest.fn().mockResolvedValue({ items: [{ ...question(), answer_count: 3 }, { ...question(), id: 8, answer_count: 0 }], total: 2, page: 1, page_size: 10 })
    const QuestionList = await compileSfc('views/QuestionList.vue', { fetchQuestions })
    const page = mount(QuestionList)
    await flush()
    const counts = findAll(page.root, (node) => String(node.props.class || '').startsWith('q-answer-count'))
    expect(counts.map((node) => [text(node), node.props.class])).toEqual([
      ['답변 3', 'q-answer-count'],
      ['답변 0', 'q-answer-count q-answer-count--empty'],
    ])
  })
})

describe('질문 상세의 답변', () => {
  const fetchQuestion = jest.fn()
  const fetchCurrentUser = jest.fn()
  const createAnswer = jest.fn()
  const updateAnswer = jest.fn()
  const deleteAnswer = jest.fn()
  const deleteQuestion = jest.fn()
  const goToQuestion = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let QuestionDetail

  beforeAll(async () => {
    QuestionDetail = await compileSfc('views/QuestionDetail.vue', { fetchQuestion, authSession, createAnswer, updateAnswer, deleteAnswer, deleteQuestion, goToQuestion })
  })
  beforeEach(() => {
    for (const mock of [fetchQuestion, fetchCurrentUser, createAnswer, updateAnswer, deleteAnswer, deleteQuestion, goToQuestion]) mock.mockReset()
    fetchQuestion.mockResolvedValue(question([answer(1), answer(2, { is_owner: true, updated_at: '2026-10-29T01:00:00' })]))
    fetchCurrentUser.mockResolvedValue({ id: 2, name: '답변자2' })
    authSession.reset()
  })

  async function open() {
    const page = mount(QuestionDetail, { questionId: 7 })
    await flush()
    return page
  }
  const answers = (page) => find(page.root, (node) => node.type === 'section' && node.props['aria-labelledby'] === 'answers-title')
  const items = (page) => findAll(answers(page), (node) => node.type === 'li')
  const newForm = (page) => find(answers(page), (node) => node.type === 'form' && !text(node).includes('수정 완료'))

  test('답변을 서버 순서(오래된 순)대로 보여 주고, 본인 답변(is_owner)에만 수정·삭제가 있다', async () => {
    const page = await open()
    expect(text(find(answers(page), (node) => node.type === 'h2'))).toBe('답변 2')
    expect(items(page).map((node) => text(find(node, (child) => child.props.class === 'q-answer__body')))).toEqual(['답변 내용 1', '답변 내용 2'])
    expect(text(items(page)[0])).toContain('답변자12026.10.28 10:00')
    expect(button(items(page)[0], '수정')).toBeNull()
    expect(button(items(page)[0], '삭제')).toBeNull()
    expect(text(items(page)[1])).toContain('수정됨')
    expect(button(items(page)[1], '수정')).not.toBeNull()
    expect(button(items(page)[1], '삭제')).not.toBeNull()
  })

  test('답변이 없으면 첫 답변 안내와, 로그인했으면 작성 폼', async () => {
    fetchQuestion.mockResolvedValue(question([]))
    const page = await open()
    expect(text(answers(page))).toContain('아직 답변이 없습니다. 첫 답변을 남겨 주세요.')
    expect(byId(page.root, 'answer-content').props.maxlength).toBe(5000)
    expect(button(answers(page), '답변 등록')).not.toBeNull()
  })

  test('비로그인이면 "답변 쓰기" 상자에 입력 대신 "로그인하면 글을 쓸 수 있어요" + 로그인 링크', async () => {
    fetchQuestion.mockResolvedValue(question([]))
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    const page = await open()
    const guest = find(answers(page), (node) => String(node.props.class || '').includes('q-compose--guest'))
    expect(text(guest)).toBe('답변 쓰기로그인하면 글을 쓸 수 있어요로그인하고 쓰기')
    expect(link(guest, '로그인하고 쓰기').props.href).toBe('/login')
    expect(byId(page.root, 'answer-content')).toBeNull()
  })

  test('로그인하면 "답변 쓰기" 상자: 이름 "답변 남기기"(시뮬레이터)인 입력과 "답변 등록" 버튼', async () => {
    const page = await open()
    expect(text(find(newForm(page), (node) => node.type === 'h3'))).toBe('답변 쓰기')
    expect(text(find(newForm(page), (node) => node.type === 'label' && node.props.for === 'answer-content'))).toContain('답변 남기기')
    expect(button(newForm(page), '답변 등록').props.type).toBe('submit')
  })

  test('잘못된 주소·없는 질문이면 로그인 확인을 하지 않는다', async () => {
    fetchQuestion.mockRejectedValue({ response: { status: 404 } })
    const page = await open()
    expect(text(page.root)).toContain('질문을 찾을 수 없습니다.')
    expect(fetchCurrentUser).not.toHaveBeenCalled()
  })

  test('빈 답변은 요청하지 않고, 등록 중에는 저장 중... + 잠금 + 두 번 보내지 않으며, 성공하면 목록 끝에 붙이고 입력을 비운다', async () => {
    const page = await open()
    newForm(page).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createAnswer).not.toHaveBeenCalled()
    expect(text(byRole(newForm(page), 'alert')[0]).trim()).toBe('답변 내용을 입력해 주세요.')
    await setValue(byId(page.root, 'answer-content'), '  메모리 QVL 을 먼저 확인해 보세요.  ')
    const response = deferred()
    createAnswer.mockReturnValue(response.promise)
    newForm(page).props.onSubmit({ preventDefault() {} })
    newForm(page).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(createAnswer).toHaveBeenCalledTimes(1)
    expect(createAnswer).toHaveBeenCalledWith(7, { content: '  메모리 QVL 을 먼저 확인해 보세요.  ' })
    expect(button(newForm(page), '저장 중...').props.disabled).toBe(true)
    expect(find(newForm(page), (node) => node.type === 'fieldset').props.disabled).toBe(true)
    response.resolve(answer(3, { content: '메모리 QVL 을 먼저 확인해 보세요.', is_owner: true }))
    await flush()
    expect(items(page)).toHaveLength(3)
    expect(text(items(page)[2])).toContain('메모리 QVL 을 먼저 확인해 보세요.')
    expect(text(find(answers(page), (node) => node.type === 'h2'))).toBe('답변 3')
    expect(byId(page.root, 'answer-content').value).toBe('')
    expect(text(byRole(answers(page), 'status')[0])).toBe('답변이 등록되었습니다.')
  })

  test.each([
    ['401 로그인 만료', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.', true],
    ['404 지워진 질문', { response: { status: 404, data: { message: '질문을 찾을 수 없습니다.' } } }, '질문을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.', false],
    ['500', { response: { status: 500 } }, '답변을 등록하지 못했습니다. 입력한 내용은 그대로 있습니다. 다시 시도해 주세요.', false],
  ])('등록 실패(%s)면 문구를 보여 주고 입력을 그대로 둔다', async (_name, failure, message, login) => {
    createAnswer.mockRejectedValue(failure)
    const page = await open()
    await setValue(byId(page.root, 'answer-content'), '케이스 길이를 확인하세요.')
    newForm(page).props.onSubmit({ preventDefault() {} })
    await flush()
    expect(text(byRole(newForm(page), 'alert')[0])).toContain(message)
    expect(byId(page.root, 'answer-content').value).toBe('케이스 길이를 확인하세요.')
    expect(items(page)).toHaveLength(2)
    const relogin = link(newForm(page), '새 탭에서 다시 로그인')
    if (login) expect(relogin.props).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    else expect(relogin).toBeNull()
  })

  test('본인 답변을 고치면 그 자리에 바뀐 답변을 보여 주고, 취소하면 원래대로', async () => {
    updateAnswer.mockResolvedValue(answer(2, { content: '고친 답변입니다.', is_owner: true, updated_at: '2026-10-30T01:00:00' }))
    const page = await open()
    await click(button(items(page)[1], '수정'))
    expect(byId(page.root, 'answer-edit-2').value).toBe('답변 내용 2')
    await click(button(items(page)[1], '취소'))
    expect(byId(page.root, 'answer-edit-2')).toBeNull()
    await click(button(items(page)[1], '수정'))
    await setValue(byId(page.root, 'answer-edit-2'), '   ')
    const editForm = find(items(page)[1], (node) => node.type === 'form')
    await editForm.props.onSubmit({ preventDefault() {} })
    await flush()
    expect(updateAnswer).not.toHaveBeenCalled()
    expect(text(byRole(editForm, 'alert')[0]).trim()).toBe('답변 내용을 입력해 주세요.')
    await setValue(byId(page.root, 'answer-edit-2'), '고친 답변입니다.')
    await find(items(page)[1], (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await flush()
    expect(updateAnswer).toHaveBeenCalledWith(7, 2, { content: '고친 답변입니다.' })
    expect(byId(page.root, 'answer-edit-2')).toBeNull()
    expect(text(items(page)[1])).toContain('고친 답변입니다.')
    expect(text(byRole(answers(page), 'status')[0])).toBe('답변이 수정되었습니다.')
  })

  test('수정 실패(403)면 문구를 보여 주고 고친 내용을 그대로 둔다', async () => {
    updateAnswer.mockRejectedValue({ response: { status: 403, data: { message: '본인이 작성한 답변만 수정하거나 삭제할 수 있습니다.' } } })
    const page = await open()
    await click(button(items(page)[1], '수정'))
    await setValue(byId(page.root, 'answer-edit-2'), '고친 답변')
    await find(items(page)[1], (node) => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await flush()
    expect(text(byRole(items(page)[1], 'alert')[0]).trim()).toBe('본인이 작성한 답변만 수정하거나 삭제할 수 있습니다.')
    expect(byId(page.root, 'answer-edit-2').value).toBe('고친 답변')
  })

  test('삭제는 화면 안 확인(예/아니요)을 거치고, 진행 중에는 다시 보내지 않으며, 성공하면 목록에서 뺀다', async () => {
    const page = await open()
    await click(button(items(page)[1], '삭제'))
    const confirm = () => stub(items(page)[1], 'InlineConfirm')
    expect(confirm().props).toMatchObject({ message: '이 답변을 삭제할까요? 삭제한 답변은 되돌릴 수 없습니다.', busy: false })
    expect(button(items(page)[1], '삭제')).toBeNull()
    confirm().props.onCancel()
    await flush()
    expect(confirm()).toBeNull()
    await click(button(items(page)[1], '삭제'))
    const response = deferred()
    deleteAnswer.mockReturnValue(response.promise)
    confirm().props.onConfirm()
    confirm().props.onConfirm()
    await flush()
    expect(deleteAnswer).toHaveBeenCalledTimes(1)
    expect(deleteAnswer).toHaveBeenCalledWith(7, 2)
    expect(confirm().props.busy).toBe(true)
    response.resolve(null)
    await flush()
    expect(items(page)).toHaveLength(1)
    expect(text(byRole(answers(page), 'status')[0])).toBe('답변이 삭제되었습니다.')
  })

  test('삭제 실패면 그 답변 아래에 문구를 보여 주고 답변은 남긴다', async () => {
    deleteAnswer.mockRejectedValue({ response: { status: 404, data: { message: '답변을 찾을 수 없습니다.' } } })
    const page = await open()
    await click(button(items(page)[1], '삭제'))
    stub(items(page)[1], 'InlineConfirm').props.onConfirm()
    await flush()
    expect(text(byRole(items(page)[1], 'alert')[0])).toBe('답변을 찾을 수 없습니다. 새로고침한 뒤 다시 확인해 주세요.')
    expect(items(page)).toHaveLength(2)
  })
})

describe('질문 상세: 답변 채택(CONTRACT §9)', () => {
  const fetchQuestion = jest.fn()
  const fetchCurrentUser = jest.fn()
  const acceptAnswer = jest.fn()
  const unacceptAnswer = jest.fn()
  const authSession = createAuthSession({ fetchCurrentUser })
  let QuestionDetail
  const mine = (answers, extra = {}) => ({ ...question(answers), is_owner: true, accepted_answer_id: null, ...extra })

  beforeAll(async () => {
    QuestionDetail = await compileSfc('views/QuestionDetail.vue', { fetchQuestion, authSession, acceptAnswer, unacceptAnswer, track: jest.fn() })
  })
  beforeEach(() => {
    for (const mock of [fetchQuestion, fetchCurrentUser, acceptAnswer, unacceptAnswer]) mock.mockReset()
    fetchCurrentUser.mockResolvedValue({ id: 9, name: '질문자' })
    authSession.reset()
  })
  async function open() {
    const page = mount(QuestionDetail, { questionId: 7 })
    await flush()
    return page
  }
  const answers = (page) => find(page.root, (node) => node.type === 'section' && node.props['aria-labelledby'] === 'answers-title')
  const items = (page) => findAll(answers(page), (node) => node.type === 'li')
  const bodies = (page) => items(page).map((node) => text(find(node, (child) => child.props.class === 'q-answer__body')))

  test('채택된 답변은 맨 위에 "채택된 답변" 배지와 함께(초록 카드), 나머지는 서버 순서', async () => {
    fetchQuestion.mockResolvedValue({ ...question([answer(1), answer(2), answer(3)]), accepted_answer_id: 3 })
    const page = await open()
    expect(bodies(page)).toEqual(['답변 내용 3', '답변 내용 1', '답변 내용 2'])
    expect(items(page).map((node) => node.props.class)).toEqual(['q-answer q-answer--accepted', 'q-answer', 'q-answer'])
    expect(text(find(items(page)[0], (node) => node.props.class === 'q-accepted-badge'))).toBe('✓ 채택된 답변')
    expect(text(find(items(page)[0], (node) => node.props.class === 'cm-avatar'))).toBe('답')
  })

  test('질문을 쓴 사람이 아니면 채택 버튼이 없다(비로그인 포함)', async () => {
    fetchQuestion.mockResolvedValue({ ...question([answer(1), answer(2)]), accepted_answer_id: 1 })
    const page = await open()
    expect(button(answers(page), '채택')).toBeNull()
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } })
    authSession.reset()
    const guest = await open()
    expect(button(answers(guest), '채택')).toBeNull()
  })

  test('질문 작성자: 답변마다 "채택하기", 누르면 처리 중(모든 채택 버튼 잠금) → 결과(질문 상세)로 바꾸고 채택된 답변이 맨 위·"채택 취소"', async () => {
    fetchQuestion.mockResolvedValue(mine([answer(1), answer(2)]))
    const response = deferred()
    acceptAnswer.mockReturnValue(response.promise)
    const page = await open()
    expect(items(page).map((node) => text(find(node, (child) => child.type === 'button' && /채택/.test(text(child)))))).toEqual(['채택하기', '채택하기'])
    button(items(page)[1], '채택하기').props.onClick()
    button(items(page)[1], '채택하기')?.props.onClick()
    await flush()
    expect(acceptAnswer).toHaveBeenCalledTimes(1)
    expect(acceptAnswer).toHaveBeenCalledWith(7, 2)
    expect(text(find(items(page)[1], (node) => node.type === 'button' && node.props['aria-busy'] === true))).toBe('처리 중...')
    expect(button(items(page)[0], '채택하기').props.disabled).toBe(true)
    response.resolve(mine([answer(1), answer(2, { is_accepted: true })], { accepted_answer_id: 2 }))
    await flush()
    expect(bodies(page)).toEqual(['답변 내용 2', '답변 내용 1'])
    expect(button(items(page)[0], '채택 취소')).not.toBeNull()
    expect(button(items(page)[1], '채택하기').props.disabled).toBe(false)
    expect(text(byRole(answers(page), 'status')[0])).toBe('답변을 채택했습니다.')
  })

  test('채택 취소는 DELETE …/accept, 결과로 바꾼다', async () => {
    fetchQuestion.mockResolvedValue(mine([answer(1), answer(2)], { accepted_answer_id: 2 }))
    unacceptAnswer.mockResolvedValue(mine([answer(1), answer(2)], { accepted_answer_id: null }))
    const page = await open()
    await click(button(items(page)[0], '채택 취소'))
    expect(unacceptAnswer).toHaveBeenCalledWith(7, 2)
    expect(acceptAnswer).not.toHaveBeenCalled()
    expect(bodies(page)).toEqual(['답변 내용 1', '답변 내용 2'])
    expect(find(answers(page), (node) => node.props.class === 'q-accepted-badge')).toBeNull()
    expect(text(byRole(answers(page), 'status')[0])).toBe('답변 채택을 취소했습니다.')
  })

  test.each([
    ['403', { response: { status: 403 } }, '질문을 쓴 사람만 답변을 채택할 수 있습니다.'],
    ['401', { response: { status: 401 } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
    ['500', { response: { status: 500 } }, '답변을 채택하지 못했습니다. 다시 시도해 주세요.'],
  ])('채택 실패(%s)면 그 답변 아래 role=alert, 화면은 그대로', async (_name, failure, message) => {
    fetchQuestion.mockResolvedValue(mine([answer(1), answer(2)]))
    acceptAnswer.mockRejectedValue(failure)
    const page = await open()
    await click(button(items(page)[0], '채택하기'))
    expect(text(byRole(items(page)[0], 'alert')[0])).toBe(message)
    expect(byRole(items(page)[1], 'alert')).toEqual([])
    expect(bodies(page)).toEqual(['답변 내용 1', '답변 내용 2'])
    expect(button(items(page)[0], '채택하기').props.disabled).toBe(false)
  })
})
