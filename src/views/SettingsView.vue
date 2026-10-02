<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '../composables/useTheme'
import { store, setSetting, exportAllData, importAllData, getActiveApiKey } from '../store/useDataStore.js'
import { downloadJson, pickJsonFile } from '../utils/io.js'

const router = useRouter()
const { isDark, toggle } = useTheme()

// 全局 LLM 参数（适用于所有激活的 API key）
const params = ref({
  temperature: 0.8,
  topP: 0.9,
  maxTokens: 2048,
})

const notice = ref('')
const saving = ref(false)

function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 4000)
}

const activeKey = computed(() => getActiveApiKey())
const apiKeyCount = computed(() =>
  Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys.length : 0
)

onMounted(() => {
  const saved = store.settings.llm
  if (saved) params.value = { ...params.value, ...saved }
})

async function onSave() {
  saving.value = true
  try {
    await setSetting('llm', { ...params.value })
    flash('已保存到本地')
  } catch (e) {
    flash('保存失败：' + (e && e.message ? e.message : e))
  } finally {
    saving.value = false
  }
}

function gotoApiKeys() {
  router.push('/api-keys')
}

async function onBackup() {
  try {
    const data = await exportAllData()
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadJson(`工作台备份-${ts}.json`, data)
    flash(`已导出备份：${data.characters.length} 人物卡 / ${data.personas.length} 马甲 / ${data.sessions.length} 会话`)
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
  } catch (e) {
    flash('恢复失败：' + (e && e.message ? e.message : e))
  }
}
</script>

<template>
  <div class="max-w-2xl">
    <h1 class="text-xl font-bold mb-6">设置</h1>

    <!-- 提示条 -->
    <div
      v-if="notice"
      class="mb-4 px-4 py-2 rounded-lg bg-neutral-800 dark:bg-neutral-700 text-white text-sm shadow break-all"
    >
      {{ notice }}
    </div>

    <!-- 主题切换 -->
    <div class="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-semibold">明暗主题</h2>
          <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1">当前：{{ isDark ? '暗色' : '亮色' }}</p>
        </div>
        <button
          @click="toggle"
          :class="['relative w-14 h-8 rounded-full transition', isDark ? 'bg-indigo-500' : 'bg-neutral-300 dark:bg-neutral-600']"
        >
          <span :class="['absolute top-1 w-6 h-6 rounded-full bg-white transition-all', isDark ? 'left-7' : 'left-1']"></span>
        </button>
      </div>
    </div>

    <!-- API 密钥入口 -->
    <div class="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5 mb-6">
      <div class="flex items-center justify-between mb-3">
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">API 密钥</h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            已配置 {{ apiKeyCount }} 条
            <span v-if="activeKey"> · 激活：<span class="font-mono">{{ activeKey.name }}</span></span>
          </p>
        </div>
        <button
          @click="gotoApiKeys"
          class="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 shrink-0 ml-2"
        >
          管理 →
        </button>
      </div>
      <div v-if="!apiKeyCount" class="text-xs text-amber-600 dark:text-amber-400">
        ⚠ 尚未添加任何 API Key，发消息时会用占位回复
      </div>
    </div>

    <!-- 全局 LLM 参数 -->
    <div class="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5 space-y-4 mb-6">
      <h2 class="font-semibold">全局对话参数</h2>
      <p class="text-xs text-neutral-500">这些参数对所有激活的 API Key 生效</p>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">temperature</label>
          <input v-model.number="params.temperature" type="number" step="0.1" min="0" max="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">top_p</label>
          <input v-model.number="params.topP" type="number" step="0.1" min="0" max="1" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">max_tokens</label>
          <input v-model.number="params.maxTokens" type="number" step="1" min="1" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          @click="onSave"
          :disabled="saving"
          class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 disabled:opacity-60"
        >
          {{ saving ? '保存中…' : '保存参数' }}
        </button>
      </div>
    </div>

    <!-- 数据备份 -->
    <div class="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
      <h2 class="font-semibold mb-1">数据备份</h2>
      <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
        全部数据只存在本机浏览器里，没有云端。建议定期导出备份，换电脑/清缓存前务必先备份。
      </p>
      <div class="flex gap-3">
        <button @click="onBackup" class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600">
          导出全部数据
        </button>
        <button @click="onRestore" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">
          从备份恢复
        </button>
      </div>
    </div>
  </div>
</template>