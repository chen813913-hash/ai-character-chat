<script setup>
import { ref, computed } from 'vue'
import {
  store,
  addImageApi,
  updateImageApi,
  removeImageApi,
  setActiveImageApi,
} from '../store/useDataStore.js'
import { testImageApi } from '../utils/imageGen.js'

// 绘画接口管理：本地 SD WebUI（秋叶）+ 网络 OpenAI 兼容接口
const editing = ref(null) // null | {id?, name, type, apiBase, apiKey, model, createTime}
const showModal = ref(false)
const testing = ref('')
const testResults = ref({}) // id -> {ok, message}
const notice = ref('')

const apis = computed(() => (Array.isArray(store.settings.imageApis) ? store.settings.imageApis : []))
const activeId = computed(() => store.settings.activeImageApiId || '')

function flash(text) {
  notice.value = text
  setTimeout(() => (notice.value = ''), 2600)
}

const TYPES = [
  { value: 'sd-webui', label: 'SD WebUI（本地）' },
  { value: 'openai', label: 'OpenAI 兼容（网络）' },
]
function typeLabel(t) {
  return (TYPES.find((x) => x.value === t) || {}).label || t
}

function onAdd() {
  editing.value = { id: '', name: '', type: 'sd-webui', apiBase: 'http://127.0.0.1:7860', apiKey: '', model: '', createTime: 0 }
  showModal.value = true
}
function onEdit(api) {
  editing.value = JSON.parse(JSON.stringify(api))
  showModal.value = true
}
async function onSave(data) {
  if (data.id) await updateImageApi(data)
  else {
    data.id = 'ia-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    data.createTime = Date.now()
    await addImageApi(data)
  }
  showModal.value = false
  flash('绘画接口已保存')
}
async function onRemove(api) {
  if (!confirm(`确定删除绘画接口「${api.name}」？`)) return
  await removeImageApi(api.id)
  flash('已删除')
}
async function onTest(api) {
  testing.value = api.id
  testResults.value[api.id] = { ok: false, message: '测试中…' }
  try {
    const msg = await testImageApi(api)
    testResults.value[api.id] = { ok: true, message: msg }
  } catch (e) {
    testResults.value[api.id] = { ok: false, message: e && e.message ? e.message : '测试失败' }
  } finally {
    testing.value = ''
  }
}
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
    <!-- 提示条 -->
    <div
      v-if="notice"
      class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow-lg"
    >
      {{ notice }}
    </div>

    <!-- 标题行 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">绘画接口</h1>
        <p class="text-xs text-neutral-500 mt-1">
          支持本地 SD WebUI（秋叶整合包）与网络上的 OpenAI 兼容绘画接口，生成的图片仅保存在浏览器本地
        </p>
      </div>
      <button
        @click="onAdd"
        class="px-3 py-1.5 rounded-full text-xs border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center gap-1.5 shrink-0"
      >
        <span>＋</span><span>添加</span>
      </button>
    </div>

    <!-- SD WebUI 前置说明 -->
    <div class="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-xs text-neutral-500 space-y-1.5">
      <p class="font-medium text-neutral-400">📌 本地 SD WebUI（秋叶/绘世启动器）使用前需要两步：</p>
      <p>1. 启动器「高级选项」→ 开启 <b class="text-neutral-300">启用 API</b> 开关</p>
      <p>2. 跨域授权（<b class="text-neutral-300">二选一</b>，改完需重启 SD）：</p>
      <p class="pl-3">· 新版启动器：底部「CORS 授权管理」→ 添加<b class="text-neutral-300">本应用的地址</b>（浏览器地址栏开头，如 http://localhost:4178）</p>
      <p class="pl-3">· 旧版/命令行：追加参数 <b class="text-neutral-300">--cors-allow-origins=*</b></p>
      <p class="text-amber-400/80">⚠️ 授权的是「打开本应用的地址」，不是 SD 自己的地址；换端口/换打开方式需重新授权</p>
    </div>

    <!-- 空态 -->
    <div
      v-if="!apis.length"
      class="text-center text-neutral-500 py-16 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-2xl"
    >
      还没有绘画接口，点击「添加」创建（本地 SD WebUI 或网络接口）
    </div>

    <!-- 接口卡片列表 -->
    <div v-else class="space-y-3">
      <div
        v-for="api in apis"
        :key="api.id"
        :class="['rounded-2xl border p-4 transition',
          activeId === api.id
            ? 'border-pink-400 bg-pink-500/5'
            : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900']"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm">{{ api.name || '未命名' }}</span>
              <span
                :class="['px-2 py-0.5 rounded-md text-[10px] font-medium',
                  api.type === 'openai' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-violet-500/15 text-violet-400']"
              >{{ typeLabel(api.type) }}</span>
              <span
                v-if="activeId === api.id"
                class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-pink-500/15 text-pink-400"
              >使用中</span>
            </div>
            <div class="text-xs text-neutral-500 mt-1.5 font-mono truncate">{{ api.apiBase }}</div>
            <div v-if="api.type === 'openai'" class="text-[11px] text-neutral-500 mt-1">
              模型：{{ api.model || '（未填，用接口默认）' }} · 密钥：{{ api.apiKey ? '已配置' : '未配置' }}
            </div>
            <div class="text-[11px] text-neutral-500 mt-1">创建于 {{ timeAgo(api.createTime) }}</div>
            <!-- 测试结果 -->
            <div
              v-if="testResults[api.id]"
              :class="['text-xs mt-2', testResults[api.id].ok ? 'text-emerald-500' : 'text-red-400']"
            >{{ testResults[api.id].ok ? '✅ ' : '❌ ' }}{{ testResults[api.id].message }}</div>
          </div>
          <div class="flex flex-col items-end gap-1.5 shrink-0">
            <button
              v-if="activeId !== api.id"
              @click="setActiveImageApi(api.id)"
              class="px-2.5 py-1 rounded-lg text-[11px] border border-neutral-300 dark:border-neutral-700 hover:border-pink-400 hover:text-pink-400 transition"
            >设为使用</button>
            <button
              @click="onTest(api)"
              :disabled="testing === api.id"
              class="px-2.5 py-1 rounded-lg text-[11px] border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 transition"
            >{{ testing === api.id ? '测试中…' : '测试连接' }}</button>
            <div class="flex items-center gap-1 mt-1">
              <button @click="onEdit(api)" class="px-1.5 py-1 text-xs text-neutral-400 hover:text-indigo-500 transition" title="编辑">✎</button>
              <button @click="onRemove(api)" class="px-1.5 py-1 text-xs text-neutral-400 hover:text-red-500 transition" title="删除">🗑</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑/新增弹窗 -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showModal = false"></div>
      <div class="relative w-full max-w-md bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-2xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold">{{ editing && editing.id ? '编辑绘画接口' : '新增绘画接口' }}</h3>
          <button @click="showModal = false" class="text-neutral-400 hover:text-neutral-200 text-lg leading-none">✕</button>
        </div>

        <div v-if="editing" class="space-y-3.5">
          <!-- 名称 -->
          <div>
            <label class="block text-sm font-medium mb-1">名称 *</label>
            <input
              v-model="editing.name"
              placeholder="例如：本地秋叶SD"
              class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>

          <!-- 类型 -->
          <div>
            <label class="block text-sm font-medium mb-1">接口类型</label>
            <select
              v-model="editing.type"
              class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-sm focus:outline-none"
            >
              <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>

          <!-- 地址 -->
          <div>
            <label class="block text-sm font-medium mb-1">接口地址 *</label>
            <input
              v-model="editing.apiBase"
              :placeholder="editing.type === 'sd-webui' ? 'http://127.0.0.1:7860' : 'https://api.example.com/v1'"
              class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>

          <!-- OpenAI 专用：密钥 + 模型 -->
          <template v-if="editing.type === 'openai'">
            <div>
              <label class="block text-sm font-medium mb-1">API 密钥</label>
              <input
                v-model="editing.apiKey"
                placeholder="sk-...（不填则不带鉴权头）"
                class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-sm font-mono focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">模型</label>
              <input
                v-model="editing.model"
                placeholder="例如：dall-e-3 / Kolors"
                class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 text-sm focus:outline-none"
              />
            </div>
          </template>

          <!-- SD 专用提示 -->
          <div v-else class="rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2.5 text-[11px] text-neutral-500 space-y-1">
            <p>SD WebUI 需在启动器开启 API 并追加 <b class="text-neutral-300">--cors-allow-origins=*</b></p>
            <p>默认地址 http://127.0.0.1:7860；生成分辨率与步数在生成弹窗里调</p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button @click="showModal = false" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm">取消</button>
          <button
            @click="onSave(editing)"
            :disabled="!editing || !editing.name || !editing.apiBase"
            class="px-4 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium disabled:opacity-40"
          >保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
