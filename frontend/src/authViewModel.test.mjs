import { jest } from '@jest/globals'
import {
  SIGNUP_PURPOSES,
  authError,
  authModeFromSearch,
  beginKakaoLogin,
  completeKakaoCallback,
  createOAuthState,
  goToMain,
  isKakaoCallback,
  kakaoLoginError,
  kakaoRedirectUri,
  profileInitial,
  signupPurpose,
  validateCredentials,
} from './stores/authViewModel.js'
import { COMMUNITY_PURPOSES } from './stores/communityViewModel.js'

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('입력 검증', () => {
  const signup = { mode: 'signup', name: '김학습', email: 'person@example.com', password: 'password1' }

  test.each([
    [{ ...signup }, ''],
    [{ ...signup, name: '   ' }, '이름을 입력해 주세요.'],
    [{ ...signup, name: '가'.repeat(101) }, '이름은 100자까지 입력할 수 있습니다.'],
    [{ ...signup, email: ' ' }, '이메일 주소를 입력해 주세요.'],
    [{ ...signup, email: 'person@' }, '올바른 이메일 주소를 입력해 주세요. 예: name@example.com'],
    [{ ...signup, email: `${'a'.repeat(310)}@example.com` }, '이메일 주소는 320자까지 입력할 수 있습니다.'],
    [{ ...signup, password: '' }, '비밀번호를 입력해 주세요.'],
    [{ ...signup, password: '1234567' }, '비밀번호는 8자 이상 입력해 주세요.'],
    [{ ...signup, password: 'a'.repeat(129) }, '비밀번호는 128자까지 입력할 수 있습니다.'],
    [{ mode: 'login', email: 'person', password: 'x' }, ''],
    [{ mode: 'login', email: 'person@example.com', password: '' }, '비밀번호를 입력해 주세요.'],
    // 사용 목적(선택, spec 2026-11-01-build-id-purpose): null·목록의 코드만 받는다. 로그인에서는 보지 않는다
    [{ ...signup, purpose: null }, ''],
    [{ ...signup, purpose: 'development' }, ''],
    [{ ...signup, purpose: 'mining' }, '사용 목적을 목록에서 다시 골라 주세요.'],
    [{ ...signup, name: '', purpose: 'mining' }, '이름을 입력해 주세요.'],
    [{ mode: 'login', email: 'person@example.com', password: 'x', purpose: 'mining' }, ''],
  ])('%o → "%s"', (input, expected) => {
    expect(validateCredentials(input)).toBe(expected)
  })
})

describe('회원가입 사용 목적·화면 모드', () => {
  test('사용 목적 옵션은 견적 게시판 용도와 같은 코드·이름이다', () => {
    expect(SIGNUP_PURPOSES).toEqual(COMMUNITY_PURPOSES.map(({ code, name }) => ({ code, name })))
    expect(SIGNUP_PURPOSES.map((item) => item.code)).toEqual(['gaming', 'office', 'creative', 'development', 'other'])
  })

  test.each([
    ['', null], [null, null], [undefined, null], ['gaming', 'gaming'], ['other', 'other'],
  ])('select 값 %p → 보낼 값 %p', (value, expected) => expect(signupPurpose(value)).toBe(expected))

  test.each([
    ['?mode=signup', 'signup'], ['mode=signup', 'signup'], ['?mode=login', 'login'], ['', 'login'], [undefined, 'login'], ['?mode=SIGNUP', 'login'], ['?code=1&mode=signup', 'signup'],
  ])('로그인 화면 주소 %p → %s 창', (search, mode) => expect(authModeFromSearch(search)).toBe(mode))
})

