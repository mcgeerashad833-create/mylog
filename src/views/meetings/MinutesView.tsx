import { useState } from 'react'
import type { Meeting, MeetingNote, NoteType, Task } from '../../db'
import { longLabel, relativeLabel } from '../../lib/date'
import { KIND_LABEL, NOTE_LABEL, isMine, isOthers, parseNoteInput, timeRange, whereLabel } from '../../lib/meeting'
import { addNote, removeNote, restoreNote, saveMinutes, updateNote } from '../../meetings'
import { CheckIcon, CloseIcon } from '../../components/Icons'
import { BackLink, type MeetingProps } from './shared'

const SECTIONS: { type: NoteType; title: string; add: string }[] = [
  { type: 'decision', title: '决议', add: '添加决议' },
  { type: 'todo', title: '待办', add: '添加待办，例如：改首页文案 @张伟 周三前' },
  { type: 'note', title: '要点', add: '添加要点' },
  { type: 'question', title: '遗留问题', add: '添加问题' },
]

/** 我负责的待办在 MyLog 里的去向 */
function whereTask(n: MeetingNote, task: Task | undefined, today: string): string {
  if (!isMine(n)) return isOthers(n) ? '我跟进' : ''
  if (!task) return '保存后加入 MyLog'
  if (task.done) return '已完成'
  if (task.date === null) return '在「收集箱」'
  return task.date <= today ? '在「今天」' : `在「以后 · ${relativeLabel(task.date, today)}」`
}

