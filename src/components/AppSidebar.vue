<script setup>
import { useRoute, useRouter } from 'vue-router'
import { watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false }, // 手机/窄屏抽屉开关
})
const emit = defineEmits(['close'])

const route = useRoute()
const router = useRouter()

// 手机上点菜单跳转后自动收起抽屉
watch(
  () => route.fullPath,
  () => emit('close')
)

// 侧边栏菜单
const menus = [
  { label: '角色', path: '/', icon: '👤' },
  { label: '聊天', path: '/chat', icon: '💬' },
  { label: '马甲管理', path: '/persona', icon: '🎭' },
  { label: '个人中心', path: '/me', icon: '👤' },
  { label: 'API 密钥', path: '/api-keys', icon: '🔑' },
  { label: '绘画接口', path: '/image-apis', icon: '🎨' },
  { label: '数据抓取', path: '/grab', icon: '🧲' },
  { label: '联动导入', path: '/link-import', icon: '🔗' },
  { label: '设置', path: '/settings', icon: '⚙️' },
]

// 创建 / 导入角色：跳到画廊并通过路由参数触发对应弹窗
function goCreate() {
  router.push({ path: '/', query: { create: '1' } })
}
function goImport() {
  router.push({ path: '/', query: { import: '1' } })
}
</script>

<template>
  <!-- 手机/窄屏遮罩 -->
  <div
    v-if="open"
    class="fixed inset-0 z-30 bg-black/50 md:hidden"
    @click="emit('close')"
  ></div>

  <aside
    :class="[
      'w-52 shrink-0 h-full flex flex-col bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800/80',
      // 窄屏：固定抽屉，默认收起；md 以上：正常占据布局
      'fixed z-40 inset-y-0 left-0 transition-transform duration-200',
      open ? 'translate-x-0' : '-translate-x-full',
      'md:static md:translate-x-0 md:z-auto',
    ]"
  >
    <!-- Logo + 关闭按钮（窄屏） -->
    <div class="p-4 flex items-center gap-2">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-pink-500/20">
        ◆
      </div>
      <div class="leading-tight min-w-0 flex-1">
        <div class="font-bold text-sm truncate">本地角色工作台</div>
        <div class="text-[10px] text-neutral-400">local-first</div>
      </div>
      <button
        class="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        title="收起菜单"
        @click="emit('close')"
      >✕</button>
    </div>

    <!-- 主操作按钮（渐变）-->
    <div class="px-3 space-y-2">
      <button
        @click="goCreate"
        class="w-full py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-90 transition shadow-lg shadow-pink-500/20"
      >
        ✨ 创建角色
      </button>
      <button
        @click="goImport"
        class="w-full py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-indigo-500 hover:opacity-90 transition shadow-lg shadow-purple-500/20"
      >
        📥 导入角色
      </button>
    </div>

    <!-- 菜单 -->
    <nav class="mt-5 px-3 space-y-1 flex-1 overflow-y-auto">
      <p class="px-2 pb-1 text-[10px] text-neutral-400">菜单</p>
      <router-link
        v-for="m in menus"
        :key="m.path"
        :to="m.path"
        :class="[
          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition',
          route.path === m.path
            ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-500 dark:text-pink-400 font-medium'
            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/80',
        ]"
      >
        <span class="w-4 text-center">{{ m.icon }}</span>{{ m.label }}
      </router-link>
    </nav>

    <div class="p-4 text-[10px] text-neutral-500">本地版 v1.0.0 · 数据仅存本机</div>
  </aside>
</template>
