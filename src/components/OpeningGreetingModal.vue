<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import OpeningContentRenderer from './OpeningContentRenderer.vue'
import { safeRichHtml } from '../utils/storyState.js'
import { hasOpeningContent, normalizeOpeningContent } from '../utils/openingContent.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  character: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'select'])

const selectedId = ref('')
const remember = ref(false)
const randomize = ref(false)

function normalizeOpening(raw, index, isDefault = false) {
  if (typeof raw === 'string') {
    return {
      id: isDefault ? 'default' : 'alternate-' + index,
      title: isDefault ? '默认开场白' : '开场白 ' + (index + 1),
      summary: raw.replace(/\s+/g, ' ').slice(0, 80),
      content: raw,
      type: 'text',
      isDefault,
    }
  }
  const content = String(raw && (raw.content || raw.text || raw.message) || '').trim()
  return {
    id: String(raw && raw.id || (isDefault ? 'default' : 'alternate-' + index)),
    title: String(raw && (raw.title || raw.name) || (isDefault ? '默认开场白' : '开场白 ' + (index + 1))),
    summary: String(raw && (raw.summary || raw.description) || content.replace(/\s+/g, ' ')).slice(0, 80),
    content,
    type: String(raw && raw.type || 'text'),
    isDefault,
  }
}

const openings = computed(() => {
  const c = props.character
  if (!c) return []
  const list = []
  const rich = normalizeOpeningContent(c.openingContent || c.opening_content)
  if (hasOpeningContent(rich)) {
    // 富内容开场是唯一开场：启用且存在内容块时不再显示传统开场选项
    list.push({
      id: 'rich-opening',
      title: '富内容开场',
      summary: `由 ${rich.blocks.length} 个内容块组成，可包含图片、HTML、视频或表单`,
      content: rich,
      type: 'blocks',
      isRich: true,
    })
    return list
  }
  if (String(c.first_mes || '').trim()) list.push(normalizeOpening(c.first_mes, 0, true))
  const alternates = Array.isArray(c.alternate_greetings) ? c.alternate_greetings : []
  alternates.forEach((item, index) => {
    const opening = normalizeOpening(item, index)
    if (opening.content) list.push(opening)
  })
  return list
})

watch(
  () => [props.modelValue, openings.value.map((x) => x.id).join('|')],
  ([open]) => {
    if (!open) return
    selectedId.value = openings.value[0] ? openings.value[0].id : ''
    remember.value = false
    randomize.value = false
  },
  { immediate: true }
)

const selected = computed(() => openings.value.find((x) => x.id === selectedId.value) || openings.value[0] || null)
function isRichOpening(opening) {
  return opening && (opening.isRich || ['html', 'image'].includes(opening.type))
}
function openingHtml(opening) {
  if (!opening) return ''
  if (opening.type === 'image') {
    const url = String(opening.content || '')
    if (!/^(https?:|data:image\/|blob:)/i.test(url)) return '<p>图片地址不安全或为空</p>'
    return `<img src="${url.replace(/"/g, '&quot;')}" alt="开场图片" class="max-h-48 w-full object-contain rounded-lg" />`
  }
  return safeRichHtml(opening.content)
}
function close() {
  emit('update:modelValue', false)
}
function chooseRandom() {
  if (openings.value.length < 2) return
  const candidates = openings.value.filter((x) => x.id !== selectedId.value)
  const list = candidates.length ? candidates : openings.value
  selectedId.value = list[Math.floor(Math.random() * list.length)].id
  randomize.value = true
}
function confirm() {
  const item = randomize.value ? (selected.value || openings.value[0]) : selected.value
  if (!item) return
  emit('select', { ...item, remember: remember.value })
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal :model-value="modelValue" title="选择开场剧情" max-width="max-w-3xl" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="openings.length" class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium">和 {{ character && (character.displayName || character.name) }} 从哪里开始？</p>
          <p class="text-xs text-neutral-500 mt-1">可以选择传统文字开场，也可以选择角色编辑中自行组合的富内容开场。</p>
        </div>
        <button
          v-if="openings.length > 1"
          type="button"
          @click="chooseRandom"
          class="shrink-0 px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-xs text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
        >随机选择</button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          v-for="opening in openings"
          :key="opening.id"
          type="button"
          @click="selectedId = opening.id; randomize = false"
          :class="[
            'text-left rounded-xl border p-3 transition min-h-[128px]',
            selectedId === opening.id
              ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/20'
              : 'border-neutral-200 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-700',
          ]"
        >
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center text-xs">{{ opening.isRich ? '富' : (opening.isDefault ? '首' : '剧') }}</span>
            <span class="font-medium text-sm truncate">{{ opening.title }}</span>
            <span v-if="opening.type !== 'text'" class="ml-auto text-[10px] text-neutral-400">{{ opening.type === 'blocks' ? '组合' : opening.type }}</span>
          </div>
          <p class="mt-2 text-xs text-neutral-500 line-clamp-2">{{ opening.summary || '未填写摘要' }}</p>
          <div v-if="opening.isRich" class="mt-2 rounded-lg bg-black/10 dark:bg-black/20 p-2 max-h-56 overflow-hidden pointer-events-none">
            <OpeningContentRenderer :content="opening.content" :interactive="false" />
          </div>
          <div v-else-if="isRichOpening(opening)" class="mt-2 rounded-lg bg-black/10 dark:bg-black/20 p-2 max-h-48 overflow-hidden" v-html="openingHtml(opening)"></div>
          <p v-else class="mt-2 text-[11px] text-neutral-400 whitespace-pre-wrap line-clamp-3">{{ opening.content }}</p>
        </button>
      </div>

      <label class="flex items-center gap-2 text-xs text-neutral-500">
        <input v-model="remember" type="checkbox" />记住这次选择，下次新建会话直接使用
      </label>
    </div>
    <div v-else class="py-10 text-center text-sm text-neutral-500">
      当前角色还没有开场白，请先在角色编辑中填写默认开场白或打开富内容开场。
    </div>

    <template #footer>
      <button type="button" @click="close" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm">取消</button>
      <button type="button" @click="confirm" :disabled="!selected" class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm disabled:opacity-40">使用此开场</button>
    </template>
  </BaseModal>
</template>
