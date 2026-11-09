// 장바구니 view model(src/stores/cartViewModel.js)과 장바구니 경로.
import { jest } from '@jest/globals'
import {
  BUILD_ADD_FAILED_MESSAGE,
  CART_QUOTE_PATH,
  CART_TOASTS,
  buildAddEventProps,
  buildAddedMessage,
  buildResultMessage,
  buildSkippedSummary,
  canCheckout,
  cartAddFailureToast,
  cartBuildSource,
  cartError,
  cartStockWarning,
  checkoutPath,
  externalSavingText,
  getCartPageState,
  goToCheckout,
  priceChangeLine,
  steppedQuantity,
  validateBuildComment,
  validateCartItem,
  validateCartQuantity,
} from './stores/cartViewModel.js'
import { isCartRoute } from './router/index.js'

const item = { product_id: 3, name: '지포스 RTX 4070 SUPER 12GB', price_krw: 899000, stock: 7, quantity: 2, subtotal_krw: 1798000 }

test.each([
  [{ loading: true }, 'loading'],
  [{ loading: false, needsLogin: true }, 'guest'],
  [{ loading: false, error: '실패' }, 'error'],
  [{ loading: false, cart: null }, 'empty'],
  [{ loading: false, cart: { items: [], item_count: 0, total_krw: 0 } }, 'empty'],
  [{ loading: false, cart: { items: [item], item_count: 2, total_krw: 1798000 } }, 'ready'],
])('화면 상태 %o → %s', (data, state) => expect(getCartPageState(data)).toBe(state))

test.each([
  [1, ''], [10, ''],
  [0, '수량은 1개 이상 선택해 주세요.'],
  [2.5, '수량은 1개 이상 선택해 주세요.'],
  ['2', '수량은 1개 이상 선택해 주세요.'],
  [11, '한 상품은 10개까지 담을 수 있습니다.'],
])('수량 %p → %p', (quantity, message) => expect(validateCartQuantity(quantity)).toBe(message))

