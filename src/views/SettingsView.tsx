import { useEffect, useState } from 'react'
import { api, logout, signIn, syncNow, useSyncState, type SyncState } from '../sync'
import { ensureNotifyPermission, setRemindersEnabled, useReminderSettings } from '../reminders'

interface Session {
  id: number
  device: string
  lastSeen: string
  current: boolean
}

export function syncLabel(s: SyncState): string {
  if (s.status === 'off') return '登录以在多台设备间同步'
  if (s.status === 'syncing') return '同步中…'
  if (s.status === 'offline') return '离线，联网后自动同步'
  if (s.status === 'error') return '同步失败'
  return s.lastSyncedAt ? `已同步 · ${ago(s.lastSyncedAt)}` : '已登录'
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function SettingsView() {
  const sync = useSyncState()
  return (
    <div className="column" style={{ maxWidth: 680, gap: 32 }}>
      <header className="header">
        <h1>设置</h1>
      </header>
      <section aria-labelledby="s-account" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 id="s-account" className="group-title" style={{ fontSize: 16 }}>
          账户与同步
        </h2>
        {sync.email ? <Account sync={sync} /> : <Login />}
      </section>
      <ReminderSettings />
    </div>
  )
}

function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const register = mode === 'register'

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await signIn(mode, email, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="subtle" style={{ margin: 0 }}>
        登录后，电脑和手机上的清单会自动同步。本机已有的事会一起上传到账户里。
      </p>
      <div className="form-field">
        <label htmlFor="login-email">邮箱</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="form-field">
        <label htmlFor="login-password">密码</label>
        <input
          id="login-password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          required
          minLength={register ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={register ? '至少 8 位' : ''}
        />
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn primary big" disabled={busy}>
        {busy ? '请稍候…' : register ? '注册并登录' : '登录'}
      </button>
      <span className="tiny">
        {register ? '已经有账户了？' : '还没有账户？'}
        <button
          type="button"
          className="link-btn"
          style={{ padding: 0, fontSize: 12 }}
          onClick={() => {
            setMode(register ? 'login' : 'register')
            setError('')
          }}
        >
          {register ? '去登录' : '注册一个'}
        </button>
      </span>
    </form>
  )
}

function Account({ sync }: { sync: SyncState }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [error, setError] = useState('')

  const load = () =>
    api<{ sessions: Session[] }>('/me')
      .then((r) => setSessions(r.sessions))
      .catch(() => undefined)

  useEffect(() => {
    void load()
  }, [])

  return (
    <>
      <section className="card" aria-label="账户">
        <span className="avatar">{sync.email!.slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{sync.email}</span>
          <span className="tiny" role="status">
            {syncLabel(sync)}
            {sync.status === 'error' && sync.error ? `：${sync.error}` : ''}
          </span>
        </div>
        <button className="btn" disabled={sync.status === 'syncing'} onClick={() => void syncNow()}>
          立即同步
        </button>
      </section>

      <section aria-labelledby="devices-title" style={{ display: 'flex', flexDirection: 'column' }}>
        <h2 id="devices-title" className="group-title">
          已登录的设备
        </h2>
        {sessions.map((s) => (
          <div key={s.id} className="device">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{s.device || '未知设备'}</span>
              <span className="tiny">{s.current ? '当前设备' : `最近使用：${ago(s.lastSeen)}`}</span>
            </div>
            {!s.current && (
              <button
                className="btn ghost small"
                onClick={() => void api(`/sessions/${s.id}`, { method: 'DELETE' }).then(load)}
              >
                移除
              </button>
            )}
          </div>
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <button
          className="btn"
          onClick={() => {
            if (!confirm('退出后会清除本机上的清单，云端数据保留，重新登录即可恢复。确定退出吗？')) return
            setError('')
            logout().catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }}
        >
          退出登录
        </button>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </p>
        )}
      </section>
    </>
  )
}

function ReminderSettings() {
  const { enabled, permission } = useReminderSettings()
  return (
    <section aria-labelledby="s-remind" style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 id="s-remind" className="group-title" style={{ fontSize: 16 }}>
        提醒
      </h2>
      <label className="switch-row">
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>到点提醒</span>
          <span className="tiny">设了时间的事，到点发一条安静的通知（不响铃）。可以在任务详情里改提前量或关掉。</span>
        </span>
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setRemindersEnabled(e.target.checked)} />
      </label>
      {enabled && (
        <div className="switch-row">
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>系统通知</span>
            <span className="tiny">
              {permission === 'granted' && '已允许。MyLog 页面开着（可以在后台）时才会提醒。'}
              {permission === 'default' && '还没允许，现在只会在 MyLog 页面里提示。'}
              {permission === 'denied' && '已被浏览器拦截，请在浏览器的网站设置里允许通知。'}
              {permission === 'unsupported' && '这个浏览器不支持系统通知，只会在页面里提示。'}
            </span>
          </span>
          {permission === 'default' && (
            <button className="btn" onClick={() => void ensureNotifyPermission()}>
              允许通知
            </button>
          )}
        </div>
      )}
    </section>
  )
}
