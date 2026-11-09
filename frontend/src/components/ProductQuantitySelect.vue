<script setup>
import { computed } from 'vue'

const props = defineProps({ id: { type: String, required: true }, modelValue: { type: Number, default: 1 }, max: { type: Number, default: 10 }, label: { type: String, default: '수량' }, hideLabel: { type: Boolean, default: false }, disabled: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])
// 고를 수 있는 값은 1~max. 재고가 줄어 지금 수량이 max 보다 커도 지금 수량은 보여 준다.
const options = computed(() => Array.from({ length: Math.max(props.max, props.modelValue, 1) }, (_, index) => index + 1))

function change(event) {
  emit('update:modelValue', Number(event.target.value))
}
</script>

<template>
  <div class="quantity-select">
    <label :for="id" :class="{ 'sr-only': hideLabel }">{{ label }}</label>
    <select :id="id" :value="modelValue" :disabled="disabled" @change="change">
      <option v-for="count in options" :key="count" :value="count" :disabled="count > max">{{ count }}개</option>
    </select>
  </div>
</template>

<style scoped>
.quantity-select { display: flex; align-items: center; gap: 10px; }
.quantity-select label { color: var(--ink); font-size: var(--text-xs); font-weight: 700; }
.quantity-select select { min-width: 92px; min-height: 42px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink); font: inherit; font-size: var(--text-sm); cursor: pointer; }
.quantity-select select:disabled { opacity: .6; cursor: wait; }
.quantity-select select:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
</style>