test.each([
  [{ productId: 3, quantity: 1 }, ''],
  [{ productId: 0, quantity: 1 }, '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
  [{ productId: '3', quantity: 1 }, '상품 정보가 올바르지 않습니다. 상품을 다시 선택해 주세요.'],
  [{ productId: 3, quantity: 11 }, '한 상품은 10개까지 담을 수 있습니다.'],
])('담기 입력 %o → %p', (input, message) => expect(validateCartItem(input)).toBe(message))

test.each([
  [{ ...item }, ''],
  [{ ...item, stock: 0 }, '품절된 상품입니다. 삭제한 뒤 주문해 주세요.'],
  [{ ...item, stock: 1, quantity: 2 }, '재고가 1개 남았습니다. 수량을 줄여 주세요.'],
  [{ ...item, stock: 2, quantity: 2 }, ''],
])('재고 경고 %o → %p', (row, message) => expect(cartStockWarning(row)).toBe(message))

// 담은 뒤 가격 변동(CartItem.added_price_krw·price_change_krw, 서버 값 = 지금 가격 - 담을 때 가격)
test.each([
  ['내려감', { ...item, added_price_krw: 912000, price_change_krw: -13000 }, { text: '담았을 때보다 13,000원 내려갔어요', tone: 'down', arrow: '▼' }],
  ['오름', { ...item, added_price_krw: 889000, price_change_krw: 10000 }, { text: '담았을 때보다 10,000원 올랐어요', tone: 'up', arrow: '▲' }],
  ['같음', { ...item, added_price_krw: 899000, price_change_krw: 0 }, { text: '담은 뒤 가격 변동 없음', tone: 'flat', arrow: '' }],
  ['담을 때 가격을 모르는 줄(기능 전에 담음)은 숨김', { ...item, added_price_krw: null, price_change_krw: null }, null],
  ['필드가 없는 옛 응답도 숨김', { ...item }, null],
  ['변동 값이 없으면 숨김(계산하지 않는다)', { ...item, added_price_krw: 912000, price_change_krw: null }, null],
  ['줄이 없으면 숨김', null, null],
])('담은 뒤 가격 변동 줄: %s', (_name, row, expected) => expect(priceChangeLine(row)).toEqual(expected))

test.each([
  [{ external_saving_krw: 12000 }, '−12,000원'],
  [{ external_saving_krw: 1234567 }, '−1,234,567원'],
  [{ external_saving_krw: 0 }, ''],
  [{ external_saving_krw: -500 }, ''],
  [{ external_saving_krw: null }, ''],
  [{ items: [], item_count: 0, total_krw: 0 }, ''],
  [null, ''],
])('타몰 최저가 대비 %o → %p', (cart, expected) => expect(externalSavingText(cart)).toBe(expected))

test.each([
  ['+ 는 한 개 늘린다', { quantity: 2, stock: 7 }, 1, 3],
  ['− 는 한 개 줄인다', { quantity: 2, stock: 7 }, -1, 1],
  ['1개에서 − 는 막는다(빼려면 삭제)', { quantity: 1, stock: 7 }, -1, null],
  ['재고만큼 담았으면 + 를 막는다', { quantity: 7, stock: 7 }, 1, null],
  ['한 상품 최대 10개', { quantity: 10, stock: 30 }, 1, null],
  ['재고보다 많이 담긴 줄은 − 로 줄일 수 있다', { quantity: 5, stock: 2 }, -1, 4],
  ['재고보다 많이 담긴 줄의 + 는 막는다', { quantity: 5, stock: 2 }, 1, null],
  ['품절이면 + 를 막는다', { quantity: 2, stock: 0 }, 1, null],
  ['수량이 정수가 아니면 null', { quantity: '2', stock: 7 }, 1, null],
  ['변화량 0 은 null', { quantity: 2, stock: 7 }, 0, null],
])('수량 버튼: %s', (_name, row, delta, expected) => expect(steppedQuantity(row, delta)).toBe(expected))

test.each([
  ['401 은 로그인 안내', { response: { status: 401 } }, '로그인이 필요해요'],
  ['409 재고 부족은 서버 문구', { response: { status: 409, data: { message: '재고가 부족합니다.' } } }, '재고가 부족합니다.'],
  ['500 은 우리 문구', { response: { status: 500 } }, CART_TOASTS.failed],
  ['네트워크 오류는 우리 문구', { code: 'ERR_NETWORK' }, '장바구니에 담지 못했어요. 다시 시도해 주세요.'],
])('다른 화면의 담기 실패 토스트: %s', (_name, error, expected) => expect(cartAddFailureToast(error)).toBe(expected))

test('장바구니 구성으로 견적 의견 받기 주소와 담기 토스트 문구', () => {
  expect(CART_QUOTE_PATH).toBe('/community/build/new?from=cart')
  expect(CART_TOASTS.added).toBe('장바구니에 담았어요')
})

test.each([
  [null, false],
  [{ items: [] }, false],
  [{ items: [item] }, true],
  [{ items: [item, { ...item, product_id: 4, stock: 0 }] }, false],
])('주문 가능 %o → %s', (cart, expected) => expect(canCheckout(cart)).toBe(expected))

const fallback = '장바구니를 불러오지 못했습니다. 다시 시도해 주세요.'
test.each([
  ['401 은 로그인 만료', { response: { status: 401, data: { message: 'Authentication required.' } } }, '로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.'],
  ['409 재고 부족은 서버 문구 그대로', { response: { status: 409, data: { message: "'라이젠 7 7800X3D' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다." } } }, "'라이젠 7 7800X3D' 상품의 재고가 부족합니다. 최대 1개까지 주문할 수 있습니다."],
  ['404 는 서버 문구', { response: { status: 404, data: { message: '장바구니에 없는 상품입니다.' } } }, '장바구니에 없는 상품입니다.'],
  ['500 은 우리 문구', { response: { status: 500, data: { message: 'Internal Server Error' } } }, fallback],
  ['네트워크 오류는 우리 문구', { isAxiosError: true, code: 'ERR_NETWORK' }, fallback],
  ['문구 없는 403 은 우리 문구', { response: { status: 403, data: '<html>' } }, fallback],
])('%s', (_name, error, message) => expect(cartError(error, fallback)).toBe(message))

test.each([
  [undefined, '/checkout'],
  [{}, '/checkout'],
  [{ productId: 3, quantity: 2 }, '/checkout?product=3&quantity=2'],
  [{ productId: 9 }, '/checkout?product=9&quantity=1'],
])('주문서 주소 %o → %s', (options, path) => expect(checkoutPath(options)).toBe(path))

test('주문서로 이동한다(바로 구매는 상품·수량을 주소에 담는다)', () => {
  const location = { assign: jest.fn() }
  goToCheckout({ productId: 3, quantity: 2 }, location)
  expect(location.assign).toHaveBeenLastCalledWith('/checkout?product=3&quantity=2')
  goToCheckout({}, location)
  expect(location.assign).toHaveBeenLastCalledWith('/checkout')
})

test.each([['/cart', true], ['/cart/', true], ['/cart/items', false], ['/carts', false]])('장바구니 경로 %s → %s', (path, expected) => {
  expect(isCartRoute(path)).toBe(expected)
})

// 견적 → 장바구니(spec docs/specs/2026-11-01-build-id-purpose.md)
const BUILD_ID = '3f2a9c1e5b7d4e8fa0c1d2e3f4a5b6c7'
const BAD_BUILD = '견적 정보가 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.'

test.each([
  [1, ''], [10, ''], [0, BAD_BUILD], [2.5, BAD_BUILD], ['10', BAD_BUILD], [null, BAD_BUILD],
])('견적 댓글 id %p → %p', (commentId, message) => expect(validateBuildComment(commentId)).toBe(message))

test.each([
  ['모두 담음', { added: [{ product_id: 1, quantity: 1 }, { product_id: 3, quantity: 1 }, { product_id: 6, quantity: 2 }], skipped: [] }, '부품 3개를 장바구니에 담았습니다.', ''],
  ['품절·한도 제외', { added: [{ product_id: 1, quantity: 1 }], skipped: [{ product_id: 7, reason: 'sold_out' }, { product_id: 6, reason: 'limit' }] }, '부품 1개를 장바구니에 담았습니다.', '(품절 1개, 최대 수량 1개 제외)'],
  ['이유 순서는 품절 → 판매 안 함 → 최대 수량, 같은 이유는 합친다', { added: [{ product_id: 1, quantity: 1 }], skipped: [{ product_id: 6, reason: 'limit' }, { product_id: 9, reason: 'unavailable' }, { product_id: 7, reason: 'sold_out' }, { product_id: 8, reason: 'sold_out' }] }, '부품 1개를 장바구니에 담았습니다.', '(품절 2개, 판매 안 함 1개, 최대 수량 1개 제외)'],
  ['모르는 이유는 기타', { added: [{ product_id: 1, quantity: 1 }], skipped: [{ product_id: 7, reason: 'mystery' }] }, '부품 1개를 장바구니에 담았습니다.', '(기타 1개 제외)'],
  ['응답이 비어도 던지지 않는다', null, '부품 0개를 장바구니에 담았습니다.', ''],
])('견적 담기 결과 문구: %s', (_name, result, added, skipped) => {
  expect(buildAddedMessage(result)).toBe(added)
  expect(buildSkippedSummary(result)).toBe(skipped)
  // 화면의 status 한 줄 = 두 문구를 한 칸 띄워 잇는다(뺀 것이 없으면 앞 문장만)
  expect(buildResultMessage(result)).toBe(skipped ? `${added} ${skipped}` : added)
})

test('build_add_to_cart props 는 서버 응답 그대로(줄 수·뺀 수·담은 상품 id·뺀 이유)이고 목록은 20개까지', () => {
  const result = {
    build_id: BUILD_ID, post_id: 3, comment_id: 10,
    added: [{ product_id: 1, quantity: 1 }, { product_id: 6, quantity: 2 }],
    skipped: [{ product_id: 7, reason: 'sold_out' }, { product_id: 9, reason: 'limit' }],
    cart: { items: [], item_count: 0, total_krw: 0 },
  }
  expect(buildAddEventProps(result)).toEqual({
    build_id: BUILD_ID, post_id: 3, comment_id: 10, added_count: 2, skipped_count: 2, product_ids: [1, 6], skipped_reasons: ['sold_out', 'limit'],
  })
  const many = buildAddEventProps({ ...result, added: Array.from({ length: 25 }, (_, index) => ({ product_id: index + 1, quantity: 1 })), skipped: Array.from({ length: 22 }, () => ({ product_id: 99, reason: 'limit' })) })
  expect(many).toMatchObject({ added_count: 25, skipped_count: 22 })
  expect(many.product_ids).toHaveLength(20)
  expect(many.skipped_reasons).toHaveLength(20)
  expect(buildAddEventProps(null)).toEqual({ build_id: null, post_id: null, comment_id: null, added_count: 0, skipped_count: 0, product_ids: [], skipped_reasons: [] })
})

test.each([
  ['견적에서 담은 줄은 견적 글 링크', { ...item, build: { id: BUILD_ID, post_id: 3, comment_id: 10 } }, { label: '견적에서 담음', href: '/community/posts/3' }],
  ['post_id 가 null 이면 글자만', { ...item, build: { id: BUILD_ID, post_id: null, comment_id: null } }, { label: '견적에서 담음', href: '' }],
  ['직접 담은 줄(build null)은 표시 없음', { ...item, build: null }, null],
  ['build 필드가 없는 응답도 표시 없음', { ...item }, null],
])('장바구니 줄 표시: %s', (_name, row, expected) => expect(cartBuildSource(row)).toEqual(expected))

test('견적 담기 실패 문구: 401 은 로그인 만료, 409 는 서버 문구, 500 은 우리 문구', () => {
  expect(cartError({ response: { status: 401 } }, BUILD_ADD_FAILED_MESSAGE)).toBe('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.')
  expect(cartError({ response: { status: 409, data: { message: '담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.' } } }, BUILD_ADD_FAILED_MESSAGE)).toBe('담을 수 있는 부품이 없습니다. 품절이거나 이미 최대 수량입니다.')
  expect(cartError({ response: { status: 500 } }, BUILD_ADD_FAILED_MESSAGE)).toBe('견적을 장바구니에 담지 못했습니다. 다시 시도해 주세요.')
})
