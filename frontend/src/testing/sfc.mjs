/**
 * 화면·컴포넌트(.vue)를 브라우저 없이 Jest(node 환경)에서 렌더링하는 테스트 도구.
 * 화면 테스트마다 따로 만들던 "Vue 를 node 에서 그리는 코드"를 한 곳에 모았다.
 *
 *   const fetchQuestions = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1 })
 *   const View = await compileSfc('views/QuestionList.vue', { fetchQuestions })
 *   const page = mount(View)
 *   await flush()
 *   expect(text(page.root)).toContain('아직 등록된 질문이 없습니다.')
 *
 * import 처리 규칙
 * - 'vue' 에서 가져온 것: 실제 Vue
 * - 두 번째 인자(deps)에 같은 이름이 있으면 그것(API 함수를 jest.fn 으로 바꿀 때)
 * - .vue 컴포넌트와 components/index.js: 가짜 컴포넌트(stub). slot 은 그대로 그리고,
 *   넘긴 props 는 data-stub 노드의 props 로 남는다 → stub(root, 'ProductGrid').props.products
 * - 그 밖의 .js/.mjs(stores, router, api): 실제 모듈. axios 를 jest.spyOn 으로 바꿔도 된다
 */
import * as Vue from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const IMPORT = /^[ \t]*import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*|\*\s*as\s+([\w$]+)\s*)?(?:from\s*)?['"]([^'"]+)['"];?[ \t]*$/gm

function parseImports(code) {
  const bindings = []
  const body = code.replace(IMPORT, (_, defaultName, named, namespace, source) => {
    if (defaultName) bindings.push({ local: defaultName, imported: 'default', source })
    if (namespace) bindings.push({ local: namespace, imported: '*', source })
    for (const part of (named || '').split(',').map((item) => item.trim()).filter(Boolean)) {
      const [imported, local = imported] = part.split(/\s+as\s+/).map((item) => item.trim())
      bindings.push({ local, imported, source })
    }
    return ''
  })
  return { bindings, body }
}

function isComponentSource(source) {
  return source.endsWith('.vue') || /\/components(\/index\.js)?$/.test(source)
}

/** 이름만 남기고 slot 을 그대로 그리는 가짜 컴포넌트. */
export function stubComponent(name) {
  return {
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => Vue.h('div', { ...attrs, 'data-stub': name }, slots.default?.())
    },
  }
}

async function resolveBinding(binding, file, deps) {
  if (Object.hasOwn(deps, binding.local)) return deps[binding.local]
  if (binding.source === 'vue') return binding.imported === '*' ? Vue : Vue[binding.imported]
  if (isComponentSource(binding.source)) return stubComponent(binding.local)
  if (!binding.source.startsWith('.')) {
    throw new Error(`테스트 의존성이 없습니다: ${binding.local} (from '${binding.source}'). compileSfc(경로, { ${binding.local}: ... }) 로 넘기세요.`)
  }
  let module
  try {
    module = await import(pathToFileURL(resolve(dirname(file), binding.source)).href)
  } catch (error) {
    throw new Error(`${binding.source} 를 불러오지 못했습니다(${error.message}). compileSfc(경로, { ${binding.local}: jest.fn() }) 로 대신 넘기세요.`)
  }
  if (binding.imported === '*') return module
  if (!(binding.imported in module)) throw new Error(`${binding.source} 에 ${binding.imported} 가 없습니다.`)
  return module[binding.imported]
}

/**
 * .vue 파일을 컴파일해 마운트할 수 있는 컴포넌트를 돌려준다.
 * @param {string} path src 기준 경로(예: 'views/QuestionList.vue')
 * @param {object} deps import 대신 넣을 값(이름이 같아야 한다)
 * @param {{ env?: object, source?: string }} options env: import.meta.env 값, source: 파일 대신 쓸 SFC 문자열
 */
