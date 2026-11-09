import axios from 'axios'
import { jest } from '@jest/globals'
import { createAnswer, createQuestion, deleteAnswer, deleteQuestion, fetchQuestion, fetchQuestions, updateAnswer, updateQuestion } from './api/questionApi.js'
import { resolveQuestionRoute } from './router/index.js'
import { MAX_QUESTION_IMAGE_SIZE, validateQuestion, validateQuestionImages } from './stores/questionViewModel.js'

afterEach(() => jest.restoreAllMocks())

function signedUpload(id, type = 'image/png') {
  return { upload_id: id, url: `https://bucket.s3.ap-northeast-2.amazonaws.com/staging/${id}?signature=secret`, method: 'PUT', headers: { 'Content-Type': type }, expires_in: 600 }
}

function storageAdapter(implementation) {
  const adapter = jest.fn(implementation || (async (config) => ({ data: '', status: 200, statusText: 'OK', headers: {}, config })))
  jest.spyOn(axios, 'getAdapter').mockReturnValue(adapter)
  return adapter
}

test('question reads use configured API, pagination and session credentials', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { result: { items: [], total: 0 } } })
  expect(await fetchQuestions({ page: 2, search: 'S3', apiBaseUrl: 'https://api.example.test/' })).toEqual({ items: [], total: 0 })
  expect(get).toHaveBeenCalledWith('https://api.example.test/questions', { withCredentials: true, params: { page: 2, page_size: 10, search: 'S3' } })
  await fetchQuestion(7)
  expect(get).toHaveBeenLastCalledWith('http://127.0.0.1:8000/questions/7', { withCredentials: true })
})

test('uploads raw files to signed URLs then posts JSON references without backend file bytes', async () => {
  const sequence = []
  const uploads = [signedUpload('one'), signedUpload('two', 'image/jpeg')]
  let uploadIndex = 0
  const post = jest.spyOn(axios, 'post').mockImplementation(async (url) => {
    if (url.endsWith('/presign')) {
      const upload = uploads[uploadIndex++]
      sequence.push(`presign:${upload.upload_id}`)
      return { data: { result: upload } }
    }
    sequence.push('create')
    return { data: { result: { id: 8 } } }
  })
  const adapter = storageAdapter(async (config) => {
    sequence.push(`put:${config.data.name}`)
    return { data: '', status: 200, statusText: 'OK', headers: {}, config }
  })
  const images = [new File(['first'], 'one.png', { type: 'image/png' }), new File(['second'], 'two.jpg', { type: 'image/jpeg' })]
  expect(await createQuestion({ title: ' 제목 ', content: ' 내용 ', images })).toEqual({ id: 8 })
  expect(sequence).toEqual(['presign:one', 'put:one.png', 'presign:two', 'put:two.jpg', 'create'])
  images.forEach((image, index) => {
    expect(post).toHaveBeenNthCalledWith(index + 1, 'http://127.0.0.1:8000/questions/uploads/presign', {
      filename: image.name, content_type: image.type, size: image.size,
    }, { withCredentials: true })
    const config = adapter.mock.calls[index][0]
    expect(config.url).toBe(uploads[index].url)
    expect(config.method).toBe('put')
    expect(config.data).toBe(image)
    expect(config.headers.toJSON()).toEqual(uploads[index].headers)
    expect(config.withCredentials).toBe(false)
    expect(config.withXSRFToken).toBe(false)
  })
  expect(post).toHaveBeenLastCalledWith('http://127.0.0.1:8000/questions', {
    title: '제목', content: '내용', upload_ids: ['one', 'two'],
  }, { withCredentials: true })
})

