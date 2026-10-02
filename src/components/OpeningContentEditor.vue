<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import {
  OPENING_BLOCK_LABELS,
  OPENING_BLOCK_TYPES,
  createOpeningBlock,
  normalizeFormField,
  normalizeOpeningBlock,
  openingBlockSummary,
} from '../utils/openingContent.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  blocks: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'save'])

const draft = ref([])
const editingIndex = ref(-1)
const showAddMenu = ref(false)
const activeType = ref('text')

const modeDescriptions = {
  text: '添加一段文字或剧情旁白',
  video: '插入网络视频或本地视频地址',
  html: '制作自定义的状态栏或界面',
  image: '插入网络图片或本地图片',
  form: '让用户先做选择再开始剧情',
}

const editingBlock = computed(() => editingIndex.value >= 0 ? draft.value[editingIndex.value] : null)

watch(
  () => props.modelValue,
  (open) => {
    if (open) openEditor()
  }
)

function cloneBlocks(list) {
  return (Array.isArray(list) ? list : []).map((item, index) => normalizeOpeningBlock(JSON.parse(JSON.stringify(item)), index))
}
function openEditor() {
  draft.value = cloneBlocks(props.blocks)
  editingIndex.value = -1
  showAddMenu.value = false
}
function close() {
  emit('update:modelValue', false)
}
function saveAndClose() {
  emit('save', cloneBlocks(draft.value))
  emit('update:modelValue', false)
}
function addBlock(type) {
  draft.value.push(createOpeningBlock(type))
  editingIndex.value = draft.value.length - 1
  showAddMenu.value = false
}
function editBlock(index) {
  editingIndex.value = index
  showAddMenu.value = false
}
function removeBlock(index) {
  draft.value.splice(index, 1)
  if (editingIndex.value === index) editingIndex.value = -1
  else if (editingIndex.value > index) editingIndex.value -= 1
}
function moveBlock(index, direction) {
  const target = index + direction
  if (target < 0 || target >= draft.value.length) return
  const list = draft.value
  const temp = list[index]
  list[index] = list[target]
  list[target] = temp
  if (editingIndex.value === index) editingIndex.value = target
  else if (editingIndex.value === target) editingIndex.value = index
}
function addFormField() {
  if (!editingBlock.value || editingBlock.value.type !== 'form') return
  editingBlock.value.settings.fields.push(normalizeFormField({ label: '新字段', type: 'text' }, editingBlock.value.settings.fields.length))
}
function removeFormField(index) {
  if (!editingBlock.value || editingBlock.value.type !== 'form') return
  editingBlock.value.settings.fields.splice(index, 1)
}
function addOption(field) {
  field.options.push({ label: '新选项', value: '新选项' })
}
function removeOption(field, index) {
  field.options.splice(index, 1)
}
function needsOptions(type) {
  return type === 'radio' || type === 'checkbox'
}
function onFileSelected(event, block) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { block.content = String(reader.result || '') }
  reader.readAsDataURL(file)
  event.target.value = ''
}
function label(type) {
  return OPENING_BLOCK_LABELS[type] || type
}

