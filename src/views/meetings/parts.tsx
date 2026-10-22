import { useState } from 'react'
import type { Meeting, Task } from '../../db'
import { diffDays, relativeLabel } from '../../lib/date'
import { carryOver } from '../../lib/series'
import { addPrep, removePrep, togglePrep, updateNote } from '../../meetings'
import { CheckIcon, CloseIcon } from '../../components/Icons'
import type { MeetingProps } from './shared'

function dueText(date: string | null, today: string): { text: string; late: boolean } {
  if (!date) return { text: '', late: false }
  if (date < today) return { text: `逾期 ${diffDays(today, date)} 天`, late: true }
  return { text: relativeLabel(date, today) + '截止', late: false }
}

function Check({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className={'check small' + (on ? ' on' : '')} aria-label={label} aria-pressed={on} onClick={onClick}>
      <span>{on && <CheckIcon size={10} color="#fff" />}</span>
    </button>
  )
}

/** 例会里之前几次留下、还没完成的待办 */
export function CarryOverList({ m, compact, ...p }: MeetingProps & { m: Meeting; compact?: boolean }) {
  const { mine, others } = carryOver(m, p.meetings, p.tasks)
  if (!m.seriesId) return null
  const from = (t: Task) => p.meetings.find((x) => x.id === t.meetingId)
  return (
    <section className={compact ? 'side-block' : 'card'}>
      <h2>上次留下的待办{mine.length + others.length > 0 && ` · ${mine.length + others.length}`}</h2>
      {mine.length + others.length === 0 && <span className="tiny">之前几次的待办都完成了。</span>}
      {mine.map((t) => {
        const due = dueText(t.date, p.today)
        return (
          <div key={t.id} className="mini-row">
            <Check on={false} label={'完成：' + t.title} onClick={() => p.onToggle(t)} />
            <span className="mini-body">
              <span>{t.title}</span>
              <span className={'tiny' + (due.late ? ' late' : '')}>
                我负责{due.text && ' · ' + due.text}
                {!compact && from(t) && ` · ${relativeLabel(from(t)!.date, p.today)}的会`}
              </span>
            </span>
          </div>
        )
      })}
      {others.map(({ meeting, note }) => {
        const due = dueText(note.due, p.today)
        return (
          <div key={note.id} className="mini-row">
            <Check
              on={false}
              label={'确认已完成：' + note.text}
              onClick={() => {
                void updateNote(meeting.id, note.id, { done: true })
                p.onNotice(`已确认「${note.text}」完成`, () => void updateNote(meeting.id, note.id, { done: false }))
              }}
            />
            <span className="mini-body">
              <span>{note.text}</span>
              <span className={'tiny' + (due.late ? ' late' : '')}>
                {note.owner}负责{due.text && ' · ' + due.text} · 会上问一下
              </span>
            </span>
          </div>
        )
      })}
    </section>
  )
}

/** 会前备注：想问的问题、要带的东西；会上说到了就勾掉 */
export function PrepList({ m, compact }: { m: Meeting; compact?: boolean }) {
  const [draft, setDraft] = useState('')
  return (
    <section className={compact ? 'side-block' : 'card'}>
      <h2>{compact ? '我的会前备注' : '会前备注'}</h2>
      {!compact && <span className="tiny">想问的问题、要带的东西。开会时会显示在记录页旁边，说到了就勾掉。</span>}
      {m.prep.map((item) => (
        <div key={item.id} className={'mini-row' + (item.done ? ' done' : '')}>
          <Check
            on={item.done}
            label={(item.done ? '取消勾选：' : '勾掉：') + item.text}
            onClick={() => void togglePrep(m.id, item.id)}
          />
          <span className="mini-body">
            <span className="mini-text">{item.text}</span>
          </span>
          <button
            className="icon-btn small"
            aria-label={'删除备注：' + item.text}
            onClick={() => void removePrep(m.id, item.id)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
      <div className="add-row">
        <label htmlFor={'prep-' + m.id} className="sr-only">
          添加会前备注
        </label>
        <input
          id={'prep-' + m.id}
          value={draft}
          placeholder="+ 添加一条，回车保存"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) {
              void addPrep(m.id, draft.trim())
              setDraft('')
            }
          }}
        />
      </div>
    </section>
  )
}
