import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

// 局域网配置共享：API 密钥等配置存在电脑上的 local-sync.json，
// 任何设备（手机/平板）打开应用都会自动拉取这份配置，修改时自动写回。
// 仅在 dev / preview（有 vite 服务）时生效；file:// 单文件版无服务，自动跳过。
function localSyncPlugin() {
  // AI-Card-Catcher 一键联动桥：服务端只负责暂存一个导入包，
  // 浏览器页面轮询后写入自己的 IndexedDB。这样不需要给 IndexedDB
  // 暴露网络 API，也不依赖浏览器跨域能力。
  const linkQueue = []
  const reply = (res, status, data) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify(data))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 30 * 1024 * 1024) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
  const linkHandler = async (req, res, next) => {
    const pathname = String(req.url || '').split('?')[0]
    if (!pathname.startsWith('/link-import/')) return next()
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI-Card-Catcher')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.statusCode = 204
      res.end()
      return
    }
    try {
      if (pathname === '/link-import/receive' && req.method === 'POST') {
        const packet = JSON.parse(await readBody(req) || '{}')
        if (!packet || packet.type !== 'ai-card-catcher-import' || Number(packet.version) !== 1) {
          reply(res, 400, { ok: false, message: '联动数据包格式不正确' })
          return
        }
        const item = { id: 'link-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), packet, receivedAt: Date.now() }
        linkQueue.push(item)
        while (linkQueue.length > 5) linkQueue.shift()
        reply(res, 202, { ok: true, queued: true, id: item.id, message: '联动数据已送达，请在联动导入页确认' })
        return
      }
      if (pathname === '/link-import/pending' && req.method === 'GET') {
        reply(res, 200, linkQueue[0] || { pending: false })
        return
      }
      if (pathname === '/link-import/ack' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}')
        const index = linkQueue.findIndex((x) => x.id === body.id)
        if (index >= 0) linkQueue.splice(index, 1)
        reply(res, 200, { ok: true })
        return
      }
      reply(res, 404, { ok: false, message: 'unknown link-import endpoint' })
    } catch (e) {
      reply(res, 400, { ok: false, message: e.message || String(e) })
    }
  }
  const dataFile = path.resolve(__dirname, 'local-sync.json')
  const readData = () => {
    try {
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    } catch (e) {
      return {}
    }
  }
  const writeData = (d) => fs.writeFileSync(dataFile, JSON.stringify(d, null, 2))
  const handler = (req, res, next) => {
    if (!req.url || !req.url.startsWith('/local-sync')) return next()
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(readData()))
      return
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body || '{}')
          const merged = { ...readData(), ...incoming }
          writeData(merged)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: 'bad json' }))
        }
      })
      return
    }
    next()
  }
  return {
    name: 'local-sync',
    configureServer(server) {
      server.middlewares.use(linkHandler)
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(linkHandler)
      server.middlewares.use(handler)
    },
  }
}

