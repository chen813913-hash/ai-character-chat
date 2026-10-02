<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { store, genId, addCharacter, addJailbreak, addLorebook, createSession, appendMessage } from '../store/useDataStore.js'
import { downloadJson } from '../utils/io.js'

const router = useRouter()

// ---- 粘贴导入 ----
const pasteText = ref('')
const pasteResult = ref(null) // {characters, jailbreaks, lorebooks, props}
const pasteError = ref('')
const importing = ref(false)

// 深度遍历 JSON，按特征分类收集对象
function collect(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return
  if (Array.isArray(obj)) {
    obj.forEach((x) => collect(x, out, depth + 1))
    return
  }
  const keys = Object.keys(obj)
  const has = (k) => keys.includes(k)
  // 角色卡特征：name + 描述类字段
  if (has('name') && (has('description') || has('personality') || has('first_mes') || has('scenario')) && !out.seen.has(obj)) {
    out.seen.add(obj)
    out.characters.push(obj)
  }
  // 破甲特征：pre/rule/post 或 name+content 且自称破甲
  if ((has('rule') || (has('pre') && has('post'))) && !out.seen.has(obj)) {
    out.seen.add(obj)
    out.jailbreaks.push(obj)
  }
  // 世界书特征：entries 数组
  if (has('entries') && Array.isArray(obj.entries) && !out.seen.has(obj)) {
    out.seen.add(obj)
    out.lorebooks.push(obj)
  }
  // 道具特征：props 数组（icon+name+prompt）
  if (has('props') && Array.isArray(obj.props) && !out.seen.has(obj)) {
    out.seen.add(obj)
    out.props.push(obj)
  }
  // 继续下钻
  for (const k of keys) collect(obj[k], out, depth + 1)
}

function parsePasted() {
  pasteError.value = ''
  pasteResult.value = null
  const text = pasteText.value.trim()
  if (!text) {
    pasteError.value = '请先粘贴抓取到的 JSON 数据'
    return
  }
  let data = null
  try {
    data = JSON.parse(text)
  } catch (e) {
    // 容错：从文本中提取第一个 JSON 对象/数组
    const m = text.match(/[[{][\s\S]*[\]}]/)
    if (m) {
      try {
        data = JSON.parse(m[0])
      } catch (e2) {}
    }
  }
  if (!data) {
    pasteError.value = '无法解析 JSON，请检查粘贴内容'
    return
  }
  const out = { characters: [], jailbreaks: [], lorebooks: [], props: [], seen: new Set(), conversation: null }
  collect(data, out)
  delete out.seen
  // 对话导入：从 grab 文件的 captured 里提取 LLM 请求体（完整对话）+ 会话元数据
  const items = Array.isArray(data) ? data : Array.isArray(data.captured) ? data.captured : []
  let convMeta = null
  let llmBody = null
  for (const it of items) {
    const rb = it && it.reqBody
    if (!rb || typeof rb !== 'string') continue
    if (rb.includes('"characterName"') && !convMeta) {
      try { convMeta = JSON.parse(rb) } catch (e) {}
    }
    if (String(it.url || '').includes('/llm/') && rb.includes('"messages"')) {
      try {
        const b = JSON.parse(rb)
        if (b.messages && (!llmBody || b.messages.length > llmBody.messages.length)) llmBody = b
      } catch (e) {}
    }
  }
  if (llmBody && convMeta) {
    out.conversation = {
      title: convMeta.title || ('和【' + convMeta.characterName + '】的对话'),
      characterName: convMeta.characterName || '导入角色',
      characterId: convMeta.characterId || '',
      messages: llmBody.messages,
    }
  }
  const total =
    out.characters.length +
    out.jailbreaks.length +
    out.lorebooks.length +
    out.props.length +
    (out.conversation ? 1 : 0)
  if (!total) {
    pasteError.value = '识别到 0 个可导入项（需要包含角色/破甲/世界书/道具/对话的特征字段）'
    return
  }
  pasteResult.value = out
}

