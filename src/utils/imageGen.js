// =============================================================================
// AI 绘画：提示词拼装 + 双协议调用（SD WebUI 本地 / OpenAI 兼容网络接口）
// 纯逻辑模块，不涉及 UI
//
// 协议 1 — SD WebUI（本地，秋叶整合包）：
//   前置：启动器开启 API（--api），并加 --cors-allow-origins=*（否则浏览器跨域拦截）
//   调用：POST {apiBase}/sdapi/v1/txt2img
//         { prompt, negative_prompt, width, height, steps, cfg_scale, sampler_name, seed: -1 }
//   返回：{ images: ['<不带 data: 前缀的 base64 png>', ...] }
//
// 协议 2 — OpenAI 兼容（网络，dall-e-3 / 硅基流动 Kolors / 各类聚合站）：
//   调用：POST {apiBase}/images/generations
//         { model, prompt, n, size, response_format: 'b64_json' }
//   返回：{ data: [{ b64_json }] }（部分实现返回 { url }，两种都兼容）
// =============================================================================

export const DEFAULT_NEGATIVE =
  'lowres, bad anatomy, bad hands, worst quality, low quality, blurry, watermark, signature, jpeg artifacts'

const QUALITY_PREFIX = 'masterpiece, best quality, highly detailed'

// ---- 提示词拼装：优先「外貌」字段，其次从简介里取 ----

// 角色卡 → 绘画提示词（性别 + 名字 + 外貌 + 性格 + 场景）
export function buildCharacterImagePrompt(card) {
  if (!card) return ''
  const parts = [QUALITY_PREFIX]
  parts.push(card.gender === 'female' ? '1girl, female' : '1boy, male')
  if (card.name) parts.push(String(card.name).trim())
  // 外貌字段优先；没有则从简介里取（简介通常含外貌描述）
  const look = String(card.appearance || '').trim() || String(card.description || '').trim()
  if (look) parts.push(look)
  if (card.personality) parts.push(String(card.personality).trim())
  if (card.scenario) parts.push(String(card.scenario).trim())
  return parts.filter(Boolean).join(', ')
}

// 角色卡 → 中文对照提示词（给人看的参考，喂接口的仍是英文）
export function buildCharacterImagePromptZh(card) {
  if (!card) return ''
  const parts = []
  parts.push(card.gender === 'female' ? '女性' : '男性')
  if (card.name) parts.push(String(card.name).trim())
  const look = String(card.appearance || '').trim() || String(card.description || '').trim()
  if (look) parts.push('外貌：' + look)
  if (card.personality) parts.push('性格：' + String(card.personality).trim())
  if (card.scenario) parts.push('场景：' + String(card.scenario).trim())
  return parts.filter(Boolean).join('；')
}

// 马甲 → 中文对照提示词
export function buildPersonaImagePromptZh(persona) {
  if (!persona) return ''
  const parts = []
  if (persona.name) parts.push(String(persona.name).trim())
  const text = String(persona.persona_text || '').trim()
  if (text) parts.push(text)
  return parts.filter(Boolean).join('；')
}

// 马甲 → 绘画提示词
export function buildPersonaImagePrompt(persona) {
  if (!persona) return ''
  const parts = [QUALITY_PREFIX, '1person']
  if (persona.name) parts.push(String(persona.name).trim())
  const text = String(persona.persona_text || '').trim()
  if (text) parts.push(text)
  return parts.filter(Boolean).join(', ')
}

