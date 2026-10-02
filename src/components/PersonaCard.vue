<script setup>
import SmartImage from './SmartImage.vue'

const props = defineProps({
  persona: { type: Object, required: true },
})
const emit = defineEmits(['edit', 'delete', 'export'])

// 【占位函数，后续实现】编辑 / 删除 / 导出（全部仅 emit，无业务）
function onEdit() {
  console.log('[占位] 编辑马甲:', props.persona.name)
  emit('edit', props.persona)
}
function onDelete() {
  console.log('[占位] 删除马甲:', props.persona.name)
  emit('delete', props.persona)
}
function onExport() {
  console.log('[占位] 导出马甲:', props.persona.name)
  emit('export', props.persona)
}
</script>

<template>
  <div class="bg-white dark:bg-neutral-800 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lift hover:-translate-y-1 transition-all duration-200">
    <!-- 头像 -->
    <div class="aspect-square bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
      <SmartImage :src="persona.avatar" :name="persona.name" />
    </div>

    <!-- 信息 -->
    <div class="p-4">
      <h3 class="font-semibold truncate">{{ persona.name }}</h3>
      <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-3">{{ persona.persona_text }}</p>

      <!-- 操作按钮 -->
      <div class="flex gap-2 mt-3">
        <button @click="onEdit" class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700">编辑</button>
        <button @click="onExport" class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700">导出</button>
        <button @click="onDelete" class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">删除</button>
      </div>
    </div>
  </div>
</template>
