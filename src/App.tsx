import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Meeting, type Task } from './db'
import { todayKey } from './lib/date'
import { dueReminders, meetingStatus, startAt, timeRange, whereLabel } from './lib/meeting'
import { isAlive, restoreTask, toggleDone } from './store'
import { ensureSeries, updateMeeting } from './meetings'
import { DetailDrawer } from './components/DetailDrawer'
import { CalendarIcon, ChartIcon, InboxIcon, SunIcon, TodoIcon, VideoIcon } from './components/Icons'
import { InboxView, LaterView, TodayView, selectToday, type ViewProps } from './views/views'
import { ActionsView, MeetingsSection, StatsView, type MeetingProps, type MeetingRoute } from './views/meetings'

type View = 'today' | 'inbox' | 'later' | 'meetings' | 'actions' | 'stats'

interface Toast {
  text: string
  /** 按钮要做的事；没有 label 时按钮叫「撤销」 */
  undo?: () => void
  label?: string
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

/** 会议状态（几分钟后开始、进行中）要跟着时间走 */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function canNotify(): boolean {
  return typeof Notification !== 'undefined'
}

/** 会前提醒、会后还没整理纪要的提醒：系统通知 + 页面内提示 */
function useMeetingReminders(meetings: Meeting[], now: Date, show: (t: Toast) => void, open: (r: MeetingRoute) => void) {
  // 写库是异步的，写完之前可能又渲染一次，用它防止同一条提醒发两遍
  const fired = useRef(new Set<string>())
  useEffect(() => {
    const due = dueReminders(meetings, now)
    // 改了会议时间要重新提醒，所以时间也算进去
    const key = (kind: string, m: Meeting) => `${kind}:${m.id}:${m.date}:${m.start}`
    const before = due.before.filter((m) => !fired.current.has(key('b', m)))
    const after = due.after.filter((m) => !fired.current.has(key('a', m)))
    before.forEach((m) => fired.current.add(key('b', m)))
    after.forEach((m) => fired.current.add(key('a', m)))
    const ts = new Date().toISOString()
    const notify = (title: string, body: string, route: MeetingRoute) => {
      if (canNotify() && Notification.permission === 'granted') {
        const n = new Notification(title, { body, tag: title })
        n.onclick = () => {
          window.focus()
          open(route)
        }
      }
    }
    for (const m of before) {
      void updateMeeting(m.id, { remindedAt: ts })
      const mins = Math.max(1, Math.ceil((startAt(m).getTime() - now.getTime()) / 60_000))
      notify(`${m.title} · ${mins} 分钟后开始`, `${timeRange(m)} · ${whereLabel(m)}`, { page: 'detail', id: m.id })
      show({ text: `「${m.title}」${mins} 分钟后开始`, label: '查看', undo: () => open({ page: 'detail', id: m.id }) })
    }
    for (const m of after) {
      void updateMeeting(m.id, { nudgedAt: ts })
      notify(`「${m.title}」的纪要还没整理`, '花几分钟整理一下，会上领的活才会进「今天」。', { page: 'minutes', id: m.id })
      show({ text: `「${m.title}」的纪要还没整理`, label: '去整理', undo: () => open({ page: 'minutes', id: m.id }) })
    }
  }, [meetings, now, show, open])
}

export function App() {
  const today = useToday()
  const now = useNow(15_000)
  const tasks = useLiveQuery(() => db.tasks.toArray().then((all) => all.filter(isAlive)), []) ?? []
  const meetings = useLiveQuery(() => db.meetings.toArray().then((all) => all.filter((m) => !m.deletedAt)), []) ?? []
  const [view, setView] = useState<View>('today')
  const [route, setRoute] = useState<MeetingRoute>({ page: 'list' })
  const [notifyPerm, setNotifyPerm] = useState(() => (canNotify() ? Notification.permission : 'denied'))
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
  const openMeeting = useCallback((r: MeetingRoute) => {
    setView('meetings')
    setRoute(r)
    window.scrollTo(0, 0)
  }, [])
  useMeetingReminders(meetings, now, setToast, openMeeting)

  // 例会：打开时和跨天时补建下一次
  useEffect(() => {
    void ensureSeries(today)
  }, [today])

  const onToggle = (t: Task) => {
    void toggleDone(t)
    if (!t.done) notice(`已完成「${t.title}」`, () => void toggleDone({ ...t, done: true }))
  }

  const { active, overdue } = selectToday(tasks, today)
  const counts: Record<View, number> = {
    today: active.length + overdue.length,
    inbox: tasks.filter((t) => !t.done && t.date === null).length,
    later: tasks.filter((t) => !t.done && t.date !== null && t.date > today).length,
    meetings: meetings.filter((m) => m.date === today && ['upcoming', 'ongoing', 'recording'].includes(meetingStatus(m, now))).length,
    actions: tasks.filter((t) => t.meetingId && !t.done).length,
    stats: 0,
  }

  const props: ViewProps = {
    tasks,
    today,
    selectedId,
    inputRef,
    onToggle,
    onOpen: (t) => setSelectedId(t.id === selectedId ? null : t.id),
    onNotice: notice,
    onInvite: (text) => openMeeting({ page: 'new', invite: text }),
  }

  const meetingProps: MeetingProps = {
    meetings,
    tasks,
    today,
    now,
    selectedId,
    go: openMeeting,
    onNotice: notice,
    onToggle,
    onOpen: props.onOpen,
  }

  const nav: { id: View; label: string; icon: typeof SunIcon }[] = [
    { id: 'today', label: '今天', icon: SunIcon },
    { id: 'inbox', label: '收集箱', icon: InboxIcon },
    { id: 'later', label: '以后', icon: CalendarIcon },
  ]
  const meetingNav: { id: View; label: string; icon: typeof SunIcon }[] = [
    { id: 'meetings', label: '会议日程', icon: VideoIcon },
    { id: 'actions', label: '会议待办', icon: TodoIcon },
    { id: 'stats', label: '会议统计', icon: ChartIcon },
  ]
  const navButton = ({ id, label, icon: Icon }: (typeof nav)[number]) => (
    <button
      key={id}
      className="nav-item"
      aria-current={view === id ? 'page' : undefined}
      onClick={() => {
        setView(id)
        if (id === 'meetings') setRoute({ page: 'list' })
      }}
    >
      <Icon color={view === id ? 'var(--accent)' : 'var(--text-2)'} />
      {label}
      {counts[id] > 0 && <span className="count">{counts[id]}</span>}
    </button>
  )

  return (
    <div className="app">
      <nav className="sidebar" aria-label="主导航">
        <div className="brand">MyLog</div>
        {nav.map(navButton)}
        <div className="nav-group">会议</div>
        {meetingNav.map(navButton)}
        {notifyPerm === 'default' && (
          <button
            className="btn small ghost"
            style={{ alignSelf: 'flex-start', marginLeft: 6 }}
            onClick={() => void Notification.requestPermission().then(setNotifyPerm)}
          >
            开启会前桌面提醒
          </button>
        )}
        <div className="sidebar-foot">数据保存在本机 · 多设备同步开发中</div>
      </nav>

      <main className="main">
        {view === 'today' && <TodayView {...props} />}
        {view === 'inbox' && <InboxView {...props} />}
        {view === 'later' && <LaterView {...props} />}
        {view === 'meetings' && <MeetingsSection {...meetingProps} route={route} onOpenActions={() => setView('actions')} />}
        {view === 'actions' && <ActionsView {...meetingProps} />}
        {view === 'stats' && <StatsView {...meetingProps} />}
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
              {toast.label ?? '撤销'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
