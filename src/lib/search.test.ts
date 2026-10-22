import { describe, expect, it } from 'vitest'
import type { Day, Task } from '../db'
import { highlight, search, snippet } from './search'

let n = 0
function task(patch: Partial<Task>): Task {
  n += 1
  return {
    id: 't' + n,
    title: '',
    note: '',
    date: '2026-10-22',
    time: null,
    star: false,
    tag: null,
    done: false,
    doneAt: null,
    order: 0,
    subtasks: [],
    repeat: null,
    remindBefore: 0,
    spawnedId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...patch,
  }
}

const tasks = [
  task({ title: '交 10 月报销单', note: '打车票 3 张，财务周五不收', tag: '工作' }),
  task({ title: '给物业打电话', date: null }),
  task({ title: '报销体检费', done: true, doneAt: '2026-10-20T09:00:00.000Z' }),
  task({ title: '交 9 月报销单', done: true, doneAt: '2026-10-01T09:00:00.000Z', tag: '工作' }),
  task({ title: '买菜', subtasks: [{ id: 's', title: '西红柿和鸡蛋', done: false }] }),
  task({ title: '报销旧单据', deletedAt: '2026-10-21T00:00:00.000Z' }),
]
const days: Day[] = [
  { date: '2026-10-20', note: '报销终于交了', closedAt: null, updatedAt: '' },
  { date: '2026-10-21', note: '', closedAt: null, updatedAt: '' },
]

describe('搜索', () => {
  it('按标题、备注、子步骤匹配，分组排序，不含已删除', () => {
    const r = search(tasks, days, '报销')
    expect(r.open.map((t) => t.title)).toEqual(['交 10 月报销单'])
    expect(r.done.map((t) => t.title)).toEqual(['报销体检费', '交 9 月报销单'])
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-20'])
    expect(search(tasks, days, '财务').open.map((t) => t.title)).toEqual(['交 10 月报销单'])
    expect(search(tasks, days, '鸡蛋').open.map((t) => t.title)).toEqual(['买菜'])
  })

  it('多个关键词都要出现', () => {
    expect(search(tasks, days, '报销 10').open).toHaveLength(1)
    expect(search(tasks, days, '报销 物业').open).toHaveLength(0)
  })

  it('#标签只匹配标签', () => {
    const r = search(tasks, days, '#工作')
    expect([...r.open, ...r.done].map((t) => t.title)).toEqual(['交 10 月报销单', '交 9 月报销单'])
    expect(r.days).toEqual([])
    expect(search(tasks, days, '#工作 9').done.map((t) => t.title)).toEqual(['交 9 月报销单'])
  })

  it('空查询什么也不返回', () => {
    expect(search(tasks, days, '   ')).toEqual({ open: [], done: [], days: [] })
  })

  it('高亮与摘要', () => {
    expect(highlight('交 10 月报销单', '报销')).toEqual([
      { text: '交 10 月', hit: false },
      { text: '报销', hit: true },
      { text: '单', hit: false },
    ])
    expect(highlight('Call Bob', 'bob')).toEqual([
      { text: 'Call ', hit: false },
      { text: 'Bob', hit: true },
    ])
    expect(snippet(tasks[0], '财务')).toBe('打车票 3 张，财务周五不收')
    expect(snippet(tasks[0], '报销')).toBeNull()
  })
})