describe('이메일 로그인·회원가입 오류 문구', () => {
  test.each([
    ['409 중복 가입', { response: { status: 409, data: { message: '이미 사용 중인 이메일입니다.' } } }, '이미 가입된 이메일입니다. 로그인해 주세요.'],
    ['401 로그인 실패', { response: { status: 401, data: { message: '이메일 또는 비밀번호가 올바르지 않습니다.' } } }, '이메일 또는 비밀번호를 확인해 주세요.'],
    ['422 입력 오류', { response: { status: 422, data: { message: '요청 값이 올바르지 않습니다.' } } }, '입력 정보를 다시 확인해 주세요.'],
    ['서버 연결 실패', { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' }, '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.'],
    ['서버 메시지', { response: { status: 500, data: { message: '서버 내부 오류가 발생했습니다.' } } }, '서버 내부 오류가 발생했습니다.'],
    ['HTML 502 응답', { isAxiosError: true, response: { status: 502, data: '<html><body>Bad Gateway</body></html>' } }, '기본 문구'],
    ['알 수 없는 오류', new Error('boom'), '기본 문구'],
  ])('%s', (_name, error, expected) => {
    expect(authError(error, '기본 문구')).toBe(expected)
  })

  test('기본 문구를 넘기지 않으면 다시 시도를 안내한다', () => {
    expect(authError({})).toBe('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  })
})

describe('카카오 로그인 오류 문구', () => {
  test.each([
    ['not_configured', '카카오 로그인을 준비하지 못했습니다. 이메일로 로그인하거나 잠시 후 다시 시도해 주세요.'],
    ['invalid_state', '로그인 요청을 확인할 수 없습니다. 카카오 로그인을 처음부터 다시 시도해 주세요.'],
    ['cancelled', '카카오 로그인을 취소했습니다. 다시 시도하거나 이메일로 로그인해 주세요.'],
    ['kakao_error', '카카오에서 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
    ['missing_code', '카카오 인증 정보를 받지 못했습니다. 카카오 로그인을 다시 시도해 주세요.'],
    ['exchange_failed', '카카오 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
    [undefined, '카카오 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'],
  ])('%s', (code, expected) => {
    expect(kakaoLoginError(code)).toBe(expected)
  })
})

describe('카카오 인증 흐름', () => {
  test.each([
    ['/login/kakao/callback', true],
    ['/login', false],
    ['/login/kakao/callback/extra', false],
  ])('%s 는 콜백 주소인가: %s', (path, expected) => {
    expect(isKakaoCallback(path)).toBe(expected)
  })

  test('콜백 주소는 현재 origin 을 쓴다', () => {
    expect(kakaoRedirectUri('http://localhost:5173')).toBe('http://localhost:5173/login/kakao/callback')
    expect(kakaoRedirectUri('https://www.mlops.kro.kr')).toBe('https://www.mlops.kro.kr/login/kakao/callback')
  })

  test('state 는 crypto 로 만든 32자리 hex 다', () => {
    const crypto = { getRandomValues: jest.fn((bytes) => bytes.fill(171)) }
    expect(createOAuthState(crypto)).toBe('ab'.repeat(16))
    expect(createOAuthState()).toMatch(/^[0-9a-f]{32}$/)
  })

  test('starts Kakao authorization with nickname-only scope and a saved state', () => {
    const storage = createStorage()
    const sdk = {
      isInitialized: () => false,
      init: jest.fn(),
      Auth: { authorize: jest.fn() },
    }

    beginKakaoLogin({
      sdk,
      key: 'javascript-key',
      redirectUri: 'http://localhost:5173/login/kakao/callback',
      storage,
      state: 'one-time-state',
    })

    expect(sdk.init).toHaveBeenCalledWith('javascript-key')
    expect(sdk.Auth.authorize).toHaveBeenCalledWith({
      redirectUri: 'http://localhost:5173/login/kakao/callback',
      scope: 'profile_nickname',
      state: 'one-time-state',
    })
    expect(storage.getItem('kakao_oauth_state')).toBe('one-time-state')
  })

  test('SDK 나 키가 없으면 인가 요청 없이 실패한다', () => {
    expect(() => beginKakaoLogin({ sdk: undefined, key: 'key', redirectUri: 'http://localhost/cb', storage: createStorage(), state: 's' })).toThrow('kakao_not_configured')
  })

  test('exchanges the callback code only after matching state and clears the callback URL', async () => {
    const storage = createStorage({ kakao_oauth_state: 'one-time-state' })
    const history = { replaceState: jest.fn() }
    const exchangeCode = jest.fn().mockResolvedValue({ authenticated: true })

    const result = await completeKakaoCallback({
      search: '?code=authorization-code&state=one-time-state',
      storage,
      history,
      exchangeCode,
    })

    expect(result).toEqual({ ok: true })
    expect(exchangeCode).toHaveBeenCalledWith('authorization-code')
    expect(history.replaceState).toHaveBeenCalledWith({}, '', '/login')
    expect(storage.getItem('kakao_oauth_state')).toBeNull()
  })

  test.each([
    ['missing', '?code=authorization-code'],
    ['mismatched', '?code=authorization-code&state=other-state'],
  ])('does not exchange an authorization code when state is %s', async (_reason, search) => {
    const exchangeCode = jest.fn()
    const result = await completeKakaoCallback({
      search,
      storage: createStorage({ kakao_oauth_state: 'one-time-state' }),
      history: { replaceState: jest.fn() },
      exchangeCode,
    })

    expect(result).toEqual({ ok: false, error: 'invalid_state' })
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  test.each([
    ['cancelled', '?error=access_denied&state=one-time-state'],
    ['kakao_error', '?error=server_error&state=one-time-state'],
    ['missing_code', '?state=one-time-state'],
  ])('reports %s without exchanging a code', async (expected, search) => {
    const exchangeCode = jest.fn()
    const result = await completeKakaoCallback({
      search,
      storage: createStorage({ kakao_oauth_state: 'one-time-state' }),
      history: { replaceState: jest.fn() },
      exchangeCode,
    })

    expect(result).toEqual({ ok: false, error: expected })
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  test('reports a rejected backend code exchange', async () => {
    const result = await completeKakaoCallback({
      search: '?code=authorization-code&state=one-time-state',
      storage: createStorage({ kakao_oauth_state: 'one-time-state' }),
      history: { replaceState: jest.fn() },
      exchangeCode: jest.fn().mockRejectedValue(new Error('invalid code')),
    })

    expect(result).toEqual({ ok: false, error: 'exchange_failed' })
  })

  test('메인으로 이동한다', () => {
    const location = { assign: jest.fn() }
    goToMain(location)
    expect(location.assign).toHaveBeenCalledWith('/')
  })
})

test.each([
  ['김조립', '김'],
  ['  서지훈 ', '서'],
  ['Builder', 'B'],
  ['😀하하', '😀'],
  ['', 'M'],
  [null, 'M'],
  [undefined, 'M'],
])('profileInitial(%p) → %p (헤더·마이페이지 동그라미)', (name, expected) => {
  expect(profileInitial(name)).toBe(expected)
})
