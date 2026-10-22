import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? listFiles(p) : [p]
  })
}

/**
 * 打包时生成 dist/sw.js：把 sw/sw.js 里的版本号和预缓存清单（打包出的文件 + public 下的图标等）填进去。
 * 文件名带内容哈希，所以只要代码变了，版本号就会变，浏览器会自动装上新的 Service Worker。
 */
function serviceWorker(): Plugin {
  return {
    name: 'mylog-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = listFiles('public').map((p) => '/' + relative('public', p).replaceAll('\\', '/'))
      const files = ['/', ...Object.keys(bundle).filter((f) => f !== 'index.html').map((f) => '/' + f), ...publicFiles].sort()
      const index = bundle['index.html']
      const version = createHash('sha256')
        .update(files.join('\n'))
        .update(index && index.type === 'asset' ? String(index.source) : '')
        .digest('hex')
        .slice(0, 12)
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'node',
  },
} as any)