// BaseModal 打开时从父组件复制一份草稿，避免取消编辑污染角色表单。
function onModalUpdate(isOpen) {
  if (isOpen) openEditor()
  else close()
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="编辑富内容开场"
    max-width="max-w-4xl"
    @update:model-value="onModalUpdate"
  >
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium">按顺序组合开场界面</p>
          <p class="text-xs text-neutral-500 mt-1">内容块不会默认生成，点击“添加内容”后自行选择需要的模式。</p>
        </div>
        <button type="button" class="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-sm" @click="showAddMenu = !showAddMenu">
          ＋ 添加内容
        </button>
      </div>

      <div v-if="showAddMenu" class="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-xl border border-indigo-300/50 bg-indigo-50/60 dark:bg-indigo-950/20">
        <button
          v-for="type in OPENING_BLOCK_TYPES"
          :key="type"
          type="button"
          class="text-left p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-indigo-400 transition"
          @click="addBlock(type)"
        >
          <span class="block text-sm font-medium">{{ label(type) }}</span>
          <span class="block mt-1 text-[11px] leading-4 text-neutral-500">{{ modeDescriptions[type] }}</span>
        </button>
      </div>

      <div v-if="!draft.length" class="py-10 text-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-500">
        <div class="text-3xl mb-2">＋</div>
        <p>还没有内容</p>
        <p class="text-xs mt-1">点击右上角“添加内容”，选择你需要的模式</p>
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
        <div class="space-y-2">
          <div
            v-for="(block, index) in draft"
            :key="block.id"
            :class="['p-3 rounded-xl border transition', editingIndex === index ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/30']"
          >
            <div class="flex items-start gap-2">
              <div class="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center text-xs shrink-0">{{ index + 1 }}</div>
              <button type="button" class="text-left flex-1 min-w-0" @click="editBlock(index)">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm truncate">{{ block.title || label(block.type) }}</span>
                  <span class="text-[10px] text-neutral-400 shrink-0">{{ label(block.type) }}</span>
                </div>
                <p class="mt-1 text-xs text-neutral-500 truncate">{{ openingBlockSummary(block) }}</p>
              </button>
              <div class="flex items-center gap-0.5 shrink-0">
                <button type="button" class="w-6 h-6 text-xs text-neutral-400 hover:text-indigo-500 disabled:opacity-30" :disabled="index === 0" @click="moveBlock(index, -1)">↑</button>
                <button type="button" class="w-6 h-6 text-xs text-neutral-400 hover:text-indigo-500 disabled:opacity-30" :disabled="index === draft.length - 1" @click="moveBlock(index, 1)">↓</button>
                <button type="button" class="w-6 h-6 text-xs text-red-400 hover:text-red-600" @click="removeBlock(index)">×</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="editingBlock" class="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-medium text-sm">编辑{{ label(editingBlock.type) }}</h3>
            <button type="button" class="text-xs text-neutral-400 hover:text-indigo-500" @click="editingIndex = -1">收起</button>
          </div>
          <input v-model="editingBlock.title" placeholder="内容标题" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />

          <template v-if="editingBlock.type === 'text'">
            <textarea v-model="editingBlock.content" rows="8" placeholder="填写文字内容或开场旁白" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm"></textarea>
          </template>

          <template v-else-if="editingBlock.type === 'html'">
            <textarea v-model="editingBlock.content" rows="10" placeholder="填写安全 HTML；脚本和事件属性会被过滤" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm font-mono text-xs"></textarea>
            <p class="text-[11px] text-neutral-400">支持静态界面和状态栏；不要在 HTML 中放脚本，脚本和事件属性会被过滤。</p>
          </template>

          <template v-else-if="editingBlock.type === 'image'">
            <input v-model="editingBlock.content" placeholder="图片 URL 或 data:image..." class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />
            <div class="flex items-center gap-2">
              <label class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800">
                选择本地图片
                <input type="file" accept="image/*" class="hidden" @change="onFileSelected($event, editingBlock)" />
              </label>
              <select v-model="editingBlock.settings.fit" class="px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-xs">
                <option value="contain">完整显示</option>
                <option value="cover">裁剪填充</option>
              </select>
            </div>
            <input v-model="editingBlock.settings.alt" placeholder="图片替代文字（可选）" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />
          </template>

          <template v-else-if="editingBlock.type === 'video'">
            <input v-model="editingBlock.content" placeholder="视频 URL 或 data:video..." class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />
            <input v-model="editingBlock.settings.poster" placeholder="封面图 URL（可选）" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />
            <div class="flex flex-wrap gap-4 text-xs text-neutral-600 dark:text-neutral-300">
              <label class="flex items-center gap-2"><input v-model="editingBlock.settings.controls" type="checkbox" />显示控制条</label>
              <label class="flex items-center gap-2"><input v-model="editingBlock.settings.autoplay" type="checkbox" />自动播放</label>
              <label class="flex items-center gap-2"><input v-model="editingBlock.settings.loop" type="checkbox" />循环播放</label>
            </div>
          </template>

          <template v-else-if="editingBlock.type === 'form'">
            <input v-model="editingBlock.settings.submitLabel" placeholder="提交按钮文字" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm" />
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium">表单字段</span>
              <button type="button" class="px-2 py-1 rounded-lg bg-indigo-500 text-white text-xs" @click="addFormField">＋ 添加字段</button>
            </div>
            <div v-if="!editingBlock.settings.fields.length" class="text-xs text-neutral-400">还没有字段</div>
            <div v-for="(field, fieldIndex) in editingBlock.settings.fields" :key="field.id" class="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 space-y-2">
              <div class="flex items-center gap-2">
                <input v-model="field.label" placeholder="字段名称" class="flex-1 px-2 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm" />
                <select v-model="field.type" class="w-24 px-2 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs">
                  <option value="radio">单选</option>
                  <option value="checkbox">多选</option>
                  <option value="text">文本</option>
                  <option value="number">数字</option>
                </select>
                <button type="button" class="text-xs text-red-400" @click="removeFormField(fieldIndex)">删除</button>
              </div>
              <input v-model="field.description" placeholder="说明（可选）" class="w-full px-2 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs" />
              <input v-model="field.placeholder" placeholder="占位文字（文本/数字）" class="w-full px-2 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs" />
              <label class="flex items-center gap-2 text-xs"><input v-model="field.required" type="checkbox" />必填</label>
              <div v-if="needsOptions(field.type)" class="space-y-1">
                <div class="flex items-center justify-between"><span class="text-xs text-neutral-500">选项</span><button type="button" class="text-xs text-indigo-500" @click="addOption(field)">＋ 添加选项</button></div>
                <div v-for="(option, optionIndex) in field.options" :key="optionIndex" class="flex gap-2">
                  <input v-model="option.label" placeholder="显示文字" class="flex-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs" />
                  <input v-model="option.value" placeholder="提交值" class="flex-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs" />
                  <button type="button" class="text-xs text-red-400" @click="removeOption(field, optionIndex)">×</button>
                </div>
              </div>
            </div>
          </template>
        </div>
        <div v-else class="flex items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-400 p-8">
          请选择左侧内容块进行编辑
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm" @click="close">取消</button>
      <button type="button" class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm" @click="saveAndClose">完成编辑</button>
    </template>
  </BaseModal>
</template>
