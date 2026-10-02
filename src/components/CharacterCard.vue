<script setup>
import { computed } from 'vue'
import SmartImage from './SmartImage.vue'

const props = defineProps({
  card: { type: Object, required: true },
  // 该角色的会话数（卡片角标 + 热门排序）
  sessions: { type: Number, default: 0 },
})
const emit = defineEmits(['open'])

// 卡片展示名：优先显示名，留空时回退角色名
const displayName = computed(() => props.card.displayName || props.card.name)

// 封面：优先图集第一张，没有则用头像
const cover = computed(() => {
  const list = props.card.covers
  return list && list.length ? list[0] : props.card.avatar
})

function onClick() {
  emit('open', props.card)
}
</script>

<template>
  <div
    @click="onClick"
    class="group cursor-pointer rounded-2xl overflow-hidden bg-white dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-800 shadow-sm hover:shadow-lift hover:-translate-y-1 transition-all duration-200"
  >
    <!-- 封面：标题压在底部渐变上 -->
    <div class="relative aspect-[3/4] bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
      <SmartImage :src="cover" :name="displayName" />

      <!-- 原创徽标 -->
      <span class="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] rounded bg-gradient-to-r from-pink-500 to-purple-500 text-white">
        原创
      </span>

      <!-- 会话数角标 -->
      <span
        v-if="sessions > 0"
        class="absolute top-2 right-2 px-1.5 py-0.5 text-[10px] rounded bg-black/50 text-white"
      >
        💬 {{ sessions }}
      </span>

      <!-- 底部渐变 + 标题 -->
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-10">
        <h3 class="font-bold text-white truncate drop-shadow">{{ displayName }}</h3>
      </div>
    </div>

    <!-- 简介 + 统计 -->
    <div class="p-3">
      <p
        v-if="card.description"
        class="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-3 min-h-[3.4rem]"
      >
        {{ card.description }}
      </p>
      <p v-else class="text-xs text-neutral-400 line-clamp-3 min-h-[3.4rem] italic">暂无简介</p>

      <div class="flex items-center justify-between mt-2 text-[11px] text-neutral-400">
        <span class="truncate">@本地创作</span>
        <span class="shrink-0">💬 {{ sessions }}</span>
      </div>
    </div>
  </div>
</template>
