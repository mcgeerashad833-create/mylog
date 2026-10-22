import { addDays, fromKey } from './date'

export type Repeat =
  | { kind: 'daily' }
  /** 周一到周五 */
  | { kind: 'weekdays' }
  /** days：0=周日 … 6=周六 */
  | { kind: 'weekly'; days: number[] }
  /** day：1–31，当月没有这一天时取月末 */
  | { kind: 'monthly'; day: number }

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

function matches(r: Repeat, key: string): boolean {
  const d = fromKey(key)
  switch (r.kind) {
    case 'daily':
      return true
    case 'weekdays':
      return d.getDay() >= 1 && d.getDay() <= 5
    case 'weekly':
      return r.days.includes(d.getDay())
    case 'monthly': {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      return d.getDate() === Math.min(r.day, last)
    }
  }
}

/** from 当天或之后第一个符合规则的日期 */
export function firstOnOrAfter(r: Repeat, from: string): string {
  if (r.kind === 'weekly' && r.days.length === 0) return from
  // 最长的周期是一个月，往后看 62 天一定能找到
  for (let i = 0; i < 62; i++) {
    const key = addDays(from, i)
    if (matches(r, key)) return key
  }
  return from
}

/** 严格晚于 after 的下一个日期 */
export function nextAfter(r: Repeat, after: string): string {
  return firstOnOrAfter(r, addDays(after, 1))
}

export function repeatLabel(r: Repeat): string {
  switch (r.kind) {
    case 'daily':
      return '每天'
    case 'weekdays':
      return '每个工作日'
    case 'weekly': {
      // 按周一到周日的顺序显示
      const sorted = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      return sorted.length === 7 ? '每天' : '每周' + sorted.map((d) => DAY_NAMES[d]).join('、')
    }
    case 'monthly':
      return `每月 ${r.day} 号`
  }
}
