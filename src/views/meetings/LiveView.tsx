import { useEffect, useRef, useState } from 'react'
import type { Meeting, MeetingNote, NoteType } from '../../db'
import { relativeLabel } from '../../lib/date'
import { ME, NOTE_LABEL, clock, isMine, isOthers, parseNoteInput } from '../../lib/meeting'
import { addNote, endRecording, removeNote, restoreNote, startRecording } from '../../meetings'
import { CloseIcon, VideoIcon } from '../../components/Icons'
import { BackLink, type MeetingProps } from './shared'
import { CarryOverList, PrepList } from './parts'

const TYPES: NoteType[] = ['note', 'decision', 'todo', 'question']

const PLACEHOLDER: Record<NoteType, string> = {
  note: '记一笔…',
  decision: '这件事定了什么？',
  todo: '要做什么 @负责人 截止时间，例如：改首页文案 @张伟 周三前（不写 @ 就是我）',
  question: '还没解决的问题…',
}

export function NoteMeta({ n, today }: { n: MeetingNote; today: string }) {
  if (n.type !== 'todo') return null
  const who = !n.owner ? '未指定负责人' : n.owner === ME ? '我负责' : '@' + n.owner
  return (
    <span className={'note-meta' + (!n.owner ? ' warn' : '')}>
      {who}
      {n.due && ' · ' + relativeLabel(n.due, today)}
    </span>
  )
}

export function LiveView({ m, ...p }: MeetingProps & { m: Meeting }) {
  const [type, setType] = useState<NoteType>('note')
  const [draft, setDraft] = useState('')
  const [tick, setTick] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const listEnd = useRef<HTMLDivElement>(null)
  const count = useRef(m.notes.length)

  // 进入页面就算开始记录
  useEffect(() => {
    void startRecording(m)
    inputRef.current?.focus()
    // 只在进入时执行一次
  }, [m.id])

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (m.notes.length > count.current) listEnd.current?.scrollIntoView({ block: 'nearest' })
    count.current = m.notes.length
  }, [m.notes.length])

  const startedMs = m.startedAt ? new Date(m.startedAt).getTime() : tick
  const elapsed = (tick - startedMs) / 1000

  function submit() {
    if (!draft.trim()) return
    const input = parseNoteInput(draft, type, p.today)
    if (!input.text) return
    setDraft('')
    void addNote(m.id, input, Math.max(0, Math.round((Date.now() - startedMs) / 1000)))
  }

  const stats = [
    { label: '决议', n: m.notes.filter((n) => n.type === 'decision').length },
    { label: '我的待办', n: m.notes.filter(isMine).length },
    { label: '别人的待办', n: m.notes.filter(isOthers).length },
    { label: '问题', n: m.notes.filter((n) => n.type === 'question').length },
  ]

  return (
    <div className="column wide">
      <header className="live-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <BackLink label="会议详情" onClick={() => p.go({ page: 'detail', id: m.id })} />
          <h1 className="live-title">{m.title}</h1>
          <span className="badge rec">
            <span className="dot" />
            记录中
          </span>
          <span className="subtle tabular" style={{ fontSize: 13 }}>
            已开 {clock(elapsed)}
          </span>
        </div>
        <div className="btn-row">
          {m.kind !== 'offline' && m.link && (
            <a className="btn" href={m.link} target="_blank" rel="noreferrer">
              <VideoIcon size={16} />
              回到腾讯会议
            </a>
          )}
          <button
            className="btn primary"
            onClick={() => {
              void endRecording(m.id)
              p.go({ page: 'minutes', id: m.id })
            }}
          >
            结束会议 · 整理纪要
          </button>
        </div>
      </header>

      <div className="split">
        <div className="split-main" style={{ gap: 16 }}>
          {m.notes.length === 0 ? (
            <div className="empty" style={{ padding: '32px 0' }}>
              <strong>随手记下会上说的事</strong>
              <span style={{ fontSize: 13 }}>结论标「决议」，领到的活标「待办」，会后自动整理成纪要。</span>
            </div>
          ) : (
            <ol className="notes">
              {m.notes.map((n) => (
                <li key={n.id} className="note-row">
                  <span className="note-at tabular">{clock(n.at)}</span>
                  <span className={'tag tag-' + n.type}>{NOTE_LABEL[n.type]}</span>
                  <span className="note-text">
                    <span>{n.text}</span>
                    <NoteMeta n={n} today={p.today} />
                  </span>
                  <button
                    className="icon-btn small"
                    aria-label={`删除：${n.text}`}
                    onClick={() => {
                      void removeNote(m.id, n.id)
                      p.onNotice('已删除一条记录', () => void restoreNote(m.id, n))
                    }}
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div ref={listEnd} />

          <div className="composer">
            <div className="choice-row" role="group" aria-label="记录类型">
              {TYPES.map((t) => (
                <button
                  key={t}
                  className={'pill pill-' + t}
                  aria-pressed={type === t}
                  onClick={() => {
                    setType(t)
                    inputRef.current?.focus()
                  }}
                >
                  {NOTE_LABEL[t]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <label htmlFor="note-input" className="sr-only">
                记录内容
              </label>
              <input
                id="note-input"
                ref={inputRef}
                className="text-input"
                value={draft}
                placeholder={PLACEHOLDER[type]}
                autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
                }}
              />
              <button className="btn primary tall" onClick={submit}>
                记下
              </button>
            </div>
            <span className="tiny">
              回车记下。也可以用「决：」「待：」「问：」开头；待办里写 @某人 和「周五前」会自动识别负责人和截止日期。
            </span>
          </div>
        </div>

        <aside className="split-side">
          {m.prep.length > 0 && <PrepList m={m} compact />}
          <CarryOverList m={m} compact {...p} />
          <section className="card">
            <h2>本场已记</h2>
            <div className="stat-grid">
              {stats.map((s) => (
                <div key={s.label} className="stat">
                  <strong>{s.n}</strong>
                  <span className="tiny">{s.label}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