export function MinutesView({ m, ...p }: MeetingProps & { m: Meeting }) {
  const [saving, setSaving] = useState(false)
  const taskOf = (n: MeetingNote) => (n.taskId ? p.tasks.find((t) => t.id === n.taskId) : undefined)
  const noOwner = m.notes.filter((n) => n.type === 'todo' && !n.owner).length
  const unsynced = m.notes.some((n) =>
    isMine(n) ? !n.taskId || n.due !== n.syncedDue || taskOf(n)?.title !== n.text : !!n.taskId,
  )
  const lastAt = m.notes.reduce((max, n) => Math.max(max, n.at), 0)

  async function save() {
    setSaving(true)
    const r = await saveMinutes(m.id, p.today)
    setSaving(false)
    const mine = r.today + r.later + r.inbox
    const parts = [
      r.today && `今天 ${r.today}`,
      r.later && `以后 ${r.later}`,
      r.inbox && `收集箱 ${r.inbox}`,
    ].filter(Boolean)
    p.onNotice(
      `纪要已保存。` +
        (mine ? `我负责的 ${mine} 条 → ${parts.join('、')}` : '') +
        (r.others ? `${mine ? '；' : ''}别人负责的 ${r.others} 条在「我跟进的」` : ''),
    )
  }

  return (
    <div className="column wide">
      <div className="split">
        <article className="split-main">
          <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <BackLink label="会议详情" onClick={() => p.go({ page: 'detail', id: m.id })} />
            <span className="ok-line">
              <CheckIcon size={14} />
              已根据会中 {m.notes.length} 条记录自动整理，可以直接修改
            </span>
            <h1 className="page-title">{m.title} · 纪要</h1>
            <dl className="meta-list">
              <dt>时间</dt>
              <dd>
                {longLabel(m.date)} {timeRange(m)}
              </dd>
              <dt>地点</dt>
              <dd>{whereLabel(m) || KIND_LABEL[m.kind]}</dd>
            </dl>
          </header>

          {SECTIONS.map((s, i) => {
            const items = m.notes.filter((n) => n.type === s.type)
            return (
              <section key={s.type} className="minutes-section" aria-label={s.title}>
                <h2 className="section-title">
                  {['一', '二', '三', '四'][i]}、{s.title}
                  {items.length > 0 && <span className="tiny"> {items.length}</span>}
                </h2>
                {items.map((n) => (
                  <NoteEditor key={n.id} n={n} m={m} where={whereTask(n, taskOf(n), p.today)} onNotice={p.onNotice} />
                ))}
                <AddNote
                  label={s.add}
                  onAdd={(text) => void addNote(m.id, parseNoteInput(text, s.type, p.today), lastAt)}
                  type={s.type}
                />
              </section>
            )
          })}
        </article>

        <aside className="split-side">
          <section className="card">
            <h2>{m.summarizedAt ? (unsynced ? '有改动还没同步' : '纪要已保存') : '整理好了吗？'}</h2>
            <span className="tiny" style={{ lineHeight: '20px' }}>
              {m.summarizedAt && !unsynced
                ? '我负责的待办已经在 MyLog 里，别人负责的在「会议待办 · 我跟进的」。'
                : '保存后，我负责的待办会加入「今天 / 以后」（没写截止日期的进收集箱），别人负责的进入「我跟进的」。'}
            </span>
            {noOwner > 0 && <span className="warn-text">有 {noOwner} 条待办没写负责人，不会同步。</span>}
            <button className="btn primary tall" disabled={saving} onClick={() => void save()}>
              {m.summarizedAt ? '再次保存' : '保存纪要'}
            </button>
            <button className="btn" onClick={() => p.go({ page: 'live', id: m.id })}>
              补充记录
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}

function NoteEditor({
  n,
  m,
  where,
  onNotice,
}: {
  n: MeetingNote
  m: Meeting
  where: string
  onNotice: (text: string, undo?: () => void) => void
}) {
  const save = (patch: Partial<MeetingNote>) => void updateNote(m.id, n.id, patch)
  return (
    <div className="edit-row">
      <label htmlFor={'nt-' + n.id} className="sr-only">
        内容
      </label>
      <input
        id={'nt-' + n.id}
        className="edit-text"
        defaultValue={n.text}
        key={n.text}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v && v !== n.text) save({ text: v })
          else e.target.value = n.text
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {n.type === 'todo' && (
        <>
          <label htmlFor={'no-' + n.id} className="sr-only">
            负责人
          </label>
          <input
            id={'no-' + n.id}
            className={'edit-owner' + (!n.owner ? ' warn' : '')}
            defaultValue={n.owner ?? ''}
            key={'o' + n.owner}
            placeholder="负责人"
            onBlur={(e) => {
              const v = e.target.value.trim().replace(/^[@＠]/, '') || null
              if (v !== n.owner) save({ owner: v, done: false })
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <label htmlFor={'nd-' + n.id} className="sr-only">
            截止日期
          </label>
          <input
            id={'nd-' + n.id}
            className="edit-due"
            type="date"
            value={n.due ?? ''}
            onChange={(e) => save({ due: e.target.value || null })}
          />
          <span className="edit-where tiny">{where}</span>
        </>
      )}
      {n.type !== 'todo' && (
        <>
          <label htmlFor={'ty-' + n.id} className="sr-only">
            类型
          </label>
          <select
            id={'ty-' + n.id}
            className="edit-type"
            value={n.type}
            onChange={(e) => {
              const type = e.target.value as NoteType
              save(type === 'todo' ? { type, owner: '我' } : { type })
            }}
          >
            {(Object.keys(NOTE_LABEL) as NoteType[]).map((t) => (
              <option key={t} value={t}>
                {NOTE_LABEL[t]}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        className="icon-btn small"
        aria-label={`删除：${n.text}`}
        onClick={() => {
          void removeNote(m.id, n.id)
          onNotice('已删除一条记录', () => void restoreNote(m.id, n))
        }}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

function AddNote({ label, onAdd, type }: { label: string; onAdd: (text: string) => void; type: NoteType }) {
  const [v, setV] = useState('')
  return (
    <div className="add-row">
      <label htmlFor={'add-' + type} className="sr-only">
        {label}
      </label>
      <input
        id={'add-' + type}
        value={v}
        placeholder={'+ ' + label}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && v.trim()) {
            onAdd(v)
            setV('')
          }
        }}
      />
    </div>
  )
}
