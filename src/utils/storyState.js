const STATE_KEYS = ['location', 'time', 'mood', 'relationship', 'outfit', 'inventory', 'flags']

function asText(value) {
  return value == null ? '' : String(value).trim()
}

function normalizeInventory(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      if (typeof item === 'string') return { name: item, count: 1, icon: '' }
      return {
        name: asText(item && (item.name || item.title)),
        count: item && item.count != null ? item.count : 1,
        icon: asText(item && item.icon),
        description: asText(item && item.description),
      }
    })
    .filter((item) => item.name)
    .slice(0, 50)
}

function normalizeFlags(list) {
  if (!Array.isArray(list)) return []
  return list.map(asText).filter(Boolean).slice(0, 30)
}

export function normalizeStoryState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    location: asText(source.location),
    time: asText(source.time),
    mood: asText(source.mood),
    relationship: asText(source.relationship),
    outfit: asText(source.outfit),
    inventory: normalizeInventory(source.inventory),
    flags: normalizeFlags(source.flags),
  }
}

export function hasStoryState(raw) {
  const state = normalizeStoryState(raw)
  return STATE_KEYS.some((key) => {
    const value = state[key]
    return Array.isArray(value) ? value.length > 0 : !!value
  })
}

export function mergeStoryState(current, patch) {
  const base = normalizeStoryState(current)
  const next = patch && typeof patch === 'object' ? patch : {}
  const merged = { ...base }
  for (const key of STATE_KEYS) {
    if (next[key] === undefined || next[key] === null) continue
    if (key === 'inventory') merged.inventory = normalizeInventory(next.inventory)
    else if (key === 'flags') merged.flags = normalizeFlags(next.flags)
    else merged[key] = asText(next[key])
  }
  return merged
}

export function storyStateToPrompt(raw) {
  const state = normalizeStoryState(raw)
  if (!hasStoryState(state)) return ''
  const lines = []
  if (state.location) lines.push('地点：' + state.location)
  if (state.time) lines.push('时间：' + state.time)
  if (state.mood) lines.push('心情：' + state.mood)
  if (state.relationship) lines.push('关系：' + state.relationship)
  if (state.outfit) lines.push('服装：' + state.outfit)
  if (state.inventory.length) {
    lines.push('物品：' + state.inventory.map((x) => `${x.icon ? x.icon + ' ' : ''}${x.name} ×${x.count}`).join('、'))
  }
  if (state.flags.length) lines.push('剧情标记：' + state.flags.join('、'))
  return lines.join('\n')
}

function parseJsonObject(text) {
  const source = String(text || '').trim()
  if (!source) return null
  try { return JSON.parse(source) } catch (e) {}
  const match = source.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch (e) { return null }
}

export function parseStateUpdate(text) {
  const raw = String(text || '')
  const match = raw.match(/<state_update>\s*([\s\S]*?)(?:<\/state_update>|$)/i)
  if (!match) return { text: raw, patch: null }
  const patch = parseJsonObject(match[1])
  const visible = raw.replace(match[0], '').trim()
  return { text: visible, patch: patch && typeof patch === 'object' ? patch : null }
}

export function stripStateMarkup(text) {
  return String(text || '')
    .replace(/<state_update>[\s\S]*?(?:<\/state_update>|$)/gi, '')
    .replace(/<\/?state_update>/gi, '')
    .trim()
}

export function safeRichHtml(input) {
  const source = String(input || '')
  if (!source) return ''
  if (typeof document === 'undefined') {
    return source
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  }
  const template = document.createElement('template')
  template.innerHTML = source
  // DETAILS/SUMMARY：世界书状态栏的折叠界面；PRE/CODE：保留等宽文本块
  const allowedTags = new Set(['DIV', 'SPAN', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'STRONG', 'EM', 'B', 'I', 'U', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG', 'DETAILS', 'SUMMARY', 'PRE', 'CODE'])
  const allowedAttrs = new Set(['class', 'style', 'src', 'alt', 'title', 'width', 'height'])
  const nodes = [template.content, ...template.content.querySelectorAll('*')]
  nodes.forEach((root) => {
    Array.from(root.children || []).forEach((node) => {
      if (!allowedTags.has(node.tagName)) {
        node.replaceWith(...Array.from(node.childNodes))
        return
      }
      Array.from(node.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        if (!allowedAttrs.has(name) || /^(javascript|vbscript|data:text\/html):/i.test(value) || (name === 'src' && !/^(https?:|data:image\/|blob:)/i.test(value))) {
          node.removeAttribute(attr.name)
        }
      })
      node.querySelectorAll('*').forEach((child) => {
        if (!allowedTags.has(child.tagName)) child.replaceWith(...Array.from(child.childNodes))
        else Array.from(child.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase()
          const value = attr.value.trim()
          if (!allowedAttrs.has(name) || /^(javascript|vbscript|data:text\/html):/i.test(value) || (name === 'src' && !/^(https?:|data:image\/|blob:)/i.test(value))) child.removeAttribute(attr.name)
        })
      })
    })
  })
  return template.innerHTML
}
