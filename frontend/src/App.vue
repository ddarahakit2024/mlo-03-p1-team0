<script setup>
import LoginPage from './views/LoginPage.vue'
import MyPage from './views/MyPage.vue'
import ProductCatalog from './views/ProductCatalog.vue'
import ProductDetail from './views/ProductDetail.vue'
import ProductCompare from './views/ProductCompare.vue'
import CartPage from './views/CartPage.vue'
import CheckoutPage from './views/CheckoutPage.vue'
import OrderList from './views/OrderList.vue'
import OrderDetail from './views/OrderDetail.vue'
import PaymentComplete from './views/PaymentComplete.vue'
import QuestionList from './views/QuestionList.vue'
import QuestionDetail from './views/QuestionDetail.vue'
import QuestionEditor from './views/QuestionEditor.vue'
import CommunityHome from './views/CommunityHome.vue'
import CommunityPostList from './views/CommunityPostList.vue'
import CommunityPostDetail from './views/CommunityPostDetail.vue'
import CommunityPostEditor from './views/CommunityPostEditor.vue'
import AdminReturns from './views/AdminReturns.vue'
import AdminRecommendations from './views/AdminRecommendations.vue'
import { isAdminRecommendationsRoute, isAdminReturnsRoute, isCartRoute, isCheckoutRoute, isCompareRoute, isLoginRoute, isMyRoute, isPaymentCompleteRoute, resolveCommunityRoute, resolveOrderRoute, resolveProductRoute, resolveQuestionRoute, resolveRouteName } from './router/index.js'
import { track } from './stores/tracking.js'

const pathname = window.location.pathname
// 화면을 열 때 한 번. 화면들의 이벤트보다 먼저 큐에 들어가게 setup 에서 부른다
track('page_view', { route: resolveRouteName(pathname) })
const isPaymentComplete = isPaymentCompleteRoute(pathname)
const questionRoute = resolveQuestionRoute(pathname)
const communityRoute = resolveCommunityRoute(pathname)
const isLogin = isLoginRoute(pathname)
const isMy = isMyRoute(pathname)
const isCart = isCartRoute(pathname)
const isCheckout = isCheckoutRoute(pathname)
const isCompare = isCompareRoute(pathname)
const isAdminReturns = isAdminReturnsRoute(pathname)
const isAdminRecommendations = isAdminRecommendationsRoute(pathname)
const orderRoute = resolveOrderRoute(pathname)
const productRoute = resolveProductRoute(pathname)
</script>

<template>
  <PaymentComplete v-if="isPaymentComplete" />
  <QuestionList v-else-if="questionRoute?.name === 'questions'" />
  <QuestionEditor v-else-if="questionRoute?.name === 'question-new'" />
  <QuestionEditor v-else-if="questionRoute?.name === 'question-edit'" :question-id="questionRoute.id" editing />
  <QuestionDetail v-else-if="questionRoute?.name === 'question-detail'" :question-id="questionRoute.id" />
  <CommunityHome v-else-if="communityRoute?.name === 'community'" />
  <CommunityPostEditor v-else-if="communityRoute?.name === 'community-new'" :board="communityRoute.board" />
  <CommunityPostEditor v-else-if="communityRoute?.name === 'community-edit'" :post-id="communityRoute.id" editing />
  <CommunityPostDetail v-else-if="communityRoute?.name === 'community-detail'" :post-id="communityRoute.id" />
  <CommunityPostList v-else-if="communityRoute?.name === 'community-list'" :board="communityRoute.board" />
  <LoginPage v-else-if="isLogin" />
  <MyPage v-else-if="isMy" />
  <CartPage v-else-if="isCart" />
  <CheckoutPage v-else-if="isCheckout" />
  <ProductCompare v-else-if="isCompare" />
  <AdminReturns v-else-if="isAdminReturns" />
  <AdminRecommendations v-else-if="isAdminRecommendations" />
  <OrderDetail v-else-if="orderRoute?.name === 'order-detail'" :payment-id="orderRoute.paymentId" />
  <OrderList v-else-if="orderRoute?.name === 'orders'" />
  <ProductDetail v-else-if="productRoute.name === 'product-detail'" :product-id="productRoute.id" />
  <ProductCatalog v-else />
</template>
