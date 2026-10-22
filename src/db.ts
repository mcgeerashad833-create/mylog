import Dexie, { type EntityTable } from 'dexie'

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  note: string
  /** YYYY-MM-DD；为 null 表示在收集箱 */
  date: string | null
  /** HH:mm */
  time: string | null
  star: boolean
  tag: string | null
  done: boolean
  /** 完成时间 ISO 字符串 */
  doneAt: string | null
  /** 同一天内的手动排序，越小越靠前 */
  order: number
  subtasks: Subtask[]
  createdAt: string
  /** 以下两个字段为多设备同步准备：按 updatedAt 合并，删除用软删除标记 */
  updatedAt: string
  deletedAt: string | null
}

/** 每天一条：晚间收尾写下的一句话 */
export interface Day {
  /** YYYY-MM-DD */
  date: string
  note: string
  /** 点「结束今天」的时间，未结束为 null */
  closedAt: string | null
  updatedAt: string
}

/** 待推送到服务器的改动，key 形如 "tasks:<id>"、"days:<date>" */
export interface OutboxEntry {
  key: string
  table: 'tasks' | 'days'
  id: string
  updatedAt: string
}

export const db = new Dexie('mylog') as Dexie & {
  tasks: EntityTable<Task, 'id'>
  days: EntityTable<Day, 'date'>
  outbox: EntityTable<OutboxEntry, 'key'>
}

db.version(1).stores({
  tasks: 'id, date, done, updatedAt',
})

db.version(2).stores({
  tasks: 'id, date, done, updatedAt',
  days: 'date, updatedAt',
})

db.version(3).stores({
  tasks: 'id, date, done, updatedAt',
  days: 'date, updatedAt',
  outbox: 'key',
})
