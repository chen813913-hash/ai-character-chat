<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ChatMessage from '../components/ChatMessage.vue'
import SmartImage from '../components/SmartImage.vue'
import LorebookHits from '../components/LorebookHits.vue'
import ModelSettingsDrawer from '../components/ModelSettingsDrawer.vue'
import ChatSettingsDrawer from '../components/ChatSettingsDrawer.vue'
import ImageGenModal from '../components/ImageGenModal.vue'
import OpeningGreetingModal from '../components/OpeningGreetingModal.vue'
import {
  store,
  genId,
  createSession,
  updateSession,
  removeSession,
  loadMessages,
  appendMessage,
  updateMessage,
  removeMessage,
  clearMessages,
} from '../store/useDataStore.js'
import {
  matchLorebookEntries,
  buildContextText,
  buildLorebookPrompt,
} from '../utils/lorebook.js'
import { buildPromptMessages, callLLM } from '../utils/llm.js'
import { downloadJson } from '../utils/io.js'
import { getActiveImageApi } from '../store/useDataStore.js'
import { mergeStoryState, normalizeStoryState, parseStateUpdate, safeRichHtml, storyStateToPrompt } from '../utils/storyState.js'
import OpeningContentRenderer from '../components/OpeningContentRenderer.vue'
import { hasOpeningContent, normalizeOpeningContent } from '../utils/openingContent.js'

const router = useRouter()
const route = useRoute()

// ---- 状态 ----
const messages = ref([])
const sessions = computed(() => store.sessions)
const personas = computed(() => store.personas)
const activeSessionId = ref('')
const selectedPersona = ref('')
const inputText = ref('')
const notice = ref('')
const streamingId = ref('')
let abortController = null

function flash(msg) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 3000)
}

const currentSession = computed(
  () => store.sessions.find((s) => s.id === activeSessionId.value) || null
)
const character = computed(() => {
  const cid = currentSession.value && currentSession.value.characterId
  return (
    store.characters.find((c) => c.id === cid) || store.characters[0] || null
  )
})
const persona = computed(
  () => personas.value.find((p) => p.id === selectedPersona.value) || null
)

// ---- 世界书匹配 ----
const SCAN_DEPTH = computed(() => {
  const llm = store.settings.llm || {}
  return typeof llm.historyDepth === 'number' && llm.historyDepth > 0
    ? Math.min(llm.historyDepth, 50)
    : 50
})

// 全局绑定的世界书（模型设置 → 世界书 里选择的预设）。
// 兼容旧版 activeId，同时支持联动导入后的 activeIds 多选。
const globalLorebooks = computed(() => {
  const cfg = store.settings.lorebook || {}
  const ids = Array.isArray(cfg.activeIds) ? cfg.activeIds : (cfg.activeId ? [cfg.activeId] : [])
  return (store.lorebooks || []).filter((x) => ids.includes(x.id))
})

// 角色卡内嵌世界书 + 绑定的独立世界书 + 全局世界书一起参与匹配。
// 一个人物可以绑定多本书，全局也可以同时启用多本书。
const lorebookHits = computed(() => {
  const c = character.value
  const embedded = (c && c.lorebook && c.lorebook.entries) || []
  const linkedIds = c && Array.isArray(c.lorebookIds) ? c.lorebookIds : []
  const linked = (store.lorebooks || [])
    .filter((x) => linkedIds.includes(x.id))
    .flatMap((x) => x.entries || [])
  const global = globalLorebooks.value.flatMap((x) => x.entries || [])
  return matchLorebookEntries(
    [...global, ...linked, ...embedded],
    buildContextText(messages.value, SCAN_DEPTH.value)
  )
})
const lorebookPrompt = computed(() => buildLorebookPrompt(lorebookHits.value))

// ---- 道具 ----
const propList = computed(() => {
  const list =
    character.value && Array.isArray(character.value.props) ? character.value.props : []
  return list.filter((p) => p && (p.name || p.prompt))
})
function useProp(p) {
  inputText.value = p.prompt || ''
  closePopovers()
}

// ---- 工具栏 4 个 popover ----
const activePopover = ref('') // '' | 'model' | 'chat' | 'props' | 'enhance'
function togglePopover(name) {
  activePopover.value = activePopover.value === name ? '' : name
}
function closePopovers() {
  activePopover.value = ''
}

// ---- 增强开关（独立状态，刷新页面丢失；占位就足够）----
const enhanceFlags = ref({
  lorebook: true,
  status_bar: true,
  mes_example: true,
  post_history: true,
})
const enhanceCount = computed(
  () => Object.values(enhanceFlags.value).filter(Boolean).length
)

// 计算增强项的可启用性
const enhanceItems = computed(() => {
  const c = character.value
  return [
    {
      key: 'lorebook',
      label: '世界书命中',
      desc: '按当前对话关键词自动检索并注入相关条目',
      available: !!(c && c.lorebook && c.lorebook.entries && c.lorebook.entries.length),
      hits: lorebookHits.value.length,
    },
    {
      key: 'status_bar',
      label: '状态栏注入',
      desc: '把角色模板状态栏追加到 system 末尾',
      available: !!(c && c.status_bar && c.status_bar.trim()),
      preview: c && c.status_bar ? c.status_bar.split('\n')[0].slice(0, 24) : '',
    },
    {
      key: 'mes_example',
      label: '对话示例',
      desc: '让模型模仿示例的对话格式与风格',
      available: !!(c && c.mes_example && c.mes_example.trim()),
    },
    {
      key: 'post_history',
      label: '历史后指令',
      desc: '在历史消息之后追加最后一条增强指令',
      available: !!(c && c.post_history_instructions && c.post_history_instructions.trim()),
    },
  ]
})

// 计算聊天设置项
const chatSettingSummary = computed(() => {
  const total = messages.value.length
  const userN = messages.value.filter((m) => m.role === 'user').length
  const aiN = messages.value.filter((m) => m.role === 'ai').length
  return { total, user: userN, ai: aiN }
})

// ---- 模型配置摘要 ----
// 激活的 API key 完整对象
const activeKey = computed(() => {
  const list = Array.isArray(store.settings.apiKeys) ? store.settings.apiKeys : []
  const id = store.settings.activeApiKeyId
  return list.find((k) => k.id === id) || list[0] || null
})
const llmConfig = computed(() => store.settings.llm || {})
const modelSummary = computed(() => {
  const k = activeKey.value
  const cfg = llmConfig.value
  if (!k) return { name: '未配置', base: '', model: '', temp: cfg.temperature ?? '—', max: cfg.maxTokens || '—', ready: false }
  return {
    name: k.name || '未命名',
    base: k.apiBase || '',
    model: (k.models && k.models[0]) || '',
    temp: typeof cfg.temperature === 'number' ? cfg.temperature : '—',
    max: cfg.maxTokens || '—',
    ready: !!k.apiBase,
  }
})

