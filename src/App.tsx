import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Meeting, type Task } from './db'
import { todayKey } from './lib/date'
import { dueReminders, meetingStatus, startAt, timeRange, whereLabel } from './lib/meeting'
import { isAlive, plannedToday, restoreTask, toggleDone } from './store'
import { ensureSeries, updateMeeting } from './meetings'
import { DetailDrawer } from './components/DetailDrawer'
import { BookIcon, CalendarIcon, ChartIcon, InboxIcon, SearchIcon, SunIcon, TodoIcon, VideoIcon } from './components/Icons'
import { InboxView, LaterView, TodayView, selectToday, type ViewProps } from './views/views'
import { LogView } from './views/LogView'
import { SearchView } from './views/SearchView'
import { SettingsView, syncLabel } from './views/SettingsView'
import { startAutoSync, useSyncState } from './sync'
import { useReminders } from './reminders'
import { onNotificationClick, showNotification } from './pwa'
import { PlanDialog, planQueue } from './views/PlanDialog'
import { ActionsView, MeetingsSection, StatsView, type MeetingProps, type MeetingRoute } from './views/meetings'

type View = 'today' | 'inbox' | 'later' | 'log' | 'settings' | 'search' | 'meetings' | 'actions' | 'stats'

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
    // 点通知后由 App 里的 onNotificationClick 打开会议
    const notify = (title: string, body: string, route: Extract<MeetingRoute, { id: string }>) =>
      void showNotification(title, body, title, { kind: 'meeting', page: route.page, id: route.id })
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
  const loaded = useLiveQuery(() => db.tasks.toArray().then((all) => all.filter(isAlive)), [])
  const tasks = loaded ?? []
  const meetings = useLiveQuery(() => db.meetings.toArray().then((all) => all.filter((m) => !m.deletedAt)), []) ?? []
  const [planning, setPlanning] = useState(false)
  const [query, setQuery] = useState('')
  const [logDate, setLogDate] = useState<string | undefined>()
  const [view, setView] = useState<View>('today')
  const [route, setRoute] = useState<MeetingRoute>({ page: 'list' })
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
      // 不在输入框里时按 / 开始搜索
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setView('search')
        document.getElementById('search')?.focus()
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

  useReminders(
    tasks,
    // 已经弹了系统通知就不在页面里重复提示
    (_t, text, viaSystem) => !viaSystem && notice('提醒：' + text),
  )

  // 点系统通知：打开对应的任务详情或会议
  useEffect(
    () =>
      onNotificationClick((t) => {
        if (t.kind === 'task') setSelectedId(t.id)
        else openMeeting({ page: t.page, id: t.id } as MeetingRoute)
      }),
    [openMeeting],
  )

  const onToggle = (t: Task) => {
    void toggleDone(t)
    // 撤销时重新读一遍：完成重复任务会写入 spawnedId，撤销要靠它删掉生成的下一次
    if (!t.done) {
      notice(`已完成「${t.title}」`, () =>
        void db.tasks.get(t.id).then((cur) => {
          if (cur?.done) return toggleDone(cur)
        }),
      )
    }
  }

  const { active, overdue } = selectToday(tasks, today)
  const counts: Record<View, number> = {
    today: active.length + overdue.length,
    inbox: tasks.filter((t) => !t.done && t.date === null).length,
    later: tasks.filter((t) => !t.done && t.date !== null && t.date > today).length,
    log: 0,
    settings: 0,
    search: 0,
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
    onPlan: () => setPlanning(true),
    onWrapUp: () => setView('log'),
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
    { id: 'log', label: '日志', icon: BookIcon },
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
        setLogDate(undefined)
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
        <div className="brand">
          <span>MyLog</span>
          <button
            className="icon-btn"
            aria-label="搜索（快捷键 /）"
            title="搜索（/）"
            aria-current={view === 'search' ? 'page' : undefined}
            onClick={() => setView('search')}
          >
            <SearchIcon />
          </button>
        </div>
        {nav.map(navButton)}
        <div className="nav-group">会议</div>
        {meetingNav.map(navButton)}
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
        {view === 'search' && (
          <SearchView
            tasks={tasks}
            today={today}
            query={query}
            selectedId={selectedId}
            onQuery={setQuery}
            onToggle={onToggle}
            onOpen={props.onOpen}
            onOpenDay={(d) => {
              setLogDate(d)
              setView('log')
            }}
          />
        )}
        {view === 'log' && <LogView key={logDate ?? 'today'} initialDate={logDate} tasks={tasks} today={today} onOpen={props.onOpen} onNotice={notice} />}
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
              {toast.label ?? '撤销'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
