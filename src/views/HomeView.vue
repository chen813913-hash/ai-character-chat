<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CharacterCard from '../components/CharacterCard.vue'
import CharacterDetailModal from '../components/CharacterDetailModal.vue'
import CharacterEditModal from '../components/CharacterEditModal.vue'
import { store, genId, importCharacters, removeCharacter } from '../store/useDataStore.js'
import { downloadJson, pickJsonFile, parseImportedCharacters } from '../utils/io.js'
import { globalSearch } from '../composables/useSearch.js'

const route = useRoute()
const router = useRouter()

// 数据来自本地存储层（首次为 mock 种子）
const cards = computed(() => store.characters)

// 搜索词来自顶栏（全局单例）
const search = globalSearch

// ---- 标签页（排序方式）----
const TABS = [
  { value: 'recommend', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '热门' },
]
const activeTab = ref('recommend')

// ---- 频道筛选（对应人物卡的 channel 字段）----
const CHANNELS = [
  { value: '', label: '全部' },
  { value: 'male', label: '男频' },
  { value: 'female', label: '女频' },
  { value: 'world', label: '世界卡' },
]
const activeChannel = ref('')

// 轻量提示条
const notice = ref('')
function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 2500)
}

// 每个角色的会话数（热门排序 + 卡片角标）
const sessionCountMap = computed(() => {
  const m = {}
  store.sessions.forEach((s) => {
    if (s.characterId) m[s.characterId] = (m[s.characterId] || 0) + 1
  })
  return m
})

// 过滤 + 排序后的列表
const filtered = computed(() => {
  const kw = search.value.trim()
  let list = cards.value.filter((c) => {
    const matchSearch =
      !kw ||
      (c.name || '').includes(kw) ||
      (c.displayName || '').includes(kw) ||
      (c.description || '').includes(kw) ||
      (c.tags || []).some((t) => t.includes(kw))
    const matchChannel = !activeChannel.value || c.channel === activeChannel.value
    return matchSearch && matchChannel
  })
  list = [...list].sort((a, b) => {
    if (activeTab.value === 'latest') {
      return (b.createTime || 0) - (a.createTime || 0)
    }
    if (activeTab.value === 'hot') {
      const ca = sessionCountMap.value[a.id] || 0
      const cb = sessionCountMap.value[b.id] || 0
      return cb - ca || (b.updateTime || 0) - (a.updateTime || 0)
    }
    // 推荐：最近更新优先
    return (b.updateTime || 0) - (a.updateTime || 0)
  })
  return list
})

// 弹窗状态
const detailOpen = ref(false)
const detailCard = ref(null)
const editOpen = ref(false)
const editCard = ref(null)

function openDetail(card) {
  detailCard.value = card
  detailOpen.value = true
}

function onEdit(card) {
  editCard.value = card
  detailOpen.value = false
  editOpen.value = true
}

function onNewChat(card) {
  // 带上角色 id，聊天页据此新建会话
  router.push({ path: '/chat', query: { characterId: card ? card.id : '', new: '1' } })
}

// 新建人物卡：先造一份空白草稿（不落库），保存时才写入
function onNew() {
  const now = Date.now()
  editCard.value = {
    id: genId('c'),
    name: '',
    displayName: '',
    description: '',
    tags: [],
    avatar: '',
    covers: [],
    gender: 'other',
    channel: 'female',
    setting: '',
    status_bar: '',
    props: [],
    personality: '',
    scenario: '',
    first_mes: '',
    alternate_greetings: [],
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
    creator_notes: '',
    lorebook: { entries: [] },
    createTime: now,
    updateTime: now,
  }
  editOpen.value = true
}

// ---- 导入 / 导出 / 删除 ----
async function onBatchImport() {
  try {
    const text = await pickJsonFile()
    const list = parseImportedCharacters(text)
    const res = await importCharacters(list)
    flash(`导入完成：新增 ${res.added} 条，更新 ${res.updated} 条`)
  } catch (e) {
    flash('导入失败：' + e.message)
  }
}

function onBatchExport() {
  downloadJson('人物卡导出.json', cards.value)
  flash(`已导出 ${cards.value.length} 张人物卡`)
}

function onExportSingle(card) {
  downloadJson(`${card.displayName || card.name || '人物卡'}.json`, card)
  flash(`已导出：${card.displayName || card.name}`)
}

async function onDeleteCard(card) {
  if (!confirm(`确定删除「${card.displayName || card.name}」？此操作仅作用于本地数据。`)) return
  await removeCharacter(card.id)
  detailOpen.value = false
  flash(`已删除：${card.displayName || card.name}`)
}

// 侧边栏的「创建角色 / 导入角色」通过路由参数触发对应动作
watch(
  () => route.query,
  (q) => {
    if (route.path !== '/') return
    if (q.create === '1') {
      onNew()
      router.replace({ path: '/' })
    } else if (q.import === '1') {
      onBatchImport()
      router.replace({ path: '/' })
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="max-w-7xl mx-auto px-6 py-5">
    <!-- 提示条 -->
    <div
      v-if="notice"
      class="mb-4 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow"
    >
      {{ notice }}
    </div>

    <!-- 标签页：推荐 / 最新 / 热门 -->
    <div class="flex items-center gap-3 mb-3 flex-wrap">
      <div class="flex items-center gap-1 bg-neutral-200/70 dark:bg-neutral-800/80 rounded-full p-1">
        <button
          v-for="t in TABS"
          :key="t.value"
          @click="activeTab = t.value"
          :class="[
            'px-4 py-1.5 rounded-full text-sm transition',
            activeTab === t.value
              ? 'bg-neutral-900 dark:bg-black text-white shadow'
              : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200',
          ]"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <button
          @click="onBatchExport"
          class="px-3 py-1.5 rounded-full text-xs border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
          title="导出全部人物卡为 JSON"
        >
          ⬇ 导出全部
        </button>
      </div>
    </div>

    <!-- 频道筛选 -->
    <div class="flex flex-wrap items-center justify-center gap-4 mb-6 text-sm">
      <button
        v-for="ch in CHANNELS"
        :key="ch.value"
        @click="activeChannel = ch.value"
        :class="[
          'transition',
          activeChannel === ch.value
            ? 'text-pink-500 font-medium'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
        ]"
      >
        {{ ch.label }}
      </button>
    </div>

    <!-- 卡片网格 -->
    <div v-if="filtered.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <CharacterCard
        v-for="c in filtered"
        :key="c.id"
        :card="c"
        :sessions="sessionCountMap[c.id] || 0"
        @open="openDetail"
      />
    </div>
    <div v-else class="text-center text-neutral-400 py-20">没有匹配的角色</div>

    <!-- 详情弹窗 -->
    <CharacterDetailModal
      v-model="detailOpen"
      :card="detailCard"
      :sessions="detailCard ? sessionCountMap[detailCard.id] || 0 : 0"
      @edit="onEdit"
      @new-chat="onNewChat"
      @export="onExportSingle"
      @delete="onDeleteCard"
    />

    <!-- 编辑弹窗 -->
    <CharacterEditModal v-model="editOpen" :card="editCard" />
  </div>
</template>
