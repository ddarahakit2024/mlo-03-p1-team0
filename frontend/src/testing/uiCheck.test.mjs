// 화면 점검(frontend/scripts/ui-check.mjs)의 브라우저 없이 확인할 수 있는 부분과 시나리오 파일 형식 테스트.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import scenarios from '../../ui-check/scenarios.mjs'
import { findMock, formatReport, parseMockKey, resolveStatic, validateScenarios } from '../../scripts/ui-check.mjs'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')

test('ui-check/scenarios.mjs 의 형식이 맞다', () => {
  expect(validateScenarios(scenarios)).toEqual([])
})

describe('가짜 응답 찾기', () => {
  const api = {
    'GET /questions/*': { status: 404, body: null },
    'GET /questions/7': { status: 200, body: { id: 7 } },
    'POST /questions': { status: 201, body: { id: 9 } },
  }

  test('정확한 경로가 * 경로보다 먼저다', () => {
    expect(findMock(api, 'GET', '/questions/7').status).toBe(200)
    expect(findMock(api, 'GET', '/questions/8').status).toBe(404)
  })

  test('메서드가 다르거나 구간 수가 다르면 찾지 않는다', () => {
    expect(findMock(api, 'DELETE', '/questions/7')).toBeNull()
    expect(findMock(api, 'GET', '/questions/7/answers')).toBeNull()
    expect(findMock(api, 'POST', '/questions/')).not.toBeNull()
  })

  test('키 형식이 틀리면 고치는 법을 알려 준다', () => {
    expect(() => parseMockKey('/questions')).toThrow('GET /questions/*')
  })
})

test('시나리오 형식 오류를 문장으로 돌려준다', () => {
  const problems = validateScenarios([
    { name: 'Bad Name', path: 'questions', expect: [] },
    { name: 'dup', path: '/', expect: ['a'], api: { 'GET /a': { body: {} } } },
    { name: 'dup', path: '/', expect: ['a'] },
  ])
  expect(problems.join('\n')).toMatch(/kebab-case/)
  expect(problems.join('\n')).toMatch(/path 는 \/ 로 시작/)
  expect(problems.join('\n')).toMatch(/expect/)
  expect(problems.join('\n')).toMatch(/status/)
  expect(problems.join('\n')).toMatch(/중복/)
})

test('정적 파일: 확장자 없는 주소는 index.html, dist 밖은 막는다', () => {
  expect(resolveStatic(dist, '/questions/7?x=1')).toBe(join(dist, 'index.html'))
  expect(resolveStatic(dist, '/missing.js')).toBeNull()
  expect(resolveStatic(dist, '/../package.json')).toBeNull()
  expect(resolveStatic(dist, '/%E0%A4%A')).toBeNull()
})

test('보고서에 실패 내용과 스크린샷 경로가 들어간다', () => {
  const report = formatReport([
    { scenario: 'questions', path: '/questions', viewport: 'mobile', problems: ['가로 스크롤'], screenshot: '.agent-loop/ui/questions--mobile.png' },
    { scenario: 'questions', path: '/questions', viewport: 'desktop', problems: [], screenshot: '.agent-loop/ui/questions--desktop.png' },
  ], '2026. 10. 29.')
  expect(report).toContain('실패 1개')
  expect(report).toContain('### questions / mobile')
  expect(report).toContain('.agent-loop/ui/questions--desktop.png')
})
