// =============================================================================
// LLM 调用工具（OpenAI 兼容接口 /chat/completions）
// - 请求只发往「设置页里用户自己填的地址」，本项目不含任何服务端
// - 支持 SSE 流式输出；接口不支持流式时自动回退到一次性返回
// =============================================================================

// 把用户填的 API 地址补全成 /chat/completions
// 支持三种形式：
//   1) 完整 URL：http(s)://host/v1   →  http(s)://host/v1/chat/completions
//   2) 反向代理（dev only）：/proxy/v1  →  /proxy/v1/chat/completions
//      配合 vite.config.js 的 server.proxy 把 /proxy/* 转发到本地 LLM 服务
//   3) 其它（无协议头）：返回空串 → callLLM 报错（避免 "1" 被解析成相对路径）
export function normalizeEndpoint(apiBase) {
  const raw = String(apiBase || '').trim()
  if (!raw) return ''
  // 1) 反向代理（如 vite 的 /proxy/v1）
  if (raw.startsWith('/')) {
    const path = raw.replace(/\/+$/, '')
    if (/\/chat\/completions$/.test(path)) return path
    return path + '/chat/completions'
  }
  // 1.5) 本机 LLM（localhost/127.0.0.1:1919 等）且应用跑在 http(s)：
  //      自动改走 vite 同源代理 /proxy（服务端转发）——绕开 CORS，且局域网手机访问时依然可用
  const localMatch = raw.match(/^https?:\/\/(localhost|127\.0\.0\.1)(?::(\d+))?(\/.*)?$/i)
  if (
    localMatch &&
    typeof location !== 'undefined' &&
    location.protocol.startsWith('http')
  ) {
    const port = localMatch[2] || '80'
    let path = localMatch[3] || '/'
    if (/\/chat\/completions$/.test(path)) path = path.replace(/\/chat\/completions$/, '')
    // FreeToken 等本机 LLM 默认端口与 vite /proxy 的转发目标一致 → 直接重写
    if (port === '1919') return normalizeEndpoint('/proxy' + path)
  }
  // 2) 必须带 http(s) 协议
  if (!/^https?:\/\//i.test(raw)) return ''
  const base = raw.replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(base)) return base
  if (/\/v\d+$/.test(base)) return base + '/chat/completions'
  return base + '/v1/chat/completions'
}

/**
 * 组装发送给模型的消息数组
 * 顺序：破甲前置 -> 系统设定 -> 历史对话 -> 历史后指令 -> 破甲后置
 * @param {Object} p
 * @param {Object} p.character 人物卡
 * @param {Object} p.persona 当前马甲
 * @param {Array}  p.messages 历史消息 [{role:'user'|'ai', content}]
 * @param {string} p.lorebookPrompt 世界书命中内容（已拼好的文本）
 * @param {string} p.userInput 本轮用户输入
 * @param {Object|null} p.jailbreak 破甲注入 {pre, rule, post}，null=不启用
 */
