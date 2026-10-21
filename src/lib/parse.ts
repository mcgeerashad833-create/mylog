import { addDays, fromKey, relativeLabel } from './date'

export interface Parsed {
  title: string
  /** YYYY-MM-DD；没写日期时为 undefined */
  date?: string
  /** HH:mm */
  time?: string
  star: boolean
  tag?: string
  /** 用于在输入框下方展示「识别到」的小标签 */
  chips: string[]
}

const DAY_INDEX: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function resolveWeekday(today: string, target: number, nextWeek: boolean): string {
  const cur = fromKey(today).getDay()
  // 把周一当作一周的开始
  const curMon = (cur + 6) % 7
  const tgtMon = (target + 6) % 7
  let delta = tgtMon - curMon
  if (nextWeek) delta += 7
  else if (delta < 0) delta += 7
  return addDays(today, delta)
}

/**
 * 解析快速添加里的一句话，例如「明天下午3点 给物业打电话 !」。
 * 支持：今天/明天/后天/周X/下周X、上午/下午/晚上 N点[半|MM]、HH:MM、! 标重要、#标签。
 */
export function parseQuickAdd(input: string, today: string): Parsed {
  let s = input
  const out: Parsed = { title: '', star: false, chips: [] }

  const d = s.match(/(下周|周|星期)([一二三四五六日天])|今天|明天|后天/)
  if (d) {
    const word = d[0]
    if (word === '今天') out.date = today
    else if (word === '明天') out.date = addDays(today, 1)
    else if (word === '后天') out.date = addDays(today, 2)
    else out.date = resolveWeekday(today, DAY_INDEX[d[2]], d[1] === '下周')
    s = s.replace(word, ' ')
  }

  const t = s.match(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*(?:点|:|：)\s*(半|\d{2})?(?:分)?/)
  if (t) {
    let h = parseInt(t[2], 10)
    const period = t[1]
    if ((period === '下午' || period === '晚上') && h < 12) h += 12
    if (period === '中午' && h < 6) h += 12
    if (h <= 23) {
      const m = t[3] === '半' ? '30' : t[3] ?? '00'
      if (Number(m) < 60) {
        out.time = `${h < 10 ? '0' + h : h}:${m}`
        s = s.replace(t[0], ' ')
      }
    }
  }

  if (/[!！]/.test(s)) {
    out.star = true
    s = s.replace(/[!！]/g, ' ')
  }

  const g = s.match(/[#＃](\S+)/)
  if (g) {
    out.tag = g[1]
    s = s.replace(g[0], ' ')
  }

  out.title = s.replace(/\s+/g, ' ').trim()

  if (out.date) out.chips.push(relativeLabel(out.date, today))
  if (out.time) out.chips.push(out.time)
  if (out.star) out.chips.push('重要')
  if (out.tag) out.chips.push('#' + out.tag)
  return out
}
