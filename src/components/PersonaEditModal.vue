<script setup>
import { ref, computed, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import { store, genId, addPersona, updatePersona } from '../store/useDataStore.js'
import { pickImageAsDataURL } from '../utils/io.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  persona: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const form = ref({})
const saving = ref(false)
const error = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.persona) return
    form.value = JSON.parse(JSON.stringify(props.persona))
    error.value = ''
  }
)

// AI 生成头像
import { buildPersonaImagePrompt, buildPersonaImagePromptZh } from '../utils/imageGen.js'
import ImageGenModal from './ImageGenModal.vue'
const showGen = ref(false)
const genPreset = computed(() => ({
  title: '生成马甲头像',
  prompt: buildPersonaImagePrompt(form.value),
  promptZh: buildPersonaImagePromptZh(form.value),
  width: 512,
  height: 512,
}))
async function onUseGen(res) {
  form.value.avatar = res.dataUrl
}

// 头像：从本地选择图片转 base64（不上传服务器）
async function onPickAvatar() {
  try {
    form.value.avatar = await pickImageAsDataURL()
  } catch (e) {
    // 用户取消，忽略
  }
}

// 保存：新增或更新，写入 IndexedDB
async function onSave() {
  const name = (form.value.name || '').trim()
  if (!name) {
    error.value = '请填写马甲名称'
    return
  }
  error.value = ''
  saving.value = true

  const isNew = !store.personas.some((p) => p.id === form.value.id)
  const now = Date.now()
  const payload = {
    ...form.value,
    name,
    createTime: form.value.createTime || now,
    updateTime: now,
  }

  try {
    if (isNew) await addPersona(payload)
    else await updatePersona(payload)
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
    :title="persona && store.personas.some(p => p.id === persona.id) ? '编辑马甲' : '新建马甲'"
    max-width="max-w-lg"
  >
    <div class="space-y-4">
      <p v-if="error" class="px-3 py-2 rounded-lg bg-red-500 text-white text-sm">{{ error }}</p>

      <div>
        <label class="block text-sm font-medium mb-1">马甲名称 *</label>
        <input v-model="form.name" type="text" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">头像</label>
        <div class="flex gap-2">
          <input v-model="form.avatar" type="text" placeholder="图片 URL，或用右侧按钮从本地选择" class="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="button" @click="showGen = true" class="px-3 py-2 rounded-lg bg-pink-500 text-white text-sm hover:bg-pink-400 transition shrink-0">✨ 生成</button>
          <button type="button" @click="onPickAvatar" class="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-sm whitespace-nowrap hover:bg-neutral-100 dark:hover:bg-neutral-700">
            上传本地图片
          </button>
        </div>
        <img v-if="form.avatar" :src="form.avatar" alt="预览" class="mt-2 w-16 h-16 rounded-lg object-cover border border-neutral-300 dark:border-neutral-600" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">人设文本</label>
        <textarea v-model="form.persona_text" rows="5" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">备注</label>
        <textarea v-model="form.notes" rows="2" class="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
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
  <ImageGenModal v-model="showGen" :preset="genPreset" @use="onUseGen" />
</template>
