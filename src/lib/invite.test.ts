import { describe, expect, it } from 'vitest'
import { formatMeetingNo, looksLikeInvite, parseInvite } from './invite'

const INVITE = `张三 邀请您参加腾讯会议
会议主题：产品周会
会议时间：2026/10/22 10:00-11:00 (GMT+08:00) 中国标准时间 - 北京

点击链接入会，或添加至会议列表：
https://meeting.tencent.com/dm/AbC123xyz

#腾讯会议：123-456-789
会议密码：2468`

describe('parseInvite', () => {
  it('识别完整邀请', () => {
    expect(parseInvite(INVITE)).toEqual({
      title: '产品周会',
      date: '2026-10-22',
      start: '10:00',
      end: '11:00',
      meetingNo: '123456789',
      password: '2468',
      link: 'https://meeting.tencent.com/dm/AbC123xyz',
    })
  })

  it('中文日期、空格分隔的会议号、没有密码', () => {
    const inv = parseInvite('会议主题：设计评审\n会议时间：2026年10月23日 9:30 - 10:15\n腾讯会议：789 123 456')
    expect(inv).toMatchObject({ title: '设计评审', date: '2026-10-23', start: '09:30', end: '10:15', meetingNo: '789123456' })
    expect(inv.password).toBeUndefined()
  })

  it('跨天的会议时间取结束时刻', () => {
    const inv = parseInvite('会议时间：2026/10/22 23:00-2026/10/23 00:30')
    expect(inv).toMatchObject({ date: '2026-10-22', start: '23:00', end: '00:30' })
  })

  it('只有开始时间', () => {
    expect(parseInvite('会议时间：2026/10/22 14:00 (GMT+08:00)')).toMatchObject({ start: '14:00' })
  })

  it('周期性会议', () => {
    expect(parseInvite('会议主题：周会\n重复周期：每周四').repeat).toBe('weekly')
    expect(parseInvite('重复周期：每两周 (周四)').repeat).toBe('biweekly')
    expect(parseInvite('重复：每 2 周').repeat).toBe('biweekly')
  })

  it('普通文字什么都识别不出', () => {
    expect(parseInvite('明天下午3点 给物业打电话')).toEqual({})
  })
})

describe('looksLikeInvite', () => {
  it('邀请文字', () => expect(looksLikeInvite(INVITE)).toBe(true))
  it('普通待办', () => expect(looksLikeInvite('周五 交周报 #工作')).toBe(false))
})

it('formatMeetingNo', () => {
  expect(formatMeetingNo('123456789')).toBe('123 456 789')
  expect(formatMeetingNo('1234567890')).toBe('1234567890')
})
