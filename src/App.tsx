import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Task } from './db'
import { todayKey } from './lib/date'
import { isAlive, plannedToday, restoreTask, toggleDone } from './store'
import { DetailDrawer } from './components/DetailDrawer'
import { BookIcon, CalendarIcon, InboxIcon, SunIcon } from './components/Icons'
import { InboxView, LaterView, TodayView, selectToday, type ViewProps } from './views/views'
import { LogView } from './views/LogView'
import { SettingsView, syncLabel } from './views/SettingsView'
import { startAutoSync, useSyncState } from './sync'
import { PlanDialog, planQueue } from './views/PlanDialog'

type View = 'today' | 'inbox' | 'later' | 'log' | 'settings'

interface Toast {
  text: string
  undo?: () => void
}

/** 跨过零点时自动切到新的一天 */
function useToday(): string {
  const [today, setToday] = useState(todayKey())
  useEffect(() => {
    const id = setInterval(() => setToday(todayKey()), 30_000)
    return () => clearInterval(id)
  }, [])
  return today
}

export function App() {
  const today = useToday()
  const loaded = useLiveQuery(() => db.tasks.toArray().then((all) => all.filter(isAlive)), [])
  const tasks = loaded ?? []
  const [planning, setPlanning] = useState(false)
  const [view, setView] = useState<View>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sync = useSyncState()

  useEffect(() => startAutoSync(), [])
  const selected = tasks.find((t) => t.id === selectedId) ?? null

  // 每天第一次打开时，有遗留或收集箱里有事，就弹出早间规划
  useEffect(() => {
    if (loaded && !plannedToday(today) && planQueue(loaded, today).length > 0) setPlanning(true)
    // 只在数据首次加载完成和日期变化时检查
  }, [loaded === undefined, today])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && selectedId && !(e.target instanceof HTMLInputElement)) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  const notice = (text: string, undo?: () => void) => setToast({ text, undo })

  const onToggle = (t: Task) => {
    void toggleDone(t)
    if (!t.done) notice(`已完成「${t.title}」`, () => void toggleDone({ ...t, done: true }))
  }

  const { active, overdue } = selectToday(tasks, today)
  const counts: Record<View, number> = {
    today: active.length + overdue.length,
    inbox: tasks.filter((t) => !t.done && t.date === null).length,
    later: tasks.filter((t) => !t.done && t.date !== null && t.date > today).length,
    log: 0,
    settings: 0,
  }

  const props: ViewProps = {
    tasks,
    today,
    selectedId,
    inputRef,
    onToggle,
    onOpen: (t) => setSelectedId(t.id === selectedId ? null : t.id),
    onNotice: notice,
    onPlan: () => setPlanning(true),
    onWrapUp: () => setView('log'),
  }

  const nav: { id: View; label: string; icon: typeof SunIcon }[] = [
    { id: 'today', label: '今天', icon: SunIcon },
    { id: 'inbox', label: '收集箱', icon: InboxIcon },
    { id: 'later', label: '以后', icon: CalendarIcon },
    { id: 'log', label: '日志', icon: BookIcon },
  ]

  return (
    <div className="app">
      <nav className="sidebar" aria-label="主导航">
        <div className="brand">MyLog</div>
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className="nav-item"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            <Icon color={view === id ? 'var(--accent)' : 'var(--text-2)'} />
            {label}
            {counts[id] > 0 && <span className="count">{counts[id]}</span>}
          </button>
        ))}
        <button
          className="sidebar-foot"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          {sync.email && (
            <span
              className={'state-dot ' + (sync.status === 'idle' ? 'ok' : sync.status === 'syncing' ? '' : 'bad')}
              aria-hidden="true"
            />
          )}
          {sync.email ? syncLabel(sync) : '数据只在本机 · 登录以同步'}
        </button>
      </nav>

      <main className="main">
        {view === 'today' && <TodayView {...props} />}
        {view === 'inbox' && <InboxView {...props} />}
        {view === 'later' && <LaterView {...props} />}
        {view === 'settings' && <SettingsView />}
        {view === 'log' && <LogView tasks={tasks} today={today} onOpen={props.onOpen} onNotice={notice} />}
      </main>

      {selected && (
        <DetailDrawer
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onDeleted={(t) => {
            setSelectedId(null)
            notice(`已删除「${t.title}」`, () => void restoreTask(t.id))
          }}
        />
      )}

      {planning && <PlanDialog tasks={tasks} today={today} onClose={() => setPlanning(false)} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.()
                setToast(null)
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}
    </div>
  )
}
