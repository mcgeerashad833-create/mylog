import type { Day, Task } from '../db'

export interface SearchResult {
  /** 还没做完的：今天、遗留、收集箱、以后 */
  open: Task[]
  /** 做完的，最近完成的在前 */
  done: Task[]
  /** 写过的一句话，最近的在前 */
  days: Day[]
}

/** 拆成关键词；#开头的只匹配标签 */
export function parseQuery(q: string): { words: string[]; tags: string[] } {
  const parts = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return {
    words: parts.filter((p) => !/^[#＃]/.test(p)),
    tags: parts.filter((p) => /^[#＃]./.test(p)).map((p) => p.slice(1)),
  }
}

function taskText(t: Task): string {
  return [t.title, t.note, t.tag ?? '', ...t.subtasks.map((s) => s.title)].join('\n').toLowerCase()
}

/** 所有关键词都要出现（不分大小写），标签要完全一致 */
export function search(tasks: Task[], days: Day[], q: string): SearchResult {
  const { words, tags } = parseQuery(q)
  if (!words.length && !tags.length) return { open: [], done: [], days: [] }

  const hits = tasks.filter((t) => {
    if (t.deletedAt) return false
    if (tags.length && !tags.every((tag) => (t.tag ?? '').toLowerCase() === tag)) return false
    const text = taskText(t)
    return words.every((w) => text.includes(w))
  })

  const open = hits
    .filter((t) => !t.done)
    // 收集箱放最后，其余按日期
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.order - b.order)
  const done = hits.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))

  const dayHits = tags.length
    ? []
    : days.filter((d) => d.note && words.every((w) => d.note.toLowerCase().includes(w))).sort((a, b) => b.date.localeCompare(a.date))

  return { open, done, days: dayHits }
}

/** 把文字切成普通段和命中段，用于高亮 */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  const { words } = parseQuery(q)
  if (!words.length || !text) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const marks = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) marks.fill(true, i, i + w.length)
  }
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === marks[i]) last.text += text[i]
    else out.push({ text: text[i], hit: marks[i] })
  }
  return out
}

/** 命中在备注或子步骤里时，截一小段上下文给用户看 */
export function snippet(t: Task, q: string): string | null {
  const { words } = parseQuery(q)
  if (!words.length || words.every((w) => t.title.toLowerCase().includes(w))) return null
  const sources = [t.note, ...t.subtasks.map((s) => s.title)]
  for (const src of sources) {
    const i = words.map((w) => src.toLowerCase().indexOf(w)).find((x) => x >= 0)
    if (i === undefined) continue
    const start = Math.max(0, i - 12)
    const line = src.slice(start, start + 48).replace(/\s+/g, ' ')
    return (start > 0 ? '…' : '') + line + (start + 48 < src.length ? '…' : '')
  }
  return null
}
