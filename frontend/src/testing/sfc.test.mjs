// 테스트 도구(sfc.mjs) 자체의 테스트. 실제 화면(QuestionList.vue)으로 쓰는 법도 보여 준다.
import { jest } from '@jest/globals'
import { button, byId, byRole, click, compileSfc, deferred, flush, mount, setValue, stub, submit, text } from './sfc.mjs'

const question = { id: 7, title: 'S3 업로드 질문', content: '내용', author: { name: '학습자' }, created_at: '2026-10-27T00:00:00', image_count: 0 }

describe('compileSfc + mount: 실제 화면', () => {
  const fetchQuestions = jest.fn()
  let QuestionList
  beforeAll(async () => { QuestionList = await compileSfc('views/QuestionList.vue', { fetchQuestions }) })
  beforeEach(() => fetchQuestions.mockReset())

  test('응답 전에는 로딩, 응답 뒤에는 목록을 보여 준다', async () => {
    const response = deferred()
    fetchQuestions.mockReturnValue(response.promise)
    const page = mount(QuestionList)
    await flush()
    expect(text(byRole(page.root, 'status')[0])).toContain('질문을 불러오는 중입니다')
    response.resolve({ items: [question], total: 1, page: 1 })
    await flush()
    expect(text(page.root)).toContain('S3 업로드 질문')
    expect(text(page.root)).toContain('전체 질문 1개')
  })

  test('실패하면 오류와 다시 시도 버튼을 보여 주고, 누르면 다시 부른다', async () => {
    fetchQuestions.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue({ items: [], total: 0, page: 1 })
    const page = mount(QuestionList)
    await flush()
    expect(text(byRole(page.root, 'alert')[0])).toContain('질문 목록을 불러오지 못했습니다')
    await click(button(page.root, '다시 시도'))
    expect(fetchQuestions).toHaveBeenCalledTimes(2)
    expect(text(page.root)).toContain('아직 등록된 질문이 없습니다.')
  })

  test('검색어를 넣고 제출하면 1쪽부터 검색한다', async () => {
    fetchQuestions.mockResolvedValue({ items: [], total: 0, page: 1 })
    const page = mount(QuestionList)
    await flush()
    await setValue(byId(page.root, 'question-search'), ' S3 ')
    await submit(page.root)
    expect(fetchQuestions).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: 'S3' })
    expect(text(page.root)).toContain('검색 결과가 없습니다.')
  })

  test('.vue 컴포넌트는 가짜(stub)로 바뀌고 넘긴 props 를 확인할 수 있다', async () => {
    fetchQuestions.mockResolvedValue({ items: [], total: 0, page: 1 })
    const page = mount(QuestionList)
    await flush()
    expect(stub(page.root, 'SiteLayout').props['active-page']).toBe('questions')
  })
})

describe('compileSfc: 직접 쓴 SFC', () => {
  const source = `<script setup>
import { ref } from 'vue'
import ProductGrid from '../components/ProductGrid.vue'
defineProps({ title: { type: String, default: '' } })
const emit = defineEmits(['pick'])
const count = ref(0)
function add() { count.value += 1; emit('pick', count.value) }
</script>
<template>
  <section><h1>{{ title }}</h1><button type="button" @click="add">눌러 {{ count }}</button>
  <ProductGrid :products="[1, 2]" @select="emit('pick', $event)"><b>슬롯 내용</b></ProductGrid></section>
</template>`

  test('props, emit, 클릭, stub 의 slot 과 이벤트가 동작한다', async () => {
    const onPick = jest.fn()
    const View = await compileSfc('testing/Example.vue', {}, { source })
    const page = mount(View, { title: '제목', onPick })
    expect(text(page.root)).toContain('제목')
    expect(text(page.root)).toContain('슬롯 내용')
    await click(button(page.root, '눌러'))
    expect(text(page.root)).toContain('눌러 1')
    expect(onPick).toHaveBeenLastCalledWith(1)
    const grid = stub(page.root, 'ProductGrid')
    expect(grid.props.products).toEqual([1, 2])
    grid.props.onSelect('product')
    expect(onPick).toHaveBeenLastCalledWith('product')
  })

  test('넘기지 않은 외부 패키지 import 는 무엇을 넘겨야 하는지 알려 준다', async () => {
    const broken = `<script setup>\nimport { magic } from 'some-package'\n</script>\n<template><p>{{ magic }}</p></template>`
    await expect(compileSfc('testing/Broken.vue', {}, { source: broken })).rejects.toThrow(/magic.*넘기세요/)
  })

  test('비활성화된 버튼을 누르면 테스트가 실패한다', async () => {
    const View = await compileSfc('testing/Disabled.vue', {}, { source: '<template><button type="button" disabled>저장</button></template>' })
    const page = mount(View)
    await expect(click(button(page.root, '저장'))).rejects.toThrow('비활성화')
  })
})
