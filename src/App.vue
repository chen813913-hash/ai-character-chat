<script setup>
import { ref, onMounted } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import TopBar from './components/TopBar.vue'
import { useTheme } from './composables/useTheme'
import { store, initStore } from './store/useDataStore.js'

const { init } = useTheme()

// 手机/窄屏：侧边导航抽屉开关（md 以下隐藏侧栏，汉堡按钮开合）
const sidebarOpen = ref(false)

// 启动：先初始化主题，再从 IndexedDB 载入本地数据
// 加了超时兜底：即使数据库异常/卡住，也保证界面能显示（用同步预置的种子数据）
onMounted(async () => {
  init()
  const guard = setTimeout(() => {
    if (!store.ready) {
      console.warn('[store] 数据载入超时，已使用内置种子数据继续渲染')
      store.ready = true
    }
  }, 2500)
  try {
    await initStore()
  } catch (e) {
    console.error('[store] 初始化失败', e)
  } finally {
    clearTimeout(guard)
    store.ready = true
  }
})
</script>

<template>
  <!-- 整体布局：左侧栏 + 右侧（顶栏 + 内容滚动区）-->
  <div class="h-screen flex overflow-hidden bg-neutral-100 dark:bg-[#0e0e13] text-neutral-800 dark:text-neutral-100 transition-colors">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />

    <div class="flex-1 flex flex-col min-w-0">
      <!-- 存储降级警示：IndexedDB 不可用（如被其他标签页阻塞/浏览器禁用），数据仅存内存 -->
      <div
        v-if="store.ready && store.storageFallback"
        class="px-4 py-2 bg-amber-500/90 text-black text-xs font-medium flex items-center justify-center gap-2"
      >
        <span>⚠️ 本地存储不可用，当前数据只保存在内存里，刷新/关闭页面后会丢失！请关闭其他本站标签页后刷新重试。</span>
      </div>
      <TopBar @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="flex-1 overflow-y-auto">
        <!-- 数据载入中：避免各页读到空数组闪烁 -->
        <div v-if="!store.ready" class="text-center text-neutral-400 py-20">
          正在载入本地数据…
        </div>
        <router-view v-else />
      </main>
    </div>
  </div>
</template>
