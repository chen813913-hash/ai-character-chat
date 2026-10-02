<script setup>
import { ref, computed, watch } from 'vue'
import { store, getActiveImageApi, setSetting } from '../store/useDataStore.js'
import { generateImage, DEFAULT_NEGATIVE } from '../utils/imageGen.js'
import { callLLM } from '../utils/llm.js'

// 通用图片生成弹窗：角色头像/封面、马甲头像、用户头像、对话配图共用
// props.preset: { prompt, negativePrompt, width, height, title }
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  preset: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'use'])

const prompt = ref('')
const negativePrompt = ref('')
const width = ref(512)
const height = ref(512)
const steps = ref(24)
const cfgScale = ref(7)
const count = ref(1)
const showAdvanced = ref(false)

const generating = ref(false)
const progressText = ref('')
const results = ref([]) // dataURL[]
const error = ref('')
const selected = ref(-1)

const activeApi = computed(() => getActiveImageApi())
const isSD = computed(() => !activeApi.value || activeApi.value.type !== 'openai')

// ---- AI 优化提示词（用已配置的 LLM 接口） ----
const OPTIMIZE_INSTRUCTION = [
  '你是 AI 绘画提示词优化专家。请把下面的绘画提示词整理成高质量的 Stable Diffusion 英文提示词：',
  '1. 保留主体内容（人物、外貌、服装、动作、场景），中文翻译成英文；',
  '2. 用英文逗号分隔的标签格式，质量词放最前，去掉重复和口语；',
  '3. 同步给出与画面匹配的负面提示词（英文标签）；',
  '4. 同步给出每个部分对应的中文对照翻译（方便用户阅读理解）。',
  '只输出一个 JSON 对象，格式：{"prompt":"英文标签","promptZh":"中文对照","negativePrompt":"英文负面标签","negativePromptZh":"中文对照"}，不要任何解释。',
].join('\n')

// 中英对照显示（promptZh = 中文参考译文，仅给人看；喂给绘画接口的始终是英文 prompt）
const promptZh = ref('')
const negativePromptZh = ref('')
const bilingual = ref(store.settings.bilingualPrompt !== false) // 默认开
async function toggleBilingual() {
  bilingual.value = !bilingual.value
  await setSetting('bilingualPrompt', bilingual.value)
}

const optimizerModel = ref('') // 'apiKeyId::model'
const optimizing = ref(false)
const optimizerOpen = ref(false)

// 所有已配置 LLM 接口的模型拍平成下拉选项
const optimizerModels = computed(() => {
  const out = []
  for (const k of store.settings.apiKeys || []) {
    for (const m of k.models || []) {
      out.push({ value: k.id + '::' + m, label: m + ' · ' + k.name })
    }
  }
  return out
})

// 默认选中：当前聊天使用的活跃模型
watch(
  () => props.modelValue,
  (open) => {
    if (open && !optimizerModel.value) {
      const saved = store.settings.optimizerModel
      if (saved && optimizerModels.value.some((x) => x.value === saved)) optimizerModel.value = saved
      else {
        const k = (store.settings.apiKeys || []).find((x) => x.id === store.settings.activeApiKeyId)
        const m = k ? (k.activeModel || (k.models && k.models[0]) || '') : ''
        if (k && m) optimizerModel.value = k.id + '::' + m
        else if (optimizerModels.value.length) optimizerModel.value = optimizerModels.value[0].value
      }
    }
  }
)

async function optimizePrompt() {
  const sep = optimizerModel.value.indexOf('::')
  const keyId = optimizerModel.value.slice(0, sep)
  const model = optimizerModel.value.slice(sep + 2)
  const k = (store.settings.apiKeys || []).find((x) => x.id === keyId)
  if (!k || !k.apiBase) {
    error.value = '请先选择优化模型（需在「API 密钥」页配置 LLM 接口）'
    return
  }
  optimizing.value = true
  error.value = ''
  try {
    const text = await callLLM({
      config: {
        apiBase: k.apiBase,
        apiKey: k.apiKey,
        model,
        temperature: 0.4,
        maxTokens: 2000,
        stream: false,
        // Qwen3 等思考模型：关闭思考，避免思考耗尽输出额度导致 content 为空
        extraBody: { chat_template_kwargs: { enable_thinking: false } },
      },
      messages: [
        { role: 'system', content: OPTIMIZE_INSTRUCTION },
        {
          role: 'user',
          content:
            '当前提示词：' + (prompt.value || '（空）') + '\n当前负面提示词：' + (negativePrompt.value || '（空）'),
        },
      ],
    })
    setSetting('optimizerModel', optimizerModel.value)
    // 容错解析：剥掉思考块 → 优先取 JSON → 失败则整段当正向提示词
    let cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    let obj = null
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        obj = JSON.parse(m[0])
      } catch (e) {
        obj = null
      }
    }
    if (obj && obj.prompt) {
      prompt.value = String(obj.prompt)
      promptZh.value = String(obj.promptZh || '')
      if (obj.negativePrompt) negativePrompt.value = String(obj.negativePrompt)
      negativePromptZh.value = String(obj.negativePromptZh || '')
    } else if (cleaned) {
      prompt.value = cleaned
      promptZh.value = ''
    } else {
      throw new Error('模型未返回内容（思考模型可能耗尽了输出额度，可换非思考模型重试）')
    }
  } catch (e) {
    error.value = '优化失败：' + (e && e.message ? e.message : e)
  } finally {
    optimizing.value = false
  }
}

