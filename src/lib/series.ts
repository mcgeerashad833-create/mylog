import type { Meeting, MeetingNote, MeetingRepeat, Task } from '../db'
import { addDays } from './date'
import { isOthers } from './meeting'

export const REPEAT_LABEL: Record<MeetingRepeat, string> = {
  none: '不重复',
  weekly: '每周',
  biweekly: '每两周',
}

export function nextDate(date: string, repeat: MeetingRepeat): string {
  return addDays(date, repeat === 'biweekly' ? 14 : 7)
}

/**
 * 例会要补建的下一次：每个例会保证今天或今天以后有一次。
 * 删掉的那一次也算占了位置，所以「取消下周的例会」不会被自动补回来。
 */
export function seriesToExtend(all: Meeting[], today: string): { from: Meeting; date: string }[] {
  const latest = new Map<string, Meeting>()
  for (const m of all) {
    if (!m.seriesId) continue
    const cur = latest.get(m.seriesId)
    if (!cur || m.date > cur.date) latest.set(m.seriesId, m)
  }
  const out: { from: Meeting; date: string }[] = []
  for (const m of latest.values()) {
    if (m.repeat === 'none' || m.date >= today) continue
    let d = m.date
    while (d < today) d = nextDate(d, m.repeat)
    out.push({ from: m, date: d })
  }
  return out
}

export interface CarryOver {
  /** 我负责、还没做完的 */
  mine: Task[]
  /** 别人负责、我还没确认完成的 */
  others: { meeting: Meeting; note: MeetingNote }[]
}

/** 同一个例会之前几次留下、还没完成的待办 */
export function carryOver(m: Meeting, meetings: Meeting[], tasks: Task[]): CarryOver {
  if (!m.seriesId) return { mine: [], others: [] }
  const earlier = meetings.filter((x) => x.seriesId === m.seriesId && x.date < m.date && !x.deletedAt)
  const ids = new Set(earlier.map((x) => x.id))
  // 先到期的在前，没有截止日期的放最后
  const byDue = (a: string | null, b: string | null) => (a ?? '9999').localeCompare(b ?? '9999')
  return {
    mine: tasks
      .filter((t) => !t.done && !t.deletedAt && t.meetingId && ids.has(t.meetingId))
      .sort((a, b) => byDue(a.date, b.date)),
    others: earlier
      .filter((x) => x.summarizedAt)
      .flatMap((x) => x.notes.filter((n) => isOthers(n) && !n.done && n.text).map((note) => ({ meeting: x, note })))
      .sort((a, b) => byDue(a.note.due, b.note.due)),
  }
}
