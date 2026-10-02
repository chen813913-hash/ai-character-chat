// =============================================================================
// 文件 IO 工具（本地，无服务端）
// - downloadJson: 把对象下载为 .json 文件
// - pickJsonFile: 弹出文件选择框，返回文件文本
// - 解析/校验：把任意合理格式的 JSON 规范成标准数组
// =============================================================================

// 触发浏览器下载一个 JSON 文件
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : filename + '.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 弹出文件选择器，读取并返回文本
export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return reject(new Error('未选择文件'))
      try {
        const text = await file.text()
        resolve(text)
      } catch (e) {
        reject(e)
      }
    }
    input.click()
  })
}

// 把图片 File 对象读成 base64（data URL），供「点击选择」和「拖拽上传」共用
export function imageFileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('请选择图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// 弹出图片选择器，读取为 base64（data URL），用于本地头像（不上传服务器）
export function pickImageAsDataURL() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return reject(new Error('未选择图片'))
      try {
        resolve(await imageFileToDataURL(file))
      } catch (e) {
        reject(e)
      }
    }
    input.click()
  })
}

import { openingContentFromCharacter } from './openingContent.js'

// 生成兜底 id（导入数据缺 id 时补一个）
function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// 把原始对象规范成标准人物卡
function coerceCharacter(raw) {
  return {
    id: raw.id || genId('c'),
    name: raw.name || '未命名角色',
    description: raw.description || '',
    // 标签最多 3 个
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .filter((t) => typeof t === 'string' && t.trim())
      .slice(0, 3),
    avatar: raw.avatar || '',
    displayName: raw.displayName || '',
    // 封面图集最多 6 张
    covers: (Array.isArray(raw.covers) ? raw.covers : []).slice(0, 6),
    gender: ['female', 'male', 'other'].includes(raw.gender) ? raw.gender : 'other',
    channel: ['male', 'female', 'world'].includes(raw.channel) ? raw.channel : '',
    personality: raw.personality || '',
    scenario: raw.scenario || '',
    first_mes: raw.first_mes || '',
    alternate_greetings: Array.isArray(raw.alternate_greetings) ? raw.alternate_greetings : [],
    // 导入旧角色卡时自动把 first_mes / alternate_greetings 迁移为富内容文字块
    openingContent: openingContentFromCharacter(raw),
    mes_example: raw.mes_example || '',
    system_prompt: raw.system_prompt || '',
    post_history_instructions: raw.post_history_instructions || '',
    creator_notes: raw.creator_notes || '',
    // 角色设定（主设定大文本）/ 状态栏 / 道具
    setting: raw.setting || '',
    status_bar: raw.status_bar || '',
    props: Array.isArray(raw.props) ? raw.props : [],
    lorebook:
      raw.lorebook && Array.isArray(raw.lorebook.entries)
        ? raw.lorebook
        : { entries: [] },
    createTime: raw.createTime || Date.now(),
    updateTime: raw.updateTime || Date.now(),
  }
}

// 把原始对象规范成标准马甲
function coercePersona(raw) {
  return {
    id: raw.id || genId('p'),
    name: raw.name || '未命名马甲',
    avatar: raw.avatar || '',
    persona_text: raw.persona_text || '',
    notes: raw.notes || '',
    createTime: raw.createTime || Date.now(),
    updateTime: raw.updateTime || Date.now(),
  }
}

// 解析人物卡导入文本：兼容 单对象 / 数组 / {characters:[...]} 包装
export function parseImportedCharacters(text) {
  const data = JSON.parse(text)
  let arr = []
  if (Array.isArray(data)) arr = data
  else if (data && Array.isArray(data.characters)) arr = data.characters
  else if (data && typeof data === 'object') arr = [data]
  else throw new Error('无法识别的 JSON 格式')
  return arr.map(coerceCharacter)
}

// 解析马甲导入文本
export function parseImportedPersonas(text) {
  const data = JSON.parse(text)
  let arr = []
  if (Array.isArray(data)) arr = data
  else if (data && Array.isArray(data.personas)) arr = data.personas
  else if (data && typeof data === 'object') arr = [data]
  else throw new Error('无法识别的 JSON 格式')
  return arr.map(coercePersona)
}
