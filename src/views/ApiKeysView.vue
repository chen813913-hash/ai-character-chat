<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  store,
  addApiKey,
  updateApiKey,
  removeApiKey,
} from '../store/useDataStore.js'
import { testConnection } from '../utils/llm.js'
import ApiKeyEditModal from '../components/ApiKeyEditModal.vue'

const editing = ref(null) // null | {id?, name, apiBase, apiKey, models, createdAt}
const showModal = ref(false)
const testing = ref('') // 当前正在测试的 key id
const testResults = ref({}) // id -> {ok, message}
const notice = ref('')

const apiKeys = computed(() => Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : [])

// 是否在 dev server 下（带 Vite proxy）
// import.meta.env.DEV 在 vite dev 时为 true，build 后（dist / dist-standalone）为 false
const isDev = import.meta.env.DEV

// 一键预设：本地常见 LLM 服务
const PRESETS = [
  { name: 'FreeToken 1919', url: '/proxy/v1', model: 'Qwen3.6-35B-A3B NVFP4', hint: 'FreeToken Desktop 默认端口' },
  { name: 'Ollama 11434',   url: '/proxy/v1', model: 'llama3',                 hint: 'Ollama 默认端口' },
  { name: 'LM Studio 1234', url: '/proxy/v1', model: 'qwen2.5-7b-instruct',    hint: 'LM Studio 默认端口' },
]

// 复制 /proxy/v1 到剪贴板
const copyHint = ref('')
async function copyProxy() {
  try {
    await navigator.clipboard.writeText('/proxy/v1')
    copyHint.value = '已复制 /proxy/v1'
    setTimeout(() => (copyHint.value = ''), 1500)
  } catch (e) {
    copyHint.value = '复制失败：浏览器权限不足'
  }
}

function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 2500)
}

function formatRelative(ts) {
  if (!ts) return '刚刚'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 60) return m < 1 ? '刚刚' : m + ' 分钟前'
  const h = Math.floor(diff / 3600000)
  if (h < 24) return h + ' 小时前'
  const d = Math.floor(diff / 86400000)
  if (d < 30) return d + ' 天前'
  const mo = Math.floor(d / 30)
  if (mo < 12) return mo + ' 个月前'
  const y = Math.floor(d / 365)
  return y + ' 年前'
}

function onAdd() {
  editing.value = {
    id: '',
    name: '',
    apiBase: '',
    apiKey: '',
    models: [],
    createdAt: Date.now(),
  }
  showModal.value = true
}

function applyPreset(p) {
  editing.value = {
    id: '',
    name: p.name,
    apiBase: p.url,
    apiKey: '',
    models: [p.model],
    createdAt: Date.now(),
  }
  showModal.value = true
}
function onEdit(k) {
  editing.value = { ...k, models: [...(k.models || [])] }
  showModal.value = true
}
function onDelete(k) {
  if (!confirm(`确定删除「${k.name}」？`)) return
  removeApiKey(k.id).then(() => flash('已删除'))
}

async function onSave(data) {
  if (data.id) {
    await updateApiKey(data.id, data)
    flash('已保存')
  } else {
    await addApiKey(data)
    flash('已新增')
  }
  showModal.value = false
}

async function onTest(k) {
  testing.value = k.id
  try {
    const res = await testConnection({
      apiBase: k.apiBase,
      apiKey: k.apiKey,
      model: (k.models && k.models[0]) || 'gpt-3.5-turbo',
    })
    testResults.value = { ...testResults.value, [k.id]: res }
    flash(res.ok ? '✅ ' + res.message : '❌ ' + res.message)
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [k.id]: { ok: false, message: e.message },
    }
  } finally {
    testing.value = ''
  }
}

