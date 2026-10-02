<script setup>
import { ref, computed, watch } from 'vue'
import { store } from '../store/useDataStore.js'
import SmartImage from './SmartImage.vue'

// 破甲预设选择弹窗（对齐微灵：双类型 tab + 我的/公开 + 卡片 + 预览/使用）
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 初始定位的类型 tab
  initType: { type: String, default: 'simple' },
})
const emit = defineEmits(['update:modelValue', 'use'])

const activeType = ref(props.initType || 'simple')
const scope = ref('mine') // mine | public
const previewList = ref([])
const previewTitle = ref('')

// 抽屉每次打开可能带不同 mode，弹窗打开时同步初始 tab
watch(
  () => props.modelValue,
  (open) => {
    if (open) activeType.value = props.initType === 'sillytavern' ? 'sillytavern' : 'simple'
  }
)

function close() {
  emit('update:modelValue', false)
}

const list = computed(() => {
  const all = store.jailbreaks || []
  return all.filter((j) => j.type === activeType.value && (scope.value === 'mine' ? true : !!j.isPublic))
})

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
}

function previewSections(jb) {
  if (jb.type === 'sillytavern') {
    try {
      const o = JSON.parse(jb.stJson || '{}')
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
    { label: '前置提示词', content: jb.systemPrompt || '' },
    { label: '规则提示词', content: jb.rulePrompt || '' },
    { label: '后置提示词', content: jb.postPrompt || '' },
  ].filter((s) => s.content.trim())
  return secs.length ? secs : [{ label: '预设内容', content: '（暂无提示词内容）' }]
}

function onPreview(jb) {
  previewTitle.value = jb.title || '未命名'
  previewList.value = previewSections(jb)
}

function onUse(jb) {
  emit('use', jb)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close"></div>

      <div class="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-hidden text-neutral-800 dark:text-neutral-100">
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <span class="font-bold">破甲预设</span>
          <button @click="close" class="text-sm text-neutral-400 hover:text-neutral-200 transition">关闭</button>
        </div>
        <p class="px-5 py-2 text-[11px] text-neutral-500 border-b border-neutral-100 dark:border-neutral-800/60">
          选中新预设后才会切换。关闭此画面会保留当前预设。
        </p>

        <!-- 类型 tab -->
        <div class="px-5 pt-3">
          <div class="grid grid-cols-2 gap-2">
            <button
              @click="activeType = 'simple'"
              :class="['py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5',
                activeType === 'simple'
                  ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/25'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 hover:text-neutral-200']"
            >
              <span>⚡</span>简易破甲
            </button>
            <button
              @click="activeType = 'sillytavern'"
              :class="['py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5',
                activeType === 'sillytavern'
                  ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/25'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 hover:text-neutral-200']"
            >
              <span>🍶</span>酒馆破甲
            </button>
          </div>
        </div>

        <!-- 我的 / 公开 -->
        <div class="px-5 pt-3">
          <div class="grid grid-cols-2 gap-1 bg-neutral-100 dark:bg-neutral-800/60 rounded-lg p-1">
            <button
              @click="scope = 'mine'"
              :class="['py-1.5 rounded-md text-xs transition', scope === 'mine' ? 'bg-white dark:bg-neutral-700 text-neutral-100 dark:text-white shadow' : 'text-neutral-400']"
            >我的</button>
            <button
              @click="scope = 'public'"
              :class="['py-1.5 rounded-md text-xs transition', scope === 'public' ? 'bg-white dark:bg-neutral-700 text-neutral-100 dark:text-white shadow' : 'text-neutral-400']"
            >公开</button>
          </div>
        </div>

        <!-- 卡片网格 -->
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <div v-if="!list.length" class="text-center text-neutral-500 py-14 text-sm">
            {{ scope === 'public' ? '还没有公开的破甲预设' : '还没有这类破甲预设，可到「个人中心 → 破甲」创建' }}
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              v-for="jb in list"
              :key="jb.id"
              class="rounded-2xl overflow-hidden bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800"
            >
              <!-- 封面 -->
              <div class="aspect-[16/9] bg-gradient-to-br from-indigo-900 via-neutral-800 to-neutral-900 relative">
                <SmartImage v-if="jb.cover" :src="jb.cover" :name="jb.title || '破甲'" class="w-full h-full" />
                <div class="absolute left-3 top-2.5 font-bold text-white drop-shadow">{{ jb.title || '未命名' }}</div>
              </div>
              <!-- 信息 -->
              <div class="p-3">
                <span
                  :class="['inline-block px-2 py-0.5 rounded-md text-[11px] font-medium',
                    jb.type === 'sillytavern' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-300']"
                >{{ jb.type === 'sillytavern' ? '酒馆预设' : '简易预设' }}</span>
                <div class="flex items-center gap-2 mt-2.5">
                  <button
                    @click="onPreview(jb)"
                    class="flex-1 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center justify-center gap-1"
                  >👁 预览</button>
                  <button
                    @click="onUse(jb)"
                    class="flex-1 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-xs font-medium shadow shadow-pink-500/25 transition"
                  >使用</button>
                </div>
                <div class="flex items-center justify-between mt-2 text-[11px] text-neutral-500">
                  <span>@本地创作</span>
                  <span>{{ timeAgo(jb.updateTime || jb.createTime) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 预览浮层 -->
      <div v-if="previewList.length" class="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="previewList = []"></div>
        <div class="relative w-full max-w-xl max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100">
          <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <span class="font-semibold text-sm">预览：{{ previewTitle }}</span>
            <button @click="previewList = []" class="text-neutral-400 hover:text-neutral-200 leading-none">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <pre
              v-for="sec in previewList"
              :key="sec.label"
              class="px-5 py-3 text-sm whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-100 border-b border-neutral-200/70 dark:border-neutral-800/60 last:border-b-0"
            ><span class="block text-[11px] font-semibold text-pink-400 mb-1.5">【{{ sec.label }}】</span>{{ sec.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
