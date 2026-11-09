// 프런트 규칙 검사기(frontend/scripts/check-frontend.mjs)의 테스트. 검사기가 틀리면 모든 작업이 막히거나 새어 나간다.
import { RULES, checkFile, compareWithBaseline } from '../../scripts/check-frontend.mjs'

const rules = (findings) => findings.map((item) => item.rule).sort()
const sfc = (template, script = '') => `<script setup>\n${script}\n</script>\n<template>\n${template}\n</template>\n`

describe('템플릿 규칙', () => {
  test('잘 쓴 템플릿은 위반이 없다', () => {
    const source = sfc(`<form @submit.prevent="save">
      <label for="title">제목</label><input id="title" v-model="title" />
      <label>내용<textarea v-model="content" /></label>
      <input v-model="keyword" aria-label="검색어" /><input type="hidden" name="token" />
      <img src="/a.png" alt="" /><a href="/x" target="_blank" rel="noopener noreferrer">새 탭</a>
      <button type="submit">저장</button><div class="backdrop" @click.self="close"></div>
      <ProductCard @click="open" />
    </form>`)
    expect(checkFile('src/components/Form.vue', source)).toEqual([])
  })

  test.each([
    ['no-v-html', '<div v-html="content"></div>'],
    ['button-type', '<button @click="save">저장</button>'],
    ['img-alt', '<img :src="url" />'],
    ['blank-rel', '<a :href="url" target="_blank">원본</a>'],
    ['control-label', '<input v-model="title" placeholder="제목" />'],
    ['control-label', '<label for="other">이름</label><select id="mine"></select>'],
    ['click-non-interactive', '<div class="card" @click="open">열기</div>'],
  ])('%s: %s', (rule, template) => {
    const found = checkFile('src/components/Bad.vue', sfc(template))
    expect(rules(found)).toEqual([rule])
    expect(found[0].line).toBeGreaterThan(3)
  })

  test('API 를 부르는 화면에 로딩·오류 표시가 없으면 알려 준다', () => {
    const script = "import { fetchProducts } from '../api/productApi.js'"
    expect(checkFile('src/views/A.vue', sfc('<p>목록</p>', script)).filter((item) => item.rule === 'view-states').map((item) => item.detail)).toEqual(['status', 'alert'])
    const ok = sfc('<p v-if="loading" role="status">불러오는 중</p><p v-else-if="error" role="alert">{{ error }}</p>', script)
    expect(checkFile('src/views/A.vue', ok).filter((item) => item.rule === 'view-states')).toEqual([])
  })
})

describe('스크립트 규칙', () => {
  test('axios·fetch 는 src/api 에서만 쓴다', () => {
    const view = sfc('<p role="status" /><p role="alert" />', "import axios from 'axios'\nconst r = await fetch('/x')")
    expect(rules(checkFile('src/views/A.vue', view)).filter((rule) => rule === 'http-outside-api')).toHaveLength(2)
    expect(rules(checkFile('src/api/aApi.js', "import axios from 'axios'"))).not.toContain('http-outside-api')
  })

  test('백엔드 주소는 config.js 에만 적는다', () => {
    expect(rules(checkFile('src/api/aApi.js', "const url = 'http://127.0.0.1:8000/a'"))).toContain('api-origin')
    expect(rules(checkFile('src/api/config.js', "const url = 'http://127.0.0.1:8000'"))).not.toContain('api-origin')
  })

  test('경로에 넣는 값은 encodeURIComponent 로 감싼다', () => {
    const bad = 'axios.get(`${baseUrl(apiBaseUrl)}/questions/${id}`)'
    const good = 'axios.get(`${baseUrl(apiBaseUrl)}/questions/${encodeURIComponent(id)}`)'
    expect(rules(checkFile('src/api/questionApi.js', bad))).toContain('api-path-encode')
    expect(rules(checkFile('src/api/questionApi.js', good))).not.toContain('api-path-encode')
  })

  test('컴포넌트는 API 를 직접 부르지 않는다', () => {
    const source = sfc('<p />', "import { fetchProducts } from '../api/productApi.js'")
    expect(rules(checkFile('src/components/Card.vue', source))).toContain('component-api')
  })

  test('console.log 와 비밀값 VITE_ 변수를 찾는다', () => {
    expect(rules(checkFile('src/stores/a.js', 'console.log(1)\nconsole.error(2)'))).toEqual(['no-console'])
    expect(rules(checkFile('src/api/aApi.js', 'const k = import.meta.env.VITE_PORTONE_SECRET'))).toEqual(['public-env-secret'])
  })
})

describe('파일 단위 규칙', () => {
  const context = {
    testSources: "compileSfc('views/Done.vue')\nimport { a } from './api/doneApi.js'\nimport { b } from './stores/doneViewModel.js'",
    componentReadme: '| DoneCard | product | select |',
    appSource: "import Done from './views/Done.vue'",
  }

  test('테스트·경로·문서가 없는 새 파일을 알려 준다', () => {
    expect(rules(checkFile('src/views/New.vue', sfc('<p />'), context))).toEqual(['view-routed', 'view-tested'])
    expect(rules(checkFile('src/api/newApi.js', '', context))).toEqual(['api-tested'])
    expect(rules(checkFile('src/stores/newViewModel.js', '', context))).toEqual(['store-tested'])
    expect(rules(checkFile('src/components/NewCard.vue', sfc('<p />'), context))).toEqual(['component-documented'])
  })

  test('갖춘 파일은 통과한다', () => {
    expect(checkFile('src/views/Done.vue', sfc('<p />'), context)).toEqual([])
    expect(checkFile('src/api/doneApi.js', '', context)).toEqual([])
    expect(checkFile('src/stores/doneViewModel.js', '', context)).toEqual([])
    expect(checkFile('src/components/DoneCard.vue', sfc('<p />'), context)).toEqual([])
  })
})

describe('기준선', () => {
  const finding = (rule, file) => ({ rule, file, line: 1, detail: '' })

  test('기존 위반 개수까지는 통과, 늘면 실패, 줄면 알려 준다', () => {
    const baseline = { 'button-type | src/views/Old.vue': 2, 'img-alt | src/views/Old.vue': 1 }
    const result = compareWithBaseline([
      finding('button-type', 'src/views/Old.vue'), finding('button-type', 'src/views/Old.vue'),
      finding('button-type', 'src/views/New.vue'),
    ], baseline)
    expect(result.failures.map((item) => item.key)).toEqual(['button-type | src/views/New.vue'])
    expect(result.improved).toEqual([{ key: 'img-alt | src/views/Old.vue', count: 0, allowed: 1 }])
  })

  test('모든 규칙에 고치는 법이 적혀 있다', () => {
    for (const message of Object.values(RULES)) expect(message.length).toBeGreaterThan(10)
  })
})