export function buildPromptMessages({
  character,
  persona,
  messages = [],
  lorebookPrompt = '',
  userInput = '',
  flags = null, // 可选 { lorebook, status_bar, mes_example, post_history }
  jailbreak = null, // 破甲：{pre, rule, post} 文本或 null
  depth = 0, // 对话记忆条数（0=不截断）；被钉住的关键记忆即使超出也保留
  storyStatePrompt = '', // 当前地点/心情/物品等状态，供模型保持连续性
  enableStoryState = true, // 图片提示词/总结等非聊天请求关闭状态块
  narrationStyle = 'light', // plain | light | immersive
  innerThoughtMode = 'as-needed', // disabled | as-needed | frequent
}) {
  // flags 未传时默认全启用（保持旧行为）
  const f = flags || {
    lorebook: true,
    status_bar: true,
    mes_example: true,
    post_history: true,
  }

  const systemParts = []

  // 破甲·前置：放在最前（权重最高的全局指令）
  const jb = jailbreak || null
  if (jb && jb.pre && jb.pre.trim()) {
    systemParts.push(jb.pre)
  }

  // 角色设定：权重最高的主设定（始终启用，属于核心人设）
  if (character && character.setting) {
    systemParts.push(`【角色设定】\n${character.setting}`)
  }
  if (character && character.personality) {
    systemParts.push(`【角色性格】\n${character.personality}`)
  }
  if (character && character.scenario) {
    systemParts.push(`【场景设定】\n${character.scenario}`)
  }
  if (persona && persona.persona_text) {
    systemParts.push(`【用户人设】\n${persona.persona_text}`)
  }
  if (f.lorebook && lorebookPrompt) {
    systemParts.push(`【世界书设定】\n${lorebookPrompt}`)
  }
  if (f.mes_example && character && character.mes_example) {
    systemParts.push(`【对话示例】\n${character.mes_example}`)
  }
  if (character && character.system_prompt) {
    systemParts.push(character.system_prompt)
  }
  if (storyStatePrompt && enableStoryState) {
    systemParts.push(`【当前剧情状态】\n${storyStatePrompt}`)
  }
  // 状态栏：要求模型按格式输出状态
  if (f.status_bar && character && character.status_bar) {
    systemParts.push(`【状态栏】\n${character.status_bar}`)
  }
  // 状态栏输出指令放到 trailingDirectives（system 最末尾，权重最高）——
  // 弱模型（小激活 MoE 等）对长 system 中部的格式规则遵循很差，必须压到最后

  // 叙事排版规则由调用方通过 narrationStyle 传入。默认是轻度角色扮演：
  // 使用自然格式，不要求模型输出控制标签，避免 [dialogue] 被模型原样展示。
  const style = narrationStyle || 'light'
  const innerMode = innerThoughtMode || 'as-needed'
  const styleRules = style === 'plain'
    ? `【回复风格：普通聊天】
以自然对话为主，直接回答用户。只在确实有帮助时加入非常简短的动作或表情描述。
禁止输出角色内心独白，不要输出大段环境描写。
不要输出 [narration]、[dialogue]、[thought] 等控制标签，也不要解释回复格式。`
    : style === 'immersive'
      ? `【回复风格：沉浸式叙事】
使用自然的环境、动作、表情和角色台词推进剧情；环境/动作单独成段，人物说话使用中文引号「」。
${innerMode === 'disabled' ? '禁止输出角色内心独白。' : innerMode === 'frequent' ? '可以较频繁地加入简短内心独白，但不要每句话都写。' : '只有在能推动剧情或表达重要情绪时才加入内心独白，不要每条回复都添加。'}
内心独白使用 *文字*，不要把内心想法当成角色说出口的话。
不要输出 [narration]、[dialogue]、[thought] 等控制标签，也不要输出 XML、JSON 或格式说明。`
      : `【回复风格：轻度角色扮演】
以自然对话为主，保留必要的动作、表情和场景变化；环境/动作可以单独成段，人物说话使用中文引号「」。
${innerMode === 'disabled' ? '禁止输出角色内心独白。' : innerMode === 'frequent' ? '可以加入简短内心独白，但控制频率，不要每段都写。' : '不要主动输出内心独白，只有剧情确实需要时才加入。'}
内心独白使用 *文字*。
不要输出 [narration]、[dialogue]、[thought] 等控制标签，也不要输出 XML、JSON 或格式说明。`
  systemParts.push(styleRules)
  if (enableStoryState) {
    systemParts.push(`【动态状态更新】
如果本轮剧情确实改变了地点、时间、心情、关系、服装、物品或剧情标记，请在回复正文末尾追加一个隐藏的状态更新块：
<state_update>{"mood":"新的心情","inventory":[{"name":"物品名","count":1,"icon":""}]}</state_update>
只填写发生变化的字段；没有变化时不要输出状态块。状态块必须是合法 JSON，不要把状态块内容重复写进可见正文。`)
  }

  // 破甲·规则：压在系统设定末尾（收紧约束）
  if (jb && jb.rule && jb.rule.trim()) {
    systemParts.push(jb.rule)
  }

  // 「本应在对话之后」的指令（SillyTavern 的 post history / 破甲·后置）：
  // 很多 OpenAI 兼容接口（Gemini 系等）严格要求 system 只能出现在消息列表开头，
  // 中间/末尾插 system 会报 400 "System message must be at the beginning"。
  // 所以统一并入开头 system 的末尾，用 [System Directive] 分隔标注。
  const trailingDirectives = []
  // 状态栏输出指令：精简 + 放在 system 最末尾（此处模型注意力最高）。
  // 判定：角色状态栏/内嵌世界书存在，或命中的世界书内容里出现 details/状态栏。
  if (f.status_bar) {
    const hasStatusBarSource = !!(character && (character.status_bar || (character.lorebook && character.lorebook.entries && character.lorebook.entries.length)))
      || /<details|状态栏/i.test(lorebookPrompt || '')
    if (hasStatusBarSource) {
      trailingDirectives.push(`【状态栏输出指令（最高优先级）】
每轮回复结构：先写 2-4 段剧情正文（环境/动作/台词），正文不能为空；正文写完后在末尾输出一次状态栏。
状态栏要求：
- 按世界书/设定里的模板结构输出，把［占位符］、{user}、{char} 全部替换成实际内容，禁止照抄模板原文；
- 模板中"例："开头的值只是格式示例，必须替换成本轮剧情的实际内容，并删除"例："字样和［］括号；
- 直接输出 <details>/<summary> HTML 标签，禁止用 \`\`\` 代码围栏包住状态栏；
- 每个字段占一行；模板没有的区块不要发明；不适用的字段写"无"。`)
    }
  }
  if (f.post_history && character && character.post_history_instructions) {
    trailingDirectives.push(character.post_history_instructions)
  }
  if (jb && jb.post && jb.post.trim()) {
    trailingDirectives.push(jb.post)
  }
  if (trailingDirectives.length) {
    systemParts.push('[System Directive - 对话后仍需遵守的最终指令]\n' + trailingDirectives.join('\n\n'))
  }

  const out = []
  if (systemParts.length) {
    out.push({ role: 'system', content: systemParts.join('\n\n') })
  }

  // 历史消息：ai 角色映射为 assistant
  // depth 截断：超出记忆条数时只取最近 N 条，但被 📌 钉住的关键记忆始终保留
  //（关键记忆插在截断结果之前，让模型优先看到关键剧情）
  let history = messages
  if (depth > 0 && messages.length > depth) {
    const recent = messages.slice(-depth)
    const recentIds = {}
    recent.forEach((m) => (recentIds[m && m.id] = true))
    const pinned = messages.filter((m) => m && m.pinned && !recentIds[m.id])
    history = pinned.concat(recent)
  }

  // 规范化：合并相邻同角色消息。
  // depth 截断时 pinned 提前可能造成 user/assistant 不交替，
  // 部分接口（Gemini 系）对此报错；合并后内容不丢、序列合法。
  const mergedHistory = []
  history.forEach((m) => {
    if (!m || !m.content) return
    const role = m.role === 'ai' ? 'assistant' : 'user'
    const last = mergedHistory[mergedHistory.length - 1]
    if (last && last.role === role) {
      last.content += '\n\n' + m.content
    } else {
      mergedHistory.push({ role, content: m.content })
    }
  })
  out.push(...mergedHistory)

  if (userInput) {
    // 与最后一条同角色时并入，保持严格交替
    const last = out[out.length - 1]
    if (last && last.role === 'user') last.content += '\n\n' + userInput
    else out.push({ role: 'user', content: userInput })
  }

  // （历史后指令与破甲·后置已并入开头 system，见 trailingDirectives——
  // 严格接口要求 system 只能出现在开头，不再单独 push 到末尾）

  return out
}