// 确认导入
async function doImport() {
  if (!pasteResult.value) return
  importing.value = true
  try {
    const now = Date.now()
    const r = pasteResult.value
    let n = 0
    for (const c of r.characters) {
      await addCharacter({
        id: genId('c'),
        name: String(c.name || '导入角色').slice(0, 60),
        displayName: String(c.displayName || c.name || '').slice(0, 60),
        description: String(c.description || ''),
        tags: Array.isArray(c.tags) ? c.tags.slice(0, 3).map(String) : [],
        avatar: String(c.avatar || ''),
        covers: Array.isArray(c.covers) ? c.covers.slice(0, 6) : [],
        gender: c.gender === 'male' ? 'male' : 'female',
        channel: c.channel === 'male' ? 'male' : 'female',
        appearance: String(c.appearance || ''),
        personality: String(c.personality || ''),
        scenario: String(c.scenario || ''),
        setting: String(c.setting || ''),
        first_mes: String(c.first_mes || '（导入的角色，未提供开场白）'),
        alternate_greetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings : [],
        mes_example: String(c.mes_example || ''),
        system_prompt: String(c.system_prompt || ''),
        post_history_instructions: String(c.post_history_instructions || ''),
        creator_notes: '抓取导入：' + new Date().toLocaleString(),
        lorebook: c.lorebook && Array.isArray(c.lorebook.entries) ? c.lorebook : { entries: [] },
        props: Array.isArray(c.props) ? c.props : [],
        createTime: now,
        updateTime: now,
      })
      n++
    }
    for (const j of r.jailbreaks) {
      await addJailbreak({
        id: genId('jb'),
        name: String(j.name || '抓取破甲').slice(0, 60),
        type: 'simple',
        pre: String(j.pre || ''),
        rule: String(j.rule || ''),
        post: String(j.post || ''),
        enabled: false,
        createTime: now,
      })
      n++
    }
    for (const l of r.lorebooks) {
      await addLorebook({
        id: genId('lb'),
        name: String(l.name || '抓取世界书').slice(0, 60),
        entries: (l.entries || []).map((e) => ({
          keys: Array.isArray(e.keys) ? e.keys : String(e.keys || e.keysText || '').split(/[,、]/).map((x) => x.trim()).filter(Boolean),
          content: String(e.content || ''),
          insertionOrder: Number(e.insertionOrder) || 100,
          caseSensitive: !!e.caseSensitive,
        })),
        enabled: false,
        createTime: now,
      })
      n++
    }
    // 道具并入角色（props 结构），此处单独的 props 容器无法独立导入——合并进最近导入的角色

    // 对话导入：建角色 + 会话 + 消息（开场白与完整对话历史，本地可继续聊）
    let newCharId = null
    if (r.conversation) {
      const cv = r.conversation
      const cid = genId('c')
      newCharId = cid
      await addCharacter({
        id: cid,
        name: String(cv.characterName || '导入对话角色').slice(0, 60),
        displayName: String(cv.characterName || '').slice(0, 60),
        description: '从 jd.3me.fun 抓取导入的对话角色（原站系统提示在服务端，无法获取；可在此补充人设）',
        tags: [],
        avatar: '',
        covers: [],
        gender: 'female',
        channel: 'female',
        appearance: '',
        personality: '',
        scenario: '',
        setting: '',
        first_mes: '',
        alternate_greetings: [],
        mes_example: '',
        system_prompt: '',
        post_history_instructions: '',
        creator_notes: '对话抓取导入：' + new Date().toLocaleString(),
        lorebook: { entries: [] },
        props: [],
        createTime: now,
        updateTime: now,
      })
      const sess = await createSession({ characterId: cid, title: cv.title || '导入的对话' })
      // 消息按顺序落库（assistant→ai / user→user；content 可能混有 JSON 尾巴，做一次清洗）
      for (const msg of cv.messages || []) {
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        // 网站把消息数组手工序列化，content 末尾可能粘连 JSON 片段（如 ",\"id\":\"xxx\"}"），截掉
        const cut = content.indexOf('",\n      "id"')
        if (cut > 0) content = content.slice(0, cut + 1)
        content = content.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim()
        if (!content) continue
        await appendMessage({
          id: genId('m'),
          sessionId: sess.id,
          role: msg.role === 'user' ? 'user' : 'ai',
          content,
          candidates: [],
          candidateIndex: 0,
          time: Date.now(),
        })
      }
      n++
      flashMsg('对话已导入，正在跳转…')
      router.push('/chat?characterId=' + cid)
      pasteResult.value = null
      pasteText.value = ''
      importing.value = false
      return
    }

    flashMsg(`已导入 ${n} 项（角色 ${r.characters.length} / 破甲 ${r.jailbreaks.length} / 世界书 ${r.lorebooks.length}）`)
    pasteResult.value = null
    pasteText.value = ''
    router.push('/')
  } catch (e) {
    flashMsg('导入失败：' + (e && e.message ? e.message : e))
  } finally {
    importing.value = false
  }
}

const notice = ref('')
function flashMsg(t) {
  notice.value = t
  setTimeout(() => (notice.value = ''), 4000)
}

