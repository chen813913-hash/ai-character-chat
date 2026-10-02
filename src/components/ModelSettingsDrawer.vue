<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  store,
  setSetting,
  setActiveModel,
} from '../store/useDataStore.js'
import JailbreakPickerModal from './JailbreakPickerModal.vue'
import LorebookPickerModal from './LorebookPickerModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

const router = useRouter()

// ---- 状态 ----
const apiKeys = computed(() => Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : [])
const activeId = computed(() => store.settings.activeApiKeyId)
const activeKey = computed(() => {
  return apiKeys.value.find((k) => k.id === activeId.value) || apiKeys.value[0] || null
})

const TABS = [
  { value: 'dialog', label: '对话' },
  { value: 'voice', label: '语音' },
  { value: 'break', label: '破甲' },
  { value: 'lorebook', label: '世界书' },
]
const activeTab = ref('dialog')

// 全局参数（maxTokens 默认 4096：世界书状态栏模板很长，2048 会在中途截断）
const params = ref({
  temperature: 0.7,
  maxTokens: 4096,
  historyDepth: 50,
  stream: true,
})

function loadFromStore() {
  const llm = store.settings.llm || {}
  params.value = {
    temperature: typeof llm.temperature === 'number' ? llm.temperature : 0.7,
    maxTokens: llm.maxTokens && llm.maxTokens > 2048 ? llm.maxTokens : 4096,
    historyDepth: typeof llm.historyDepth === 'number' ? llm.historyDepth : 50,
    stream: llm.stream !== false,
  }
}
watch(() => props.modelValue, (open) => { if (open) loadFromStore() }, { immediate: true })
watch(() => store.settings.llm, () => loadFromStore(), { deep: true })

// 模型选择：把所有 api key 的 models 拍平到一个下拉，每项含 key 名后缀
const allModelOptions = computed(() => {
  const out = []
  for (const k of apiKeys.value) {
    for (const m of (k.models || [])) {
      out.push({ apiKeyId: k.id, apiKeyName: k.name, model: m })
    }
  }
  return out
})
const currentSelection = computed({
  get: () => {
    const k = activeKey.value
    if (!k) return ''
    const m = k.activeModel || (k.models && k.models[0]) || ''
    if (!m) return ''
    return `${k.id}::${m}`
  },
  set: async (v) => {
    const [apiKeyId, model] = (v || '').split('::')
    if (apiKeyId && model) await setActiveModel(apiKeyId, model)
  },
})

// ---- 滑块 / 开关：写入实时持久化 ----
async function setTemp(v) {
  params.value.temperature = v
  await setSetting('llm', { ...store.settings.llm, temperature: v })
}
async function setMax(v) {
  params.value.maxTokens = v
  await setSetting('llm', { ...store.settings.llm, maxTokens: v })
}
async function setHistory(v) {
  params.value.historyDepth = v
  await setSetting('llm', { ...store.settings.llm, historyDepth: v })
}
async function setStream(v) {
  params.value.stream = v
  await setSetting('llm', { ...store.settings.llm, stream: v })
}

function close() {
  emit('update:modelValue', false)
}

function gotoApiKeys() {
  close()
  router.push('/api-keys')
}

// ================= 破甲 =================
// settings.jailbreak = { enabled, mode: 'builtin'|'simple'|'sillytavern', activeId }
const jbCfg = computed(() => {
  const j = store.settings.jailbreak || {}
  return {
    enabled: !!j.enabled,
    mode: j.mode || 'builtin',
    activeId: j.activeId || '',
  }
})

const jbPresets = computed(() => store.jailbreaks || [])
const jbActive = computed(() => jbPresets.value.find((x) => x.id === jbCfg.value.activeId) || null)
const jbActiveValid = computed(() => !!jbActive.value && jbActive.value.type === jbCfg.value.mode)

async function saveJbCfg(patch) {
  await setSetting('jailbreak', { ...jbCfg.value, ...patch })
}

async function toggleJb() {
  await saveJbCfg({ enabled: !jbCfg.value.enabled })
}

// 预设方式：builtin=内置通用（无注入），simple/sillytavern=从预设库选
async function onModeChange(e) {
  const mode = e.target.value
  await saveJbCfg({ mode })
  if (mode === 'simple' || mode === 'sillytavern') {
    // 当前 activeId 类型不匹配（或还没选）时打开选择弹窗
    if (!jbActiveValid.value) openPicker()
  }
}

// 选择弹窗
const showPicker = ref(false)
const pickerType = ref('simple')
function openPicker() {
  pickerType.value = jbCfg.value.mode === 'sillytavern' ? 'sillytavern' : 'simple'
  showPicker.value = true
}
async function onPickUse(jb) {
  await saveJbCfg({ mode: jb.type, activeId: jb.id, enabled: true })
}

