import { describe, expect, it } from 'vitest'
import type { Meeting, MeetingNote } from '../db'
import { dueReminders, endAt, extractDue, followMessage, meetingStatus, parseNoteInput, statusLabel, taskDateFor, whereLabel } from './meeting'

// 2026-10-22 是周四
const TODAY = '2026-10-22'
const at = (hm: string, day = TODAY) => new Date(`${day}T${hm}:00`)

function meeting(patch: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: '产品周会',
    kind: 'hybrid',
    date: TODAY,
    start: '10:00',
    end: '11:00',
    location: '3 楼 小会议室',
    meetingNo: '123456789',
    password: null,
    link: null,
    remindBefore: 10,
    notes: [],
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

describe('parseNoteInput', () => {
  it('普通笔记', () => {
    expect(parseNoteInput('首页灰度定在 11月5日', 'note', TODAY)).toEqual({
      type: 'note',
      text: '首页灰度定在 11月5日',
      owner: null,
      due: null,
    })
  })

  it('前缀指定类型', () => {
    expect(parseNoteInput('决：埋点沿用旧版', 'note', TODAY)).toMatchObject({ type: 'decision', text: '埋点沿用旧版' })
    expect(parseNoteInput('问: 冷启动怎么办？', 'note', TODAY)).toMatchObject({ type: 'question', text: '冷启动怎么办？' })
  })

  it('待办识别负责人和截止日期', () => {
    expect(parseNoteInput('待：出冷启动方案 @李娜 周五前', 'note', TODAY)).toEqual({
      type: 'todo',
      text: '出冷启动方案',
      owner: '李娜',
      due: '2026-10-23',
    })
  })

  it('待办不写 @ 默认是我', () => {
    expect(parseNoteInput('补齐指标口径 明天', 'todo', TODAY)).toMatchObject({ owner: '我', due: '2026-10-23', text: '补齐指标口径' })
  })
})

describe('extractDue', () => {
  it('各种写法', () => {
    expect(extractDue('下周一之前', TODAY).due).toBe('2026-10-26')
    expect(extractDue('10月30日前', TODAY).due).toBe('2026-10-30')
    expect(extractDue('1月5号', TODAY).due).toBe('2027-01-05')
    expect(extractDue('后天', TODAY).due).toBe('2026-10-24')
    expect(extractDue('没有日期', TODAY).due).toBeNull()
  })
})

describe('meetingStatus', () => {
  it('按时间推断', () => {
    const m = meeting()
    expect(meetingStatus(m, at('09:30'))).toBe('upcoming')
    expect(statusLabel(m, at('09:35'))).toBe('25 分钟后')
    expect(meetingStatus(m, at('10:30'))).toBe('ongoing')
    expect(meetingStatus(m, at('11:30'))).toBe('ended')
    expect(statusLabel(m, at('11:30'))).toBe('已结束')
    const noted = meeting({ notes: [{ id: 'n', type: 'note', text: 'x', at: 0, owner: null, due: null, done: false, taskId: null, syncedDue: null }] })
    expect(meetingStatus(noted, at('11:30'))).toBe('pending')
  })

  it('记录与整理优先', () => {
    expect(meetingStatus(meeting({ startedAt: 'x' }), at('09:00'))).toBe('recording')
    expect(meetingStatus(meeting({ startedAt: 'x', endedAt: 'y' }), at('10:30'))).toBe('pending')
    expect(meetingStatus(meeting({ summarizedAt: 'z' }), at('10:30'))).toBe('done')
  })

  it('跨天和没有结束时间', () => {
    expect(endAt(meeting({ start: '23:00', end: '00:30' })).getTime()).toBe(at('00:30', '2026-10-23').getTime())
    expect(endAt(meeting({ end: null })).getTime()).toBe(at('11:00').getTime())
  })
})

it('whereLabel', () => {
  expect(whereLabel(meeting())).toBe('3 楼 小会议室 · 腾讯会议 123 456 789')
  expect(whereLabel(meeting({ kind: 'offline' }))).toBe('3 楼 小会议室')
  expect(whereLabel(meeting({ kind: 'online', meetingNo: null }))).toBe('腾讯会议')
})

it('taskDateFor', () => {
  expect(taskDateFor(null, TODAY)).toBeNull()
  expect(taskDateFor('2026-10-20', TODAY)).toBe(TODAY)
  expect(taskDateFor('2026-10-30', TODAY)).toBe('2026-10-30')
})

it('followMessage', () => {
  const n = { owner: '李娜', text: '出冷启动方案', due: '2026-10-23' } as MeetingNote
  expect(followMessage(n, meeting(), TODAY)).toBe('李娜，产品周会上说的「出冷启动方案」（截止明天）进展怎么样了？需要我配合的随时说。')
})

describe('dueReminders', () => {
  it('会前提醒只在提醒窗口内、只提醒一次', () => {
    const m = meeting()
    expect(dueReminders([m], at('09:49')).before).toEqual([])
    expect(dueReminders([m], at('09:51')).before).toEqual([m])
    expect(dueReminders([m], at('10:01')).before).toEqual([])
    expect(dueReminders([meeting({ remindedAt: 'x' })], at('09:55')).before).toEqual([])
    expect(dueReminders([meeting({ remindBefore: 0 })], at('09:55')).before).toEqual([])
  })

  it('会后 30 分钟还没整理才提醒，没记过东西的会不提醒', () => {
    const recorded = meeting({ startedAt: 'x' })
    expect(dueReminders([recorded], at('11:20')).after).toEqual([])
    expect(dueReminders([recorded], at('11:31')).after).toEqual([recorded])
    expect(dueReminders([meeting()], at('11:31')).after).toEqual([])
    expect(dueReminders([meeting({ startedAt: 'x', summarizedAt: 'y' })], at('11:31')).after).toEqual([])
  })
})
