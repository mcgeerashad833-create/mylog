import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Pool } from './db.ts'

// 账号只能由管理员在服务器上创建（见 server/admin.ts），应用里没有注册入口

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/** 去掉首尾空格、转小写；格式不对返回 null */
export function normalizeEmail(v: unknown): string | null {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return EMAIL_RE.test(email) ? email : null
}

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

/** 账号不存在时也拿它算一遍，避免靠响应时间判断邮箱有没有账号 */
export const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`

/** 生成初始密码：12 位，去掉容易看错的 0 O 1 l I */
export function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('')
}

function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(`密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`)
  }
}

export async function createUser(pool: Pool, emailInput: string, password: string): Promise<number> {
  const email = normalizeEmail(emailInput)
  if (!email) throw new Error('邮箱格式不对')
  checkPassword(password)
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email])
  if (rows.length) throw new Error(`${email} 已经有账号了；要改密码请用 reset-password`)
  const [res] = await pool.query<ResultSetHeader>('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
    email,
    await hashPassword(password),
  ])
  return res.insertId
}

/** 重置密码，并让这个账号在所有设备上退出登录 */
export async function resetPassword(pool: Pool, emailInput: string, password: string): Promise<void> {
  const email = normalizeEmail(emailInput)
  if (!email) throw new Error('邮箱格式不对')
  checkPassword(password)
  const [res] = await pool.query<ResultSetHeader>('UPDATE users SET password_hash = ? WHERE email = ?', [
    await hashPassword(password),
    email,
  ])
  if (!res.affectedRows) throw new Error(`没有 ${email} 这个账号`)
  await pool.query('DELETE s FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?', [email])
}

export interface UserSummary {
  email: string
  createdAt: Date
  devices: number
  lastSeen: Date | null
}

export async function listUsers(pool: Pool): Promise<UserSummary[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.email, u.created_at, COUNT(s.id) AS devices, MAX(s.last_seen) AS last_seen
     FROM users u LEFT JOIN sessions s ON s.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at`,
  )
  return rows.map((r) => ({
    email: r.email,
    createdAt: new Date(r.created_at),
    devices: Number(r.devices),
    lastSeen: r.last_seen ? new Date(r.last_seen) : null,
  }))
}

/** 删除账号和它的全部数据（任务、日志、会议、登录记录都会一起删掉） */
export async function deleteUser(pool: Pool, emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput)
  if (!email) throw new Error('邮箱格式不对')
  const [res] = await pool.query<ResultSetHeader>('DELETE FROM users WHERE email = ?', [email])
  if (!res.affectedRows) throw new Error(`没有 ${email} 这个账号`)
}
