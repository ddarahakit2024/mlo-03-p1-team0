// 로그인 화면(views/LoginPage.vue)의 상태별 렌더링. 로그인 창(AuthDialog)은 stub 이라 넘긴 props 로 확인한다.
import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SRC, button, byId, byRole, click, compileSfc, deferred, find, findAll, flush, mount, setValue, stub, submit, text } from './testing/sfc.mjs'
import { COMMUNITY_PURPOSES } from './stores/communityViewModel.js'

const loginWithEmail = jest.fn()
const signupWithEmail = jest.fn()
const loginWithKakao = jest.fn()
const goToMain = jest.fn()
// 로그인 뒤 공용 로그인 상태와 헤더 숫자(siteStatus)를 다시 부른다. 테스트에서는 네트워크를 쓰지 않게 가짜를 넘긴다
const authSession = { refresh: jest.fn() }
const siteStatus = { refresh: jest.fn() }
let LoginPage

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function setWindow({ pathname = '/login', search = '', storage = createStorage(), Kakao } = {}) {
  global.window = {
    location: { pathname, search, origin: 'http://localhost:5173' },
    sessionStorage: storage,
    history: { replaceState: jest.fn() },
    crypto: { getRandomValues: (bytes) => bytes.fill(1) },
    Kakao,
  }
  return global.window
}

const dialog = (page) => stub(page.root, 'AuthDialog').props
const signup = { mode: 'signup', name: '김학습', email: 'learner@example.com', password: 'password1' }
const login = { mode: 'login', email: 'learner@example.com', password: 'password1' }

beforeAll(async () => {
  LoginPage = await compileSfc('views/LoginPage.vue', { loginWithEmail, signupWithEmail, loginWithKakao, goToMain, authSession, siteStatus }, {
    env: { MODE: 'test', VITE_KAKAO_JAVASCRIPT_KEY: 'kakao-js-key' },
  })
})
beforeEach(() => {
  jest.resetAllMocks()
  setWindow()
})
afterEach(() => { delete global.window })

