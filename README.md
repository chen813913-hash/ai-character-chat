# 本地角色聊天工作台

纯前端、纯本地的 AI 角色聊天工作台。核心是**人物卡系统**与**马甲（用户人设）系统**，支持世界书（Lorebook）自动匹配注入，可对接任意 OpenAI 兼容接口（含本地模型）。

> **数据 100% 存在你自己的浏览器里**：没有登录、没有账号、没有云端同步、没有服务端接口。
> 所有读写都在本机 IndexedDB 完成，不上传任何内容。

---

## 特性

- **画廊**：人物卡网格，支持搜索、标签筛选、排序，卡片 hover 上浮
- **人物卡**：完整字段（性格 / 场景 / 开场白 / 备用开场白 / 对话示例 / 系统提示词 / 历史后指令 / 世界书）
- **马甲（Persona）**：多套用户人设，聊天时下拉切换，人设会注入 prompt
- **世界书**：按关键词自动命中条目，按 `insertionOrder` 排序后注入对话；内置条目编辑器
- **聊天**：会话持久化、SSE 流式输出（打字机 + 可中断）、**swipe 多候选切换**、**重新生成**、单条消息删除、会话重命名
- **导入导出**：人物卡 / 马甲 JSON 单条与批量导入导出；会话导出
- **AI-Card-Catcher 联动**：独立「联动导入」页面，支持一键接收和联动 JSON 文件导入；人物卡、马甲、世界书、破甲可分别处理重复项
- **全量备份**：一键导出所有数据为单个 JSON，可随时恢复（本地应用没有云端，这是唯一保险）
- **主题**：暗色优先，支持明暗切换
- **离线单文件**：`npm run build:file` 产出一个自包含的 `index.html`，双击即可运行

---

## 快速开始

### 方式一：开发模式（推荐，功能完整）

```bash
npm install
npm run dev
```

浏览器会自动打开 `http://localhost:5173`。

Windows 用户也可以直接双击 **`启动.bat`**，用完双击 **`关闭.bat`**。

> ⚠️ 想真正调用大模型，请用这种方式。`file://` 协议下浏览器会因跨域策略拦截请求。

### 方式二：单文件离线版（看界面 / 改数据 / 导 JSON）

```bash
npm run build:file
```

产物在 `dist-standalone/index.html`，**双击直接用浏览器打开**，不需要任何服务器。

---

## 连接大模型

打开「设置」页，填写：

| 配置项 | 说明 | 示例 |
|---|---|---|
| API 地址 | 会自动补全 `/v1/chat/completions` | `http://localhost:1234`（LM Studio）、`http://localhost:11434`（Ollama） |
| API Key | 本地模型可留空 | `sk-xxx` |
| 模型名 | - | `qwen2.5-7b-instruct` |
| temperature / top_p / max_tokens | 采样参数 | `0.8` / `0.9` / `2048` |

填完点「保存」，再点「测试连接」验证是否可用。

**Prompt 组装顺序**：角色性格 → 场景 → 用户人设 → 世界书命中内容 → 对话示例 → 系统提示词 → 历史对话 → 历史后指令。

---

## 数据说明

### 人物卡结构

```json
{
  "id": "uuid",
  "name": "角色名（对话与提示词中使用，必填）",
  "displayName": "显示名（卡片上展示，留空则同角色名）",
  "description": "角色简介，显示在角色卡上",
  "tags": [],
  "avatar": "头像 url/base64",
  "covers": [],
  "gender": "female | male | other",
  "channel": "male 男频 | female 女频 | world 世界卡",
  "personality": "性格",
  "scenario": "对话场景",
  "first_mes": "开场白",
  "alternate_greetings": [],
  "mes_example": "对话示例",
  "system_prompt": "系统提示词",
  "post_history_instructions": "增强设定（追加到消息末尾，权重最高）",
  "setting": "角色设定（主设定大文本，权重最高）",
  "status_bar": "状态栏（要求模型按格式输出状态）",
  "props": [
    { "icon": "📖", "name": "道具名", "prompt": "使用时填入输入框的提示词" }
  ],
  "creator_notes": "作者备注",
  "lorebook": {
    "entries": [
      { "keys": [], "content": "", "insertionOrder": 100, "caseSensitive": false }
    ]
  },
  "createTime": 0, "updateTime": 0
}
```

> 约束：**标签最多 3 个**，**封面图集最多 6 张**（第一张作卡片封面，详情弹窗可翻页）。
> 导入时会自动裁剪到上限并补齐缺失字段。

### 马甲结构

