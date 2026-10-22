import { useState, type RefObject } from 'react'
import type { Task } from '../db'
import { addDays, longLabel, relativeLabel, toKey } from '../lib/date'
import { byOrder, deleteTask, moveTo } from '../store'
import { QuickAdd } from '../components/QuickAdd'
import { SortableList } from '../components/SortableList'
import { TaskRow } from '../components/TaskRow'
import { ChevronIcon } from '../components/Icons'

export interface ViewProps {
  tasks: Task[]
  today: string
  selectedId: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onToggle: (t: Task) => void
  onOpen: (t: Task) => void
  onNotice: (text: string, undo?: () => void) => void
  /** 在快速添加里粘贴了腾讯会议邀请 */
  onInvite: (text: string) => void
}

export function selectToday(tasks: Task[], today: string) {
  const active = tasks.filter((t) => !t.done && t.date === today).sort(byOrder)
  const overdue = tasks.filter((t) => !t.done && t.date !== null && t.date < today).sort(byOrder)
  const done = tasks
    .filter((t) => t.done && t.doneAt && toKey(new Date(t.doneAt)) === today)
    .sort((a, b) => (a.doneAt! < b.doneAt! ? -1 : 1))
  return { active, overdue, done }
}

export function TodayView(p: ViewProps) {
  const { active, overdue, done } = selectToday(p.tasks, p.today)
  const [showDone, setShowDone] = useState(true)
  const [showOverdue, setShowOverdue] = useState(false)
  const total = active.length + done.length
  const pct = total ? Math.round((done.length / total) * 100) : 0

  const row = (t: Task, sortable: boolean) => (
    <TaskRow
      key={t.id}
      task={t}
      today={p.today}
      sortable={sortable}
      selected={t.id === p.selectedId}
      onToggle={p.onToggle}
      onOpen={p.onOpen}
    />
  )

  return (
    <div className="column">
      <header className="header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>今天</h1>
          <span className="subtle">{longLabel(p.today)}</span>
        </div>
      </header>

      {total > 0 && (
        <div>
          <div className="progress-meta">
            <span>
              已完成 {done.length} / {total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="今日进度">
            <div style={{ width: pct + '%' }} />
          </div>
        </div>
      )}

      <QuickAdd
        today={p.today}
        defaultDate={p.today}
        inputRef={p.inputRef}
        onNotice={p.onNotice}
        onInvite={p.onInvite}
        placeholder="添加一件事，回车保存。试试：明天下午3点 给物业打电话 !"
      />

      {overdue.length > 0 && (
        <section aria-label="之前遗留">
          <div className="banner">
            <div className="banner-body">
              <strong>之前遗留 {overdue.length} 件</strong>
              <span className="subtle" style={{ fontSize: 13 }}>
                {overdue
                  .slice(0, 3)
                  .map((t) => t.title)
                  .join('、')}
                {overdue.length > 3 ? ' 等' : ''}
              </span>
            </div>
            <button className="btn ghost" aria-expanded={showOverdue} onClick={() => setShowOverdue(!showOverdue)}>
              {showOverdue ? '收起' : '逐条处理'}
            </button>
            <button
              className="btn"
              onClick={() => {
                const ids = overdue.map((t) => t.id)
                const prev = overdue.map((t) => [t.id, t.date] as const)
                void moveTo(ids, p.today)
                p.onNotice(`已把 ${ids.length} 件移到今天`, () =>
                  prev.forEach(([id, date]) => void moveTo([id], date)),
                )
              }}
            >
              全部移到今天
            </button>
          </div>
          {showOverdue && (
            <div className="list" style={{ marginTop: 4 }}>
              {overdue.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={p.today}
                  selected={t.id === p.selectedId}
                  onToggle={p.onToggle}
                  onOpen={p.onOpen}
                  actions={
                    <>
                      <button className="btn small" onClick={() => void moveTo([t.id], p.today)}>
                        今天做
                      </button>
                      <button className="btn small" onClick={() => void moveTo([t.id], null)}>
                        放回收集箱
                      </button>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          void deleteTask(t.id)
                          p.onNotice(`已删除「${t.title}」`)
                        }}
                      >
                        不做了
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-label="待完成">
        {active.length > 0 ? (
          <SortableList tasks={active}>{(t) => row(t, true)}</SortableList>
        ) : (
          <div className="empty">
            {done.length > 0 ? (
              <>
                <strong>今天的事都做完了</strong>
                <span style={{ fontSize: 13 }}>好好休息。</span>
              </>
            ) : (
              <>
                <strong>今天还没有安排</strong>
                <span style={{ fontSize: 13 }}>在上面输入一件事，回车就能加进来。</span>
              </>
            )}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section aria-label="已完成" style={{ display: 'flex', flexDirection: 'column' }}>
          <button className="section-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <ChevronIcon size={14} />
            已完成 {done.length}
          </button>
          {showDone && <div className="list">{done.map((t) => row(t, false))}</div>}
        </section>
      )}
    </div>
  )
}

export function InboxView(p: ViewProps) {
  const items = p.tasks.filter((t) => !t.done && t.date === null).sort(byOrder)
  const tomorrow = addDays(p.today, 1)
  return (
    <div className="column">
      <header className="header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>收集箱</h1>
          <span className="subtle">随手记下、还没定时间的事。不用急着处理。</span>
        </div>
      </header>
      <QuickAdd
        today={p.today}
        defaultDate={null}
        inputRef={p.inputRef}
        onNotice={p.onNotice}
        onInvite={p.onInvite}
        placeholder="想到什么先记下，回车保存"
      />
      {items.length > 0 ? (
        <SortableList tasks={items}>
          {(t) => (
            <TaskRow
              key={t.id}
              task={t}
              today={p.today}
              sortable
              selected={t.id === p.selectedId}
              onToggle={p.onToggle}
              onOpen={p.onOpen}
              actions={
                <>
                  <button
                    className="btn small"
                    onClick={() => {
                      void moveTo([t.id], p.today)
                      p.onNotice(`「${t.title}」已移到今天`, () => void moveTo([t.id], null))
                    }}
                  >
                    今天做
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      void moveTo([t.id], tomorrow)
                      p.onNotice(`「${t.title}」已安排到明天`, () => void moveTo([t.id], null))
                    }}
                  >
                    明天
                  </button>
                </>
              }
            />
          )}
        </SortableList>
      ) : (
        <div className="empty">
          <strong>收集箱是空的</strong>
          <span style={{ fontSize: 13 }}>脑子里没有悬着的事了。</span>
        </div>
      )}
    </div>
  )
}

export function LaterView(p: ViewProps) {
  const items = p.tasks
    .filter((t) => !t.done && t.date !== null && t.date > p.today)
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '').localeCompare(b.time ?? '') || byOrder(a, b))
  const groups: { date: string; tasks: Task[] }[] = []
  for (const t of items) {
    const last = groups[groups.length - 1]
    if (last && last.date === t.date) last.tasks.push(t)
    else groups.push({ date: t.date!, tasks: [t] })
  }

  return (
    <div className="column">
      <header className="header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>以后</h1>
          <span className="subtle">定好日子的事。到了那天会自动出现在「今天」。</span>
        </div>
      </header>
      <QuickAdd
        today={p.today}
        defaultDate={addDays(p.today, 1)}
        inputRef={p.inputRef}
        onNotice={p.onNotice}
        onInvite={p.onInvite}
        placeholder="添加以后要做的事，不写日期默认明天。例如：周五 交周报"
      />
      {groups.length === 0 && (
        <div className="empty">
          <strong>以后还没有安排</strong>
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
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={p.today}
                selected={t.id === p.selectedId}
                onToggle={p.onToggle}
                onOpen={p.onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
