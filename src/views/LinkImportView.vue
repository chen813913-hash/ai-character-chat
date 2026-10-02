<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  store,
  genId,
  addCharacter,
  updateCharacter,
  addPersona,
  addJailbreak,
  addLorebook,
  setSetting,
} from '../store/useDataStore.js'
import { pickJsonFile, downloadJson } from '../utils/io.js'
import { idb } from '../store/db.js'

const LINK_POLL_MS = 2500
let pollTimer = null

const router = useRouter()
const packet = ref(null)
const fileName = ref('')
const error = ref('')
const notice = ref('')
const importing = ref(false)
const firstPreview = ref(false)
const options = ref({
  rulesTarget: 'character_system_prompt',
  enableJailbreak: false,
})
const lorebookModes = ref([])
const selectedCharacterId = ref('')
const conflict = ref(null)
const rememberConflict = ref(false)
let conflictResolve = null

const counts = computed(() => {
  const p = packet.value || {}
  return {
    characters: Array.isArray(p.characters) ? p.characters.length : 0,
    personas: Array.isArray(p.personas) ? p.personas.length : 0,
    jailbreaks: Array.isArray(p.jailbreaks) ? p.jailbreaks.length : 0,
    lorebooks: Array.isArray(p.lorebooks) ? p.lorebooks.length : 0,
    rules: Array.isArray(p.rules) ? p.rules.length : 0,
  }
})
const total = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))
const characterChoices = computed(() => {
  const packetChoices = (packet.value && packet.value.characters || []).map((c, i) => ({
    id: 'packet:' + i,
    name: (c.displayName || c.name || '导入角色') + '（本次导入）',
  }))
  const localChoices = store.characters.map((c) => ({ id: c.id, name: c.displayName || c.name || '未命名角色' }))
  return [...packetChoices, ...localChoices]
})
const activeCharacter = computed(() =>
  store.characters.find((x) => x.id === selectedCharacterId.value) || store.characters[0] || null
)

function flash(text) {
  notice.value = text
  setTimeout(() => { notice.value = '' }, 4000)
}
function reset() {
  packet.value = null
  fileName.value = ''
  error.value = ''
  lorebookModes.value = []
  firstPreview.value = false
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  }
  return JSON.stringify(value == null ? '' : value)
}
function fingerprint(value) {
  const text = canonical(value)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}
function itemName(type, item) {
  if (type === 'character') return String(item.displayName || item.name || '导入角色').trim()
  if (type === 'persona') return String(item.name || '导入马甲').trim()
  if (type === 'jailbreak') return String(item.title || item.name || '导入破甲').trim()
  return String(item.title || item.name || '导入世界书').trim()
}
function itemContent(type, item) {
  if (type === 'character') return {
    description: item.description || '', setting: item.setting || '', personality: item.personality || '',
    scenario: item.scenario || '', first_mes: item.first_mes || '', system_prompt: item.system_prompt || '',
    post_history_instructions: item.post_history_instructions || '', lorebook: item.lorebook || {}, props: item.props || [],
  }
  if (type === 'persona') return { persona_text: item.persona_text || '', notes: item.notes || '' }
  if (type === 'jailbreak') return { type: item.type || 'simple', systemPrompt: item.systemPrompt || '', rulePrompt: item.rulePrompt || '', postPrompt: item.postPrompt || '', stJson: item.stJson || '' }
  return { entries: item.entries || [], description: item.description || '' }
}
function identity(type, item) {
  return itemName(type, item) + '::' + fingerprint(itemContent(type, item))
}
function existingByIdentity(type, item) {
  const list = type === 'character' ? store.characters : type === 'persona' ? store.personas : type === 'jailbreak' ? store.jailbreaks : store.lorebooks
  return list.find((x) => identity(type, x) === identity(type, item)) || null
}

