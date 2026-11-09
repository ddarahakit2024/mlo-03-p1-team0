/**
 * 프런트엔드 규칙 검사기: frontend/AGENTS.md 의 규칙 중 코드로 확인할 수 있는 것을 검사한다.
 *
 * 사용(저장소 루트에서): node frontend/scripts/check-frontend.mjs
 *   --all              기준선으로 넘어간 기존 위반까지 모두 출력
 *   --update-baseline  지금 위반 개수를 기준선으로 저장(사람만. 기존 코드의 부채를 기록할 때)
 *
 * 기준선(frontend-rules.baseline.json)에는 "규칙 | 파일" 별 기존 위반 개수가 들어 있다.
 * 개수가 기준선보다 늘면 실패한다. 기존 부채는 허용하고, 새 코드는 깨끗하게 쓰게 하는 장치다.
 * 마지막 줄은 FRONTEND RULES PASS 또는 FRONTEND RULES FAIL: <건수> 이다.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(FRONTEND, 'scripts', 'frontend-rules.baseline.json')

export const RULES = {
  'no-v-html': 'v-html 을 쓰지 않는다(XSS). 텍스트는 {{ }} 로 출력하고 줄바꿈은 CSS white-space: pre-line 으로 표시한다.',
  'button-type': '<button> 에 type 을 적는다. 일반 버튼은 type="button", 폼 제출은 type="submit".',
  'img-alt': '<img> 에 alt 를 적는다. 의미 없는 장식 이미지는 alt="".',
  'blank-rel': 'target="_blank" 링크에는 rel="noopener noreferrer" 를 함께 적는다.',
  'control-label': '입력 요소에 이름을 붙인다: <label for="id"> 와 id, 또는 <label> 로 감싸기, 또는 aria-label.',
  'click-non-interactive': 'div·span·li 에 @click 을 달지 않는다. 동작이면 <button type="button">, 이동이면 <a href>. 모달 배경 닫기는 @click.self + 닫기 버튼.',
  'http-outside-api': 'axios·fetch 로 백엔드를 부르는 코드는 src/api/ 에만 둔다. 화면은 src/api 의 함수를 부른다.',
  'api-origin': '백엔드 주소를 코드에 적지 않는다. 주소는 src/api/config.js 의 baseUrl() 로만 만든다.',
  'api-path-encode': 'URL 경로에 넣는 값은 encodeURIComponent() 로 감싼다. 검색어 등은 axios 의 params 로 넘긴다.',
  'component-api': '컴포넌트(src/components)는 API 를 부르지 않는다. 화면(views)이 불러서 props 로 넘긴다.',
  'component-documented': '새 컴포넌트는 src/components/README.md 표에 입력(props)과 이벤트(emits)를 적는다.',
  'view-routed': '새 화면(src/views)은 src/router/index.js 에 경로를 추가하고 src/App.vue 에서 보여 준다.',
  'view-states': 'API 를 부르는 화면은 로딩(role="status")과 오류(role="alert", 다시 시도 버튼)를 표시한다.',
  'view-tested': '새 화면은 테스트가 있어야 한다: src/<화면>.test.mjs 에서 compileSfc(\'views/<화면>.vue\') 로 상태별 렌더링을 검증한다.',
  'api-tested': 'src/api 모듈마다 테스트가 있어야 한다: 요청 URL·메서드·본문·withCredentials 를 검증한다.',
  'store-tested': 'src/stores 모듈마다 테스트가 있어야 한다: 상태 계산 함수를 test.each 로 검증한다.',
  'no-console': 'console.log/info/debug 를 남기지 않는다.',
  'public-env-secret': 'VITE_ 변수는 빌드 결과(브라우저)에 그대로 들어간다. 비밀값(SECRET, PASSWORD, PRIVATE)은 백엔드에만 둔다.',
}

const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'option', 'form'])
const UNNAMED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image'])
const ELEMENT = 1
const COMPONENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function finding(rule, file, line, detail = '') {
  return { rule, file, line, detail }
}

/** 템플릿 요소의 속성(정적·바인딩)을 찾는다. v-bind="obj" 가 있으면 알 수 없으므로 '?' 를 돌려준다. */
function attr(node, name) {
  let spread = false
  for (const prop of node.props) {
    if (prop.type === ATTRIBUTE && prop.name === name) return { bound: false, value: prop.value?.content ?? '' }
    if (prop.type === DIRECTIVE && prop.name === 'bind') {
      if (!prop.arg) spread = true
      else if (prop.arg.content === name) return { bound: true, value: prop.exp?.content ?? '' }
    }
  }
  return spread ? { bound: true, value: '?' } : null
}

/** @click 처럼 이벤트를 다는 지시자를 찾는다. @click.self(모달 배경 닫기)는 제외한다. */
function hasEvent(node, event) {
  return node.props.some((prop) => prop.type === DIRECTIVE && prop.name === 'on' && prop.arg?.content === event
    && !(prop.modifiers || []).some((modifier) => (modifier.content ?? modifier) === 'self'))
}

