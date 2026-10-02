import { reactive } from 'vue'
import { idb } from './db.js'

// =============================================================================
// 局域网配置共享：这些设置项由电脑上的 local-sync.json 统一保管，
// 各设备（手机/平板）打开应用时自动拉取，修改时自动写回——实现 API 配置跨设备共享。
// 仅在 dev / preview（vite 服务在跑）时有效；file:// 打开会静默跳过。
// =============================================================================
const SYNC_KEYS = ['apiKeys', 'activeApiKeyId', 'imageApis', 'activeImageApiId']

let syncTimer = null
async function pushSyncToServer() {
  try {
    const payload = {}
    for (const k of SYNC_KEYS) {
      if (store.settings[k] !== undefined) payload[k] = JSON.parse(JSON.stringify(store.settings[k]))
    }
    await fetch('/local-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    /* 无服务（file:// 等）静默跳过 */
  }
}
function queueSyncToServer() {
  // 防抖：连续修改（如批量保存）只写一次
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    pushSyncToServer()
  }, 400)
}
async function pullSharedConfig(settingsObj) {
  try {
    const res = await fetch('/local-sync', { signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined })
    if (!res.ok) return
    const shared = await res.json()
    let touched = false
    for (const k of SYNC_KEYS) {
      if (shared[k] !== undefined && JSON.stringify(shared[k]) !== JSON.stringify(settingsObj[k])) {
        settingsObj[k] = shared[k]
        touched = true
        await idb.put('settings', { key: k, value: JSON.parse(JSON.stringify(shared[k])) })
      }
    }
    if (touched) console.info('[sync] 已从局域网共享配置载入 API 设置')
  } catch (e) {
    /* 无服务静默跳过 */
  }
}
import {
  mockCharacters,
  mockPersonas,
  mockSessions,
  mockMessages,
} from '../data/mock.js'

// =============================================================================
// 本地数据仓储层：全部落在浏览器 IndexedDB，不与任何服务器通信
// 对外暴露响应式 state + 异步操作方法，视图只管调用
// =============================================================================

const LS_KEY = 'acc_store_v1' // 旧的 localStorage 键，用于一次性迁移

// 说明：这里先用 mock 作为“同步种子”，保证首屏立刻有内容可渲染；
// initStore 完成后会用 IndexedDB 中的真实数据覆盖（若有）。
// 这样即使数据库不可用/卡住，界面也不会空白。
export const store = reactive({
  characters: JSON.parse(JSON.stringify(mockCharacters)),
  personas: JSON.parse(JSON.stringify(mockPersonas)),
  sessions: JSON.parse(JSON.stringify(mockSessions)),
  jailbreaks: [],
  lorebooks: [],
  settings: {},
  ready: false,
})

export function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// ---- 初始化：迁移旧数据 -> 载入 -> 空库播种 ----
async function migrateFromLocalStorage() {
  let raw = null
  try {
    raw = localStorage.getItem(LS_KEY)
  } catch (e) {
    return
  }
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    const [chars, personas] = await Promise.all([
      idb.getAll('characters'),
      idb.getAll('personas'),
    ])
    if (!chars.length && Array.isArray(data.characters) && data.characters.length) {
      await idb.bulkPut('characters', data.characters)
    }
    if (!personas.length && Array.isArray(data.personas) && data.personas.length) {
      await idb.bulkPut('personas', data.personas)
    }
    localStorage.removeItem(LS_KEY)
  } catch (e) {
    console.warn('[store] 迁移旧数据失败', e)
  }
}

