<script setup>
import { computed, ref, watch } from 'vue'
import { SIGNUP_PURPOSES, signupPurpose } from '../stores/authViewModel.js'

// 로그인·회원가입 창. inline 이면 로그인 화면(/login) 가운데의 카드(로고·"MOA Parts 로그인"·안내)로, 아니면 body 위 모달로 그린다.
const props = defineProps({ inline: { type: Boolean, default: false }, modelValue: { type: Boolean, default: false }, initialMode: { type: String, default: 'login' }, loading: { type: Boolean, default: false }, error: { type: String, default: '' }, notice: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'submit', 'social-login', 'switch-mode'])
const mode = ref(props.initialMode)
const name = ref('')
const email = ref('')
const password = ref('')
// 회원가입의 사용 목적(선택). '' = 선택 안 함 → null 로 보낸다. 옵션은 견적 게시판 용도와 같다
const purpose = ref('')
const isSignup = computed(() => mode.value === 'signup')
watch(() => props.initialMode, (value) => { mode.value = value })
watch(() => props.modelValue, (open) => { if (open) mode.value = props.initialMode })
function switchMode(nextMode) { mode.value = nextMode; emit('switch-mode', nextMode) }
function submit() {
  const credentials = { mode: mode.value, name: name.value.trim(), email: email.value.trim(), password: password.value }
  emit('submit', isSignup.value ? { ...credentials, purpose: signupPurpose(purpose.value) } : credentials)
}
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div v-if="modelValue" class="auth-dialog-backdrop" :class="{ 'auth-dialog-backdrop--inline': inline }" @click.self="!inline && emit('update:modelValue', false)" @keydown.esc.prevent="!inline && emit('update:modelValue', false)">
      <section class="auth-dialog" :role="inline ? undefined : 'dialog'" :aria-modal="inline ? undefined : true" :aria-labelledby="inline ? 'auth-inline-title' : 'auth-dialog-title'">
        <header v-if="inline" class="auth-dialog__brand">
          <img src="/images/logo.png" alt="" width="64" height="64" />
          <h1 id="auth-inline-title">{{ isSignup ? 'MOA Parts 회원가입' : 'MOA Parts 로그인' }}</h1>
          <p>{{ isSignup ? '가입하면 가격 알림, 견적 요청, 질문을 이용할 수 있어요.' : '가격 알림, 견적 요청, 질문은 로그인 후 이용할 수 있어요.' }}</p>
        </header>
        <header v-else class="auth-dialog__header"><button class="auth-dialog__close" type="button" aria-label="닫기" @click="emit('update:modelValue', false)">×</button><h2 id="auth-dialog-title">{{ isSignup ? '회원가입' : '로그인' }}</h2></header>
        <form class="auth-dialog__form" @submit.prevent="submit">
          <p v-if="!inline" class="auth-dialog__intro">{{ isSignup ? '계정을 만들고 장바구니와 주문 내역을 관리하세요.' : '장바구니와 주문 내역을 이어서 확인하세요.' }}</p>
          <label v-if="isSignup">이름<input v-model="name" type="text" name="name" autocomplete="name" required placeholder="이름을 입력하세요" /></label>
          <label>이메일 주소<input v-model="email" type="email" name="email" autocomplete="email" required placeholder="name@example.com" /></label>
          <label>비밀번호<input v-model="password" :autocomplete="isSignup ? 'new-password' : 'current-password'" type="password" name="password" required :minlength="isSignup ? 8 : 1" :placeholder="isSignup ? '8자 이상 입력하세요' : '비밀번호를 입력하세요'" /></label>
          <div v-if="isSignup" class="auth-dialog__field">
            <label for="auth-dialog-purpose">사용 목적(선택)</label>
            <select id="auth-dialog-purpose" :value="purpose" name="purpose" aria-describedby="auth-dialog-purpose-help" @change="purpose = $event.target.value">
              <option value="">선택 안 함</option>
              <option v-for="item in SIGNUP_PURPOSES" :key="item.code" :value="item.code">{{ item.name }}</option>
            </select>
            <p id="auth-dialog-purpose-help" class="auth-dialog__help">PC를 주로 어디에 쓰는지 골라 주세요. 고르지 않아도 가입할 수 있습니다.</p>
          </div>
          <p v-if="error" class="auth-dialog__error" role="alert">{{ error }}</p>
          <p v-if="notice" class="auth-dialog__notice" role="status">{{ notice }}</p>
          <button class="auth-dialog__continue" type="submit" :disabled="loading">{{ loading ? '확인 중…' : isSignup ? '계정 만들기' : '로그인' }}</button>
          <p v-if="isSignup" class="auth-dialog__terms">계정을 만들면 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</p>
        </form>
        <div class="auth-dialog__divider"><span>또는</span></div>
        <div class="auth-dialog__social"><button type="button" @click="emit('social-login', 'kakao')"><span aria-hidden="true">K</span> 카카오로 계속하기</button></div>
        <p class="auth-dialog__switch">{{ isSignup ? '이미 계정이 있나요?' : '처음 오셨나요?' }} <button type="button" @click="switchMode(isSignup ? 'login' : 'signup')">{{ isSignup ? '로그인' : '회원가입' }}</button></p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.auth-dialog-backdrop { --auth-brand: var(--brand); position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; overflow-y: auto; padding: 24px 14px; background: var(--overlay); }
