import { describe, expect, it } from 'vitest'
import { firstOnOrAfter, nextAfter, repeatLabel } from './repeat'

// 2026-10-21 是周三
describe('重复规则', () => {
  it('每天', () => {
    expect(nextAfter({ kind: 'daily' }, '2026-10-21')).toBe('2026-10-22')
  })

  it('每个工作日跳过周末', () => {
    expect(nextAfter({ kind: 'weekdays' }, '2026-10-23')).toBe('2026-10-26')
    expect(firstOnOrAfter({ kind: 'weekdays' }, '2026-10-24')).toBe('2026-10-26')
  })

  it('每周几', () => {
    const r = { kind: 'weekly' as const, days: [1, 3, 5] }
    expect(nextAfter(r, '2026-10-21')).toBe('2026-10-23')
    expect(nextAfter(r, '2026-10-23')).toBe('2026-10-26')
    expect(firstOnOrAfter(r, '2026-10-21')).toBe('2026-10-21')
  })

  it('每月几号，没有这一天时取月末', () => {
    expect(nextAfter({ kind: 'monthly', day: 21 }, '2026-10-21')).toBe('2026-11-21')
    expect(nextAfter({ kind: 'monthly', day: 31 }, '2026-10-31')).toBe('2026-11-30')
    expect(nextAfter({ kind: 'monthly', day: 30 }, '2027-01-30')).toBe('2027-02-28')
  })

  it('文字说明', () => {
    expect(repeatLabel({ kind: 'weekly', days: [5, 1] })).toBe('每周一、五')
    expect(repeatLabel({ kind: 'monthly', day: 21 })).toBe('每月 21 号')
  })
})
