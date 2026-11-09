// 로그인 상태 공용 저장소(src/stores/authSession.js): GET /user/me 를 한 번만 부르고(진행 중이면 같은 Promise),
// 401 → guest, 그 밖의 실패 → error, 다시 부르기(refresh), 로그아웃 뒤 다시 부르기, 구독.
import { jest } from '@jest/globals'
import { deferred } from './testing/sfc.mjs'
import { AUTH_STATUSES, authStateFromError, authStateFromProfile, createAuthSession, memberProfile } from './stores/authSession.js'

const member = { id: 1, name: '김학습' }
const unauthorized = { response: { status: 401, data: { message: '로그인이 필요합니다.' } } }

function setup() {
  const fetchCurrentUser = jest.fn()
  const logout = jest.fn()
  return { fetchCurrentUser, logout, session: createAuthSession({ fetchCurrentUser, logout }) }
}

describe('상태 계산', () => {
  test('상태는 loading·member·guest·error 네 가지다', () => expect(AUTH_STATUSES).toEqual(['loading', 'member', 'guest', 'error']))

  test.each([
    ['401', unauthorized, 'guest'],
    ['403', { response: { status: 403 } }, 'error'],
    ['500', { response: { status: 500 } }, 'error'],
    ['네트워크', { isAxiosError: true, code: 'ERR_NETWORK' }, 'error'],
    ['알 수 없는 오류', new Error('boom'), 'error'],
  ])('실패 %s → %s (원래 오류를 남긴다)', (_name, error, status) => {
    expect(authStateFromError(error)).toEqual({ status, profile: null, error })
  })

  test.each([
    [member, { status: 'member', profile: member, error: null }],
    [null, { status: 'guest', profile: null, error: null }],
  ])('성공 응답 %j', (profile, state) => expect(authStateFromProfile(profile)).toEqual(state))

  test.each([
    [{ status: 'member', profile: member }, member],
    [{ status: 'guest', profile: null }, null],
    [{ status: 'loading', profile: null }, null],
    [null, null],
  ])('memberProfile(%j)', (state, profile) => expect(memberProfile(state)).toBe(profile))
})

describe('한 번만 부르기', () => {
  test('처음 상태는 loading 이고, 동시에 부르면 같은 Promise 로 /user/me 를 한 번만 부른다', async () => {
    const { session, fetchCurrentUser } = setup()
    const response = deferred()
    fetchCurrentUser.mockReturnValue(response.promise)
    expect(session.getState()).toEqual({ status: 'loading', profile: null, error: null })
    const layout = session.load()
    const view = session.load()
    expect(view).toBe(layout)
    response.resolve(member)
    await expect(layout).resolves.toEqual({ status: 'member', profile: member, error: null })
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
  })

  test('끝난 뒤에 부르면 저장한 결과를 돌려주고 다시 부르지 않는다(guest·error 도 같다)', async () => {
    const { session, fetchCurrentUser } = setup()
    fetchCurrentUser.mockRejectedValue(unauthorized)
    await session.load()
    await expect(session.load()).resolves.toMatchObject({ status: 'guest' })
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
  })

  test('Promise 는 실패해도 reject 하지 않는다: 500 이면 error 상태와 원래 오류', async () => {
    const { session, fetchCurrentUser } = setup()
    const failure = { response: { status: 500 } }
    fetchCurrentUser.mockRejectedValue(failure)
    await expect(session.load()).resolves.toEqual({ status: 'error', profile: null, error: failure })
  })

  test('refresh 는 다시 부르고 결과를 바꾼다(다시 시도·로그인 상태 다시 확인)', async () => {
    const { session, fetchCurrentUser } = setup()
    fetchCurrentUser.mockRejectedValueOnce(unauthorized).mockResolvedValueOnce(member)
    await session.load()
    await expect(session.refresh()).resolves.toMatchObject({ status: 'member', profile: member })
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
    expect(session.getState().status).toBe('member')
  })

  test('진행 중에 refresh 하면 늦게 온 이전 결과는 버리고, 이전 호출도 새 결과를 받는다', async () => {
    const { session, fetchCurrentUser } = setup()
    const first = deferred()
    const second = deferred()
    fetchCurrentUser.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const before = session.load()
    const after = session.refresh()
    second.resolve(member)
    await after
    first.reject(unauthorized)
    await expect(before).resolves.toMatchObject({ status: 'member' })
    expect(session.getState().status).toBe('member')
  })
})

describe('구독', () => {
  test('구독하면 지금 상태를 바로 받고, 바뀔 때마다(loading → 결과) 받는다. 해제하면 받지 않는다', async () => {
    const { session, fetchCurrentUser } = setup()
    fetchCurrentUser.mockResolvedValueOnce(member).mockRejectedValueOnce(unauthorized)
    const seen = []
    const stop = session.subscribe((state) => seen.push(state.status))
    await session.load()
    await session.refresh()
    expect(seen).toEqual(['loading', 'member', 'loading', 'guest'])
    stop()
    await session.refresh()
    expect(seen).toHaveLength(4)
  })

  test('한 구독자가 던져도 다른 구독자는 받는다', async () => {
    const { session, fetchCurrentUser } = setup()
    fetchCurrentUser.mockResolvedValue(member)
    const other = jest.fn()
    session.subscribe(() => { throw new Error('broken view') })
    session.subscribe(other)
    await expect(session.load()).resolves.toMatchObject({ status: 'member' })
    expect(other).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'member' }))
  })
})

describe('로그아웃', () => {
  test('POST /user/logout 에 성공하면 /user/me 를 다시 불러 guest 가 된다', async () => {
    const { session, fetchCurrentUser, logout } = setup()
    fetchCurrentUser.mockResolvedValueOnce(member).mockRejectedValueOnce(unauthorized)
    logout.mockResolvedValue(null)
    await session.load()
    await session.logout()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
    await expect(session.load()).resolves.toMatchObject({ status: 'guest', profile: null })
  })

  test('로그아웃이 실패하면 그 오류를 던지고 다시 부르지 않는다(화면이 문구를 보여 준다)', async () => {
    const { session, fetchCurrentUser, logout } = setup()
    const failure = { isAxiosError: true, code: 'ERR_NETWORK' }
    fetchCurrentUser.mockResolvedValue(member)
    logout.mockRejectedValue(failure)
    await session.load()
    await expect(session.logout()).rejects.toBe(failure)
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1)
    expect(session.getState().status).toBe('member')
  })
})

test('reset 은 처음 상태로 돌리고 진행 중인 결과를 버린다(다음 load 가 다시 부른다)', async () => {
  const { session, fetchCurrentUser } = setup()
  const pending = deferred()
  fetchCurrentUser.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(member)
  session.load()
  session.reset()
  pending.reject(unauthorized)
  await expect(session.load()).resolves.toMatchObject({ status: 'member' })
  expect(fetchCurrentUser).toHaveBeenCalledTimes(2)
})
