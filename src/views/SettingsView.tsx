import { useEffect, useState } from 'react'
import { api, logout, requestCode, syncNow, useSyncState, verifyCode, type SyncState } from '../sync'

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
        <h1>账户与同步</h1>
      </header>
      {sync.email ? <Account sync={sync} /> : <Login />}
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const send = () =>
    run(async () => {
      await requestCode(email)
      setSent(true)
      setCooldown(60)
    })

  return (
    <form
      className="login"
      onSubmit={(e) => {
        e.preventDefault()
        if (!sent) void send()
        else void run(() => verifyCode(email, code))
      }}
    >
      <p className="subtle" style={{ margin: 0 }}>
        用邮箱登录后，电脑和手机上的清单会自动同步。本机已有的事会一起上传到账户里。
      </p>
      <div className="form-field">
        <label htmlFor="login-email">邮箱</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={sent}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      {sent && (
        <div className="form-field">
          <label htmlFor="login-code">验证码</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="邮件里的 6 位数字"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn big" disabled={busy || cooldown > 0} onClick={() => void send()}>
              {cooldown > 0 ? `${cooldown} 秒后重发` : '重新发送'}
            </button>
          </div>
          <span className="tiny">
            已发送到 {email}，10 分钟内有效。
            <button type="button" className="link-btn" style={{ padding: 0, fontSize: 12 }} onClick={() => setSent(false)}>
              换个邮箱
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </p>
      )}
      <button type="submit" className="btn primary big" disabled={busy}>
        {busy ? '请稍候…' : sent ? '登录' : '发送验证码'}
      </button>
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
