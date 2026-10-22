import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Task } from '../db'
import { longLabel } from '../lib/date'
import { search } from '../lib/search'
import { Highlight, TaskRow } from '../components/TaskRow'
import { SearchIcon } from '../components/Icons'

interface Props {
  tasks: Task[]
  today: string
  query: string
  selectedId: string | null
  onQuery: (q: string) => void
  onToggle: (t: Task) => void
  onOpen: (t: Task) => void
  onOpenDay: (date: string) => void
}

/** 已完成的结果太多时只先列这么多 */
const DONE_LIMIT = 50

export function SearchView(p: Props) {
  const days = useLiveQuery(() => db.days.toArray(), []) ?? []
  const r = search(p.tasks, days, p.query)
  const total = r.open.length + r.done.length + r.days.length
  const hasQuery = p.query.trim().length > 0

  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      today={p.today}
      showDate
      query={p.query}
      selected={t.id === p.selectedId}
      onToggle={p.onToggle}
      onOpen={p.onOpen}
    />
  )

  return (
    <div className="column">
      <header className="header">
        <h1>搜索</h1>
      </header>

      <div className="quick-add">
        <SearchIcon color="var(--text-2)" />
        <label htmlFor="search" className="sr-only">
          搜索
        </label>
        <input
          id="search"
          type="search"
          autoFocus
          autoComplete="off"
          value={p.query}
          placeholder="搜标题、备注、子步骤和每天的一句话；#标签 只搜标签"
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && p.onQuery('')}
        />
        <span className="kbd">/</span>
      </div>

      {hasQuery && total === 0 && (
        <div className="empty">
          <strong>没有找到相关的事</strong>
          <span style={{ fontSize: 13 }}>换个关键词试试，或者少输几个字。</span>
        </div>
      )}

      {r.open.length > 0 && (
        <section aria-label="没做完的">
          <h2 className="group-title">
            没做完的 <span className="tiny">{r.open.length}</span>
          </h2>
          <div className="list">{r.open.map(row)}</div>
        </section>
      )}

      {r.done.length > 0 && (
        <section aria-label="做完的">
          <h2 className="group-title">
            做完的 <span className="tiny">{r.done.length}</span>
          </h2>
          <div className="list">{r.done.slice(0, DONE_LIMIT).map(row)}</div>
          {r.done.length > DONE_LIMIT && (
            <p className="tiny" style={{ margin: '8px 6px' }}>
              只列出最近完成的 {DONE_LIMIT} 件，多输几个字可以缩小范围。
            </p>
          )}
        </section>
      )}

      {r.days.length > 0 && (
        <section aria-label="日志">
          <h2 className="group-title">
            日志 <span className="tiny">{r.days.length}</span>
          </h2>
          <div>
            {r.days.map((d) => (
              <button key={d.date} className="day-link search-day" onClick={() => p.onOpenDay(d.date)}>
                <span className="tiny" style={{ flex: 'none' }}>
                  {longLabel(d.date)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Highlight text={d.note} query={p.query} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
