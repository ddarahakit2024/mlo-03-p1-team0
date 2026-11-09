/**
 * 화면 점검(UI check): 빌드한 화면(frontend/dist)을 실제 브라우저로 열어 확인하고 스크린샷을 남긴다.
 *
 * - 백엔드는 띄우지 않는다. API 요청은 frontend/ui-check/scenarios.mjs 의 가짜 응답으로 대신하고,
 *   그 밖의 외부 요청(폰트, SDK, 운영 API)은 모두 막는다.
 * - 실패로 보는 것: 기대 문구가 안 보임, 가짜 응답이 없는 API 요청, 페이지·콘솔 오류,
 *   화면 폭보다 넓어 생기는 가로 스크롤, 이름 없는 버튼·링크·입력 요소
 * - 결과: .agent-loop/ui/report.md, .agent-loop/ui/<시나리오>--<desktop|mobile>.png
 *   마지막 줄은 UI CHECK PASS (<n>개 화면) 또는 UI CHECK FAIL: <n>
 *
 * 사용: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -UI  (빌드 후 이 파일을 실행)
 *       node frontend/scripts/ui-check.mjs [--only 이름,이름]   (이미 빌드했을 때)
 * 준비(한 번): cd frontend; npm install -D --save-exact playwright-core@1.64.1
 *       브라우저는 PC에 설치된 Edge·Chrome 을 쓴다. 바꾸려면 UI_CHECK_BROWSER=chrome|msedge
 */
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(FRONTEND, '..')
const DIST = join(FRONTEND, 'dist')
const OUT = join(ROOT, '.agent-loop', 'ui')
const SCENARIOS = join(FRONTEND, 'ui-check', 'scenarios.mjs')
const PLAYWRIGHT_HINT = 'cd frontend; npm install -D --save-exact playwright-core@1.64.1'

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 740 },
]

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}

const MOCK_KEY = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/

export function parseMockKey(key) {
  const match = MOCK_KEY.exec(key)
  if (!match) throw new Error(`api 키 형식이 틀렸습니다: "${key}" (예: "GET /questions/*")`)
  return { method: match[1], path: match[2] }
}

function pathPattern(path) {
  const segments = path.split('/').map((segment) => (segment === '*' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return new RegExp(`^${segments.join('/')}/?$`)
}

/** 요청에 맞는 가짜 응답을 찾는다. * 없는 경로가 * 있는 경로보다 먼저다. */
export function findMock(api, method, pathname) {
  const entries = Object.entries(api || {}).map(([key, value]) => ({ key, value, ...parseMockKey(key) }))
  const candidates = [...entries.filter((entry) => !entry.path.includes('*')), ...entries.filter((entry) => entry.path.includes('*'))]
  const hit = candidates.find((entry) => entry.method === method && pathPattern(entry.path).test(pathname))
  return hit ? { key: hit.key, ...hit.value } : null
}

/** 시나리오 목록의 형식 오류를 문장 목록으로 돌려준다. */
export function validateScenarios(scenarios) {
  if (!Array.isArray(scenarios)) return ['scenarios.mjs 는 시나리오 배열을 export default 해야 합니다.']
  const problems = []
  const names = new Set()
  for (const [index, scenario] of scenarios.entries()) {
    const label = scenario?.name || `#${index + 1}`
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scenario?.name || '')) problems.push(`${label}: name 은 영문 소문자 kebab-case 로 씁니다.`)
    if (names.has(scenario?.name)) problems.push(`${label}: name 이 중복됩니다.`)
    names.add(scenario?.name)
    if (typeof scenario?.path !== 'string' || !scenario.path.startsWith('/')) problems.push(`${label}: path 는 / 로 시작합니다.`)
    if (!Array.isArray(scenario?.expect) || scenario.expect.length === 0 || scenario.expect.some((item) => typeof item !== 'string' || !item.trim())) {
      problems.push(`${label}: expect 에 화면에 보여야 하는 문구를 1개 이상 적습니다.`)
    }
    for (const [key, value] of Object.entries(scenario?.api || {})) {
      try { parseMockKey(key) } catch (error) { problems.push(`${label}: ${error.message}`); continue }
      if (!value || (!value.hold && !Number.isInteger(value.status))) problems.push(`${label}: "${key}" 는 { status, body } 또는 { hold: true } 입니다.`)
    }
  }
  return problems
}

