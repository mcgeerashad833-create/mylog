import { db, type Day, type Subtask, type Task } from './db'
import { todayKey } from './lib/date'
import { nextAfter, type Repeat } from './lib/repeat'
import { scheduleSync } from './sync'

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

/** 记下哪些记录改过，等下次同步时推送 */
async function touch(table: 'tasks' | 'days', ids: string[], updatedAt: string): Promise<void> {
  await db.outbox.bulkPut(ids.map((id) => ({ key: `${table}:${id}`, table, id, updatedAt })))
  scheduleSync()
}

export function isAlive(t: Task): boolean {
  return !t.deletedAt
}

export function byOrder(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt)
}

export interface NewTask {
  title: string
  date?: string | null
  time?: string | null
  star?: boolean
  tag?: string | null
  repeat?: Repeat | null
  note?: string
  meetingId?: string | null
}

export async function addTask(input: NewTask): Promise<Task> {
  const all = await db.tasks.toArray()
  // 新加的事排在最前面
  const minOrder = all.reduce((m, t) => Math.min(m, t.order), 0)
  const ts = now()
  const task: Task = {
    id: uid(),
    title: input.title,
    note: input.note ?? '',
    date: input.date === undefined ? todayKey() : input.date,
    time: input.time ?? null,
    star: input.star ?? false,
    tag: input.tag ?? null,
    done: false,
    doneAt: null,
    order: minOrder - 1,
    subtasks: [],
    repeat: input.repeat ?? null,
    remindBefore: 0,
    spawnedId: null,
    meetingId: input.meetingId ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.tasks.add(task)
  await touch('tasks', [task.id], ts)
  return task
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void> {
  const ts = now()
  await db.tasks.update(id, { ...patch, updatedAt: ts })
  await touch('tasks', [id], ts)
}

export async function toggleDone(t: Task): Promise<void> {
  if (t.done) {
    // 撤销完成：之前顺手生成的下一次，如果还没动过就一起撤掉
    if (t.spawnedId) {
      const next = await db.tasks.get(t.spawnedId)
      if (next && !next.done && !next.deletedAt) await deleteTask(next.id)
    }
    await updateTask(t.id, { done: false, doneAt: null, spawnedId: null })
    return
  }
  let spawnedId: string | null = null
  if (t.repeat && t.date) {
    // 下一次从「原定日期」和「今天」中较晚的那天往后算，避免补出一串过期的
    const today = todayKey()
    const base = t.date > today ? t.date : today
    const next = await addTask({ title: t.title, date: nextAfter(t.repeat, base), time: t.time, star: t.star, tag: t.tag, repeat: t.repeat })
    await updateTask(next.id, {
      note: t.note,
      order: t.order,
      remindBefore: t.remindBefore,
      subtasks: t.subtasks.map((s) => ({ ...s, done: false })),
    })
    spawnedId = next.id
  }
  await updateTask(t.id, { done: true, doneAt: now(), spawnedId })
}

export async function deleteTask(id: string): Promise<void> {
  await updateTask(id, { deletedAt: now() })
}

export async function restoreTask(id: string): Promise<void> {
  await updateTask(id, { deletedAt: null })
}

export async function moveTo(ids: string[], date: string | null): Promise<void> {
  const ts = now()
  await db.tasks.bulkUpdate(ids.map((id) => ({ key: id, changes: { date, updatedAt: ts } })))
  await touch('tasks', ids, ts)
}

/** 按拖拽后的新顺序重写 order */
export async function reorder(ids: string[]): Promise<void> {
  const ts = now()
  await db.tasks.bulkUpdate(ids.map((id, i) => ({ key: id, changes: { order: i, updatedAt: ts } })))
  await touch('tasks', ids, ts)
}

export async function setSubtasks(id: string, subtasks: Subtask[]): Promise<void> {
  await updateTask(id, { subtasks })
}

export function newSubtask(title: string): Subtask {
  return { id: uid(), title, done: false }
}

export async function saveDay(date: string, patch: Partial<Omit<Day, 'date'>>): Promise<void> {
  const prev = await db.days.get(date)
  const ts = now()
  await db.days.put({ date, note: '', closedAt: null, ...prev, ...patch, updatedAt: ts })
  await touch('days', [date], ts)
}

// 早间规划每台设备每天只自动弹一次，属于本机偏好，存 localStorage 即可
const PLANNED_KEY = 'mylog.plannedOn'

export function plannedToday(today: string): boolean {
  try {
    return localStorage.getItem(PLANNED_KEY) === today
  } catch {
    return false
  }
}

export function markPlanned(today: string): void {
  try {
    localStorage.setItem(PLANNED_KEY, today)
  } catch {
    // 隐私模式等情况下写不进去，最多就是明天再弹一次
  }
}
