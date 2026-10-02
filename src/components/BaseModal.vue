<script setup>
import { watch, onBeforeUnmount } from 'vue'

// 通用弹窗：遮罩 + ESC 关闭 + 点击遮罩关闭
// 通过 v-model 控制开关；footer 插槽放按钮
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  maxWidth: { type: String, default: 'max-w-3xl' },
})
const emit = defineEmits(['update:modelValue'])

function close() {
  emit('update:modelValue', false)
}

// ESC 关闭弹窗
function onKeydown(e) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  }
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- 遮罩层 -->
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="close"></div>

    <!-- 弹窗主体 -->
    <div
      :class="[
        'relative w-full bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden',
        maxWidth,
      ]"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button
          @click="close"
          class="text-2xl leading-none text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          title="关闭 (ESC)"
        >
          ×
        </button>
      </div>

      <!-- 内容（可滚动）-->
      <div class="overflow-y-auto px-6 py-4 flex-1">
        <slot />
      </div>

      <!-- 底部按钮 -->
      <div
        v-if="$slots.footer"
        class="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 flex justify-end gap-3 shrink-0"
      >
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