export async function initStore() {
  await migrateFromLocalStorage()

  const [chars, personas, sessions, settings, jailbreaks, lorebooks] = await Promise.all([
    idb.getAll('characters'),
    idb.getAll('personas'),
    idb.getAll('sessions'),
    idb.getAll('settings'),
    idb.getAll('jailbreaks'),
    idb.getAll('lorebooks'),
  ])

  // 人物卡
  if (!chars.length) {
    const seed = JSON.parse(JSON.stringify(mockCharacters))
    await idb.bulkPut('characters', seed)
    store.characters = seed
  } else {
    store.characters = chars
  }

  // 马甲
  if (!personas.length) {
    const seed = JSON.parse(JSON.stringify(mockPersonas))
    await idb.bulkPut('personas', seed)
    store.personas = seed
  } else {
    store.personas = personas
  }

  // 会话（空库时连带播种示例会话 + 示例消息）
  // 注意：store.sessions 是 reactive proxy，必须深克隆成纯对象才能 put 进 IDB
  if (!sessions.length) {
    const seed = JSON.parse(JSON.stringify(store.sessions))
    await idb.bulkPut('sessions', seed)
    const msgs = mockMessages.map((m) => ({ ...m, sessionId: seed[0].id }))
    await idb.bulkPut('messages', msgs)
    store.sessions = sortSessions(seed)
  } else {
    store.sessions = sortSessions(sessions)
  }

  // 破甲预设（空库不播种，由用户自己创建）
  store.jailbreaks = jailbreaks || []

  // 世界书库（空库不播种）
  store.lorebooks = lorebooks || []

  // 设置：库中结构是 {key, value} 列表，这里摊平成对象
  const settingsObj = {}
  settings.forEach((s) => {
    settingsObj[s.key] = s.value
  })

  // v1 → v2 迁移：老 settings.llm.apiBase/apiKey/model 转成 apiKeys[0]
  if (
    settingsObj.llm &&
    settingsObj.llm.apiBase &&
    !Array.isArray(settingsObj.apiKeys)
  ) {
    const migrated = {
      id: 'ak-' + Date.now().toString(36),
      name: '默认 API',
      apiBase: settingsObj.llm.apiBase || '',
      apiKey: settingsObj.llm.apiKey || '',
      models: settingsObj.llm.model ? [settingsObj.llm.model] : [],
      createdAt: Date.now(),
    }
    settingsObj.apiKeys = [migrated]
    settingsObj.activeApiKeyId = migrated.id
    // 清理 llm 中的 api 字段，只保留全局参数
    settingsObj.llm = {
      temperature: settingsObj.llm.temperature,
      topP: settingsObj.llm.topP,
      maxTokens: settingsObj.llm.maxTokens,
    }
    await idb.put('settings', { key: 'apiKeys', value: settingsObj.apiKeys })
    await idb.put('settings', { key: 'activeApiKeyId', value: settingsObj.activeApiKeyId })
    await idb.put('settings', { key: 'llm', value: settingsObj.llm })
  }

  // 首次启动：种入示例 API Key，方便用户了解结构（仅当没有任何 apiKeys 时）
  if (!Array.isArray(settingsObj.apiKeys) || settingsObj.apiKeys.length === 0) {
    const demos = [
      {
        id: 'ak-demo-1',
        name: '【满血A】gemini-3-flash-preview',
        apiBase: 'https://api.gemai.cc/v1',
        apiKey: '',
        models: ['【满血A】gemini-3-flash-preview'],
        createdAt: Date.now() - 86400000 * 60,
      },
      {
        id: 'ak-demo-2',
        name: 'grok-3',
        apiBase: 'https://api.gemai.cc/v1',
        apiKey: '',
        models: ['grok-3'],
        createdAt: Date.now() - 86400000 * 90,
      },
      {
        id: 'ak-demo-3',
        name: 'deepseek-v4-pro-202606',
        apiBase: 'https://tokenhub.tencentmaas.com/v1/chat/completions',
        apiKey: '',
        models: ['deepseek-v4-pro-202606'],
        createdAt: Date.now() - 86400000 * 60,
      },
    ]
    settingsObj.apiKeys = demos
    settingsObj.activeApiKeyId = demos[0].id
    // demos 也深克隆一次防 Vue 响应式 wrap
    await idb.put('settings', { key: 'apiKeys', value: JSON.parse(JSON.stringify(demos)) })
    await idb.put('settings', { key: 'activeApiKeyId', value: demos[0].id })
  }

  store.settings = settingsObj

  // 局域网配置共享：从电脑上的 local-sync.json 拉取共享配置（API 密钥/绘画接口），
  // 覆盖本机对应项——任何设备改过配置，其他设备打开应用即拿到最新版。
  // file:// 打开或服务不可达时静默跳过（用本机数据）。
  await pullSharedConfig(settingsObj)
  store.settings = settingsObj

  // 存储降级标志：IndexedDB 不可用时为 true（数据只存在内存，刷新即丢）——UI 需显眼提示
  store.storageFallback = idb.isFallback()

  store.ready = true
}

function sortSessions(list) {
  return [...list].sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
}

// ================= 人物卡 =================
export async function addCharacter(card) {
  await idb.put('characters', card)
  store.characters.unshift(card)
  return card
}

export async function updateCharacter(card) {
  card.updateTime = Date.now()
  await idb.put('characters', card)
  const i = store.characters.findIndex((c) => c.id === card.id)
  if (i >= 0) store.characters[i] = card
  else store.characters.unshift(card)
  return card
}

