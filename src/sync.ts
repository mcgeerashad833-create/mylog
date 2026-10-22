import { useSyncExternalStore } from 'react'
import { db, type Day, type OutboxEntry, type Task } from './db'

// 登录信息和同步游标是本机状态，放 localStorage
const K = { token: 'mylog.token', email: 'mylog.email', cursor: 'mylog.cursor' }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 存不下就只在本次会话内有效
  }
}

export interface SyncState {
  email: string | null
  status: 'off' | 'idle' | 'syncing' | 'error' | 'offline'
  error: string | null
  lastSyncedAt: string | null
}

let state: SyncState = {
  email: read(K.token) ? read(K.email) : null,
  status: read(K.token) ? 'idle' : 'off',
  error: null,
  lastSyncedAt: null,
}
const listeners = new Set<() => void>()

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = read(K.token)
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, '连不上服务器')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && token) signedOut()
    throw new ApiError(res.status, data.error ?? '请求失败')
  }
  return data as T
}

// ---- 登录 ----

function deviceName(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '设备'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器'
  return `${os} · ${browser}`
}

export function requestCode(email: string) {
  return api<{ ok: true }>('/auth/code', { body: { email } })
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const res = await api<{ token: string; email: string }>('/auth/verify', { body: { email, code, device: deviceName() } })
  write(K.token, res.token)
  write(K.email, res.email)
  write(K.cursor, '0')
  // 登录前在本机记下的事，全部推一次到账户里
  const [tasks, days] = await Promise.all([db.tasks.toArray(), db.days.toArray()])
  await db.outbox.bulkPut([
    ...tasks.map((t): OutboxEntry => ({ key: `tasks:${t.id}`, table: 'tasks', id: t.id, updatedAt: t.updatedAt })),
    ...days.map((d): OutboxEntry => ({ key: `days:${d.date}`, table: 'days', id: d.date, updatedAt: d.updatedAt })),
  ])
  set({ email: res.email, status: 'idle', error: null })
  await syncNow()
}

function signedOut() {
  write(K.token, null)
  write(K.email, null)
  write(K.cursor, null)
  set({ email: null, status: 'off', error: null, lastSyncedAt: null })
}

/** 退出登录：先把没推上去的改动推完，再清空本机数据（云端保留） */
export async function logout(): Promise<void> {
  await syncNow()
  if ((await db.outbox.count()) > 0) throw new ApiError(0, '还有改动没同步上去，请联网后再退出')
  await api('/auth/logout', { body: {} }).catch(() => undefined)
  signedOut()
  await db.transaction('rw', db.tasks, db.days, db.outbox, async () => {
    await Promise.all([db.tasks.clear(), db.days.clear(), db.outbox.clear()])
  })
}

// ---- 同步 ----

let running: Promise<void> | null = null
let again = false

/** 立即同步一次；同步进行中再次调用会在结束后补跑一次 */
export function syncNow(): Promise<void> {
  if (!read(K.token)) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = runOnce().finally(() => {
    running = null
    if (again) {
      again = false
      void syncNow()
    }
  })
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined
/** 本地有改动时调用，稍等片刻合并成一次同步 */
export function scheduleSync(): void {
  if (!read(K.token)) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), 1500)
}

function normalizeTask(t: Partial<Task> & { id: string; updatedAt: string }): Task {
  return {
    title: '',
    note: '',
    date: null,
    time: null,
    star: false,
    tag: null,
    done: false,
    doneAt: null,
    order: 0,
    subtasks: [],
    repeat: null,
    remindBefore: 0,
    spawnedId: null,
    createdAt: t.updatedAt,
    deletedAt: null,
    ...t,
  }
}

async function runOnce(): Promise<void> {
  set({ status: 'syncing' })
  try {
    const outbox = await db.outbox.toArray()
    const taskIds = outbox.filter((o) => o.table === 'tasks').map((o) => o.id)
    const dayIds = outbox.filter((o) => o.table === 'days').map((o) => o.id)
    const [tasks, days] = await Promise.all([db.tasks.bulkGet(taskIds), db.days.bulkGet(dayIds)])
    const pushTasks = tasks.filter((t): t is Task => !!t)
    const pushDays = days.filter((d): d is Day => !!d)

    const res = await api<{ cursor: number; tasks: Task[]; days: Day[] }>('/sync', {
      body: { cursor: Number(read(K.cursor) ?? 0), tasks: pushTasks, days: pushDays },
    })

    await db.transaction('rw', db.tasks, db.days, db.outbox, async () => {
      // 推送期间如果又改了，updatedAt 会变，这样的待推送项留到下一轮
      const pushed = new Map<string, string>()
      pushTasks.forEach((t) => pushed.set(`tasks:${t.id}`, t.updatedAt))
      pushDays.forEach((d) => pushed.set(`days:${d.date}`, d.updatedAt))
      const current = await db.outbox.bulkGet(outbox.map((o) => o.key))
      await db.outbox.bulkDelete(
        current.filter((o): o is OutboxEntry => !!o && (pushed.get(o.key) ?? '') >= o.updatedAt).map((o) => o.key),
      )
      // 合并拉下来的记录：比本地新的才覆盖
      for (const raw of res.tasks) {
        const local = await db.tasks.get(raw.id)
        if (!local || raw.updatedAt > local.updatedAt) await db.tasks.put(normalizeTask(raw))
      }
      for (const d of res.days) {
        const local = await db.days.get(d.date)
        if (!local || d.updatedAt > local.updatedAt) await db.days.put(d)
      }
    })
    write(K.cursor, String(res.cursor))
    set({ status: 'idle', error: null, lastSyncedAt: new Date().toISOString() })
  } catch (e) {
    if (!read(K.token)) return
    const offline = e instanceof ApiError && e.status === 0
    set({ status: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

/** 应用启动时调用：立即同步一次，之后定时、回到窗口、恢复联网时再同步 */
export function startAutoSync(): () => void {
  void syncNow()
  const id = setInterval(() => void syncNow(), 30_000)
  const onWake = () => void syncNow()
  window.addEventListener('focus', onWake)
  window.addEventListener('online', onWake)
  return () => {
    clearInterval(id)
    window.removeEventListener('focus', onWake)
    window.removeEventListener('online', onWake)
  }
}
