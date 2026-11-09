// 목표가 알림 API(src/api/alertApi.js): GET /alerts, PUT·DELETE /alerts/{product_id}. 모두 쿠키를 싣는다.
import axios from 'axios'
import { jest } from '@jest/globals'
import { deleteAlert, fetchAlerts, saveAlert, validateTargetPrice } from './api/alertApi.js'

afterEach(() => jest.restoreAllMocks())

const alert = { product_id: 7, target_price_krw: 690000, reached: true, product: { id: 7 } }
const ok = (result) => ({ data: { code: 200, message: '', result } })

test('목록은 쿠키를 싣고 result 를 돌려준다', async () => {
  const get = jest.spyOn(axios, 'get').mockResolvedValue(ok({ items: [alert] }))
  await expect(fetchAlerts()).resolves.toEqual({ items: [alert] })
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:8000/alerts', { withCredentials: true })
})

test('저장은 PUT 으로 target_price_krw 만 보내고 경로 값을 인코딩한다', async () => {
  const put = jest.spyOn(axios, 'put').mockResolvedValue(ok(alert))
  await expect(saveAlert(7, { targetPriceKrw: 690000 })).resolves.toEqual(alert)
  expect(put).toHaveBeenCalledWith('http://127.0.0.1:8000/alerts/7', { target_price_krw: 690000 }, { withCredentials: true })
  await saveAlert('a/b', { targetPriceKrw: 1 }, { apiBaseUrl: 'https://api.example.test/' })
  expect(put).toHaveBeenLastCalledWith('https://api.example.test/alerts/a%2Fb', { target_price_krw: 1 }, { withCredentials: true })
})

test.each([[0], [-1], [1.5], [100000001], [null], ['1000']])('목표가 %p 는 요청하지 않고 던진다', async (value) => {
  const put = jest.spyOn(axios, 'put')
  await expect(saveAlert(7, { targetPriceKrw: value })).rejects.toThrow('목표 가격을 1원 이상 1억 원 이하의 숫자로 입력해 주세요.')
  expect(put).not.toHaveBeenCalled()
})

test.each([[1, ''], [100000000, ''], [0, '목표 가격을 1원 이상 1억 원 이하의 숫자로 입력해 주세요.']])('validateTargetPrice(%p)', (value, expected) => {
  expect(validateTargetPrice(value)).toBe(expected)
})

test('삭제는 DELETE /alerts/{product_id}', async () => {
  const del = jest.spyOn(axios, 'delete').mockResolvedValue(ok(null))
  await expect(deleteAlert(7)).resolves.toBeNull()
  expect(del).toHaveBeenCalledWith('http://127.0.0.1:8000/alerts/7', { withCredentials: true })
})
