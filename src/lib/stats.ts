import type { Meeting, MeetingKind, Task } from '../db'
import { addDays, fromKey } from './date'
import { endAt, isMine, startAt } from './meeting'

/** 这一天所在那周的周一 */
export function mondayOf(day: string): string {
  return addDays(day, -((fromKey(day).getDay() + 6) % 7))
}

export function hoursOf(m: Meeting): number {
  return (endAt(m).getTime() - startAt(m).getTime()) / 3600_000
}

export interface WeekStat {
  /** 周一 YYYY-MM-DD */
  start: string
  hours: number
  count: number
}

/** 最近几周（含本周）每周开会时长，按日程上的时间算，删掉的会不算 */
export function weeklyHours(meetings: Meeting[], today: string, weeks = 8): WeekStat[] {
  const thisMonday = mondayOf(today)
  const out: WeekStat[] = []
  for (let i = weeks - 1; i >= 0; i--) out.push({ start: addDays(thisMonday, -7 * i), hours: 0, count: 0 })
  for (const m of meetings) {
    if (m.deletedAt) continue
    const w = out.find((x) => x.start === mondayOf(m.date))
    if (!w) continue
    w.hours += hoursOf(m)
    w.count++
  }
  return out
}

export function hoursByKind(meetings: Meeting[], from: string, to: string): Record<MeetingKind, number> {
  const out: Record<MeetingKind, number> = { online: 0, offline: 0, hybrid: 0 }
  for (const m of meetings) if (!m.deletedAt && m.date >= from && m.date <= to) out[m.kind] += hoursOf(m)
  return out
}

export interface TodoStat {
  /** 截止前完成 */
  onTime: number
  /** 过了截止才完成 */
  late: number
  /** 没完成，已经过了截止 */
  overdue: number
  /** 没完成，还没到截止或没写截止 */
  open: number
  /** 完成了，但没写截止日期 */
  doneNoDue: number
  /** 按时完成率：按时 / (按时 + 晚了 + 逾期未完成)；没有可算的返回 null */
  rate: number | null
}

const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 我负责的会议待办完成得怎么样；截止日期以纪要里写的为准 */
export function todoStats(meetings: Meeting[], tasks: Task[], today: string, from: string): TodoStat {
  const s: TodoStat = { onTime: 0, late: 0, overdue: 0, open: 0, doneNoDue: 0, rate: null }
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  for (const m of meetings) {
    if (m.deletedAt || m.date < from) continue
    for (const n of m.notes) {
      if (!isMine(n) || !n.taskId) continue
      const t = taskById.get(n.taskId)
      if (!t || t.deletedAt) continue
      if (t.done && t.doneAt) {
        if (!n.due) s.doneNoDue++
        else if (dayOf(t.doneAt) <= n.due) s.onTime++
        else s.late++
      } else if (n.due && n.due < today) s.overdue++
      else s.open++
    }
  }
  const judged = s.onTime + s.late + s.overdue
  s.rate = judged ? s.onTime / judged : null
  return s
}
