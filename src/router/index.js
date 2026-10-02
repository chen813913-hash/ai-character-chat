import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PersonaView from '../views/PersonaView.vue'
import ChatView from '../views/ChatView.vue'
import SettingsView from '../views/SettingsView.vue'
import PersonalCenterView from '../views/PersonalCenterView.vue'
import ApiKeysView from '../views/ApiKeysView.vue'
import JailbreakView from '../views/JailbreakView.vue'
import JailbreakEditView from '../views/JailbreakEditView.vue'
import LorebookView from '../views/LorebookView.vue'
import LorebookEditView from '../views/LorebookEditView.vue'
import ImageApisView from '../views/ImageApisView.vue'
import GrabView from '../views/GrabView.vue'
import LinkImportView from '../views/LinkImportView.vue'

// 路由表：纯前端，使用 hash 模式（双击 index.html / 任意静态服务器都能跑，无需后端）
const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '画廊' } },
  { path: '/persona', name: 'persona', component: PersonaView, meta: { title: '马甲管理' } },
  { path: '/chat', name: 'chat', component: ChatView, meta: { title: '聊天' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } },
  { path: '/me', name: 'me', component: PersonalCenterView, meta: { title: '个人中心' } },
  { path: '/api-keys', name: 'apiKeys', component: ApiKeysView, meta: { title: 'API 密钥' } },
  { path: '/jailbreak', name: 'jailbreak', component: JailbreakView, meta: { title: '破甲预设' } },
  { path: '/jailbreak/edit', name: 'jailbreakEdit', component: JailbreakEditView, meta: { title: '编辑破甲预设' } },
  { path: '/lorebook', name: 'lorebook', component: LorebookView, meta: { title: '世界书' } },
  { path: '/lorebook/edit', name: 'lorebookEdit', component: LorebookEditView, meta: { title: '编辑世界书' } },
  { path: '/image-apis', name: 'imageApis', component: ImageApisView, meta: { title: '绘画接口' } },
  { path: '/grab', name: 'grab', component: GrabView, meta: { title: '数据抓取' } },
  { path: '/link-import', name: 'linkImport', component: LinkImportView, meta: { title: '联动导入' } },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
