// =============================================================================
// IndexedDB 底层封装（零依赖，纯浏览器本地存储，不与任何服务器通信）
//
// 两个关键处理：
// 1) 事务陷阱：IndexedDB 事务会在微任务队列清空且无待处理请求时自动关闭，
//    所以「创建 transaction」与「发起请求」之间不能有 await，
//    下面 wrapReq 把 makeReq 作为同步回调传入来规避。
// 2) 降级：file:// 协议下 Chrome 禁用 IndexedDB，此时自动降级为内存存储，
//    保证界面仍可用（只是刷新后不保留），不会整页空白。
// =============================================================================

const DB_NAME = 'ai-character-chat'
// v2: 新增 jailbreaks（破甲预设）；v3: 新增 lorebooks（世界书库）
const DB_VERSION = 3

const KEY_PATH = {
  characters: 'id',
  personas: 'id',
  sessions: 'id',
  messages: 'id',
  settings: 'key',
  jailbreaks: 'id',
  lorebooks: 'id',
}

// ---- 内存降级存储 ----
const memory = {
  characters: new Map(),
  personas: new Map(),
  sessions: new Map(),
  messages: new Map(),
  settings: new Map(),
  jailbreaks: new Map(),
  lorebooks: new Map(),
}
let useFallback = false

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    // 超时预算：普通打开 1.5s；一旦出现 onupgradeneeded / onblocked（说明接口有响应，
    // 只是在升级或等旧标签页让路）就把预算放宽到 8s，避免升级慢/多标签页被误判降级
    let timer = setTimeout(() => reject(new Error('IndexedDB 打开超时')), 1500)
    const extend = (ms) => {
      clearTimeout(timer)
      timer = setTimeout(() => reject(new Error('IndexedDB 打开超时（升级等待）')), ms)
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      extend(8000)
      const db = req.result
      if (!db.objectStoreNames.contains('characters')) {
        db.createObjectStore('characters', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('personas')) {
        db.createObjectStore('personas', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' })
        s.createIndex('characterId', 'characterId', { unique: false })
        s.createIndex('updateTime', 'updateTime', { unique: false })
      }
      if (!db.objectStoreNames.contains('messages')) {
        const m = db.createObjectStore('messages', { keyPath: 'id' })
        m.createIndex('sessionId', 'sessionId', { unique: false })
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('jailbreaks')) {
        db.createObjectStore('jailbreaks', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('lorebooks')) {
        db.createObjectStore('lorebooks', { keyPath: 'id' })
      }
    }

    // 升级被旧标签页阻塞：不要立刻降级！旧标签页会在 onversionchange 时自动关闭让路，
    // 等它关掉后 onsuccess 仍会触发。这里只是放宽超时预算。
    req.onblocked = () => extend(8000)

    req.onsuccess = () => {
      clearTimeout(timer)
      const db = req.result
      // 关键：本连接收到版本变更请求时自动关闭让路，否则会阻塞其他标签页升级，
      // 导致对方被误判降级到内存模式（数据刷新即丢）
      db.onversionchange = () => {
        try {
          db.close()
        } catch (e) {
          /* ignore */
        }
      }
      resolve(db)
    }
    req.onerror = () => {
      clearTimeout(timer)
      reject(req.error)
    }
  })
  return dbPromise
}

// 取数据库；不可用时切换到内存模式
// 超时预算已在 openDB 内部按事件动态管理（升级/阻塞场景放宽到 8s），这里不再套外层超时
async function getDB() {
  if (useFallback) return null
  try {
    return await openDB()
  } catch (e) {
    console.warn('[db] IndexedDB 不可用，已降级为内存存储（刷新后不保留）：', e && e.message)
    useFallback = true
    return null
  }
}

async function wrapReq(storeName, mode, makeReq) {
  const db = await getDB()
  if (!db) return null // 交给调用方走内存分支
  return new Promise((resolve, reject) => {
    let req
    try {
      const t = db.transaction(storeName, mode)
      req = makeReq(t.objectStore(storeName))
    } catch (e) {
      reject(e)
      return
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function memAll(name) {
  return Array.from(memory[name].values())
}
function memPut(name, value) {
  memory[name].set(value[KEY_PATH[name]], value)
}

// Vue 的 reactive/ref 对象是 Proxy，无法被 IndexedDB structured clone，
// 直接 put 会抛 DataCloneError。这里在写入层统一做一次深克隆兜底，
// 免得每个调用方各自 clone 时漏掉（历史 bug：updateSession / updateApiKey 都踩过）。
// 数据本身都是纯 JSON 结构（无 Date/Map/循环引用），JSON 往返无副作用。
function safeClone(v) {
  if (v === null || typeof v !== 'object') return v
  try {
    return JSON.parse(JSON.stringify(v))
  } catch (e) {
    return v
  }
}

export const idb = {
  async getAll(name) {
    const r = await wrapReq(name, 'readonly', (s) => s.getAll())
    return r !== null ? r : memAll(name)
  },

  async get(name, key) {
    const r = await wrapReq(name, 'readonly', (s) => s.get(key))
    return r !== null ? r : memory[name].get(key)
  },

  async put(name, value) {
    const v = safeClone(value)
    const r = await wrapReq(name, 'readwrite', (s) => s.put(v))
    if (r === null) memPut(name, v)
    return v
  },

  async delete(name, key) {
    const r = await wrapReq(name, 'readwrite', (s) => s.delete(key))
    if (r === null) memory[name].delete(key)
  },

  async clear(name) {
    const r = await wrapReq(name, 'readwrite', (s) => s.clear())
    if (r === null) memory[name].clear()
  },

  async getByIndex(name, index, key) {
    const r = await wrapReq(name, 'readonly', (s) => s.index(index).getAll(key))
    return r !== null ? r : memAll(name).filter((v) => v[index] === key)
  },

  async bulkPut(name, values) {
    const list = values.map(safeClone)
    const db = await getDB()
    if (!db) {
      list.forEach((v) => memPut(name, v))
      return true
    }
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite')
      const s = t.objectStore(name)
      list.forEach((v) => s.put(v))
      t.oncomplete = () => resolve(true)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  },

  async bulkDelete(name, keys) {
    const db = await getDB()
    if (!db) {
      keys.forEach((k) => memory[name].delete(k))
      return true
    }
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite')
      const s = t.objectStore(name)
      keys.forEach((k) => s.delete(k))
      t.oncomplete = () => resolve(true)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  },

  // 调试用：当前是否处于内存降级模式
  isFallback: () => useFallback,
}