// ---- 通用抓取书签脚本（两段式：先开启捕获，再下载） ----
const grabScriptRaw = `(function(){
  if (window.__grabOn) {
    var payload = { captured: window.__grabCaptured || [] };
    try {
      var nd = document.querySelector('#__NEXT_DATA__');
      if (nd) payload.nextData = JSON.parse(nd.textContent);
    } catch (e) {}
    try {
      payload.localStorage = {};
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); payload.localStorage[k] = String(localStorage.getItem(k)).slice(0, 8000); }
      payload.sessionStorage = {};
      for (var j = 0; j < sessionStorage.length; j++) { var k2 = sessionStorage.key(j); payload.sessionStorage[k2] = String(sessionStorage.getItem(k2)).slice(0, 8000); }
    } catch (e) {}
    var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'grab-' + Date.now() + '.json';
    a.click();
    alert('已下载（捕获 ' + payload.captured.length + ' 条 + 页面内嵌数据 + storage 快照）。把文件发回本地应用导入。');
    window.__grabOn = false;
    return;
  }
  window.__grabCaptured = [];
  var push = function(o) { try { window.__grabCaptured.push(o) } catch (e) {} };
  var of = window.fetch;
  window.fetch = async function() {
    var args = arguments;
    var res = await of.apply(this, args);
    try {
      var reqBody = null;
      try { reqBody = args[1] && args[1].body ? String(args[1].body) : null } catch (e) {}
      var c = res.clone();
      var ct = c.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) {
        var j = await c.json();
        push({ type: 'fetch', url: String(args[0]).slice(0, 300), reqBody: reqBody, data: j });
      } else if (reqBody) {
        push({ type: 'fetch-req', url: String(args[0]).slice(0, 300), reqBody: reqBody });
      }
    } catch (e) {}
    return res;
  };
  var oo = XMLHttpRequest.prototype.open;
  var os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var reqBody = null;
    try { reqBody = body ? String(body) : null } catch (e) {}
    this.addEventListener('load', function() {
      try {
        var ct = self.getResponseHeader('content-type') || '';
        if (ct.indexOf('json') >= 0) push({ type: 'xhr', url: String(self.__u).slice(0, 300), reqBody: reqBody, data: JSON.parse(self.responseText) });
        else if (reqBody) push({ type: 'xhr-req', url: String(self.__u).slice(0, 300), reqBody: reqBody });
      } catch (e) {}
    });
    return os.apply(this, arguments);
  };
  var OW = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var ws = protocols === undefined ? new OW(url) : new OW(url, protocols);
    ws.addEventListener('message', function(ev) {
      try { push({ type: 'ws', url: String(url).slice(0, 300), data: JSON.parse(ev.data) }) }
      catch (e) { push({ type: 'ws-text', url: String(url).slice(0, 300), data: String(ev.data).slice(0, 8000) }) }
    });
    var osend = ws.send;
    ws.send = function(d) {
      try { push({ type: 'ws-send', url: String(url).slice(0, 300), data: typeof d === 'string' ? d.slice(0, 10000) : '[binary]' }) } catch (e) {}
      return osend.apply(this, arguments);
    };
    return ws;
  };
  window.__grabOn = true;
  alert('抓取 v2 已开启（fetch/XHR/WebSocket + 请求体）。去和角色聊天几轮，完成后再次运行本脚本下载。');
})()`