const SIZE_PRESETS = [
  { label: '头像 1:1', w: 512, h: 512 },
  { label: '封面 2:3', w: 832, h: 1216 },
  { label: '配图 3:2', w: 768, h: 512 },
]
function applySize(p) {
  width.value = p.w
  height.value = p.h
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      prompt.value = props.preset.prompt || ''
      negativePrompt.value = props.preset.negativePrompt || DEFAULT_NEGATIVE
      promptZh.value = props.preset.promptZh || ''
      negativePromptZh.value = ''
      bilingual.value = store.settings.bilingualPrompt !== false
      width.value = props.preset.width || 512
      height.value = props.preset.height || 512
      results.value = []
      selected.value = -1
      error.value = ''
    }
  }
)

function close() {
  if (generating.value) return
  emit('update:modelValue', false)
}

async function onGenerate() {
  if (!activeApi.value) {
    error.value = '还没有可用的绘画接口，请先到「个人中心 → 绘画接口」添加'
    return
  }
  if (!prompt.value.trim()) {
    error.value = '请填写提示词'
    return
  }
  generating.value = true
  error.value = ''
  results.value = []
  selected.value = -1
  progressText.value = isSD.value ? '正在绘制（本地 SD，首次可能要跑模型，请稍候）…' : '正在请求绘画接口…'
  try {
    const list = await generateImage(activeApi.value, {
      prompt: prompt.value,
      negativePrompt: negativePrompt.value,
      width: width.value,
      height: height.value,
      count: count.value,
      steps: steps.value,
      cfgScale: cfgScale.value,
    })
    results.value = list
    selected.value = 0
  } catch (e) {
    error.value = e && e.message ? e.message : '生成失败'
  } finally {
    generating.value = false
    progressText.value = ''
  }
}

function onUse() {
  if (selected.value < 0 || !results.value[selected.value]) return
  emit('use', { dataUrl: results.value[selected.value], prompt: prompt.value.trim() })
  emit('update:modelValue', false)
}

