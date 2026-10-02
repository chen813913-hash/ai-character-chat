<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  store,
  setUserAvatar, exportAllData, importAllData, loadMessages, clearMessages, removeSession } from '../store/useDataStore.js'
import { idb } from '../store/db.js'
import { downloadJson, pickJsonFile, pickImageAsDataURL } from '../utils/io.js'
import SmartImage from '../components/SmartImage.vue'
import ImageGenModal from '../components/ImageGenModal.vue'
import { useTheme } from '../composables/useTheme'

const router = useRouter()
const { isDark, toggle } = useTheme()

const notice = ref('')
const estimating = ref(false)
const storageEstimate = ref(null) // {usage, quota, percent}

function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 3500)
}

// ---- 基础统计 ----
const stats = computed(() => ({
  characters: store.characters.length,
  personas: store.personas.length,
  sessions: store.sessions.length,
  // 消息数本地不直接统计（按需加载），给个估算
}))

// 总对话轮数 = 各会话消息数之和（懒加载，避免一次性 loadAll）
const totalMessages = ref(0)
async function loadMessageStats() {
  let n = 0
  for (const s of store.sessions) {
    try {
      const list = await loadMessages(s.id)
      n += list.length
    } catch (e) {}
  }
  totalMessages.value = n
}

// ---- 收藏 / 黑名单（黑名单未实现，跳过）----
const favorites = computed(() => store.characters.filter((c) => c.favorite).length)

// 估算存储占用（navigator.storage.estimate）
async function loadStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return
  estimating.value = true
  try {
    const e = await navigator.storage.estimate()
    const usage = e.usage || 0
    const quota = e.quota || 0
    storageEstimate.value = {
      usage,
      quota,
      percent: quota ? Math.min(100, (usage / quota) * 100) : 0,
    }
  } catch (e) {} finally {
    estimating.value = false
  }
}
onMounted(async () => {
  loadMessageStats()
  loadStorage()
})

function formatBytes(b) {
  if (!b) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024
    i++
  }
  return b.toFixed(b >= 100 || i === 0 ? 0 : 1) + ' ' + units[i]
}

// ---- 备份 / 恢复 / 导出 ----
async function onBackup() {
  try {
    const data = await exportAllData()
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadJson(`工作台备份-${ts}.json`, data)
    flash(`已导出备份：${data.characters.length} 人物卡 / ${data.personas.length} 马甲 / ${data.sessions.length} 会话 / ${totalMessages.value} 消息`)
  } catch (e) {
    flash('备份失败：' + (e && e.message ? e.message : e))
  }
}

async function onRestore() {
  if (!confirm('恢复备份会覆盖当前的同名数据，确定继续吗？')) return
  try {
    const text = await pickJsonFile()
    const res = await importAllData(JSON.parse(text))
    flash(`恢复完成：${res.characters} 人物卡 / ${res.personas} 马甲 / ${res.sessions} 会话 / ${res.messages} 消息`)
    loadMessageStats()
  } catch (e) {
    flash('恢复失败：' + (e && e.message ? e.message : e))
  }
}

function onBatchExport() {
  downloadJson('人物卡导出.json', store.characters)
  flash(`已导出 ${store.characters.length} 张人物卡`)
}

async function onClearCache() {
  if (!confirm('确定清除本地缓存？\n这会清空所有聊天消息与会话（角色与马甲保留）。')) return
  // 删除每个会话的消息与会话本身
  for (const s of [...store.sessions]) {
    await clearMessages(s.id)
    await removeSession(s.id)
  }
  totalMessages.value = 0
  flash('已清空本地缓存')
  loadStorage()
}

async function onClearAll() {
  if (!confirm('⚠️ 警告：这将清空所有角色 / 马甲 / 会话 / 消息与设置！\n建议先「备份所有数据」。')) return
  if (!confirm('再次确认：所有数据将被永久删除，无法恢复。继续吗？')) return
  await idb.clear('characters')
  await idb.clear('personas')
  await idb.clear('sessions')
  await idb.clear('messages')
  await idb.clear('settings')
  await idb.clear('jailbreaks')
  await idb.clear('lorebooks')
  // 重置内存 store 到 mock
  const { mockCharacters, mockPersonas, mockSessions } = await import('../data/mock.js')
  store.characters = JSON.parse(JSON.stringify(mockCharacters))
  store.personas = JSON.parse(JSON.stringify(mockPersonas))
  store.sessions = JSON.parse(JSON.stringify(mockSessions))
  store.jailbreaks = []
  store.lorebooks = []
  totalMessages.value = 0
  flash('已重置全部数据')
  loadStorage()
}

