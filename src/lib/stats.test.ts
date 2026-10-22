import { describe, expect, it } from 'vitest'
import type { Meeting, MeetingNote, Task } from '../db'
import { hoursByKind, mondayOf, todoStats, weeklyHours } from './stats'

// 2026-10-22 是周四
const TODAY = '2026-10-22'

function meeting(id: string, date: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    title: '会',
    kind: 'online',
    repeat: 'none',
    seriesId: null,
    date,
    start: '10:00',
    end: '11:00',
    location: null,
    meetingNo: null,
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

const mine = (taskId: string, due: string | null): MeetingNote => ({
  id: taskId,
  type: 'todo',
  text: taskId,
  at: 0,
  owner: '我',
  due,
  done: false,
  taskId,
  syncedDue: due,
})

const task = (id: string, doneAt: string | null, patch: Partial<Task> = {}) =>
  ({ id, done: !!doneAt, doneAt, deletedAt: null, ...patch }) as Task

it('mondayOf', () => {
  expect(mondayOf(TODAY)).toBe('2026-10-19')
  expect(mondayOf('2026-10-25')).toBe('2026-10-19')
  expect(mondayOf('2026-10-19')).toBe('2026-10-19')
})

describe('weeklyHours', () => {
  it('按周汇总，最早的在前，太早和删掉的不算', () => {
    const r = weeklyHours(
      [
        meeting('a', '2026-10-22'),
        meeting('b', '2026-10-20', { start: '14:00', end: '14:30' }),
        meeting('c', '2026-10-15', { end: null }),
        meeting('d', '2026-10-21', { deletedAt: 'x' }),
        meeting('e', '2026-08-01'),
      ],
      TODAY,
      3,
    )
    expect(r).toEqual([
      { start: '2026-10-05', hours: 0, count: 0 },
      { start: '2026-10-12', hours: 1, count: 1 },
      { start: '2026-10-19', hours: 1.5, count: 2 },
    ])
  })
})

it('hoursByKind', () => {
  const r = hoursByKind([meeting('a', TODAY), meeting('b', TODAY, { kind: 'offline', end: '12:00' })], '2026-10-19', '2026-10-25')
  expect(r).toEqual({ online: 1, offline: 2, hybrid: 0 })
})

describe('todoStats', () => {
  it('按时、晚了、逾期、进行中', () => {
    const m = meeting('m', '2026-10-15', {
      notes: [
        mine('t1', '2026-10-20'),
        mine('t2', '2026-10-20'),
        mine('t3', '2026-10-21'),
        mine('t4', '2026-10-30'),
        mine('t5', null),
        mine('t6', null),
        { ...mine('x', null), owner: '李娜', taskId: null },
      ],
    })
    const tasks = [
      task('t1', '2026-10-20T15:00:00'),
      task('t2', '2026-10-21T09:00:00'),
      task('t3', null),
      task('t4', null),
      task('t5', '2026-10-18T09:00:00'),
      task('t6', null),
    ]
    expect(todoStats([m], tasks, TODAY, '2026-08-01')).toEqual({
      onTime: 1,
      late: 1,
      overdue: 1,
      open: 2,
      doneNoDue: 1,
      rate: 1 / 3,
    })
  })

  it('没有可算的', () => {
    expect(todoStats([], [], TODAY, '2026-08-01').rate).toBeNull()
  })
})
