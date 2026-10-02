<script setup>
import { ref, computed } from 'vue'
import SmartImage from './SmartImage.vue'
import OpeningContentRenderer from './OpeningContentRenderer.vue'
import { normalizeStoryState, safeRichHtml } from '../utils/storyState.js'

const props = defineProps({
  message: { type: Object, required: true },
  avatar: { type: String, default: '' },
  characterName: { type: String, default: 'AI' },
  streaming: { type: Boolean, default: false },
  showThinking: { type: Boolean, default: true },
  showStoryState: { type: Boolean, default: true },
})
const emit = defineEmits(['swipe', 'regenerate', 'delete', 'togglePin', 'saveEdit', 'rollback', 'backup', 'insert', 'voice', 'opening-form'])

// 更多菜单（⋮）与原文预览
const menuOpen = ref(false)
const rawView = ref(false)
function closeMenu() {
  menuOpen.value = false
}
function act(fn) {
  closeMenu()
  fn()
}

// 删除本条消息
function onDelete() {
  emit('delete', props.message)
}

// 图钉：标记/取消关键记忆
function onTogglePin() {
  emit('togglePin', props.message)
}

// ---- 编辑模式（用户 + AI 都可编辑）----
const editing = ref(false)
const editText = ref('')
function startEdit() {
  editText.value = props.message.content || ''
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
function saveEdit() {
  emit('saveEdit', { message: props.message, text: editText.value })
  editing.value = false
}

// 有候选时展示当前候选，无候选则直接用 content
const displayContent = computed(() => {
  const m = props.message
  if (Array.isArray(m.candidates) && m.candidates.length) {
    return m.candidates[m.candidateIndex || 0] || ''
  }
  return m.content || ''
})

// 解析 <think>...</think> 思考内容（本地模型常见输出）
function extractThinking(raw) {
  const thinking = []
  const visible = String(raw || '').replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_all, body) => {
    const text = String(body || '').trim()
    if (text) thinking.push(text)
    return ''
  }).trim()
  return { visible, thinking: thinking.join('\n\n') }
}

// 叙事段落的统一类型：前端优先解析标签，普通旧消息再走符号兼容。
function normalizeSegmentType(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'dialogue' || t === 'speech') return 'dialogue'
  if (t === 'thought' || t === 'inner' || t === 'inner_thought' || t === 'monologue') return 'thought'
  return 'narration'
}

function pushSegment(list, type, text) {
  const value = String(text == null ? '' : text).trim()
  if (!value) return
  const normalized = normalizeSegmentType(type)
  const last = list[list.length - 1]
  if (last && last.type === normalized) last.text += '\n\n' + value
  else list.push({ type: normalized, text: (list.length ? '\n\n' : '') + value })
}

// 对没有标签的旧消息做兼容识别：
// 「台词」、『台词』、“台词” → 粉色；*内心*、（心想：...）→ 灰色斜体；其余 → 环境描写。
function parseAutoText(text) {
  const list = []
  const raw = String(text || '')
  const tokenRe = /「[^」\n]*」|『[^』\n]*』|“[^”\n]*”|"[^"\n]+"|\*[^*\n]+\*|（(?:心想|内心(?:OS)?|心声)[：:]?[\s\S]*?）|【(?:内心|内心OS|心声)[：:][\s\S]*?】/g
  let cursor = 0
  let match
  while ((match = tokenRe.exec(raw))) {
    pushSegment(list, 'narration', raw.slice(cursor, match.index))
    const token = match[0]
    if (/^[「『“"]/.test(token)) {
      pushSegment(list, 'dialogue', token)
    } else if (token[0] === '*') {
      pushSegment(list, 'thought', token.slice(1, -1))
    } else {
      const inner = token
        .replace(/^[（【]/, '')
        .replace(/[）】]$/, '')
        .replace(/^(?:心想|内心(?:OS)?|心声)[：:]?\s*/, '')
      pushSegment(list, 'thought', inner)
    }
    cursor = tokenRe.lastIndex
  }
  pushSegment(list, 'narration', raw.slice(cursor))
  return list
}

