// 富内容开场白的数据规范化工具。
// 约定：每个角色只有一套可选的 openingContent；内容块由用户自行添加，默认为空。

export const OPENING_BLOCK_TYPES = ['text', 'video', 'html', 'image', 'form']

export const OPENING_BLOCK_LABELS = {
  text: '文字',
  video: '视频',
  html: '嵌入 HTML',
  image: '图片',
  form: '开场表单',
}

function text(value) {
  return value == null ? '' : String(value)
}

function safeType(value) {
  return OPENING_BLOCK_TYPES.includes(value) ? value : 'text'
}

function newId(prefix = 'opening-block') {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function normalizeFormField(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const type = ['radio', 'checkbox', 'text', 'number'].includes(source.type) ? source.type : 'text'
  const options = Array.isArray(source.options)
    ? source.options
        .map((item) => {
          if (typeof item === 'string') return { label: item, value: item }
          return {
            label: text(item && (item.label || item.name)).trim(),
            value: text(item && item.value != null ? item.value : item && (item.label || item.name)).trim(),
          }
        })
        .filter((item) => item.label)
    : []
  return {
    id: text(source.id).trim() || newId('opening-field') + '-' + index,
    label: text(source.label || source.title).trim() || '未命名字段',
    description: text(source.description).trim(),
    type,
    required: !!source.required,
    placeholder: text(source.placeholder),
    defaultValue: source.defaultValue == null ? '' : source.defaultValue,
    options,
  }
}

export function normalizeOpeningBlock(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const type = safeType(source.type)
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {}
  const normalized = {
    id: text(source.id).trim() || newId() + '-' + index,
    type,
    title: text(source.title || OPENING_BLOCK_LABELS[type]).trim() || OPENING_BLOCK_LABELS[type],
    content: text(source.content || source.text || source.url),
    settings: { ...settings },
  }

  if (type === 'video') {
    normalized.settings = {
      poster: text(settings.poster),
      autoplay: !!settings.autoplay,
      controls: settings.controls !== false,
      loop: !!settings.loop,
    }
  } else if (type === 'image') {
    normalized.settings = {
      alt: text(settings.alt),
      fit: settings.fit === 'cover' ? 'cover' : 'contain',
    }
  } else if (type === 'form') {
    normalized.settings = {
      submitLabel: text(settings.submitLabel).trim() || '提交并开始剧情',
      fields: Array.isArray(settings.fields) ? settings.fields.map(normalizeFormField) : [],
    }
  }

  return normalized
}

export function normalizeOpeningContent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const blocks = Array.isArray(source.blocks)
    ? source.blocks.map(normalizeOpeningBlock).filter(Boolean)
    : []
  return {
    enabled: !!source.enabled,
    blocks,
  }
}

// 旧角色卡只有 first_mes / alternate_greetings 时，把旧开场迁移为富内容文字块。
// 这样移除旧编辑区后，已有角色的开场内容不会丢失；用户可以继续编辑、排序或删除这些文字块。
export function openingContentFromCharacter(card) {
  const source = card && typeof card === 'object' ? card : {}
  const explicit = normalizeOpeningContent(source.openingContent || source.opening_content)
  if (explicit.blocks.length) return explicit

  const blocks = []
  const first = text(source.first_mes).trim()
  if (first) {
    blocks.push(normalizeOpeningBlock({
      id: 'legacy-first-mes',
      type: 'text',
      title: '开场文字',
      content: first,
    }))
  }
  const alternates = Array.isArray(source.alternate_greetings) ? source.alternate_greetings : []
  alternates.forEach((item, index) => {
    const content = typeof item === 'string' ? item : item && (item.content || item.text || item.message)
    if (!text(content).trim()) return
    blocks.push(normalizeOpeningBlock({
      id: text(item && item.id).trim() || 'legacy-alternate-' + index,
      type: 'text',
      title: text(item && (item.title || item.name)).trim() || '备用开场 ' + (index + 1),
      content: text(content).trim(),
    }))
  })

  return {
    enabled: blocks.length > 0,
    blocks,
  }
}

export function hasOpeningContent(raw) {
  const content = normalizeOpeningContent(raw)
  return content.enabled && content.blocks.length > 0
}

export function createOpeningBlock(type) {
  const safe = safeType(type)
  const base = normalizeOpeningBlock({ type: safe, title: OPENING_BLOCK_LABELS[safe] })
  if (safe === 'text') base.content = ''
  if (safe === 'html') base.content = '<div class="opening-card"><h3>标题</h3><p>在这里填写 HTML 内容</p></div>'
  if (safe === 'image') base.settings = { alt: '开场图片', fit: 'contain' }
  if (safe === 'video') base.settings = { poster: '', autoplay: false, controls: true, loop: false }
  if (safe === 'form') {
    base.settings = {
      submitLabel: '提交并开始剧情',
      fields: [normalizeFormField({ label: '你的选择', type: 'radio', required: true, options: [{ label: '选项一', value: '选项一' }, { label: '选项二', value: '选项二' }] })],
    }
  }
  return base
}

export function isSafeOpeningAssetUrl(value, kind = 'image') {
  const url = text(value).trim()
  if (!url) return false
  if (/^https?:\/\//i.test(url) || /^blob:/i.test(url)) return true
  if (kind === 'video') return /^data:video\/[a-z0-9.+-]+;base64,/i.test(url)
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(url)
}

export function openingBlockSummary(block) {
  const item = normalizeOpeningBlock(block)
  if (item.type === 'form') {
    const count = item.settings.fields.length
    return count ? `${count} 个表单字段` : '尚未添加表单字段'
  }
  if (item.type === 'video') return item.content ? '已设置视频地址' : '尚未设置视频地址'
  if (item.type === 'image') return item.content ? '已设置图片地址' : '尚未设置图片地址'
  if (item.type === 'html') return item.content ? '自定义 HTML 界面' : '尚未填写 HTML'
  return item.content ? item.content.replace(/\s+/g, ' ').slice(0, 70) : '尚未填写文字'
}