async function parseText(text, name = '') {
  error.value = ''
  let data
  try { data = JSON.parse(text) } catch (e) {
    error.value = 'JSON 解析失败：' + (e.message || e)
    return
  }
  if (!data || data.type !== 'ai-card-catcher-import' || Number(data.version) !== 1) {
    error.value = '这不是 AI-Card-Catcher 联动 JSON（需要 type=ai-card-catcher-import、version=1）'
    return
  }
  packet.value = data
  fileName.value = name
  selectedCharacterId.value = store.characters[0] ? store.characters[0].id : ''
  lorebookModes.value = (data.lorebooks || []).map((l) => ({ mode: l.scopeHint === 'character' ? 'character' : 'global', characterId: data.characters && data.characters.length ? 'packet:0' : selectedCharacterId.value }))
  options.value = {
    rulesTarget: data.options && data.options.rulesTarget || 'character_system_prompt',
    enableJailbreak: !!(data.options && data.options.enableJailbreak),
  }
  const saved = store.settings.linkImportSeen === true
  firstPreview.value = !saved
  if (!firstPreview.value) await applyImport()
}
async function chooseFile() {
  try { await parseText(await pickJsonFile(), '') } catch (e) { if (e && e.message) error.value = '读取失败：' + e.message }
}
function onFileChange(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  fileName.value = f.name
  const reader = new FileReader()
  reader.onload = () => parseText(String(reader.result || ''), f.name)
  reader.onerror = () => { error.value = '读取文件失败' }
  reader.readAsText(f, 'utf-8')
}
async function pasteFromClipboard() {
  try { await parseText(await navigator.clipboard.readText(), '剪贴板') } catch (e) { error.value = '读取剪贴板失败，请改用选择文件' }
}
async function pollPending() {
  if (packet.value) return
  try {
    const res = await fetch('/link-import/pending')
    if (!res.ok) return
    const item = await res.json()
    if (!item || !item.packet || item.id === pollPending.lastId) return
    pollPending.lastId = item.id
    await parseText(JSON.stringify(item.packet), 'AI-Card-Catcher 一键导入')
    await fetch('/link-import/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    flash('已收到 AI-Card-Catcher 联动数据，请确认导入')
  } catch (e) { /* 未运行 Vite bridge 时静默 */ }
}
onMounted(() => {
  pollPending()
  pollTimer = setInterval(pollPending, LINK_POLL_MS)
})
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })
function askConflict(type, item, existing) {
  return new Promise((resolve) => {
    rememberConflict.value = false
    conflict.value = { type, name: itemName(type, item), existingName: itemName(type, existing) }
    conflictResolve = resolve
  })
}
async function resolveConflict(action) {
  const type = conflict.value && conflict.value.type
  const remember = rememberConflict.value
  conflict.value = null
  if (remember && type) {
    const next = { ...(store.settings.linkImportPolicies || {}), [type]: action }
    await setSetting('linkImportPolicies', next)
  }
  if (conflictResolve) conflictResolve(action)
  conflictResolve = null
  rememberConflict.value = false
}
async function actionFor(type, item) {
  const existing = existingByIdentity(type, item)
  if (!existing) return 'new'
  const saved = (store.settings.linkImportPolicies || {})[type]
  if (saved === 'overwrite' || saved === 'copy' || saved === 'skip') return saved
  return askConflict(type, item, existing)
}
function normalizeCharacter(raw, now) {
  return {
    id: genId('c'), name: itemName('character', raw).slice(0, 120), displayName: String(raw.displayName || raw.name || '').slice(0, 120),
    description: String(raw.description || ''), tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map(String) : [],
    avatar: String(raw.avatar || ''), covers: Array.isArray(raw.covers) ? raw.covers.slice(0, 6) : [],
    gender: raw.gender || 'other', channel: raw.channel || 'world', appearance: String(raw.appearance || ''),
    personality: String(raw.personality || ''), scenario: String(raw.scenario || ''), setting: String(raw.setting || ''),
    first_mes: String(raw.first_mes || ''), alternate_greetings: Array.isArray(raw.alternate_greetings) ? raw.alternate_greetings : [],
    mes_example: String(raw.mes_example || ''), system_prompt: String(raw.system_prompt || ''),
    post_history_instructions: String(raw.post_history_instructions || ''), creator_notes: String(raw.creator_notes || 'AI-Card-Catcher 导入'),
    lorebook: { entries: raw.lorebook && Array.isArray(raw.lorebook.entries) ? raw.lorebook.entries : [] }, lorebookIds: [],
    props: Array.isArray(raw.props) ? raw.props : [], createTime: now, updateTime: now,
  }
}
function normalizeLorebook(raw, now) {
  return {
    id: genId('lb'), title: itemName('lorebook', raw).slice(0, 120), description: String(raw.description || 'AI-Card-Catcher 导入'),
    cover: String(raw.cover || ''), tags: Array.isArray(raw.tags) ? raw.tags : ['AI-Card-Catcher'],
    protectedSource: false, isPublic: false, scopeHint: raw.scopeHint || 'global',
    entries: (raw.entries || []).map((e, i) => ({ id: e.id || genId('e'), name: e.name || ('导入条目 ' + (i + 1)), keys: Array.isArray(e.keys) ? e.keys : [], content: String(e.content || ''), constant: e.constant !== false, position: e.position || 'after', probability: Number.isFinite(e.probability) ? e.probability : 100, depth: Number.isFinite(e.depth) ? e.depth : 1, order: Number.isFinite(e.order) ? e.order : (Number.isFinite(e.insertionOrder) ? e.insertionOrder : 100) })),
    createTime: now, updateTime: now,
  }
}

