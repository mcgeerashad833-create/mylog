// 识别腾讯会议的邀请文字，例如：
//
//   张三 邀请您参加腾讯会议
//   会议主题：产品周会
//   会议时间：2026/10/22 10:00-11:00 (GMT+08:00) 中国标准时间 - 北京
//   点击链接入会，或添加至会议列表：
//   https://meeting.tencent.com/dm/xxxx
//   #腾讯会议：123-456-789
//   会议密码：2468

const pad = (n: number) => (n < 10 ? '0' + n : String(n))

export interface Invite {
  title?: string
  /** YYYY-MM-DD */
  date?: string
  /** HH:mm */
  start?: string
  end?: string
  /** 只保留数字 */
  meetingNo?: string
  password?: string
  link?: string
  /** 腾讯会议的周期性会议 */
  repeat?: 'weekly' | 'biweekly'
}

function hm(s: string): string {
  const [h, m] = s.split(':')
  return pad(Number(h)) + ':' + m
}

export function parseInvite(text: string): Invite {
  const out: Invite = {}

  const title = text.match(/会议主题\s*[:：]\s*(.+)/)
  if (title) out.title = title[1].trim()

  const date = String.raw`(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?`
  const time = text.match(
    new RegExp(String.raw`会议时间\s*[:：]\s*${date}\s*(\d{1,2}:\d{2})(?:\s*[-–—~至]\s*(?:${date}\s*)?(\d{1,2}:\d{2}))?`),
  )
  if (time) {
    out.date = `${time[1]}-${pad(Number(time[2]))}-${pad(Number(time[3]))}`
    out.start = hm(time[4])
    if (time[8]) out.end = hm(time[8])
  }

  const no = text.match(/(?:腾讯会议|会议号|会议\s*ID)\s*[:：]\s*(\d[\d\s-]{7,14}\d)/i)
  if (no) {
    const digits = no[1].replace(/\D/g, '')
    if (digits.length >= 9 && digits.length <= 12) out.meetingNo = digits
  }

  const pwd = text.match(/会议密码\s*[:：]\s*(\S+)/)
  if (pwd) out.password = pwd[1]

  const link = text.match(/https?:\/\/(?:[\w-]+\.)*(?:meeting\.tencent\.com|voovmeeting\.com)\/[^\s，。]+/)
  if (link) out.link = link[0]

  const rep = text.match(/重复(?:周期|频率)?\s*[:：]\s*每\s*(两|2|二)?\s*周/)
  if (rep) out.repeat = rep[1] ? 'biweekly' : 'weekly'

  return out
}

/** 粘贴的文字像不像一段腾讯会议邀请 */
export function looksLikeInvite(text: string): boolean {
  const inv = parseInvite(text)
  return !!(inv.meetingNo || inv.link) && /腾讯会议|会议主题|会议时间/.test(text)
}

/** 123456789 → 123 456 789；其他位数原样显示 */
export function formatMeetingNo(no: string): string {
  return no.length === 9 ? no.replace(/(\d{3})(?=\d)/g, '$1 ') : no
}