export async function compileSfc(path, deps = {}, { env = { MODE: 'test' }, source } = {}) {
  const file = resolve(SRC, path)
  const { descriptor, errors } = parse(source ?? readFileSync(file, 'utf8'), { filename: file })
  if (errors.length) throw new Error(`${path} 를 해석하지 못했습니다: ${errors.map((error) => error.message).join('; ')}`)
  const script = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id: path }) : null
  let component = {}
  if (script) {
    const { bindings, body } = parseImports(script.content)
    const code = body.replace(/import\.meta\.env/g, '__importMetaEnv').replace(/\bexport default\b/, 'return')
    const values = []
    for (const binding of bindings) values.push(await resolveBinding(binding, file, deps))
    component = new Function(...bindings.map((binding) => binding.local), '__importMetaEnv', code)(...values, env)
  }
  if (descriptor.template) {
    const template = compileTemplate({
      source: descriptor.template.content, filename: file, id: path,
      compilerOptions: { bindingMetadata: script?.bindings, mode: 'function' },
    })
    if (template.errors.length) throw new Error(`${path} 템플릿 오류: ${template.errors.map(String).join('; ')}`)
    component.render = new Function('Vue', template.code)(Vue)
  }
  return component
}

function makeNode(type, text = '') {
  return {
    type, props: {}, children: [], text, parent: null, tagName: String(type).toUpperCase(),
    addEventListener() {}, removeEventListener() {}, getRootNode() { return { activeElement: null } },
  }
}

/** 컴포넌트를 가짜 DOM 트리에 마운트한다. 노드: { type, props, children, text }. */
export function mount(component, props = {}) {
  globalThis.Document ??= class Document {}
  globalThis.ShadowRoot ??= class ShadowRoot {}
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
    createElement: (type) => makeNode(type),
    createText: (value) => makeNode('#text', value),
    createComment: () => makeNode('#comment'),
    setText: (node, value) => { node.text = value },
    setElementText: (node, value) => { node.text = value; node.children = [] },
    insertStaticContent: (content, parent) => {
      const node = makeNode('#static', content)
      node.parent = parent
      parent.children.push(node)
      return [node, node]
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node?.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  })
  const root = makeNode('root')
  const app = renderer.createApp(component, props)
  app.mount(root)
  return { root, app, unmount: () => app.unmount() }
}

/** 화면 갱신(Promise, nextTick)을 끝까지 기다린다. API 목이 resolve 된 뒤에 부른다. */
export async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await Vue.nextTick()
  }
  await new Promise((done) => setTimeout(done, 0))
  await Vue.nextTick()
}

/** 로딩 상태를 보려고 응답을 붙잡아 두는 Promise. */
export function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((done, fail) => { resolvePromise = done; rejectPromise = fail })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

export function text(node) {
  return `${node.text || ''}${node.children.map(text).join('')}`
}

export function findAll(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => findAll(child, predicate))]
}

export function find(node, predicate) {
  return findAll(node, predicate)[0] || null
}

export const byId = (root, id) => find(root, (node) => node.props.id === id)
export const button = (root, label) => find(root, (node) => node.type === 'button' && text(node).includes(label))
export const link = (root, label) => find(root, (node) => node.type === 'a' && text(node).includes(label))
export const stub = (root, name) => find(root, (node) => node.props['data-stub'] === name)
/** role 이 같은 노드들(예: 'alert', 'status'). 상태 표시를 확인할 때 쓴다. */
export const byRole = (root, role) => findAll(root, (node) => node.props.role === role)

const event = (target) => ({ preventDefault() {}, stopPropagation() {}, target, currentTarget: target })

/** 노드 자신이나 감싼 fieldset 이 disabled 인지(정적 disabled 속성은 '' 로 들어온다). */
function isDisabled(node) {
  for (let current = node; current; current = current.parent) {
    const value = current.props.disabled
    if ((current === node || current.type === 'fieldset') && value !== undefined && value !== null && value !== false) return true
  }
  return false
}

export async function click(node) {
  if (!node) throw new Error('누를 노드가 없습니다. button(root, \'이름\') 의 이름을 확인하세요.')
  if (isDisabled(node)) throw new Error(`비활성화된 버튼입니다: ${text(node)}`)
  await node.props.onClick?.(event(node))
  await flush()
}

/** v-model 이 걸린 입력에 값을 넣는다. 컴포넌트의 v-model:keyword 는 prop='keyword'. */
export async function setValue(node, value, prop = 'modelValue') {
  if (!node) throw new Error('값을 넣을 노드가 없습니다. byId(root, \'id\') 의 id 를 확인하세요.')
  const update = node.props[`onUpdate:${prop}`]
  if (!update) throw new Error(`v-model 이 없는 노드입니다: ${node.type}`)
  update(value)
  await flush()
}

export async function submit(root) {
  const form = find(root, (node) => node.type === 'form')
  if (!form) throw new Error('form 이 없습니다.')
  await form.props.onSubmit?.(event(form))
  await flush()
}
