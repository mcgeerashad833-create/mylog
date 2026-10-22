// 从腾讯会议导出的智能纪要（或任何按小标题分段的会议纪要文字）里找出决议、待办、问题和要点。
// 腾讯会议的导出格式会变，这里不依赖固定格式，而是按「小标题里的关键词」判断下面几行是什么。

import type { MeetingNote, NoteType } from '../db'
import { ME, extractDue, type NoteInput } from './meeting'

const SECTION_WORDS: [NoteType, RegExp][] = [
  ['todo', /待办|行动项|行动计划|后续行动|后续跟进|跟进事项|下一步|action/i],
  ['decision', /决议|决策|决定|结论|共识/],
  ['question', /问题|待确认|待讨论|遗留|风险/],
  ['note', /摘要|总结|要点|纪要|章节|概要|讨论|议题|内容|记录/],
]

/** 行首的列表符号、编号、复选框 */
const BULLET = /^\s*(?:[-*•·●○▪◦]|\d{1,2}\s*[.、)）]|[（(]\d{1,2}[)）]|[一二三四五六七八九十]{1,3}\s*、|\[[ xX]?\]|[☐□■✓✔])\s*/

function stripBullets(line: string): string {
  let s = line
  for (let i = 0; i < 3; i++) s = s.replace(BULLET, '')
  return s.trim()
}

/** 标题的修饰：# 号、【】、**、末尾冒号 */
function stripHeading(line: string): string {
  return stripBullets(line.replace(/^#+\s*/, ''))
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^【(.*)】$/, '$1')
    .replace(/[:：]\s*$/, '')
    .trim()
}

function sectionOf(heading: string): NoteType | null {
  for (const [type, re] of SECTION_WORDS) if (re.test(heading)) return type
  return null
}

const SKIP = /^(会议主题|会议时间|会议号|会议密码|参会人|参会人员|与会人|记录人|主持人|时间|地点|发起人)\s*[:：]/

function cleanup(s: string): string {
  return s
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/截止(?:日期|时间)?\s*[:：]?/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，,；;:：、\-—]+|[\s，,；;:：、\-—。]+$/g, '')
    .trim()
}

function parseTodo(text: string, today: string, myName: string): NoteInput {
  let s = text
  let owner: string | null = null
  const patterns = [
    /(?:负责人|责任人|负责|owner)\s*[:：]\s*([^\s，,；;、）)]+)/i,
    /[@＠]([^\s，,；;、）)]+)/,
    /[（(]([\u4e00-\u9fa5]{2,4}|[A-Za-z]{2,12})[)）]/,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (!m) continue
    // 括号里也可能是日期，例如（周五前），交给下面识别
    if (extractDue(m[1], today).due) continue
    owner = m[1]
    s = s.replace(m[0], ' ')
    break
  }
  const { due, rest } = extractDue(s, today)
  if (owner && myName && owner === myName) owner = ME
  return { type: 'todo', text: cleanup(rest), owner, due }
}

export function parseImported(text: string, today: string, myName = ''): NoteInput[] {
  const out: NoteInput[] = []
  let section: NoteType | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || SKIP.test(stripBullets(line))) continue

    // 「待办：给供应商发清单」这样一行里带关键词和内容
    const inline = stripBullets(line).match(/^([^:：]{1,8})[:：]\s*(.+)$/)
    if (inline) {
      const type = sectionOf(inline[1])
      if (type && type !== 'note') {
        out.push(type === 'todo' ? parseTodo(inline[2], today, myName) : { type, text: cleanup(inline[2]), owner: null, due: null })
        continue
      }
    }

    // 小标题：短、带关键词，或者有 #、【】、冒号这些标题样子
    const heading = stripHeading(line)
    // 「- 风险可控」这种带圆点的是条目，不当标题
    const looksLikeHeading = /^#|^【.*】$|^\*\*.*\*\*$|[:：]$/.test(line) || (heading.length <= 8 && !/^[-*•·●○▪◦]/.test(line))
    if (looksLikeHeading && heading.length <= 16) {
      const type = sectionOf(heading)
      if (type) {
        section = type
        continue
      }
    }
    // 明显是标题（# 、【】、加粗）但不认识：后面的内容不知道是什么，先不收
    if (/^#|^【.*】$|^\*\*.*\*\*$/.test(line)) {
      section = null
      continue
    }

    if (!section) continue
    const item = stripBullets(line)
    if (!item) continue
    if (section === 'todo') out.push(parseTodo(item, today, myName))
    else out.push({ type: section, text: cleanup(item), owner: null, due: null })
  }
  return out.filter((n) => n.text.length > 0)
}

const norm = (s: string) => s.replace(/[\s，,。.；;：:！!？?、（）()「」“”"'-]/g, '').toLowerCase()

/** 和已有记录说的是不是同一件事 */
export function isDuplicate(text: string, notes: MeetingNote[]): boolean {
  const a = norm(text)
  if (!a) return true
  return notes.some((n) => {
    const b = norm(n.text)
    if (!b) return false
    if (a === b) return true
    const [short, long] = a.length < b.length ? [a, b] : [b, a]
    return short.length >= 4 && long.includes(short)
  })
}
