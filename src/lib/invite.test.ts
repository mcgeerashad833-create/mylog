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

  it('周期性会议：重复周期里先写日期范围、时间', () => {
    const inv = parseInvite('会议时间：2026/10/22 15:00-16:00\n重复周期：2026/10/22-2026/12/31 15:00-16:00, 每周 (周四)')
    expect(inv).toMatchObject({ date: '2026-10-22', start: '15:00', end: '16:00', repeat: 'weekly' })
    expect(parseInvite('重复周期：2026/10/22-2026/12/31 15:00-16:00, 每两周 (周四)').repeat).toBe('biweekly')
  })

  it('周期性会议：会议时间是日期范围，下一行单独写「每周 (周四)」', () => {
    const inv = parseInvite('会议主题：周会\n会议时间：2026/10/22-2026/12/31 15:00-16:00 (GMT+08:00) 中国标准时间\n每周 (周四)')
    expect(inv).toEqual({ title: '周会', date: '2026-10-22', start: '15:00', end: '16:00', repeat: 'weekly' })
  })

  it('公司内部的会议通知：没有「会议主题」，时间另起一行', () => {
    const notice = `平台部组织AI Coding经验交流会，平台部在五矿供销存项目交付中全面应用AI Coding，目前项目已在两总部上线。

    请开发人员及感兴趣人员积极参会。

         会议时间
  2026 年 10 月 22 日（周四）晚上 19:00-20:30

会议方式

  本次会议全程采用腾讯会议线上方式进行，各参会人员自行远程接入。

  会议链接：https://meeting.tencent.com/dm/Ug7psHmjWYDr

  腾讯会议：760-664-511

  会议密码：300996`
    expect(looksLikeInvite(notice)).toBe(true)
    expect(parseInvite(notice)).toEqual({
      title: 'AI Coding经验交流会',
      date: '2026-10-22',
      start: '19:00',
      end: '20:30',
      meetingNo: '760664511',
      password: '300996',
      link: 'https://meeting.tencent.com/dm/Ug7psHmjWYDr',
    })
  })

  it('通知里的 12 小时制时间：下午 3:00、晚上 7:30', () => {
    expect(parseInvite('会议时间：2026年10月23日 下午 3:00-4:30')).toMatchObject({ start: '15:00', end: '16:30' })
    expect(parseInvite('会议时间：2026年10月23日（周五）晚上7:30-9:00')).toMatchObject({ date: '2026-10-23', start: '19:30', end: '21:00' })
  })

  it('从通知标题里找会议名', () => {
    expect(parseInvite('关于召开2026年第四季度安全生产会议的通知\n会议时间：2026/10/23 9:00').title).toBe('2026年第四季度安全生产会议')
    expect(parseInvite('定于本周五举办前端性能优化分享，欢迎参加\n会议时间：2026/10/23 15:00').title).toBe('前端性能优化分享')
  })

  it('正文里随口提到「每周」不算周期会议', () => {
    expect(parseInvite('会议主题：讨论每周例会怎么开\n会议时间：2026/10/22 15:00-16:00').repeat).toBeUndefined()
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