test('direct storage transport ignores global backend defaults, transforms and interceptors', async () => {
  jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { result: signedUpload('private') } }).mockResolvedValueOnce({ data: { result: { id: 8 } } })
  const adapter = storageAdapter()
  const saved = { withCredentials: axios.defaults.withCredentials, auth: axios.defaults.auth, transformRequest: axios.defaults.transformRequest, baseURL: axios.defaults.baseURL, commonHeaders: axios.defaults.headers.common }
  const interceptor = axios.interceptors.request.use(() => { throw new Error('Backend interceptor must not run on storage') })
  try {
    axios.defaults.withCredentials = true
    axios.defaults.auth = { username: 'backend', password: 'secret' }
    axios.defaults.baseURL = 'https://backend.example.test'
    axios.defaults.headers.common = { Authorization: 'Bearer backend-secret', 'X-Backend': 'private' }
    axios.defaults.transformRequest = [() => { throw new Error('Backend transform must not run') }]
    await createQuestion({ title: '제목', content: '내용', images: [new File(['png'], 'one.png', { type: 'image/png' })] })
    const config = adapter.mock.calls[0][0]
    expect(config.auth).toBeUndefined()
    expect(config.baseURL).toBeUndefined()
    expect(config.headers.toJSON()).toEqual({ 'Content-Type': 'image/png' })
    expect(config.withCredentials).toBe(false)
  } finally {
    for (const key of ['withCredentials', 'auth', 'transformRequest', 'baseURL']) {
      if (saved[key] === undefined) delete axios.defaults[key]
      else axios.defaults[key] = saved[key]
    }
    axios.defaults.headers.common = saved.commonHeaders
    axios.interceptors.request.eject(interceptor)
  }
})

test('text only creation skips signing and storage; owner edits and deletes keep credentials', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: { id: 9 } } })
  const adapter = storageAdapter()
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue({ data: { result: { id: 9 } } })
  const remove = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { result: null } })
  await createQuestion({ title: '제목', content: '내용' })
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/questions', { title: '제목', content: '내용', upload_ids: [] }, { withCredentials: true })
  expect(adapter).not.toHaveBeenCalled()
  await updateQuestion(9, { title: ' 수정 ', content: ' 새 내용 ' })
  expect(patch).toHaveBeenCalledWith('http://127.0.0.1:8000/questions/9', { title: '수정', content: '새 내용' }, { withCredentials: true })
  expect(await deleteQuestion(9)).toBeNull()
  expect(remove).toHaveBeenCalledWith('http://127.0.0.1:8000/questions/9', { withCredentials: true })
})

test('signing failure stops upload and question creation while preserving auth errors', async () => {
  const failure = { response: { status: 401, data: { message: '로그인이 필요합니다.' } } }
  const post = jest.spyOn(axios, 'post').mockRejectedValue(failure)
  const adapter = storageAdapter()
  await expect(createQuestion({ title: '제목', content: '내용', images: [new File(['png'], 'one.png', { type: 'image/png' })] })).rejects.toBe(failure)
  expect(post).toHaveBeenCalledTimes(1)
  expect(adapter).not.toHaveBeenCalled()
})

test('storage failure stops final create and hides signed URL in a recoverable error', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: signedUpload('failed') } })
  storageAdapter(async () => { throw new Error('CORS error https://bucket.s3.amazonaws.com?signature=secret') })
  const images = [new File(['png'], 'one.png', { type: 'image/png' })]
  await expect(createQuestion({ title: '제목', content: '내용', images })).rejects.toMatchObject({ code: 'QUESTION_IMAGE_UPLOAD_FAILED' })
  await expect(createQuestion({ title: '제목', content: '내용', images })).rejects.toThrow('다시 등록')
  expect(post.mock.calls.every(([url]) => url.endsWith('/uploads/presign'))).toBe(true)
})

test('a retry after final create failure signs fresh upload IDs and uploads again', async () => {
  const images = [new File(['png'], 'one.png', { type: 'image/png' })]
  const post = jest.spyOn(axios, 'post')
    .mockResolvedValueOnce({ data: { result: signedUpload('old') } })
    .mockRejectedValueOnce({ response: { status: 503 } })
    .mockResolvedValueOnce({ data: { result: signedUpload('new') } })
    .mockResolvedValueOnce({ data: { result: { id: 5 } } })
  const adapter = storageAdapter()
  await expect(createQuestion({ title: '제목', content: '내용', images })).rejects.toEqual({ response: { status: 503 } })
  expect(await createQuestion({ title: '제목', content: '내용', images })).toEqual({ id: 5 })
  expect(adapter).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenLastCalledWith('http://127.0.0.1:8000/questions', { title: '제목', content: '내용', upload_ids: ['new'] }, { withCredentials: true })
})

