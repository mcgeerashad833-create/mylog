import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Task } from './db'
import { fromKey } from './lib/date'
import { showNotification } from './pwa'

// 提醒开关和已提醒记录是本机偏好，存 localStorage
const ENABLED_KEY = 'mylog.remind'
const FIRED_KEY = 'mylog.reminded'
/** 错过太久的提醒（比如电脑睡眠了）就不补发了 */
const LATE_LIMIT_MS = 10 * 60 * 1000

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setRemindersEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch {
    // 忽略
  }
  emit()
  if (on) void ensureNotifyPermission()
}

export type Permission = NotificationPermission | 'unsupported'

function readPermission(): Permission {
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

/** 提醒开关 + 系统通知授权状态 */
export function useReminderSettings(): { enabled: boolean; permission: Permission } {
  const enabled = useSyncExternalStore(subscribe, readEnabled)
  const permission = useSyncExternalStore(subscribe, readPermission)
  return { enabled, permission }
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** 浏览器要求在用户操作时申请通知权限；在设置了时间或打开开关时调用 */
export async function ensureNotifyPermission(): Promise<Permission> {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'default' && readEnabled()) {
    await Notification.requestPermission()
    emit()
  }
  return Notification.permission
}

export function fireTime(t: Task): number | null {
  if (t.done || t.deletedAt || !t.date || !t.time) return null
  const before = t.remindBefore === undefined ? 0 : t.remindBefore
  if (before === null) return null
  const [h, m] = t.time.split(':').map(Number)
  const d = fromKey(t.date)
  d.setHours(h, m, 0, 0)
  return d.getTime() - before * 60_000
}

/** 现在该提醒的任务；fired 里记的是已经提醒过的 key */
export function dueReminders(tasks: Task[], now: number, fired: Record<string, number>): { task: Task; key: string }[] {
  const out: { task: Task; key: string }[] = []
  for (const task of tasks) {
    const at = fireTime(task)
    if (at === null || at > now || now - at > LATE_LIMIT_MS) continue
    // 改了日期、时间或提前量都算新的提醒
    const key = `${task.id}@${at}`
    if (!fired[key]) out.push({ task, key })
  }
  return out
}

function readFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeFired(fired: Record<string, number>): void {
  // 只留两天内的记录
  const cutoff = Date.now() - 2 * 86400_000
  const kept = Object.fromEntries(Object.entries(fired).filter(([, at]) => at > cutoff))
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(kept))
  } catch {
    // 忽略
  }
}

function describe(t: Task, at: number): string {
  const mins = Math.round((fromTime(t) - at) / 60_000)
  return mins > 0 ? `${mins >= 60 ? mins / 60 + ' 小时' : mins + ' 分钟'}后（${t.time}）` : `现在（${t.time}）`
}

function fromTime(t: Task): number {
  const [h, m] = t.time!.split(':').map(Number)
  const d = fromKey(t.date!)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/**
 * 应用开着时每 15 秒检查一次，到点就发系统通知（没授权时只在页面里提示）。
 * 关掉所有 MyLog 页面后不会提醒——网页做不到后台推送，以后做桌面或手机客户端再补。
 */
export function useReminders(tasks: Task[], onFire: (t: Task, text: string, viaSystem: boolean) => void) {
  const { enabled } = useReminderSettings()
  const latest = useRef({ tasks, onFire })
  latest.current = { tasks, onFire }

  useEffect(() => {
    if (!enabled) return
    const check = () => {
      const fired = readFired()
      const now = Date.now()
      const due = dueReminders(latest.current.tasks, now, fired)
      if (!due.length) return
      for (const { task, key } of due) {
        fired[key] = now
        const text = `${describe(task, fireTime(task)!)}：${task.title}`
        // 点通知后由 App 里的 onNotificationClick 打开这件事
        void showNotification('MyLog 提醒', text, key, { kind: 'task', id: task.id }).then((system) =>
          latest.current.onFire(task, text, system),
        )
      }
      writeFired(fired)
    }
    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [enabled])
}
