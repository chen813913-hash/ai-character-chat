<script setup>
import { ref, computed, watch } from 'vue'
import { store, setSetting } from '../store/useDataStore.js'

// 聊天设置抽屉（对齐微灵：显示 / 关键记忆 两 tab）
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 当前会话消息（用于关键记忆列表与位置计算）
  messages: { type: Array, default: () => [] },
  // 当前角色（「角色封面」背景来源）
  character: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'locate', 'unpin'])

const activeTab = ref('display') // display | memory
const PIN_MAX = 30

watch(
  () => props.modelValue,
  (open) => {
    if (open) activeTab.value = 'display'
  }
)

function close() {
  emit('update:modelValue', false)
}

// ---- chatUi 设置 ----
const ui = computed(() => {
  const u = store.settings.chatUi || {}
  return {
    bgImage: u.bgImage || '',
    bgSource: u.bgSource || 'none', // none | character | custom
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

async function saveUi(patch) {
  await setSetting('chatUi', { ...ui.value, ...patch })
}

// 背景来源切换
async function onBgSourceChange(e) {
  const v = e.target.value
  if (v === 'character') {
    // 用当前角色封面/头像当背景
    const c = props.character
    const cover = c && (c.cover || c.avatar || '')
    if (!cover) {
      alert('当前角色没有封面图，请先上传或改用自定义图片')
      e.target.value = ui.value.bgSource
      return
    }
    await saveUi({ bgSource: 'character', bgImage: cover })
  } else if (v === 'custom') {
    fileInput.value && fileInput.value.click()
  } else {
    await saveUi({ bgSource: 'none', bgImage: '' })
  }
}

// 上传自定义背景
const fileInput = ref(null)
function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 3 * 1024 * 1024) {
    alert('图片过大（超过 3MB），请换一张小一点的')
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    await saveUi({ bgSource: 'custom', bgImage: String(reader.result) })
  }
  reader.readAsDataURL(file)
}

// toggle 通用
function mkToggle(key) {
  return () => saveUi({ [key]: !ui.value[key] })
}
const toggleThinking = mkToggle('showThinking')
const toggleAutoScroll = mkToggle('autoScroll')
const toggleDisableJb = mkToggle('disableJb')
const toggleStoryState = mkToggle('showStoryState')

// ---- 关键记忆 ----
const pinnedList = computed(() => {
  const list = props.messages || []
  // 倒序：最新钉的在前
  return list
    .map((m, idx) => ({ msg: m, idx }))
    .filter((x) => x.msg && x.msg.pinned)
    .reverse()
})

// 位置徽章：距最后一条的距离（对齐微灵「4前」）
function distFromEnd(idx) {
  return props.messages.length - 1 - idx
}

// 上下文引用：钉住消息的前一条用户消息
function prevUserSnippet(item) {
  for (let i = item.idx - 1; i >= 0; i--) {
    const m = props.messages[i]
    if (m && m.role === 'user') return (m.content || '').slice(0, 60)
    if (m && m.role === 'ai') break
  }
  return ''
}

function entryPreview(m) {
  // 去掉 think 部分再预览
  const raw = (m && m.content) || ''
  return raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '').trim() || '（无内容）'
}

