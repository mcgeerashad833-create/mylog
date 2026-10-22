import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { createPool, migrate, type Pool } from './db.ts'

// 需要一个空的测试库；连不上就跳过（例如没有装 MySQL 的环境）
const URL = process.env.TEST_DATABASE_URL ?? 'mysql://mylog:mylog_dev@localhost:3306/mylog_test'

const pool: Pool = createPool(URL)
const codes = new Map<string, string>()
let app: ReturnType<typeof buildApp>

const available = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false)

beforeAll(async () => {
  if (!available) return
  await pool.query('DROP TABLE IF EXISTS tasks, days, sessions, login_codes, users')
  await migrate(pool)
  app = buildApp({ pool, sendCode: async (email, code) => void codes.set(email, code) })
})

afterAll(async () => {
  await app?.close()
  await pool.end()
})

async function login(email: string, device = 'test') {
  await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email } })
  const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { email, code: codes.get(email), device } })
  return res.json().token as string
}

function sync(token: string, payload: object) {
  return app
    .inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}` }, payload })
    .then((r) => r.json())
}

const task = (id: string, title: string, updatedAt: string) => ({ id, title, updatedAt, deletedAt: null })

describe.skipIf(!available)('服务端', () => {
  it('邮箱验证码登录', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email: 'not-an-email' } })
    expect(bad.statusCode).toBe(400)

    await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email: 'A@Example.com ' } })
    expect(codes.get('a@example.com')).toMatch(/^\d{6}$/)

    const again = await app.inject({ method: 'POST', url: '/api/auth/code', payload: { email: 'a@example.com' } })
    expect(again.statusCode).toBe(429)

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { email: 'a@example.com', code: '000000x' } })
    expect(wrong.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'a@example.com', code: codes.get('a@example.com'), device: 'MacBook' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().email).toBe('a@example.com')

    // 验证码只能用一次
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'a@example.com', code: codes.get('a@example.com') },
    })
    expect(reuse.statusCode).toBe(400)

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${ok.json().token}` } })
    expect(me.json()).toMatchObject({ email: 'a@example.com', sessions: [{ device: 'MacBook', current: true }] })
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
    expect(r6).toEqual({ cursor: r4.cursor, tasks: [], days: [] })
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
