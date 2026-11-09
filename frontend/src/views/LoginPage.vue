<script setup>
import { onMounted, ref } from 'vue'
import { loginWithEmail, loginWithKakao, signupWithEmail } from '../api/authApi.js'
import { AuthDialog, SiteLayout } from '../components/index.js'
import { authSession } from '../stores/authSession.js'
import { siteStatus } from '../stores/siteStatus.js'
import { authError, authModeFromSearch, beginKakaoLogin, completeKakaoCallback, createOAuthState, goToMain, isKakaoCallback, kakaoLoginError, kakaoRedirectUri, signupPurpose, validateCredentials } from '../stores/authViewModel.js'
import { track } from '../stores/tracking.js'

// /login?mode=signup 이면 회원가입 창으로 연다(카카오 콜백 주소는 로그인 창)
const mode = ref(isKakaoCallback(window.location.pathname) ? 'login' : authModeFromSearch(window.location.search))
const loading = ref(false)
const error = ref('')
const notice = ref('')
// 카카오가 인가 코드를 붙여 돌려보낸 주소면, 확인이 끝날 때까지 로그인 창 대신 진행 상태를 보여 준다
const kakaoPending = ref(isKakaoCallback(window.location.pathname))

async function finishKakaoCallback() {
  if (!kakaoPending.value) return
  let result
  try {
    result = await completeKakaoCallback({
      search: window.location.search,
      storage: window.sessionStorage,
      history: window.history,
      exchangeCode: (code) => loginWithKakao(code),
    })
  } catch {
    result = { ok: false }
  }
  if (result.ok) {
    signedIn('kakao')
    return
  }
  error.value = kakaoLoginError(result.error)
  kakaoPending.value = false
}

onMounted(finishKakaoCallback)

// 로그인에 성공하면 이벤트를 남기고 로그인 상태와 헤더 숫자(장바구니·읽지 않은 알림)를 다시 부른 뒤(헤더가 바로 바뀐다) 첫 화면으로 간다.
// 이동하는 동안 진행 상태를 유지하고, 남은 이벤트는 페이지를 떠날 때 keepalive 로 보내진다
function signedIn(method) {
  track('login', { method })
  authSession.refresh()
  siteStatus.refresh()
  goToMain()
}

async function submit(credentials) {
  if (loading.value) return
  const signup = credentials.mode === 'signup'
  mode.value = credentials.mode
  error.value = ''
  notice.value = ''
  const invalid = validateCredentials(credentials)
  if (invalid) {
    error.value = invalid
    return
  }
  loading.value = true
  try {
    if (signup) {
      await signupWithEmail(credentials)
      // 사용 목적은 서버로 보낸 값 그대로(고르지 않았으면 null). 이름·이메일은 넣지 않는다
      track('signup', { purpose: signupPurpose(credentials.purpose) })
      mode.value = 'login'
      notice.value = '가입이 완료되었습니다. 로그인해 주세요.'
    } else {
      await loginWithEmail(credentials)
      signedIn('email')
    }
  } catch (failure) {
    error.value = authError(failure, signup
      ? '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    loading.value = false
  }
}

function switchMode(nextMode) {
  mode.value = nextMode
  error.value = ''
  notice.value = ''
}

function startKakaoLogin() {
  error.value = ''
  notice.value = ''
  try {
    beginKakaoLogin({
      sdk: window.Kakao,
      key: import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY,
      redirectUri: kakaoRedirectUri(window.location.origin),
      storage: window.sessionStorage,
      state: createOAuthState(window.crypto),
    })
  } catch {
    error.value = kakaoLoginError('not_configured')
  }
}
</script>

<template>
  <SiteLayout active-page="auth">
    <p v-if="kakaoPending" class="login-callback" role="status">카카오 로그인을 확인하는 중입니다...</p>
    <AuthDialog inline :model-value="!kakaoPending" :initial-mode="mode" :loading="loading" :error="error" :notice="notice" @submit="submit" @social-login="startKakaoLogin" @switch-mode="switchMode" @update:model-value="goToMain()" />
  </SiteLayout>
</template>

<style scoped>
.login-callback { width: min(400px, 100%); margin: 64px auto; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); color: var(--muted); font-size: var(--text-body); text-align: center; animation: moa-fade .25s ease; }
</style>