// ---- fetch + 超时 ----
async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch (e) {
      body = text
    }
    if (!res.ok) {
      const msg =
        body && body.error && body.error.message
          ? body.error.message
          : typeof body === 'string'
            ? body.slice(0, 200)
            : 'HTTP ' + res.status
      throw new Error('接口返回 ' + res.status + '：' + msg)
    }
    return body
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请确认服务已启动且网络可达')
    if (e instanceof TypeError) {
      throw new Error(
        '网络请求被浏览器拦截（跨域/连接失败）：需要在 SD 启动器的「CORS 授权管理」里添加本应用的地址（浏览器地址栏开头，如 http://localhost:4178）并重启 SD；网络接口请检查地址是否正确'
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function toDataUrl(b64) {
  if (!b64) return ''
  return b64.startsWith('data:') ? b64 : 'data:image/png;base64,' + b64
}

// ---- 协议实现 ----

// 智能解析 SD 请求地址：
// - 应用跑在 http(s)（npm run dev=5173 / preview=4178）且 SD 是本机 7860 → 走 vite 同源代理（/sdapi），浏览器零跨域
//   该代理在服务端（电脑上）转发，局域网手机访问时同样生效（手机请求 192.168.x.x:5173 → vite → 电脑本机 SD）
// - file:// 直接打开（无代理）→ 回落绝对地址（此时需在启动器授权 CORS）
function resolveSdUrl(apiBase, path) {
  const isLocalSd = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(apiBase || '').trim())
  const canProxy =
    typeof location !== 'undefined' && location.protocol.startsWith('http')
  if (isLocalSd && canProxy) return path
  return String(apiBase || '').replace(/\/+$/, '') + path
}

// SD WebUI：txt2img
async function genWithSD(api, p) {
  const base = String(api.apiBase || 'http://127.0.0.1:7860').replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json' }
  const body = {
    prompt: p.prompt,
    negative_prompt: p.negativePrompt || DEFAULT_NEGATIVE,
    width: p.width || 512,
    height: p.height || 512,
    steps: p.steps || 24,
    cfg_scale: p.cfgScale || 7,
    sampler_name: p.sampler || 'DPM++ 2M Karras',
    seed: -1,
  }
  const res = await fetchJson(resolveSdUrl(base, '/sdapi/v1/txt2img'), { method: 'POST', headers, body: JSON.stringify(body) })
  const list = ((res && res.images) || []).map((b) => toDataUrl(b)).filter(Boolean)
  if (!list.length) throw new Error('SD WebUI 未返回图片数据（请确认已开启 API）')
  return list
}

// OpenAI 兼容：images/generations
async function genWithOpenAI(api, p) {
  const base = String(api.apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('请填写接口地址')
  const headers = { 'Content-Type': 'application/json' }
  if (api.apiKey) headers.Authorization = 'Bearer ' + api.apiKey
  const body = {
    model: api.model || 'dall-e-3',
    prompt: p.prompt,
    n: p.count || 1,
    size: p.size || '1024x1024',
    response_format: 'b64_json',
  }
  const res = await fetchJson(base + '/images/generations', { method: 'POST', headers, body: JSON.stringify(body) })
  const list = ((res && res.data) || [])
    .map((d) => toDataUrl(d.b64_json) || (d.url ? String(d.url) : ''))
    .filter(Boolean)
  if (!list.length) throw new Error('接口未返回图片数据')
  return list
}

// ---- 对外主入口 ----

/**
 * 生成图片
 * @param {Object} api 绘画接口配置 { type: 'sd-webui'|'openai', apiBase, apiKey, model }
 * @param {Object} p   { prompt, negativePrompt, width, height, count, steps, cfgScale, size }
 * @returns {Promise<string[]>} dataURL 数组
 */
export async function generateImage(api, p) {
  if (!api || !api.apiBase) throw new Error('请先在个人中心配置绘画接口')
  if (!p.prompt || !p.prompt.trim()) throw new Error('提示词不能为空')
  if (api.type === 'openai') return genWithOpenAI(api, p)
  return genWithSD(api, p)
}

/**
 * 连通测试
 * @returns {Promise<string>} 结果描述
 */
export async function testImageApi(api) {
  if (!api || !api.apiBase) throw new Error('请先填写接口地址')
  const base = String(api.apiBase).replace(/\/+$/, '')
  if (api.type === 'openai') {
    const headers = {}
    if (api.apiKey) headers.Authorization = 'Bearer ' + api.apiKey
    await fetchJson(base + '/models', { headers }, 15000)
    return '连接成功（/models 可达）'
  }
  await fetchJson(resolveSdUrl(base, '/sdapi/v1/options'), {}, 15000)
  return '连接成功（SD WebUI API 已开启）'
}
