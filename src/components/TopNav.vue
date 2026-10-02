<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from '../composables/useTheme'

const route = useRoute()
const router = useRouter()
const { isDark, toggle } = useTheme()

// 三个切换按钮：画廊 | 马甲管理 | 设置
const navs = [
  { name: 'home', label: '画廊', path: '/' },
  { name: 'persona', label: '马甲管理', path: '/persona' },
  { name: 'settings', label: '设置', path: '/settings' },
]
</script>

<template>
  <header class="sticky top-0 z-40 bg-white/80 dark:bg-neutral-900/80 backdrop-blur border-b border-neutral-200 dark:border-neutral-800">
    <div class="max-w-7xl mx-auto flex items-center justify-between h-14 px-4">
      <!-- 左侧 Logo / 标题 -->
      <div class="flex items-center gap-2 font-bold text-lg">
        <span class="text-indigo-500">◆</span>
        <span>本地角色工作台</span>
      </div>

      <!-- 中间导航按钮 -->
      <nav class="flex items-center gap-1">
        <button
          v-for="n in navs"
          :key="n.name"
          @click="router.push(n.path)"
          :class="[
            'px-4 py-1.5 rounded-lg text-sm font-medium transition',
            route.name === n.name
              ? 'bg-indigo-500 text-white shadow'
              : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800',
          ]"
        >
          {{ n.label }}
        </button>
      </nav>

      <!-- 右侧主题切换 -->
      <button
        @click="toggle"
        class="px-3 py-1.5 rounded-lg text-sm border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
        :title="isDark ? '切换到亮色' : '切换到暗色'"
      >
        {{ isDark ? '🌙 暗色' : '☀️ 亮色' }}
      </button>
    </div>
  </header>
</template>
