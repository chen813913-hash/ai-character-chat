<script setup>
import { useTheme } from '../composables/useTheme'
import { globalSearch } from '../composables/useSearch'

const { isDark, toggle } = useTheme()
const emit = defineEmits(['toggle-sidebar'])
</script>

<template>
  <header class="h-14 shrink-0 flex items-center gap-3 sm:gap-4 px-3 sm:px-6 bg-white/90 dark:bg-neutral-950/90 backdrop-blur border-b border-neutral-200 dark:border-neutral-800/80">
    <!-- 汉堡按钮：窄屏展开侧边导航 -->
    <button
      class="md:hidden w-9 h-9 shrink-0 rounded-lg flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-xl leading-none"
      title="菜单"
      @click="emit('toggle-sidebar')"
    >
      ☰
    </button>

    <!-- 全局搜索 -->
    <input
      v-model="globalSearch"
      type="text"
      placeholder="搜索角色…"
      class="w-full max-w-sm px-4 py-1.5 rounded-full text-sm bg-neutral-100 dark:bg-neutral-800/80 border border-transparent focus:border-indigo-400 focus:outline-none min-w-0"
    />

    <div class="ml-auto flex items-center gap-2">
      <button
        @click="toggle"
        class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        :title="isDark ? '切换到亮色' : '切换到暗色'"
      >
        {{ isDark ? '🌙' : '☀️' }}
      </button>
    </div>
  </header>
</template>