// 支持 [dialogue]...[/dialogue] 和 XML 写法；标签即使缺少结束符也不会直接显示给用户。
// 这是显示层的容错，不能代替提示词规则：模型仍然优先使用自然格式「台词」/*内心*/。
function parseTaggedText(text) {
  const raw = String(text || '')
  const list = []
  const tagRe = /(?:\[(\/)?(narration|dialogue|thought|action|description|inner|inner_thought|monologue)\]|<(\/)?(narration|dialogue|thought|action|description|inner|inner_thought|monologue)>)/gi
  let cursor = 0
  let currentType = 'narration'
  let sawTag = false
  let match

  const appendText = (value) => {
    if (!value) return
    if (currentType === 'narration') {
      parseAutoText(value).forEach((segment) => pushSegment(list, segment.type, segment.text))
    } else {
      pushSegment(list, currentType, value)
    }
  }

  while ((match = tagRe.exec(raw))) {
    sawTag = true
    appendText(raw.slice(cursor, match.index))
    const closing = !!(match[1] || match[3])
    const type = match[2] || match[4]
    currentType = closing ? 'narration' : normalizeSegmentType(type)
    cursor = tagRe.lastIndex
  }
  appendText(raw.slice(cursor))
  return sawTag ? list : null
}

function cleanResidualFormatTags(text) {
  return String(text || '')
    .replace(/\[\/?(?:narration|dialogue|thought|action|description|inner|inner_thought|monologue)\]/gi, '')
    .replace(/<\/?(?:narration|dialogue|thought|action|description|inner|inner_thought|monologue)>/gi, '')
}