export async function removeCharacter(id) {
  await idb.delete('characters', id)
  store.characters = store.characters.filter((c) => c.id !== id)
}

export async function importCharacters(list) {
  let added = 0
  let updated = 0
  for (const c of list) {
    const exists = store.characters.some((x) => x.id === c.id)
    await idb.put('characters', c)
    if (exists) {
      const i = store.characters.findIndex((x) => x.id === c.id)
      store.characters[i] = c
      updated++
    } else {
      store.characters.unshift(c)
      added++
    }
  }
  return { added, updated }
}

// ================= 马甲 =================
export async function addPersona(p) {
  await idb.put('personas', p)
  store.personas.unshift(p)
  return p
}

export async function updatePersona(p) {
  p.updateTime = Date.now()
  await idb.put('personas', p)
  const i = store.personas.findIndex((x) => x.id === p.id)
  if (i >= 0) store.personas[i] = p
  else store.personas.unshift(p)
  return p
}

export async function removePersona(id) {
  await idb.delete('personas', id)
  store.personas = store.personas.filter((p) => p.id !== id)
}

export async function importPersonas(list) {
  let added = 0
  let updated = 0
  for (const p of list) {
    const exists = store.personas.some((x) => x.id === p.id)
    await idb.put('personas', p)
    if (exists) {
      const i = store.personas.findIndex((x) => x.id === p.id)
      store.personas[i] = p
      updated++
    } else {
      store.personas.unshift(p)
      added++
    }
  }
  return { added, updated }
}

// ================= 世界书库 =================
export async function addLorebook(lb) {
  await idb.put('lorebooks', lb)
  store.lorebooks.unshift(lb)
  return lb
}

export async function updateLorebook(lb) {
  lb.updateTime = Date.now()
  await idb.put('lorebooks', lb)
  const i = store.lorebooks.findIndex((x) => x.id === lb.id)
  if (i >= 0) store.lorebooks[i] = lb
  return lb
}

export async function removeLorebook(id) {
  await idb.delete('lorebooks', id)
  store.lorebooks = store.lorebooks.filter((x) => x.id !== id)
  // 若删除的是当前绑定，解除绑定
  const cfg = store.settings.lorebook || {}
  if (cfg.activeId === id) await setSetting('lorebook', { activeId: '' })
}

export function getLorebook(id) {
  return store.lorebooks.find((x) => x.id === id) || null
}

// 克隆一份世界书（列表 ⋯ 菜单的「克隆」）
export function duplicateLorebook(id) {
  const src = getLorebook(id)
  if (!src) return null
  const now = Date.now()
  const copy = JSON.parse(JSON.stringify(src))
  copy.id = genId('lb')
  copy.title = (src.title || '未命名') + ' 副本'
  copy.isPublic = false
  copy.createTime = now
  copy.updateTime = now
  addLorebook(copy)
  return copy
}

// ================= 破甲预设 =================
export async function addJailbreak(jb) {
  await idb.put('jailbreaks', jb)
  store.jailbreaks.unshift(jb)
  return jb
}

export async function updateJailbreak(jb) {
  jb.updateTime = Date.now()
  await idb.put('jailbreaks', jb)
  const i = store.jailbreaks.findIndex((x) => x.id === jb.id)
  if (i >= 0) store.jailbreaks[i] = jb
  return jb
}

export async function removeJailbreak(id) {
  await idb.delete('jailbreaks', id)
  store.jailbreaks = store.jailbreaks.filter((x) => x.id !== id)
}

export function getJailbreak(id) {
  return store.jailbreaks.find((x) => x.id === id) || null
}

// 复制一份破甲预设（卡片 ⋯ 菜单的「复制」）
export function duplicateJailbreak(id) {
  const src = getJailbreak(id)
  if (!src) return null
  const now = Date.now()
  const copy = JSON.parse(JSON.stringify(src))
  copy.id = genId('jb')
  copy.title = (src.title || '未命名') + ' 副本'
  copy.status = 'draft'
  copy.createTime = now
  copy.updateTime = now
  addJailbreak(copy)
  return copy
}

// ================= 绘画接口 =================
// settings.imageApis = [{id, name, type:'sd-webui'|'openai', apiBase, apiKey, model, createTime}]
// settings.activeImageApiId
export async function addImageApi(api) {
  const list = Array.isArray(store.settings.imageApis) ? store.settings.imageApis.slice() : []
  list.push(api)
  await setSetting('imageApis', list)
  if (!store.settings.activeImageApiId) await setSetting('activeImageApiId', api.id)
  return api
}

