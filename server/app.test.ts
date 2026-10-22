import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import type { RowDataPacket } from 'mysql2/promise'
import { createPool, migrate, type Pool } from './db.ts'

// 需要一个空的测试库；连不上就跳过（例如没有装 MySQL 的环境）
const URL = process.env.TEST_DATABASE_URL ?? 'mysql://mylog:mylog_dev@localhost:3306/mylog_test'

const pool: Pool = createPool(URL)
let app: ReturnType<typeof buildApp>

const available = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false)

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
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'secret-123', device } })
  if (res.statusCode === 200) return res.json().token as string
  const again = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'secret-123', device } })
  return again.json().token as string
}

function sync(token: string, payload: object) {
  return app
    .inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}` }, payload })
    .then((r) => r.json())
}

const task = (id: string, title: string, updatedAt: string) => ({ id, title, updatedAt, deletedAt: null })

describe.skipIf(!available)('服务端', () => {
  it('邮箱密码注册与登录', async () => {
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })

    expect((await post('/api/auth/register', { email: 'not-an-email', password: 'secret-123' })).statusCode).toBe(400)
    expect((await post('/api/auth/register', { email: 'a@example.com', password: 'short' })).statusCode).toBe(400)

    const reg = await post('/api/auth/register', { email: 'A@Example.com ', password: 'secret-123', device: 'MacBook' })
    expect(reg.statusCode).toBe(200)
    expect(reg.json().email).toBe('a@example.com')

    const dup = await post('/api/auth/register', { email: 'a@example.com', password: 'another-123' })
    expect(dup.statusCode).toBe(409)

    const wrong = await post('/api/auth/login', { email: 'a@example.com', password: 'wrong-pass' })
    expect(wrong.statusCode).toBe(401)
    const nobody = await post('/api/auth/login', { email: 'nobody@example.com', password: 'secret-123' })
    expect(nobody.statusCode).toBe(401)
    expect(nobody.json().error).toBe(wrong.json().error)

    const ok = await post('/api/auth/login', { email: 'a@example.com', password: 'secret-123', device: 'iPhone' })
    expect(ok.statusCode).toBe(200)

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${ok.json().token}` } })
    expect(me.json().email).toBe('a@example.com')
    expect(me.json().sessions).toHaveLength(2)
    expect(me.json().sessions.find((s: { current: boolean }) => s.current).device).toBe('iPhone')

    // 数据库里不存明文密码
    const [rows] = await pool.query<RowDataPacket[]>('SELECT password_hash FROM users WHERE email = ?', ['a@example.com'])
    expect(rows[0].password_hash).toMatch(/^scrypt\$/)
    expect(rows[0].password_hash).not.toContain('secret-123')
  })

  it('连续输错密码会被暂时锁住', async () => {
    await login('lock@example.com')
    const post = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'lock@example.com', password } })
    for (let i = 0; i < 10; i++) expect((await post('wrong-pass')).statusCode).toBe(401)
    expect((await post('secret-123')).statusCode).toBe(429)
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
