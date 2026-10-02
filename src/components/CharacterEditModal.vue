<script setup>
import { ref, computed, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import { store, addCharacter, updateCharacter } from '../store/useDataStore.js'
import {
  pickImageAsDataURL,
  imageFileToDataURL,
  pickJsonFile,
  downloadJson,
} from '../utils/io.js'
import OpeningContentEditor from './OpeningContentEditor.vue'
import OpeningContentRenderer from './OpeningContentRenderer.vue'
import { normalizeOpeningContent, openingContentFromCharacter } from '../utils/openingContent.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  card: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

// 表单本地副本
const form = ref({})
const tags = ref([]) // 标签（最多 3 个）
const tagInput = ref('')
const openingEditorOpen = ref(false)
const openingContent = ref({ enabled: false, blocks: [] })
const entries = ref([]) // 世界书条目（编辑中的副本）
const saving = ref(false)
const error = ref('')
const info = ref('')

// 角色设定大编辑器
const settingEditorOpen = ref(false)
const settingDraft = ref('')

const MAX_TAGS = 3
const MAX_COVERS = 6

// 生成一个空条目（编辑态：keys 用文本便于输入）
function blankEntry() {
  return { keysText: '', content: '', insertionOrder: 100, caseSensitive: false }
}

// 把任意来源的条目规范成编辑态
function toEditEntry(e) {
  return {
    keysText: Array.isArray(e && e.keys)
      ? e.keys.join('、')
      : String((e && e.keysText) || (e && e.keys) || ''),
    content: (e && e.content) || '',
    insertionOrder: Number(e && e.insertionOrder) || 100,
    caseSensitive: !!(e && e.caseSensitive),
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.card) return
    form.value = JSON.parse(JSON.stringify(props.card))
    if (!Array.isArray(form.value.covers)) form.value.covers = []
    if (!Array.isArray(form.value.props)) form.value.props = []
    tags.value = (props.card.tags || []).slice(0, MAX_TAGS)
    tagInput.value = ''
    // 旧角色卡只有 first_mes / alternate_greetings 时自动迁移为富内容文字块
    openingContent.value = openingContentFromCharacter(props.card)
    openingEditorOpen.value = false
    const raw =
      props.card.lorebook && Array.isArray(props.card.lorebook.entries)
        ? props.card.lorebook.entries
        : []
    entries.value = raw.map(toEditEntry)
    settingEditorOpen.value = false
    error.value = ''
    info.value = ''
  }
)

// ---- 角色设定：大编辑器（展开/收起）----
function openSettingEditor() {
  settingDraft.value = form.value.setting || ''
  settingEditorOpen.value = true
}
function saveSettingEditor() {
  form.value.setting = settingDraft.value
  settingEditorOpen.value = false
}
function cancelSettingEditor() {
  settingEditorOpen.value = false
}

// ---- 标签：最多 3 个 ----
function addTag() {
  const v = tagInput.value.trim()
  if (!v) return
  if (tags.value.length >= MAX_TAGS) {
    error.value = `标签最多 ${MAX_TAGS} 个`
    return
  }
  if (!tags.value.includes(v)) tags.value.push(v)
  tagInput.value = ''
  error.value = ''
}
function removeTag(i) {
  tags.value.splice(i, 1)
}

// ---- AI 生成头像 / 封面 ----
import { buildCharacterImagePrompt, buildCharacterImagePromptZh } from '../utils/imageGen.js'
import ImageGenModal from './ImageGenModal.vue'
const showGen = ref(false)
const genTarget = ref('avatar') // avatar | cover
const genPreset = computed(() => ({
  title: genTarget.value === 'avatar' ? '生成头像' : '生成封面',
  prompt: buildCharacterImagePrompt(form.value),
  promptZh: buildCharacterImagePromptZh(form.value),
  width: genTarget.value === 'avatar' ? 512 : 832,
  height: genTarget.value === 'avatar' ? 512 : 1216,
}))
function openGen(target) {
  genTarget.value = target
  showGen.value = true
}
async function onUseGen(res) {
  if (genTarget.value === 'avatar') {
    form.value.avatar = res.dataUrl
  } else {
    if (!Array.isArray(form.value.covers)) form.value.covers = []
    if (form.value.covers.length >= MAX_COVERS) {
      error.value = `封面最多 ${MAX_COVERS} 张`
      return
    }
    form.value.covers.push(res.dataUrl)
  }
}

