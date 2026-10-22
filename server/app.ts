import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto'
import { existsSync } from 'node:fs'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Pool } from './db.ts'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const LOGIN_MAX_FAILURES = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_RECORDS = 5000
const MAX_RECORD_BYTES = 64 * 1024

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
const ID_RE = /^[\w-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const scrypt = (pw: BinaryLike, salt: BinaryLike) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, 32, (err, key) => (err ? reject(err) : resolve(key))))

/** 存储格式：scrypt$<salt hex>$<hash hex> */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hash) return false
  const key = await scrypt(pw, Buffer.from(salt, 'hex'))
  const expected = Buffer.from(hash, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`

/** 登录失败计数（按邮箱 + IP），单进程内存即可 */
function failureCounter() {
  const map = new Map<string, { n: number; since: number }>()
  return {
    blocked(key: string) {
      const e = map.get(key)
      if (e && Date.now() - e.since > LOGIN_WINDOW_MS) map.delete(key)
      return (map.get(key)?.n ?? 0) >= LOGIN_MAX_FAILURES
    },
    add(key: string) {
      const e = map.get(key)
      if (e) e.n += 1
      else map.set(key, { n: 1, since: Date.now() })
    },
    clear(key: string) {
      map.delete(key)
    },
  }
}

interface Options {
  pool: Pool
  /** 打包后的前端目录；存在时一并托管 */
  staticDir?: string
  logger?: boolean
  /**
   * 信任哪些代理转发来的 X-Forwarded-For，例如 'loopback,uniquelocal'。
   * 不能用 true：那样会信任请求头里的所有地址，用户自己伪造一个 IP 就能绕过登录次数限制。
   */
  trustProxy?: string | false
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Rec {
  updatedAt: string
  [k: string]: unknown
}

export function buildApp({ pool, staticDir, logger = false, trustProxy = false }: Options) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024, trustProxy })
  const failures = failureCounter()

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message })
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message })
    app.log.error(err)
    return reply.status(500).send({ error: '服务器出错了，请稍后再试' })
  })

  async function auth(req: FastifyRequest): Promise<{ userId: number; sessionId: number }> {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (!m) throw new HttpError(401, '请先登录')
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, user_id FROM sessions WHERE token_hash = ?', [sha256(m[1])])
    if (!rows.length) throw new HttpError(401, '登录已失效，请重新登录')
    await pool.query('UPDATE sessions SET last_seen = ? WHERE id = ?', [new Date(), rows[0].id])
    return { userId: rows[0].user_id, sessionId: rows[0].id }
  }

  function normEmail(v: unknown): string {
    const email = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不对')
    return email
  }

  // ---- 登录 ----

  function readCredentials(body: unknown) {
    const b = (body ?? {}) as { email?: unknown; password?: unknown; device?: unknown }
    const email = normEmail(b.email)
    const password = typeof b.password === 'string' ? b.password : ''
    const device = typeof b.device === 'string' ? b.device.slice(0, 100) : ''
    return { email, password, device }
  }

  async function createSession(userId: number, device: string) {
    const token = randomBytes(32).toString('base64url')
    await pool.query('INSERT INTO sessions (token_hash, user_id, device) VALUES (?, ?, ?)', [sha256(token), userId, device])
    return token
  }

  app.post('/api/auth/register', async (req) => {
    const { email, password, device } = readCredentials(req.body)
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new HttpError(400, `密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`)
    }
    const hash = await hashPassword(password)
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, password_hash FROM users WHERE email = ?', [email])
    let userId: number
    if (!rows.length) {
      const [res] = await pool.query<ResultSetHeader>('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, hash])
      userId = res.insertId
    } else if (rows[0].password_hash === '') {
      // 早期验证码版本留下的账户还没有密码，允许补设一次
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, rows[0].id])
      userId = rows[0].id
    } else {
      throw new HttpError(409, '这个邮箱已经注册过了，请直接登录')
    }
    return { token: await createSession(userId, device), email }
  })

  app.post('/api/auth/login', async (req) => {
    const { email, password, device } = readCredentials(req.body)
    const limitKey = `${email}|${req.ip}`
    if (failures.blocked(limitKey)) throw new HttpError(429, '尝试次数太多，请 15 分钟后再试')
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, password_hash FROM users WHERE email = ?', [email])
    // 账户不存在时也走一遍哈希，避免靠响应时间判断邮箱是否注册过
    const ok = await verifyPassword(password, rows[0]?.password_hash || DUMMY_HASH)
    if (!rows.length || !ok) {
      failures.add(limitKey)
      throw new HttpError(401, '邮箱或密码不对')
    }
    failures.clear(limitKey)
    return { token: await createSession(rows[0].id, device), email }
  })

  app.post('/api/auth/logout', async (req) => {
    const { sessionId } = await auth(req)
    await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId])
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    const { userId, sessionId } = await auth(req)
    const [users] = await pool.query<RowDataPacket[]>('SELECT email FROM users WHERE id = ?', [userId])
    const [sessions] = await pool.query<RowDataPacket[]>(
      'SELECT id, device, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC',
      [userId],
    )
    return {
      email: users[0].email,
      sessions: sessions.map((s) => ({
        id: s.id,
        device: s.device,
        createdAt: new Date(s.created_at).toISOString(),
        lastSeen: new Date(s.last_seen).toISOString(),
        current: s.id === sessionId,
      })),
    }
  })

  app.delete('/api/sessions/:id', async (req) => {
    const { userId } = await auth(req)
    const id = Number((req.params as { id: string }).id)
    await pool.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId])
    return { ok: true }
  })

  // ---- 同步 ----

  function checkRecords(list: unknown, key: 'id' | 'date'): Rec[] {
    if (list === undefined) return []
    if (!Array.isArray(list) || list.length > MAX_RECORDS) throw new HttpError(400, '同步数据格式不对')
    for (const r of list) {
      const k = r?.[key]
      if (typeof k !== 'string' || !(key === 'id' ? ID_RE : DATE_RE).test(k)) throw new HttpError(400, '同步数据格式不对')
      if (typeof r.updatedAt !== 'string' || !ISO_RE.test(r.updatedAt)) throw new HttpError(400, '同步数据格式不对')
      if (JSON.stringify(r).length > MAX_RECORD_BYTES) throw new HttpError(400, '单条记录太大')
    }
    return list as Rec[]
  }

  /** 后写者胜：只有比服务器上更新的记录才写入，并分配新的 seq */
  async function upsert(conn: PoolConnection, table: 'tasks' | 'days', userId: number, recs: Rec[], seq: number) {
    const key = table === 'tasks' ? 'id' : 'date'
    for (const r of recs) {
      const [cur] = await conn.query<RowDataPacket[]>(
        `SELECT updated_at FROM ${table} WHERE user_id = ? AND ${key} = ?`,
        [userId, r[key]],
      )
      if (cur.length && cur[0].updated_at >= r.updatedAt) continue
      seq += 1
      await conn.query<ResultSetHeader>(
        `INSERT INTO ${table} (user_id, ${key}, data, updated_at, seq) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at), seq = VALUES(seq)`,
        [userId, r[key], JSON.stringify(r), r.updatedAt, seq],
      )
    }
    return seq
  }

  app.post('/api/sync', async (req) => {
    const { userId } = await auth(req)
    const body = (req.body ?? {}) as { cursor?: unknown; tasks?: unknown; days?: unknown }
    const cursor = Number.isInteger(body.cursor) ? (body.cursor as number) : 0
    const tasks = checkRecords(body.tasks, 'id')
    const days = checkRecords(body.days, 'date')

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      // 锁住用户行，同一账户的多台设备同时同步时依次进行
      const [u] = await conn.query<RowDataPacket[]>('SELECT seq FROM users WHERE id = ? FOR UPDATE', [userId])
      let seq = Number(u[0].seq)
      seq = await upsert(conn, 'tasks', userId, tasks, seq)
      seq = await upsert(conn, 'days', userId, days, seq)
      await conn.query('UPDATE users SET seq = ? WHERE id = ?', [seq, userId])
      const [outTasks] = await conn.query<RowDataPacket[]>(
        'SELECT data FROM tasks WHERE user_id = ? AND seq > ? ORDER BY seq',
        [userId, cursor],
      )
      const [outDays] = await conn.query<RowDataPacket[]>(
        'SELECT data FROM days WHERE user_id = ? AND seq > ? ORDER BY seq',
        [userId, cursor],
      )
      await conn.commit()
      const parse = (d: unknown) => (typeof d === 'string' ? JSON.parse(d) : d)
      return { cursor: seq, tasks: outTasks.map((r) => parse(r.data)), days: outDays.map((r) => parse(r.data)) }
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })

  app.get('/api/health', async () => ({ ok: true }))

  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir })
    // 前端是单页应用，未知路径都回到 index.html
    app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