test('invalid content and attachments fail before any upload', async () => {
  const post = jest.spyOn(axios, 'post')
  await expect(createQuestion({ title: '  ', content: '내용' })).rejects.toThrow('제목')
  await expect(createQuestion({ title: '제목', content: '내용', images: [{ name: 'x.svg', type: 'image/svg+xml', size: 10 }] })).rejects.toThrow('JPG')
  expect(post).not.toHaveBeenCalled()
  expect(validateQuestion({ title: 'x'.repeat(201), content: '내용' })).toContain('200')
  expect(validateQuestion({ title: '제목', content: ' ' })).toContain('내용')
  expect(validateQuestion({ title: '제목', content: 'x'.repeat(10001) })).toContain('10,000')
  const image = { type: 'image/png', size: 1 }
  expect(validateQuestionImages(Array(6).fill(image))).toContain('5장')
  expect(validateQuestionImages([{ ...image, size: MAX_QUESTION_IMAGE_SIZE + 1 }])).toContain('5MB')
  expect(validateQuestionImages([{ ...image, size: 0 }])).toContain('비어')
  expect(validateQuestionImages([{ ...image, size: MAX_QUESTION_IMAGE_SIZE }])).toBe('')
})

test.each([
  ['/questions', { name: 'questions' }],
  ['/questions/', { name: 'questions' }],
  ['/questions/new', { name: 'question-new' }],
  ['/questions/7', { name: 'question-detail', id: 7 }],
  ['/questions/7/edit', { name: 'question-edit', id: 7 }],
  ['/questions/abc', { name: 'question-detail', id: null }],
  ['/questions/0', { name: 'question-detail', id: null }],
  ['/questions/99999999999999999999', { name: 'question-detail', id: null }],
  ['/products/7', null],
])('question route %s', (path, expected) => expect(resolveQuestionRoute(path)).toEqual(expected))

test('답변 작성·수정·삭제는 경로 값을 인코딩하고 내용 앞뒤 공백을 지워 쿠키와 함께 보낸다', async () => {
  const answer = { id: 31, question_id: 7, content: '파워 케이블을 확인해 보세요.' }
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { code: 201, message: 'ok', result: answer } })
  const patch = jest.spyOn(axios, 'patch').mockResolvedValue({ data: { result: answer } })
  const remove = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { result: null } })
  await expect(createAnswer(7, { content: '  파워 케이블을 확인해 보세요.  ' })).resolves.toEqual(answer)
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:8000/questions/7/answers', { content: '파워 케이블을 확인해 보세요.' }, { withCredentials: true })
  await updateAnswer('a/b', 'c/d', { content: ' 수정 ' }, { apiBaseUrl: 'https://api.example.test/' })
  expect(patch).toHaveBeenCalledWith('https://api.example.test/questions/a%2Fb/answers/c%2Fd', { content: '수정' }, { withCredentials: true })
  await expect(deleteAnswer(7, 31)).resolves.toBeNull()
  expect(remove).toHaveBeenCalledWith('http://127.0.0.1:8000/questions/7/answers/31', { withCredentials: true })
})

test('빈 답변과 5,000자를 넘는 답변은 요청하지 않고 오류를 던진다', async () => {
  const post = jest.spyOn(axios, 'post')
  const patch = jest.spyOn(axios, 'patch')
  await expect(createAnswer(7, { content: '   ' })).rejects.toThrow('답변 내용을 입력해 주세요.')
  await expect(updateAnswer(7, 31, { content: '가'.repeat(5001) })).rejects.toThrow('5,000자')
  expect(post).not.toHaveBeenCalled()
  expect(patch).not.toHaveBeenCalled()
})

test('답변 요청 오류는 잡지 않고 던진다', async () => {
  const failure = { response: { status: 403, data: { message: '본인 답변만 수정할 수 있습니다.' } } }
  jest.spyOn(axios, 'delete').mockRejectedValue(failure)
  await expect(deleteAnswer(7, 31)).rejects.toBe(failure)
})
