import { useSyncExternalStore } from 'react'

/** 点通知后要打开什么 */
export type NotifyTarget = { kind: 'task'; id: string } | { kind: 'meeting'; page: string; id: string }

let registration: ServiceWorkerRegistration | null = null
let clickHandler: ((t: NotifyTarget) => void) | null = null
let pendingTarget: NotifyTarget | null = null

/**
 * 注册 Service Worker：缓存页面和静态文件，断网也能打开；通知也交给它发。
 * 开发模式不注册，免得缓存干扰改代码。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      registration = reg
    })
    .catch(() => {
      // 注册失败（比如不是 HTTPS）也不影响使用，只是不能离线打开
    })
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'notification-click') deliver(e.data.target)
  })
  // 应用没开着时点通知，Service Worker 会带着 #open=… 打开新窗口
  const m = /^#open=(.+)$/.exec(location.hash)
  if (m) {
    try {
      deliver(JSON.parse(decodeURIComponent(m[1])))
    } catch {
      // 忽略坏掉的链接
    }
    history.replaceState(null, '', location.pathname + location.search)
  }
}

function deliver(t: NotifyTarget) {
  if (clickHandler) clickHandler(t)
  else pendingTarget = t
}

/** 处理「点了通知」：打开对应的任务或会议 */
export function onNotificationClick(handler: (t: NotifyTarget) => void): () => void {
  clickHandler = handler
  if (pendingTarget) {
    handler(pendingTarget)
    pendingTarget = null
  }
  return () => {
    if (clickHandler === handler) clickHandler = null
  }
}

export function notificationsAllowed(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/**
 * 发一条系统通知。优先交给 Service Worker 发：安卓 Chrome 不允许页面直接 new Notification()，会报错。
 * 返回是否真的发出去了。
 */
export async function showNotification(title: string, body: string, tag: string, target: NotifyTarget): Promise<boolean> {
  if (!notificationsAllowed()) return false
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined))
  if (reg?.active) {
    await reg.showNotification(title, { body, tag, silent: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: target })
    return true
  }
  try {
    const n = new Notification(title, { body, tag, silent: true })
    n.onclick = () => {
      window.focus()
      deliver(target)
      n.close()
    }
    return true
  } catch {
    return false
  }
}

// ---- 安装到桌面 / 主屏幕 ----

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 不弹浏览器自带的横幅，安装入口放在设置页
    e.preventDefault()
    installEvent = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    emit()
  })
}

function installState(): 'installed' | 'available' | 'ios' | 'unavailable' {
  if (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) return 'installed'
  if (installEvent) return 'available'
  // iPhone / iPad 的 Safari 没有安装事件，只能手动「添加到主屏幕」
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'ios'
  return 'unavailable'
}

export function useInstallState() {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, installState)
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return
  await installEvent.prompt()
  await installEvent.userChoice
  installEvent = null
  emit()
}
