<script setup>
import { ref } from 'vue'

// 图片组件：加载失败时回退到占位图（首字母 + 渐变背景）
const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  name: { type: String, default: '' },
})

const failed = ref(false)
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt"
    @error="failed = true"
    class="w-full h-full object-cover"
  />
  <!-- 占位图：图片缺失 / 加载失败时显示 -->
  <div
    v-else
    class="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold select-none"
  >
    {{ name ? name.charAt(0) : '?' }}
  </div>
</template>
