<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  store,
  removeLorebook,
  duplicateLorebook,
  updateLorebook,
} from '../store/useDataStore.js'
import SmartImage from '../components/SmartImage.vue'

const router = useRouter()

const list = computed(() => store.lorebooks || [])

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

// 卡片 ⋯ 菜单
const menuFor = ref('')
function toggleMenu(id) {
  menuFor.value = menuFor.value === id ? '' : id
}
function onEdit(l) {
  menuFor.value = ''
  router.push({ path: '/lorebook/edit', query: { id: l.id } })
}
function onClone(l) {
  menuFor.value = ''
  duplicateLorebook(l.id)
}
async function onDelete(l) {
  menuFor.value = ''
  if (!confirm(`确定删除世界书「${l.title || '未命名'}」？此操作不可恢复。`)) return
  await removeLorebook(l.id)
}
function togglePublic(l) {
  l.isPublic = !l.isPublic
  updateLorebook(l)
}

function onCreate() {
  router.push({ path: '/lorebook/edit' })
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">我的世界书</h1>
      <span class="text-xs text-neutral-500">{{ list.length }} 本</span>
    </div>

    <!-- 空态 -->
    <div
      v-if="!list.length"
      class="text-center text-neutral-500 py-16 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-2xl mb-6"
    >
      还没有世界书，点击下方「创建」新建一本
    </div>

    <!-- 卡片网格 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <div
        v-for="l in list"
        :key="l.id"
        class="rounded-2xl overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 relative"
      >
        <!-- 封面 -->
        <div class="aspect-[16/9] bg-gradient-to-br from-emerald-900 via-neutral-800 to-neutral-900 relative">
          <SmartImage v-if="l.cover" :src="l.cover" :name="l.title || '世界书'" class="w-full h-full" />
          <div class="absolute left-3 top-3 right-3 font-bold text-white drop-shadow" :class="l.cover ? 'line-clamp-2' : 'text-lg'">
            {{ l.title || '未命名' }}
          </div>
          <!-- ⋯ 菜单 -->
          <button
            @click.stop="toggleMenu(l.id)"
            class="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
            title="更多操作"
          >⋯</button>
          <div
            v-if="menuFor === l.id"
            class="absolute right-2 bottom-12 w-36 rounded-xl overflow-hidden shadow-2xl bg-neutral-800 border border-neutral-700 z-20 text-sm"
          >
            <button @click="onEdit(l)" class="w-full text-left px-4 py-2.5 bg-purple-600 text-white hover:bg-purple-500 transition">✎ 编辑</button>
            <button @click="onClone(l)" class="w-full text-left px-4 py-2.5 text-neutral-200 hover:bg-neutral-700 transition">⧉ 克隆</button>
            <button @click="onDelete(l)" class="w-full text-left px-4 py-2.5 text-red-400 hover:bg-neutral-700 transition">🗑 删除</button>
          </div>
        </div>

        <!-- 信息区 -->
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
          <div class="flex items-center justify-between mt-2.5">
            <div class="flex items-center gap-2 text-sm">
              <span>公开</span>
              <button
                @click="togglePublic(l)"
                :class="['w-9 h-5 rounded-full relative transition', l.isPublic ? 'bg-pink-500' : 'bg-neutral-300 dark:bg-neutral-700']"
                :title="l.isPublic ? '公开' : '私人'"
              >
                <span
                  class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  :style="{ left: l.isPublic ? '18px' : '2px' }"
                ></span>
              </button>
            </div>
            <span v-if="l.protectedSource" class="text-[11px] text-neutral-500" title="内容保护已开启">🛡 已保护</span>
          </div>
          <div class="flex items-center justify-between mt-2 text-[11px] text-neutral-500">
            <span>@本地创作</span>
            <span>{{ timeAgo(l.updateTime || l.createTime) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部创建大按钮 -->
    <div class="mt-2">
      <button
        @click="onCreate"
        class="w-full py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-400 text-white font-medium shadow-lg shadow-pink-500/25 hover:opacity-90 transition flex items-center justify-center gap-2"
      >
        <span class="text-lg leading-none">＋</span><span>创建世界书</span>
      </button>
    </div>
  </div>
</template>
