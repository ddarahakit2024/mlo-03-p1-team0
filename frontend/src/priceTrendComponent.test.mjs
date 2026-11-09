// 가격 추세 공용 컴포넌트: PriceSparkline(추세선 + 텍스트 대안), PriceChangeBadge(방향 글자 + 변동률).
import { compileSfc, find, mount, text } from './testing/sfc.mjs'

let PriceSparkline
let PriceChangeBadge

beforeAll(async () => {
  PriceSparkline = await compileSfc('components/PriceSparkline.vue')
  PriceChangeBadge = await compileSfc('components/PriceChangeBadge.vue')
})

const svgOf = (root) => find(root, (node) => node.type === 'svg')

test('추세선은 role=img 와 시작가·현재가·변동률 텍스트 대안을 갖고, 내림이면 down 톤이다', () => {
  const view = mount(PriceSparkline, { values: [395200, 390000, 388400], changePct: -1.7 })
  const svg = svgOf(view.root)
  expect(svg.props.role).toBe('img')
  expect(svg.props['aria-label']).toBe('최근 30일 가격 추이: 395,200원에서 388,400원(-1.7%)')
  expect(String(svg.props.class)).toContain('price-sparkline--down')
  expect(find(view.root, (node) => node.type === 'path').props.d).toMatch(/^M2\.0 /)
})

test('추세선은 값이 없으면 그리지 않고, label 을 주면 그 글자를 쓴다', () => {
  expect(svgOf(mount(PriceSparkline, { values: [] }).root)).toBeNull()
  const svg = svgOf(mount(PriceSparkline, { values: [1, 2], changePct: 3, label: '추이' }).root)
  expect(svg.props['aria-label']).toBe('추이')
  expect(String(svg.props.class)).toContain('price-sparkline--up')
})

test.each([
  [{ pct: -5.2 }, '30일▼-5.2%', 'price-change--down'],
  [{ pct: 2 }, '30일▲+2.0%', 'price-change--up'],
  [{ pct: 0.1, prefix: '' }, '+0.1%', 'price-change--flat'],
  [{ pct: null }, '30일—', 'price-change--flat'],
])('변동률 배지 %p', (props, expected, tone) => {
  const view = mount(PriceChangeBadge, props)
  expect(text(view.root).replace(/\s+/g, '')).toBe(expected)
  expect(String(find(view.root, (node) => node.type === 'span').props.class)).toContain(tone)
})