/** dist 안의 파일 경로. 확장자 없는 주소는 index.html(SPA), dist 밖으로 나가면 null. */
export function resolveStatic(dist, urlPath) {
  let clean
  try { clean = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const root = resolve(dist)
  const candidate = resolve(root, `.${clean}`)
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return extname(clean) ? null : join(root, 'index.html')
}

function startServer(dist) {
  const server = createServer((request, response) => {
    const file = resolveStatic(dist, request.url || '/')
    if (!file || !existsSync(file)) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    createReadStream(file).pipe(response)
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

async function launchBrowser() {
  let chromium
  try {
    ({ chromium } = await import('playwright-core'))
  } catch {
    throw new Error(`playwright-core 가 없습니다. 실행: ${PLAYWRIGHT_HINT}`)
  }
  const channels = process.env.UI_CHECK_BROWSER ? [process.env.UI_CHECK_BROWSER]
    : process.platform === 'win32' ? ['msedge', 'chrome'] : ['chrome', 'msedge']
  let lastError
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`브라우저(${channels.join(', ')})를 실행하지 못했습니다. Edge 나 Chrome 이 설치돼 있는지 확인하세요.\n${lastError?.message?.split('\n')[0] || ''}`)
}

// 브라우저 안에서 실행한다: 가로 스크롤과 이름 없는 요소를 찾는다
function inspectPage() {
  const describe = (element) => {
    const id = element.id ? `#${element.id}` : ''
    const className = typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/)[0]}` : ''
    const label = (element.innerText || element.getAttribute('placeholder') || '').trim().slice(0, 20)
    return `<${element.tagName.toLowerCase()}${id}${className}>${label ? ` "${label}"` : ''}`
  }
  const visible = (element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
  }
  const clipped = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX !== 'visible') return true
    }
    return false
  }
  const width = document.documentElement.clientWidth
  let overflow = null
  if (document.documentElement.scrollWidth > width + 1) {
    const offenders = [...document.querySelectorAll('body *')].slice(0, 3000)
      .filter((element) => visible(element) && element.getBoundingClientRect().right > width + 1 && !clipped(element))
    overflow = { scrollWidth: document.documentElement.scrollWidth, width, offenders: offenders.slice(-3).map(describe) }
  }
  const nameOf = (element) => [
    element.getAttribute('aria-label'),
    (element.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '),
    element.innerText,
    [...element.querySelectorAll('img[alt]')].map((image) => image.alt).join(' '),
    element.getAttribute('title'),
    element.labels ? [...element.labels].map((label) => label.innerText).join(' ') : '',
    ['submit', 'button', 'reset'].includes(element.type) ? element.value : '',
  ].some((value) => value && value.trim())
  const unnamed = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')]
    .filter((element) => visible(element) && !nameOf(element)).slice(0, 5).map(describe)
  return { overflow, unnamed }
}

async function runScenario(browser, origin, scenario, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    reducedMotion: 'reduce', serviceWorkers: 'block',
  })
  const problems = []
  const unmocked = new Set()
  const cors = {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  }
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const mock = findMock(scenario.api, request.method(), url.pathname)
    if (mock?.hold) return undefined // 응답하지 않는다: 로딩 상태를 본다
    if (mock) {
      return route.fulfill({ status: mock.status, headers: cors, contentType: 'application/json', body: JSON.stringify(mock.body ?? null) })
    }
    if (['xhr', 'fetch'].includes(request.resourceType())) unmocked.add(`${request.method()} ${url.pathname}`)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`페이지 오류: ${error.message.split('\n')[0]}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(`콘솔 오류: ${message.text().split('\n')[0]}`)
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === origin && response.status() >= 400) problems.push(`파일을 찾지 못함 ${response.status()}: ${url.pathname}`)
  })
  const screenshot = join(OUT, `${scenario.name}--${viewport.name}.png`)
  try {
    await page.goto(origin + scenario.path, { waitUntil: 'load', timeout: 15000 })
    for (const expected of scenario.expect) {
      try {
        await page.waitForFunction((value) => document.body?.innerText.includes(value), expected, { timeout: 5000 })
      } catch {
        problems.push(`기대 문구가 보이지 않음: "${expected}"`)
      }
    }
    const { overflow, unnamed } = await page.evaluate(inspectPage)
    if (overflow) problems.push(`가로 스크롤: 화면 폭 ${overflow.width}px 인데 내용 폭 ${overflow.scrollWidth}px. 넘치는 요소: ${overflow.offenders.join(', ') || '(찾지 못함)'}`)
    for (const element of unnamed) problems.push(`이름 없는 요소(스크린리더가 읽을 이름이 없음): ${element}`)
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' })
  } catch (error) {
    problems.push(`화면을 열지 못함: ${error.message.split('\n')[0]}`)
  } finally {
    for (const request of unmocked) problems.push(`가짜 응답이 없는 API 요청: ${request} → ui-check/scenarios.mjs 의 api 에 추가하세요`)
    await context.close()
  }
  return { scenario: scenario.name, path: scenario.path, viewport: viewport.name, problems, screenshot: existsSync(screenshot) ? relativeToRoot(screenshot) : '' }
}