// ---- 头像 / 封面：点击选择 或 拖拽上传（本地转 base64，不上传服务器）----
async function onPickAvatar() {
  try {
    form.value.avatar = await pickImageAsDataURL()
  } catch (e) {
    // 用户取消选择，忽略
  }
}

async function onDropAvatar(e) {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (!file) return
  try {
    form.value.avatar = await imageFileToDataURL(file)
    error.value = ''
  } catch (err) {
    error.value = err.message
  }
}

async function onPickCover() {
  if ((form.value.covers || []).length >= MAX_COVERS) {
    error.value = `封面最多 ${MAX_COVERS} 张`
    return
  }
  try {
    const url = await pickImageAsDataURL()
    if (!Array.isArray(form.value.covers)) form.value.covers = []
    form.value.covers.push(url)
    error.value = ''
  } catch (e) {
    // 用户取消，忽略
  }
}

async function onDropCover(e) {
  const files = (e.dataTransfer && e.dataTransfer.files) || []
  for (const f of files) {
    if ((form.value.covers || []).length >= MAX_COVERS) {
      error.value = `封面最多 ${MAX_COVERS} 张`
      break
    }
    try {
      if (!Array.isArray(form.value.covers)) form.value.covers = []
      form.value.covers.push(await imageFileToDataURL(f))
    } catch (err) {
      /* 跳过非图片文件 */
    }
  }
}

function removeCover(i) {
  form.value.covers.splice(i, 1)
}

// ---- 道具（实验功能：聊天窗口出现道具按钮）----
function addProp() {
  form.value.props.push({ icon: '🎁', name: '', prompt: '' })
}
function removeProp(i) {
  form.value.props.splice(i, 1)
}

// ---- 世界书条目编辑 ----
function addEntry() {
  entries.value.push(blankEntry())
  info.value = ''
}
function removeEntry(i) {
  entries.value.splice(i, 1)
}

// 世界书：从 JSON 导入（兼容 数组 / {entries:[...]} 两种格式，按内容去重后追加）
async function importLorebook() {
  try {
    const text = await pickJsonFile()
    const data = JSON.parse(text)
    const list = Array.isArray(data)
      ? data
      : data && Array.isArray(data.entries)
        ? data.entries
        : []
    const normalized = list.map(toEditEntry).filter((e) => e.content.trim())
    if (!normalized.length) {
      error.value = '文件中没有可导入的世界书条目'
      return
    }
    const seen = new Set(entries.value.map((e) => e.content.trim()))
    let added = 0
    normalized.forEach((e) => {
      const k = e.content.trim()
      if (!seen.has(k)) {
        entries.value.push(e)
        seen.add(k)
        added++
      }
    })
    error.value = ''
    info.value = `已导入 ${added} 条世界书条目`
  } catch (e) {
    error.value = '导入失败：' + (e && e.message ? e.message : e)
  }
}

