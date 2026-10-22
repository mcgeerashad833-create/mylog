import { useState } from 'react'
import type { Meeting } from '../../db'
import { addDays, diffDays, fromKey, longLabel, relativeLabel } from '../../lib/date'
import { meetingStatus, startAt, statusLabel, timeRange, whereLabel, joinText, type MeetingStatus } from '../../lib/meeting'
import { updateMeeting } from '../../meetings'
import { CopyIcon, PlusIcon, VideoIcon } from '../../components/Icons'
import { KindBadge, copyText, type MeetingProps } from './shared'

type Range = 'today' | 'week' | 'all'

const STATUS_CLASS: Record<MeetingStatus, string> = {
  upcoming: 'st-upcoming',
  ongoing: 'st-live',
  recording: 'st-live',
  pending: 'st-pending',
  ended: 'st-ended',
  done: 'st-done',
}

const byStart = (a: Meeting, b: Meeting) => startAt(a).getTime() - startAt(b).getTime()

export function ListView(p: MeetingProps & { onOpenActions: () => void }) {
  const [range, setRange] = useState<Range>('today')
  const todays = p.meetings.filter((m) => m.date === p.today).sort(byStart)

  // 本周按周一到周日算
  const monday = addDays(p.today, -((fromKey(p.today).getDay() + 6) % 7))
  const inRange = (m: Meeting) =>
    range === 'today' ? m.date === p.today : range === 'week' ? m.date >= monday && m.date <= addDays(monday, 6) : true
  const listed = p.meetings.filter(inRange).sort(byStart)
  if (range === 'all') listed.reverse()
  const groups: { date: string; items: Meeting[] }[] = []
  for (const m of listed) {
    const last = groups[groups.length - 1]
    if (last && last.date === m.date) last.items.push(m)
    else groups.push({ date: m.date, items: [m] })
  }
  if (range === 'all') groups.forEach((g) => g.items.reverse())

  const next = todays.find((m) => ['upcoming', 'ongoing', 'recording'].includes(meetingStatus(m, p.now)))
  const pending = p.meetings
    .filter((m) => meetingStatus(m, p.now) === 'pending' && diffDays(p.today, m.date) <= 14)
    .sort((a, b) => byStart(b, a))
  const myTodos = p.tasks
    .filter((t) => t.meetingId && !t.done)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  const meetingTitle = (id: string | null | undefined) => p.meetings.find((m) => m.id === id)?.title ?? '已删除的会议'

  return (
    <div className="column wide">
      <div className="split">
        <div className="split-main">
          <header className="header">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1>会议</h1>
              <span className="subtle">
                {longLabel(p.today)} · 今天 {todays.length} 场
              </span>
            </div>
            <button className="btn primary tall" onClick={() => p.go({ page: 'new' })}>
              <PlusIcon size={16} />
              新建会议
            </button>
          </header>
          <span className="tiny" style={{ marginTop: -12 }}>
            收到腾讯会议邀请？在任意页面按 Ctrl K，把邀请整段粘贴进来就能识别。
          </span>

          {next && <NextCard m={next} {...p} />}

          <div className="segmented" role="group" aria-label="范围">
            {(
              [
                ['today', '今天'],
                ['week', '本周'],
                ['all', '全部'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={range === id} onClick={() => setRange(id)}>
                {label}
              </button>
            ))}
          </div>

          {groups.length === 0 && (
            <div className="empty">
              <strong>{range === 'today' ? '今天没有会议' : '这段时间没有会议'}</strong>
              <span style={{ fontSize: 13 }}>点「新建会议」，或者把腾讯会议邀请粘贴进来。</span>
            </div>
          )}

          {groups.map((g) => (
            <section key={g.date} aria-label={longLabel(g.date)}>
              <h2 className="group-title">
                {relativeLabel(g.date, p.today)}
                <span className="tiny" style={{ fontWeight: 400, fontSize: 13 }}>
                  {longLabel(g.date)}
                </span>
              </h2>
              <div className="list">
                {g.items.map((m) => {
                  const st = meetingStatus(m, p.now)
                  return (
                    <button key={m.id} className={'meeting-row' + (st === 'done' || st === 'ended' ? ' faded' : '')} onClick={() => p.go({ page: 'detail', id: m.id })}>
                      <span className="meeting-time">{timeRange(m)}</span>
                      <span className="meeting-body">
                        <span className="meeting-title">
                          {m.title}
                          <KindBadge kind={m.kind} />
                        </span>
                        <span className="tiny">{whereLabel(m)}</span>
                      </span>
                      <span className={'meeting-status ' + STATUS_CLASS[st]}>{statusLabel(m, p.now)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="split-side">
          {pending.length > 0 && (
            <section className="card">
              <h2>待整理纪要 · {pending.length}</h2>
              {pending.slice(0, 5).map((m) => (
                <div key={m.id} className="card-item">
                  <span>{m.title}</span>
                  <span className="tiny">
                    {relativeLabel(m.date, p.today)} {m.start} · 记了 {m.notes.length} 条
                  </span>
                  <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button className="btn small" onClick={() => p.go({ page: 'minutes', id: m.id })}>
                      整理纪要
                    </button>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        void updateMeeting(m.id, { summarizedAt: new Date().toISOString() })
                        p.onNotice(`「${m.title}」不用整理了`, () => void updateMeeting(m.id, { summarizedAt: null }))
                      }}
                    >
                      不用整理
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>我负责的会议待办</h2>
              <button className="link-btn" onClick={p.onOpenActions}>
                全部
              </button>
            </div>
            {myTodos.length === 0 && <span className="tiny">没有未完成的会议待办。</span>}
            {myTodos.slice(0, 4).map((t) => (
              <div key={t.id} className="card-item">
                <span>{t.title}</span>
                <span className={'tiny' + (t.date && t.date < p.today ? ' late' : '')}>
                  {t.date ? (t.date < p.today ? relativeLabel(t.date, p.today) + '遗留' : relativeLabel(t.date, p.today)) : '收集箱'} · 来自{' '}
                  {meetingTitle(t.meetingId)}
                </span>
              </div>
            ))}
            {myTodos.length > 0 && <span className="tiny">这些待办也在「今天 / 以后 / 收集箱」里。</span>}
          </section>
        </aside>
      </div>
    </div>
  )
}

function NextCard({ m, ...p }: MeetingProps & { m: Meeting }) {
  const st = meetingStatus(m, p.now)
  const label = st === 'upcoming' ? '下一场 · ' + statusLabel(m, p.now) : st === 'recording' ? '正在记录' : '正在进行'
  return (
    <section className="next-card" aria-label="下一场会议">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <strong style={{ color: 'var(--accent-strong)' }}>{label}</strong>
        <KindBadge kind={m.kind} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 600 }}>{m.title}</span>
        <span className="subtle">
          {timeRange(m)} · {whereLabel(m)}
        </span>
      </div>
      <div className="btn-row">
        {m.kind !== 'offline' && m.link && (
          <a className="btn primary tall" href={m.link} target="_blank" rel="noreferrer">
            <VideoIcon size={16} />
            腾讯会议入会
          </a>
        )}
        {m.kind !== 'offline' && m.meetingNo && (
          <button className="btn tall" onClick={() => void copyText(joinText(m), p.onNotice, '已复制会议号和密码')}>
            <CopyIcon size={16} />
            复制会议号
          </button>
        )}
        <button className="btn tall" onClick={() => p.go({ page: 'live', id: m.id })}>
          {m.startedAt ? '继续记录' : '开始记录'}
        </button>
        <button className="btn tall ghost" onClick={() => p.go({ page: 'detail', id: m.id })}>
          详情
        </button>
      </div>
    </section>
  )
}
