import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Task } from '../db'
import { addDays, longLabel, nowHM, toKey } from '../lib/date'
import { byOrder, deleteTask, moveTo, saveDay } from '../store'

interface Props {
  tasks: Task[]
  today: string
  /** 从搜索结果跳过来时，直接打开那一天 */
  initialDate?: string
  onOpen: (t: Task) => void
  onNotice: (text: string, undo?: () => void) => void
}

const doneOn = (t: Task) => (t.done && t.doneAt ? toKey(new Date(t.doneAt)) : null)

export function LogView({ tasks, today, initialDate, onOpen, onNotice }: Props) {
  const [date, setDate] = useState(initialDate ?? today)
  const days = useLiveQuery(() => db.days.toArray(), []) ?? []
  const day = days.find((d) => d.date === date)
  const isToday = date === today

  // 过了零点仍停在「昨天」时，跟着切到新的一天
  const lastToday = useRef(today)
  useEffect(() => {
    if (lastToday.current === today) return
    lastToday.current = today
    setDate(today)
  }, [today])

  const done = tasks
    .filter((t) => doneOn(t) === date)
    .sort((a, b) => a.doneAt!.localeCompare(b.doneAt!))
  const leftovers = isToday ? tasks.filter((t) => !t.done && t.date !== null && t.date <= today).sort(byOrder) : []

  const recent = Array.from({ length: 7 }, (_, k) => addDays(today, -k - 1)).map((d) => ({
    date: d,
    count: tasks.filter((t) => doneOn(t) === d).length,
    note: days.find((x) => x.date === d)?.note ?? '',
  }))

  return (
    <div className="column" style={{ maxWidth: 1000 }}>
      <header className="header" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn small" aria-label="前一天" onClick={() => setDate(addDays(date, -1))}>
            ‹
          </button>
          <h1 style={{ margin: '0 8px' }}>{isToday ? '今天' : longLabel(date)}</h1>
          <button className="btn small" aria-label="后一天" disabled={isToday} onClick={() => setDate(addDays(date, 1))}>
            ›
          </button>
        </div>
        <span className="subtle">
          {isToday && longLabel(date) + ' · '}完成 {done.length} 件{isToday && leftovers.length > 0 ? ` · 剩 ${leftovers.length} 件` : ''}
        </span>
      </header>

      <div className="log-grid">
        <section className="timeline-col" aria-label="完成记录">
          <h2 className="group-title">完成记录</h2>
          {done.length > 0 ? (
            <ol className="timeline">
              {done.map((t) => (
                <li key={t.id}>
                  <time dateTime={t.doneAt!}>{nowHM(new Date(t.doneAt!))}</time>
                  <span className="dot" />
                  <button className="row-body" style={{ padding: 0 }} onClick={() => onOpen(t)}>
                    {t.title}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="subtle" style={{ margin: '8px 0' }}>
              这一天没有完成记录。
            </p>
          )}

          {!isToday && day?.note && (
            <>
              <h2 className="group-title" style={{ marginTop: 28 }}>
                那天的一句话
              </h2>
              <p className="quote">{day.note}</p>
            </>
          )}

          <h2 className="group-title" style={{ marginTop: 32 }}>
            最近几天
          </h2>
          <div>
            {recent.map((r) => (
              <button
                key={r.date}
                className="day-link"
                aria-current={r.date === date ? 'date' : undefined}
                onClick={() => setDate(r.date)}
              >
                <span>{longLabel(r.date)}</span>
                <span className="subtle" style={{ fontSize: 13, textAlign: 'right' }}>
                  完成 {r.count} 件{r.note ? ` · “${r.note.length > 16 ? r.note.slice(0, 16) + '…' : r.note}”` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>

        {isToday && <WrapUp key={today} today={today} leftovers={leftovers} closedAt={day?.closedAt ?? null} note={day?.note ?? ''} onNotice={onNotice} />}
      </div>
    </div>
  )
}

function WrapUp({
  today,
  leftovers,
  closedAt,
  note,
  onNotice,
}: {
  today: string
  leftovers: Task[]
  closedAt: string | null
  note: string
  onNotice: Props['onNotice']
}) {
  const [draft, setDraft] = useState(note)
  const tomorrow = addDays(today, 1)

  useEffect(() => setDraft(note), [note])

  if (closedAt) {
    return (
      <section className="wrap-col" aria-label="今天已结束">
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>今天已结束</h2>
        <span className="subtle" style={{ fontSize: 13 }}>
          {nowHM(new Date(closedAt))} 收尾。明天见。
        </span>
        {note && <p className="quote">{note}</p>}
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void saveDay(today, { closedAt: null })}>
          重新打开今天
        </button>
      </section>
    )
  }

  return (
    <section className="wrap-col" aria-label="结束今天">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>结束今天</h2>
        <span className="subtle" style={{ fontSize: 13 }}>
          {leftovers.length > 0 ? `还有 ${leftovers.length} 件没做完，给它们安排个去处。` : '今天的事都处理完了。'}
        </span>
      </div>

      {leftovers.map((t) => (
        <div key={t.id} className="leftover">
          <span>{t.title}</span>
          <div className="row-actions">
            <button className="btn small" onClick={() => void moveTo([t.id], tomorrow)}>
              明天
            </button>
            <label className="btn small" style={{ position: 'relative' }}>
              选日期
              <input
                type="date"
                min={tomorrow}
                aria-label={`给「${t.title}」选日期`}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                onChange={(e) => e.target.value && void moveTo([t.id], e.target.value)}
              />
            </label>
            <button className="btn small" onClick={() => void moveTo([t.id], null)}>
              放回收集箱
            </button>
            <button
              className="btn small ghost"
              onClick={() => {
                void deleteTask(t.id)
                onNotice(`已删除「${t.title}」`)
              }}
            >
              不做了
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="day-note" style={{ fontWeight: 500 }}>
          今天一句话 <span className="tiny">（可不写）</span>
        </label>
        <textarea
          id="day-note"
          className="note"
          rows={3}
          value={draft}
          placeholder="比如：下午效率不错，琐事基本清完了。"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== note && void saveDay(today, { note: draft })}
        />
      </div>

      <button
        className="btn primary big"
        onClick={() => {
          // 没安排的遗留默认顺延到明天，免得第二天一早又堆在一起
          if (leftovers.length) void moveTo(leftovers.map((t) => t.id), tomorrow)
          void saveDay(today, { note: draft, closedAt: new Date().toISOString() })
        }}
      >
        {leftovers.length > 0 ? `结束今天（剩下 ${leftovers.length} 件顺延到明天）` : '结束今天'}
      </button>
    </section>
  )
}