// 世界书：导出当前条目为 JSON
function exportLorebook() {
  const list = entries.value
    .filter((e) => (e.content || '').trim())
    .map((e) => ({
      keys: String(e.keysText || '')
        .split(/[、,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      content: e.content,
      insertionOrder: Number(e.insertionOrder) || 100,
      caseSensitive: !!e.caseSensitive,
    }))
  const base = (form.value.displayName || form.value.name || '角色').trim()
  downloadJson(`${base}-世界书.json`, { entries: list })
}

// ---- 保存 ----
async function onSave() {
  const name = (form.value.name || '').trim()
  if (!name) {
    error.value = '请填写角色名称'
    return
  }
  error.value = ''
  saving.value = true

  const isNew = !store.characters.some((c) => c.id === form.value.id)
  const now = Date.now()
  // 开场已统一为富内容：first_mes 兜底为第一个文字块（导出兼容），旧备用开场字段清空
  const richNormalized = normalizeOpeningContent(openingContent.value)
  const firstTextBlock = richNormalized.blocks.find((b) => b.type === 'text' && (b.content || '').trim())
  const payload = {
    ...form.value,
    name,
    // 显示名为空时回退用角色名
    displayName: (form.value.displayName || '').trim(),
    tags: tags.value.slice(0, MAX_TAGS),
    covers: (form.value.covers || []).slice(0, MAX_COVERS),
    appearance: (form.value.appearance || '').trim(),
    first_mes: firstTextBlock ? firstTextBlock.content.trim() : '',
    alternate_greetings: [],
    openingContent: richNormalized,
    // 道具：过滤空行
    props: (form.value.props || [])
      .map((p) => ({
        icon: (p.icon || '').trim(),
        name: (p.name || '').trim(),
        prompt: (p.prompt || '').trim(),
      }))
      .filter((p) => p.name || p.prompt),
    lorebook: {
      entries: entries.value
        .filter((e) => (e.content || '').trim())
        .map((e) => ({
          keys: String(e.keysText || '')
            .split(/[、,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
          content: e.content,
          insertionOrder: Number(e.insertionOrder) || 100,
          caseSensitive: !!e.caseSensitive,
        })),
    },
    createTime: form.value.createTime || now,
    updateTime: now,
  }

  try {
    if (isNew) await addCharacter(payload)
    else await updateCharacter(payload)
    emit('update:modelValue', false)
    emit('saved', payload)
  } catch (e) {
    error.value = '保存失败：' + (e && e.message ? e.message : e)
  } finally {
    saving.value = false
  }
}

function onClose() {
  emit('update:modelValue', false)
}

function onUpdate(v) {
  emit('update:modelValue', v)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    @update:model-value="onUpdate"
    :title="card && store.characters.some(c => c.id === card.id) ? '编辑人物卡' : '新建人物卡'"
    max-width="max-w-2xl"
  >
    <div class="space-y-4">
      <p v-if="error" class="px-3 py-2 rounded-lg bg-red-500 text-white text-sm">{{ error }}</p>
      <p v-if="info" class="px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm">{{ info }}</p>

      <!-- 角色名 / 显示名 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">角色名 *</label>
          <input v-model="form.name" type="text" placeholder="角色在对话中使用的名字" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p class="mt-1 text-xs text-neutral-400">对话与提示词中使用的名字，必填</p>
        </div>
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-sm font-medium">显示名</label>
            <button type="button" @click="form.displayName = form.name" class="text-xs text-indigo-500 hover:underline">
              同角色名
            </button>
          </div>
          <input v-model="form.displayName" type="text" :placeholder="form.name || '同角色名'" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p class="mt-1 text-xs text-neutral-400">角色卡上显示的名字，留空则同角色名</p>
        </div>
      </div>

      <!-- 性别 / 频道 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">性别</label>
          <select v-model="form.gender" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="female">女</option>
            <option value="male">男</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">频道</label>
          <select v-model="form.channel" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="male">男频</option>
            <option value="female">女频</option>
            <option value="world">世界卡</option>
          </select>
          <p class="mt-1 text-xs text-neutral-400">选择角色面向的玩家人群</p>
        </div>
      </div>

      <!-- 角色设定：主设定大编辑器 -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium">角色设定 *</label>
          <button
            type="button"
            @click="settingEditorOpen ? cancelSettingEditor() : openSettingEditor()"
            class="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            {{ settingEditorOpen ? '收起' : '编辑' }}
          </button>
        </div>

        <!-- 展开态：大编辑框 -->
        <template v-if="settingEditorOpen">
          <textarea
            v-model="settingDraft"
            rows="10"
            placeholder="把关于角色的一切写在这里：外貌、经历、说话方式、与世界的关系……"
            class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          ></textarea>
          <div class="flex items-center justify-between mt-2">
            <span class="text-xs text-neutral-400">{{ settingDraft.length }} 字</span>
            <div class="flex gap-2">
              <button type="button" @click="cancelSettingEditor" class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">取消</button>
              <button type="button" @click="saveSettingEditor" class="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600">完成</button>
            </div>
          </div>
          <!-- AI 生成弹窗（头像/封面共用） -->
</template>

        <!-- 收起态：预览 -->
        <div
          v-else
          @click="openSettingEditor"
          class="cursor-pointer min-h-[56px] px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 hover:border-indigo-400"
        >
          <span v-if="form.setting" class="text-sm whitespace-pre-wrap line-clamp-3">{{ form.setting }}</span>
          <span v-else class="text-sm text-neutral-400">点击编辑</span>
        </div>
        <p class="mt-1 text-xs text-neutral-400">最重要的部分，你可以把关于角色的一切写在这里</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">性格</label>
          <textarea v-model="form.personality" rows="3" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
          <p class="mt-1 text-xs text-neutral-400">如果角色设定中已包含性格设定，这里可以不填</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">对话场景</label>
          <textarea v-model="form.scenario" rows="3" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
          <p class="mt-1 text-xs text-neutral-400">对话发生的情景或前情提要，会在对话中显示</p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">增强设定</label>
        <textarea v-model="form.post_history_instructions" rows="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        <p class="mt-1 text-xs text-neutral-400">⚠️ 权重最高的提示词，会追加到对话消息最末尾。非必需，慎用。</p>
      </div>

      <!-- 富内容开场：开关 → 预览 → 编辑 → 添加内容（唯一的开场编辑入口） -->
      <div class="rounded-2xl border border-indigo-400/30 bg-indigo-50/40 dark:bg-indigo-950/15 p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <label class="text-sm font-medium">富内容开场</label>
            <p class="text-xs text-neutral-500 mt-1">可自行组合文字、视频、嵌入 HTML、图片和开场表单；默认不添加任何内容。</p>
          </div>
          <label class="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <span class="text-xs text-neutral-500">{{ openingContent.enabled ? '已开启' : '已关闭' }}</span>
            <input v-model="openingContent.enabled" type="checkbox" class="sr-only peer" />
            <span class="relative w-11 h-6 rounded-full bg-neutral-300 dark:bg-neutral-700 peer-checked:bg-indigo-500 transition after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"></span>
          </label>
        </div>

        <div v-if="openingContent.enabled" class="mt-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/30 overflow-hidden">
          <div v-if="openingContent.blocks.length" class="p-3 max-h-72 overflow-y-auto">
            <OpeningContentRenderer :content="openingContent" :interactive="false" />
          </div>
          <div v-else class="py-8 text-center text-sm text-neutral-500">
            <div class="text-2xl mb-1">＋</div>
            还没有添加内容
            <p class="text-xs mt-1">点击“编辑”后，再从添加内容中选择需要的模式</p>
          </div>
          <div class="flex justify-end px-3 py-2 border-t border-neutral-200 dark:border-neutral-700">
            <button type="button" class="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-sm" @click="openingEditorOpen = true">{{ openingContent.blocks.length ? '编辑' : '开始编辑' }}</button>
          </div>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">角色简介</label>
        <input v-model="form.description" type="text" placeholder="填写角色简介，内容会显示在角色卡上" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">对话示例</label>
        <textarea v-model="form.mes_example" rows="3" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">系统提示词</label>
        <textarea v-model="form.system_prompt" rows="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">作者备注</label>
        <textarea v-model="form.creator_notes" rows="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      </div>

      <!-- 外貌（AI 绘画提示词的优先来源） -->
      <div>
        <label class="block text-sm font-medium mb-1">外貌 <span class="text-xs text-neutral-400">（AI 生成头像/封面时会优先使用）</span></label>
        <textarea
          v-model="form.appearance"
          rows="2"
          placeholder="例如：银色长发，红色瞳孔，白色连衣裙，身材娇小"
          class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
        ></textarea>
      </div>

      <!-- 封面图集：最多 6 张，支持点击 / 拖拽 -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium">封面图集 *</label>
          <span class="text-xs text-neutral-400">{{ (form.covers || []).length }}/{{ MAX_COVERS }}</span>
        </div>
        <div
          @dragover.prevent
          @drop.prevent="onDropCover"
          class="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-3"
        >
          <div class="flex gap-2">
            <button type="button" @click="onPickCover" :disabled="(form.covers || []).length >= MAX_COVERS" class="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50">
              上传封面
            </button>
            <button type="button" @click="openGen('cover')" class="px-3 py-2 rounded-lg bg-pink-500 text-white text-sm hover:bg-pink-400 transition">
              ✨ 生成封面
            </button>
            <span class="self-center text-xs text-neutral-400">点击或拖拽上传图片 · 最多 {{ MAX_COVERS }} 张，第一张作卡片封面</span>
          </div>
          <div v-if="(form.covers || []).length" class="grid grid-cols-4 gap-2 mt-2">
            <div v-for="(c, i) in form.covers" :key="i" class="relative group">
              <img :src="c" alt="封面" class="w-full aspect-[3/4] object-cover rounded-lg border border-neutral-300 dark:border-neutral-600" />
              <button type="button" @click="removeCover(i)" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100">
                ×
              </button>
            </div>
          </div>
          <p v-else class="mt-1 text-xs text-neutral-400">还没有封面，可留空</p>
        </div>
      </div>

      <!-- 头像：点击 / 拖拽 -->
      <div>
        <label class="block text-sm font-medium mb-1">头像</label>
        <div
          @dragover.prevent
          @drop.prevent="onDropAvatar"
          class="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-3"
        >
          <div class="flex gap-2 items-center">
            <div class="w-16 h-16 rounded-lg overflow-hidden bg-neutral-200 dark:bg-neutral-700 shrink-0">
              <img v-if="form.avatar" :src="form.avatar" alt="预览" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-neutral-400 text-xs">无</div>
            </div>
            <div class="flex-1">
              <button type="button" @click="onPickAvatar" class="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">
                上传头像
              </button>
              <button type="button" @click="openGen('avatar')" class="px-3 py-2 rounded-lg bg-pink-500 text-white text-sm hover:bg-pink-400 transition">
                ✨ 生成头像
              </button>
              <p class="mt-1 text-xs text-neutral-400">点击或拖拽上传图片，也可直接粘贴图片 URL</p>
            </div>
          </div>
          <input v-model="form.avatar" type="text" placeholder="图片 URL（可选）" class="w-full mt-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      <!-- 世界书 -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium">世界书</label>
          <div class="flex gap-2">
            <button type="button" @click="importLorebook" class="px-3 py-1 text-xs rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700">
              导入
            </button>
            <button type="button" @click="addEntry" class="px-3 py-1 text-xs rounded-lg bg-indigo-500 text-white hover:bg-indigo-600">
              创建
            </button>
            <button
              v-if="entries.length"
              type="button"
              @click="exportLorebook"
              class="px-3 py-1 text-xs rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              导出
            </button>
          </div>
        </div>
        <p class="text-xs text-neutral-400 mb-2">把世界观和背景设定写成条目，触发时会自动进入上下文</p>

        <!-- 空状态引导 -->
        <div v-if="!entries.length" class="text-center py-6 rounded-xl bg-neutral-100 dark:bg-neutral-700/50">
          <div class="text-3xl mb-2">📖</div>
          <p class="font-medium">还没有世界书条目</p>
          <div class="flex flex-col items-center gap-2 mt-3">
            <button type="button" @click="addEntry" class="px-4 py-1.5 text-sm rounded-lg bg-indigo-500 text-white hover:bg-indigo-600">
              ＋ 创建第一个条目
            </button>
            <button type="button" @click="importLorebook" class="px-4 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700">
              从 JSON 导入
            </button>
          </div>
        </div>

        <!-- 条目列表 -->
        <template v-else>
          <div v-for="(e, i) in entries" :key="i" class="mb-3 p-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 space-y-2">
            <div class="flex gap-2">
              <input v-model="e.keysText" placeholder="触发关键词，用 、 分隔" class="flex-1 px-2 py-1 text-sm rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              <input v-model.number="e.insertionOrder" type="number" placeholder="order" title="插入顺序，数字小的先插入" class="w-20 px-2 py-1 text-sm rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              <button type="button" @click="removeEntry(i)" class="px-2 py-1 text-xs rounded border border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
                删除
              </button>
            </div>
            <textarea v-model="e.content" rows="2" placeholder="命中后注入的内容" class="w-full px-2 py-1 text-sm rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"></textarea>
            <label class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <input v-model="e.caseSensitive" type="checkbox" />
              区分大小写
            </label>
          </div>
        </template>
      </div>

      <!-- 状态栏 -->
      <div>
        <label class="block text-sm font-medium mb-1">状态栏</label>
        <textarea v-model="form.status_bar" rows="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        <p class="mt-1 text-xs text-neutral-400">如果角色设定中已有状态栏格式，这里不用重复设置</p>
      </div>

      <!-- 道具（实验功能）-->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium">道具</label>
          <button type="button" @click="addProp" class="px-3 py-1 text-xs rounded-lg bg-indigo-500 text-white hover:bg-indigo-600">
            + 添加道具
          </button>
        </div>
        <p class="text-xs text-neutral-400 mb-2">🧪 实验功能：设置后，聊天窗口会出现道具按钮</p>

        <p v-if="!(form.props || []).length" class="text-xs text-neutral-400">还没有道具</p>

        <div v-for="(p, i) in form.props" :key="i" class="mb-3 p-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 space-y-2">
          <div class="flex gap-2">
            <input v-model="p.icon" placeholder="图标" class="w-14 px-2 py-1 text-sm text-center rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <input v-model="p.name" placeholder="道具名称" class="flex-1 px-2 py-1 text-sm rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <button type="button" @click="removeProp(i)" class="px-2 py-1 text-xs rounded border border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
              删除
            </button>
          </div>
          <textarea v-model="p.prompt" rows="2" placeholder="使用道具时填入输入框的内容（提示词）" class="w-full px-2 py-1 text-sm rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"></textarea>
        </div>
      </div>

      <!-- 标签：最多 3 个 -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium">标签</label>
          <span class="text-xs text-neutral-400">{{ tags.length }}/{{ MAX_TAGS }}</span>
        </div>
        <div class="flex gap-2">
          <input
            v-model="tagInput"
            type="text"
            :disabled="tags.length >= MAX_TAGS"
            :placeholder="tags.length >= MAX_TAGS ? '已达上限' : '输入标签后回车添加'"
            @keydown.enter.prevent="addTag"
            class="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />
          <button
            type="button"
            @click="addTag"
            :disabled="tags.length >= MAX_TAGS"
            class="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50"
          >
            添加
          </button>
        </div>
        <div v-if="tags.length" class="flex flex-wrap gap-1.5 mt-2">
          <span
            v-for="(t, i) in tags"
            :key="t"
            class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300"
          >
            {{ t }}
            <button type="button" @click="removeTag(i)" class="hover:text-red-500">×</button>
          </span>
        </div>
        <p v-else class="mt-1 text-xs text-neutral-400">没有标签…</p>
      </div>
    </div>

    <template #footer>
      <button @click="onClose" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">取消</button>
      <button
        @click="onSave"
        :disabled="saving"
        class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 disabled:opacity-60"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseModal>
<!-- AI 生成弹窗（头像/封面共用） -->
  <ImageGenModal v-model="showGen" :preset="genPreset" @use="onUseGen" />
  <OpeningContentEditor
    v-model="openingEditorOpen"
    :blocks="openingContent.blocks"
    @save="openingContent.blocks = $event"
  />
</template>
