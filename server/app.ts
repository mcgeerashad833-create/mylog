import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Pool } from './db.ts'
import type { SendCode } from './mail.ts'

const CODE_TTL_MS = 10 * 60 * 1000
const CODE_RESEND_MS = 60 * 1000
const CODE_MAX_ATTEMPTS = 5
const MAX_RECORDS = 5000
const MAX_RECORD_BYTES = 64 * 1024

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
const ID_RE = /^[\w-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

interface Options {
  pool: Pool
  sendCode: SendCode
  /** 打包后的前端目录；存在时一并托管 */
  staticDir?: string
  logger?: boolean
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

export function buildApp({ pool, sendCode, staticDir, logger = false }: Options) {
  const app = Fastify({ logger, bodyLimit: 8 * 1024 * 1024 })

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

  app.post('/api/auth/code', async (req) => {
    const email = normEmail((req.body as { email?: unknown })?.email)
    const [rows] = await pool.query<RowDataPacket[]>('SELECT sent_at FROM login_codes WHERE email = ?', [email])
    if (rows.length && Date.now() - new Date(rows[0].sent_at).getTime() < CODE_RESEND_MS) {
      throw new HttpError(429, '发送太频繁，请一分钟后再试')
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const now = new Date()
    await pool.query(
      `INSERT INTO login_codes (email, code_hash, attempts, sent_at, expires_at) VALUES (?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0, sent_at = VALUES(sent_at), expires_at = VALUES(expires_at)`,
      [email, sha256(email + ':' + code), now, new Date(now.getTime() + CODE_TTL_MS)],
    )
    await sendCode(email, code)
    return { ok: true }
  })

  app.post('/api/auth/verify', async (req) => {
    const body = (req.body ?? {}) as { email?: unknown; code?: unknown; device?: unknown }
    const email = normEmail(body.email)
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const device = typeof body.device === 'string' ? body.device.slice(0, 100) : ''

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM login_codes WHERE email = ?', [email])
    const row = rows[0]
    if (!row || new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(400, '验证码已过期，请重新获取')
    if (row.attempts >= CODE_MAX_ATTEMPTS) throw new HttpError(429, '错误次数太多，请重新获取验证码')
    const ok = timingSafeEqual(Buffer.from(sha256(email + ':' + code)), Buffer.from(row.code_hash))
    if (!ok) {
      await pool.query('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?', [email])
      throw new HttpError(400, '验证码不对')
    }
    await pool.query('DELETE FROM login_codes WHERE email = ?', [email])
    await pool.query('INSERT IGNORE INTO users (email) VALUES (?)', [email])
    const [users] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email])
    const token = randomBytes(32).toString('base64url')
    await pool.query('INSERT INTO sessions (token_hash, user_id, device) VALUES (?, ?, ?)', [sha256(token), users[0].id, device])
    return { token, email }
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
