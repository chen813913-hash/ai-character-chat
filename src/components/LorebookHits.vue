<script setup>
// 世界书命中展示条：把“本次对话命中的条目”可视化，方便调试与预览
const props = defineProps({
  hits: { type: Array, default: () => [] },
  depth: { type: Number, default: 6 },
})
</script>

<template>
  <div class="border-t border-neutral-200 dark:border-neutral-700 px-3 py-2">
    <details :open="hits.length > 0">
      <summary class="cursor-pointer select-none text-xs flex items-center gap-2">
        <span class="font-medium">世界书命中</span>
        <span
          :class="[
            'px-2 py-0.5 rounded-full',
            hits.length ? 'bg-indigo-500 text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400',
          ]"
        >
          {{ hits.length }} 条
        </span>
        <span class="text-neutral-400">（扫描最近 {{ depth }} 条消息）</span>
      </summary>

      <div v-if="hits.length" class="mt-2 space-y-2 max-h-40 overflow-y-auto">
        <div
          v-for="(h, i) in hits"
          :key="i"
          class="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-700/50 p-2"
        >
          <div class="flex flex-wrap items-center gap-1 mb-1">
            <span class="text-neutral-400">命中：</span>
            <span
              v-for="k in h.matchedKeys"
              :key="k"
              class="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300"
            >
              {{ k }}
            </span>
            <span class="ml-auto text-neutral-400">order {{ h.insertionOrder }}</span>
          </div>
          <div class="text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">{{ h.content }}</div>
        </div>
      </div>
      <p v-else class="mt-2 text-xs text-neutral-400">
        暂无命中（试试在消息里提到角色的世界书关键词）
      </p>
    </details>
  </div>
</template>
