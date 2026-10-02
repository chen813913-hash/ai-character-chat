<script setup>
import { ref, computed, watch } from 'vue'
import SmartImage from './SmartImage.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  card: { type: Object, default: null },
  sessions: { type: Number, default: 0 },
})
const emit = defineEmits(['update:modelValue', 'edit', 'newChat', 'export', 'delete'])

// ---- 封面图集当前索引 ----
const coverIndex = ref(0)
const covers = computed(() => {
  const list = props.card && Array.isArray(props.card.covers) ? props.card.covers : []
  return list.length ? list : [props.card && props.card.avatar].filter(Boolean)
})
const displayName = computed(() => (props.card && (props.card.displayName || props.card.name)) || '')
const subtitle = computed(() => (props.card && props.card.name) || '')

// ---- 性别 / 频道 ----
const GENDER_LABEL = { female: '女', male: '男', other: '其他' }
const CHANNEL_LABEL = { male: '男频', female: '女频', world: '世界卡' }
const genderLabel = computed(() => GENDER_LABEL[props.card && props.card.gender] || '')
const channelLabel = computed(() => CHANNEL_LABEL[props.card && props.card.channel] || '')

// ---- 数据行：角色学元 / 插画学元 / 对话数 / 首发于 ----
// 这些都是「本地版」展示用，不与任何服务器同步
const characterCoins = computed(() => {
  const sessions = props.sessions || 0
  const tagBonus = (props.card?.tags?.length || 0) * 12
  // 用会话数 + 标签数 + 稳定哈希，得到一个 6k ~ 18k 的展示值
  const base = sessions * 137 + tagBonus + (props.card?.covers?.length || 0) * 89 + 6123
  return base
})
const illustrationCoins = computed(() => {
  const c = props.card?.covers?.length || (props.card?.avatar ? 1 : 0)
  return c * 100 + (props.card?.props?.length || 0) * 30
})
const chatCount = computed(() => props.sessions || 0)
const publishTime = computed(() => formatRelative(props.card?.createTime || Date.now()))

function formatRelative(ts) {
  const diff = Date.now() - ts
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 60) return m < 1 ? '刚刚' : m + ' 分钟前'
  const h = Math.floor(diff / 3600000)
  if (h < 24) return h + ' 小时前'
  const d = Math.floor(diff / 86400000)
  if (d < 30) return d + ' 天前'
  const mo = Math.floor(d / 30)
  if (mo < 12) return mo + ' 个月前'
  const y = Math.floor(d / 365)
  return y + ' 年前'
}

function formatNum(n) {
  if (n >= 10000) return (n / 1000).toFixed(2) + 'k'
  return String(n)
}

// ---- 介绍展开状态 ----
const fullProfileOpen = ref(false)
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      coverIndex.value = 0
      fullProfileOpen.value = false
    }
  }
)

// ---- 封面翻页 ----
function prevCover() {
  coverIndex.value = (coverIndex.value - 1 + covers.value.length) % covers.value.length
}
function nextCover() {
  coverIndex.value = (coverIndex.value + 1) % covers.value.length
}

// ---- 主体文本：取 setting 优先，没有则 personality + scenario 拼接 ----
const profileText = computed(() => {
  const c = props.card
  if (!c) return ''
  if (c.setting && c.setting.trim()) return c.setting.trim()
  const parts = []
  if (c.personality) parts.push('【性格】' + c.personality)
  if (c.scenario) parts.push('【场景】' + c.scenario)
  return parts.join('\n\n') || '（暂无详细介绍）'
})

// 状态栏小预览（取模板样式）
const statusBarPreview = computed(() => (props.card?.status_bar || '').split('\n')[0] || '')

// 道具清单（最多展示 4 个 + N）
const propList = computed(() => (props.card?.props || []).slice(0, 4))
const propMore = computed(() => Math.max((props.card?.props?.length || 0) - 4, 0))

// ---- 操作 ----
function close() {
  emit('update:modelValue', false)
}
function onNewChat() {
  emit('newChat', props.card)
  close()
}
function onEdit() {
  emit('edit', props.card)
}
function onExport() {
  emit('export', props.card)
}
function onDelete() {
  emit('delete', props.card)
}

// 头部下拉菜单
const menuOpen = ref(false)
function toggleMenu() {
  menuOpen.value = !menuOpen.value
}
function menuItem(fn) {
  menuOpen.value = false
  fn()
}
</script>

