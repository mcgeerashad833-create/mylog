import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addMeeting, addNote, editMeeting, ensureSeries, removeNote, saveMinutes, updateNote, type MeetingFields } from './meetings'
import { toggleDone } from './store'

const TODAY = '2026-10-22'

const fields: MeetingFields = {
  title: '产品周会',
  kind: 'online',
  date: TODAY,
  start: '10:00',
  end: '11:00',
  location: null,
  meetingNo: '123456789',
  password: null,
  link: null,
  remindBefore: 10,
  repeat: 'none',
}

const todo = (text: string, owner: string | null, due: string | null = null) => ({ type: 'todo' as const, text, owner, due })

beforeEach(async () => {
  await db.tasks.clear()
  await db.meetings.clear()
})

describe('saveMinutes', () => {
  it('我负责的待办变成任务，别人负责的只计数', async () => {
    const m = await addMeeting(fields)
    await addNote(m.id, todo('更新排期表', '我', TODAY), 10)
    await addNote(m.id, todo('补齐指标', '我', '2026-10-23'), 20)
    await addNote(m.id, todo('想想推荐位', '我'), 30)
    await addNote(m.id, todo('出冷启动方案', '李娜', '2026-10-23'), 40)
    await addNote(m.id, { type: 'decision', text: '沿用旧埋点', owner: null, due: null }, 50)

    expect(await saveMinutes(m.id, TODAY)).toEqual({ today: 1, later: 1, inbox: 1, others: 1 })

    const tasks = await db.tasks.toArray()
    expect(tasks.map((t) => [t.title, t.date, t.meetingId]).sort()).toEqual([
      ['想想推荐位', null, m.id],
      ['更新排期表', TODAY, m.id],
      ['补齐指标', '2026-10-23', m.id],
    ])
    expect(tasks[0].note).toBe('来自会议「产品周会」（10月22日 周四）')
    const saved = (await db.meetings.get(m.id))!
    expect(saved.summarizedAt).not.toBeNull()
    expect(saved.notes.filter((n) => n.taskId).length).toBe(3)
  })

  it('再次保存：不重复建任务，改过的标题和截止日期会更新，没改的日期不动', async () => {
    const m = await addMeeting(fields)
    const a = await addNote(m.id, todo('更新排期表', '我', TODAY), 10)
    const b = await addNote(m.id, todo('补齐指标', '我', TODAY), 20)
    await saveMinutes(m.id, TODAY)

    // 用户在「今天」里把 a 挪到了以后
    const ta = (await db.meetings.get(m.id))!.notes.find((n) => n.id === a.id)!.taskId!
    await db.tasks.update(ta, { date: '2026-10-30' })

    await updateNote(m.id, a.id, { text: '更新下周排期表' })
    await updateNote(m.id, b.id, { due: '2026-10-24' })
    await saveMinutes(m.id, TODAY)

    const tasks = (await db.tasks.toArray()).filter((t) => !t.deletedAt)
    expect(tasks.length).toBe(2)
    expect(tasks.find((t) => t.id === ta)).toMatchObject({ title: '更新下周排期表', date: '2026-10-30' })
    expect(tasks.find((t) => t.title === '补齐指标')!.date).toBe('2026-10-24')
  })

  it('改成别人负责或删掉记录，没完成的任务跟着删，已完成的保留', async () => {
    const m = await addMeeting(fields)
    const a = await addNote(m.id, todo('甲', '我'), 10)
    const b = await addNote(m.id, todo('乙', '我'), 20)
    const c = await addNote(m.id, todo('丙', '我'), 30)
    await saveMinutes(m.id, TODAY)

    const ids = Object.fromEntries((await db.meetings.get(m.id))!.notes.map((n) => [n.id, n.taskId!]))
    await toggleDone((await db.tasks.get(ids[c.id]))!)

    await updateNote(m.id, a.id, { owner: '王强' })
    await removeNote(m.id, b.id)
    await removeNote(m.id, c.id)
    expect(await saveMinutes(m.id, TODAY)).toEqual({ today: 0, later: 0, inbox: 0, others: 1 })

    const alive = (await db.tasks.toArray()).filter((t) => !t.deletedAt)
    expect(alive.map((t) => t.title)).toEqual(['丙'])
    expect((await db.meetings.get(m.id))!.notes.find((n) => n.id === a.id)!.taskId).toBeNull()
  })
})

describe('例会', () => {
  const weekly: MeetingFields = { ...fields, date: '2026-10-15', repeat: 'weekly' }
  const alive = async () => (await db.meetings.toArray()).filter((m) => !m.deletedAt).sort((a, b) => a.date.localeCompare(b.date))

  it('自动补建下一次，复制会议信息，不复制记录和备注；重复调用不会多建', async () => {
    const m = await addMeeting(weekly, ['问清灰度时间'])
    await addNote(m.id, todo('甲', '我'), 1)
    expect(await ensureSeries(TODAY)).toBe(1)
    expect(await ensureSeries(TODAY)).toBe(0)

    const [first, next] = await alive()
    expect(first.seriesId).toBe(m.id)
    expect(next).toMatchObject({ date: TODAY, seriesId: m.id, title: '产品周会', meetingNo: '123456789', notes: [], prep: [] })
    expect(first.prep.map((p) => p.text)).toEqual(['问清灰度时间'])
  })

  it('改主题同步到以后还没开的几次；改成不重复就删掉以后的', async () => {
    const m = await addMeeting(weekly)
    await ensureSeries(TODAY)
    const first = (await db.meetings.get(m.id))!

    await editMeeting(first, { ...weekly, title: '产品周会（新）', start: '14:00' }, TODAY)
    expect((await alive()).map((x) => [x.title, x.start])).toEqual([
      ['产品周会（新）', '14:00'],
      ['产品周会（新）', '14:00'],
    ])

    await editMeeting((await db.meetings.get(m.id))!, { ...weekly, repeat: 'none' }, TODAY)
    expect((await alive()).map((x) => x.id)).toEqual([m.id])
    expect(await ensureSeries(TODAY)).toBe(0)
  })

  it('已经开始记录的那一次不会被改掉', async () => {
    const m = await addMeeting(weekly)
    await ensureSeries(TODAY)
    const next = (await alive())[1]
    await addNote(next.id, todo('已记', '我'), 1)
    await editMeeting((await db.meetings.get(m.id))!, { ...weekly, title: '改名' }, TODAY)
    expect((await alive()).map((x) => x.title)).toEqual(['改名', '产品周会'])
  })

  it('普通会议改成例会', async () => {
    const m = await addMeeting({ ...fields, date: '2026-10-15' })
    expect(m.seriesId).toBeNull()
    await editMeeting(m, { ...fields, date: '2026-10-15', repeat: 'biweekly' }, TODAY)
    expect((await alive()).map((x) => [x.date, x.seriesId])).toEqual([
      ['2026-10-15', m.id],
      ['2026-10-29', m.id],
    ])
  })
})
