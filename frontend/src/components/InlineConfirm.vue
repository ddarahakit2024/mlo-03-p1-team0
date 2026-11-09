<script setup>
import { onMounted, ref } from 'vue'

// 브라우저 confirm 대신 쓰는 화면 안 확인 상자("삭제할까요? 예/아니요"). 진행 중(busy)에는 두 버튼을 막는다.
const props = defineProps({
  message: { type: String, default: '삭제할까요?' },
  busy: { type: Boolean, default: false },
  confirmLabel: { type: String, default: '예' },
  cancelLabel: { type: String, default: '아니요' },
  busyLabel: { type: String, default: '삭제 중...' },
})
const emit = defineEmits(['confirm', 'cancel'])
const cancelButton = ref(null)

function cancel() {
  if (!props.busy) emit('cancel')
}

// 열리면 "아니요"에 초점을 둔다: 스크린리더가 질문을 읽고, 실수로 Enter 를 눌러도 지우지 않는다
onMounted(() => cancelButton.value?.focus?.())
</script>

<template>
  <div class="inline-confirm" role="group" :aria-label="message" @keydown.esc="cancel">
    <p class="inline-confirm__message">{{ message }}</p>
    <div class="inline-confirm__actions">
      <button class="inline-confirm__button inline-confirm__button--danger" type="button" :disabled="busy" :aria-busy="busy" @click="emit('confirm')">{{ busy ? busyLabel : confirmLabel }}</button>
      <button ref="cancelButton" class="inline-confirm__button" type="button" :disabled="busy" @click="cancel">{{ cancelLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.inline-confirm { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent); border-radius: var(--radius-sm); background: var(--danger-soft); }
.inline-confirm__message { min-width: 0; margin: 0; color: var(--danger); font-size: var(--text-sm); font-weight: 700; line-height: 1.6; overflow-wrap: anywhere; }
.inline-confirm__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.inline-confirm__button { min-width: 64px; min-height: 40px; padding: 8px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font-size: var(--text-sm); font-weight: 700; cursor: pointer; }
.inline-confirm__button--danger { border-color: var(--danger); background: var(--danger); color: var(--bg); }
.inline-confirm__button:disabled { opacity: .55; cursor: wait; }
.inline-confirm__button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
</style>