function gotoSettings() {
  router.push('/settings')
}
function gotoGallery() {
  router.push('/')
}
function gotoChat() {
  router.push('/chat')
}
function gotoPersona() {
  router.push('/persona')
}
function gotoJailbreak() {
  router.push('/jailbreak')
}
function gotoLorebook() {
  router.push('/lorebook')
}
// 用户头像与生成弹窗
const userAvatar = computed(() => store.settings.userAvatar || '')
const showAvatarGen = ref(false)
const avatarGenPreset = computed(() => ({
  title: '生成用户头像',
  prompt: 'masterpiece, best quality, portrait, upper body, soft lighting, cute avatar',
  width: 512,
  height: 512,
}))
async function onUseAvatarGen(res) {
  userAvatar.value = ''
  await setUserAvatar(res.dataUrl)
  flash('头像已更新')
}

function gotoImageApis() {
  router.push('/image-apis')
}

// 手机/局域网访问说明弹窗
const showLan = ref(false)
const pageUrl = typeof location !== 'undefined' ? location.origin : ''
async function copyPageUrl() {
  try {
    await navigator.clipboard.writeText(pageUrl)
    flash('地址已复制，发给同一 WiFi 下的朋友即可打开')
  } catch (e) {
    flash('复制失败，请手动复制地址栏')
  }
}