// ---- 工具栏按钮：badge 数 ----
const messageCountBadge = computed(() => chatSettingSummary.value.total)

// ---- 聊天界面设置（聊天设置抽屉写入 settings.chatUi）----
const chatUi = computed(() => {
  const u = store.settings.chatUi || {}
  return {
    bgImage: u.bgImage || '',
    showThinking: u.showThinking !== false,
    autoScroll: u.autoScroll !== false,
    disableJb: !!u.disableJb,
    narrationStyle: ['plain', 'light', 'immersive'].includes(u.narrationStyle) ? u.narrationStyle : 'light',
    innerThoughtMode: ['disabled', 'as-needed', 'frequent'].includes(u.innerThoughtMode) ? u.innerThoughtMode : 'as-needed',
    showStoryState: u.showStoryState !== false,
    chatFontSize: typeof u.chatFontSize === 'number' ? u.chatFontSize : 14,
    chatBubbleMax: typeof u.chatBubbleMax === 'number' ? u.chatBubbleMax : 88,
  }
})

// 聊天区尺寸变量（字体大小 / 气泡宽度，由聊天设置滑块控制）
const chatVars = computed(() => ({
  '--chat-fs': chatUi.value.chatFontSize + 'px',
  '--chat-max': chatUi.value.chatBubbleMax + '%',
}))

