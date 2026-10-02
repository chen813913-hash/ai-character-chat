<script setup>
import { ref, computed } from 'vue'
import { store } from '../store/useDataStore.js'
import SmartImage from './SmartImage.vue'

// 世界书选择弹窗（对齐微灵：我的/公开 tab + 搜索 + 卡片 + 预览/选择）
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  multi: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'pick'])

const scope = ref('mine') // mine | public
const keyword = ref('')
const previewTitle = ref('')
const previewList = ref([])

function close() {
  emit('update:modelValue', false)
}

const list = computed(() => {
  let all = store.lorebooks || []
  if (scope.value === 'public') all = all.filter((l) => l.isPublic)
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    all = all.filter(
      (l) =>
        (l.title || '').toLowerCase().includes(kw) ||
        (l.tags || []).some((t) => (t || '').toLowerCase().includes(kw)) ||
        (l.entries || []).some(
          (e) =>
            ((e && e.name) || '').toLowerCase().includes(kw) ||
            (e && e.keys ? e.keys : []).some((k) => (k || '').toLowerCase().includes(kw))
        )
    )
  }
  return all
})

function entryCount(l) {
  return (l.entries || []).length
}
function charCount(l) {
  const n = (l.entries || []).reduce((acc, e) => acc + ((e && e.content) || '').length, 0)
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
}

function onPreview(l) {
  previewTitle.value = l.title || '未命名'
  const secs = (l.entries || [])
    .filter((e) => e && (e.content || '').trim())
    .map((e, i) => ({
      label: e.name || (e.keys || []).join('/') || `条目 ${i + 1}` + (e.constant ? '（常驻）' : ''),
      content: e.content,
    }))
  previewList.value = secs.length ? secs : [{ label: '条目内容', content: '（暂无条目）' }]
}

function onPick(l) {
  emit('pick', l)
  if (!props.multi) close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close"></div>

      <div class="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-hidden text-neutral-800 dark:text-neutral-100">
        <!-- 头部：我的 / 公开 + 关闭 -->
        <div class="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div class="flex-1 grid grid-cols-2 gap-1 bg-neutral-100 dark:bg-neutral-800/60 rounded-lg p-1">
            <button
              @click="scope = 'mine'"
              :class="['py-1.5 rounded-md text-xs transition', scope === 'mine' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-100 dark:text-white' : 'text-neutral-400']"
            >我的</button>
            <button
              @click="scope = 'public'"
              :class="['py-1.5 rounded-md text-xs transition', scope === 'public' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-100 dark:text-white' : 'text-neutral-400']"
            >公开</button>
          </div>
          <button @click="close" class="w-8 h-8 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 text-lg leading-none transition">✕</button>
        </div>

        <!-- 搜索 -->
        <div class="px-5 pt-3">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">🔍</span>
            <input
              v-model="keyword"
              placeholder="搜索关键词..."
              class="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>
        </div>

        <!-- 卡片网格 -->
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <div v-if="!list.length" class="text-center text-neutral-500 py-14 text-sm">
            {{ scope === 'public' ? '还没有公开的世界书' : '没有匹配的世界书，可到「个人中心 → 世界书」创建' }}
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="l in list"
              :key="l.id"
              class="rounded-2xl overflow-hidden bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-800"
            >
              <!-- 封面 -->
              <div class="aspect-[16/9] bg-gradient-to-br from-emerald-900 via-neutral-800 to-neutral-900 relative">
                <SmartImage v-if="l.cover" :src="l.cover" :name="l.title || '世界书'" class="w-full h-full" />
                <div class="absolute left-3 top-2.5 right-3 font-bold text-white drop-shadow line-clamp-2">{{ l.title || '未命名' }}</div>
              </div>
              <!-- 信息 -->
              <div class="p-3">
                <div class="text-[11px] text-emerald-400 font-medium">
                  {{ entryCount(l) }} 世界书条目 <span class="text-neutral-500 ml-1">{{ charCount(l) }} 字符</span>
                </div>
                <div v-if="l.tags && l.tags.length" class="flex flex-wrap gap-1 mt-1.5">
                  <span
                    v-for="t in l.tags.slice(0, 4)"
                    :key="t"
                    class="px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 text-[10px]"
                  >{{ t }}</span>
                </div>
                <div class="flex items-center gap-2 mt-2.5">
                  <button
                    @click="onPreview(l)"
                    class="flex-1 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center justify-center gap-1"
                  >👁 预览</button>
                  <button
                    @click="onPick(l)"
                    class="flex-1 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-xs font-medium shadow shadow-pink-500/25 transition"
                  >选择</button>
                </div>
                <div class="flex items-center justify-between mt-2 text-[11px] text-neutral-500">
                  <span>@本地创作</span>
                  <span>{{ timeAgo(l.updateTime || l.createTime) }}</span>
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
