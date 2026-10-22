import { useState } from 'react'
import { signIn, useSyncState } from '../sync'

/** 没登录时整个应用只显示这一页。账号由管理员在服务器上创建，这里没有注册入口 */
export function LoginScreen() {
  const sync = useSyncState()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await signIn(email, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <form
        className="login login-card"
        aria-labelledby="login-title"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <img src="/icons/icon.svg" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
          <h1 id="login-title" style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 600 }}>
            登录 MyLog
          </h1>
          <p className="subtle" style={{ margin: 0 }}>
            把每天的琐事排成一条清单，一条一条做完。
          </p>
        </div>
        {/* 被动退出（30 天没用、在别处改了密码）时说明原因 */}
        {sync.error && !error && (
          <p role="alert" style={{ margin: 0, color: 'var(--star)', fontSize: 13 }}>
            {sync.error}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            autoFocus
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? '正在登录…' : '登录'}
        </button>
        <span className="tiny">账号由管理员创建。没有账号或忘记密码，请联系管理员。</span>
      </form>
    </main>
  )
}
