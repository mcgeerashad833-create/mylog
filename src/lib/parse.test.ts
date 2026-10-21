import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './parse'

// 2026-10-21 是周三
const TODAY = '2026-10-21'

describe('parseQuickAdd', () => {
  it('纯文本不识别任何东西', () => {
    const p = parseQuickAdd('取快递', TODAY)
    expect(p).toMatchObject({ title: '取快递', star: false, chips: [] })
    expect(p.date).toBeUndefined()
  })

  it('明天下午3点 + 重要', () => {
    const p = parseQuickAdd('明天下午3点 给物业打电话 !', TODAY)
    expect(p.title).toBe('给物业打电话')
    expect(p.date).toBe('2026-10-22')
    expect(p.time).toBe('15:00')
    expect(p.star).toBe(true)
    expect(p.chips).toEqual(['明天', '15:00', '重要'])
  })

  it('周X 取本周或下一个', () => {
    expect(parseQuickAdd('周五 订票', TODAY).date).toBe('2026-10-23')
    expect(parseQuickAdd('周一 交周报', TODAY).date).toBe('2026-10-26')
    expect(parseQuickAdd('周三 开会', TODAY).date).toBe(TODAY)
  })

  it('下周X', () => {
    expect(parseQuickAdd('下周五 体检', TODAY).date).toBe('2026-10-30')
  })

  it('时间写法', () => {
    expect(parseQuickAdd('开会 14:30', TODAY).time).toBe('14:30')
    expect(parseQuickAdd('晚上8点半 跑步', TODAY).time).toBe('20:30')
    expect(parseQuickAdd('上午10点 面试', TODAY).time).toBe('10:00')
  })

  it('标签与全角符号', () => {
    const p = parseQuickAdd('订高铁票 ＃出差 ！', TODAY)
    expect(p).toMatchObject({ title: '订高铁票', tag: '出差', star: true })
  })

  it('不合法的时间不识别', () => {
    const p = parseQuickAdd('买 30点 东西', TODAY)
    expect(p.time).toBeUndefined()
  })
})