function onLocate(item) {
  emit('locate', item.msg)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-50 flex">
      <!-- 背景遮罩 -->
      <div class="flex-1 bg-black/50 backdrop-blur-sm" @click="close"></div>

      <!-- 右侧抽屉 -->
      <aside class="w-[360px] shrink-0 bg-neutral-900 text-neutral-100 shadow-2xl flex flex-col border-l border-neutral-800 text-neutral-100">
        <!-- 头部 -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <h3 class="text-base font-semibold">聊天设置</h3>
          <button
            @click="close"
            class="w-8 h-8 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center text-lg leading-none transition"
          >×</button>
        </div>

        <!-- Tabs：显示 / 关键记忆 -->
        <div class="px-5 pt-3 pb-1">
          <div class="flex gap-1 bg-neutral-800/60 rounded-lg p-1">
            <button
              @click="activeTab = 'display'"
              :class="['flex-1 py-1.5 text-xs rounded-md transition', activeTab === 'display' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200']"
            >显示</button>
            <button
              @click="activeTab = 'memory'"
              :class="['flex-1 py-1.5 text-xs rounded-md transition flex items-center justify-center gap-1', activeTab === 'memory' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200']"
            >
              关键记忆
              <span class="text-amber-400 font-mono">{{ pinnedList.length }} / {{ PIN_MAX }}</span>
            </button>
          </div>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <!-- 显示 tab -->
          <div v-if="activeTab === 'display'" class="space-y-4">
            <!-- 字体大小 -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-neutral-400">字体大小</span>
                <span class="text-[11px] font-mono text-neutral-300">{{ ui.chatFontSize }}px</span>
              </div>
              <input
                type="range" min="12" max="20" step="1"
                :value="ui.chatFontSize"
                @input="saveUi({ chatFontSize: Number($event.target.value) })"
                class="w-full accent-pink-500"
              />
            </div>

            <!-- 气泡宽度 -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-neutral-400">气泡宽度</span>
                <span class="text-[11px] font-mono text-neutral-300">{{ ui.chatBubbleMax }}%</span>
              </div>
              <input
                type="range" min="60" max="95" step="1"
                :value="ui.chatBubbleMax"
                @input="saveUi({ chatBubbleMax: Number($event.target.value) })"
                class="w-full accent-pink-500"
              />
              <p class="text-[11px] text-neutral-500 mt-1">手机上气泡占屏幕的比例，拖到合适大小</p>
            </div>

            <!-- 聊天背景 -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-neutral-400">聊天背景</span>
                <div class="flex items-center gap-2">
                  <button
                    v-if="ui.bgImage"
                    @click="saveUi({ bgSource: 'none', bgImage: '' })"
                    class="text-[11px] text-neutral-500 hover:text-red-400 transition"
                  >清除</button>
                  <button
                    @click="fileInput && fileInput.click()"
                    class="px-3 py-1 rounded-lg border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800 transition"
                  >上传</button>
                </div>
              </div>
              <div class="relative">
                <select
                  :value="ui.bgSource"
                  @change="onBgSourceChange"
                  class="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:border-pink-500 text-sm appearance-none pr-9"
                >
                  <option value="none">无背景</option>
                  <option value="character">角色封面</option>
                  <option value="custom">自定义图片</option>
                </select>
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 pointer-events-none text-xs">▾</span>
              </div>
              <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange" />
              <p class="text-[11px] text-neutral-500 mt-1">把聊天框背景换成图片，最多 3MB</p>
            </div>

            <!-- 回复风格 -->
            <div>
              <div class="text-sm mb-1.5">回复风格</div>
              <select
                :value="ui.narrationStyle"
                @change="saveUi({ narrationStyle: $event.target.value })"
                class="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:border-pink-500 text-sm"
              >
                <option value="plain">普通聊天</option>
                <option value="light">轻度角色扮演（推荐）</option>
                <option value="immersive">沉浸式叙事</option>
              </select>
              <p class="text-[11px] text-neutral-500 mt-1">控制动作、环境和台词的表达比例</p>
            </div>

            <!-- 内心独白 -->
            <div>
              <div class="text-sm mb-1.5">内心独白</div>
              <select
                :value="ui.innerThoughtMode"
                @change="saveUi({ innerThoughtMode: $event.target.value })"
                class="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:border-pink-500 text-sm"
              >
                <option value="disabled">禁用</option>
                <option value="as-needed">按剧情需要（推荐）</option>
                <option value="frequent">允许较频繁出现</option>
              </select>
              <p class="text-[11px] text-neutral-500 mt-1">普通聊天可以关闭，不会强制每条回复都写心理活动</p>
            </div>

            <!-- 动态状态栏 -->
            <div class="flex items-center justify-between pt-1">
              <div>
                <div class="text-sm">显示动态状态栏</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">显示地点、心情、服装和物品等剧情状态</p>
              </div>
              <button
                @click="toggleStoryState"
                :class="['w-10 h-5 rounded-full transition relative shrink-0', ui.showStoryState ? 'bg-pink-500' : 'bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', ui.showStoryState ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>

            <!-- 显示隐藏思考 -->
            <div class="flex items-center justify-between pt-1">
              <div>
                <div class="text-sm">显示隐藏思考</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">展开模型输出的 &lt;think&gt; 思考内容</p>
              </div>
              <button
                @click="toggleThinking"
                :class="['w-10 h-5 rounded-full transition relative shrink-0', ui.showThinking ? 'bg-pink-500' : 'bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', ui.showThinking ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>

            <!-- 自动滚动 -->
            <div class="flex items-center justify-between pt-1">
              <div>
                <div class="text-sm">自动滚动</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">生成时自动跟随最新消息</p>
              </div>
              <button
                @click="toggleAutoScroll"
                :class="['w-10 h-5 rounded-full transition relative shrink-0', ui.autoScroll ? 'bg-pink-500' : 'bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', ui.autoScroll ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>

            <!-- 关闭破甲 -->
            <div class="flex items-center justify-between pt-1">
              <div>
                <div class="text-sm">关闭破甲</div>
                <p class="text-[11px] text-neutral-500 mt-0.5">临时禁用破甲注入，不影响模型设置里的开关</p>
              </div>
              <button
                @click="toggleDisableJb"
                :class="['w-10 h-5 rounded-full transition relative shrink-0', ui.disableJb ? 'bg-pink-500' : 'bg-neutral-700']"
              >
                <span :class="['absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', ui.disableJb ? 'left-5' : 'left-0.5']"></span>
              </button>
            </div>

            <div class="rounded-lg border border-neutral-800 p-3 text-xs text-neutral-500">
              <p class="font-medium text-neutral-400 mb-1">💡 提示</p>
              <p>破甲预设的启停与选择在「模型设置 → 破甲」里管理；这里的开关只是本会话的临时快捷禁用。</p>
            </div>
          </div>

          <!-- 关键记忆 tab -->
          <div v-else class="space-y-3">
            <p class="text-xs text-neutral-500">
              本会话专属的关键剧情，永久保存在本地。被 📌 钉住的消息会始终注入给模型，避免长对话后忘记。上限 {{ PIN_MAX }} 条。
            </p>

            <div v-if="!pinnedList.length" class="text-center text-neutral-500 py-12 text-sm border border-dashed border-neutral-800 rounded-xl">
              还没有关键记忆
              <p class="text-[11px] text-neutral-600 mt-1">点击 AI 消息上的 📌 图钉即可钉住</p>
            </div>

            <div
              v-for="item in pinnedList"
              :key="item.msg.id"
              class="rounded-xl border border-neutral-800 overflow-hidden"
            >
              <!-- 头条：位置 + 定位 + 删除 -->
              <div class="flex items-center gap-2 px-3 py-2 bg-neutral-800/60">
                <span class="text-[11px] font-semibold text-amber-400 shrink-0">{{ distFromEnd(item.idx) }}前</span>
                <button
                  @click="onLocate(item)"
                  class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[11px] hover:bg-amber-500/30 transition"
                >定位</button>
                <button
                  @click="$emit('unpin', item.msg)"
                  class="ml-auto w-7 h-7 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-xs flex items-center justify-center transition"
                  title="取消关键记忆"
                >🗑</button>
              </div>
              <!-- 内容：上一条用户消息引用 + 钉住的消息 -->
              <div class="px-3 py-2.5 space-y-2">
                <div v-if="prevUserSnippet(item)" class="flex justify-end">
                  <div class="max-w-[85%] px-2.5 py-1.5 rounded-lg bg-neutral-700 text-[11px] leading-relaxed text-neutral-300">
                    {{ prevUserSnippet(item) }}
                  </div>
                </div>
                <div class="text-xs leading-relaxed text-neutral-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {{ entryPreview(item.msg) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
