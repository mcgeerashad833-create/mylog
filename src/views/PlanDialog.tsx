import { useEffect, useRef, useState } from 'react'
import type { Task } from '../db'
import { addDays, diffDays, longLabel, relativeLabel } from '../lib/date'
import { byOrder, deleteTask, markPlanned, moveTo } from '../store'

type Decision = 'today' | 'later' | 'drop'

interface Item {
  task: Task
  source: string
  hint: string
}

/** 需要在早上过一遍的事：之前遗留的 + 收集箱里的 */
export function planQueue(tasks: Task[], today: string): Item[] {
  const overdue = tasks
    .filter((t) => !t.done && t.date !== null && t.date < today)
    .sort((a, b) => a.date!.localeCompare(b.date!) || byOrder(a, b))
    .map((task) => ({ task, source: relativeLabel(task.date!, today) + '遗留', hint: '' }))
  const inbox = tasks
    .filter((t) => !t.done && t.date === null)
    .sort(byOrder)
    .map((task) => {
      const days = diffDays(today, task.createdAt.slice(0, 10))
      return { task, source: '收集箱', hint: days >= 14 ? `已经放了 ${days} 天` : days > 0 ? `${days} 天前记下` : '今天记下' }
    })
  return [...overdue, ...inbox]
}

interface Props {
  tasks: Task[]
  today: string
  onClose: () => void
}

export function PlanDialog({ tasks, today, onClose }: Props) {
  // 打开时取一次快照：处理过程中任务会被移动，不能让队列跟着变
  const [queue] = useState(() => planQueue(tasks, today))
  const [decisions, setDecisions] = useState<Decision[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)
  const i = decisions.length
  const finished = i >= queue.length
  const cur = queue[i]

  const fixedToday = tasks.filter((t) => !t.done && t.date === today && !queue.some((q) => q.task.id === t.id)).length
  const picked = queue.filter((_, k) => decisions[k] === 'today')

  function decide(d: Decision) {
    if (!cur) return
    const t = cur.task
    if (d === 'today') void moveTo([t.id], today)
    // 改天：遗留的推到明天；收集箱里的继续放着
    if (d === 'later' && t.date !== null) void moveTo([t.id], addDays(today, 1))
    if (d === 'drop') void deleteTask(t.id)
    setDecisions([...decisions, d])
  }

  function close() {
    markPlanned(today)
    onClose()
  }

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (finished) return
          if (e.key === '1') decide('today')
          if (e.key === '2') decide('later')
          if (e.key === '3') decide('drop')
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="tiny">{longLabel(today)}</span>
          <h2 id="plan-title" style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: '32px' }}>
            今天要做哪些事？
          </h2>
          <span className="subtle" style={{ fontSize: 13 }}>
            逐条决定，大约 1 分钟。
          </span>
        </div>

        {queue.length > 0 && (
          <div className="dots" aria-hidden="true">
            {queue.map((q, k) => (
              <span key={q.task.id} className={k < i ? 'on' : k === i ? 'cur' : ''} />
            ))}
          </div>
        )}

        {!finished && cur && (
          <>
            <div className="plan-card">
              <span className="chip" style={{ alignSelf: 'flex-start' }}>
                {cur.source}
              </span>
              <span style={{ fontSize: 18, fontWeight: 500, lineHeight: '28px' }}>{cur.task.title}</span>
              {cur.hint && <span className="subtle" style={{ fontSize: 13 }}>{cur.hint}</span>}
            </div>
            <div className="plan-actions">
              <button className="btn primary big" onClick={() => decide('today')}>
                今天做
              </button>
              <button className="btn big" onClick={() => decide('later')}>
                {cur.task.date === null ? '先放着' : '明天'}
              </button>
              <button className="btn big" onClick={() => decide('drop')}>
                不做了
              </button>
            </div>
            <div className="tiny" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>
                第 {i + 1} / {queue.length} 件 · 已选 {picked.length} 件
              </span>
              <span>键盘：1 今天 · 2 {cur.task.date === null ? '先放着' : '明天'} · 3 不做</span>
            </div>
          </>
        )}

        {finished && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <span style={{ fontSize: 15 }}>
              今天共 <strong>{picked.length + fixedToday}</strong> 件事，已经排好了。
            </span>
            {picked.length > 0 && (
              <div className="list" style={{ borderTop: '1px solid var(--line-soft)' }}>
                {picked.map((q) => (
                  <div key={q.task.id} className="plan-picked">
                    <span className="ring" />
                    <span style={{ flex: 1 }}>{q.task.title}</span>
                    <span className="tiny">{q.source}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="subtle" style={{ fontSize: 13 }}>
              {queue.length === 0
                ? '没有遗留，收集箱也是空的。'
                : `另有 ${fixedToday} 件本来就在今天。改天 ${decisions.filter((d) => d === 'later').length} 件，不做 ${decisions.filter((d) => d === 'drop').length} 件。`}
            </span>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary big" onClick={close} autoFocus>
                开始今天
              </button>
            </div>
          </div>
        )}

        {!finished && (
          <button className="link-btn" onClick={close}>
            跳过，直接进入今天
          </button>
        )}
      </div>
    </div>
  )
}