function maskKey(s) {
  if (!s) return ''
  if (s.length <= 8) return '•'.repeat(s.length)
  return s.slice(0, 4) + '•'.repeat(Math.max(8, s.length - 8)) + s.slice(-4)
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <!-- 顶部 -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-bold">API 密钥</h2>
        <p class="text-xs text-neutral-500 mt-0.5">
          所有 key 仅保存在浏览器本地，绝不上传任何服务器。要切换使用的 key 与模型，请到聊天页的「模型设置」。
        </p>
      </div>
      <button
        @click="onAdd"
        class="px-3 py-1.5 rounded-full text-xs border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center gap-1.5"
      >
        <span>＋</span><span>添加</span>
      </button>
    </div>

    <!-- 提示条 -->
    <div
      v-if="notice"
      class="mb-4 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow"
    >
      {{ notice }}
    </div>

    <!-- dev 模式横幅：本地 LLM 跨域提示 + 一键预设 -->
    <div
      v-if="isDev"
      class="mb-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm space-y-3"
    >
      <div class="flex items-start gap-2">
        <span class="text-lg leading-none">💡</span>
        <div class="flex-1">
          <div class="font-semibold text-indigo-200">本地 LLM 跨域（CORS）一键解法</div>
          <p class="text-xs text-indigo-300/80 mt-1 leading-relaxed">
            FreeToken / Ollama / LM Studio 等本地服务默认不允许跨域。
            <b class="text-indigo-200">把 API 网址填 <code>/proxy/v1</code> 即可让 Vite 转发绕开 CORS</b>，
            无需配置服务端。完整 URL（如 <code>http://127.0.0.1:1919/v1</code>）会被浏览器拦截。
          </p>
        </div>
        <button
          @click="copyProxy"
          class="shrink-0 px-2.5 py-1 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-xs"
        >{{ copyHint || '复制 /proxy/v1' }}</button>
      </div>

      <!-- 一键预设 -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="p in PRESETS"
          :key="p.name"
          @click="applyPreset(p)"
          class="px-3 py-1.5 rounded-full bg-neutral-900/60 hover:bg-neutral-900 border border-indigo-500/30 text-xs text-indigo-200 hover:text-white transition flex items-center gap-1.5"
        >
          <span>＋</span><span class="font-medium">{{ p.name }}</span>
          <span class="text-indigo-300/60">· {{ p.hint }}</span>
        </button>
      </div>
    </div>

    <!-- 卡片网格 3 列 -->
    <div
      v-if="apiKeys.length"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <div
        v-for="k in apiKeys"
        :key="k.id"
        class="rounded-2xl border border-neutral-800 hover:border-neutral-700 p-4 transition flex flex-col gap-2.5 bg-neutral-900/40"
      >
        <!-- 顶部：名称 + 操作图标 -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold truncate" :title="k.name">{{ k.name }}</h3>
            <div class="text-[11px] text-neutral-500 mt-0.5">{{ formatRelative(k.createdAt) }}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              @click="onEdit(k)"
              class="w-7 h-7 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center transition"
              title="编辑"
            >✎</button>
            <button
              @click="onDelete(k)"
              class="w-7 h-7 rounded-md hover:bg-red-900/30 text-neutral-400 hover:text-red-400 flex items-center justify-center transition"
              title="删除"
            >🗑</button>
          </div>
        </div>

        <!-- API 网址 -->
        <div class="px-2.5 py-1.5 rounded-md bg-black/30 text-xs text-neutral-300 truncate font-mono" :title="k.apiBase">
          {{ k.apiBase || '（未填地址）' }}
        </div>

        <!-- 模型列表 -->
        <div v-if="k.models?.length" class="flex flex-wrap gap-1">
          <span
            v-for="m in k.models.slice(0, 3)"
            :key="m"
            class="px-2 py-0.5 text-[10px] rounded-full bg-neutral-800 text-neutral-400 truncate max-w-full"
            :title="m"
          >{{ m }}</span>
          <span
            v-if="k.models.length > 3"
            class="px-2 py-0.5 text-[10px] rounded-full bg-neutral-800 text-neutral-500"
          >+{{ k.models.length - 3 }}</span>
        </div>

        <!-- 底部：测试按钮 -->
        <div class="flex items-center justify-end gap-2 mt-auto">
          <button
            @click="onTest(k)"
            :disabled="testing === k.id"
            class="px-3 py-1 rounded-md bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-400 hover:to-pink-300 disabled:opacity-50 text-white text-xs font-medium shadow-md shadow-pink-500/20 transition active:scale-95 flex items-center gap-1"
          >
            <span v-if="testing === k.id" class="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
            <span>测试</span>
          </button>
        </div>

        <!-- 测试结果 -->
        <div
          v-if="testResults[k.id]"
          :class="['text-[11px] px-2.5 py-1.5 rounded whitespace-pre-line break-words',
            testResults[k.id].ok
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400']"
        >
          {{ testResults[k.id].ok ? '✅' : '❌' }}
          {{ testResults[k.id].message }}
        </div>
      </div>
    </div>
    <div
      v-else
      class="text-center text-neutral-500 py-20 border border-dashed border-neutral-800 rounded-2xl"
    >
      还没有 API Key，点击下方按钮添加
    </div>

    <!-- 大粉色添加按钮 -->
    <div class="flex justify-center mt-8">
      <button
        @click="onAdd"
        class="px-6 py-3 rounded-full bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-400 hover:to-pink-300 text-white font-medium shadow-lg shadow-pink-500/30 transition flex items-center gap-2"
      >
        <span class="text-lg leading-none">＋</span>
        <span>添加新的 API Key</span>
      </button>
    </div>

    <!-- 编辑弹窗 -->
    <ApiKeyEditModal
      v-model="showModal"
      :model="editing"
      @save="onSave"
    />
  </div>
</template>