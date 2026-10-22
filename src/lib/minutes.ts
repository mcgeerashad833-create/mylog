import type { Meeting, MeetingNote, NoteType } from '../db'
import { fromKey, longLabel } from './date'
import { KIND_LABEL, timeRange, whereLabel } from './meeting'

const SECTIONS: { type: NoteType; title: string }[] = [
  { type: 'decision', title: '决议' },
  { type: 'todo', title: '待办' },
  { type: 'note', title: '要点' },
  { type: 'question', title: '遗留问题' },
]

/** 10月23日：发给别人的文字里不用「明天」这种相对说法 */
function md(key: string): string {
  const d = fromKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 待办后面的「@负责人 截止日期」 */
export function todoTail(n: MeetingNote): string {
  return [n.owner ? '@' + n.owner : '', n.due ? md(n.due) + '前' : ''].filter(Boolean).join(' ')
}

/**
 * 把纪要转成文字。
 * text：适合直接贴到微信 / 企业微信；markdown：适合贴到文档里。
 */
export function minutesText(m: Meeting, format: 'text' | 'markdown'): string {
  const where = whereLabel(m) || KIND_LABEL[m.kind]
  const when = `${longLabel(m.date)} ${timeRange(m)}`
  const groups = SECTIONS.map((s) => ({ ...s, items: m.notes.filter((n) => n.type === s.type && n.text.trim()) })).filter(
    (s) => s.items.length > 0,
  )
  const lines: string[] = []

  if (format === 'text') {
    lines.push(`【${m.title} 纪要】${when}`, `地点：${where}`)
    for (const g of groups) {
      lines.push('', g.title)
      g.items.forEach((n, i) => {
        const tail = n.type === 'todo' ? todoTail(n) : ''
        lines.push(`${g.type === 'decision' ? `${i + 1}.` : '·'} ${n.text}${tail ? '（' + tail + '）' : ''}`)
      })
    }
  } else {
    lines.push(`# ${m.title} 纪要`, '', `- 时间：${when}`, `- 地点：${where}`)
    for (const g of groups) {
      lines.push('', `## ${g.title}`, '')
      g.items.forEach((n, i) => {
        if (n.type === 'decision') lines.push(`${i + 1}. ${n.text}`)
        else if (n.type === 'todo') {
          const tail = todoTail(n)
          lines.push(`- [${n.done ? 'x' : ' '}] ${n.text}${tail ? ' — ' + tail : ''}`)
        } else lines.push(`- ${n.text}`)
      })
    }
  }
  if (groups.length === 0) lines.push('', '（没有记录）')
  return lines.join('\n')
}
