<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { store, removeJailbreak, duplicateJailbreak, updateJailbreak } from '../store/useDataStore.js'
import SmartImage from '../components/SmartImage.vue'

const router = useRouter()

// ---- 分类下拉（简易破甲 / 酒馆破甲）----
const TYPES = [
  { value: 'simple', label: '简易破甲' },
  { value: 'sillytavern', label: '酒馆破甲' },
]
const filterOpen = ref(false)
const filterType = ref('') // '' = 全部

const filtered = computed(() => {
  const list = store.jailbreaks || []
  if (!filterType.value) return list
  return list.filter((j) => j.type === filterType.value)
})

function pickFilter(v) {
  filterType.value = v
  filterOpen.value = false
}
const filterLabel = computed(() => {
  const t = TYPES.find((x) => x.value === filterType.value)
  return t ? t.label : '全部破甲'
})

// ---- 时间显示（x 分钟前）----
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
}

// ---- 卡片 ⋯ 菜单 ----
const menuFor = ref('') // 当前展开菜单的卡片 id
function toggleMenu(id) {
  menuFor.value = menuFor.value === id ? '' : id
}
function onEdit(jb) {
  menuFor.value = ''
  router.push({ path: '/jailbreak/edit', query: { id: jb.id } })
}
async function onCopy(jb) {
  menuFor.value = ''
  duplicateJailbreak(jb.id)
}
async function onDelete(jb) {
  menuFor.value = ''
  if (!confirm(`确定删除破甲预设「${jb.title || '未命名'}」？此操作不可恢复。`)) return
  await removeJailbreak(jb.id)
}
function togglePublic(jb) {
  jb.isPublic = !jb.isPublic
  updateJailbreak(jb)
}

// ---- 新建：类型选择弹窗 ----
const showTypeModal = ref(false)
function chooseType(type) {
  showTypeModal.value = false
  router.push({ path: '/jailbreak/edit', query: { type } })
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6">
    <!-- 顶部：分类下拉 -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">我的破甲预设</h1>
    </div>

    <!-- 分类下拉条（对齐微灵：点击展开，选中项打勾高亮）-->
    <div class="relative mb-5">
      <button
        @click="filterOpen = !filterOpen"
        class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition"
      >
        <span>{{ filterLabel }}</span>
        <span class="text-neutral-400 text-xs">{{ filterOpen ? '▴' : '▾' }}</span>
      </button>
      <div
        v-if="filterOpen"
        class="absolute left-0 right-0 top-11 z-20 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 shadow-2xl bg-white dark:bg-neutral-900"
      >
        <button
          @click="pickFilter('')"
          :class="['w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition',
            filterType === '' ? 'bg-purple-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800']"
        >
          <span v-if="filterType === ''">✓</span><span v-else class="w-4"></span>全部破甲
        </button>
        <button
          v-for="t in TYPES"
          :key="t.value"
          @click="pickFilter(t.value)"
          :class="['w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition',
            filterType === t.value ? 'bg-purple-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800']"
        >
          <span v-if="filterType === t.value">✓</span><span v-else class="w-4"></span>{{ t.label }}
        </button>
      </div>
    </div>

    <!-- 空态 -->
    <div
      v-if="!filtered.length"
      class="text-center text-neutral-500 py-16 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-2xl mb-6"
    >
      还没有破甲预设，点击下方按钮创建
    </div>

    <!-- 卡片网格 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <div
        v-for="jb in filtered"
        :key="jb.id"
        class="rounded-2xl overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 relative"
      >
        <!-- 封面 -->
        <div class="aspect-video bg-gradient-to-br from-indigo-900 via-neutral-800 to-neutral-900 relative">
          <SmartImage v-if="jb.cover" :src="jb.cover" :name="jb.title || '破甲'" class="w-full h-full" />
          <div class="absolute left-3 top-3 font-bold text-white drop-shadow" :class="jb.cover ? '' : 'text-lg'">
            {{ jb.title || '未命名' }}
          </div>
          <!-- ⋯ 菜单 -->
          <button
            @click.stop="toggleMenu(jb.id)"
            class="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
            title="更多操作"
          >⋯</button>
          <div
            v-if="menuFor === jb.id"
            class="absolute right-2 bottom-12 w-36 rounded-xl overflow-hidden shadow-2xl bg-neutral-800 border border-neutral-700 z-20 text-sm"
          >
            <button @click="onEdit(jb)" class="w-full text-left px-4 py-2.5 bg-purple-600 text-white hover:bg-purple-500 transition">✎ 编辑</button>
            <button @click="onCopy(jb)" class="w-full text-left px-4 py-2.5 text-neutral-200 hover:bg-neutral-700 transition">⧉ 复制</button>
            <button @click="onDelete(jb)" class="w-full text-left px-4 py-2.5 text-red-400 hover:bg-neutral-700 transition">🗑 删除</button>
          </div>
        </div>

        <!-- 信息区 -->
        <div class="p-3">
          <span
            :class="['inline-block px-2 py-0.5 rounded-md text-[11px] font-medium',
              jb.type === 'sillytavern'
                ? 'bg-cyan-500/15 text-cyan-400'
                : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300']"
          >
            {{ jb.type === 'sillytavern' ? '酒馆预设' : '简易预设' }}
          </span>
          <div class="flex items-center justify-between mt-2.5">
            <div class="flex items-center gap-2 text-sm">
              <span>公开</span>
              <button
                @click="togglePublic(jb)"
                :class="['w-9 h-5 rounded-full relative transition',
                  jb.isPublic ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700']"
                :title="jb.isPublic ? '公开' : '私人'"
              >
                <span
                  class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  :style="{ left: jb.isPublic ? '18px' : '2px' }"
                ></span>
              </button>
            </div>
            <span v-if="jb.tags && jb.tags.length" class="text-[11px] text-neutral-500 truncate max-w-[45%]">{{ jb.tags.join(' · ') }}</span>
          </div>
          <div class="flex items-center justify-between mt-2 text-[11px] text-neutral-500">
            <span>@本地创作</span>
            <span>{{ timeAgo(jb.updateTime || jb.createTime) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 大粉色添加按钮 -->
    <div class="flex justify-center mt-2">
      <button
        @click="showTypeModal = true"
        class="px-6 py-3 rounded-full bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-400 hover:to-pink-300 text-white font-medium shadow-lg shadow-pink-500/30 transition flex items-center gap-2"
      >
        <span class="text-lg leading-none">＋</span>
        <span>添加新的破甲</span>
      </button>
    </div>

    <!-- 类型选择弹窗 -->
    <div v-if="showTypeModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showTypeModal = false"></div>
      <div class="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 text-neutral-800 dark:text-neutral-100">
        <div class="font-bold mb-1">选择创建类型</div>
        <p class="text-xs text-neutral-500 mb-4">选择要创建的破甲预设类型</p>
        <button
          @click="chooseType('simple')"
          class="w-full text-left p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-pink-400 hover:bg-pink-500/5 transition mb-3"
        >
          <div class="font-semibold">简易破甲</div>
          <div class="text-xs text-neutral-500 mt-1">配置简单、上手快的破甲预设（前置 / 规则 / 后置提示词）</div>
        </button>
        <button
          @click="chooseType('sillytavern')"
          class="w-full text-left p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-cyan-400 hover:bg-cyan-500/5 transition"
        >
          <div class="font-semibold">酒馆破甲</div>
          <div class="text-xs text-neutral-500 mt-1">兼容 SillyTavern 格式，功能更丰富的破甲预设（JSON 导入）</div>
        </button>
      </div>
    </div>
  </div>
</template>
