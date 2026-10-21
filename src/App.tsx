import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Task } from './db'
import { todayKey } from './lib/date'
import { isAlive, restoreTask, toggleDone } from './store'
import { DetailDrawer } from './components/DetailDrawer'
import { CalendarIcon, InboxIcon, SunIcon } from './components/Icons'
import { InboxView, LaterView, TodayView, selectToday, type ViewProps } from './views/views'

type View = 'today' | 'inbox' | 'later'

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
  const tasks = useLiveQuery(() => db.tasks.toArray().then((all) => all.filter(isAlive)), []) ?? []
  const [view, setView] = useState<View>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = tasks.find((t) => t.id === selectedId) ?? null

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
  }

  const props: ViewProps = {
    tasks,
    today,
    selectedId,
    inputRef,
    onToggle,
    onOpen: (t) => setSelectedId(t.id === selectedId ? null : t.id),
    onNotice: notice,
  }

  const nav: { id: View; label: string; icon: typeof SunIcon }[] = [
    { id: 'today', label: '今天', icon: SunIcon },
    { id: 'inbox', label: '收集箱', icon: InboxIcon },
    { id: 'later', label: '以后', icon: CalendarIcon },
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
        <div className="sidebar-foot">数据保存在本机 · 多设备同步开发中</div>
      </nav>

      <main className="main">
        {view === 'today' && <TodayView {...props} />}
        {view === 'inbox' && <InboxView {...props} />}
        {view === 'later' && <LaterView {...props} />}
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