```json
{
  "id": "uuid", "name": "马甲名字", "avatar": "头像",
  "persona_text": "人设文本", "notes": "备注",
  "createTime": 0, "updateTime": 0
}
```

### 存储位置

浏览器 IndexedDB，库名 `ai-character-chat`，含 5 张表：`characters`、`personas`、`sessions`、`messages`、`settings`。

> 清浏览器数据 / 换浏览器 / 换电脑都会导致数据丢失 —— **请定期用「设置 → 导出全部数据」备份**。

---

## AI-Card-Catcher 联动导入

启动本项目的 Vite 开发服务器后，打开侧栏的「🔗 联动导入」页面。支持两种方式：

1. **一键导入**：AI-Card-Catcher 卡片详情中填写本网站地址（默认 `http://127.0.0.1:5173`），点击「一键导入」；本页面会轮询本地桥接队列，收到后显示完整预览，点击确认才写入 IndexedDB。
2. **联动 JSON**：在 AI-Card-Catcher 点击「下载联动 JSON」，再到本页面选择文件或读取剪贴板。

导入规则：

- 重复判断为「名称 + 内容指纹」，首次冲突可选覆盖 / 新建副本 / 跳过，并可按数据类型记住策略。
- 用户马甲只进入马甲库，不自动绑定会话。
- 世界书可在导入预览中选择全局或绑定人物；全局和人物均支持多本，导入后仍可在世界书和角色编辑器中修改。
- 补充规则默认写入人物卡系统提示词，也可选择写入破甲规则。
- 破甲默认导入为草稿且不启用，可在预览中勾选立即启用。

一键导入要求 AI-Card-Catcher 与本网站位于同一台电脑或同一局域网，并使用本网站的 Vite 服务地址；若浏览器页面未收到数据，可直接使用联动 JSON 文件导入。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（5173） |
| `npm run build` | 标准构建到 `dist/` |
| `npm run build:file` | 构建**单文件离线版**到 `dist-standalone/` |
| `npm run release` | 依次执行上面两种构建 |
| `npm run preview` | 预览 `dist/` 构建产物 |

---

## 目录结构

```
src/
├─ App.vue                    根组件（初始化主题 + 载入本地数据）
├─ router/index.js            hash 路由
├─ components/
│  ├─ TopNav.vue              顶部导航
│  ├─ BaseModal.vue           通用弹窗（遮罩 + ESC 关闭）
│  ├─ SmartImage.vue          图片失败占位
│  ├─ CharacterCard.vue       人物卡
│  ├─ CharacterDetailModal.vue 人物卡详情（折叠面板）
│  ├─ CharacterEditModal.vue  人物卡编辑（含世界书条目编辑器）
│  ├─ PersonaCard.vue / PersonaEditModal.vue
│  ├─ ChatMessage.vue         消息气泡（swipe / 重新生成 / 删除）
│  └─ LorebookHits.vue        世界书命中展示
├─ views/
│  ├─ HomeView.vue            画廊
│  ├─ PersonaView.vue         马甲管理
│  ├─ ChatView.vue            聊天
│  └─ SettingsView.vue        设置（LLM 配置 + 备份恢复）
├─ store/
│  ├─ db.js                   IndexedDB 封装（含 file:// 降级）
│  └─ useDataStore.js         响应式仓储层
├─ utils/
│  ├─ lorebook.js             世界书匹配引擎
│  ├─ llm.js                  LLM 调用（流式）
│  └─ io.js                   文件导入导出 / 图片读取
└─ data/mock.js               内置示例数据
```

---

## 常见问题

**Q：双击 `dist-standalone/index.html` 能聊天吗？**
界面和数据操作都可以，但**调用大模型不行** —— `file://` 下 fetch 会被浏览器跨域拦截。要接模型请用 `npm run dev`。
另外 `file://` 下 Chrome 禁用 IndexedDB，程序会自动降级为内存存储（功能正常，但刷新后不保留）。

**Q：数据存在哪？会上传吗？**
只存在你本机浏览器的 IndexedDB，代码中不存在任何上传逻辑，也没有后端。

**Q：`启动.bat` 双击没反应？**
批处理文件必须是 **CRLF 换行**才能被 cmd 正确解析。仓库已通过 `.gitattributes` 锁定 `*.bat` 为 CRLF；如果你手动改过它，请确认换行符没被改成 LF。

**Q：导出的备份能给别人用吗？**
可以，备份是标准 JSON，在对方的「设置 → 从备份恢复」里导入即可。注意头像若用了 base64，文件会比较大。

---

## 许可

[MIT](./LICENSE)