// 预览当前预设：分段带参数名标签，有值的段才显示
const showJbPreview = ref(false)
const jbPreviewSections = computed(() => {
  const j = jbActive.value
  if (!j) return []
  if (j.type === 'sillytavern') {
    try {
      const o = JSON.parse(j.stJson || '{}')
      const ps = Array.isArray(o.prompts) ? o.prompts : []
      const secs = ps
        .map((p, i) => ({ label: (p && p.name) || `条目 ${i + 1}`, content: (p && p.content) || '' }))
        .filter((s) => s.content.trim())
      return secs.length ? secs : [{ label: '预设内容', content: '（该预设暂无提示词条目）' }]
    } catch (e) {
      return [{ label: '预设内容', content: '（JSON 格式错误，无法预览）' }]
    }
  }
  const secs = [
    { label: '前置提示词', content: j.systemPrompt || '' },
    { label: '规则提示词', content: j.rulePrompt || '' },
    { label: '后置提示词', content: j.postPrompt || '' },
  ].filter((s) => s.content.trim())
  return secs.length ? secs : [{ label: '预设内容', content: '（暂无提示词内容）' }]
})

function editActiveJb() {
  if (!jbActive.value) return
  close()
  router.push({ path: '/jailbreak/edit', query: { id: jbActive.value.id } })
}

// ================= 世界书 =================
// settings.lorebook = { activeId(兼容旧版), activeIds(多选) }
const lbCfg = computed(() => store.settings.lorebook || {})
const lbIds = computed(() => Array.isArray(lbCfg.value.activeIds) ? lbCfg.value.activeIds : (lbCfg.value.activeId ? [lbCfg.value.activeId] : []))
const lbActive = computed(() => (store.lorebooks || []).filter((x) => lbIds.value.includes(x.id)))