function goConfig() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close"></div>

      <div class="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100 overflow-hidden">
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <span class="font-semibold text-sm">✨ {{ preset.title || '生成图片' }}</span>
          <button @click="close" class="text-neutral-400 hover:text-neutral-200 text-lg leading-none" :class="{ 'opacity-30 pointer-events-none': generating }">✕</button>
        </div>

        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <!-- 接口状态 -->
          <div class="flex items-center gap-2 text-xs">
            <span v-if="activeApi" class="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
              接口：{{ activeApi.name || activeApi.type }}
            </span>
            <span v-else class="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400">
              未配置绘画接口
            </span>
          </div>

          <!-- 提示词 -->
          <div>
            <div class="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
              <label class="text-xs font-bold text-pink-500">提示词 *</label>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  @click="toggleBilingual"
                  :class="['flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition',
                    bilingual ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'border-neutral-300 dark:border-neutral-700 text-neutral-400']"
                  :title="bilingual ? '当前：左英文（喂绘画接口）+ 右中文对照；点击关闭' : '当前只显示英文；点击开启中英对照'"
                ><span>中英对照</span><span :class="['w-6 h-3 rounded-full relative inline-block', bilingual ? 'bg-emerald-500' : 'bg-neutral-400']"><span :class="['absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all', bilingual ? 'left-3' : 'left-0.5']"></span></span></button>
                <select
                  v-model="optimizerModel"
                  class="max-w-[190px] px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-[11px] focus:outline-none"
                  title="选择用于优化提示词的 LLM 模型"
                >
                  <option v-if="!optimizerModels.length" value="">未配置 LLM 接口</option>
                  <option v-for="opt in optimizerModels" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <button
                  type="button"
                  @click="optimizePrompt"
                  :disabled="optimizing || !optimizerModel"
                  class="px-2.5 py-1 rounded-lg bg-indigo-500 text-white text-[11px] font-medium hover:bg-indigo-400 disabled:opacity-40 transition shrink-0"
                  title="用所选 LLM 模型把提示词优化成标准 SD 英文标签（同时优化负面提示词）"
                >{{ optimizing ? '优化中…' : '✨ 优化' }}</button>
              </div>
            </div>
            <div :class="bilingual && promptZh ? 'grid grid-cols-2 gap-2' : ''">
              <textarea
                v-model="prompt"
                rows="4"
                placeholder="描述想生成的画面，例如：1girl, silver hair, library, night…"
                class="w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40 resize-y"
              ></textarea>
              <div
                v-if="bilingual && promptZh"
                class="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 overflow-y-auto max-h-32"
              >
                <div class="text-[10px] text-emerald-400/80 mb-1">中文对照（参考，喂给绘画接口的是左侧英文）</div>
                <div class="text-xs whitespace-pre-wrap leading-relaxed">{{ promptZh }}</div>
              </div>
            </div>
          </div>

          <!-- 负面提示词 -->
          <div>
            <label class="text-xs font-bold text-pink-500 mb-1.5 block">负面提示词</label>
            <div :class="bilingual && negativePromptZh ? 'grid grid-cols-2 gap-2' : ''">
              <textarea
                v-model="negativePrompt"
                rows="2"
                class="w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs focus:outline-none resize-y"
              ></textarea>
              <div
                v-if="bilingual && negativePromptZh"
                class="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 overflow-y-auto max-h-24"
              >
                <div class="text-[10px] text-emerald-400/80 mb-1">中文对照（参考）</div>
                <div class="text-xs whitespace-pre-wrap leading-relaxed">{{ negativePromptZh }}</div>
              </div>
            </div>
          </div>

          <!-- 尺寸预设 -->
          <div>
            <label class="text-xs font-bold text-pink-500 mb-1.5 block">尺寸</label>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-for="p in SIZE_PRESETS"
                :key="p.label"
                @click="applySize(p)"
                :class="['px-2.5 py-1 rounded-lg text-xs border transition',
                  width === p.w && height === p.h
                    ? 'border-pink-400 text-pink-400 bg-pink-500/10'
                    : 'border-neutral-300 dark:border-neutral-700 text-neutral-400 hover:text-neutral-200']"
              >{{ p.label }}</button>
              <span class="text-xs text-neutral-400 font-mono ml-1">{{ width }} × {{ height }}</span>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <input v-model.number="width" type="number" min="256" max="1536" step="64" class="w-20 px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-xs font-mono" />
              <span class="text-neutral-400 text-xs">×</span>
              <input v-model.number="height" type="number" min="256" max="1536" step="64" class="w-20 px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-xs font-mono" />
            </div>
          </div>

          <!-- SD 高级参数 -->
          <div v-if="isSD">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-pink-500 flex items-center gap-1"><span>⚙️</span> 高级参数</span>
              <button
                @click="showAdvanced = !showAdvanced"
                :class="['w-10 h-5 rounded-full transition relative', showAdvanced ? 'bg-pink-500' : 'bg-neutral-300 dark:bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', showAdvanced ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>
            <div v-if="showAdvanced" class="mt-3 space-y-3">
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-neutral-400">步数 Steps</span>
                  <span class="font-mono text-neutral-300">{{ steps }}</span>
                </div>
                <input type="range" min="8" max="60" step="1" v-model.number="steps" class="w-full accent-pink-500" />
              </div>
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-neutral-400">CFG 引导系数</span>
                  <span class="font-mono text-neutral-300">{{ cfgScale }}</span>
                </div>
                <input type="range" min="1" max="20" step="0.5" v-model.number="cfgScale" class="w-full accent-pink-500" />
              </div>
            </div>
          </div>

          <!-- 错误 -->
          <div v-if="error" class="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-400">{{ error }}</div>

          <!-- 结果 -->
          <div v-if="results.length">
            <label class="text-xs font-bold text-pink-500 mb-1.5 block">生成结果（点击选中）</label>
            <div class="grid grid-cols-2 gap-2.5">
              <button
                v-for="(r, i) in results"
                :key="i"
                @click="selected = i"
                :class="['rounded-xl overflow-hidden border-2 transition', selected === i ? 'border-pink-500' : 'border-transparent opacity-80 hover:opacity-100']"
              >
                <img :src="r" class="w-full object-cover" />
              </button>
            </div>
          </div>

          <!-- 生成中 -->
          <div v-if="generating" class="text-center py-6">
            <div class="inline-flex items-center gap-2 text-sm text-neutral-400">
              <span class="w-2 h-2 rounded-full bg-pink-400 animate-pulse"></span>
              {{ progressText }}
            </div>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
          <button
            v-if="!activeApi"
            @click="goConfig"
            class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm"
          >去配置接口</button>
          <button
            @click="onGenerate"
            :disabled="generating || !prompt.trim()"
            class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 text-white text-sm font-medium shadow-lg shadow-pink-500/25 disabled:opacity-40 transition"
          >
            {{ generating ? '生成中…' : results.length ? '重新生成' : '✨ 开始生成' }}
          </button>
          <button
            v-if="results.length && selected >= 0"
            @click="onUse"
            class="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-400 transition"
          >使用此图</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
