import { describe, expect, it } from 'vitest'
import type { Meeting } from '../db'
import { fold, toIcs } from './ics'

function meeting(id: string, date: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    title: '产品周会',
    kind: 'hybrid',
    repeat: 'none',
    seriesId: null,
    date,
    start: '10:00',
    end: '11:00',
    location: '3 楼 小会议室',
    meetingNo: '123456789',
    password: '2468',
    link: 'https://meeting.tencent.com/dm/abc',
    remindBefore: 10,
    notes: [],
    prep: [],
    startedAt: null,
    endedAt: null,
    summarizedAt: null,
    remindedAt: null,
    nudgedAt: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...patch,
  }
}

const NOW = new Date('2026-10-22T01:00:00Z')

describe('toIcs', () => {
  it('普通会议', () => {
    const ics = toIcs([meeting('a', '2026-10-22')], NOW)
    // 长行会折行，比较前先展开
    expect(ics.replace(/\r\n /g, '').split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MyLog//Meetings//ZH',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:MyLog 会议',
      'BEGIN:VEVENT',
      'UID:a@mylog',
      'DTSTAMP:20261022T010000Z',
      'DTSTART:20261022T100000',
      'DTEND:20261022T110000',
      'SUMMARY:产品周会',
      'LOCATION:3 楼 小会议室 · 腾讯会议 123 456 789',
      'DESCRIPTION:腾讯会议：123 456 789\\n会议密码：2468\\nhttps://meeting.tencent.com/dm/abc',
      'URL:https://meeting.tencent.com/dm/abc',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:产品周会',
      'TRIGGER:-PT10M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ])
  })

  it('例会：之前的单独导出，最后一次带 RRULE，后面删掉的写成 EXDATE；已删的会不导出', () => {
    const s = { seriesId: 's', repeat: 'biweekly' as const }
    const ics = toIcs(
      [
        meeting('a', '2026-10-08', s),
        meeting('b', '2026-10-22', s),
        meeting('c', '2026-11-05', { ...s, deletedAt: 'x' }),
        meeting('d', '2026-10-23', { deletedAt: 'x' }),
      ],
      NOW,
    )
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).not.toContain('UID:c@mylog')
    expect(ics).not.toContain('UID:d@mylog')
    const b = ics.slice(ics.indexOf('UID:b@mylog'))
    expect(b).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2')
    expect(b).toContain('EXDATE:20261105T100000')
    expect(ics.slice(ics.indexOf('UID:a@mylog'), ics.indexOf('UID:b@mylog'))).not.toContain('RRULE')
  })

  it('特殊字符要转义，不提醒就没有 VALARM', () => {
    const ics = toIcs([meeting('a', '2026-10-22', { title: '评审; 预算, 方案', kind: 'offline', remindBefore: 0 })], NOW)
    expect(ics).toContain('SUMMARY:评审\\; 预算\\, 方案')
    expect(ics).not.toContain('VALARM')
    expect(ics).not.toContain('DESCRIPTION:腾讯会议')
    expect(ics).not.toContain('URL:')
  })
})

it('fold 按字节折行，不拆开汉字', () => {
  const line = 'SUMMARY:' + '会'.repeat(40)
  const folded = fold(line)
  const parts = folded.split('\r\n ')
  expect(parts.length).toBe(2)
  for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
  expect(parts.join('')).toBe(line)
})