export async function updateImageApi(api) {
  const list = Array.isArray(store.settings.imageApis) ? store.settings.imageApis.slice() : []
  const i = list.findIndex((x) => x.id === api.id)
  if (i >= 0) list[i] = api
  await setSetting('imageApis', list)
  return api
}

export async function removeImageApi(id) {
  const list = (store.settings.imageApis || []).filter((x) => x.id !== id)
  await setSetting('imageApis', list)
  if (store.settings.activeImageApiId === id) {
    await setSetting('activeImageApiId', list[0] ? list[0].id : '')
  }
}

export function getActiveImageApi() {
  const list = store.settings.imageApis || []
  return list.find((x) => x.id === store.settings.activeImageApiId) || list[0] || null
}

export async function setActiveImageApi(id) {
  await setSetting('activeImageApiId', id)
}

// 用户头像（个人中心，生成或上传的 dataURL/URL）
export async function setUserAvatar(url) {
  await setSetting('userAvatar', url || '')
}

// ================= 会话 =================
export async function createSession({ characterId, title }) {
  const now = Date.now()
  const session = {
    id: genId('s'),
    characterId: characterId || null,
    title: title || '新会话',
    createTime: now,
    updateTime: now,
  }
  await idb.put('sessions', session)
  store.sessions = sortSessions([session, ...store.sessions])
  return session
}

export async function updateSession(session) {
  session.updateTime = Date.now()
  await idb.put('sessions', session)
  const i = store.sessions.findIndex((s) => s.id === session.id)
  if (i >= 0) store.sessions[i] = session
  store.sessions = sortSessions(store.sessions)
  return session
}

export async function removeSession(id) {
  await idb.delete('sessions', id)
  const msgs = await idb.getByIndex('messages', 'sessionId', id)
  if (msgs.length) await idb.bulkDelete('messages', msgs.map((m) => m.id))
  store.sessions = store.sessions.filter((s) => s.id !== id)
}

export function getSession(id) {
  return store.sessions.find((s) => s.id === id) || null
}

// ================= 消息 =================
export async function loadMessages(sessionId) {
  const list = await idb.getByIndex('messages', 'sessionId', sessionId)
  return list.sort((a, b) => (a.time || 0) - (b.time || 0))
}

export async function appendMessage(msg) {
  await idb.put('messages', msg)
  return msg
}

export async function updateMessage(msg) {
  await idb.put('messages', msg)
  return msg
}

export async function removeMessage(id) {
  await idb.delete('messages', id)
}

export async function clearMessages(sessionId) {
  const msgs = await idb.getByIndex('messages', 'sessionId', sessionId)
  if (msgs.length) await idb.bulkDelete('messages', msgs.map((m) => m.id))
}

// ================= 设置 =================
export async function setSetting(key, value) {
  // 兜底深克隆：Vue reactive proxy 无法被 IDB structured clone
  // 此前调用方各自 clone 易漏（如 updateApiKey 拼的 next 数组里残留 proxy），
  // 这里统一一道防线；纯对象代价是 1 次 JSON 往返，可接受。
  const safe = value === undefined || value === null ? value : JSON.parse(JSON.stringify(value))
  await idb.put('settings', { key, value: safe })
  store.settings[key] = safe
  // 局域网配置共享：这些 key 变更时自动写回电脑上的 local-sync.json
  if (SYNC_KEYS.includes(key)) queueSyncToServer()
}

export function getSetting(key, fallback) {
  return store.settings[key] !== undefined ? store.settings[key] : fallback
}

// ================= API Key 集合（v2：多条 API 配置）=================
// 旧结构：settings.llm = { apiBase, apiKey, model, temperature, topP, maxTokens }
// 新结构：settings.apiKeys = [{id, name, apiBase, apiKey, models:[], createdAt}]
//       + settings.activeApiKeyId
//       + settings.llm 保留全局参数（temperature/topP/maxTokens，不再含 api*）
export async function addApiKey(data) {
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const id = 'ak-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const item = {
    id,
    name: data.name || '未命名',
    apiBase: data.apiBase || '',
    apiKey: data.apiKey || '',
    models: Array.isArray(data.models) ? data.models : [],
    // 当前激活模型（属于这个 key 的「选中模型」），未填时回退用 models[0]
    activeModel: data.activeModel || '',
    createdAt: data.createdAt || Date.now(),
  }
  const next = [...list, item]
  await setSetting('apiKeys', next)
  // 若还没有激活项，自动激活第一个
  if (!store.settings.activeApiKeyId) {
    await setSetting('activeApiKeyId', id)
  }
  return item
}