function relativeToRoot(path) {
  return path.slice(ROOT.length + 1).split(sep).join('/')
}

export function formatReport(results, startedAt) {
  const failed = results.filter((result) => result.problems.length)
  const lines = [
    `# 화면 점검 결과 (${startedAt})`, '',
    `- 화면 ${results.length}개 중 실패 ${failed.length}개`,
    '- 스크린샷은 Codex 에서 view_image 로 열어 볼 수 있다. 모양(겹침, 잘림, 정렬)은 사람이 보고 판단한다.', '',
    '| 시나리오 | 주소 | 화면 | 결과 | 스크린샷 |', '| --- | --- | --- | --- | --- |',
    ...results.map((result) => `| ${result.scenario} | ${result.path} | ${result.viewport} | ${result.problems.length ? '실패' : '통과'} | ${result.screenshot || '-'} |`),
  ]
  if (failed.length) {
    lines.push('', '## 실패 내용')
    for (const result of failed) {
      lines.push('', `### ${result.scenario} / ${result.viewport}`, ...result.problems.map((problem) => `- ${problem}`))
    }
  }
  return lines.join('\n') + '\n'
}

async function main(argv) {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('frontend/dist 가 없습니다. 먼저 빌드하세요: cd frontend; npm run build')
    console.log('UI CHECK FAIL: build')
    return 1
  }
  const scenarios = (await import(pathToFileURL(SCENARIOS).href)).default
  const invalid = validateScenarios(scenarios)
  if (invalid.length) {
    for (const problem of invalid) console.log(`- ${problem}`)
    console.log('UI CHECK FAIL: scenarios')
    return 1
  }
  const onlyIndex = argv.indexOf('--only')
  const only = onlyIndex >= 0 ? new Set((argv[onlyIndex + 1] || '').split(',')) : null
  const selected = only ? scenarios.filter((scenario) => only.has(scenario.name)) : scenarios
  if (selected.length === 0) {
    console.log('실행할 시나리오가 없습니다. --only 의 이름을 확인하세요.')
    console.log('UI CHECK FAIL: scenarios')
    return 1
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const startedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  let browser
  const server = await startServer(DIST)
  try {
    browser = await launchBrowser()
    const origin = `http://127.0.0.1:${server.address().port}`
    const results = []
    for (const scenario of selected) {
      results.push(...await Promise.all(VIEWPORTS.map((viewport) => runScenario(browser, origin, scenario, viewport))))
    }
    writeFileSync(join(OUT, 'report.md'), formatReport(results, startedAt), 'utf8')
    for (const scenario of selected) {
      const mine = results.filter((result) => result.scenario === scenario.name)
      const failed = mine.filter((result) => result.problems.length)
      if (!failed.length) console.log(`PASS ${scenario.name} (${mine.map((result) => result.viewport).join(', ')})`)
      for (const result of failed) {
        console.log(`FAIL ${result.scenario} / ${result.viewport} (${result.path})`)
        for (const problem of result.problems) console.log(`  - ${problem}`)
        if (result.screenshot) console.log(`  스크린샷: ${result.screenshot}`)
      }
    }
    const failures = results.filter((result) => result.problems.length).length
    console.log(`보고서: .agent-loop/ui/report.md (스크린샷은 view_image 로 열어 확인)`)
    console.log(failures ? `UI CHECK FAIL: ${failures}` : `UI CHECK PASS (${results.length}개 화면)`)
    return failures ? 1 : 0
  } catch (error) {
    console.log(error.message)
    console.log('UI CHECK FAIL: setup')
    return 1
  } finally {
    await browser?.close()
    server.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