async function copyGrabScript() {
  try {
    await navigator.clipboard.writeText(grabScriptRaw)
    flashMsg('已复制（控制台版）。首次粘贴需先在控制台输入 allow pasting 回车')
  } catch (e) {
    flashMsg('复制失败，请手动选择脚本文本复制')
  }
}
async function copyBookmarkScript() {
  try {
    await navigator.clipboard.writeText('javascript:' + grabScriptRaw)
    flashMsg('已复制（书签版）：新建书签，网址栏粘贴这段，在目标网站页面点书签运行')
  } catch (e) {
    flashMsg('复制失败，请手动选择脚本文本复制')
  }
}
function downloadGrabScript() {
  downloadJson('抓取脚本说明.txt', {
    控制台版: grabScriptRaw,
    书签版: 'javascript:' + grabScriptRaw,
    说明: '控制台版：F12 → Console → 先输入 allow pasting 回车 → 粘贴运行。书签版：新建书签把书签版粘到网址栏，在目标网站页面点书签运行（手机也能用）。',
  })
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
    <!-- 提示条 -->
    <div
      v-if="notice"
      class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm shadow-lg"
    >
      {{ notice }}
    </div>

    <div>
      <h1 class="text-xl font-bold">🧲 数据抓取</h1>
      <p class="text-xs text-neutral-500 mt-1">从其他网站获取角色卡 / 破甲 / 世界书 / 道具，导入到本地应用</p>
    </div>

    <!-- 方案说明 -->
    <div class="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-xs text-neutral-500 space-y-1.5">
      <p class="font-medium text-neutral-400">两种实现方式（推荐方式一）：</p>
      <p><b class="text-neutral-300">方式一 · 浏览器抓取</b>：在目标网站的页面上运行抓取脚本，拦截网站自己加载的数据（它前端从 API 拿什么你就抓到什么）——无需网站配合，自带登录态。</p>
      <p><b class="text-neutral-300">方式二 · 网站 API</b>：F12 → Network 看网站请求的接口和参数，用你的账号 token 直连。适合有公开 API 的站点，缺点是鉴权/风控/改版都是坑。</p>
    </div>

    <!-- 方式一：抓取脚本 -->
    <section class="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold text-sm">方式一 · 浏览器抓取脚本</h2>
        <div class="flex gap-2">
          <button @click="copyGrabScript" class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition">复制（控制台用）</button>
          <button @click="copyBookmarkScript" class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition">复制（书签用）</button>
          <button @click="downloadGrabScript" class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition">下载说明</button>
        </div>
      </div>
      <ol class="list-decimal pl-5 space-y-1 text-xs text-neutral-500">
        <li>电脑/手机浏览器打开目标网站并<b class="text-neutral-300">登录</b></li>
        <li>按 <b class="text-neutral-300">F12</b>（手机浏览器用「控制台」功能或电脑操作后发文件）→ 切到「控制台/Console」</li>
        <li>首次粘贴 Chrome 会要求确认：在控制台<b class="text-neutral-300">手动输入 allow pasting</b> 并回车（只需一次）</li>
        <li>粘贴「复制（控制台用）」的脚本并回车 → 提示「抓取已开启」</li>
        <li>在网站里<b class="text-neutral-300">进入和角色的聊天并聊几轮</b>（消息内容/角色设定会随请求和 WebSocket 被捕获）</li>
        <li><b class="text-neutral-300">再次运行同一脚本</b> → 下载 grab-xxx.json</li>
        <li>回到本页，把 JSON 内容粘贴到下方导入</li>
      </ol>
      <p class="text-[11px] text-neutral-500">脚本会拦截网站的 JSON 请求（含角色卡/破甲/道具数据），只在你自己的浏览器里运行，不上传任何地方。</p>
      <div class="rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2.5 text-[11px] text-neutral-500 space-y-1">
        <p class="font-medium text-sky-400">免 F12 的书签方式（手机推荐）：</p>
        <p>点「复制（书签用）」→ 浏览器书签管理器新建书签 → 网址栏粘贴这段 → 在目标网站页面<b class="text-neutral-300">直接点这个书签</b>即可运行，无需打开控制台、无需 allow pasting。</p>
      </div>
    </section>

    <!-- 粘贴导入 -->
    <section class="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
      <h2 class="font-semibold text-sm">粘贴导入</h2>
      <textarea
        v-model="pasteText"
        rows="6"
        placeholder='把抓取到的 JSON 粘贴到这里（支持数组或单个对象，自动识别角色/破甲/世界书/道具）'
        class="w-full rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-y"
      ></textarea>
      <div v-if="pasteError" class="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">{{ pasteError }}</div>
      <div v-if="pasteResult" class="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 text-xs space-y-1">
        <p class="text-emerald-400 font-medium">识别结果：</p>
        <p>角色卡 ×{{ pasteResult.characters.length }} · 破甲 ×{{ pasteResult.jailbreaks.length }} · 世界书 ×{{ pasteResult.lorebooks.length }} · 道具组 ×{{ pasteResult.props.length }}</p>
      </div>
      <div class="flex gap-2">
        <button
          @click="parsePasted"
          class="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >识别内容</button>
        <button
          v-if="pasteResult"
          @click="doImport"
          :disabled="importing"
          class="flex-1 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-400 disabled:opacity-40 transition"
        >{{ importing ? '导入中…' : '导入到本地' }}</button>
      </div>
    </section>

    <!-- 方式二说明 -->
    <section class="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-2">
      <h2 class="font-semibold text-sm">方式二 · 网站 API（进阶）</h2>
      <ol class="list-decimal pl-5 space-y-1 text-xs text-neutral-500">
        <li>目标网站按 <b class="text-neutral-300">F12 → Network（网络）</b> 面板，筛选 XHR/Fetch</li>
        <li>刷新页面/打开角色页，找到返回角色数据的请求（看 Response 内容）</li>
        <li>复制请求的 URL、参数和你的登录凭证（Cookie 或 token）</li>
        <li>告诉我目标网站，我可以帮你写专用的抓取脚本或接入应用</li>
      </ol>
      <p class="text-[11px] text-neutral-500">注意：多数网站没有公开 API 且有风控，方式一更省事。</p>
    </section>
  </div>
</template>