// 用户头像：本地选择（base64）
async function onPickUserAvatar() {
  const url = await pickImageAsDataURL()
  if (!url) return
  userAvatar.value = url
  await setUserAvatar(url)
  flash('头像已更新')
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-5">
    <!-- 提示条 -->
    <div
      v-if="notice"
      class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow"
    >
      {{ notice }}
    </div>

    <!-- 顶部个人卡：头像 + 名称 + 数据小条 -->
    <section class="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 flex items-center gap-4">
      <div class="relative shrink-0">
        <div v-if="userAvatar" class="w-16 h-16 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-700">
          <SmartImage :src="userAvatar" name="我的头像" class="w-full h-full" />
        </div>
        <div v-else class="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-2xl shadow-lg shadow-pink-500/30">
          ◆
        </div>
        <div class="absolute -bottom-1.5 -right-1.5 flex gap-1">
          <button
            @click="onPickUserAvatar"
            class="w-6 h-6 rounded-full bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 shadow flex items-center justify-center text-[10px] hover:text-indigo-500 transition"
            title="上传头像"
          >📁</button>
          <button
            @click="showAvatarGen = true"
            class="w-6 h-6 rounded-full bg-pink-500 text-white shadow flex items-center justify-center text-[10px] hover:bg-pink-400 transition"
            title="AI 生成头像"
          >✨</button>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-lg font-bold flex items-center gap-2">
          本地创作者
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-500 font-medium">本地版</span>
        </div>
        <div class="text-xs text-neutral-500 mt-1">所有数据都保存在你的浏览器里，不上传任何服务器</div>
        <div class="mt-2 flex items-center gap-3 text-[11px] text-neutral-500">
          <span>👤 {{ stats.characters }} 角色</span>
          <span>·</span>
          <span>💬 {{ stats.sessions }} 会话</span>
          <span>·</span>
          <span>💬 {{ totalMessages }} 条消息</span>
        </div>
      </div>
      <button
        @click="gotoSettings"
        class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
      >
        ⚙ 设置
      </button>
    </section>

    <!-- 统计卡 4 列 -->
    <section class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="bg-gradient-to-br from-pink-500/15 to-purple-500/15 border border-pink-500/20 rounded-2xl p-4">
        <div class="text-2xl font-bold">{{ stats.characters }}</div>
        <div class="text-xs text-neutral-500 mt-1">我创建的角色</div>
      </div>
      <div class="bg-gradient-to-br from-indigo-500/15 to-cyan-500/15 border border-indigo-500/20 rounded-2xl p-4">
        <div class="text-2xl font-bold">{{ stats.personas }}</div>
        <div class="text-xs text-neutral-500 mt-1">我的马甲</div>
      </div>
      <div class="bg-gradient-to-br from-amber-500/15 to-orange-500/15 border border-amber-500/20 rounded-2xl p-4">
        <div class="text-2xl font-bold">{{ stats.sessions }}</div>
        <div class="text-xs text-neutral-500 mt-1">历史会话</div>
      </div>
      <div class="bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 rounded-2xl p-4">
        <div class="text-2xl font-bold">{{ totalMessages }}</div>
        <div class="text-xs text-neutral-500 mt-1">消息总数</div>
      </div>
    </section>

    <!-- 快捷入口 7 格 -->
    <section class="grid grid-cols-4 md:grid-cols-8 gap-2">
      <button
        @click="gotoGallery"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">👤</span><span class="text-xs">角色</span>
      </button>
      <button
        @click="gotoChat"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">💬</span><span class="text-xs">聊天</span>
      </button>
      <button
        @click="gotoPersona"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">🎭</span><span class="text-xs">马甲</span>
      </button>
      <button
        @click="gotoJailbreak"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">🛡️</span><span class="text-xs">破甲</span>
      </button>
      <button
        @click="gotoLorebook"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">📖</span><span class="text-xs">世界书</span>
      </button>
      <button
        @click="onBackup"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">💾</span><span class="text-xs">备份</span>
      </button>
      <button
        @click="toggle"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">{{ isDark ? '☀️' : '🌙' }}</span><span class="text-xs">{{ isDark ? '浅色' : '深色' }}</span>
      </button>
      <button
        @click="gotoSettings"
        class="flex flex-col items-center gap-1 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
      >
        <span class="text-xl">⚙️</span><span class="text-xs">设置</span>
      </button>
    </section>

    <!-- 数据管理分组 -->
    <section class="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div class="px-4 py-2.5 text-xs font-semibold text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
        连接与共享
      </div>
      <button
        @click="showLan = true"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-sky-500/15 text-sky-500 flex items-center justify-center">📱</span>
          <div>
            <div class="text-sm font-medium">手机 / 局域网访问</div>
            <div class="text-xs text-neutral-500">同一 WiFi 下用手机浏览器打开本应用（含发给别人说明）</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>
      <button
        @click="gotoImageApis"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-pink-500/15 text-pink-500 flex items-center justify-center">🎨</span>
          <div>
            <div class="text-sm font-medium">绘画接口</div>
            <div class="text-xs text-neutral-500">本地 SD WebUI / 网络 OpenAI 兼容，用于 AI 生成图片</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>
      <button
        @click="onBackup"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center">💾</span>
          <div>
            <div class="text-sm font-medium">备份所有数据</div>
            <div class="text-[11px] text-neutral-500">导出整库 JSON：角色 + 马甲 + 会话 + 消息 + 设置</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>

      <button
        @click="onRestore"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-500 flex items-center justify-center">⬇</span>
          <div>
            <div class="text-sm font-medium">从备份恢复</div>
            <div class="text-[11px] text-neutral-500">导入之前导出的 JSON 备份文件</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>

      <button
        @click="onBatchExport"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center">📦</span>
          <div>
            <div class="text-sm font-medium">导出全部角色卡</div>
            <div class="text-[11px] text-neutral-500">仅导出角色（不含会话消息），便于分发</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>

      <button
        @click="onClearCache"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center">🧹</span>
          <div>
            <div class="text-sm font-medium">清除本地缓存</div>
            <div class="text-[11px] text-neutral-500">清空所有会话与消息（保留角色与马甲）</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>
    </section>

    <!-- 应用设置分组（与设置页互不重复，但可作快速入口）-->
    <section class="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div class="px-4 py-2.5 text-xs font-semibold text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
        应用设置
      </div>
      <button
        @click="gotoSettings"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-pink-500/15 text-pink-500 flex items-center justify-center">🔑</span>
          <div>
            <div class="text-sm font-medium">LLM 接口配置</div>
            <div class="text-[11px] text-neutral-500">API 地址、密钥、模型、温度、最大 token</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>

      <div class="w-full flex items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-500 flex items-center justify-center">🎨</span>
          <div>
            <div class="text-sm font-medium">外观主题</div>
            <div class="text-[11px] text-neutral-500">浅色 / 深色 / 跟随系统</div>
          </div>
        </div>
        <button
          @click="toggle"
          class="w-10 h-5 rounded-full transition relative"
          :class="isDark ? 'bg-indigo-500' : 'bg-neutral-300'"
        >
          <span
            class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow"
            :class="isDark ? 'left-5' : 'left-0.5'"
          ></span>
        </button>
      </div>

      <button
        @click="gotoSettings"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-left"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-500 flex items-center justify-center">⚙️</span>
          <div>
            <div class="text-sm font-medium">更多设置</div>
            <div class="text-[11px] text-neutral-500">测试连接、数据迁移等高级选项</div>
          </div>
        </div>
        <span class="text-neutral-400">›</span>
      </button>
    </section>

    <!-- 存储信息 -->
    <section
      v-if="storageEstimate"
      class="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 px-4 py-3"
    >
      <div class="flex items-center justify-between text-xs text-neutral-500 mb-2">
        <span>本地存储占用</span>
        <span class="font-mono">
          {{ formatBytes(storageEstimate.usage) }}
          <span v-if="storageEstimate.quota">/ {{ formatBytes(storageEstimate.quota) }}</span>
        </span>
      </div>
      <div class="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
          :style="{ width: storageEstimate.percent.toFixed(2) + '%' }"
        ></div>
      </div>
      <div class="text-[11px] text-neutral-500 mt-1">
        占配额 {{ storageEstimate.percent.toFixed(2) }}%
        <span v-if="estimating" class="ml-2 text-neutral-400">检测中…</span>
      </div>
    </section>

    <!-- 更多分组 -->
    <section class="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div class="px-4 py-2.5 text-xs font-semibold text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
        更多
      </div>
      <a
        href="https://github.com/"
        target="_blank"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition border-b border-neutral-100 dark:border-neutral-800"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-neutral-500/15 text-neutral-500 flex items-center justify-center">⭐</span>
          <div>
            <div class="text-sm font-medium">GitHub 项目主页</div>
            <div class="text-[11px] text-neutral-500">查看源码、提交反馈、Star 支持</div>
          </div>
        </div>
        <span class="text-neutral-400">↗</span>
      </a>
      <div class="w-full flex items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-neutral-500/15 text-neutral-500 flex items-center justify-center">ℹ️</span>
          <div>
            <div class="text-sm font-medium">关于</div>
            <div class="text-[11px] text-neutral-500">本地版 v1.0.0 · 100% 本地 · 数据仅存本机</div>
          </div>
        </div>
      </div>
      <button
        @click="onClearAll"
        class="w-full flex items-center justify-between px-4 py-3.5 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-left"
      >
        <div class="flex items-center gap-3">
          <span class="w-9 h-9 rounded-lg bg-red-500/15 text-red-500 flex items-center justify-center">⚠️</span>
          <div>
            <div class="text-sm font-medium text-red-500">重置全部数据</div>
            <div class="text-[11px] text-neutral-500">清空所有角色 / 马甲 / 会话 / 消息与设置（不可恢复）</div>
          </div>
        </div>
        <span class="text-red-400">›</span>
      </button>
    </section>

    <p class="text-center text-[11px] text-neutral-500 pt-2 pb-6">
      本地版 v1.0.0 · 数据仅存本机 · Made with ♥
    </p>
  </div>
  <!-- 用户头像生成弹窗 -->
  <ImageGenModal v-model="showAvatarGen" :preset="avatarGenPreset" @use="onUseAvatarGen" />

  <!-- 手机/局域网访问说明弹窗 -->
  <Teleport to="body">
    <div v-if="showLan" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showLan = false"></div>
      <div class="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100">
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 sticky top-0 bg-white dark:bg-neutral-900">
          <span class="font-semibold">📱 手机 / 局域网访问</span>
          <button @click="showLan = false" class="text-neutral-400 hover:text-neutral-200 text-lg leading-none">✕</button>
        </div>
        <div class="px-5 py-4 space-y-4 text-sm">
          <!-- 当前地址 -->
          <div>
            <div class="text-xs text-neutral-400 mb-1.5">本应用当前的访问地址（发给同一 WiFi 下的设备即可打开）：</div>
            <div class="flex items-center gap-2">
              <code class="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-mono truncate">{{ pageUrl }}</code>
              <button @click="copyPageUrl" class="px-3 py-2 rounded-lg bg-sky-500 text-white text-xs hover:bg-sky-400 transition shrink-0">复制</button>
            </div>
          </div>

          <!-- 使用步骤 -->
          <div>
            <div class="font-medium mb-1.5">使用步骤（同一 WiFi 下）：</div>
            <ol class="list-decimal pl-5 space-y-1 text-xs text-neutral-500">
              <li>电脑上用 <b class="text-neutral-300">启动.bat</b> 启动应用（保持窗口开着）</li>
              <li>启动时终端会显示 Network 地址（如 http://192.168.x.x:5173），也可以用上面的复制按钮拿到当前地址</li>
              <li>手机连<b class="text-neutral-300">同一 WiFi</b>，浏览器打开该地址</li>
              <li>首次打开若失败：Windows 防火墙弹窗点「允许」；或手动放行 Node.js</li>
            </ol>
          </div>

          <!-- 重要说明 -->
          <div class="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-xs text-neutral-500 space-y-1">
            <p class="font-medium text-amber-400">数据说明（重要）：</p>
            <p>· 聊天记录保存在<b class="text-neutral-300">各自设备的浏览器</b>里，手机和电脑的数据<b class="text-neutral-300">互相独立</b>，不会自动同步</p>
            <p>· 想把电脑的聊天/角色搬到手机：个人中心 → 导出全部数据 → 手机上恢复（反之同理）</p>
            <p>· 换了 WiFi / 电脑 IP 变了：地址会变，重新拿新地址即可</p>
          </div>

          <!-- 发给别人 -->
          <div>
            <div class="font-medium mb-1.5">发给朋友使用：</div>
            <ul class="list-disc pl-5 space-y-1 text-xs text-neutral-500">
              <li><b class="text-neutral-300">同一 WiFi</b>：朋友手机直接打开上面复制的地址（你的电脑需保持启动）</li>
              <li><b class="text-neutral-300">不同网络/异地</b>：局域网地址朋友访问不了——把整个 <code class="font-mono">ai-character-chat</code> 文件夹发给他，他电脑上双击「启动.bat」运行（首次需安装 Node.js）</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>