import { describe, expect, it } from 'vitest'
import type { Task } from './db'
import { dueReminders, fireTime } from './reminders'

const base: Task = {
  id: 't1',
  title: '开会',
  note: '',
  date: '2026-10-22',
  time: '15:00',
  star: false,
  tag: null,
  done: false,
  doneAt: null,
  order: 0,
  subtasks: [],
  repeat: null,
  remindBefore: 0,
  spawnedId: null,
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  deletedAt: null,
}
const at = (hm: string) => new Date(`2026-10-22T${hm}:00`).getTime()

describe('到点提醒', () => {
  it('计算提醒时间', () => {
    expect(fireTime(base)).toBe(at('15:00'))
    expect(fireTime({ ...base, remindBefore: 15 })).toBe(at('14:45'))
    expect(fireTime({ ...base, remindBefore: null })).toBeNull()
    expect(fireTime({ ...base, time: null })).toBeNull()
    expect(fireTime({ ...base, done: true })).toBeNull()
  })

  it('到点才提醒，只提醒一次，错过 10 分钟以上不补', () => {
    expect(dueReminders([base], at('14:59'), {})).toHaveLength(0)
    const due = dueReminders([base], at('15:00'), {})
    expect(due).toHaveLength(1)
    expect(dueReminders([base], at('15:01'), { [due[0].key]: at('15:00') })).toHaveLength(0)
    expect(dueReminders([base], at('15:11'), {})).toHaveLength(0)
  })

  it('改了时间算新的提醒', () => {
    const first = dueReminders([base], at('15:00'), {})[0].key
    const moved = { ...base, time: '16:00' }
    expect(dueReminders([moved], at('16:00'), { [first]: at('15:00') })).toHaveLength(1)
  })
})
