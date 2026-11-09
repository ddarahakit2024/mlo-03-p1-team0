import { describe, expect, test } from '@jest/globals'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const componentsRoot = dirname(fileURLToPath(import.meta.url))
const componentFiles = readdirSync(componentsRoot).filter((filename) => filename.endsWith('.vue'))
const readme = readFileSync(resolve(componentsRoot, 'README.md'), 'utf8')

function readmeRow(name) {
  return readme.split('\n').find((line) => line.startsWith(`| ${name} |`)) || ''
}

describe('component Vue templates', () => {
  test.each(componentFiles)('%s parses and compiles', (filename) => {
    const source = readFileSync(resolve(componentsRoot, filename), 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    expect(errors).toEqual([])

    const script = compileScript(descriptor, { id: filename })
    const template = compileTemplate({
      source: descriptor.template.content,
      filename,
      id: filename,
      compilerOptions: { bindingMetadata: script.bindings },
    })

    expect(template.errors).toEqual([])
  })
})

describe('components/README.md 표가 코드와 같다', () => {
  test.each(componentFiles)('%s 의 props 와 emits 가 표에 있다', (filename) => {
    const source = readFileSync(resolve(componentsRoot, filename), 'utf8')
    const { descriptor } = parse(source, { filename })
    const script = compileScript(descriptor, { id: filename })
    const props = Object.entries(script.bindings).filter(([, type]) => type === 'props').map(([name]) => name)
    const emits = [...(source.match(/defineEmits\(\[([^\]]*)\]\)/)?.[1] || '').matchAll(/'([^']+)'/g)].map((match) => match[1])
    const row = readmeRow(filename.replace('.vue', ''))
    expect(row).not.toBe('')
    for (const name of [...props, ...emits]) expect(row).toContain(name)
  })

  test('SiteLayout 의 activePage 값(레이아웃이 비교하는 값, 화면이 넘기는 값)이 표에 있다', () => {
    const layout = readFileSync(resolve(componentsRoot, 'SiteLayout.vue'), 'utf8')
    const viewsRoot = resolve(componentsRoot, '..', 'views')
    const views = readdirSync(viewsRoot).map((filename) => readFileSync(resolve(viewsRoot, filename), 'utf8')).join('\n')
    const values = new Set([
      ...[...layout.matchAll(/activePage === '(\w+)'/g)].map((match) => match[1]),
      ...[...views.matchAll(/active-page="(\w+)"/g)].map((match) => match[1]),
    ])
    expect([...values].sort()).toEqual(['alerts', 'auth', 'cart', 'community', 'compare', 'my', 'orders', 'products', 'questions'])
    const row = readmeRow('SiteLayout')
    for (const value of values) expect(row).toContain(value)
  })
})
