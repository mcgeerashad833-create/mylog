import { useState } from 'react'
import type { Meeting, MeetingNote, Task } from '../../db'
import { diffDays, longLabel, relativeLabel } from '../../lib/date'
import { followMessage, isOthers, startAt } from '../../lib/meeting'
import { updateNote } from '../../meetings'
import { TaskRow } from '../../components/TaskRow'
import { CheckIcon } from '../../components/Icons'
import { copyText, type MeetingProps } from './shared'

type Tab = 'mine' | 'follow' | 'done'

interface Group {
  meeting: Meeting | undefined
  key: string
  tasks: Task[]
  notes: MeetingNote[]
}

export function ActionsView(p: MeetingProps) {
  const [tab, setTab] = useState<Tab>('mine')
  const meetingById = new Map(p.meetings.map((m) => [m.id, m]))

  const mineAll = p.tasks.filter((t) => t.meetingId)
  // 和我负责的一样，保存纪要之后才算数
  const othersAll = p.meetings
    .filter((m) => m.summarizedAt)
    .flatMap((m) => m.notes.filter((n) => isOthers(n) && n.text).map((n) => ({ m, n })))
  const counts: Record<Tab, number> = {
    mine: mineAll.filter((t) => !t.done).length,
    follow: othersAll.filter(({ n }) => !n.done).length,
    done: mineAll.filter((t) => t.done).length + othersAll.filter(({ n }) => n.done).length,
  }

  // 按会议分组，最近的会在前
  const groups = new Map<string, Group>()
  const group = (id: string) => {
    if (!groups.has(id)) groups.set(id, { meeting: meetingById.get(id), key: id, tasks: [], notes: [] })
    return groups.get(id)!
  }
  for (const t of mineAll) if (tab === 'done' ? t.done : tab === 'mine' && !t.done) group(t.meetingId!).tasks.push(t)
  for (const { m, n } of othersAll) if (tab === 'done' ? n.done : tab === 'follow' && !n.done) group(m.id).notes.push(n)
  const list = [...groups.values()].sort((a, b) => {
    if (!a.meeting || !b.meeting) return a.meeting ? -1 : 1
    return startAt(b.meeting).getTime() - startAt(a.meeting).getTime()
  })

  const tabs: [Tab, string][] = [
    ['mine', '我负责的'],
    ['follow', '我跟进的'],
    ['done', '已完成'],
  ]

  return (
    <div className="column">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 className="page-title">会议待办</h1>
        <span className="subtle">会上领的活都在这里。我负责的也在「今天 / 以后」里，两边勾掉都算完成。</span>
      </header>

      <div className="tabs" role="tablist" aria-label="待办范围">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label} <span className="tiny">{counts[id]}</span>
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <div className="empty">
          <strong>
            {tab === 'mine' ? '没有要做的会议待办' : tab === 'follow' ? '没有需要跟进的事' : '还没有完成的会议待办'}
          </strong>
          {tab !== 'done' && <span style={{ fontSize: 13 }}>会上记待办时写 @某人，保存纪要后就会出现在这里。</span>}
        </div>
      )}

      {list.map((g) => (
        <section key={g.key} aria-label={g.meeting?.title ?? '已删除的会议'}>
          <h2 className="group-title">
            {g.meeting ? (
              <button className="text-link" onClick={() => p.go({ page: 'minutes', id: g.meeting!.id })}>
                {g.meeting.title}
              </button>
            ) : (
              '已删除的会议'
            )}
            {g.meeting && (
              <span className="tiny" style={{ fontWeight: 400, fontSize: 13 }}>
                {longLabel(g.meeting.date)}
              </span>
            )}
          </h2>
          <div className="list">
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={p.today}
                showDate
                selected={t.id === p.selectedId}
                onToggle={p.onToggle}
                onOpen={p.onOpen}
              />
            ))}
            {g.notes.map((n) => (
              <FollowRow key={n.id} n={n} m={g.meeting!} {...p} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function FollowRow({ n, m, today, onNotice }: MeetingProps & { n: MeetingNote; m: Meeting }) {
  const late = !n.done && n.due !== null && n.due < today
  return (
    <div className={'row' + (n.done ? ' done' : '')}>
      <span style={{ width: 20, flex: 'none' }} />
      <button
        className={'check' + (n.done ? ' on' : '')}
        aria-label={(n.done ? '取消完成：' : '确认已完成：') + n.text}
        aria-pressed={n.done}
        onClick={() => {
          void updateNote(m.id, n.id, { done: !n.done })
          if (!n.done) onNotice(`已确认「${n.text}」完成`, () => void updateNote(m.id, n.id, { done: false }))
        }}
      >
        <span>{n.done && <CheckIcon size={12} color="#fff" />}</span>
      </button>
      <div className="row-body" style={{ cursor: 'default' }}>
        <span className="row-title">{n.text}</span>
        <span className="meta">
          <span>{n.owner} 负责</span>
          {n.due && <span className={late ? 'late' : ''}>{late ? `逾期 ${diffDays(today, n.due)} 天` : relativeLabel(n.due, today) + '截止'}</span>}
        </span>
      </div>
      {!n.done && (
        <div className="row-actions">
          <button className="btn small" onClick={() => void copyText(followMessage(n, m, today), onNotice, '已复制催问消息，可以直接粘贴到微信')}>
            催一下
          </button>
        </div>
      )}
    </div>
  )
}