export async function updateApiKey(id, patch) {
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const next = list.map((k) => (k.id === id ? { ...k, ...patch } : k))
  await setSetting('apiKeys', next)
  return next.find((k) => k.id === id)
}

export async function removeApiKey(id) {
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const next = list.filter((k) => k.id !== id)
  await setSetting('apiKeys', next)
  if (store.settings.activeApiKeyId === id) {
    await setSetting('activeApiKeyId', next[0] ? next[0].id : '')
  }
  return next
}

export async function setActiveApiKey(id) {
  await setSetting('activeApiKeyId', id || '')
}

// 一次性切到「指定 key + 指定模型」，用于聊天抽屉的单一下拉选择
//   - 若 model 属于当前 key，直接切 activeApiKeyId
//   - 否则需要先把 activeApiKeyId 切到 model 所属 key，再把该 key 的 activeModel 设为 model
export async function setActiveModel(apiKeyId, modelName) {
  if (!apiKeyId) return
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const key = list.find((k) => k.id === apiKeyId)
  if (!key) return
  // 写入该 key 的 activeModel，再切换激活 key
  const next = list.map((k) => (k.id === apiKeyId ? { ...k, activeModel: modelName } : k))
  await setSetting('apiKeys', next)
  await setSetting('activeApiKeyId', apiKeyId)
}

// 取当前激活的 API key 完整对象（可能为 null）
export function getActiveApiKey() {
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const id = store.settings.activeApiKeyId
  return list.find((k) => k.id === id) || list[0] || null
}

// ================= 全量备份 / 恢复 =================
// 纯本地应用没有云端，备份文件就是唯一的数据保险
export async function exportAllData() {
  const [characters, personas, sessions, messages, settings, jailbreaks, lorebooks] = await Promise.all([
    idb.getAll('characters'),
    idb.getAll('personas'),
    idb.getAll('sessions'),
    idb.getAll('messages'),
    idb.getAll('settings'),
    idb.getAll('jailbreaks'),
    idb.getAll('lorebooks'),
  ])
  return {
    type: 'ai-character-chat-backup',
    version: 2,
    exportTime: Date.now(),
    characters: characters.length ? characters : store.characters,
    personas: personas.length ? personas : store.personas,
    sessions: sessions.length ? sessions : store.sessions,
    messages: messages.length ? messages : [],
    jailbreaks: jailbreaks.length ? jailbreaks : store.jailbreaks,
    lorebooks: lorebooks.length ? lorebooks : store.lorebooks,
    settings: settings.reduce((acc, s) => {
      acc[s.key] = s.value
      return acc
    }, {}),
  }
}

// 恢复备份：整体覆盖写入本地库，并刷新内存状态
export async function importAllData(data) {
  if (!data || typeof data !== 'object') throw new Error('备份文件格式不正确')

  const characters = Array.isArray(data.characters) ? data.characters : []
  const personas = Array.isArray(data.personas) ? data.personas : []
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const messages = Array.isArray(data.messages) ? data.messages : []
  const jailbreaks = Array.isArray(data.jailbreaks) ? data.jailbreaks : []
  const lorebooks = Array.isArray(data.lorebooks) ? data.lorebooks : []

  if (characters.length) await idb.bulkPut('characters', characters)
  if (personas.length) await idb.bulkPut('personas', personas)
  if (sessions.length) await idb.bulkPut('sessions', sessions)
  if (messages.length) await idb.bulkPut('messages', messages)
  if (jailbreaks.length) await idb.bulkPut('jailbreaks', jailbreaks)
  if (lorebooks.length) await idb.bulkPut('lorebooks', lorebooks)

  if (data.settings && typeof data.settings === 'object') {
    for (const key of Object.keys(data.settings)) {
      await setSetting(key, data.settings[key])
    }
  }

  // 刷新内存状态
  store.characters = characters.length ? characters : store.characters
  store.personas = personas.length ? personas : store.personas
  store.sessions = sessions.length ? sortSessions(sessions) : store.sessions
  if (jailbreaks.length) store.jailbreaks = jailbreaks
  if (lorebooks.length) store.lorebooks = lorebooks

  return {
    characters: characters.length,
    personas: personas.length,
    sessions: sessions.length,
    messages: messages.length,
    jailbreaks: jailbreaks.length,
    lorebooks: lorebooks.length,
  }
}