// 把构建产物内联成单个 HTML（用于 file:// 直接双击打开）
// 说明：file:// 协议下浏览器会拦截 ES Module 的外部脚本请求，
// 因此这里改成 IIFE + 内联 JS/CSS，产物不依赖任何外部文件。
function inlineSingleFilePlugin() {
  return {
    name: 'inline-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find((a) => a.fileName.endsWith('.html'))
      if (!htmlAsset) return
      let html = htmlAsset.source

      // 内联 JS（关闭 code-splitting 后只会有一个 js）
      // 注意：JS 在 Rollup 中是 chunk，正文在 .code；CSS 是 asset，正文在 .source
      const jsAsset = Object.values(bundle).find((a) => a.fileName.endsWith('.js'))
      if (jsAsset) {
        const jsCode = jsAsset.code || jsAsset.source
        if (!jsCode) {
          console.warn('[inline-single-file] 未取到 JS 内容，跳过内联')
        } else {
          // 关键 1：把脚本插到 </body> 前，避免内联脚本先于 #app 执行导致白屏。
          // 关键 2：必须用「替换函数」而非替换字符串——JS 里的 $& / $' / $$ 等
          //         在替换字符串中会被当作特殊替换模式，导致代码被打烂。
          const withoutTag = html.replace(/<script\b[^>]*src="[^"]*\.js"[^>]*><\/script>/, '')
          if (withoutTag === html) {
            console.warn('[inline-single-file] 未匹配到 script 标签，跳过内联')
          } else {
            html = withoutTag.replace('</body>', () => `<script>\n${jsCode}\n</script>\n</body>`)
            delete bundle[jsAsset.fileName]
          }
        }
      }

      // 内联 CSS
      const cssAsset = Object.values(bundle).find((a) => a.fileName.endsWith('.css'))
      if (cssAsset) {
        const cssCode = cssAsset.source || cssAsset.code
        if (!cssCode) {
          console.warn('[inline-single-file] 未取到 CSS 内容，跳过内联')
        } else {
          const replaced = html.replace(
            /<link\b[^>]*rel="stylesheet"[^>]*>/,
            () => `<style>\n${cssCode}\n</style>`
          )
          if (replaced === html) {
            console.warn('[inline-single-file] 未匹配到 link 标签，跳过内联')
          } else {
            html = replaced
            delete bundle[cssAsset.fileName]
          }
        }
      }

      htmlAsset.source = html
    },
  }
}

// Vite 配置：仅本地开发 / 本地构建，不涉及任何服务端
export default defineConfig(({ mode }) => {
  // mode === 'file' 时产出可双击打开的单文件版本
  const isFileMode = mode === 'file'

  return {
    plugins: isFileMode ? [vue(), inlineSingleFilePlugin()] : [vue(), localSyncPlugin()],
    base: isFileMode ? './' : '/',
    server: {
      port: 5173,
      // 局域网访问：手机/平板连同一 WiFi 可通过 http://<电脑IP>:5173 打开
      host: true,
      open: true,
      proxy: {
        // 本地 LLM 反向代理：前端填 "/proxy/v1" 即可让 Vite 转发到目标后端
        // 目的：浏览器不会拦截同源请求，从而绕开 CORS
        // 用法：
        //   proxyTarget = 'http://127.0.0.1:1919'
        //   前端 API 网址填 '/proxy/v1'   （等同于 http://127.0.0.1:1919/v1）
        '/proxy': {
          target: process.env.LLM_PROXY_TARGET || 'http://127.0.0.1:1919',
          changeOrigin: true,
          // 去掉 /proxy 前缀，把 /proxy/v1/chat/completions 转发成 /v1/chat/completions
          rewrite: (path) => path.replace(/^\/proxy/, ''),
        },
        // 本地 SD WebUI 反向代理：绘画接口走 "/sdapi/..." 同源转发，浏览器零跨域
        '/sdapi': {
          target: process.env.SD_PROXY_TARGET || 'http://127.0.0.1:7860',
          changeOrigin: true,
        },
      },
    },
    // preview（npm run preview）同样走代理，构建版也有零跨域
    preview: {
      port: 4178,
      host: true,
      proxy: {
        '/proxy': {
          target: process.env.LLM_PROXY_TARGET || 'http://127.0.0.1:1919',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/proxy/, ''),
        },
        '/sdapi': {
          target: process.env.SD_PROXY_TARGET || 'http://127.0.0.1:7860',
          changeOrigin: true,
        },
      },
    },
    build: isFileMode
      ? {
          outDir: 'dist-standalone',
          // 关闭 modulepreload（file:// 下无意义且可能触发跨源请求）
          modulePreload: false,
          rollupOptions: {
            output: {
              // IIFE 才能在 file:// 下作为普通脚本执行
              format: 'iife',
              // IIFE 不支持代码分割，必须合并为单文件
              inlineDynamicImports: true,
            },
          },
        }
      : {},
  }
})
