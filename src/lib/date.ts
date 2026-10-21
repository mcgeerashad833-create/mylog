// 日期统一用本地时区的 "YYYY-MM-DD" 字符串，便于比较和同步。

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const pad = (n: number) => (n < 10 ? '0' + n : String(n))

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(now = new Date()): string {
  return toKey(now)
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((fromKey(a).getTime() - fromKey(b).getTime()) / 86400000)
}

export function weekday(key: string): string {
  return WEEKDAYS[fromKey(key).getDay()]
}

/** 10月21日 周三 */
export function longLabel(key: string): string {
  const d = fromKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekday(key)}`
}

/** 相对今天的友好叫法：今天 / 明天 / 后天 / 周五 / 11月5日 */
export function relativeLabel(key: string, today: string): string {
  const n = diffDays(key, today)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '后天'
  if (n === -1) return '昨天'
  if (n > 2 && n < 7) return weekday(key)
  const d = fromKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function nowHM(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}
