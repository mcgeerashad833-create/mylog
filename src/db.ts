import Dexie, { type EntityTable } from 'dexie'
import type { Repeat } from './lib/repeat'

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
  /** 重复规则；完成时自动生成下一次 */
  repeat: Repeat | null
  /** 提前几分钟提醒（需要有 time）；null 表示不提醒 */
  remindBefore: number | null
  /** 重复任务完成时生成的下一次的 id，撤销完成时用来删掉它 */
  spawnedId: string | null
  /** 来自哪场会议（会上领的待办），普通任务为空 */
  meetingId?: string | null
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

/** 待推送到服务器的改动，key 形如 "tasks:<id>"、"days:<date>"、"meetings:<id>" */
export interface OutboxEntry {
  key: string
  table: 'tasks' | 'days' | 'meetings'
  id: string
  updatedAt: string
}

/** 腾讯会议 / 线下 / 混合（会议室 + 腾讯会议） */
export type MeetingKind = 'online' | 'offline' | 'hybrid'

/** 会中记录的类型 */
export type NoteType = 'note' | 'decision' | 'todo' | 'question'

export interface MeetingNote {
  id: string
  type: NoteType
  text: string
  /** 记下时距会议开始的秒数 */
  at: number
  /** 待办负责人，「我」表示自己 */
  owner: string | null
  /** 待办截止日期 YYYY-MM-DD */
  due: string | null
  /** 别人负责的待办：我是否已确认完成 */
  done: boolean
  /** 我负责的待办：对应的 MyLog 任务 */
  taskId: string | null
  /** 上次同步到任务时的截止日期，用来判断截止日期是否改过 */
  syncedDue: string | null
}

/** 例会的重复方式 */
export type MeetingRepeat = 'none' | 'weekly' | 'biweekly'

/** 会前备注：想问的问题、要带的东西 */
export interface PrepItem {
  id: string
  text: string
  done: boolean
}

/** 会议整条（含记录、纪要、会前备注）参与多设备同步，后写者胜 */
export interface Meeting {
  id: string
  title: string
  kind: MeetingKind
  repeat: MeetingRepeat
  /** 同一个例会的每一次共用一个 seriesId；不重复的会为空 */
  seriesId: string | null
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  start: string
  /** HH:mm */
  end: string | null
  /** 线下地点 / 会议室 */
  location: string | null
  /** 腾讯会议号，只保留数字 */
  meetingNo: string | null
  password: string | null
  link: string | null
  /** 会前几分钟提醒，0 表示不提醒 */
  remindBefore: number
  notes: MeetingNote[]
  prep: PrepItem[]
  startedAt: string | null
  endedAt: string | null
  /** 保存纪要的时间；为空表示还没整理 */
  summarizedAt: string | null
  remindedAt: string | null
  /** 会后「还没整理纪要」提醒的时间 */
  nudgedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export const db = new Dexie('mylog') as Dexie & {
  tasks: EntityTable<Task, 'id'>
  days: EntityTable<Day, 'date'>
  outbox: EntityTable<OutboxEntry, 'key'>
  meetings: EntityTable<Meeting, 'id'>
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

db.version(4)
  .stores({
    tasks: 'id, date, done, updatedAt, meetingId',
    days: 'date, updatedAt',
    outbox: 'key',
    meetings: 'id, date, updatedAt, seriesId',
  })
  .upgrade((tx) =>
    // 早期测试版本的会议没有这几个字段
    tx
      .table('meetings')
      .toCollection()
      .modify((m: Meeting) => {
        m.repeat ??= 'none'
        m.seriesId ??= null
        m.prep ??= []
      }),
  )