// 聊天区背景（聊天框背景图）
const chatBgStyle = computed(() => {
  if (!chatUi.value.bgImage) return {}
  return {
    // url 必须带引号：data URI（如 SVG utf8）含单引号/分号时，无引号 url 是非法 CSS 会被浏览器整条丢弃
    backgroundImage: `url("${chatUi.value.bgImage}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
})

// 关键记忆数量
const pinnedCount = computed(() => messages.value.filter((m) => m && m.pinned).length)

const currentStoryState = computed(() => {
  let state = normalizeStoryState(currentSession.value && currentSession.value.storyState)
  for (const message of messages.value) {
    if (message && message.statePatch) state = mergeStoryState(state, message.statePatch)
  }
  return state
})
const hasCurrentStoryState = computed(() => Object.values(currentStoryState.value).some((value) => Array.isArray(value) ? value.length : !!value))

// 图钉：标记/取消关键记忆（上限 30 条）
const PIN_MAX = 30
async function togglePin(msg) {
  if (!msg) return
  if (!msg.pinned && pinnedCount.value >= PIN_MAX) {
    flash(`关键记忆最多 ${PIN_MAX} 条，请先取消一些`)
    return
  }
  msg.pinned = !msg.pinned
  await updateMessage(msg)
  flash(msg.pinned ? '已钉住为关键记忆，会始终注入给模型' : '已取消关键记忆')
}

// 编辑消息（用户 + AI 都可编辑；编辑后候选列表同步为单候选）
async function onSaveEdit({ message, text }) {
  const t = (text || '').trim()
  if (!t) return
  message.content = t
  if (Array.isArray(message.candidates) && message.candidates.length) {
    message.candidates = [t]
    message.candidateIndex = 0
  }
  await updateMessage(message)
  flash('消息已更新')
}

// 关键记忆定位：滚动到该消息并高亮闪烁
const highlightId = ref('')
function locateMessage(msg) {
  if (!msg) return
  const el = document.getElementById('msg-' + msg.id)
  if (!el) {
    flash('未找到该消息（可能已被删除）')
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightId.value = msg.id
  setTimeout(() => (highlightId.value = ''), 2000)
}

// 自动滚动到底部（受「自动滚动」开关控制）
const messageListRef = ref(null)
async function scrollToBottom() {
  if (!chatUi.value.autoScroll) return
  await new Promise((r) => setTimeout(r, 50))
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}
watch(messages, () => scrollToBottom(), { deep: true })

// 聊天设置抽屉
const showChatSettings = ref(false)
const showOpeningGreeting = ref(false)
const pendingOpeningSession = ref(null)
const openingRememberKey = computed(() => {
  const c = character.value
  return c ? 'openingGreeting:' + c.id : ''
})

function getOpeningChoice(c) {
  if (!c) return null
  const list = []
  const rich = normalizeOpeningContent(c.openingContent || c.opening_content)
  const hasRich = hasOpeningContent(rich)
  if (hasRich) {
    // 富内容开场是唯一开场：启用且存在内容块时不再显示传统开场选项
    list.push({ id: 'rich-opening', title: '富内容开场', summary: `${rich.blocks.length} 个内容块`, type: 'blocks', content: rich, isRich: true })
  } else {
    const raw = c.first_mes || ''
    if (String(raw).trim()) list.push({ id: 'default', title: '默认开场白', content: String(raw), type: 'text', isDefault: true })
    const alternates = Array.isArray(c.alternate_greetings) ? c.alternate_greetings : []
    alternates.forEach((item, index) => {
      const content = typeof item === 'string' ? item : item && (item.content || item.text || item.message)
      if (String(content || '').trim()) {
        list.push({
          id: String(item && item.id || 'alternate-' + index),
          title: String(item && (item.title || item.name) || '开场白 ' + (index + 1)),
          summary: String(item && (item.summary || item.description) || '').trim(),
          content: String(content),
          type: String(item && item.type || 'text'),
        })
      }
    })
  }
  if (!list.length) return null
  let savedId = ''
  try { savedId = localStorage.getItem('ai-character-chat:' + 'openingGreeting:' + c.id) || '' } catch (e) {}
  return list.find((x) => x.id === savedId) || (list.length === 1 ? list[0] : null)
}

// 新会话开场白：存在多种传统开场或富内容开场且没有记住选择时弹出选择器。
async function seedGreeting(session, choice = null) {
  const c = store.characters.find((x) => x.id === session.characterId) || store.characters[0]
  if (!c) return false
  const selected = choice || getOpeningChoice(c)
  if (!selected) {
    pendingOpeningSession.value = session
    showOpeningGreeting.value = true
    return false
  }

  const isRich = selected.type === 'blocks' || selected.isRich
  const text = isRich
    ? '（富内容开场）'
    : selected.type === 'text'
      ? selected.content
      : selected.type === 'image'
        ? '（开场图片）'
        : '（富内容开场）'
  const greeting = {
    id: genId('m'),
    sessionId: session.id,
    role: 'ai',
    content: text,
    candidates: [text],
    candidateIndex: 0,
    openingId: selected.id,
    openingType: isRich ? 'blocks' : (selected.type || 'text'),
    openingBlocks: isRich ? selected.content : null,
    openingContent: !isRich && selected.type === 'html' ? safeRichHtml(selected.content) : '',
    image: !isRich && selected.type === 'image' ? selected.content : '',
    time: Date.now(),
  }
  await appendMessage(greeting)
  return true
}

async function onOpeningSelected(choice) {
  const session = pendingOpeningSession.value
  if (!session || !choice || !choice.content) return
  if (choice.remember) {
    try { localStorage.setItem('ai-character-chat:openingGreeting:' + session.characterId, choice.id) } catch (e) {}
  }
  pendingOpeningSession.value = null
  await seedGreeting(session, choice)
  showOpeningGreeting.value = false
  await loadSessionMessages()
}

function onOpeningClosed(open) {
  showOpeningGreeting.value = open
  if (!open) pendingOpeningSession.value = null
}

async function loadSessionMessages() {
  if (!activeSessionId.value) {
    messages.value = []
    return
  }
  messages.value = await loadMessages(activeSessionId.value)
}

async function selectSession(id) {
  if (id === activeSessionId.value) return
  activeSessionId.value = id
  closePopovers()
  await loadSessionMessages()
}

watch(activeSessionId, () => loadSessionMessages())

onMounted(async () => {
  if (!selectedPersona.value) {
    selectedPersona.value = personas.value[0] ? personas.value[0].id : ''
  }

  const cid = route.query.characterId
  if (cid) {
    // 优先激活该角色最近使用的会话（刷新/再次进入不丢上下文）；
    // 只有显式 new=1（画廊「开始聊天」）才开新会话
    const isNew = route.query.new === '1'
    if (!isNew) {
      const existing = store.sessions
        .filter((s) => s.characterId === cid)
        .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))[0]
      if (existing) {
        activeSessionId.value = existing.id
        await loadSessionMessages()
        return
      }
    }
    const s = await createSession({ characterId: cid, title: '新会话' })
    activeSessionId.value = s.id
    await seedGreeting(s)
    await loadSessionMessages()
    return
  }

  if (!store.sessions.length) {
    const s = await createSession({
      characterId: character.value ? character.value.id : null,
      title: '新会话',
    })
    activeSessionId.value = s.id
    await seedGreeting(s)
  } else {
    activeSessionId.value = store.sessions[0].id
  }
  await loadSessionMessages()
})

// ---- 会话操作 ----
async function onNewSession() {
  const s = await createSession({
    characterId: character.value ? character.value.id : null,
    title: '新会话',
  })
  activeSessionId.value = s.id
  closePopovers()
  await seedGreeting(s)
  await loadSessionMessages()
}

async function onRenameSession(s) {
  const name = prompt('请输入新的会话名称：', s.title)
  if (name === null) return
  const title = name.trim() || s.title
  s.title = title
  await updateSession(s)
}

async function onDeleteSession(target) {
  const s = target || currentSession.value
  if (!s) return
  if (!confirm(`确定删除会话「${s.title}」？其消息会一并删除。`)) return
  await removeSession(s.id)
  // 若删的是当前活跃会话，切到列表里剩下的第一个
  if (activeSessionId.value === s.id) {
    activeSessionId.value = store.sessions[0] ? store.sessions[0].id : ''
    await loadSessionMessages()
  }
  flash('会话已删除')
}

// ---- 会话多选管理（批量/全选删除） ----
const selectionMode = ref(false)
const selectedSessionIds = ref([])
const selectedCount = computed(() => selectedSessionIds.value.length)
const allSelected = computed(() => sessions.value.length > 0 && selectedCount.value === sessions.value.length)

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  selectedSessionIds.value = []
}
function toggleSessionSelection(id) {
  const idx = selectedSessionIds.value.indexOf(id)
  if (idx >= 0) selectedSessionIds.value.splice(idx, 1)
  else selectedSessionIds.value.push(id)
}
function toggleSelectAllSessions() {
  selectedSessionIds.value = allSelected.value ? [] : sessions.value.map((s) => s.id)
}
async function onDeleteSelectedSessions() {
  if (!selectedCount.value) return
  if (!confirm(`确定删除选中的 ${selectedCount.value} 个会话？其消息会一并删除，不可恢复。`)) return
  const ids = new Set(selectedSessionIds.value)
  for (const id of ids) await removeSession(id)
  const activeDeleted = ids.has(activeSessionId.value)
  selectedSessionIds.value = []
  selectionMode.value = false
  if (activeDeleted) {
    activeSessionId.value = store.sessions[0] ? store.sessions[0].id : ''
    await loadSessionMessages()
  }
  flash(`已删除 ${ids.size} 个会话`)
}

async function onExportSession() {
  if (!currentSession.value) return
  downloadJson(`会话-${currentSession.value.title}.json`, {
    session: currentSession.value,
    character: character.value,
    messages: messages.value,
  })
  flash('对话已导出')
}

async function onClearSession() {
  if (!currentSession.value) return
  if (!confirm('确定清空当前会话的所有消息？')) return
  await clearMessages(currentSession.value.id)
  await loadSessionMessages()
  closePopovers()
  flash('消息已清空')
}

function backToGallery() {
  router.push('/')
}

function gotoSettings() {
  closePopovers()
  router.push('/settings')
}

// ---- 生成回复 ----
// 从设置 + 破甲预设库组装注入内容；未启用/未选中/类型不匹配/内容全空 → null
function buildJailbreakPrompt() {
  const cfg = store.settings.jailbreak || {}
  if (!cfg.enabled || !cfg.mode || cfg.mode === 'builtin' || !cfg.activeId) return null
  const j = (store.jailbreaks || []).find((x) => x.id === cfg.activeId)
  if (!j || j.type !== cfg.mode) return null

  if (j.type === 'simple') {
    const pre = j.systemPrompt || ''
    const rule = j.rulePrompt || ''
    const post = j.postPrompt || ''
    return pre.trim() || rule.trim() || post.trim() ? { pre, rule, post } : null
  }

  // 酒馆预设：把 JSON 里的 prompts 内容拼为前置注入
  let pre = ''
  try {
    const o = JSON.parse(j.stJson || '{}')
    const ps = Array.isArray(o.prompts) ? o.prompts : []
    pre = ps.map((p) => (p && p.content) || '').filter(Boolean).join('\n\n')
  } catch (e) {
    return null
  }
  return pre.trim() ? { pre, rule: '', post: '' } : null
}

// onDelta：流式增量回调（打字机效果）；未配置接口时直接返回占位文本
// extraInstruction：追加在历史末尾、不显示在聊天记录里的指令（继续对话用）
async function generateReply(historyForPrompt, onDelta, extraInstruction = '') {
  const k = activeKey.value
  const params = store.settings.llm || {}

  if (!k || !k.apiBase) {
    return {
      text: '（未配置 LLM 接口，这是一条占位回复。请到「API 密钥」页添加 API Key 后再试。）',
      ok: false,
    }
  }

  const config = {
    apiBase: k.apiBase,
    apiKey: k.apiKey,
    model: k.activeModel || (k.models && k.models[0]) || 'gpt-3.5-turbo',
    temperature: typeof params.temperature === 'number' ? params.temperature : 0.8,
    topP: typeof params.topP === 'number' ? params.topP : 0.9,
    // 世界书状态栏模板很长，2048 会在状态栏中途截断。
    // 旧版默认 maxTokens 存的是 2048，这里把旧默认自动升级到 4096；用户显式调过其他值则尊重
    maxTokens: !params.maxTokens || params.maxTokens <= 2048 ? 4096 : params.maxTokens,
    stream: params.stream !== false,
    // Qwen3 等思考模型：关闭思考。思考内容走独立字段不产生可见文字，
    // 不关的话用户会面对几十秒的"空白生成中"，且额度被思考耗尽
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
  }

  // 组装破甲注入：聊天设置的「关闭破甲」可临时禁用
  const jbPrompt = chatUi.value.disableJb ? null : buildJailbreakPrompt()

  const payload = buildPromptMessages({
    character: character.value,
    persona: persona.value,
    messages: historyForPrompt,
    lorebookPrompt: enhanceFlags.value.lorebook ? lorebookPrompt.value : '',
    userInput: '',
    flags: enhanceFlags.value,
    jailbreak: jbPrompt,
    depth: typeof params.historyDepth === 'number' ? params.historyDepth : 0,
    narrationStyle: chatUi.value.narrationStyle,
    innerThoughtMode: chatUi.value.innerThoughtMode,
    storyStatePrompt: storyStateToPrompt(currentStoryState.value),
  })
  if (extraInstruction) payload.push({ role: 'user', content: extraInstruction })

  abortController = new AbortController()
  const text = await callLLM({
    config,
    messages: payload,
    signal: abortController.signal,
    onDelta,
  })
  return { text, ok: true }
}

/**
 * 统一生成流程（发送 / 重新生成共用）
 * 修复记录：
 * 1) 气泡不再提前出现——首个增量文本（或完整回复）到达时才创建，对齐"有字才出框"
 * 2) 更新内容必须走 messages 数组里的 reactive 代理。
 *    之前的 bug：把 raw 对象传进来直接改 .content，绕过了 proxy 的 set 拦截器，
 *    Vue 感知不到变化，气泡永远显示空（且 DB 里存的也是空）。
 * 3) 中断（停止按钮）时保留已生成的部分文本，不再被错误信息覆盖。
 */
async function runGeneration({ historyForPrompt, sessionId, existing = null, extraInstruction = '' }) {
  const msgId = existing ? existing.id : genId('m')
  streamingId.value = msgId

  // 重新生成时先把旧内容存下来（流式过程中 content 会被覆盖）
  const oldContent = existing ? existing.content || '' : ''

  let proxyMsg = existing || null
  let acc = ''

  // 首个增量到达时才把气泡放进列表；从数组取回代理引用再更新
  const ensureBubble = () => {
    if (proxyMsg) return proxyMsg
    const raw = {
      id: msgId,
      sessionId,
      role: 'ai',
      content: '',
      candidates: [],
      candidateIndex: 0,
      time: Date.now(),
    }
    messages.value.push(raw)
    // 关键：messages.value[i] 返回的是 reactive 代理，用它赋值才有响应性
    proxyMsg = messages.value[messages.value.length - 1]
    return proxyMsg
  }

  // 把当前气泡状态持久化
  const persist = async () => {
    if (!proxyMsg) return
    await updateMessage({
      id: msgId,
      sessionId,
      role: 'ai',
      content: proxyMsg.content,
      candidates: proxyMsg.candidates,
      candidateIndex: proxyMsg.candidateIndex,
      statePatch: proxyMsg.statePatch || null,
      time: proxyMsg.time,
    })
  }

  try {
    const { text, ok } = await generateReply(
      historyForPrompt,
      (delta) => {
      acc += delta
      const m = ensureBubble()
      m.content = acc // 打字机：每个增量实时上屏
      },
      extraInstruction
    )

    const parsedReply = parseStateUpdate(text || acc || '')
    const finalText = parsedReply.text || '（模型返回空内容）'
    const m = ensureBubble()
    m.content = finalText
    if (parsedReply.patch) m.statePatch = parsedReply.patch

    if (existing) {
      // 重新生成：旧内容保留为第一候选，新回复追加
      const list =
        Array.isArray(existing.candidates) && existing.candidates.length
          ? [...existing.candidates]
          : oldContent
            ? [oldContent]
            : []
      list.push(finalText)
      m.candidates = list
      m.candidateIndex = list.length - 1
    } else {
      m.candidates = [finalText]
      m.candidateIndex = 0
    }

    await persist()
    if (!ok) flash('未配置 API 地址，已使用占位回复')
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))
    const m = ensureBubble() // 一个字都没收到也要有气泡承载提示
    if (aborted) {
      m.content = acc || '（已停止，未生成内容）'
      flash('已停止生成')
    } else {
      const msg = `生成失败：${e && e.message ? e.message : e}`
      m.content = acc ? acc + '\n\n' + msg : msg
      flash('生成失败，详见气泡内提示')
    }
    m.candidates = [m.content]
    m.candidateIndex = 0
    await persist()
  } finally {
    streamingId.value = ''
    abortController = null
  }
}

async function onSend() {
  const text = inputText.value.trim()
  if (!text || streamingId.value) return

  closePopovers()
  if (!currentSession.value) await onNewSession()
  const session = currentSession.value
  if (!session) return

  const userMsg = {
    id: genId('m'),
    sessionId: session.id,
    role: 'user',
    content: text,
    time: Date.now(),
  }
  await appendMessage(userMsg)
  messages.value.push(userMsg)
  inputText.value = ''

  if (session.title === '新会话') {
    session.title = text.slice(0, 20)
    await updateSession(session)
  }

  // AI 气泡不再提前创建：等首个增量文本到达时才出现（见 runGeneration）
  await runGeneration({ historyForPrompt: messages.value.slice(), sessionId: session.id })
}

async function onSwipe({ message, dir }) {
  const list = message.candidates || []
  if (list.length <= 1) return
  let idx = message.candidateIndex || 0
  idx = dir === 'next' ? idx + 1 : idx - 1
  if (idx < 0) idx = list.length - 1
  if (idx >= list.length) idx = 0
  message.candidateIndex = idx
  message.content = list[idx]
  await updateMessage(message)
}

async function onRegenerate(msg) {
  if (streamingId.value) return
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  const history = messages.value.slice(0, idx)
  // existing 走统一生成流程：流式覆盖 content，旧回复保留为候选
  await runGeneration({ historyForPrompt: history, sessionId: msg.sessionId, existing: msg })
}

async function onDeleteMessage(msg) {
  await removeMessage(msg.id)
  messages.value = messages.value.filter((m) => m.id !== msg.id)
  flash('已删除该条消息')
}

function onStop() {
  if (abortController) abortController.abort()
  streamingId.value = ''
}

// ================= 输入框右侧「更多操作」菜单 =================
// 继续对话：不发用户消息，用隐藏指令让 AI 继续推进剧情
const CONTINUE_INSTRUCTION =
  '（系统提示：请以角色身份继续推进上面的剧情。自然衔接前文，推进事件发展，不要复述已有内容，不要跳出角色，不要替用户发言。）'

async function onContinue() {
  if (streamingId.value) return
  closePopovers()
  if (!currentSession.value) await onNewSession()
  const session = currentSession.value
  if (!session) return
  await runGeneration({
    historyForPrompt: messages.value.slice(),
    sessionId: session.id,
    extraInstruction: CONTINUE_INSTRUCTION,
  })
}

// 对话配图：两段式——文本 LLM 根据最近对话生成绘画提示词 → 绘画接口出图
const showImageGen = ref(false)
const imageGenPreset = ref({ title: '对话配图', prompt: '', width: 768, height: 512 })
const imageGenLoading = ref(false)

async function onImageGen() {
  closePopovers()
  if (streamingId.value) return
  const imageApi = getActiveImageApi()
  if (!imageApi) {
    flash('还没有绘画接口，请先到「个人中心 → 绘画接口」添加')
    return
  }
  const k = activeKey.value
  if (!k || !k.apiBase) {
    flash('对话配图需要文本 LLM 先生成提示词，请先配置 LLM 接口')
    return
  }
  if (!messages.value.length) {
    flash('还没有对话内容可配图')
    return
  }
  imageGenLoading.value = true
  try {
    const recent = messages.value.slice(-10)
    const payload = buildPromptMessages({
      character: character.value,
      persona: persona.value,
      messages: recent,
      lorebookPrompt: '',
      userInput: '',
      flags: { lorebook: false, status_bar: false, mes_example: false, post_history: false },
    })
    // 显式注入双方外观 + 剧情变化提取任务：
    // 画面 = 马甲外观 + 角色外观 + 对话场景；对话中的服装/动作变化（如"她穿上了白色连衣裙"）覆盖默认外貌
    const charName = character.value ? (character.value.displayName || character.value.name) || '' : ''
    const charLook = character.value
      ? String(character.value.appearance || character.value.description || '').trim()
      : ''
    const personaName = persona.value ? persona.value.name || '' : ''
    const personaLook = persona.value ? String(persona.value.persona_text || '').trim() : ''
    const taskLines = [
      '【画面人物】',
      '- AI 角色「' + (charName || '角色') + '」外貌：' + (charLook || '（见系统设定）'),
      persona.value
        ? '- 用户角色「' + personaName + '」外貌/设定：' + (personaLook || '（见系统设定）')
        : '',
      '',
      '【任务】根据上面的最近对话，生成"此刻画面"的绘画提示词：',
      '1. 画面主体按对话焦点决定：双方同框、或聚焦其中一方；',
      '2. 对话中提到的服装/动作/状态变化（例如"她穿上了白色连衣裙"、"走在小路上"）必须覆盖默认外貌与场景的对应部分；',
      '3. 环境与光影按对话描写补充；',
      '4. prompt 为英文标签（逗号分隔，质量词在前），promptZh 为对应的中文描述（方便用户阅读）。',
      '只输出一个 JSON 对象：{"prompt":"...","promptZh":"..."}，不要任何解释。',
    ]
      .filter((x) => x !== '')
      .join('\n')
    payload.push({ role: 'user', content: taskLines })
    const params = store.settings.llm || {}
    const text = await callLLM({
      config: {
        apiBase: k.apiBase,
        apiKey: k.apiKey,
        model: k.activeModel || (k.models && k.models[0]) || 'gpt-3.5-turbo',
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 1500,
        stream: false,
        extraBody: { chat_template_kwargs: { enable_thinking: false } },
      },
      messages: payload,
    })
    let prompt = String(text || '').trim()
    let promptZh = ''
    // 容错解析：优先取双语 JSON（{"prompt","promptZh"}），失败则整段当英文提示词
    const jsonMatch = prompt.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0])
        const en = String(obj.prompt || '').trim()
        const zh = String(obj.promptZh || '').trim()
        if (en) {
          prompt = en
          promptZh = zh
        }
      } catch (e) {
        /* JSON 解析失败，整段当提示词 */
      }
    }
    prompt = prompt.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^(prompt|提示词)\s*[:：]\s*/i, '')
    if (prompt.startsWith('{')) prompt = ''
    if (!prompt) throw new Error('文本模型未返回提示词')
    imageGenPreset.value = { title: '对话配图', prompt, promptZh, width: 768, height: 512 }
    showImageGen.value = true
  } catch (e) {
    flash('提示词生成失败：' + (e && e.message ? e.message : e))
  } finally {
    imageGenLoading.value = false
  }
}

// 使用生成的配图：插入一条带图的 AI 消息
async function onOpeningFormSubmit({ text }) {
  if (!text || streamingId.value) return
  inputText.value = text
  await onSend()
}

async function onUseChatImage(res) {
  const session = currentSession.value
  if (!session) return
  const m = {
    id: genId('m'),
    sessionId: session.id,
    role: 'ai',
    content: '🖼 已根据当前对话生成配图',
    image: res.dataUrl,
    time: Date.now(),
  }
  await appendMessage(m)
  messages.value.push(m)
  flash('配图已加入对话')
}

// 总结：把当前人物卡的历史对话总结成剧情走向 / 人物发展 / 人物关系 / 物品数量等
const summarizing = ref(false)
const SUMMARY_PROMPT =
  '请根据以上全部对话，输出一份剧情总结。第一行输出简短标题（不超过 20 字，用「」包裹，例如「偷拍到冰山班主任在办公室里挖矿」）。然后分条目涵盖：①剧情走向（按时间线）；②人物发展与状态变化；③人物关系变化；④重要物品/资源的获得与消耗（含数量）；⑤当前悬念与可能的走向。用简体中文，简洁清晰。'

async function onSummarize() {
  if (streamingId.value || summarizing.value) return
  closePopovers()
  if (!messages.value.length) {
    flash('还没有可总结的消息')
    return
  }
  const k = activeKey.value
  if (!k || !k.apiBase) {
    flash('未配置 LLM 接口，无法总结')
    return
  }
  const session = currentSession.value
  if (!session) return
  summarizing.value = true
  try {
    const payload = buildPromptMessages({
      character: character.value,
      persona: persona.value,
      messages: messages.value.slice(),
      lorebookPrompt: '',
      userInput: '',
      flags: { lorebook: false, status_bar: false, mes_example: false, post_history: false },
    })
    payload.push({ role: 'user', content: SUMMARY_PROMPT })
    abortController = new AbortController()
    const text = await callLLM({
      config: {
        apiBase: k.apiBase,
        apiKey: k.apiKey,
        model: k.activeModel || (k.models && k.models[0]) || 'gpt-3.5-turbo',
        temperature: 0.4,
        maxTokens: 2000,
        stream: false,
        // 思考模型（Qwen3 等）：关闭思考，避免额度耗尽 content 为空
        extraBody: { chat_template_kwargs: { enable_thinking: false } },
      },
      messages: payload,
      signal: abortController.signal,
    })
    const content = String(text || '').trim()
    if (!content) throw new Error('模型未返回内容')
    // 总结作为 AI 消息插入聊天流（点 📌 钉成关键记忆后，长对话截断时它始终保留）
    const m = {
      id: genId('m'),
      sessionId: session.id,
      role: 'ai',
      content,
      candidates: [],
      candidateIndex: 0,
      time: Date.now(),
    }
    await appendMessage(m)
    messages.value.push(m)
    flash('总结已插入聊天，点消息上的 📌 可设为关键记忆')
  } catch (e) {
    if (!(e && e.name === 'AbortError')) {
      flash('总结失败：' + (e && e.message ? e.message : e))
    }
  } finally {
    summarizing.value = false
    abortController = null
  }
}

// ================= AI 气泡 ⋮ 菜单：回滚 / 备份 / 插入 / 语音 =================
// 回滚：删除这条消息以及它之后的所有消息（回到发送前状态重新来）
async function onRollbackMessage(msg) {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  const removed = messages.value.length - idx
  if (!confirm(`回滚到这条消息之前？将删除它以及之后的 ${removed} 条消息，不可恢复。`)) return
  const removedList = messages.value.slice(idx)
  for (const m of removedList) await removeMessage(m.id)
  messages.value = messages.value.slice(0, idx)
  flash(`已回滚，删除了 ${removedList.length} 条消息`)
}

// 备份以上对话：把这条消息之前的所有消息导出为 JSON
function onBackupMessages(msg) {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx <= 0) {
    flash('这条消息之前没有可备份的消息')
    return
  }
  const slice = JSON.parse(JSON.stringify(messages.value.slice(0, idx)))
  downloadJson(`对话备份-前${slice.length}条-${new Date().toISOString().slice(0, 10)}.json`, {
    type: 'chat-partial-backup',
    sessionId: currentSession.value ? currentSession.value.id : '',
    characterId: character.value ? character.value.id : '',
    exportTime: Date.now(),
    messages: slice,
  })
  flash(`已备份该消息之前的 ${slice.length} 条消息`)
}

// 插入消息：在这条消息后插入一条可编辑的空白 AI 消息
async function onInsertMessage(msg) {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx < 0) return
  const newMsg = {
    id: genId('m'),
    sessionId: currentSession.value ? currentSession.value.id : msg.sessionId || '',
    role: 'ai',
    content: '（在此输入内容：点本条消息的 ✎ 编辑）',
    candidates: [],
    candidateIndex: 0,
    time: Date.now(),
  }
  await appendMessage(newMsg)
  messages.value.splice(idx + 1, 0, newMsg)
  flash('已插入一条消息，点 ✎ 编辑内容')
}

// 语音：预留
function onVoiceGen() {
  flash('🔊 语音生成未支持，TTS 接入后开放')
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶部条 -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0">
      <button
        @click="backToGallery"
        class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
      >
        ← 返回画廊
      </button>

      <div v-if="character" class="flex items-center gap-2 min-w-0">
        <div class="w-8 h-8 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-700 shrink-0">
          <SmartImage :src="character.avatar" :name="character.name" />
        </div>
        <div class="min-w-0">
          <div class="font-semibold truncate">{{ character.displayName || character.name }}</div>
          <div v-if="character.tags?.length" class="text-[11px] text-neutral-500 truncate">
            {{ character.tags.join(' · ') }}
          </div>
        </div>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <select
          v-model="selectedPersona"
          class="px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option v-for="p in personas" :key="p.id" :value="p.id">马甲 · {{ p.name }}</option>
        </select>

        <div class="relative">
          <button
            @click="activePopover = activePopover === 'session' ? '' : 'session'"
            class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center gap-1"
          >
            会话
            <span class="text-xs text-neutral-400">⋮</span>
          </button>
          <div
            v-if="activePopover === 'session'"
            class="absolute right-0 top-10 w-44 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-xl py-1 text-sm z-30"
          >
            <button
              @click="onNewSession(); activePopover=''"
              class="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >新建会话</button>
            <button
              @click="onExportSession(); activePopover=''"
              class="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >导出对话</button>
            <button
              @click="onClearSession()"
              class="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >清空消息</button>
            <button
              @click="onDeleteSession()"
              class="w-full text-left px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-red-500"
            >删除会话</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 提示条 -->
    <div
      v-if="notice"
      class="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow-lg"
    >
      {{ notice }}
    </div>

    <!-- 主体 -->
    <div class="flex flex-col md:flex-row flex-1 gap-2 sm:gap-3 min-h-0 p-2 sm:p-3">
      <!-- 手机：会话切换条（窄屏显示，替代侧栏） -->
      <div class="md:hidden flex items-center gap-2 shrink-0">
        <select
          :value="activeSessionId"
          @change="selectSession($event.target.value)"
          class="flex-1 min-w-0 px-2 py-2 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs truncate"
          title="切换会话"
        >
          <option v-for="s in sessions" :key="s.id" :value="s.id">{{ s.title }}</option>
        </select>
        <button
          @click="onNewSession"
          class="px-2.5 py-2 rounded-lg bg-indigo-500 text-white text-xs shrink-0"
          title="新建会话"
        >＋</button>
      </div>

      <!-- 会话侧栏（窄屏隐藏，由上方切换条替代） -->
      <aside class="w-44 shrink-0 hidden md:flex flex-col bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 overflow-y-auto">
        <h3 class="text-xs font-semibold text-neutral-400 mb-2 px-1 flex items-center justify-between shrink-0">
          <span>会话列表 <span class="text-[10px] text-neutral-500">{{ sessions.length }}</span></span>
          <button
            @click="toggleSelectionMode"
            :class="['text-[10px] px-1.5 py-0.5 rounded transition',
              selectionMode ? 'bg-indigo-500 text-white' : 'text-neutral-400 hover:text-indigo-500']"
            :disabled="!sessions.length"
            title="批量管理会话"
          >
            {{ selectionMode ? '取消' : '管理' }}
          </button>
        </h3>

        <!-- 多选模式 -->
        <template v-if="selectionMode">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="flex items-center gap-2 mb-1 px-2 py-1.5 rounded-lg cursor-pointer transition"
            :class="selectedSessionIds.includes(s.id) ? 'bg-indigo-500/15' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'"
            @click="toggleSessionSelection(s.id)"
          >
            <input
              type="checkbox"
              :checked="selectedSessionIds.includes(s.id)"
              @click.stop
              @change="toggleSessionSelection(s.id)"
              class="shrink-0 accent-indigo-500"
            />
            <span class="flex-1 text-sm truncate" :class="selectedSessionIds.includes(s.id) ? 'text-indigo-500' : ''">{{ s.title }}</span>
            <span v-if="activeSessionId === s.id" class="text-[10px] text-neutral-400 shrink-0">当前</span>
          </div>
          <p v-if="!sessions.length" class="text-xs text-neutral-400 px-1">暂无会话</p>

          <!-- 批量操作条 -->
          <div v-if="sessions.length" class="mt-auto pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-2 shrink-0">
            <label class="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer px-1">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAllSessions" class="accent-indigo-500" />
              {{ allSelected ? '取消全选' : '全选' }}
            </label>
            <button
              @click="onDeleteSelectedSessions"
              :disabled="!selectedCount"
              class="w-full px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs disabled:opacity-40 hover:bg-red-600 transition"
            >
              🗑 删除选中（{{ selectedCount }}）
            </button>
          </div>
        </template>

        <!-- 普通模式 -->
        <template v-else>
          <div
            v-for="s in sessions"
            :key="s.id"
            class="group flex items-center gap-1 mb-1"
          >
            <div
              @click="selectSession(s.id)"
              :class="[
                'flex-1 px-3 py-2 rounded-lg text-sm cursor-pointer transition truncate',
                activeSessionId === s.id
                  ? 'bg-indigo-500 text-white'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
              ]"
            >
              {{ s.title }}
            </div>
            <button
              @click.stop="onRenameSession(s)"
              class="px-1 text-xs text-neutral-400 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition"
              title="重命名"
            >
              ✎
            </button>
            <button
              @click.stop="onDeleteSession(s)"
              class="px-1 text-xs text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
              title="删除会话"
            >
              🗑
            </button>
          </div>
          <p v-if="!sessions.length" class="text-xs text-neutral-400 px-1">暂无会话</p>
        </template>
      </aside>

      <!-- 消息区 -->
      <section :style="{ ...chatBgStyle, ...chatVars }" class="flex-1 flex flex-col bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 min-h-0 relative">
        <!-- 背景遮罩：保证文字可读 -->
        <div v-if="chatBgStyle.backgroundImage" class="absolute inset-0 bg-black/45 pointer-events-none rounded-2xl"></div>
        <div ref="messageListRef" class="flex-1 overflow-y-auto p-4 space-y-4">
          <div
            v-for="m in messages"
            :key="m.id"
            :id="'msg-' + m.id"
            :class="['rounded-xl transition-colors duration-700', highlightId === m.id ? 'bg-indigo-500/20 ring-1 ring-indigo-400/60' : '']"
          >
            <ChatMessage
              :message="m"
              :avatar="character ? character.avatar : ''"
              :character-name="character ? (character.displayName || character.name) : 'AI'"
              :streaming="streamingId === m.id"
              :show-thinking="chatUi.showThinking"
              :show-story-state="chatUi.showStoryState"
              @swipe="onSwipe"
              @regenerate="onRegenerate"
              @delete="onDeleteMessage"
              @toggle-pin="togglePin"
              @save-edit="onSaveEdit"
              @rollback="onRollbackMessage"
              @backup="onBackupMessages"
              @insert="onInsertMessage"
              @voice="onVoiceGen"
              @opening-form="onOpeningFormSubmit"
            />
          </div>
          <p v-if="!messages.length" class="text-center text-neutral-400 py-10">
            还没有消息，说点什么吧
          </p>
        </div>

        <!-- 世界书命中（折叠条）-->
        <LorebookHits :hits="lorebookHits" :depth="SCAN_DEPTH" />

        <!-- 输入区 -->
        <div class="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0">
          <!-- 道具预览（仅当有道具时显示，作为快速访问）-->
          <div
            v-if="propList.length"
            class="mb-2 flex flex-wrap gap-1.5"
          >
            <button
              v-for="(p, i) in propList.slice(0, 4)"
              :key="i"
              @click="useProp(p)"
              :title="p.prompt || p.name"
              class="px-2.5 py-1 text-xs rounded-full border border-neutral-300 dark:border-neutral-700 hover:border-indigo-400 hover:text-indigo-500 transition"
            >
              {{ p.icon || '🎁' }} {{ p.name }}
            </button>
            <span
              v-if="propList.length > 4"
              class="px-2 py-1 text-xs text-neutral-400"
            >还有 {{ propList.length - 4 }} 件</span>
          </div>

          <!-- 角色头 banner + 输入框 -->
          <div
            class="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/40 focus-within:border-indigo-400 transition"
          >
            <!-- 角色行 -->
            <div class="flex items-center gap-2 px-3 pt-2.5 pb-1">
              <div
                v-if="character"
                class="w-6 h-6 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-700 shrink-0"
              >
                <SmartImage :src="character.avatar" :name="character.name" />
              </div>
              <span class="text-xs text-neutral-600 dark:text-neutral-400">
                {{ character ? (character.displayName || character.name) : '未选择角色' }}
              </span>
              <span
                v-if="character && character.scenario"
                class="text-[11px] text-neutral-400 truncate flex-1"
              >
                · {{ character.scenario.slice(0, 30) }}
              </span>
            </div>

            <textarea
              v-model="inputText"
              rows="3"
              :placeholder="character ? `输入消息…（Enter 发送，Shift+Enter 换行）` : '请先在画廊选择角色'"
              @keydown.enter.exact.prevent="onSend"
              @focus="closePopovers"
              class="w-full bg-transparent px-4 pb-2 text-sm focus:outline-none resize-none"
            ></textarea>
          </div>

          <!-- 工具栏：4 个按键 + 计数 + 发送 -->
          <div class="mt-2 flex items-center gap-2 flex-wrap">
            <!-- 模型设置 -->
            <button
              @click="togglePopover('model')"
              :class="[
                'h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition',
                activePopover === 'model'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-neutral-900 dark:bg-black text-white hover:bg-neutral-700',
              ]"
            >
              <span>模型设置</span>
            </button>

            <!-- 聊天设置（抽屉） -->
            <button
              @click="showChatSettings = true"
              :class="[
                'h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition',
                'bg-neutral-900 dark:bg-black text-white hover:bg-neutral-700',
              ]"
              :aria-label="`聊天设置 · ${messageCountBadge} 条消息`"
            >
              <span>聊天设置</span>
              <span
                class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-[3px] bg-white/20 px-1 text-[9px] font-semibold tabular-nums leading-none"
                :title="`关键记忆 ${pinnedCount} 条`"
              >{{ messageCountBadge }}</span>
            </button>

            <!-- 道具 -->
            <div class="relative">
              <button
                @click="togglePopover('props')"
                :class="[
                  'h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition border',
                  activePopover === 'props'
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700',
                ]"
              >
                <span>道具</span>
                <span
                  v-if="propList.length"
                  class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-[3px] bg-black/15 dark:bg-white/15 px-1 text-[9px] font-semibold tabular-nums leading-none"
                >{{ propList.length }}</span>
              </button>
              <div
                v-if="activePopover === 'props'"
                class="absolute bottom-10 left-0 w-80 max-h-80 overflow-y-auto rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-2xl p-3 text-sm z-30"
              >
                <div class="font-semibold mb-2 flex items-center justify-between">
                  <span>道具</span>
                  <span class="text-[11px] text-neutral-400">{{ propList.length }} 件</span>
                </div>
                <div v-if="propList.length" class="grid grid-cols-1 gap-1.5">
                  <button
                    v-for="(p, i) in propList"
                    :key="i"
                    @click="useProp(p)"
                    class="flex items-center gap-2 px-2 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition text-left"
                  >
                    <span class="text-xl shrink-0">{{ p.icon || '🎁' }}</span>
                    <div class="min-w-0 flex-1">
                      <div class="font-medium text-xs truncate">{{ p.name }}</div>
                      <div v-if="p.prompt" class="text-[11px] text-neutral-500 truncate">{{ p.prompt }}</div>
                    </div>
                  </button>
                </div>
                <p v-else class="text-xs text-neutral-400 py-4 text-center">
                  当前角色未配置道具<br>可在角色编辑中添加
                </p>
              </div>
            </div>

            <!-- 增强 -->
            <div class="relative">
              <button
                @click="togglePopover('enhance')"
                :class="[
                  'h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition border',
                  activePopover === 'enhance'
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700',
                ]"
                :aria-label="`增强 · ${enhanceCount} 已启用`"
              >
                <span>增强</span>
                <span
                  class="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-[3px] bg-black/15 dark:bg-white/15 px-1 text-[9px] font-semibold tabular-nums leading-none"
                  :title="`${enhanceCount} 已启用`"
                >{{ enhanceCount }}</span>
              </button>
              <div
                v-if="activePopover === 'enhance'"
                class="absolute bottom-10 left-0 w-80 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-2xl p-3 text-sm z-30"
              >
                <div class="font-semibold mb-2 flex items-center justify-between">
                  <span>增强</span>
                  <span class="text-[11px] text-neutral-400">{{ enhanceCount }} / 4 已启用</span>
                </div>
                <div class="space-y-1">
                  <label
                    v-for="item in enhanceItems"
                    :key="item.key"
                    :class="[
                      'flex items-start gap-2 px-2 py-2 rounded-lg border transition',
                      item.available
                        ? 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700/40 cursor-pointer'
                        : 'border-dashed border-neutral-200 dark:border-neutral-800 opacity-50 cursor-not-allowed',
                    ]"
                  >
                    <input
                      type="checkbox"
                      v-model="enhanceFlags[item.key]"
                      :disabled="!item.available"
                      class="mt-0.5"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-medium flex items-center gap-1.5">
                        {{ item.label }}
                        <span v-if="item.key === 'lorebook' && item.hits > 0 && enhanceFlags[item.key]"
                          class="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-400">
                          命中 {{ item.hits }}
                        </span>
                        <span v-if="item.key === 'status_bar' && item.preview && enhanceFlags[item.key]"
                          class="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 truncate max-w-[120px]">
                          {{ item.preview }}
                        </span>
                      </div>
                      <div class="text-[11px] text-neutral-500 mt-0.5">{{ item.desc }}</div>
                      <div v-if="!item.available" class="text-[10px] text-neutral-400 mt-0.5">该角色未配置此项</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <!-- 右侧：更多操作菜单 + 占位提示 + 发送按钮 -->
            <div class="ml-auto flex items-center gap-2">
              <!-- 更多操作：继续对话 / 对话配图 / 总结 -->
              <div class="relative">
                <button
                  @click="togglePopover('more')"
                  :class="[
                    'w-9 h-9 rounded-full border flex items-center justify-center transition',
                    activePopover === 'more'
                      ? 'border-indigo-400 text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                      : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  ]"
                  title="继续对话 / 对话配图 / 总结"
                >
                  ✦
                </button>
                <div
                  v-if="activePopover === 'more'"
                  class="absolute bottom-11 right-0 w-44 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-2xl py-1 text-sm z-30"
                >
                  <button
                    @click="onContinue"
                    class="w-full text-left px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5"
                  >
                    <span>💬</span><span>继续对话</span>
                  </button>
                  <button
                    @click="onImageGen"
                    class="w-full text-left px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5"
                  >
                    <span>🖼</span><span>对话配图</span>
                  </button>
                  <button
                    @click="onSummarize"
                    :disabled="summarizing"
                    class="w-full text-left px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5 disabled:opacity-40"
                  >
                    <span>◐</span><span>{{ summarizing ? '总结中…' : '总结' }}</span>
                  </button>
                </div>
              </div>
              <span
                v-if="streamingId"
                class="text-[11px] text-neutral-500 flex items-center gap-1"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                生成中
              </span>
              <button
                v-if="streamingId"
                @click="onStop"
                class="w-9 h-9 rounded-full border border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center justify-center transition"
                title="停止生成"
              >
                ■
              </button>
              <button
                v-else
                @click="onSend"
                :disabled="!inputText.trim()"
                class="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shadow-md transition active:scale-95"
                title="发送"
              >
                ▶
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 背景遮罩：点击关闭 popover -->
    <div
      v-if="activePopover"
      @click="closePopovers"
      class="fixed inset-0 z-20"
    ></div>

    <!-- 模型设置抽屉（Teleport 到 body，独立 z-index）-->
    <ModelSettingsDrawer
      :model-value="activePopover === 'model'"
      @update:model-value="(v) => activePopover = v ? 'model' : ''"
    />

    <!-- 聊天设置抽屉（显示 / 关键记忆）-->
    <ChatSettingsDrawer
      :model-value="showChatSettings"
      @update:model-value="(v) => showChatSettings = v"
      :messages="messages"
      :character="character"
      @locate="locateMessage"
      @unpin="togglePin"
    />

    <!-- 对话配图生成弹窗 -->
    <ImageGenModal v-model="showImageGen" :preset="imageGenPreset" @use="onUseChatImage" />

    <!-- 新会话开场白选择 -->
    <OpeningGreetingModal
      :model-value="showOpeningGreeting"
      :character="character"
      @update:model-value="onOpeningClosed"
      @select="onOpeningSelected"
    />
  </div>
</template>