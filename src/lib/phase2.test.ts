import { describe, expect, it } from 'vitest'
import type { Meeting, MeetingNote } from '../db'
import { isDuplicate, parseImported } from './importMinutes'
import { minutesText } from './minutes'
import { searchMeetings } from './meetingSearch'

// 2026-10-22 是周四
const TODAY = '2026-10-22'

const note = (type: MeetingNote['type'], text: string, patch: Partial<MeetingNote> = {}): MeetingNote => ({
  id: text,
  type,
  text,
  at: 0,
  owner: null,
  due: null,
  done: false,
  taskId: null,
  syncedDue: null,
  ...patch,
})

function meeting(patch: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: '产品周会',
    kind: 'online',
    repeat: 'none',
    seriesId: null,
    date: TODAY,
    start: '10:00',
    end: '11:00',
    location: null,
    meetingNo: '123456789',
    password: null,
    link: null,
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

const SMART = `会议主题：产品周会
会议时间：2026/10/22 10:00-11:00
参会人：张伟、李娜、王强、小明

智能纪要
一、会议摘要
本次会议讨论了新版首页方案和下周排期。

二、章节要点
1. 新版首页方案
- 首屏改为个性化推荐
- 风险可控

三、结论
1. 埋点方案沿用旧版
2. 搜索优化顺延一周

四、待办事项
1. 出冷启动兜底方案（李娜） 周五前
2. 更新排期表 负责人：小明 截止：10月24日
3. @王强 同步测试环境地址
4. 和法务确认数据合规

五、待确认问题
- 推荐位的冷启动怎么处理？`

describe('parseImported', () => {
  it('按小标题分出要点、决议、待办、问题', () => {
    const r = parseImported(SMART, TODAY, '小明')
    expect(r).toEqual([
      { type: 'note', text: '本次会议讨论了新版首页方案和下周排期', owner: null, due: null },
      { type: 'note', text: '新版首页方案', owner: null, due: null },
      { type: 'note', text: '首屏改为个性化推荐', owner: null, due: null },
      { type: 'note', text: '风险可控', owner: null, due: null },
      { type: 'decision', text: '埋点方案沿用旧版', owner: null, due: null },
      { type: 'decision', text: '搜索优化顺延一周', owner: null, due: null },
      { type: 'todo', text: '出冷启动兜底方案', owner: '李娜', due: '2026-10-23' },
      { type: 'todo', text: '更新排期表', owner: '我', due: '2026-10-24' },
      { type: 'todo', text: '同步测试环境地址', owner: '王强', due: null },
      { type: 'todo', text: '和法务确认数据合规', owner: null, due: null },
      { type: 'question', text: '推荐位的冷启动怎么处理？', owner: null, due: null },
    ])
  })

  it('一行里写着「待办：」「结论：」', () => {
    expect(parseImported('随便聊了聊\n结论：下周上线\n待办：发通知 @张伟 明天', TODAY)).toEqual([
      { type: 'decision', text: '下周上线', owner: null, due: null },
      { type: 'todo', text: '发通知', owner: '张伟', due: '2026-10-23' },
    ])
  })

  it('Markdown 标题', () => {
    const r = parseImported('## 行动项\n- [ ] 整理数据 (Alice)\n## Summary\n- 不认识的标题下面不收', TODAY, 'Alice')
    expect(r).toEqual([{ type: 'todo', text: '整理数据', owner: '我', due: null }])
  })

  it('没有任何小标题的文字什么都不导入', () => {
    expect(parseImported('今天天气不错\n大家辛苦了', TODAY)).toEqual([])
  })
})

it('isDuplicate', () => {
  const notes = [note('decision', '埋点方案沿用旧版，不再单独评审')]
  expect(isDuplicate('埋点方案沿用旧版', notes)).toBe(true)
  expect(isDuplicate('搜索优化顺延一周', notes)).toBe(false)
  expect(isDuplicate('旧版', notes)).toBe(false)
})

describe('minutesText', () => {
  const m = meeting({
    notes: [
      note('note', '首页灰度 11月5日'),
      note('decision', '埋点沿用旧版'),
      note('decision', '搜索顺延一周'),
      note('todo', '出冷启动方案', { owner: '李娜', due: '2026-10-23' }),
      note('todo', '想想文案', { owner: '我', done: true }),
      note('question', '冷启动怎么办？'),
    ],
  })

  it('微信文本', () => {
    expect(minutesText(m, 'text')).toBe(
      [
        '【产品周会 纪要】10月22日 周四 10:00 – 11:00',
        '地点：腾讯会议 123 456 789',
        '',
        '决议',
        '1. 埋点沿用旧版',
        '2. 搜索顺延一周',
        '',
        '待办',
        '· 出冷启动方案（@李娜 10月23日前）',
        '· 想想文案（@我）',
        '',
        '要点',
        '· 首页灰度 11月5日',
        '',
        '遗留问题',
        '· 冷启动怎么办？',
      ].join('\n'),
    )
  })

  it('Markdown', () => {
    const md = minutesText(m, 'markdown')
    expect(md).toContain('# 产品周会 纪要\n\n- 时间：10月22日 周四 10:00 – 11:00')
    expect(md).toContain('## 待办\n\n- [ ] 出冷启动方案 — @李娜 10月23日前\n- [x] 想想文案 — @我')
  })

  it('没有记录', () => {
    expect(minutesText(meeting(), 'text')).toContain('（没有记录）')
  })
})

describe('searchMeetings', () => {
  const a = meeting({ id: 'a', date: '2026-10-15', notes: [note('decision', '预算按 20 万走'), note('note', '首页改版')] })
  const b = meeting({ id: 'b', title: '供应商评审', notes: [note('todo', '发预算表', { owner: '张伟' })] })
  const c = meeting({ id: 'c', title: '季度复盘', location: '6 楼 大会议室', notes: [note('note', '无关')] })

  it('按记录内容搜，新的在前', () => {
    const r = searchMeetings([a, b, c], '预算')
    expect(r.map((h) => [h.meeting.id, h.notes.map((n) => n.text)])).toEqual([
      ['b', ['发预算表']],
      ['a', ['预算按 20 万走']],
    ])
  })

  it('会议标题 + 记录内容组合', () => {
    expect(searchMeetings([a, b, c], '周会 预算').map((h) => h.meeting.id)).toEqual(['a'])
  })

  it('搜负责人、地点', () => {
    expect(searchMeetings([a, b, c], '张伟')[0].notes[0].text).toBe('发预算表')
    expect(searchMeetings([a, b, c], '大会议室')).toMatchObject([{ meeting: { id: 'c' }, meetingHit: true, notes: [] }])
  })

  it('空关键词没有结果', () => expect(searchMeetings([a], '  ')).toEqual([]))
})
