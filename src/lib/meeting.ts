import type { Meeting, MeetingKind, MeetingNote, NoteType } from '../db'
import { addDays, fromKey, relativeLabel } from './date'
import { DAY_INDEX, resolveWeekday } from './parse'
import { formatMeetingNo } from './invite'

export const ME = '我'

export const KIND_LABEL: Record<MeetingKind, string> = {
  online: '腾讯会议',
  offline: '线下',
  hybrid: '混合',
}

export const NOTE_LABEL: Record<NoteType, string> = {
  note: '笔记',
  decision: '决议',
  todo: '待办',
  question: '问题',
}

/** 会议的开始时刻 */
export function startAt(m: Pick<Meeting, 'date' | 'start'>): Date {
  const d = fromKey(m.date)
  const [h, min] = m.start.split(':').map(Number)
  d.setHours(h, min, 0, 0)
  return d
}

/** 会议的结束时刻；没填结束时间按 1 小时算，结束早于开始视为跨天 */
export function endAt(m: Pick<Meeting, 'date' | 'start' | 'end'>): Date {
  const s = startAt(m)
  if (!m.end) return new Date(s.getTime() + 3600_000)
  const e = startAt({ date: m.date, start: m.end })
  if (e <= s) e.setDate(e.getDate() + 1)
  return e
}

export type MeetingStatus = 'upcoming' | 'ongoing' | 'recording' | 'pending' | 'ended' | 'done'

export function meetingStatus(m: Meeting, now: Date): MeetingStatus {
  if (m.summarizedAt) return 'done'
  if (m.startedAt && !m.endedAt) return 'recording'
  if (m.endedAt) return 'pending'
  if (now < startAt(m)) return 'upcoming'
  if (now < endAt(m)) return 'ongoing'
  // 没记过东西的会就是开完了，不用整理
  return m.notes.length > 0 ? 'pending' : 'ended'
}

/** 状态的文字，例如「25 分钟后」「记录中」「待整理」 */
export function statusLabel(m: Meeting, now: Date): string {
  const st = meetingStatus(m, now)
  if (st === 'done') return '已整理'
  if (st === 'recording') return '记录中'
  if (st === 'pending') return '待整理'
  if (st === 'ended') return '已结束'
  if (st === 'ongoing') return '进行中'
  const mins = Math.ceil((startAt(m).getTime() - now.getTime()) / 60_000)
  if (mins <= 60) return `${mins} 分钟后`
  return '未开始'
}

/** 在哪儿开：地点、腾讯会议号 */
export function whereLabel(m: Meeting): string {
  const parts: string[] = []
  if (m.kind !== 'online' && m.location) parts.push(m.location)
  if (m.kind !== 'offline' && m.meetingNo) parts.push('腾讯会议 ' + formatMeetingNo(m.meetingNo))
  else if (m.kind !== 'offline') parts.push('腾讯会议')
  return parts.join(' · ')
}

export function timeRange(m: Meeting): string {
  return m.end ? `${m.start} – ${m.end}` : m.start
}

/** 复制给自己或别人用的「会议号 + 密码」 */
export function joinText(m: Meeting): string {
  const lines = [`${m.title}`]
  if (m.meetingNo) lines.push('腾讯会议：' + formatMeetingNo(m.meetingNo))
  if (m.password) lines.push('会议密码：' + m.password)
  if (m.link) lines.push(m.link)
  return lines.join('\n')
}

/** 00:00 形式的计时 */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 从一句话里找出截止日期：今天 / 明天 / 后天 / 周五 / 下周一 / 10月30日，后面可以跟「前」。
 * 返回日期和去掉这几个字之后的文字。
 */
export function extractDue(input: string, today: string): { due: string | null; rest: string } {
  const m = input.match(/(?:(下周|周|星期)([一二三四五六日天])|(今天|明天|后天)|(\d{1,2})月(\d{1,2})[日号]?)(?:之前|前)?/)
  if (!m) return { due: null, rest: input }
  let due: string
  if (m[2]) due = resolveWeekday(today, DAY_INDEX[m[2]], m[1] === '下周')
  else if (m[3]) due = addDays(today, m[3] === '今天' ? 0 : m[3] === '明天' ? 1 : 2)
  else {
    const year = fromKey(today).getFullYear()
    const pad = (n: string) => n.padStart(2, '0')
    due = `${year}-${pad(m[4])}-${pad(m[5])}`
    // 写的月日已经过去很久了，大概是指明年
    if (due < addDays(today, -180)) due = `${year + 1}-${pad(m[4])}-${pad(m[5])}`
  }
  return { due, rest: input.replace(m[0], ' ') }
}

export interface NoteInput {
  type: NoteType
  text: string
  owner: string | null
  due: string | null
}

const PREFIX: Record<string, NoteType> = { 笔: 'note', 决: 'decision', 待: 'todo', 问: 'question' }

/**
 * 解析会中输入的一条记录。
 * 「决：」「待：」「问：」开头可以直接指定类型；待办里的 @某人 是负责人（不写默认是我），「周五前」是截止日期。
 */
export function parseNoteInput(input: string, type: NoteType, today: string): NoteInput {
  let s = input.trim()
  const p = s.match(/^([笔决待问])\s*[:：]\s*/)
  if (p) {
    type = PREFIX[p[1]]
    s = s.slice(p[0].length)
  }
  if (type !== 'todo') return { type, text: s.trim(), owner: null, due: null }

  let owner = ME
  const who = s.match(/[@＠](\S+)/)
  if (who) {
    owner = who[1]
    s = s.replace(who[0], ' ')
  }
  const { due, rest } = extractDue(s, today)
  return { type, text: rest.replace(/\s+/g, ' ').trim(), owner, due }
}

export function isMine(n: MeetingNote): boolean {
  return n.type === 'todo' && n.owner === ME
}

export function isOthers(n: MeetingNote): boolean {
  return n.type === 'todo' && !!n.owner && n.owner !== ME
}

/** 我负责的待办放到哪一天：有截止日期放那天（已过期的放今天），没有就放收集箱 */
export function taskDateFor(due: string | null, today: string): string | null {
  if (!due) return null
  return due < today ? today : due
}

/** 「催一下」的消息 */
export function followMessage(n: MeetingNote, m: Meeting, today: string): string {
  const when = n.due ? `（截止${relativeLabel(n.due, today)}）` : ''
  return `${n.owner}，${m.title}上说的「${n.text}」${when}进展怎么样了？需要我配合的随时说。`
}

/** 应该发出的提醒：会前提醒、会后还没整理纪要的提醒 */
export function dueReminders(meetings: Meeting[], now: Date): { before: Meeting[]; after: Meeting[] } {
  const before: Meeting[] = []
  const after: Meeting[] = []
  const t = now.getTime()
  for (const m of meetings) {
    if (m.deletedAt) continue
    const s = startAt(m).getTime()
    if (m.remindBefore > 0 && !m.remindedAt && t >= s - m.remindBefore * 60_000 && t < s) before.push(m)
    // 只提醒记过东西的会；太久以前的会不再打扰
    const e = m.endedAt ? new Date(m.endedAt).getTime() : endAt(m).getTime()
    if (m.startedAt && !m.summarizedAt && !m.nudgedAt && t >= e + 30 * 60_000 && t < e + 12 * 3600_000) after.push(m)
  }
  return { before, after }
}
