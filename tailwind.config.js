/** @type {import('tailwindcss').Config} */
export default {
  // 暗色主题：通过 html 上的 class="dark" 控制（默认开启）
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // 卡片 hover 上浮 + 阴影的统一动画
      boxShadow: {
        lift: '0 12px 30px -10px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
}
