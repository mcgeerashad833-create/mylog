import type { Meeting, MeetingKind, Task } from '../../db'
import { KIND_LABEL } from '../../lib/meeting'

export type MeetingRoute =
  | { page: 'list' }
  | { page: 'new'; invite?: string }
  | { page: 'detail'; id: string }
  | { page: 'edit'; id: string }
  | { page: 'live'; id: string }
  | { page: 'minutes'; id: string }

export interface MeetingProps {
  /** 没删除的会议 */
  meetings: Meeting[]
  tasks: Task[]
  today: string
  now: Date
  selectedId: string | null
  go: (r: MeetingRoute) => void
  onNotice: (text: string, undo?: () => void) => void
  onToggle: (t: Task) => void
  onOpen: (t: Task) => void
}

export function KindBadge({ kind }: { kind: MeetingKind }) {
  return <span className={'badge kind-' + kind}>{KIND_LABEL[kind]}</span>
}

export async function copyText(text: string, onNotice: (text: string) => void, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    onNotice(done)
  } catch {
    // 通过 http://IP 访问时没有 navigator.clipboard，退回老办法：选中一个隐藏的文本框再复制
    onNotice(legacyCopy(text) ? done : '复制失败，请手动复制')
  }
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
  }
}

/** 让浏览器下载一个文本文件 */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  // 有的浏览器要求链接在页面里，download 文件名才生效；文件名用英文，中文名可能被浏览器丢掉
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="back" onClick={onClick}>
      ‹ {label}
    </button>
  )
}

export function NotFound({ go }: { go: (r: MeetingRoute) => void }) {
  return (
    <div className="column">
      <BackLink label="会议日程" onClick={() => go({ page: 'list' })} />
      <div className="empty">
        <strong>找不到这场会议</strong>
        <span style={{ fontSize: 13 }}>可能已经删除了。</span>
      </div>
    </div>
  )
}