/**
 * 调用 LLM（流式）
 * @param {Object} p
 * @param {Object} p.config {apiBase, apiKey, model, temperature, topP, maxTokens}
 * @param {Array}  p.messages 已组装好的消息数组
 * @param {Function} [p.onDelta] 每收到一段文本回调（用于打字机效果）
 * @param {AbortSignal} [p.signal] 用于中断
 * @returns {Promise<string>} 完整回复文本
 */
export async function callLLM({ config, messages, onDelta, signal }) {
  const url = normalizeEndpoint(config && config.apiBase)
  if (!url) throw new Error('API 地址格式无效：必须以 http:// 或 https:// 开头（示例：https://api.openai.com/v1）')

  const headers = { 'Content-Type': 'application/json' }
  if (config && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const body = {
    model: (config && config.model) || 'gpt-3.5-turbo',
    messages,
    temperature: Number(config && config.temperature) || 0.8,
    top_p: Number(config && config.topP) || 0.9,
    max_tokens: Number(config && config.maxTokens) || 2048,
    stream: config && config.stream === false ? false : true,
  }
  // 额外请求体字段（如 Qwen3 思考模型的 chat_template_kwargs.enable_thinking:false）
  if (config && config.extraBody && typeof config.extraBody === 'object') {
    Object.assign(body, config.extraBody)
  }

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // 常见原因：地址不可达、证书问题、被 CORS 拦截（典型表现：Failed to fetch）
    const raw = (e && e.message) || String(e)
    if (/Failed to fetch|NetworkError|Load failed|TypeError/i.test(raw)) {
      throw new Error(
        '请求失败：可能是 CORS 跨域拦截或地址不可达。\n\n' +
        '浏览器禁止网页直接调用跨源 API。解决方案：\n' +
        '1) LLM 服务端开启跨域（Ollama: 环境变量 OLLAMA_ORIGINS=*）\n' +
        '2) 或用 Vite proxy 转发请求\n' +
        '3) 或本地起一个反向代理转发到目标地址\n' +
        '4) 或使用支持跨域的代理服务'
      )
    }
    throw new Error('请求失败：' + raw)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // 404 大多是 apiBase 填错导致最终请求路径不对（如多写了 /responses 又被自动补 /v1），把最终 URL 带出来一眼定位
    throw new Error(`接口返回 ${res.status}（请求地址：${url}）：${text.slice(0, 300)}`)
  }

  // 非流式：一次性 JSON 返回
  if (body.stream === false) {
    const data = await res.json().catch(() => null)
    const msg = data && data.choices && data.choices[0] && data.choices[0].message
    // 兜底：思考模型可能 content 为空但 reasoning_content 里有内容
    const text = (msg && msg.content) || (msg && msg.reasoning_content) || ''
    if (onDelta) onDelta(text)
    return text
  }

  // 流式但接口没给 ReadableStream：JSON 回退
  if (!res.body) {
    const data = await res.json()
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
    if (onDelta) onDelta(text)
    return text
  }

  // 解析 SSE
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // 末尾可能是不完整的一行

    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta =
          (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) ||
          ''
        if (delta) {
          full += delta
          if (onDelta) onDelta(delta)
        }
      } catch (e) {
        /* 忽略无法解析的片段 */
      }
    }
  }

  return full
}

/**
 * 测试连接：发一条极短请求验证配置是否可用
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function testConnection(config) {
  try {
    const text = await callLLM({
      config: { ...config, maxTokens: 16 },
      messages: [{ role: 'user', content: 'hi' }],
    })
    return { ok: true, message: '连接成功' + (text ? `，模型回复：${text.slice(0, 50)}` : '') }
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) }
  }
}
