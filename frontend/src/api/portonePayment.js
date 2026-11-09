import * as PortOne from '@portone/browser-sdk/v2'

// PortOne V2 결제창. 모바일은 결제 후 redirectUrl(/payments/complete)로 돌아오고,
// 데스크톱은 결제창이 닫히면 결과({ code?, message?, paymentId })를 돌려준다. code 가 있으면 취소·실패다.
export const PAYMENT_REDIRECT_PATH = '/payments/complete'

/** POST /orders 응답(PaymentRequest)을 PortOne 결제 요청으로 바꾼다. 금액은 서버가 준 total_amount 를 그대로 쓴다. */
export function createPortOnePaymentRequest(order, origin = window.location.origin) {
  return {
    storeId: order.store_id,
    channelKey: order.channel_key,
    paymentId: order.payment_id,
    orderName: order.order_name,
    totalAmount: order.total_amount,
    currency: order.currency || 'KRW',
    payMethod: 'CARD',
    locale: 'KO_KR',
    redirectUrl: new URL(PAYMENT_REDIRECT_PATH, origin).toString(),
  }
}

export async function launchPortOnePayment(order) {
  return PortOne.requestPayment(createPortOnePaymentRequest(order))
}