async function importOne(type, raw, now, counters) {
  const decision = await actionFor(type, raw)
  if (decision === 'skip') { counters.skipped++; return null }
  const existing = existingByIdentity(type, raw)
  let data
  if (type === 'character') data = normalizeCharacter(raw, now)
  if (type === 'persona') data = { id: genId('p'), name: itemName(type, raw).slice(0, 120), avatar: String(raw.avatar || ''), persona_text: String(raw.persona_text || ''), notes: String(raw.notes || ''), createTime: now, updateTime: now }
  if (type === 'jailbreak') data = { id: genId('jb'), title: itemName(type, raw).slice(0, 120), type: raw.type || 'simple', description: String(raw.description || ''), cover: '', tags: ['AI-Card-Catcher'], models: [], protectedSource: false, systemPrompt: String(raw.systemPrompt || ''), rulePrompt: String(raw.rulePrompt || ''), postPrompt: String(raw.postPrompt || ''), interactions: [], stJson: String(raw.stJson || ''), stName: '', regexCount: 0, isPublic: false, status: 'draft', enabled: !!raw.enabled, createTime: now, updateTime: now }
  if (type === 'lorebook') data = normalizeLorebook(raw, now)
  if (decision === 'overwrite' && existing) data.id = existing.id
  if (decision === 'copy') data[ type === 'jailbreak' ? 'title' : type === 'lorebook' ? 'title' : 'name' ] += '（副本）'
  if (type === 'character') {
    if (decision === 'overwrite' && existing) await updateCharacter(data)
    else await addCharacter(data)
  }
  if (type === 'persona') {
    if (decision === 'overwrite' && existing) await importOverwrite('persona', data)
    else await addPersona(data)
  }
  if (type === 'jailbreak') {
    if (decision === 'overwrite' && existing) await importOverwrite('jailbreak', data)
    else await addJailbreak(data)
  }
  if (type === 'lorebook') {
    if (decision === 'overwrite' && existing) await importOverwrite('lorebook', data)
    else await addLorebook(data)
  }
  counters[type + (decision === 'overwrite' ? 'Updated' : 'Added')]++
  return data
}
async function importOverwrite(type, data) {
  const list = type === 'jailbreak' ? store.jailbreaks : type === 'persona' ? store.personas : store.lorebooks
  const i = list.findIndex((x) => x.id === data.id)
  const name = type === 'jailbreak' ? 'jailbreaks' : type === 'persona' ? 'personas' : 'lorebooks'
  await idb.put(name, data)
  if (i >= 0) list[i] = data
  else list.unshift(data)
}

