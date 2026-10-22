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
  else {
    // 公司内部通知常常没有「会议主题」，会议名写在「关于召开…的通知」或「组织/举办…会」里
    const name =
      text.match(/关于(?:召开|举办|组织|举行|开展)?(.{2,40}?)的通知/) ??
      text.match(/(?:组织|召开|举办|举行|开展)(?:一场|一次|一期)?([^，。,；;！!\n]{2,30}?(?:会议|会|分享|培训|评审|讨论|沙龙|研讨|讲座|宣讲))/)
    if (name) out.title = name[1].trim()
  }

  const date = String.raw`(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?`
  // 周期性会议的「会议时间」可能是日期范围（2026/10/22-2026/12/31 15:00-16:00），取第一个日期
  const rangeEnd = String.raw`(?:\s*[-–—~至]\s*\d{4}\s*[/\-.年]\s*\d{1,2}\s*[/\-.月]\s*\d{1,2}\s*日?)?`
  // 通知里常见：「会议时间」不带冒号、日期另起一行，日期后面跟「（周四）晚上」
  const weekday = String.raw`(?:[（(]\s*(?:周|星期)[一二三四五六日天]\s*[)）])?`
  const time = text.match(
    new RegExp(
      String.raw`会议时间\s*[:：]?\s*${date}${rangeEnd}\s*${weekday}\s*(上午|早上|中午|下午|晚上)?\s*(\d{1,2}:\d{2})(?:\s*[-–—~至]\s*(?:${date}\s*)?(\d{1,2}:\d{2}))?`,
    ),
  )
  if (time) {
    out.date = `${time[1]}-${pad(Number(time[2]))}-${pad(Number(time[3]))}`
    // 「下午 3:00」「晚上 7:30」这类 12 小时制写法换算成 24 小时制
    const pm = time[4] === '下午' || time[4] === '晚上' || (time[4] === '中午' && Number(time[5].split(':')[0]) < 5)
    const to24 = (s: string) => {
      const [h, m] = s.split(':').map(Number)
      return hm(`${pm && h < 12 ? h + 12 : h}:${pad(m)}`)
    }
    out.start = to24(time[5])
    if (time[9]) out.end = to24(time[9])
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

  // 「重复周期：每周四」「重复周期：2026/10/22-2026/12/31 15:00-16:00, 每周 (周四)」，或者单独一行「每周 (周四)」
  const rep =
    text.match(/重复(?:周期|频率)?\s*[:：][^\n]*?每\s*(两|2|二)?\s*周/) ??
    text.match(/^\s*每\s*(两|2|二)?\s*周\s*[(（]\s*周[一二三四五六日天]/m)
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
