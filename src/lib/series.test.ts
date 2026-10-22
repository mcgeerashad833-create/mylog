import { describe, expect, it } from 'vitest'
import type { Meeting, MeetingNote, Task } from '../db'
import { carryOver, seriesToExtend } from './series'

// 2026-10-22 是周四
const TODAY = '2026-10-22'

function meeting(id: string, date: string, patch: Partial<Meeting> = {}): Meeting {
  return {
    id,
    title: '产品周会',
    kind: 'online',
    repeat: 'weekly',
    seriesId: 's1',
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

const note = (patch: Partial<MeetingNote>): MeetingNote => ({
  id: Math.random().toString(),
  type: 'todo',
  text: '某事',
  at: 0,
  owner: '李娜',
  due: null,
  done: false,
  taskId: null,
  syncedDue: null,
  ...patch,
})

describe('seriesToExtend', () => {
  it('今天和以后已经有一次就不补', () => {
    expect(seriesToExtend([meeting('a', '2026-10-15'), meeting('b', TODAY)], TODAY)).toEqual([])
  })

  it('上次是上周，补今天这次', () => {
    const a = meeting('a', '2026-10-15')
    expect(seriesToExtend([a], TODAY)).toEqual([{ from: a, date: TODAY }])
  })

  it('很久没打开，只补下一次，不补中间错过的', () => {
    const a = meeting('a', '2026-09-24', { repeat: 'biweekly' })
    expect(seriesToExtend([a], '2026-10-23')).toEqual([{ from: a, date: '2026-11-05' }])
  })

  it('不重复的会、停掉的例会不补', () => {
    expect(seriesToExtend([meeting('a', '2026-10-15', { seriesId: null, repeat: 'none' })], TODAY)).toEqual([])
    expect(seriesToExtend([meeting('a', '2026-10-15', { repeat: 'none' })], TODAY)).toEqual([])
  })

  it('删掉的那一次也占位置', () => {
    const list = [meeting('a', '2026-10-15'), meeting('b', TODAY, { deletedAt: 'x' })]
    expect(seriesToExtend(list, TODAY)).toEqual([])
  })
})

describe('carryOver', () => {
  it('之前几次没完成的待办', () => {
    const old = meeting('a', '2026-10-08', {
      summarizedAt: 'x',
      notes: [note({ text: '确认埋点' }), note({ text: '已经做完', done: true }), note({ text: '我的', owner: '我' })],
    })
    const unsaved = meeting('b', '2026-10-15', { notes: [note({ text: '没保存的纪要' })] })
    const cur = meeting('c', TODAY)
    const other = meeting('x', '2026-10-15', { seriesId: 's2', summarizedAt: 'x', notes: [note({ text: '别的会' })] })
    const tasks = [
      { id: 't1', title: '整理数据口径', done: false, deletedAt: null, meetingId: 'a' },
      { id: 't2', title: '已完成', done: true, deletedAt: null, meetingId: 'b' },
      { id: 't3', title: '本次的', done: false, deletedAt: null, meetingId: 'c' },
    ] as Task[]

    const r = carryOver(cur, [old, unsaved, cur, other], tasks)
    expect(r.mine.map((t) => t.title)).toEqual(['整理数据口径'])
    expect(r.others.map((o) => o.note.text)).toEqual(['确认埋点'])
  })

  it('不是例会没有遗留', () => {
    expect(carryOver(meeting('a', TODAY, { seriesId: null }), [], [])).toEqual({ mine: [], others: [] })
  })
})
