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
  /** 来自哪场会议（会上领的待办），普通任务为空 */
  meetingId?: string | null
  createdAt: string
  /** 以下两个字段为多设备同步准备：按 updatedAt 合并，删除用软删除标记 */
  updatedAt: string
  deletedAt: string | null
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

export interface Meeting {
  id: string
  title: string
  kind: MeetingKind
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
  meetings: EntityTable<Meeting, 'id'>
}

db.version(1).stores({
  tasks: 'id, date, done, updatedAt',
})

db.version(2).stores({
  tasks: 'id, date, done, updatedAt, meetingId',
  meetings: 'id, date, updatedAt',
})
