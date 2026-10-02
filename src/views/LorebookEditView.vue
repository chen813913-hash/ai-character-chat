<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  store,
  addLorebook,
  updateLorebook,
  getLorebook,
  genId,
} from '../store/useDataStore.js'
import SmartImage from '../components/SmartImage.vue'

const router = useRouter()
const route = useRoute()

// ---- 表单状态 ----
const isEdit = ref(false)
const id = ref('')
const title = ref('')
const description = ref('')
const cover = ref('')
const tags = ref([])
const newTag = ref('')
const protectedSource = ref(false)
const isPublic = ref(false)
const entries = ref([]) // [{id, name, keys, content, constant, position, probability, depth, order}]
const addedHint = ref(false) // 「已添加条目」提示

const flashMsg = ref('')
let flashTimer = null
function flash(text) {
  flashMsg.value = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashMsg.value = ''), 2600)
}

function load() {
  // 重置
  isEdit.value = false
  title.value = ''
  description.value = ''
  cover.value = ''
  tags.value = []
  newTag.value = ''
  protectedSource.value = false
  isPublic.value = false
  entries.value = []

  const eid = route.query.id
  if (eid) {
    const lb = getLorebook(eid)
    if (lb) {
      isEdit.value = true
      id.value = lb.id
      title.value = lb.title || ''
      description.value = lb.description || ''
      cover.value = lb.cover || ''
      tags.value = JSON.parse(JSON.stringify(lb.tags || []))
      protectedSource.value = !!lb.protectedSource
      isPublic.value = !!lb.isPublic
      entries.value = JSON.parse(JSON.stringify(lb.entries || []))
      return
    }
  }
  id.value = genId('lb')
}

onMounted(load)
watch(
  () => route.fullPath,
  (nv, ov) => {
    if (route.path === '/lorebook/edit' && nv !== ov) load()
  }
)

function buildPayload() {
  const now = Date.now()
  const src = isEdit.value ? getLorebook(id.value) : null
  return {
    id: id.value,
    title: title.value.trim(),
    description: description.value.trim(),
    cover: cover.value.trim(),
    tags: JSON.parse(JSON.stringify(tags.value)),
    protectedSource: protectedSource.value,
    isPublic: isPublic.value,
    entries: JSON.parse(JSON.stringify(entries.value)),
    createTime: (src && src.createTime) || now,
    updateTime: now,
  }
}

async function onFinish() {
  if (!title.value.trim()) {
    flash('标题不能为空')
    return
  }
  const payload = buildPayload()
  if (isEdit.value) await updateLorebook(payload)
  else await addLorebook(payload)
  flash('世界书已保存')
  router.push('/lorebook')
}

// ---- 标签 ----
function addTag() {
  const t = newTag.value.trim()
  if (!t) return
  if (!tags.value.includes(t)) tags.value.push(t)
  newTag.value = ''
}
function removeTag(i) {
  tags.value.splice(i, 1)
}

// ---- 条目编辑弹窗 ----
const showEntry = ref(false)
const editingEntry = ref(null) // null=新建
const editingIndex = ref(-1)
const eName = ref('')
const eKeysRaw = ref('')
const eContent = ref('')
const eConstant = ref(false)
const ePosition = ref('after') // before=角色前 after=角色后
const eAdvanced = ref(false)
const eProbability = ref(100)
const eDepth = ref(1)
const eOrder = ref(100)

function openNewEntry() {
  editingEntry.value = null
  editingIndex.value = -1
  eName.value = '未命名条目' + (entries.value.length + 1)
  eKeysRaw.value = ''
  eContent.value = ''
  eConstant.value = false
  ePosition.value = 'after'
  eAdvanced.value = false
  eProbability.value = 100
  eDepth.value = 1
  eOrder.value = 100
  showEntry.value = true
}

function openEditEntry(i) {
  const e = entries.value[i]
  if (!e) return
  editingEntry.value = e
  editingIndex.value = i
  eName.value = e.name || ''
  eKeysRaw.value = (e.keys || []).join(', ')
  eContent.value = e.content || ''
  eConstant.value = !!e.constant
  ePosition.value = e.position === 'before' ? 'before' : 'after'
  eAdvanced.value = e.probability !== 100 || e.depth !== 1 || e.order !== 100
  eProbability.value = Number.isFinite(e.probability) ? e.probability : 100
  eDepth.value = Number.isFinite(e.depth) ? e.depth : 1
  eOrder.value = Number.isFinite(e.order) ? e.order : 100
  showEntry.value = true
}

