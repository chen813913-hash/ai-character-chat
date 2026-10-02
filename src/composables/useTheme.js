import { ref } from 'vue'

// 主题状态（暗色为默认）。仅用 localStorage 做本地方便记忆，不上传任何服务器。
// 注意：settings 表单里的“LLM 配置项”本轮不做持久化，只处理明暗主题的切换。
const isDark = ref(true)

export function useTheme() {
  function apply() {
    if (isDark.value) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  // 读取本地偏好：file:// 或隐私模式下 localStorage 可能不可用，需容错
  function init() {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light') isDark.value = false
    } catch (e) {
      /* 忽略：保持默认暗色 */
    }
    apply()
  }

  // 【占位函数，后续实现】当前仅切换视觉 + 本地方便记忆，不做其他业务
  function toggle() {
    isDark.value = !isDark.value
    apply()
    try {
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    } catch (e) {
      /* 忽略：不影响主题切换本身 */
    }
  }

  return { isDark, toggle, init }
}
