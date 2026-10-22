import { useEffect, useRef, useState } from 'react'
import { addDays, fromKey } from '../../lib/date'
import { hoursByKind, mondayOf, todoStats, weeklyHours, type WeekStat } from '../../lib/stats'
import { KindBadge, type MeetingProps } from './shared'

const WEEKS = 8

/** 1.5 小时 → 「1.5」，整数不带小数 */
const fmt = (h: number) => (Math.round(h * 10) / 10).toString()

const md = (key: string) => {
  const d = fromKey(key)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function StatsView(p: MeetingProps) {
  const weeks = weeklyHours(p.meetings, p.today, WEEKS)
  const thisWeek = weeks[weeks.length - 1]
  const avg = weeks.reduce((s, w) => s + w.hours, 0) / WEEKS
  const monday = mondayOf(p.today)
  const byKind = hoursByKind(p.meetings, monday, addDays(monday, 6))
  const todos = todoStats(p.meetings, p.tasks, p.today, weeks[0].start)
  const judged = todos.onTime + todos.late + todos.overdue

  return (
    <div className="column wide">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 className="page-title">会议统计</h1>
        <span className="subtle">最近 {WEEKS} 周 · 按日程上的时间计算，没写结束时间的会按 1 小时算</span>
      </header>

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">本周开会</span>
          <span className="tile-value">
            {fmt(thisWeek.hours)}
            <small> 小时</small>
          </span>
          <span className="tiny">{thisWeek.count} 场</span>
        </div>
        <div className="tile">
          <span className="tile-label">最近 {WEEKS} 周平均</span>
          <span className="tile-value">
            {fmt(avg)}
            <small> 小时 / 周</small>
          </span>
          <span className="tiny">约占 40 小时工作周的 {Math.round((avg / 40) * 100)}%</span>
        </div>
        <div className="tile">
          <span className="tile-label">会议待办按时完成率</span>
          <span className="tile-value">
            {todos.rate === null ? '—' : Math.round(todos.rate * 100)}
            {todos.rate !== null && <small>%</small>}
          </span>
          <span className="tiny">
            {judged ? `${judged} 条有截止日期的待办里，按时完成 ${todos.onTime} 条` : '还没有到期的会议待办'}
          </span>
        </div>
      </div>

      <section className="card">
        <h2>每周开会时长（小时）</h2>
        <WeeklyChart weeks={weeks} />
        <details className="data-table">
          <summary>查看数据</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">周</th>
                <th scope="col">场数</th>
                <th scope="col">小时</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start}>
                  <td>
                    {md(w.start)} – {md(addDays(w.start, 6))}
                  </td>
                  <td>{w.count}</td>
                  <td>{fmt(w.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <div className="split" style={{ gap: 16 }}>
        <section className="card" style={{ flex: '1 1 280px' }}>
          <h2>本周按形式</h2>
          {(['online', 'offline', 'hybrid'] as const).map((k) => (
            <div key={k} className="kv-row">
              <KindBadge kind={k} />
              <span className="tabular">{fmt(byKind[k])} 小时</span>
            </div>
          ))}
          {thisWeek.count === 0 && <span className="tiny">本周还没有会议。</span>}
        </section>

        <section className="card" style={{ flex: '1 1 280px' }}>
          <h2>我负责的会议待办</h2>
          <div className="kv-row">
            <span>按时完成</span>
            <span className="tabular">{todos.onTime}</span>
          </div>
          <div className="kv-row">
            <span>过了截止才完成</span>
            <span className="tabular">{todos.late}</span>
          </div>
          <div className="kv-row">
            <span>已逾期，还没完成</span>
            <span className={'tabular' + (todos.overdue ? ' late' : '')}>{todos.overdue}</span>
          </div>
          <div className="kv-row">
            <span>进行中</span>
            <span className="tabular">{todos.open}</span>
          </div>
          <div className="kv-row">
            <span>已完成（没写截止日期）</span>
            <span className="tabular">{todos.doneNoDue}</span>
          </div>
          <span className="tiny">只算最近 {WEEKS} 周的会、已保存纪要的待办。</span>
        </section>
      </div>
    </div>
  )
}

/** 简单的「最大值取整」：1 / 2 / 5 × 10ⁿ */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

const H = 220
const PAD = { top: 22, right: 8, bottom: 28, left: 32 }

/** 按容器的实际宽度画图，文字不会跟着缩放 */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function WeeklyChart({ weeks }: { weeks: WeekStat[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [ref, W] = useWidth(640)
  const max = niceMax(Math.max(...weeks.map((w) => w.hours)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / weeks.length
  const barW = Math.min(24, slot * 0.5)
  const base = PAD.top + plotH
  const y = (v: number) => base - (v / max) * plotH
  const ticks = [0, max / 2, max]
  const last = weeks.length - 1

  const bar = (x: number, top: number) => {
    const r = Math.min(4, base - top)
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`
  }

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="每周开会时长柱状图，数据见下方表格">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = PAD.left + slot * i + slot / 2
          const top = y(w.hours)
          return (
            <g key={w.start}>
              {w.hours > 0 && <path d={bar(cx - barW / 2, top)} className="bar" />}
              {i === last && w.hours > 0 && (
                <text x={cx} y={top - 6} className="value" textAnchor="middle">
                  {fmt(w.hours)}
                </text>
              )}
              <text x={cx} y={H - 8} className="axis" textAnchor="middle">
                {i === last ? '本周' : md(w.start)}
              </text>
              {/* 整列都是悬停区域，比柱子本身大 */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                className="hit"
                tabIndex={0}
                aria-label={`${md(w.start)} 那周：${w.count} 场，${fmt(w.hours)} 小时`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`,
            top: `${(Math.max(y(weeks[hover].hours) - 8, PAD.top) / H) * 100}%`,
          }}
        >
          <strong>
            {md(weeks[hover].start)} – {md(addDays(weeks[hover].start, 6))}
          </strong>
          <span>
            {weeks[hover].count} 场 · {fmt(weeks[hover].hours)} 小时
          </span>
        </div>
      )}
    </div>
  )
}
