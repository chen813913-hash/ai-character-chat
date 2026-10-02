// =============================================================================
// 世界书（Lorebook）匹配检索 —— 纯逻辑模块，不依赖浏览器 API
//
// 规则（对齐 SillyTavern 世界信息惯例）：
// - 条目靠 keys 关键词命中，命中后其 content 会被注入 prompt
// - caseSensitive === false 时忽略大小写
// - 命中条目按 insertionOrder 升序排列（数值小的先插入，更靠近系统提示词一侧）
// - 没有 keys 的条目视为“永不自动触发”，直接跳过
// - 命中内容去重（默认开启），避免重复注入
// =============================================================================

const DEFAULT_ORDER = 100

// 规范化条目：补齐缺失字段、剔除非法的 key 与空内容
// 兼容两代条目结构：
//   角色卡内置：{ keys, content, insertionOrder, caseSensitive }
//   世界书库条目：{ keys|keywords, content, constant, order(=insertionOrder), probability, depth, position }
function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((e, index) => {
      const rawKeys = (e && (Array.isArray(e.keys) ? e.keys : Array.isArray(e.keywords) ? e.keywords : [])) || []
      const order = Number.isFinite(e && e.insertionOrder)
        ? e.insertionOrder
        : Number.isFinite(e && e.order)
          ? e.order
          : DEFAULT_ORDER
      return {
        index, // 保留原始下标，用于排序稳定
        keys: rawKeys.filter((k) => typeof k === 'string' && k.length > 0),
        content: typeof (e && e.content) === 'string' ? e.content : '',
        constant: !!(e && e.constant), // 常驻激活：无需关键词，始终注入
        probability: Number.isFinite(e && e.probability) ? e.probability : 100,
        order,
        insertionOrder: order,
        caseSensitive: !!(e && e.caseSensitive),
      }
    })
    .filter((e) => e.content.length > 0 && (e.constant || e.keys.length > 0))
}

/**
 * 取最近若干条消息拼成检索上下文
 * @param {Array<{content:string}>} messages 消息列表
 * @param {number} depth 只取最近 N 条（<=0 表示全部）
 * @returns {string} 上下文文本
 */
export function buildContextText(messages, depth = 6) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const recent = depth > 0 ? messages.slice(-depth) : messages
  return recent
    .map((m) => (m && typeof m.content === 'string' ? m.content : ''))
    .join('\n')
}

/**
 * 在上下文中匹配世界书条目
 * @param {Array} entries lorebook.entries
 * @param {string} context 上下文文本
 * @param {Object} options
 * @param {number} [options.maxEntries=0] 最多返回条数（0 表示不限）
 * @param {boolean} [options.dedupe=true] 是否按内容去重
 * @returns {Array} 命中条目（含 matchedKeys），按 insertionOrder 升序
 */
export function matchLorebookEntries(entries, context, options = {}) {
  const { maxEntries = 0, dedupe = true } = options
  const list = normalizeEntries(entries)
  if (list.length === 0) return []

  const lowerContext = context ? context.toLowerCase() : ''
  const hits = []

  for (const e of list) {
    // 概率注入：probability < 100 时按百分比随机丢弃（每次生成时判定）
    if (e.probability < 100 && Math.random() * 100 >= e.probability) continue

    // 常驻激活条目：跳过关键词匹配，始终命中
    if (e.constant) {
      hits.push({ ...e, matchedKeys: ['常驻'] })
      continue
    }

    // 空上下文时非常驻条目无从匹配
    if (!context) continue

    const matchedKeys = []
    for (const key of e.keys) {
      const hit = e.caseSensitive
        ? context.includes(key)
        : lowerContext.includes(key.toLowerCase())
      if (hit && matchedKeys.indexOf(key) === -1) matchedKeys.push(key)
    }
    if (matchedKeys.length > 0) hits.push({ ...e, matchedKeys })
  }

  // 按 insertionOrder 升序；相同则保持原始顺序
  hits.sort((a, b) => a.insertionOrder - b.insertionOrder || a.index - b.index)

  let result = hits
  if (dedupe) {
    const seen = new Set()
    result = result.filter((h) => {
      const k = h.content.trim()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  if (maxEntries > 0) result = result.slice(0, maxEntries)

  return result
}

/**
 * 把命中条目拼成可注入 prompt 的文本块
 * （下一轮接入 LLM 时，这段文本会作为世界书部分插入请求）
 * @param {Array} hits matchLorebookEntries 的返回值
 * @returns {string} 注入文本；无命中时返回空串
 */
export function buildLorebookPrompt(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return ''
  return hits.map((h) => h.content).join('\n')
}