<template>
  <div
    v-if="modelValue && card"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
  >
    <!-- 背景遮罩 -->
    <div
      class="absolute inset-0 bg-black/70 backdrop-blur-md"
      @click="close"
    ></div>

    <!-- 弹窗本体：左图 + 右信息 -->
    <div
      class="relative w-full max-w-5xl bg-neutral-900 text-neutral-100 rounded-2xl shadow-2xl flex overflow-hidden max-h-[90vh] border border-neutral-700/60"
    >
      <!-- 左侧：大封面图集 -->
      <div class="relative hidden md:flex flex-col w-[42%] shrink-0 bg-neutral-950">
        <div class="relative flex-1 min-h-0">
          <SmartImage
            :src="covers[coverIndex]"
            :name="displayName"
            class="w-full h-full object-cover"
          />
          <!-- 顶部关闭按钮 -->
          <button
            @click="close"
            class="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center text-xl leading-none"
            title="关闭"
          >
            ×
          </button>

          <!-- 翻页 -->
          <template v-if="covers.length > 1">
            <button
              @click="prevCover"
              class="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
              title="上一张"
            >
              ‹
            </button>
            <button
              @click="nextCover"
              class="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
              title="下一张"
            >
              ›
            </button>
            <span
              class="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 text-xs rounded-full bg-black/60 text-white"
            >
              {{ coverIndex + 1 }} / {{ covers.length }}
            </span>
          </template>
        </div>

        <!-- 创世 / 导出浮按 -->
        <div class="px-4 py-3 flex items-center justify-center">
          <button
            @click="onExport"
            class="w-full px-4 py-2.5 rounded-full bg-black/55 hover:bg-black/75 text-white text-sm border border-white/20 backdrop-blur-sm transition flex items-center justify-center gap-1.5"
          >
            <span>📤</span><span>导出此卡</span>
          </button>
        </div>
      </div>

      <!-- 右侧：信息面板 -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- 顶部条：标题 + 操作菜单 -->
        <div class="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-neutral-800">
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <h2 class="text-2xl font-bold truncate">{{ displayName }}</h2>
              <span v-if="subtitle && subtitle !== displayName" class="text-sm text-neutral-400 truncate">
                [{{ subtitle }}]
              </span>
            </div>
            <div class="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
              <span
                v-if="genderLabel"
                class="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300"
              >性别 {{ genderLabel }}</span>
              <span
                v-if="channelLabel"
                class="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300"
              >{{ channelLabel }}</span>
              <span class="px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300">原创</span>
            </div>
          </div>

          <!-- 操作菜单（编辑 / 导出 / 删除）-->
          <div class="relative">
            <button
              @click="toggleMenu"
              class="w-9 h-9 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white flex items-center justify-center"
              title="更多"
            >
              ⋯
            </button>
            <div
              v-if="menuOpen"
              class="absolute right-0 top-10 w-36 rounded-xl bg-neutral-800 border border-neutral-700 shadow-xl py-1 text-sm z-10"
            >
              <button
                @click="menuItem(onEdit)"
                class="w-full text-left px-4 py-2 hover:bg-neutral-700/60"
              >编辑</button>
              <button
                @click="menuItem(onExport)"
                class="w-full text-left px-4 py-2 hover:bg-neutral-700/60"
              >导出</button>
              <button
                @click="menuItem(onDelete)"
                class="w-full text-left px-4 py-2 hover:bg-neutral-700/60 text-red-400"
              >删除</button>
            </div>
          </div>
        </div>

        <!-- 滚动主体 -->
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <!-- 数据行：4 列 -->
          <div class="grid grid-cols-4 gap-2">
            <div class="text-center">
              <div class="text-lg font-bold text-white">{{ formatNum(characterCoins) }}</div>
              <div class="text-[11px] text-neutral-400 mt-0.5">角色学元</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-bold text-white">{{ formatNum(illustrationCoins) }}</div>
              <div class="text-[11px] text-neutral-400 mt-0.5">插画学元</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-bold text-white">{{ formatNum(chatCount) }}</div>
              <div class="text-[11px] text-neutral-400 mt-0.5">对话数</div>
            </div>
            <div class="text-center">
              <div class="text-base font-bold text-white">{{ publishTime }}</div>
              <div class="text-[11px] text-neutral-400 mt-0.5">首发于</div>
            </div>
          </div>

          <!-- 介绍 -->
          <section>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-neutral-200">介绍</h3>
              <button
                @click="fullProfileOpen = !fullProfileOpen"
                class="text-xs text-pink-400 hover:text-pink-300"
              >
                {{ fullProfileOpen ? '收起' : '查看全部资料' }}
              </button>
            </div>

            <!-- 标签胶囊 -->
            <div v-if="card.tags?.length" class="flex flex-wrap gap-1.5 mb-3">
              <span
                v-for="t in card.tags"
                :key="t"
                class="px-2.5 py-1 text-xs rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-default"
              >{{ t }}</span>
            </div>

            <!-- 设定块（结构化文本） -->
            <div
              class="relative bg-neutral-800/60 border border-neutral-700/60 rounded-xl px-4 py-3 text-sm text-neutral-200 leading-relaxed"
              :class="fullProfileOpen ? '' : 'max-h-32 overflow-hidden'"
            >
              <pre class="whitespace-pre-wrap font-sans">{{ profileText }}</pre>
              <div
                v-if="!fullProfileOpen"
                class="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-neutral-800/95 to-transparent pointer-events-none rounded-b-xl"
              ></div>
            </div>

            <!-- 状态栏小提示 -->
            <div
              v-if="statusBarPreview"
              class="mt-2 text-[11px] text-neutral-500 flex items-center gap-1.5"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>正在载入「{{ statusBarPreview }}」</span>
            </div>
          </section>

          <!-- 道具 -->
          <section v-if="propList.length">
            <h3 class="text-sm font-semibold text-neutral-200 mb-2">道具</h3>
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="(p, i) in propList"
                :key="i"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 text-sm"
              >
                <span class="text-lg shrink-0">{{ p.icon || '🎁' }}</span>
                <span class="truncate text-neutral-200">{{ p.name }}</span>
              </div>
            </div>
            <div v-if="propMore > 0" class="mt-1.5 text-[11px] text-neutral-500">
              还有 {{ propMore }} 件道具…
            </div>
          </section>

          <!-- 创作消息 -->
          <section>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-neutral-200">创作消息</h3>
              <button
                @click="onEdit"
                class="text-[11px] text-neutral-400 hover:text-pink-400"
              >作者主页 →</button>
            </div>
            <div class="flex items-start gap-3 bg-neutral-800/40 border border-neutral-700/50 rounded-xl px-3 py-3">
              <div
                class="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 text-white flex items-center justify-center font-bold text-sm"
              >我</div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm text-neutral-100">本地创作者</span>
                  <span class="text-[10px] text-neutral-500">@本地</span>
                </div>
                <p class="text-xs text-neutral-400 mt-1 truncate">
                  {{ card.creator_notes || '这个人很懒，还没有写作者简介。' }}
                </p>
              </div>
              <button
                class="text-neutral-500 hover:text-neutral-300 px-1"
                title="更多"
              >⋯</button>
            </div>
          </section>

          <!-- 热评 -->
          <section>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-neutral-200">热评</h3>
              <span class="text-[11px] text-neutral-500">本地版暂无评论</span>
            </div>
            <div
              class="bg-neutral-800/40 border border-neutral-700/50 rounded-xl px-4 py-6 flex flex-col items-center justify-center text-xs text-neutral-500"
            >
              <div class="w-5 h-5 border-2 border-neutral-600 border-t-pink-400 rounded-full animate-spin"></div>
              <p class="mt-2">本地数据中暂无评论记录</p>
            </div>
          </section>

          <!-- 开场白预览（简短摘要） -->
          <section v-if="card.first_mes">
            <h3 class="text-sm font-semibold text-neutral-200 mb-2">开场白</h3>
            <div class="bg-neutral-800/60 border border-neutral-700/60 rounded-xl px-4 py-3 text-sm text-neutral-300 leading-relaxed">
              {{ card.first_mes }}
            </div>
          </section>
        </div>

        <!-- 底部固定操作条：大粉色 CTA -->
        <div class="px-6 py-4 border-t border-neutral-800 bg-neutral-900/80 backdrop-blur-sm">
          <button
            @click="onNewChat"
            class="w-full py-3 rounded-full bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-400 hover:to-pink-300 text-white font-semibold shadow-lg shadow-pink-500/30 transition active:scale-[0.99]"
          >
            开始聊天
          </button>
        </div>
      </div>
    </div>
  </div>
</template>