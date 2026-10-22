// MyLog 的 Service Worker。打包时由 vite.config.ts 填入版本号和要预先缓存的文件，生成 dist/sw.js。
// - 页面：先走网络，拿到就是最新版；断网时用缓存里的那份，所以离线也能打开
// - 带哈希的静态文件：先查缓存
// - /api/：不经过缓存，同步本来就会处理断网
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = 'mylog-' + VERSION

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // 新版本装好就直接接管：页面本来就先走网络，不会出现新旧混用
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('mylog-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 顺手更新缓存里的页面，下次断网打开的就是这一版
          if (res.ok) {
            const copy = res.clone()
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('/', copy)))
          }
          return res
        })
        .catch(async () => (await caches.match('/', { cacheName: CACHE })) || Response.error()),
    )
    return
  }

  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)))
})

// 点通知：已经开着 MyLog 就切过去并打开对应内容，没开着就新开一个窗口
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = windows[0]
      if (win) {
        await win.focus()
        if (target) win.postMessage({ type: 'notification-click', target })
      } else {
        await self.clients.openWindow(target ? '/#open=' + encodeURIComponent(JSON.stringify(target)) : '/')
      }
    })(),
  )
})
