import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import type { RowDataPacket } from 'mysql2/promise'
import { createPool, migrate, type Pool } from './db.ts'
import { createUser, deleteUser, listUsers, randomPassword, resetPassword } from './users.ts'

// 需要一个空的测试库；连不上就跳过（例如没有装 MySQL 的环境）
const URL = process.env.TEST_DATABASE_URL ?? 'mysql://mylog:mylog_dev@localhost:3306/mylog_test'

const pool: Pool = createPool(URL)
let app: ReturnType<typeof buildApp>

const available = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false)
// CI 里设置 REQUIRE_DB=1：连不上数据库要直接失败，而不是悄悄跳过
if (!available && process.env.REQUIRE_DB === '1') throw new Error(`连不上测试数据库：${URL}`)

beforeAll(async () => {
  if (!available) return
  await pool.query('DROP TABLE IF EXISTS tasks, days, meetings, sessions, login_codes, users')
  await migrate(pool)
  app = buildApp({ pool })
})

afterAll(async () => {
  await app?.close()
  await pool.end()
})

async function login(email: string, device = 'test') {
  // 账号只能在服务器上创建：没有就先建一个
  await createUser(pool, email, 'secret-123').catch(() => undefined)
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'secret-123', device } })
  return res.json().token as string
}

function sync(token: string, payload: object) {
  return app
    .inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}` }, payload })
    .then((r) => r.json())
}

const task = (id: string, title: string, updatedAt: string) => ({ id, title, updatedAt, deletedAt: null })

describe.skipIf(!available)('服务端', () => {
  it('应用里不能注册，只能登录管理员建好的账号', async () => {
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })
    expect((await post('/api/auth/register', { email: 'a@example.com', password: 'secret-123' })).statusCode).toBe(404)

    await createUser(pool, 'A@Example.com ', 'secret-123')
    const wrong = await post('/api/auth/login', { email: 'a@example.com', password: 'wrong-pass' })
    expect(wrong.statusCode).toBe(401)
    const nobody = await post('/api/auth/login', { email: 'nobody@example.com', password: 'secret-123' })
    expect(nobody.statusCode).toBe(401)
    expect(nobody.json().error).toBe(wrong.json().error)
    expect((await post('/api/auth/login', { email: 'not-an-email', password: 'secret-123' })).statusCode).toBe(400)

    await post('/api/auth/login', { email: 'a@example.com', password: 'secret-123', device: 'MacBook' })
    const ok = await post('/api/auth/login', { email: ' A@example.com', password: 'secret-123', device: 'iPhone' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().email).toBe('a@example.com')

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${ok.json().token}` } })
    expect(me.json().email).toBe('a@example.com')
    expect(me.json().sessions).toHaveLength(2)
    expect(me.json().sessions.find((s: { current: boolean }) => s.current).device).toBe('iPhone')

    // 数据库里不存明文密码
    const [rows] = await pool.query<RowDataPacket[]>('SELECT password_hash FROM users WHERE email = ?', ['a@example.com'])
    expect(rows[0].password_hash).toMatch(/^scrypt\$/)
    expect(rows[0].password_hash).not.toContain('secret-123')
  })

  it('管理员命令：建账号、重置密码、列出、删除', async () => {
    await expect(createUser(pool, 'admin1@example.com', 'short')).rejects.toThrow('密码需要')
    await expect(createUser(pool, 'not-an-email', 'secret-123')).rejects.toThrow('邮箱格式不对')
    await createUser(pool, 'admin1@example.com', 'secret-123')
    await expect(createUser(pool, 'Admin1@example.com', 'secret-456')).rejects.toThrow('已经有账号')

    // 重置密码：旧密码失效，所有设备退出
    const token = await login('admin1@example.com')
    await resetPassword(pool, 'admin1@example.com', 'brand-new-789')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })
    expect(me.statusCode).toBe(401)
    const loginWith = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin1@example.com', password } })
    expect((await loginWith('secret-123')).statusCode).toBe(401)
    const fresh = await loginWith('brand-new-789')
    expect(fresh.statusCode).toBe(200)
    await expect(resetPassword(pool, 'nobody@example.com', 'secret-123')).rejects.toThrow('没有')

    const users = await listUsers(pool)
    expect(users.find((u) => u.email === 'admin1@example.com')).toMatchObject({ devices: 1 })

    // 删除账号会连带删掉它的数据
    await sync(fresh.json().token, { cursor: 0, tasks: [task('del-1', '要被删掉的事', '2026-10-22T01:00:00.000Z')] })
    await deleteUser(pool, 'admin1@example.com')
    const [left] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM tasks WHERE id = 'del-1'")
    expect(left[0].n).toBe(0)
    expect((await listUsers(pool)).some((u) => u.email === 'admin1@example.com')).toBe(false)
  })

  it('自动生成的初始密码够长、不含容易看错的字符', () => {
    const pw = randomPassword()
    expect(pw).toHaveLength(12)
    expect(pw).not.toMatch(/[0O1lI]/)
    expect(randomPassword()).not.toBe(pw)
  })

  it('连续输错密码会被暂时锁住', async () => {
    await login('lock@example.com')
    const post = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'lock@example.com', password } })
    for (let i = 0; i < 10; i++) expect((await post('wrong-pass')).statusCode).toBe(401)
    expect((await post('secret-123')).statusCode).toBe(429)
  })

  it('伪造 X-Forwarded-For 绕不过登录次数限制', async () => {
    const proxied = buildApp({ pool, trustProxy: 'loopback,uniquelocal' })
    await login('spoof@example.com')
    // 模拟 Nginx 在用户伪造的地址后面追加真实地址，请求来自 Docker 网络里的 Nginx
    const post = (fake: string, password: string) =>
      proxied.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '172.18.0.1',
        headers: { 'x-forwarded-for': `${fake}, 203.0.113.9` },
        payload: { email: 'spoof@example.com', password },
      })
    for (let i = 0; i < 10; i++) expect((await post(`6.6.6.${i}`, 'wrong-pass')).statusCode).toBe(401)
    expect((await post('6.6.6.99', 'secret-123')).statusCode).toBe(429)
    await proxied.close()
  })

  it('修改密码：要验证当前密码，改完其他设备退出', async () => {
    const laptop = await login('pw@example.com', 'laptop')
    const phone = await login('pw@example.com', 'phone')
    const change = (token: string, current: string, next: string) =>
      app.inject({ method: 'POST', url: '/api/auth/password', headers: { authorization: `Bearer ${token}` }, payload: { current, next } })

    expect((await change(laptop, 'wrong-pass', 'new-secret-456')).statusCode).toBe(400)
    expect((await change(laptop, 'secret-123', 'short')).statusCode).toBe(400)
    const ok = await change(laptop, 'secret-123', 'new-secret-456')
    expect(ok.json()).toEqual({ ok: true, signedOut: 1 })

    const me = (token: string) => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })
    expect((await me(laptop)).statusCode).toBe(200)
    expect((await me(phone)).statusCode).toBe(401)

    const loginWith = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'pw@example.com', password } })
    expect((await loginWith('secret-123')).statusCode).toBe(401)
    expect((await loginWith('new-secret-456')).statusCode).toBe(200)
  })

  it('修改密码时猜当前密码也有次数限制', async () => {
    const token = await login('pwlock@example.com')
    const change = (current: string) =>
      app.inject({ method: 'POST', url: '/api/auth/password', headers: { authorization: `Bearer ${token}` }, payload: { current, next: 'new-secret-456' } })
    for (let i = 0; i < 10; i++) expect((await change('wrong-pass')).statusCode).toBe(400)
    expect((await change('secret-123')).statusCode).toBe(429)
  })

  it('30 天没用的登录自动失效', async () => {
    const token = await login('idle@example.com')
    const me = () => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })
    expect((await me()).statusCode).toBe(200)
    await pool.query("UPDATE sessions SET last_seen = NOW() - INTERVAL 31 DAY WHERE user_id = (SELECT id FROM users WHERE email = 'idle@example.com')")
    const res = await me()
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toContain('30 天')
    // 失效的登录会被删掉，之后再用也是 401
    expect((await me()).statusCode).toBe(401)
  })

  it('没登录不能同步', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('两台设备之间同步，后写者胜', async () => {
    const laptop = await login('b@example.com', 'laptop')
    const phone = await login('b@example.com', 'phone')

    const r1 = await sync(laptop, { cursor: 0, tasks: [task('t1', '买菜', '2026-10-22T01:00:00.000Z')] })
    expect(r1.tasks).toHaveLength(1)

    // 手机拉到电脑上的改动
    const r2 = await sync(phone, { cursor: 0 })
    expect(r2.tasks.map((t: { title: string }) => t.title)).toEqual(['买菜'])

    // 手机改了标题；电脑上同时有一个更早的修改，应当被丢弃
    await sync(phone, { cursor: r2.cursor, tasks: [task('t1', '买菜和水果', '2026-10-22T02:00:00.000Z')] })
    const r3 = await sync(laptop, { cursor: r1.cursor, tasks: [task('t1', '买肉', '2026-10-22T01:30:00.000Z')] })
    expect(r3.tasks.map((t: { title: string }) => t.title)).toEqual(['买菜和水果'])

    // 每日记录
    const r4 = await sync(laptop, {
      cursor: r3.cursor,
      days: [{ date: '2026-10-22', note: '不错', closedAt: null, updatedAt: '2026-10-22T03:00:00.000Z' }],
    })
    const r5 = await sync(phone, { cursor: r2.cursor })
    expect(r5.days).toEqual([{ date: '2026-10-22', note: '不错', closedAt: null, updatedAt: '2026-10-22T03:00:00.000Z' }])

    // 游标之后没有新变化时，什么也不返回
    const r6 = await sync(laptop, { cursor: r4.cursor })
    expect(r6).toEqual({ cursor: r4.cursor, tasks: [], days: [], meetings: [] })
  })

  it('会议同步：整场会议（含记录）后写者胜，旧客户端不传会议也照常同步', async () => {
    const laptop = await login('m@example.com', 'laptop')
    const phone = await login('m@example.com', 'phone')
    const meeting = (title: string, updatedAt: string, notes: object[] = []) => ({
      id: 'm1',
      title,
      date: '2026-10-22',
      notes,
      updatedAt,
      deletedAt: null,
    })

    const r1 = await sync(laptop, { cursor: 0, meetings: [meeting('产品周会', '2026-10-22T01:00:00.000Z')] })
    expect(r1.meetings).toHaveLength(1)

    const r2 = await sync(phone, { cursor: 0 })
    expect(r2.meetings.map((m: { title: string }) => m.title)).toEqual(['产品周会'])

    // 手机上记了一条；电脑上更早的改名被丢弃
    const note = { id: 'n1', type: 'decision', text: '埋点沿用旧版' }
    await sync(phone, { cursor: r2.cursor, meetings: [meeting('产品周会', '2026-10-22T02:00:00.000Z', [note])] })
    const r3 = await sync(laptop, { cursor: r1.cursor, meetings: [meeting('周会', '2026-10-22T01:30:00.000Z')] })
    expect(r3.meetings).toEqual([meeting('产品周会', '2026-10-22T02:00:00.000Z', [note])])

    // 只传任务的旧版本客户端
    const r4 = await sync(laptop, { cursor: r3.cursor, tasks: [task('t9', '买菜', '2026-10-22T03:00:00.000Z')] })
    expect(r4.tasks).toHaveLength(1)
    expect(r4.meetings).toEqual([])
  })

  it('会议允许比任务大，但也有上限', async () => {
    const token = await login('big@example.com')
    const notes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'n' + i, text: '一条比较长的会议记录'.repeat(4) }))
    const post = (count: number) =>
      app.inject({
        method: 'POST',
        url: '/api/sync',
        headers: { authorization: `Bearer ${token}` },
        payload: { meetings: [{ id: 'm1', notes: notes(count), updatedAt: '2026-10-22T01:00:00.000Z' }] },
      })
    expect((await post(600)).statusCode).toBe(200)
    expect((await post(10000)).statusCode).toBe(400)
  })

  it('账户之间互相看不到数据', async () => {
    const other = await login('c@example.com')
    const res = await sync(other, { cursor: 0 })
    expect(res.tasks).toEqual([])
  })

  it('拒绝格式不对的数据', async () => {
    const token = await login('d@example.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { authorization: `Bearer ${token}` },
      payload: { tasks: [{ id: '../x', updatedAt: 'yesterday' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('退出登录后令牌失效', async () => {
    const token = await login('e@example.com')
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
  })
})