function parseSegments(text, role) {
  const raw = String(text || '')
  if (!raw) return []
  if (role !== 'ai') return [{ type: 'plain', text: raw }]

  // 世界书状态栏：AI 可能输出 <details> 折叠块（HTML）和 ``` 围栏（markdown 代码）。
  // 先把这些特殊块切出来整段渲染，剩余文本再走叙事分色。
  const list = []
  // 闭合块优先；未闭合（生成被截断）时兜底吃到文本结尾，避免 <details> 标签直接显示
  const detailRe = /<details[\s\S]*?<\/details>|<details[\s\S]*$/gi
  let cursor = 0
  let match
  const pushText = (value) => {
    if (!value) return
    // 代码围栏：```lang ... ``` → 等宽代码段（去掉围栏标记）
    const fenceRe = /```[a-zA-Z]*\r?\n([\s\S]*?)```|```[a-zA-Z]*\r?\n([\s\S]*?)$/g
    let fc = 0
    let fm
    // 正文段必须继续走台词/内心识别（「台词」→粉色、*内心*→斜体），不能整段当 narration
    const pushNarration = (v) => {
      if (!v) return
      parseAutoText(cleanResidualFormatTags(v)).forEach((seg) => pushSegment(list, seg.type, seg.text))
    }
    while ((fm = fenceRe.exec(value))) {
      pushNarration(value.slice(fc, fm.index))
      const body = (fm[1] != null ? fm[1] : fm[2] || '').trim()
      if (body) list.push({ type: 'code', text: body })
      fc = fenceRe.lastIndex
    }
    pushNarration(value.slice(fc))
  }

  while ((match = detailRe.exec(raw))) {
    pushText(raw.slice(cursor, match.index))
    list.push({ type: 'html', text: match[0] })
    cursor = detailRe.lastIndex
  }
  pushText(raw.slice(cursor))

  // 没有任何特殊块时走原逻辑（保持旧消息渲染完全一致）
  if (!list.some((s) => s.type === 'html' || s.type === 'code')) {
    const tagged = parseTaggedText(raw)
    if (tagged) return tagged
    return parseAutoText(cleanResidualFormatTags(raw))
  }
  return list
}

// <details> HTML 段：安全过滤后交给 v-html 渲染（details/summary 原生折叠）。
// 模型经常不守规则：
// 1) 把内容包在 ```markdown 围栏里 → 剥掉围栏标记；
// 2) 输出模板残留的全角占位括号［...］ → 剥掉括号只留内容（状态栏内不会误伤）；
// 3) 纯文本行没有层次 → 按「字段：值」「【小节】」「分隔线」逐行结构化上色。
function htmlBlock(block) {
  const stripped = String(block.text || '')
    .replace(/```[a-zA-Z]*\r?\n?/g, '')
    .replace(/［|］/g, '')

  const lines = stripped.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim()
    if (!line) return '<div class="rich-gap"></div>'
    // 关键：含 HTML 标签的行必须原样输出，不能包 <div>——
    // summary 必须是 details 的直接子元素，隔一层 div 折叠头就失效（展开/收缩失灵）
    // 正则含 </xxx> 闭合标签（< 后允许 /）
    if (/<\/?[a-z!][^>]*>/i.test(line)) return line
    // 分隔线：----- ===== ———— 等
    if (/^[—\-＿=─＝~～*\s]{4,}$/.test(line)) return '<hr class="rich-hr" />'
    // 【小节】标题行（后面还能拖一点说明文字）
    const section = line.match(/^[【\[](.{1,24}?)[】\]]\s*(.*)$/)
    if (section) return `<div class="rich-section">【${section[1]}】${section[2]}</div>`
    // 「字段：值」行（字段名 ≤14 字，避免把长句误拆）
    const kv = line.match(/^([-•*]?\s*[^：:]{1,14}?)[：:]\s*(.*)$/)
    if (kv && kv[2]) {
      return `<div class="rich-field"><span class="rich-key">${kv[1].replace(/^[-•*]\s*/, '')}</span><span class="rich-sep">：</span><span class="rich-val">${kv[2]}</span></div>`
    }
    return `<div class="rich-line">${line}</div>`
  })
  return safeRichHtml(lines.join(''))
}

const parsed = computed(() => {
  const extracted = extractThinking(displayContent.value || '')
  return {
    visible: extracted.visible,
    thinking: extracted.thinking,
    segments: parseSegments(extracted.visible, props.message.role),
  }
})

function segmentClass(type) {
  if (props.message.role !== 'ai') return ''
  if (type === 'dialogue') return 'text-pink-500 dark:text-pink-400 font-medium'
  if (type === 'thought') return 'text-neutral-400 dark:text-neutral-400 italic opacity-90'
  return 'text-neutral-800 dark:text-neutral-100'
}

const storyState = computed(() => normalizeStoryState(props.message.statePatch))
const storyStateRows = computed(() => [
  ['地点', storyState.value.location],
  ['时间', storyState.value.time],
  ['心情', storyState.value.mood],
  ['关系', storyState.value.relationship],
  ['服装', storyState.value.outfit],
].filter((row) => row[1]))
const storyInventory = computed(() => storyState.value.inventory)
const storyFlags = computed(() => storyState.value.flags)
const hasStoryState = computed(() => storyStateRows.value.length || storyInventory.value.length || storyFlags.value.length)

const candidateCount = computed(() =>
  Array.isArray(props.message.candidates) ? props.message.candidates.length : 1
)
const candidateIndex = computed(() => (props.message.candidateIndex || 0) + 1)

// swipe 切换候选回复
function onSwipe(dir) {
  emit('swipe', { message: props.message, dir })
}

// 重新生成：追加一条新候选
function onRegenerate() {
  emit('regenerate', props.message)
}
</script>

<template>
  <div :class="['flex gap-3 group', message.role === 'user' ? 'flex-row-reverse' : 'flex-row']">
    <!-- 头像 -->
    <div class="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-neutral-200 dark:bg-neutral-700">
      <SmartImage v-if="message.role === 'ai'" :src="avatar" :name="characterName" />
      <div v-else class="w-full h-full flex items-center justify-center bg-indigo-500 text-white text-sm font-bold">
        你
      </div>
    </div>

    <!-- 气泡 -->
    <div
      :style="{ maxWidth: 'var(--chat-max, 88%)' }"
      :class="[
        'rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 leading-relaxed relative',
        message.role === 'user'
          ? 'bg-indigo-500 text-white rounded-tr-sm'
          : 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100 rounded-tl-sm shadow-sm',
      ]"
    >
      <!-- 右上角悬浮图标行（对齐微灵：预览原文 / 关键记忆 / 更多菜单） -->
      <div
        v-if="message.role === 'ai' && !editing"
        class="absolute -top-8 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition z-10"
      >
        <button
          @click="rawView = !rawView"
          :class="['w-7 h-7 rounded-full flex items-center justify-center text-xs transition',
            rawView ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-neutral-700 text-neutral-400 hover:text-indigo-500 shadow border border-neutral-200 dark:border-neutral-600']"
          :title="rawView ? '返回渲染视图' : '查看原始内容（含思考标记）'"
        >👁</button>
        <button
          @click="onTogglePin"
          :class="['w-7 h-7 rounded-full flex items-center justify-center text-xs transition',
            message.pinned ? 'bg-amber-400 text-white' : 'bg-white dark:bg-neutral-700 text-neutral-400 hover:text-amber-400 shadow border border-neutral-200 dark:border-neutral-600']"
          :title="message.pinned ? '取消关键记忆' : '标记为关键记忆（钉住给 AI 记住）'"
        >📌</button>
        <div class="relative">
          <button
            @click="menuOpen = !menuOpen"
            :class="['w-7 h-7 rounded-full flex items-center justify-center text-base leading-none transition',
              menuOpen ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-neutral-700 text-neutral-400 hover:text-indigo-500 shadow border border-neutral-200 dark:border-neutral-600']"
            title="更多操作"
          >⋮</button>

          <!-- 更多菜单（对齐微灵） -->
          <div
            v-if="menuOpen"
            class="absolute right-0 top-8 w-44 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-2xl py-1 text-sm z-30"
          >
            <button @click="act(() => emit('regenerate', message))" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5">
              <span class="w-4 text-center">🔄</span>重新生成内容
            </button>
            <button @click="act(() => emit('rollback', message))" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5">
              <span class="w-4 text-center">◁</span>回滚
            </button>
            <button @click="act(() => emit('backup', message))" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5">
              <span class="w-4 text-center">⑂</span>备份以上对话
            </button>
            <button @click="act(startEdit)" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5">
              <span class="w-4 text-center">✏️</span>编辑消息
            </button>
            <button @click="act(() => emit('insert', message))" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5">
              <span class="w-4 text-center">＋</span>插入消息
            </button>
            <button @click="act(onDelete)" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5 text-red-500">
              <span class="w-4 text-center">🗑</span>删除消息
            </button>
            <button @click="act(() => emit('voice', message))" class="w-full text-left px-3.5 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition flex items-center gap-2.5 opacity-60">
              <span class="w-4 text-center">🔊</span>重新生成语音
            </button>
          </div>
          <!-- 菜单打开时的全屏透明层：点空白处关闭 -->
          <div v-if="menuOpen" class="fixed inset-0 z-20" @click="closeMenu"></div>
        </div>
      </div>

      <!-- 图钉标识：已钉住时常显 -->
      <span
        v-if="message.pinned"
        class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-400 text-white flex items-center justify-center text-[10px] shadow"
        title="关键记忆"
      >📌</span>

      <!-- 编辑模式 -->
      <template v-if="editing">
        <textarea
          v-model="editText"
          rows="4"
          class="w-full rounded-lg bg-black/10 dark:bg-black/30 text-current px-2 py-1.5 text-sm focus:outline-none resize-y min-w-[240px]"
        ></textarea>
        <div class="flex items-center gap-2 mt-2">
          <button @click="saveEdit" class="px-3 py-1 rounded-lg bg-indigo-500 text-white text-xs hover:bg-indigo-400 transition">保存</button>
          <button @click="cancelEdit" class="px-3 py-1 rounded-lg border border-current/30 text-xs opacity-70 hover:opacity-100 transition">取消</button>
        </div>
      </template>

      <!-- 展示模式 -->
      <template v-else>
        <!-- 思考内容（可折叠） -->
        <details v-if="parsed.thinking && showThinking" class="mb-2 group/think">
          <summary class="cursor-pointer text-[11px] opacity-60 hover:opacity-100 select-none">💭 思考过程（点击展开/折叠）</summary>
          <pre class="mt-1 text-[11px] leading-relaxed opacity-70 whitespace-pre-wrap break-words">{{ parsed.thinking }}</pre>
        </details>

        <!-- 对话配图（预留：绘画模型接入后消息可带 image 字段） -->
        <div v-if="message.image" class="mt-1.5 mb-1 rounded-xl overflow-hidden max-w-[280px] border border-black/10 dark:border-white/10">
          <SmartImage :src="message.image" :name="characterName" />
        </div>
        <div v-if="message.openingBlocks" class="mt-1.5 mb-1 rounded-xl border border-indigo-400/30 bg-black/10 dark:bg-black/20 p-3 text-sm overflow-x-auto">
          <OpeningContentRenderer :content="message.openingBlocks" @submit-form="$emit('opening-form', $event)" />
        </div>
        <div v-else-if="message.openingContent" class="mt-1.5 mb-1 rounded-xl border border-indigo-400/30 bg-black/10 dark:bg-black/20 p-3 text-sm overflow-x-auto" v-html="message.openingContent"></div>

        <div v-if="showStoryState && hasStoryState" class="mt-3 rounded-xl border border-indigo-400/30 bg-indigo-950/30 px-3 py-2 text-xs">
          <div class="flex items-center gap-2 text-indigo-300 font-medium mb-2">
            <span>当前状态</span>
            <span class="text-[10px] text-indigo-300/60">本轮更新</span>
          </div>
          <div v-if="storyStateRows.length" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-neutral-300">
            <div v-for="row in storyStateRows" :key="row[0]"><span class="text-indigo-300/70">{{ row[0] }}：</span>{{ row[1] }}</div>
          </div>
          <div v-if="storyInventory.length" class="mt-2 text-neutral-300">
            <span class="text-indigo-300/70">物品：</span>
            <span v-for="(item, index) in storyInventory" :key="item.name + index" class="inline-block mr-2">{{ item.icon }} {{ item.name }} ×{{ item.count }}</span>
          </div>
          <div v-if="storyFlags.length" class="mt-2 text-neutral-300">
            <span class="text-indigo-300/70">标记：</span>{{ storyFlags.join('、') }}
          </div>
        </div>

        <div v-if="!rawView" class="whitespace-pre-wrap break-words" :style="{ fontSize: 'var(--chat-fs, 14px)' }">
          <template v-for="(segment, index) in parsed.segments" :key="index">
            <!-- 世界书状态栏：HTML 折叠块（details/summary 原生可点击展开） -->
            <div
              v-if="segment.type === 'html'"
              class="rich-html my-2 rounded-xl border border-indigo-400/25 bg-black/5 dark:bg-black/20 px-2 py-1 text-sm overflow-x-auto whitespace-normal"
              v-html="htmlBlock(segment)"
            ></div>
            <!-- 代码围栏：等宽文本块 -->
            <pre
              v-else-if="segment.type === 'code'"
              class="my-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap break-words font-mono text-neutral-600 dark:text-neutral-300"
            >{{ segment.text }}</pre>
            <span v-else :class="segmentClass(segment.type)">{{ segment.text }}</span>
          </template>
          <span
            v-if="streaming"
            class="inline-block w-2 h-4 align-middle bg-current opacity-60 animate-pulse ml-0.5"
          ></span>
        </div>
        <pre v-else class="text-[11px] leading-relaxed opacity-70 whitespace-pre-wrap break-words">{{ displayContent }}</pre>
      </template>

      <!-- AI 消息下方：候选切换（其余操作在右上角 ⋮ 菜单） -->
      <div v-if="message.role === 'ai'" class="flex items-center gap-2 mt-2 text-xs text-neutral-400">
        <button
          @click="onSwipe('prev')"
          :disabled="candidateCount <= 1"
          class="hover:text-indigo-500 disabled:opacity-30"
          title="上一条候选"
        >‹</button>
        <span>候选 {{ candidateIndex }}/{{ candidateCount }}</span>
        <button
          @click="onSwipe('next')"
          :disabled="candidateCount <= 1"
          class="hover:text-indigo-500 disabled:opacity-30"
          title="下一条候选"
        >›</button>
        <span class="ml-auto opacity-0 group-hover:opacity-60 transition text-[11px]">👁 预览 · 📌 记忆 · ⋮ 更多</span>
      </div>
    </div>

    <!-- 用户消息：悬停显示编辑/删除 -->
    <div
      v-if="message.role === 'user'"
      class="self-center flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition"
    >
      <button @click="startEdit" class="text-xs text-neutral-400 hover:text-indigo-500" title="编辑消息">✎</button>
      <button @click="onDelete" class="text-xs text-neutral-400 hover:text-red-500" title="删除这条消息">🗑</button>
    </div>
  </div>
</template>