// 复制条目（列表 📄 图标）
function duplicateEntry(i) {
  const e = entries.value[i]
  if (!e) return
  const copy = JSON.parse(JSON.stringify(e))
  copy.id = genId('e')
  copy.name = (e.name || '未命名条目') + ' 副本'
  entries.value.splice(i + 1, 0, copy)
  flash('已复制条目')
}

async function saveEntry() {
  const keys = eKeysRaw.value
    .split(/[,，/、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const content = eContent.value
  if (!content.trim()) {
    flash('知识内容不能为空')
    return
  }
  if (!keys.length && !eConstant.value) {
    flash('请填写主要关键词，或开启「常驻激活」')
    return
  }
  const obj = {
    id: editingEntry.value ? editingEntry.value.id : genId('e'),
    name: eName.value.trim() || '未命名条目',
    keys,
    content,
    constant: eConstant.value,
    position: ePosition.value,
    probability: eAdvanced.value ? eProbability.value : 100,
    depth: eAdvanced.value ? eDepth.value : 1,
    order: eAdvanced.value ? eOrder.value : 100,
  }
  if (editingIndex.value >= 0) entries.value.splice(editingIndex.value, 1, obj)
  else {
    entries.value.push(obj)
    addedHint.value = true
    setTimeout(() => (addedHint.value = false), 2000)
  }
  showEntry.value = false
  // 条目变更即时落库（编辑已有世界书时）
  if (isEdit.value) await updateLorebook(buildPayload())
}

function removeEntry(i) {
  if (!confirm('确定删除该条目？')) return
  entries.value.splice(i, 1)
  if (isEdit.value) updateLorebook(buildPayload())
}

function entrySubtitle(e) {
  return (e.content || '').slice(0, 60) || '（无内容）'
}
function charCount(l) {
  const n = entries.value.reduce((acc, e) => acc + ((e && e.content) || '').length, 0)
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- 顶部栏 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0">
      <div class="flex items-center gap-3">
        <button
          @click="router.push('/lorebook')"
          class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          ← 返回
        </button>
        <span class="font-semibold">{{ isEdit ? '编辑世界书' : '创建世界书' }}</span>
      </div>
      <span class="text-xs text-neutral-500">{{ entries.length }} 条目 · {{ charCount() }} 字符</span>
    </div>

    <!-- 提示条 -->
    <div
      v-if="flashMsg"
      class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow-lg"
    >
      {{ flashMsg }}
    </div>

    <!-- 表单主体 -->
    <div class="flex-1 w-full max-w-3xl mx-auto px-4 py-6 pb-32">
      <!-- 标题 -->
      <div class="mb-6">
        <label class="text-sm font-bold text-pink-500 mb-1.5 block">标题 <span class="text-red-400">*</span></label>
        <input
          v-model="title"
          placeholder="世界书名称"
          class="w-full max-w-md rounded-xl bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
        />
      </div>

      <!-- 世界书条目区 -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-bold text-pink-500">世界书</span>
          <div class="flex items-center gap-2">
            <button
              @click="openNewEntry"
              class="px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-xs font-medium shadow shadow-pink-500/25 transition flex items-center gap-1"
            >＋ 添加</button>
          </div>
        </div>
        <p class="text-xs text-neutral-500 mb-2">把世界观和背景设定写成条目，触发时会自动进入上下文</p>

        <!-- 已添加提示 -->
        <div v-if="addedHint" class="flex justify-center mb-2">
          <span class="px-3 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs">✅ 已添加条目</span>
        </div>

        <!-- 空态 -->
        <div
          v-if="!entries.length"
          class="text-center py-10 rounded-2xl border border-neutral-200 dark:border-neutral-800"
        >
          <div class="w-12 h-12 mx-auto rounded-full bg-pink-500/15 flex items-center justify-center text-2xl mb-3">📖</div>
          <div class="font-semibold mb-1">还没有世界书条目</div>
          <p class="text-xs text-neutral-500 mb-4">把世界观和背景设定写成条目，触发时会自动进入上下文</p>
          <button
            @click="openNewEntry"
            class="px-6 py-2 rounded-lg border border-pink-500/40 text-pink-500 text-sm hover:bg-pink-500/10 transition"
          >＋ 创建第一个条目</button>
        </div>

        <!-- 条目列表（对齐图6：绿点+名称+内容+概率/深度/顺序+复制/编辑/删除） -->
        <div v-else class="space-y-2">
          <div
            v-for="(e, i) in entries"
            :key="e.id"
            class="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3 group"
          >
            <div class="flex items-start gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 shrink-0"></span>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate">{{ e.name }}</div>
                <div class="text-xs text-neutral-500 mt-1 truncate">{{ entrySubtitle(e) }}</div>
                <div class="text-[11px] text-neutral-500 mt-1.5 flex flex-wrap gap-x-3">
                  <span v-if="e.constant" class="text-emerald-400">常驻激活</span>
                  <span>概率: {{ e.probability }}%</span>
                  <span>深度: {{ e.depth }}</span>
                  <span>顺序: {{ e.order }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button @click="duplicateEntry(i)" class="w-7 h-7 rounded-lg text-neutral-400 hover:text-cyan-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-xs" title="复制条目">📄</button>
                <button @click="openEditEntry(i)" class="w-7 h-7 rounded-lg text-neutral-400 hover:text-indigo-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-xs" title="编辑条目">✎</button>
                <button @click="removeEntry(i)" class="w-7 h-7 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-xs" title="删除条目">🗑</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 介绍 -->
      <div class="mb-6">
        <label class="text-sm font-bold text-pink-500 mb-1.5 block">介绍</label>
        <div class="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <textarea
            v-model="description"
            rows="3"
            placeholder="介绍这本世界书的内容"
            class="w-full bg-transparent px-3 py-2.5 text-sm focus:outline-none resize-y"
          ></textarea>
        </div>
      </div>

      <!-- 封面 -->
      <div class="mb-6">
        <label class="text-sm font-bold text-pink-500 mb-1.5 block">封面</label>
        <div class="flex items-start gap-4">
          <div class="w-36 aspect-square rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center">
            <SmartImage v-if="cover" :src="cover" name="世界书封面" class="w-full h-full" />
            <span v-else class="text-3xl text-neutral-500">🖼</span>
          </div>
          <div class="flex-1">
            <input
              v-model="cover"
              placeholder="封面图片地址（https://...），留空使用默认封面"
              class="w-full rounded-xl bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
            <p class="text-[11px] text-neutral-500 mt-1.5">本地版通过粘贴图片链接设置封面</p>
          </div>
        </div>
      </div>

      <!-- 标签 -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-bold text-pink-500">标签</span>
        </div>
        <div class="rounded-xl border border-neutral-200 dark:border-neutral-800 min-h-[52px] px-3 py-2 flex flex-wrap items-center gap-1.5">
          <span
            v-for="(t, i) in tags"
            :key="t"
            class="px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-400 text-xs flex items-center gap-1"
          >
            {{ t }}
            <button @click="removeTag(i)" class="hover:text-pink-300">✕</button>
          </span>
          <input
            v-model="newTag"
            @keydown.enter.prevent="addTag"
            :placeholder="tags.length ? '' : '没有标签...'"
            class="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none py-1"
          />
          <button
            @click="addTag"
            class="px-2.5 py-1 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-400 hover:text-pink-400 hover:border-pink-400/50 transition shrink-0"
          >✋ 手动添加</button>
        </div>
      </div>

      <!-- 内容保护 -->
      <div class="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3.5 mb-6">
        <div>
          <div class="text-sm font-medium">内容保护</div>
          <p class="text-[11px] text-neutral-500 mt-0.5">开启后，其他人无法克隆或查看具体破甲内容</p>
        </div>
        <button
          @click="protectedSource = !protectedSource"
          :class="['w-10 h-5 rounded-full transition relative shrink-0', protectedSource ? 'bg-pink-500' : 'bg-neutral-300 dark:bg-neutral-700']"
        >
          <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', protectedSource ? 'left-5' : 'left-0.5']"></span>
        </button>
      </div>
    </div>

    <!-- 底部：完成 -->
    <div class="sticky bottom-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-t border-neutral-200 dark:border-neutral-800 px-4 py-3">
      <div class="max-w-3xl mx-auto">
        <button
          @click="onFinish"
          class="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 text-white font-medium shadow-lg shadow-pink-500/25 hover:opacity-90 transition"
        >完成</button>
      </div>
    </div>

    <!-- 条目编辑弹窗（对齐图5） -->
    <div v-if="showEntry" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="showEntry = false"></div>
      <div class="relative w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100 overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <span class="font-semibold text-sm flex items-center gap-1.5"><span class="text-pink-500">📖</span> 编辑世界书条目</span>
          <button @click="showEntry = false" class="text-neutral-400 hover:text-neutral-200 text-lg leading-none">✕</button>
        </div>

        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <!-- 条目名称/描述 -->
          <div>
            <label class="text-xs font-bold text-pink-500 mb-1.5 flex items-center gap-1"><span>📜</span> 条目名称/描述</label>
            <input
              v-model="eName"
              class="w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>

          <!-- 主要关键词 -->
          <div>
            <label class="text-xs font-bold text-pink-500 mb-1.5 flex items-center gap-1"><span>#</span> 主要关键词</label>
            <div class="flex gap-2">
              <input
                v-model="eKeysRaw"
                placeholder="输入后点加号确认，多个用逗号、斜杠或空格分隔"
                class="flex-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
              />
              <button
                @click="eKeysRaw += (eKeysRaw.trim() ? ',' : '')"
                class="w-9 rounded-lg bg-pink-500 text-white text-lg leading-none shrink-0 hover:bg-pink-400 transition"
                title="追加"
              >＋</button>
            </div>
          </div>

          <!-- 知识内容 -->
          <div>
            <label class="text-xs font-bold text-pink-500 mb-1.5 block">知识内容</label>
            <textarea
              v-model="eContent"
              rows="5"
              placeholder="输入条目内容..."
              class="w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40 resize-y"
            ></textarea>
          </div>

          <!-- 常驻激活 + 插入位置 -->
          <div class="flex items-center gap-6 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-pink-500">常驻激活（无需关键词）</span>
              <button
                @click="eConstant = !eConstant"
                :class="['w-10 h-5 rounded-full transition relative', eConstant ? 'bg-pink-500' : 'bg-neutral-300 dark:bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', eConstant ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-pink-500">插入位置</span>
              <select
                v-model="ePosition"
                class="rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-xs focus:outline-none"
              >
                <option value="before">角色前</option>
                <option value="after">角色后</option>
              </select>
            </div>
          </div>

          <!-- 高级设置 -->
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-pink-500 flex items-center gap-1"><span>⚙️</span> 高级设置</span>
              <button
                @click="eAdvanced = !eAdvanced"
                :class="['w-10 h-5 rounded-full transition relative', eAdvanced ? 'bg-pink-500' : 'bg-neutral-300 dark:bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', eAdvanced ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>
            <div v-if="eAdvanced" class="mt-3 space-y-3">
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-neutral-400">触发概率</span>
                  <span class="font-mono text-neutral-300">{{ eProbability }}%</span>
                </div>
                <input type="range" min="0" max="100" step="5" v-model.number="eProbability" class="w-full accent-pink-500" />
              </div>
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-neutral-400">扫描深度</span>
                  <span class="font-mono text-neutral-300">{{ eDepth }}</span>
                </div>
                <input type="range" min="1" max="20" step="1" v-model.number="eDepth" class="w-full accent-pink-500" />
              </div>
              <div>
                <div class="flex justify-between text-xs mb-1">
                  <span class="text-neutral-400">插入顺序</span>
                  <span class="font-mono text-neutral-300">{{ eOrder }}</span>
                </div>
                <input type="range" min="0" max="200" step="5" v-model.number="eOrder" class="w-full accent-pink-500" />
              </div>
            </div>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex gap-3">
          <button
            @click="showEntry = false"
            class="flex-1 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
          >取消</button>
          <button
            @click="saveEntry"
            class="flex-1 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-400 text-white text-sm font-medium shadow shadow-pink-500/25 transition"
          >保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