async function applyImport() {
  if (!packet.value || importing.value) return
  importing.value = true
  try {
    const p = packet.value
    const now = Date.now()
    const counters = { characterAdded: 0, characterUpdated: 0, personaAdded: 0, jailbreakAdded: 0, jailbreakUpdated: 0, lorebookAdded: 0, lorebookUpdated: 0, skipped: 0 }
    const importedChars = []
    for (let raw of (p.characters || [])) {
      if (options.value.rulesTarget === 'jailbreak') raw = { ...raw, system_prompt: '' }
      const c = await importOne('character', raw, now, counters)
      if (c) importedChars.push(c)
    }
    for (const raw of (p.personas || [])) await importOne('persona', raw, now, counters)
    const rules = (p.rules || []).map((x) => x.content || '').filter(Boolean).join('\n\n---\n\n')
    if (rules && options.value.rulesTarget === 'character_system_prompt') {
      const target = importedChars[0] || store.characters[0]
      if (target) {
        const updated = { ...target, system_prompt: [target.system_prompt || '', rules].filter(Boolean).join('\n\n'), updateTime: Date.now() }
        await updateCharacter(updated)
      }
    }
    if (rules && options.value.rulesTarget === 'jailbreak') {
      for (const raw of (p.jailbreaks || [])) raw.rulePrompt = [raw.rulePrompt || '', rules].filter(Boolean).join('\n\n')
    }
    if (options.value.enableJailbreak) {
      for (const raw of (p.jailbreaks || [])) raw.enabled = true
    }
    for (const raw of (p.jailbreaks || [])) await importOne('jailbreak', raw, now, counters)
    if (options.value.enableJailbreak && (p.jailbreaks || []).length) {
      const imported = store.jailbreaks.find((x) => x.title === itemName('jailbreak', p.jailbreaks[0]))
      if (imported) await setSetting('jailbreak', { enabled: true, mode: imported.type || 'simple', activeId: imported.id })
    }
    for (let i = 0; i < (p.lorebooks || []).length; i++) {
      const raw = p.lorebooks[i]
      const lb = await importOne('lorebook', raw, now, counters)
      if (!lb) continue
      const mode = lorebookModes.value[i] || { mode: 'global', characterId: '' }
      if (mode.mode === 'character' && (mode.characterId || activeCharacter.value || importedChars[0])) {
        const packetIndex = String(mode.characterId || '').startsWith('packet:') ? Number(String(mode.characterId).slice(7)) : -1
        const packetChar = packetIndex >= 0 ? importedChars[packetIndex] : null
        const cid = packetChar ? packetChar.id : (mode.characterId || (activeCharacter.value && activeCharacter.value.id))
        const char = store.characters.find((x) => x.id === cid)
        if (char) {
          const ids = Array.isArray(char.lorebookIds) ? char.lorebookIds.slice() : []
          if (!ids.includes(lb.id)) ids.push(lb.id)
          await updateCharacter({ ...char, lorebookIds: ids })
        }
      } else {
        const cfg = store.settings.lorebook || {}
        const ids = Array.isArray(cfg.activeIds) ? cfg.activeIds.slice() : (cfg.activeId ? [cfg.activeId] : [])
        if (!ids.includes(lb.id)) ids.push(lb.id)
        await setSetting('lorebook', { ...cfg, activeIds: ids, activeId: ids[0] || '' })
      }
    }
    await setSetting('linkImportSeen', true)
    firstPreview.value = false
    flash(`联动导入完成：角色新增/覆盖 ${counters.characterAdded + counters.characterUpdated}，马甲 ${counters.personaAdded}，破甲 ${counters.jailbreakAdded + counters.jailbreakUpdated}，世界书 ${counters.lorebookAdded + counters.lorebookUpdated}，跳过 ${counters.skipped}`)
    packet.value = null
  } catch (e) {
    error.value = '导入失败：' + (e && e.message ? e.message : e)
  } finally { importing.value = false }
}
function exportPacket() {
  if (packet.value) downloadJson('ai-card-catcher-import.json', packet.value)
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div><h1 class="text-xl font-bold">🔗 联动导入</h1><p class="text-xs text-neutral-500 mt-1">从 AI-Card-Catcher 一键接收或导出的联动 JSON，导入到本地 IndexedDB。</p></div>
      <button @click="router.push('/grab')" class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs">返回数据抓取</button>
    </div>
    <div v-if="notice" class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow-lg">{{ notice }}</div>
    <div v-if="error" class="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{{ error }}</div>

    <section class="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4 space-y-3">
      <h2 class="font-semibold text-sm">导入联动 JSON</h2>
      <p class="text-xs text-neutral-500">方式 A：在 AI-Card-Catcher 卡片页点击「一键导入」；方式 C：选择下载的联动 JSON 文件，或粘贴到剪贴板。</p>
      <div class="flex flex-wrap gap-2">
        <label class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm cursor-pointer hover:bg-indigo-400">选择 JSON 文件<input type="file" accept=".json,application/json" class="hidden" @change="onFileChange"></label>
        <button @click="chooseFile" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm">浏览文件</button>
        <button @click="pasteFromClipboard" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm">读取剪贴板</button>
        <button v-if="packet" @click="exportPacket" class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm">重新导出</button>
      </div>
      <p v-if="fileName" class="text-[11px] text-neutral-500">当前数据：{{ fileName }}</p>
    </section>

    <section v-if="packet" class="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
      <div class="flex items-center justify-between"><h2 class="font-semibold text-sm">导入预览</h2><span class="text-xs text-neutral-500">来源：{{ packet.source && packet.source.model || '未知模型' }} · 记录 #{{ packet.source && packet.source.recordId || '-' }}</span></div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
        <div class="rounded-lg bg-sky-500/10 p-2"><b class="block text-lg">{{ counts.characters }}</b>人物卡</div>
        <div class="rounded-lg bg-orange-500/10 p-2"><b class="block text-lg">{{ counts.personas }}</b>用户马甲</div>
        <div class="rounded-lg bg-red-500/10 p-2"><b class="block text-lg">{{ counts.jailbreaks }}</b>破甲</div>
        <div class="rounded-lg bg-purple-500/10 p-2"><b class="block text-lg">{{ counts.lorebooks }}</b>世界书</div>
        <div class="rounded-lg bg-amber-500/10 p-2"><b class="block text-lg">{{ counts.rules }}</b>补充规则</div>
      </div>
      <div v-if="counts.characters" class="rounded-xl bg-neutral-100 dark:bg-neutral-800/60 p-3 text-xs"><b>人物卡：</b><span v-for="(c, i) in packet.characters" :key="i" class="ml-2">{{ c.displayName || c.name || '未命名' }}</span></div>
      <div v-if="counts.personas" class="rounded-xl bg-neutral-100 dark:bg-neutral-800/60 p-3 text-xs"><b>马甲：</b><span v-for="(p, i) in packet.personas" :key="i" class="ml-2">{{ p.name || '未命名' }}</span></div>
      <div v-if="counts.jailbreaks" class="rounded-xl bg-neutral-100 dark:bg-neutral-800/60 p-3 text-xs"><b>破甲：</b><span v-for="(j, i) in packet.jailbreaks" :key="i" class="ml-2">{{ j.title || j.name || '未命名' }}</span></div>
      <div v-if="counts.lorebooks" class="space-y-2"><b class="text-xs">世界书导入位置</b><div v-for="(l, i) in packet.lorebooks" :key="i" class="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/60 p-2 text-xs"><span class="flex-1 min-w-32">{{ l.title || l.name || '未命名' }}</span><select v-model="lorebookModes[i].mode" class="rounded bg-white dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 px-2 py-1"><option value="global">全局世界书</option><option value="character">绑定人物</option></select><select v-if="lorebookModes[i].mode === 'character'" v-model="lorebookModes[i].characterId" class="rounded bg-white dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 px-2 py-1"><option v-for="c in characterChoices" :key="c.id" :value="c.id">{{ c.name }}</option></select></div></div>
      <div class="grid md:grid-cols-2 gap-3 text-xs"><label class="block">补充规则写入<select v-model="options.rulesTarget" class="mt-1 w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-2 py-2"><option value="character_system_prompt">人物卡系统提示词（默认）</option><option value="jailbreak">破甲规则提示词</option></select></label><label class="flex items-center gap-2 mt-5"><input v-model="options.enableJailbreak" type="checkbox">导入后立即启用破甲（默认关闭）</label></div>
      <div class="flex items-center justify-between gap-2"><span class="text-[11px] text-neutral-500">重复数据按“名称 + 内容指纹”判断；每种类型首次冲突时选择并记住策略。</span><button @click="reset" class="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs">取消</button><button @click="applyImport" :disabled="importing" class="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm disabled:opacity-50">{{ importing ? '导入中…' : (firstPreview ? '确认并导入' : '重新导入') }}</button></div>
    </section>

    <div v-else class="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 py-16 text-center text-sm text-neutral-500">等待联动数据。你也可以先在 AI-Card-Catcher 卡片页选择「导出联动 JSON」。</div>

    <div v-if="conflict" class="fixed inset-0 z-[80] flex items-center justify-center p-4"><div class="absolute inset-0 bg-black/70" @click="resolveConflict('skip')"></div><div class="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 p-5 shadow-2xl"><h3 class="font-semibold">发现重复{{ conflict.type === 'character' ? '人物卡' : conflict.type === 'persona' ? '马甲' : conflict.type === 'jailbreak' ? '破甲预设' : '世界书' }}</h3><p class="text-sm mt-2">「{{ conflict.name }}」与本地内容名称和指纹都相同。</p><div class="grid grid-cols-3 gap-2 mt-5"><button @click="resolveConflict('overwrite')" class="py-2 rounded-lg bg-indigo-500 text-white text-xs">覆盖</button><button @click="resolveConflict('copy')" class="py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs">新建副本</button><button @click="resolveConflict('skip')" class="py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs">跳过</button></div><label class="flex items-center gap-2 mt-4 text-xs text-neutral-500"><input v-model="rememberConflict" type="checkbox">记住本次选择（按类型保存）</label><p class="text-[11px] text-neutral-500 mt-2">可在设置中清除或修改各类型的重复策略。</p></div></div>
  </div>
</template>