function walk(node, visit, ancestors = []) {
  if (node.type === ELEMENT) visit(node, ancestors)
  for (const child of node.children || []) walk(child, visit, node.type === ELEMENT ? [...ancestors, node] : ancestors)
}

function checkTemplate(file, ast) {
  const found = []
  const labelFor = new Set()
  let boundLabelFor = false
  const roles = []
  walk(ast, (node) => {
    if (node.tag === 'label') {
      const target = attr(node, 'for')
      if (target?.bound) boundLabelFor = true
      else if (target) labelFor.add(target.value)
    }
    const role = attr(node, 'role')
    if (role) roles.push(role.value)
  })
  walk(ast, (node, ancestors) => {
    const line = node.loc.start.line
    if (node.props.some((prop) => prop.type === DIRECTIVE && prop.name === 'html')) found.push(finding('no-v-html', file, line, node.tag))
    if (node.tagType === COMPONENT) return
    const tag = node.tag
    if (tag === 'button' && !attr(node, 'type')) found.push(finding('button-type', file, line))
    if (tag === 'img' && !attr(node, 'alt')) found.push(finding('img-alt', file, line))
    const target = attr(node, 'target')
    if (target && !target.bound && target.value === '_blank') {
      const rel = attr(node, 'rel')
      if (!rel || (!rel.bound && !/\bnoopener\b/.test(rel.value))) found.push(finding('blank-rel', file, line))
    }
    if (['input', 'textarea', 'select'].includes(tag)) {
      const type = attr(node, 'type')
      const skip = type && !type.bound && UNNAMED_INPUT_TYPES.has(type.value)
      const id = attr(node, 'id')
      const named = attr(node, 'aria-label') || attr(node, 'aria-labelledby') || attr(node, 'title')
        || ancestors.some((parent) => parent.tag === 'label')
        || (id && (id.bound ? boundLabelFor : labelFor.has(id.value) || boundLabelFor))
      if (!skip && !named) found.push(finding('control-label', file, line, tag))
    }
    if (hasEvent(node, 'click') && !INTERACTIVE.has(tag) && !(attr(node, 'role') && attr(node, 'tabindex'))) {
      found.push(finding('click-non-interactive', file, line, tag))
    }
  })
  return { found, roles }
}

