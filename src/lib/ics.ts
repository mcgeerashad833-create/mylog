// 导出 .ics 日历文件，可以导入到系统日历、Outlook、Google 日历。
// 时间用「本地时间」（不带时区），在你自己的电脑上打开就是会议的时间；例会用 RRULE 继续往后重复。

import type { Meeting } from '../db'
import { formatMeetingNo } from './invite'
import { endAt, startAt, whereLabel } from './meeting'

const pad = (n: number) => String(n).padStart(2, '0')

/** 20261022T100000 */
function local(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

/** 20261022T020000Z */
function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** 每行最多 75 个字节，超出的折到下一行，下一行以空格开头 */
export function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

function description(m: Meeting): string {
  const lines: string[] = []
  if (m.kind === 'offline') return ''
  if (m.meetingNo) lines.push('腾讯会议：' + formatMeetingNo(m.meetingNo))
  if (m.password) lines.push('会议密码：' + m.password)
  if (m.link) lines.push(m.link)
  return lines.join('\n')
}

function event(m: Meeting, stamp: string, rrule?: string, exdates: string[] = []): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${m.id}@mylog`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(startAt(m))}`,
    `DTEND:${local(endAt(m))}`,
    `SUMMARY:${escape(m.title)}`,
  ]
  const where = whereLabel(m)
  if (where) lines.push(`LOCATION:${escape(where)}`)
  const desc = description(m)
  if (desc) lines.push(`DESCRIPTION:${escape(desc)}`)
  if (m.link && m.kind !== 'offline') lines.push(`URL:${m.link}`)
  if (rrule) lines.push(rrule)
  for (const d of exdates) lines.push(`EXDATE:${d}`)
  if (m.remindBefore > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(m.title)}`, `TRIGGER:-PT${m.remindBefore}M`, 'END:VALARM')
  }
  lines.push('END:VEVENT')
  return lines
}

/**
 * 生成日历文件。
 * 例会只导出最后一次（带 RRULE 一直往后重复），之前开过的几次单独导出；
 * 在它之后被删掉的那几次写成 EXDATE，日历里也不会出现。
 */
export function toIcs(meetings: Meeting[], now = new Date()): string {
  const stamp = utc(now)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyLog//Meetings//ZH', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:MyLog 会议']

  const alive = meetings.filter((m) => !m.deletedAt)
  const lastOfSeries = new Map<string, Meeting>()
  for (const m of alive) {
    if (!m.seriesId || m.repeat === 'none') continue
    const cur = lastOfSeries.get(m.seriesId)
    if (!cur || m.date > cur.date) lastOfSeries.set(m.seriesId, m)
  }

  for (const m of [...alive].sort((a, b) => startAt(a).getTime() - startAt(b).getTime())) {
    const last = m.seriesId ? lastOfSeries.get(m.seriesId) : undefined
    if (last && last.id === m.id) {
      const interval = m.repeat === 'biweekly' ? 2 : 1
      const skipped = meetings
        .filter((x) => x.seriesId === m.seriesId && x.deletedAt && x.date > m.date)
        .map((x) => local(startAt({ date: x.date, start: m.start })))
      lines.push(...event(m, stamp, `RRULE:FREQ=WEEKLY;INTERVAL=${interval}`, skipped))
    } else {
      lines.push(...event(m, stamp))
    }
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