const showLbPicker = ref(false)
function openLbPicker() { showLbPicker.value = true }
async function onLbPick(lb) {
  const ids = lbIds.value.includes(lb.id) ? lbIds.value : [...lbIds.value, lb.id]
  await setSetting('lorebook', { ...lbCfg.value, activeIds: ids, activeId: ids[0] || '' })
}
async function toggleLb(lb) {
  const ids = lbIds.value.includes(lb.id) ? lbIds.value.filter((id) => id !== lb.id) : [...lbIds.value, lb.id]
  await setSetting('lorebook', { ...lbCfg.value, activeIds: ids, activeId: ids[0] || '' })
}
// 循环图标：清除世界书（不使用世界书）
async function clearLorebook() {
  await setSetting('lorebook', { ...lbCfg.value, activeIds: [], activeId: '' })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex"
    >
      <!-- 背景遮罩 -->
      <div class="flex-1 bg-black/50 backdrop-blur-sm" @click="close"></div>

      <!-- 右侧抽屉 -->
      <aside class="w-[360px] shrink-0 bg-neutral-900 text-neutral-100 shadow-2xl flex flex-col border-l border-neutral-800">
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <h3 class="text-base font-semibold">模型设置</h3>
          <button
            @click="close"
            class="w-8 h-8 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center text-lg leading-none transition"
          >×</button>
        </div>

        <!-- Tabs -->
        <div class="px-5 pt-3 pb-1">
          <div class="flex gap-1 bg-neutral-800/60 rounded-lg p-1">
            <button
              v-for="t in TABS"
              :key="t.value"
              @click="activeTab = t.value"
              :class="[
                'flex-1 py-1.5 text-xs rounded-md transition',
                activeTab === t.value
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-400 hover:text-neutral-200',
              ]"
            >{{ t.label }}</button>
          </div>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          <!-- 对话 tab -->
          <div v-if="activeTab === 'dialog'" class="space-y-4">
            <!-- 模型选择（合并 key + model：点击直接切到对应 key 与模型）-->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-neutral-500">模型</span>
                <button
                  @click="gotoApiKeys"
                  class="text-[11px] text-pink-400 hover:underline"
                >管理 API Key →</button>
              </div>
              <div v-if="allModelOptions.length" class="relative">
                <select
                  v-model="currentSelection"
                  class="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:border-pink-500 text-sm appearance-none pr-9"
                >
                  <option
                    v-for="opt in allModelOptions"
                    :key="opt.apiKeyId + '::' + opt.model"
                    :value="opt.apiKeyId + '::' + opt.model"
                  >
                    {{ opt.model }} - {{ opt.apiKeyName }}
                  </option>
                </select>
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 pointer-events-none text-xs">▾</span>
              </div>
              <div v-else class="text-xs text-neutral-500 px-3 py-2 rounded-lg bg-neutral-800/50 border border-dashed border-neutral-700">
                还没有任何模型，去 API 密钥页添加 Key 与模型
              </div>
            </div>

            <!-- 温度 -->
            <div>
              <div class="flex justify-between text-xs mb-1.5">
                <span class="text-neutral-400">创造度 / 温度</span>
                <span class="font-mono text-neutral-300">{{ params.temperature.toFixed(1) }}</span>
              </div>
              <input
                type="range" min="0" max="2" step="0.1"
                :value="params.temperature"
                @input="setTemp(parseFloat($event.target.value))"
                class="w-full accent-pink-500"
              />
            </div>

            <!-- 最大回复长度 -->
            <div>
              <div class="flex justify-between text-xs mb-1.5">
                <span class="text-neutral-400">最大回复长度</span>
                <span class="font-mono text-neutral-300">({{ params.maxTokens }})</span>
              </div>
              <input
                type="range" min="64" max="8192" step="64"
                :value="params.maxTokens"
                @input="setMax(parseInt($event.target.value))"
                class="w-full accent-pink-500"
              />
            </div>

            <!-- 对话记忆 -->
            <div>
              <div class="flex justify-between text-xs mb-1.5">
                <span class="text-neutral-400">对话记忆</span>
                <span class="font-mono text-neutral-300">
                  ({{ params.historyDepth }} 轮)
                  <span v-if="params.historyDepth >= 50" class="text-amber-400 ml-1">最大 50</span>
                </span>
              </div>
              <input
                type="range" min="0" max="50" step="1"
                :value="params.historyDepth"
                @input="setHistory(parseInt($event.target.value))"
                class="w-full accent-pink-500"
              />
            </div>

            <!-- 流式输出 -->
            <div class="flex items-center justify-between pt-1">
              <span class="text-xs text-neutral-400">流式输出</span>
              <button
                @click="setStream(!params.stream)"
                :class="[
                  'w-10 h-5 rounded-full transition relative',
                  params.stream ? 'bg-pink-500' : 'bg-neutral-700',
                ]"
              >
                <span
                  :class="[
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                    params.stream ? 'left-5' : 'left-0.5',
                  ]"
                ></span>
              </button>
            </div>
          </div>

          <!-- 语音 tab -->
          <div v-else-if="activeTab === 'voice'" class="text-center text-neutral-500 py-12 space-y-2">
            <div class="text-4xl">🔇</div>
            <p class="text-sm">TTS 语音合成暂未支持</p>
            <p class="text-xs text-neutral-600">本地版无服务端，可后续接入浏览器 SpeechSynthesis 或本地 TTS 引擎</p>
          </div>

          <!-- 破甲 tab -->
          <div v-else-if="activeTab === 'break'" class="space-y-4">
            <!-- 启用破甲 -->
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-medium">启用破甲</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">通过预设调整角色扮演和回复方式。</p>
              </div>
              <button
                @click="toggleJb"
                :class="['w-10 h-5 rounded-full transition relative shrink-0 mt-0.5',
                  jbCfg.enabled ? 'bg-pink-500' : 'bg-neutral-700']"
                title="启用/关闭破甲"
              >
                <span
                  :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', jbCfg.enabled ? 'left-5' : 'left-0.5']"
                ></span>
              </button>
            </div>

            <!-- 预设方式 -->
            <div>
              <div class="text-xs text-neutral-400 mb-1.5">预设方式</div>
              <div class="relative">
                <select
                  :value="jbCfg.mode"
                  @change="onModeChange"
                  class="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:border-pink-500 text-sm appearance-none pr-9"
                >
                  <option value="builtin">内置通用预设</option>
                  <option value="simple">普通预设</option>
                  <option value="sillytavern">酒馆预设</option>
                </select>
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 pointer-events-none text-xs">▾</span>
              </div>
              <p class="text-[11px] text-neutral-500 mt-1.5">
                {{ jbCfg.mode === 'builtin' ? '内置通用方式，可直接聊天。' : '从预设库中选择破甲提示词预设。' }}
              </p>
              <button
                v-if="jbCfg.mode !== 'builtin'"
                @click="openPicker"
                class="w-full mt-2 py-2 rounded-lg border border-neutral-700 text-sm text-neutral-300 hover:bg-neutral-800 transition"
              >调整选项</button>
            </div>

            <!-- 当前预设 -->
            <div v-if="jbCfg.mode !== 'builtin'">
              <div class="rounded-xl border border-neutral-800 p-3.5">
                <div class="text-[11px] text-neutral-500 mb-0.5">当前预设</div>
                <div v-if="jbActiveValid" class="font-semibold text-sm">{{ jbActive.title || '未命名' }}</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">
                  {{ jbActiveValid ? '可直接使用当前配置聊天，也可以按需调整选项。' : '还没有选择破甲预设。' }}
                </p>

                <div v-if="jbActiveValid" class="flex items-center gap-2 mt-3">
                  <div class="flex-1 flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm min-w-0">
                    <span class="truncate">{{ jbActive.title || '未命名' }}</span>
                    <button @click="editActiveJb" class="text-neutral-400 hover:text-white shrink-0 ml-2" title="编辑此预设">✎</button>
                  </div>
                  <button
                    @click="showJbPreview = true"
                    class="px-3 py-2 rounded-lg border border-neutral-700 text-sm text-neutral-300 hover:bg-neutral-800 transition shrink-0"
                  >预览</button>
                </div>
                <button
                  v-else
                  @click="openPicker"
                  class="w-full mt-3 py-2 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-sm font-medium shadow shadow-pink-500/25 transition"
                >从预设库选择</button>
              </div>
              <p class="text-[11px] text-neutral-600 mt-2">也可在聊天输入框上方快速调整。</p>
            </div>
          </div>

          <!-- 世界书 tab -->
          <div v-else-if="activeTab === 'lorebook'" class="space-y-4">
            <!-- 标题行 + 清除（循环图标） -->
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-medium">世界书</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">为模型增加额外知识</p>
              </div>
              <button
                v-if="lbActive.length"
                @click="clearLorebook"
                class="w-7 h-7 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center transition shrink-0"
                title="清除世界书（不使用世界书）"
              >↺</button>
            </div>

            <!-- 当前世界书 / 未设置 -->
            <button
              v-if="!lbActive.length"
              @click="openLbPicker"
              class="w-full py-3 rounded-lg border border-neutral-700 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition"
            >未设置</button>
            <div v-else class="w-full text-left px-3 py-2.5 rounded-lg border border-neutral-700">
              <div class="text-[11px] text-neutral-500 mb-1">当前世界书（可多选）</div>
              <div class="space-y-1">
                <button v-for="lb in lbActive" :key="lb.id" @click="toggleLb(lb)" class="w-full text-left flex items-center justify-between gap-2 text-sm hover:text-pink-300">
                  <span class="truncate">{{ lb.title || '未命名' }}</span><span class="text-[11px] text-neutral-500">{{ (lb.entries || []).length }} 条 · 移除</span>
                </button>
              </div>
              <button @click="openLbPicker" class="w-full mt-2 py-1.5 rounded-lg border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800">＋ 添加世界书</button>
            </div>

            <!-- 匹配深度 -->
            <div>
              <div class="flex justify-between text-xs mb-1.5">
                <span class="text-neutral-400">匹配深度（轮）</span>
                <span class="font-mono text-neutral-300">({{ params.historyDepth }})</span>
              </div>
              <input
                type="range" min="1" max="20" step="1"
                :value="params.historyDepth"
                @input="setHistory(parseInt($event.target.value))"
                class="w-full accent-pink-500"
              />
              <p class="text-[11px] text-neutral-500 mt-1">扫描最近 N 轮对话匹配世界书关键词；常驻条目始终注入</p>
            </div>
            <div class="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500">
              <p class="font-medium text-neutral-400 mb-1">💡 提示</p>
              <p>这里选中的世界书会与角色卡自带的世界书一起参与关键词命中。「概率 / 深度 / 顺序」等在每条条目里独立配置（个人中心 → 世界书）。</p>
            </div>
          </div>

        </div>
      </aside>

      <!-- 破甲预设选择弹窗 -->
      <JailbreakPickerModal
        v-model="showPicker"
        :init-type="pickerType"
        @use="onPickUse"
      />

      <!-- 世界书选择弹窗 -->
      <LorebookPickerModal
        v-model="showLbPicker"
        :multi="true"
        @pick="onLbPick"
      />

      <!-- 当前预设预览弹窗 -->
      <Teleport to="body">
        <div v-if="showJbPreview" class="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showJbPreview = false"></div>
          <div class="relative w-full max-w-xl max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100">
            <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <span class="font-semibold text-sm">预览：{{ jbActive ? (jbActive.title || '未命名') : '' }}</span>
              <button @click="showJbPreview = false" class="text-neutral-400 hover:text-neutral-200 leading-none">✕</button>
            </div>
            <pre
              v-for="sec in jbPreviewSections"
              :key="sec.label"
              class="px-5 py-3 text-sm whitespace-pre-wrap break-words text-neutral-100 border-b border-neutral-800/60 last:border-b-0"
            ><span class="block text-[11px] font-semibold text-pink-400 mb-1.5">【{{ sec.label }}】</span>{{ sec.content }}</pre>
          </div>
        </div>
      </Teleport>
    </div>
  </Teleport>
</template>