function scriptBlocks(file, source) {
  if (!file.endsWith('.vue')) return { blocks: [{ content: source, offset: 0 }], descriptor: null }
  const { descriptor } = parse(source, { filename: file })
  const blocks = [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    .map((block) => ({ content: block.content, offset: block.loc.start.offset }))
  return { blocks, descriptor }
}

function eachMatch(blocks, source, pattern, callback) {
  for (const block of blocks) {
    for (const match of block.content.matchAll(pattern)) callback(match, lineAt(source, block.offset + match.index))
  }
}

/** 파일 하나를 검사한다. file 은 frontend 기준 슬래시 경로(예: src/views/QuestionList.vue). */
export function checkFile(file, source, context = {}) {
  const found = []
  const { blocks, descriptor } = scriptBlocks(file, source)
  const inApi = file.startsWith('src/api/')

  if (descriptor?.template?.ast) {
    const result = checkTemplate(file, descriptor.template.ast)
    found.push(...result.found)
    const importsApi = blocks.some((block) => /from\s+['"]\.\.\/api\//.test(block.content))
    if (file.startsWith('src/views/') && importsApi) {
      if (!result.roles.some((role) => role.includes('status'))) found.push(finding('view-states', file, 1, 'status'))
      if (!result.roles.some((role) => role.includes('alert'))) found.push(finding('view-states', file, 1, 'alert'))
    }
  }

  if (!inApi) {
    eachMatch(blocks, source, /from\s+['"]axios['"]|\bfetch\s*\(/g, (_, line) => found.push(finding('http-outside-api', file, line)))
  }
  if (file !== 'src/api/config.js') {
    eachMatch(blocks, source, /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?|https:\/\/api\.[\w.-]+/g, (match, line) => found.push(finding('api-origin', file, line, match[0])))
  }
  if (inApi) {
    eachMatch(blocks, source, /`[^`]*\$\{\s*baseUrl\([^`]*`/g, (match, line) => {
      const values = [...match[0].matchAll(/\$\{([^}]*)\}/g)].map((value) => value[1].trim())
      if (values.some((value) => !/^(baseUrl|encodeURIComponent)\(/.test(value))) found.push(finding('api-path-encode', file, line))
    })
  }
  if (file.startsWith('src/components/')) {
    eachMatch(blocks, source, /from\s+['"]\.\.\/api\/[^'"]+['"]/g, (match, line) => found.push(finding('component-api', file, line, match[0])))
  }
  eachMatch(blocks, source, /\bconsole\.(log|info|debug)\s*\(/g, (_, line) => found.push(finding('no-console', file, line)))
  eachMatch(blocks, source, /VITE_\w*(SECRET|PASSWORD|PRIVATE)\w*/g, (match, line) => found.push(finding('public-env-secret', file, line, match[0])))

  // 파일 단위 규칙: context 에 해당 자료(테스트 소스, README, App.vue)가 있을 때만 검사한다
  const name = file.split('/').pop()
  const stem = name.replace(/\.(vue|m?js)$/, '')
  const { testSources: tests, componentReadme, appSource } = context
  if (/^src\/components\/[^/]+\.vue$/.test(file) && componentReadme !== undefined && !componentReadme.includes(stem)) {
    found.push(finding('component-documented', file, 1))
  }
  if (/^src\/views\/[^/]+\.vue$/.test(file)) {
    if (appSource !== undefined && !new RegExp(`views/${stem}\\.vue['"]`).test(appSource)) found.push(finding('view-routed', file, 1))
    if (tests !== undefined && !tests.includes(name)) found.push(finding('view-tested', file, 1))
  }
  if (tests !== undefined && /^src\/api\/[^/]+\.m?js$/.test(file) && file !== 'src/api/config.js' && !new RegExp(`api/${stem}\\.m?js['"]`).test(tests)) {
    found.push(finding('api-tested', file, 1))
  }
  if (tests !== undefined && /^src\/stores\/[^/]+\.m?js$/.test(file) && !new RegExp(`stores/${stem}\\.m?js['"]`).test(tests)) {
    found.push(finding('store-tested', file, 1))
  }
  return found
}

function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else files.push(path)
  }
  return files
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** frontend 폴더 전체를 검사해 위반 목록을 돌려준다. */
export function checkFrontend(root = FRONTEND) {
  const all = listFiles(join(root, 'src')).map((path) => relative(root, path).split('\\').join('/'))
  const testFiles = all.filter((file) => file.endsWith('.test.mjs'))
  const context = {
    testSources: testFiles.map((file) => readFileSync(join(root, file), 'utf8')).join('\n'),
    componentReadme: readIfExists(join(root, 'src/components/README.md')),
    appSource: readIfExists(join(root, 'src/App.vue')),
  }
  return all
    .filter((file) => /\.(vue|m?js)$/.test(file) && !file.endsWith('.test.mjs') && !file.startsWith('src/testing/'))
    .flatMap((file) => checkFile(file, readFileSync(join(root, file), 'utf8'), context))
}

export function countByKey(findings) {
  const counts = {}
  for (const item of findings) {
    const key = `${item.rule} | ${item.file}`
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/** 기준선과 비교한다. failures: 기준선보다 늘어난 위반, improved: 기준선보다 줄어든 항목. */
export function compareWithBaseline(findings, baseline = {}) {
  const counts = countByKey(findings)
  const failures = []
  const improved = []
  for (const [key, count] of Object.entries(counts)) {
    const allowed = baseline[key] || 0
    if (count > allowed) failures.push({ key, count, allowed, items: findings.filter((item) => `${item.rule} | ${item.file}` === key) })
  }
  for (const [key, allowed] of Object.entries(baseline)) {
    if ((counts[key] || 0) < allowed) improved.push({ key, count: counts[key] || 0, allowed })
  }
  return { failures, improved }
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')).counts || {}
  } catch {
    return {}
  }
}

function main(argv) {
  const findings = checkFrontend()
  if (argv.includes('--update-baseline')) {
    const counts = Object.fromEntries(Object.entries(countByKey(findings)).sort())
    writeFileSync(BASELINE, JSON.stringify({ note: '기존 코드의 규칙 위반 개수. 사람만 갱신한다(--update-baseline).', counts }, null, 2) + '\n')
    console.log(`기준선을 저장했습니다: frontend/scripts/frontend-rules.baseline.json (${findings.length}건)`)
    return 0
  }
  const { failures, improved } = compareWithBaseline(findings, loadBaseline())
  if (argv.includes('--all')) {
    for (const item of findings) console.log(`  (전체) frontend/${item.file}:${item.line} [${item.rule}] ${item.detail}`)
  }
  for (const item of improved) console.log(`줄었음: ${item.key} ${item.allowed} -> ${item.count}. 사람이 --update-baseline 으로 기준선을 낮추세요.`)
  if (failures.length === 0) {
    console.log('FRONTEND RULES PASS')
    return 0
  }
  let total = 0
  const rules = new Set()
  for (const failure of failures) {
    const extra = failure.count - failure.allowed
    total += extra
    rules.add(failure.key.split(' | ')[0])
    const note = failure.allowed ? ` (기존 ${failure.allowed}건 허용, 지금 ${failure.count}건)` : ''
    console.log(`${failure.key}${note}`)
    for (const item of failure.items) console.log(`  frontend/${item.file}:${item.line}${item.detail ? ' ' + item.detail : ''}`)
  }
  console.log('\n고치는 법:')
  for (const rule of rules) console.log(`- [${rule}] ${RULES[rule]}`)
  console.log(`FRONTEND RULES FAIL: ${total}`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