/* 페이지 안 카드(디자인의 로그인 화면): 가운데, 위아래 여백, 살짝 떠오르며 나타난다 */
.auth-dialog-backdrop--inline { position: static; padding: 40px 0 72px; overflow: visible; background: transparent; animation: moa-fade .25s ease; }
.auth-dialog { display: grid; gap: 14px; width: min(100%, 400px); padding: 32px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.auth-dialog-backdrop:not(.auth-dialog-backdrop--inline) .auth-dialog { box-shadow: var(--shadow); }
.auth-dialog__brand { display: grid; justify-items: center; gap: 6px; text-align: center; }
.auth-dialog__brand img { width: 64px; height: 64px; margin-bottom: 8px; object-fit: contain; }
.auth-dialog__brand h1 { margin: 0; color: var(--ink); font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.3; }
.auth-dialog__brand p { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.5; word-break: keep-all; }
.auth-dialog__header { position: relative; display: flex; align-items: center; justify-content: center; min-height: 40px; }
.auth-dialog__header h2 { margin: 0; color: var(--ink); font-size: var(--text-body); }
.auth-dialog__close { position: absolute; left: -8px; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: var(--ink); font-size: 25px; cursor: pointer; }
.auth-dialog__form { display: grid; gap: 14px; }
.auth-dialog__intro { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.7; }
.auth-dialog__form label { display: grid; gap: 7px; color: var(--ink); font-size: var(--text-xs); font-weight: 700; }
.auth-dialog__form input, .auth-dialog__form select { width: 100%; min-width: 0; height: 46px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--bg); color: var(--ink); font: inherit; font-size: var(--text-body); }
.auth-dialog__form input:focus, .auth-dialog__form select:focus { border-color: var(--auth-brand); outline: 3px solid var(--brand-soft); }
.auth-dialog__field { display: grid; gap: 7px; }
.auth-dialog__field select { cursor: pointer; }
.auth-dialog__help { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
.auth-dialog__continue { height: 48px; border: 0; border-radius: var(--radius-sm); background: var(--auth-brand); color: var(--brand-ink); font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
.auth-dialog__continue:hover:not(:disabled) { background: var(--brand-strong); }
.auth-dialog__continue:disabled { opacity: .6; cursor: wait; }
.auth-dialog__error { margin: 0; color: var(--danger); font-size: var(--text-sm); line-height: 1.5; }
.auth-dialog__notice { margin: 0; color: var(--success); font-size: var(--text-sm); line-height: 1.5; }
.auth-dialog__terms { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
.auth-dialog__divider { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: var(--text-xs); }
.auth-dialog__divider::before, .auth-dialog__divider::after { height: 1px; flex: 1; background: var(--line); content: ''; }
.auth-dialog__social { display: grid; }
.auth-dialog__social button { position: relative; height: 44px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: transparent; color: var(--ink); font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer; }
.auth-dialog__social button:hover { border-color: var(--brand); color: var(--brand-strong); }
.auth-dialog__social button span { position: absolute; left: 15px; color: var(--auth-brand); font-size: 15px; font-weight: 800; }
.auth-dialog__switch { margin: 2px 0 0; color: var(--muted); font-size: var(--text-xs); text-align: center; }
.auth-dialog__switch button { min-height: 24px; padding: 0; border: 0; background: none; color: var(--brand-strong); font: inherit; font-weight: 750; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.auth-dialog button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
@media (max-width: 480px) {
  .auth-dialog-backdrop--inline { padding: 24px 0 48px; }
  .auth-dialog { padding: 24px 20px; border-radius: var(--radius-md); }
}
</style>
