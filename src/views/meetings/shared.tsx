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
    onNotice('复制失败，请手动复制')
  }
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
