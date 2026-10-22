import type { Meeting, MeetingNote } from '../db'
import { NOTE_LABEL, startAt } from './meeting'

export interface SearchHit {
  meeting: Meeting
  /** 会议本身（标题、地点、会前备注）是否命中 */
  meetingHit: boolean
  notes: MeetingNote[]
}

export function searchTerms(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * 在所有会议里搜：每个词都要出现。
 * 一条记录命中 = 每个词出现在这条记录（内容、负责人、类型）或它所在会议的标题里，
 * 这样「周会 预算」能找到周会上关于预算的那条。
 */
export function searchMeetings(meetings: Meeting[], q: string): SearchHit[] {
  const terms = searchTerms(q)
  if (terms.length === 0) return []
  const hits: SearchHit[] = []
  for (const m of meetings) {
    if (m.deletedAt) continue
    const title = m.title.toLowerCase()
    const meetingText = [m.title, m.location ?? '', ...m.prep.map((p) => p.text)].join(' ').toLowerCase()
    const meetingHit = terms.every((t) => meetingText.includes(t))
    const notes = m.notes.filter((n) => {
      const text = [n.text, n.owner ?? '', NOTE_LABEL[n.type]].join(' ').toLowerCase()
      // 至少有一个词落在记录本身，不然整场会的记录都会命中
      return terms.some((t) => text.includes(t)) && terms.every((t) => text.includes(t) || title.includes(t))
    })
    if (meetingHit || notes.length > 0) hits.push({ meeting: m, meetingHit, notes })
  }
  return hits.sort((a, b) => startAt(b.meeting).getTime() - startAt(a.meeting).getTime())
}

/** 把文字切成命中 / 没命中的片段，用来高亮 */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (terms.length === 0) return [{ text, hit: false }]
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: terms.includes(part.toLowerCase()) }))
}
