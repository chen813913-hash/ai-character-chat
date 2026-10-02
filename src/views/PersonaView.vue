<script setup>
import { ref, computed } from 'vue'
import PersonaCard from '../components/PersonaCard.vue'
import PersonaEditModal from '../components/PersonaEditModal.vue'
import { store, genId, importPersonas, removePersona } from '../store/useDataStore.js'
import { downloadJson, pickJsonFile, parseImportedPersonas } from '../utils/io.js'

// 数据来自本地存储层
const personas = computed(() => store.personas)

const editOpen = ref(false)
const editTarget = ref(null)

const notice = ref('')
function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 2500)
}

function openEdit(p) {
  editTarget.value = p
  editOpen.value = true
}

// ---- 导入 / 导出 / 删除（本轮实现）----
async function onBatchImport() {
  try {
    const text = await pickJsonFile()
    const list = parseImportedPersonas(text)
    const res = await importPersonas(list)
    flash(`导入完成：新增 ${res.added} 条，更新 ${res.updated} 条`)
  } catch (e) {
    flash('导入失败：' + e.message)
  }
}

function onBatchExport() {
  downloadJson('马甲导出.json', personas.value)
  flash(`已导出 ${personas.value.length} 个马甲`)
}

function onExportSingle(p) {
  downloadJson(`${p.name || '马甲'}.json`, p)
  flash(`已导出：${p.name}`)
}

async function onDelete(p) {
  if (!confirm(`确定删除马甲「${p.name}」？仅作用于本地数据。`)) return
  await removePersona(p.id)
  flash(`已删除：${p.name}`)
}

// 新建马甲：先造空白草稿（不落库），保存时才写入
function onNew() {
  const now = Date.now()
  editTarget.value = {
    id: genId('p'),
    name: '',
    avatar: '',
    persona_text: '',
    notes: '',
    createTime: now,
    updateTime: now,
  }
  editOpen.value = true
}
</script>

<template>
  <div>
    <!-- 提示条 -->
    <div v-if="notice" class="mb-4 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow">
      {{ notice }}
    </div>

    <!-- 顶部工具条 -->
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <h1 class="text-xl font-bold mr-auto">马甲管理</h1>
      <button @click="onNew" class="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm hover:bg-indigo-600">+ 新建马甲</button>
      <button @click="onBatchImport" class="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">批量导入马甲</button>
      <button @click="onBatchExport" class="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-600 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">批量导出马甲</button>
    </div>

    <!-- 马甲卡片网格 -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      <PersonaCard
        v-for="p in personas"
        :key="p.id"
        :persona="p"
        @edit="openEdit"
        @delete="onDelete"
        @export="onExportSingle"
      />
    </div>

    <!-- 编辑弹窗（表单骨架，保存仍为占位）-->
    <PersonaEditModal v-model="editOpen" :persona="editTarget" />
  </div>
</template>
