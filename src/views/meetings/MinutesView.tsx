import { useState } from 'react'
import type { Meeting, MeetingNote, NoteType, Task } from '../../db'
import { longLabel, relativeLabel } from '../../lib/date'
import {
  KIND_LABEL,
  NOTE_LABEL,
  isMine,
  isOthers,
  parseNoteInput,
  timeRange,
  whereLabel,
  type NoteInput,
} from '../../lib/meeting'
import { isDuplicate, parseImported } from '../../lib/importMinutes'
import { minutesText, todoTail } from '../../lib/minutes'
import { addNote, importNotes, removeNote, restoreNote, saveMinutes, updateNote } from '../../meetings'
import { CheckIcon, CloseIcon, CopyIcon } from '../../components/Icons'
import { BackLink, copyText, type MeetingProps } from './shared'
import { NoteMeta } from './LiveView'

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
  const [importing, setImporting] = useState(false)
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
    const parts = [r.today && `今天 ${r.today}`, r.later && `以后 ${r.later}`, r.inbox && `收集箱 ${r.inbox}`].filter(
      Boolean,
    )
    p.onNotice(
      `纪要已保存。` +
        (mine ? `我负责的 ${mine} 条 → ${parts.join('、')}` : '') +
        (r.others ? `${mine ? '；' : ''}别人负责的 ${r.others} 条在「我跟进的」` : ''),
    )
  }

  return (
    <div className="column wide">
      <PrintDoc m={m} />
      <div className="split screen-only">
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

          {importing && (
            <ImportPanel m={m} at={lastAt} today={p.today} onDone={() => setImporting(false)} onNotice={p.onNotice} />
          )}

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
          <section className="panel">
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

          <section className="panel">
            <h2>补充腾讯会议的内容</h2>
            <span className="tiny" style={{ lineHeight: '20px' }}>
              粘贴腾讯会议导出的智能纪要文字，自动找出你漏记的决议和待办，确认后合并。
            </span>
            <button className="btn" onClick={() => setImporting(true)} disabled={importing}>
              粘贴智能纪要
            </button>
          </section>

          <section className="panel">
            <h2>复制 / 导出</h2>
            <span className="tiny">需要转给别人时用。</span>
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => void copyText(minutesText(m, 'text'), p.onNotice, '已复制，可以直接粘贴到微信')}
              >
                <CopyIcon size={14} />
                复制文本
              </button>
              <button
                className="btn"
                onClick={() => void copyText(minutesText(m, 'markdown'), p.onNotice, '已复制 Markdown')}
              >
                复制 Markdown
              </button>
              <button className="btn" onClick={() => window.print()}>
                导出 PDF
              </button>
            </div>
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

/** 打印 / 导出 PDF 时用的只读纪要 */
function PrintDoc({ m }: { m: Meeting }) {
  return (
    <article className="print-only" aria-hidden="true">
      <h1>{m.title} · 纪要</h1>
      <p>
        时间：{longLabel(m.date)} {timeRange(m)}
        <br />
        地点：{whereLabel(m) || KIND_LABEL[m.kind]}
      </p>
      {SECTIONS.map((s) => {
        const items = m.notes.filter((n) => n.type === s.type && n.text.trim())
        if (items.length === 0) return null
        const List = s.type === 'decision' ? 'ol' : 'ul'
        return (
          <section key={s.type}>
            <h2>{s.title}</h2>
            <List>
              {items.map((n) => (
                <li key={n.id}>
                  {n.text}
                  {n.type === 'todo' && todoTail(n) && `（${todoTail(n)}）`}
                </li>
              ))}
            </List>
          </section>
        )
      })}
    </article>
  )
}

const NAME_KEY = 'mylog.meetingName'

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // 无痕模式等情况下存不了，下次再填一遍就好
  }
}

/** 粘贴腾讯会议智能纪要 → 列出找到的条目 → 勾选后合并 */
function ImportPanel({
  m,
  at,
  today,
  onDone,
  onNotice,
}: {
  m: Meeting
  at: number
  today: string
  onDone: () => void
  onNotice: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [name, setName] = useState(loadName)
  const [found, setFound] = useState<(NoteInput & { dup: boolean; picked: boolean })[] | null>(null)

  const recognize = () => {
    saveName(name.trim())
    const items = parseImported(text, today, name.trim()).map((n) => {
      const dup = isDuplicate(n.text, m.notes)
      // 要点通常很多，默认只勾决议、待办、问题
      return { ...n, dup, picked: !dup && n.type !== 'note' }
    })
    setFound(items)
  }

  const picked = found?.filter((f) => f.picked) ?? []

  return (
    <section className="import-panel" aria-label="导入腾讯会议智能纪要">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title">导入腾讯会议智能纪要</h2>
        <button className="icon-btn small" aria-label="关闭" onClick={onDone}>
          <CloseIcon size={14} />
        </button>
      </div>
      {found === null ? (
        <>
          <label htmlFor="import-text" className="tiny">
            在腾讯会议的「智能纪要」里全选复制，粘贴到这里。
          </label>
          <textarea id="import-text" className="note" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="field-inline">
            <label htmlFor="import-name" className="tiny">
              你在腾讯会议里的名字
            </label>
            <input
              id="import-name"
              className="text-input"
              style={{ width: 160, height: 36 }}
              value={name}
              placeholder="用来认出你的待办"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="btn-row">
            <button className="btn primary" disabled={!text.trim()} onClick={recognize}>
              识别
            </button>
          </div>
        </>
      ) : (
        <>
          {found.length === 0 ? (
            <span className="warn-text">
              没有找到决议、待办或问题。纪要里需要有「待办」「结论」「问题」这样的小标题。
            </span>
          ) : (
            <span className="tiny">找到 {found.length} 条，勾选要合并的。已有的和要点默认不勾。</span>
          )}
          <div className="list">
            {found.map((f, i) => (
              <label key={i} className="import-row">
                <input
                  type="checkbox"
                  checked={f.picked}
                  onChange={() => setFound(found.map((x, j) => (j === i ? { ...x, picked: !x.picked } : x)))}
                />
                <span className={'tag tag-' + f.type}>{NOTE_LABEL[f.type]}</span>
                <span className="note-text">
                  <span>{f.text}</span>
                  <NoteMeta n={{ ...f, id: '', at: 0, done: false, taskId: null, syncedDue: null }} today={today} />
                  {f.dup && <span className="badge">已有</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={picked.length === 0}
              onClick={() => {
                void importNotes(
                  m.id,
                  picked.map(({ type, text, owner, due }) => ({ type, text, owner, due })),
                  at,
                )
                onNotice(`已合并 ${picked.length} 条，记得保存纪要`)
                onDone()
              }}
            >
              合并 {picked.length} 条
            </button>
            <button className="btn" onClick={() => setFound(null)}>
              重新粘贴
            </button>
          </div>
        </>
      )}
    </section>
  )
}
