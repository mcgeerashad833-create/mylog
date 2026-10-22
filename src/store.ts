import { db, type Subtask, type Task } from './db'
import { todayKey } from './lib/date'

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

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
    meetingId: input.meetingId ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.tasks.add(task)
  return task
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: now() })
}

export async function toggleDone(t: Task): Promise<void> {
  await updateTask(t.id, { done: !t.done, doneAt: t.done ? null : now() })
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
}

/** 按拖拽后的新顺序重写 order */
export async function reorder(ids: string[]): Promise<void> {
  const ts = now()
  await db.tasks.bulkUpdate(ids.map((id, i) => ({ key: id, changes: { order: i, updatedAt: ts } })))
}

export async function setSubtasks(id: string, subtasks: Subtask[]): Promise<void> {
  await updateTask(id, { subtasks })
}

export function newSubtask(title: string): Subtask {
  return { id: uid(), title, done: false }
}