describe('이메일 로그인·회원가입', () => {
  test('처음에는 로그인 창을 열고 진행 상태는 없다', async () => {
    const page = mount(LoginPage)
    await flush()
    expect(dialog(page)['model-value']).toBe(true)
    expect(dialog(page)['initial-mode']).toBe('login')
    expect(byRole(page.root, 'status')).toHaveLength(0)
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('auth')
  })

  test('가입에 성공하면 로그인 모드로 바꾸고 안내 문구를 보여 준다', async () => {
    signupWithEmail.mockResolvedValue({ id: 1, email: signup.email, name: signup.name })
    const page = mount(LoginPage)
    await dialog(page).onSubmit(signup)
    await flush()
    expect(signupWithEmail).toHaveBeenCalledWith(signup)
    expect(dialog(page).notice).toBe('가입이 완료되었습니다. 로그인해 주세요.')
    expect(dialog(page).error).toBe('')
    expect(dialog(page)['initial-mode']).toBe('login')
    expect(goToMain).not.toHaveBeenCalled()
  })

  test('로그인 중에는 버튼을 막고 두 번 보내지 않으며, 성공하면 로그인 상태·헤더 숫자를 다시 부르고 메인으로 이동한다', async () => {
    const response = deferred()
    loginWithEmail.mockReturnValue(response.promise)
    const page = mount(LoginPage)
    dialog(page).onSubmit(login)
    await flush()
    expect(dialog(page).loading).toBe(true)
    dialog(page).onSubmit(login)
    expect(loginWithEmail).toHaveBeenCalledTimes(1)
    expect(siteStatus.refresh).not.toHaveBeenCalled()
    response.resolve({ authenticated: true })
    await flush()
    expect(authSession.refresh).toHaveBeenCalledTimes(1)
    expect(siteStatus.refresh).toHaveBeenCalledTimes(1)
    expect(goToMain).toHaveBeenCalledWith()
    expect(dialog(page).loading).toBe(false)
  })

  test.each([
    ['로그인 실패(401)', { response: { status: 401, data: { message: '이메일 또는 비밀번호가 올바르지 않습니다.' } } }, '이메일 또는 비밀번호를 확인해 주세요.'],
    ['서버 연결 실패', { isAxiosError: true, code: 'ERR_NETWORK' }, '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.'],
    ['HTML 502 응답', { isAxiosError: true, response: { status: 502, data: '<html>Bad Gateway</html>' } }, '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
  ])('%s 이면 오류 문구를 보여 주고 이동하지 않는다', async (_name, failure, expected) => {
    loginWithEmail.mockRejectedValue(failure)
    const page = mount(LoginPage)
    await dialog(page).onSubmit(login)
    await flush()
    expect(dialog(page).error).toBe(expected)
    expect(dialog(page).notice).toBe('')
    expect(dialog(page).loading).toBe(false)
    expect(goToMain).not.toHaveBeenCalled()
    expect(siteStatus.refresh).not.toHaveBeenCalled()
  })

  test('이미 가입된 이메일(409)이면 로그인을 안내한다', async () => {
    signupWithEmail.mockRejectedValue({ response: { status: 409, data: { message: '이미 사용 중인 이메일입니다.' } } })
    const page = mount(LoginPage)
    await dialog(page).onSubmit(signup)
    await flush()
    expect(dialog(page).error).toBe('이미 가입된 이메일입니다. 로그인해 주세요.')
    expect(dialog(page)['initial-mode']).toBe('signup')
  })

  test('공백뿐인 이름은 서버로 보내지 않고 바로 알려 준다', async () => {
    const page = mount(LoginPage)
    await dialog(page).onSubmit({ ...signup, name: '' })
    await flush()
    expect(dialog(page).error).toBe('이름을 입력해 주세요.')
    expect(signupWithEmail).not.toHaveBeenCalled()
  })

  test('모드를 바꾸면 이전 오류 문구를 지운다', async () => {
    loginWithEmail.mockRejectedValue({ response: { status: 401 } })
    const page = mount(LoginPage)
    await dialog(page).onSubmit(login)
    await flush()
    dialog(page).onSwitchMode('signup')
    await flush()
    expect(dialog(page).error).toBe('')
    expect(dialog(page)['initial-mode']).toBe('signup')
  })

  test('창을 닫으면 메인으로 이동한다', async () => {
    const page = mount(LoginPage)
    dialog(page)['onUpdate:modelValue'](false)
    expect(goToMain).toHaveBeenCalledWith()
  })
})

describe('카카오 로그인', () => {
  test('카카오 버튼은 콜백 주소와 1회용 state 로 인가를 시작한다', async () => {
    const storage = createStorage()
    const Kakao = { isInitialized: () => true, init: jest.fn(), Auth: { authorize: jest.fn() } }
    setWindow({ storage, Kakao })
    const page = mount(LoginPage)
    dialog(page).onSocialLogin('kakao')
    await flush()
    expect(Kakao.Auth.authorize).toHaveBeenCalledWith({ redirectUri: 'http://localhost:5173/login/kakao/callback', scope: 'profile_nickname', state: '01'.repeat(16) })
    expect(storage.getItem('kakao_oauth_state')).toBe('01'.repeat(16))
    expect(dialog(page).error).toBe('')
  })

  test('카카오 SDK 가 없으면 준비 실패 문구를 보여 준다', async () => {
    const page = mount(LoginPage)
    dialog(page).onSocialLogin('kakao')
    await flush()
    expect(dialog(page).error).toBe('카카오 로그인을 준비하지 못했습니다. 이메일로 로그인하거나 잠시 후 다시 시도해 주세요.')
  })

  test('콜백 처리 중에는 로그인 창 대신 진행 상태를 보여 주고, 성공하면 메인으로 이동한다', async () => {
    const exchange = deferred()
    loginWithKakao.mockReturnValue(exchange.promise)
    const browser = setWindow({ pathname: '/login/kakao/callback', search: '?code=auth-code&state=saved', storage: createStorage({ kakao_oauth_state: 'saved' }) })
    const page = mount(LoginPage)
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toBe('카카오 로그인을 확인하는 중입니다...')
    expect(dialog(page)['model-value']).toBe(false)
    expect(loginWithKakao).toHaveBeenCalledWith('auth-code')
    expect(browser.history.replaceState).toHaveBeenCalledWith({}, '', '/login')
    exchange.resolve({ authenticated: true })
    await flush()
    expect(siteStatus.refresh).toHaveBeenCalledTimes(1)
    expect(goToMain).toHaveBeenCalledWith()
    expect(byRole(page.root, 'status')).toHaveLength(1)
  })

  test('콜백 로그인이 실패하면 진행 상태를 없애고 로그인 창에 오류를 보여 준다', async () => {
    loginWithKakao.mockRejectedValue({ response: { status: 502 } })
    setWindow({ pathname: '/login/kakao/callback', search: '?code=auth-code&state=saved', storage: createStorage({ kakao_oauth_state: 'saved' }) })
    const page = mount(LoginPage)
    await flush()
    expect(byRole(page.root, 'status')).toHaveLength(0)
    expect(dialog(page)['model-value']).toBe(true)
    expect(dialog(page).error).toBe('카카오 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(goToMain).not.toHaveBeenCalled()
  })

  test('state 가 다르면 코드를 교환하지 않고 다시 시도를 안내한다', async () => {
    setWindow({ pathname: '/login/kakao/callback', search: '?code=auth-code&state=forged', storage: createStorage({ kakao_oauth_state: 'saved' }) })
    const page = mount(LoginPage)
    await flush()
    expect(loginWithKakao).not.toHaveBeenCalled()
    expect(dialog(page).error).toBe('로그인 요청을 확인할 수 없습니다. 카카오 로그인을 처음부터 다시 시도해 주세요.')
  })

  test('세션 저장소를 쓸 수 없어도 진행 상태에 멈추지 않는다', async () => {
    const storage = { getItem() { throw new Error('SecurityError') }, setItem() {}, removeItem() {} }
    setWindow({ pathname: '/login/kakao/callback', search: '?code=auth-code&state=saved', storage })
    const page = mount(LoginPage)
    await flush()
    expect(byRole(page.root, 'status')).toHaveLength(0)
    expect(dialog(page).error).toBe('카카오 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
  })
})

describe('회원가입 사용 목적(spec 2026-11-01-build-id-purpose)', () => {
  test('주소가 /login?mode=signup 이면 회원가입 창으로 연다', async () => {
    setWindow({ search: '?mode=signup' })
    const page = mount(LoginPage)
    await flush()
    expect(dialog(page)['initial-mode']).toBe('signup')
  })

  test('카카오 콜백 주소는 ?mode=signup 이 있어도 로그인 창이다', async () => {
    setWindow({ pathname: '/login/kakao/callback', search: '?mode=signup&code=c&state=s', storage: createStorage({ kakao_oauth_state: 's' }) })
    loginWithKakao.mockRejectedValue(new Error('fail'))
    const page = mount(LoginPage)
    await flush()
    expect(dialog(page)['initial-mode']).toBe('login')
  })

  test('고른 사용 목적을 그대로 가입 요청에 넘긴다', async () => {
    signupWithEmail.mockResolvedValue({ id: 1, email: signup.email, name: signup.name })
    const page = mount(LoginPage)
    await dialog(page).onSubmit({ ...signup, purpose: 'office' })
    await flush()
    expect(signupWithEmail).toHaveBeenCalledWith({ ...signup, purpose: 'office' })
    expect(dialog(page).notice).toBe('가입이 완료되었습니다. 로그인해 주세요.')
  })

  test('목록에 없는 사용 목적이면 서버로 보내지 않고 알려 준다', async () => {
    const page = mount(LoginPage)
    await dialog(page).onSubmit({ ...signup, purpose: 'mining' })
    await flush()
    expect(signupWithEmail).not.toHaveBeenCalled()
    expect(dialog(page).error).toBe('사용 목적을 목록에서 다시 골라 주세요.')
  })

  test('서버가 422(모르는 사용 목적)로 거절하면 입력 확인 문구', async () => {
    signupWithEmail.mockRejectedValue({ response: { status: 422, data: { message: '입력값이 올바르지 않습니다.' } } })
    const page = mount(LoginPage)
    await dialog(page).onSubmit({ ...signup, purpose: 'gaming' })
    await flush()
    expect(dialog(page).error).toBe('입력 정보를 다시 확인해 주세요.')
  })
})

describe('AuthDialog: 사용 목적(선택) select', () => {
  // 대화상자는 body 로 Teleport 한다. 테스트 렌더러에는 body 가 없어 Teleport 를 div 로 바꿔 컴파일한다(나머지는 그대로)
  const source = readFileSync(join(SRC, 'components', 'AuthDialog.vue'), 'utf8').replace(/<Teleport\b[^>]*>/, '<div data-teleport="body">').replace('</Teleport>', '</div>')
  let AuthDialog
  beforeAll(async () => { AuthDialog = await compileSfc('components/AuthDialog.vue', {}, { source }) })
  const open = async (initialMode, onSubmit = jest.fn()) => {
    const page = mount(AuthDialog, { modelValue: true, initialMode, onSubmit })
    await flush()
    return { page, onSubmit }
  }
  // 입력을 감싼 label 의 글자(시뮬레이터의 get_by_label 이름)
  const labelText = (root, node) => {
    const label = find(root, (item) => item.type === 'label' && findAll(item, (child) => child === node).length > 0)
    return label ? text(label).trim() : ''
  }
  const fill = async (root, values) => {
    const inputs = findAll(root, (node) => node.type === 'input')
    for (const input of inputs) if (values[input.props.name] !== undefined) await setValue(input, values[input.props.name])
  }

  test('페이지 안의 로그인 폼은 모달로 알리지 않고 기존 입력과 제출을 유지한다', async () => {
    const onSubmit = jest.fn()
    const onClose = jest.fn()
    const page = mount(AuthDialog, { modelValue: true, inline: true, onSubmit, 'onUpdate:modelValue': onClose })
    await flush()
    const section = find(page.root, (node) => node.type === 'section')
    expect(section.props.role).toBeUndefined()
    expect(section.props['aria-modal']).toBeUndefined()
    const backdrop = find(page.root, (node) => node.props.class?.includes?.('auth-dialog-backdrop'))
    backdrop.props.onClick({ target: backdrop, currentTarget: backdrop })
    backdrop.props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    expect(onClose).not.toHaveBeenCalled()
    await fill(page.root, { email: 'builder@example.com', password: 'password1' })
    await submit(page.root)
    expect(onSubmit).toHaveBeenCalledWith({ mode: 'login', name: '', email: 'builder@example.com', password: 'password1' })
  })

  test('페이지 안의 로그인 카드(디자인): 로고(64px)·h1 "MOA Parts 로그인"·안내 문구, 회원가입이면 h1 "MOA Parts 회원가입". 모달 머리말(닫기)은 없다', async () => {
    const page = mount(AuthDialog, { modelValue: true, inline: true })
    await flush()
    const brand = find(page.root, (node) => node.type === 'header')
    expect(find(brand, (node) => node.type === 'img').props).toMatchObject({ src: '/images/logo.png', alt: '' })
    expect(text(find(brand, (node) => node.type === 'h1'))).toBe('MOA Parts 로그인')
    expect(text(brand)).toContain('가격 알림, 견적 요청, 질문은 로그인 후 이용할 수 있어요.')
    expect(find(page.root, (node) => node.type === 'section').props['aria-labelledby']).toBe('auth-inline-title')
    expect(find(page.root, (node) => node.props['aria-label'] === '닫기')).toBeNull()
    expect(text(page.root)).not.toContain('데모 계정')
    await click(button(page.root, '회원가입'))
    expect(text(find(page.root, (node) => node.type === 'h1'))).toBe('MOA Parts 회원가입')
  })

  test('회원가입 창: 이름·이메일 주소·비밀번호 다음에 "사용 목적(선택)" select(선택 안 함 + 견적 게시판 용도), 시뮬레이터가 쓰는 이름은 그대로', async () => {
    const { page } = await open('signup')
    const select = byId(page.root, 'auth-dialog-purpose')
    expect(select.type).toBe('select')
    expect(text(find(page.root, (node) => node.type === 'label' && node.props.for === 'auth-dialog-purpose'))).toBe('사용 목적(선택)')
    const options = findAll(select, (node) => node.type === 'option')
    expect(options.map((node) => [node.props.value, text(node)])).toEqual([['', '선택 안 함'], ...COMMUNITY_PURPOSES.map(({ code, name }) => [code, name])])
    expect(select.props.value).toBe('')
    const inputs = findAll(page.root, (node) => node.type === 'input')
    expect(inputs.map((input) => labelText(page.root, input))).toEqual(['이름', '이메일 주소', '비밀번호'])
    expect(button(page.root, '계정 만들기').props.type).toBe('submit')
    expect(button(page.root, '로그인').props.type).toBe('button')
  })

  test('고르지 않고 가입하면 purpose: null, 고르면 그 코드로 submit 한다', async () => {
    const { page, onSubmit } = await open('signup')
    await fill(page.root, { name: ' 김학습 ', email: 'learner@example.com', password: 'password1' })
    await submit(page.root)
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: 'signup', name: '김학습', email: 'learner@example.com', password: 'password1', purpose: null })
    byId(page.root, 'auth-dialog-purpose').props.onChange({ target: { value: 'creative' } })
    await flush()
    expect(byId(page.root, 'auth-dialog-purpose').props.value).toBe('creative')
    await submit(page.root)
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: 'signup', name: '김학습', email: 'learner@example.com', password: 'password1', purpose: 'creative' })
  })

  test('로그인 창에는 사용 목적이 없고 submit 에도 넣지 않는다', async () => {
    const { page, onSubmit } = await open('login')
    expect(byId(page.root, 'auth-dialog-purpose')).toBeNull()
    expect(text(page.root)).not.toContain('사용 목적')
    await fill(page.root, { email: 'learner@example.com', password: 'password1' })
    await submit(page.root)
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: 'login', name: '', email: 'learner@example.com', password: 'password1' })
    await click(button(page.root, '회원가입'))
    expect(byId(page.root, 'auth-dialog-purpose')).not.toBeNull()
  })
})
