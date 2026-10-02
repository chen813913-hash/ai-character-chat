<script setup>
import { reactive, ref } from 'vue'
import { normalizeOpeningContent, normalizeOpeningBlock, isSafeOpeningAssetUrl } from '../utils/openingContent.js'
import { safeRichHtml } from '../utils/storyState.js'

const props = defineProps({
  content: { type: Object, default: () => ({ enabled: true, blocks: [] }) },
  interactive: { type: Boolean, default: true },
})
const emit = defineEmits(['submit-form'])

const formValues = reactive({})
const formErrors = reactive({})
const submitted = ref({})

function resetFormState() {
  Object.keys(formValues).forEach((key) => delete formValues[key])
  Object.keys(formErrors).forEach((key) => delete formErrors[key])
  submitted.value = {}
}

function blockKey(block) {
  return String(block && block.id || '')
}
function fieldKey(block, field) {
  return blockKey(block) + ':' + String(field && field.id || '')
}
function getValue(block, field) {
  const key = fieldKey(block, field)
  if (formValues[key] !== undefined) return formValues[key]
  if (field.type === 'checkbox') return Array.isArray(field.defaultValue) ? field.defaultValue : []
  return field.defaultValue == null ? '' : field.defaultValue
}
function setValue(block, field, value) {
  formValues[fieldKey(block, field)] = value
  delete formErrors[fieldKey(block, field)]
}
function toggleCheckbox(block, field, option, checked) {
  const current = Array.isArray(getValue(block, field)) ? [...getValue(block, field)] : []
  const index = current.indexOf(option.value)
  if (checked && index < 0) current.push(option.value)
  if (!checked && index >= 0) current.splice(index, 1)
  setValue(block, field, current)
}
function isChecked(block, field, option) {
  return Array.isArray(getValue(block, field)) && getValue(block, field).includes(option.value)
}
function submitForm(block) {
  const item = normalizeOpeningBlock(block)
  const values = {}
  let valid = true
  item.settings.fields.forEach((field) => {
    const value = getValue(item, field)
    values[field.id] = value
    const empty = Array.isArray(value) ? value.length === 0 : String(value == null ? '' : value).trim() === ''
    if (field.required && empty) {
      formErrors[fieldKey(item, field)] = '请填写此项'
      valid = false
    }
  })
  if (!valid) return
  submitted.value = { ...submitted.value, [blockKey(item)]: true }
  const lines = item.settings.fields.map((field) => {
    const value = values[field.id]
    const shown = Array.isArray(value) ? value.join('、') : String(value == null ? '' : value)
    return `${field.label}：${shown || '未填写'}`
  })
  emit('submit-form', { block: item, values, text: lines.join('\n') })
}
function displayVideo(block) {
  return isSafeOpeningAssetUrl(block.content, 'video')
}
function displayImage(block) {
  return isSafeOpeningAssetUrl(block.content, 'image')
}
</script>

<template>
  <div v-if="content && content.enabled !== false" class="space-y-3">
    <div
      v-for="rawBlock in normalizeOpeningContent(content).blocks"
      :key="rawBlock.id"
      class="rounded-xl border border-indigo-400/25 bg-white/70 dark:bg-neutral-900/35 overflow-hidden"
    >
      <div v-if="rawBlock.title" class="px-3 pt-2.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
        {{ rawBlock.title }}
      </div>

      <div v-if="rawBlock.type === 'text'" class="px-3 py-3 whitespace-pre-wrap break-words text-sm leading-7">
        {{ rawBlock.content || '（空文字块）' }}
      </div>

      <div v-else-if="rawBlock.type === 'html'" class="px-3 py-3 text-sm overflow-x-auto" v-html="safeRichHtml(rawBlock.content)"></div>

      <div v-else-if="rawBlock.type === 'image'" class="p-3">
        <img
          v-if="displayImage(rawBlock)"
          :src="rawBlock.content"
          :alt="rawBlock.settings.alt || rawBlock.title || '开场图片'"
          :class="['max-h-80 w-full rounded-lg', rawBlock.settings.fit === 'cover' ? 'object-cover' : 'object-contain']"
        />
        <p v-else class="text-xs text-neutral-400">图片地址为空或不安全</p>
      </div>

      <div v-else-if="rawBlock.type === 'video'" class="p-3">
        <video
          v-if="displayVideo(rawBlock)"
          :src="rawBlock.content"
          :poster="rawBlock.settings.poster || undefined"
          :autoplay="interactive && rawBlock.settings.autoplay"
          :controls="rawBlock.settings.controls"
          :loop="rawBlock.settings.loop"
          playsinline
          class="w-full max-h-80 rounded-lg bg-black"
        ></video>
        <p v-else class="text-xs text-neutral-400">视频地址为空或不安全</p>
      </div>

      <div v-else-if="rawBlock.type === 'form'" class="p-3 space-y-3">
        <p v-if="!rawBlock.settings.fields.length" class="text-xs text-neutral-400">还没有添加表单字段</p>
        <div v-for="field in rawBlock.settings.fields" :key="field.id" class="space-y-1.5">
          <label class="block text-sm font-medium">
            {{ field.label }} <span v-if="field.required" class="text-red-500">*</span>
          </label>
          <p v-if="field.description" class="text-xs text-neutral-500">{{ field.description }}</p>

          <div v-if="field.type === 'radio' || field.type === 'checkbox'" class="space-y-1.5">
            <label v-for="option in field.options" :key="option.value" class="flex items-center gap-2 text-sm">
              <input
                v-if="field.type === 'radio'"
                type="radio"
                :name="fieldKey(rawBlock, field)"
                :value="option.value"
                :checked="getValue(rawBlock, field) === option.value"
                :disabled="!interactive || submitted[blockKey(rawBlock)]"
                @change="setValue(rawBlock, field, option.value)"
              />
              <input
                v-else
                type="checkbox"
                :checked="isChecked(rawBlock, field, option)"
                :disabled="!interactive || submitted[blockKey(rawBlock)]"
                @change="toggleCheckbox(rawBlock, field, option, $event.target.checked)"
              />
              <span>{{ option.label }}</span>
            </label>
            <p v-if="!field.options.length" class="text-xs text-neutral-400">还没有设置选项</p>
          </div>

          <input
            v-else
            :type="field.type"
            :value="getValue(rawBlock, field)"
            :placeholder="field.placeholder"
            :disabled="!interactive || submitted[blockKey(rawBlock)]"
            class="w-full px-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm"
            @input="setValue(rawBlock, field, field.type === 'number' ? $event.target.value : $event.target.value)"
          />
          <p v-if="formErrors[fieldKey(rawBlock, field)]" class="text-xs text-red-500">{{ formErrors[fieldKey(rawBlock, field)] }}</p>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button
            type="button"
            :disabled="!interactive || submitted[blockKey(rawBlock)]"
            class="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs disabled:opacity-50"
            @click="submitForm(rawBlock)"
          >
            {{ submitted[blockKey(rawBlock)] ? '已提交' : (rawBlock.settings.submitLabel || '提交') }}
          </button>
          <span v-if="!interactive" class="text-xs text-neutral-400">预览模式</span>
        </div>
      </div>
    </div>
  </div>
</template>
