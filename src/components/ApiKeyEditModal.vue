<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  model: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'save'])

// 本地表单状态（避免直接改 prop）
const form = ref({
  id: '',
  name: '',
  apiBase: '',
  apiKey: '',
  models: [],
})
const newModel = ref('')

watch(
  () => props.model,
  (m) => {
    if (m) {
      form.value = {
        id: m.id || '',
        name: m.name || '',
        apiBase: m.apiBase || '',
        apiKey: m.apiKey || '',
        models: Array.isArray(m.models) ? [...m.models] : [],
      }
      newModel.value = ''
    }
  },
  { immediate: true }
)

const isEdit = computed(() => !!form.value.id)

function close() {
  emit('update:modelValue', false)
}

function addModel() {
  const v = newModel.value.trim()
  if (!v) return
  if (form.value.models.includes(v)) return
  form.value.models.push(v)
  newModel.value = ''
}
function removeModel(idx) {
  form.value.models.splice(idx, 1)
}

function onSave() {
  if (!form.value.name.trim()) {
    alert('请填写名称')
    return
  }
  emit('save', {
    id: form.value.id,
    name: form.value.name.trim(),
    apiBase: form.value.apiBase.trim(),
    apiKey: form.value.apiKey,
    models: form.value.models,
    createdAt: Date.now(),
  })
}
</script>

<template>
  <div
    v-if="modelValue && model"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close"></div>

    <div class="relative w-full max-w-md bg-neutral-900 text-neutral-100 rounded-2xl border border-neutral-700 shadow-2xl p-5">
      <!-- 头部 -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold">{{ isEdit ? '编辑' : '新增' }}</h3>
        <button
          @click="close"
          class="w-7 h-7 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center text-lg leading-none"
        >×</button>
      </div>

      <!-- 名称 -->
      <div class="mb-3">
        <label class="text-xs text-neutral-400 mb-1 block">名称</label>
        <input
          v-model="form.name"
          type="text"
          placeholder="例如：gemini-3-flash-preview"
          class="w-full px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 text-sm"
        />
      </div>

      <!-- API Key -->
      <div class="mb-3">
        <label class="text-xs text-neutral-400 mb-1 block">API Key</label>
        <input
          v-model="form.apiKey"
          type="password"
          placeholder="sk-..."
          class="w-full px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 text-sm font-mono"
        />
      </div>

      <!-- API 网址 -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-neutral-400">API 网址</label>
          <a
            href="https://platform.openai.com/docs/api-reference"
            target="_blank"
            class="text-[11px] text-neutral-500 hover:text-pink-400 flex items-center gap-1"
          >
            查看帮助
            <span class="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px] leading-none">ⓘ</span>
          </a>
        </div>
        <input
          v-model="form.apiBase"
          type="text"
          placeholder="https://api.example.com/v1  或  /proxy/v1"
          class="w-full px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 text-sm font-mono"
        />
        <!-- 本地 LLM 跨域提示 -->
        <div class="mt-1.5 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed">
          <div class="font-medium mb-0.5">💡 本地 LLM（FreeToken / Ollama / LM Studio 等）</div>
          <div>若浏览器报 CORS 跨域错，把 API 网址改成 <code class="px-1 rounded bg-black/30 text-amber-200">/proxy/v1</code>，让 Vite 自动转发到你的本地服务（仅 dev 模式有效）。</div>
        </div>
      </div>

      <!-- 支持的模型 -->
      <div class="mb-4">
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-neutral-400">支持的模型</label>
          <span class="text-[11px] text-neutral-500">填写完整的模型名称</span>
        </div>
        <div class="flex gap-2 mb-2">
          <input
            v-model="newModel"
            type="text"
            placeholder="输入模型名称，如 gemini-2.5-pro"
            @keydown.enter.prevent="addModel"
            class="flex-1 px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 text-sm"
          />
          <button
            @click="addModel"
            class="w-9 h-9 rounded-md bg-neutral-800 border border-neutral-700 hover:border-pink-500 hover:text-pink-400 text-neutral-400 flex items-center justify-center transition text-lg leading-none"
            title="添加"
          >+</button>
        </div>
        <!-- 已有模型 chip 列表 -->
        <div v-if="form.models.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="(m, i) in form.models"
            :key="i"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-xs"
          >
            <span class="truncate max-w-[200px]" :title="m">{{ m }}</span>
            <button
              @click="removeModel(i)"
              class="text-neutral-500 hover:text-red-400 transition leading-none"
              title="删除"
            >×</button>
          </span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
        <button
          @click="close"
          class="px-4 py-2 rounded-md text-sm text-neutral-300 hover:bg-neutral-800 transition"
        >取消</button>
        <button
          @click="onSave"
          class="px-4 py-2 rounded-md text-sm font-medium text-white bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-400 hover:to-pink-300 shadow shadow-pink-500/30 transition"
        >保存</button>
      </div>
    </div>
  </div>
</template>