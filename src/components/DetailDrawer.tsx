import { useEffect, useState } from 'react'
import type { Task } from '../db'
import { fromKey, longLabel, todayKey } from '../lib/date'
import { firstOnOrAfter, type Repeat } from '../lib/repeat'
import { deleteTask, newSubtask, setSubtasks, toggleDone, updateTask } from '../store'
import { ensureNotifyPermission } from '../reminders'
import { CheckIcon, CloseIcon, PlusIcon, StarIcon } from './Icons'

interface Props {
  task: Task
  onClose: () => void
  onDeleted: (t: Task) => void
}

export function DetailDrawer({ task, onClose, onDeleted }: Props) {
  // 标题和备注先在本地编辑，失焦时再保存，避免每个按键都写库
  const [title, setTitle] = useState(task.title)
  const [note, setNote] = useState(task.note)
  const [newSub, setNewSub] = useState('')

  useEffect(() => {
    setTitle(task.title)
    setNote(task.note)
  }, [task.id, task.title, task.note])

  const saveTitle = () => {
    const v = title.trim()
    if (v && v !== task.title) void updateTask(task.id, { title: v })
    else setTitle(task.title)
  }

  const subDone = task.subtasks.filter((s) => s.done).length

  return (
    <aside className="drawer" aria-label="任务详情">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="tiny">创建于 {longLabel(task.createdAt.slice(0, 10))}</span>
        <button className="icon-btn" aria-label="关闭详情" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          className={'check' + (task.done ? ' on' : '')}
          aria-label={task.done ? '取消完成' : '完成'}
          aria-pressed={task.done}
          onClick={() => void toggleDone(task)}
        >
          <span>{task.done && <CheckIcon size={12} color="#fff" />}</span>
        </button>
        <label htmlFor="d-title" className="sr-only">
          标题
        </label>
        <input
          id="d-title"
          className="drawer-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          className="icon-btn"
          aria-label={task.star ? '取消重要' : '标为重要'}
          aria-pressed={task.star}
          style={{ color: task.star ? 'var(--star)' : undefined }}
          onClick={() => void updateTask(task.id, { star: !task.star })}
        >
          <StarIcon filled={task.star} />
        </button>
      </div>

      <div className="fields">
        <div className="field">
          <label htmlFor="d-date">日期</label>
          <input
            id="d-date"
            type="date"
            value={task.date ?? ''}
            onChange={(e) => void updateTask(task.id, { date: e.target.value || null })}
          />
          {task.date && (
            <button className="btn ghost small" onClick={() => void updateTask(task.id, { date: null })}>
              放回收集箱
            </button>
          )}
        </div>
        <div className="field">
          <label htmlFor="d-time">时间</label>
          <input
            id="d-time"
            type="time"
            value={task.time ?? ''}
            onChange={(e) => {
              void updateTask(task.id, { time: e.target.value || null })
              if (e.target.value && task.remindBefore !== null) void ensureNotifyPermission()
            }}
          />
        </div>
        <RepeatField task={task} />
        <div className="field">
          <label htmlFor="d-remind">提醒</label>
          <select
            id="d-remind"
            value={task.time ? String(task.remindBefore ?? 'off') : 'off'}
            disabled={!task.time}
            onChange={(e) => {
              const v = e.target.value === 'off' ? null : Number(e.target.value)
              void updateTask(task.id, { remindBefore: v })
              if (v !== null) void ensureNotifyPermission()
            }}
          >
            {REMIND_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {!task.time && <span className="tiny">设了时间才能提醒</span>}
        </div>
        <div className="field">
          <label htmlFor="d-tag">标签</label>
          <input
            id="d-tag"
            defaultValue={task.tag ?? ''}
            key={task.id + (task.tag ?? '')}
            placeholder="无"
            onBlur={(e) => void updateTask(task.id, { tag: e.target.value.trim().replace(/^#/, '') || null })}
          />
        </div>
      </div>

      <section aria-label="子步骤" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>子步骤</h2>
          {task.subtasks.length > 0 && (
            <span className="tiny">
              {subDone} / {task.subtasks.length}
            </span>
          )}
        </div>
        {task.subtasks.map((s) => (
          <div key={s.id} className={'sub' + (s.done ? ' done' : '')}>
            <input
              type="checkbox"
              aria-label={`完成步骤：${s.title}`}
              checked={s.done}
              onChange={() =>
                void setSubtasks(
                  task.id,
                  task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)),
                )
              }
            />
            <input
              type="text"
              aria-label="步骤内容"
              defaultValue={s.title}
              onBlur={(e) => {
                const v = e.target.value.trim()
                const next = v
                  ? task.subtasks.map((x) => (x.id === s.id ? { ...x, title: v } : x))
                  : task.subtasks.filter((x) => x.id !== s.id)
                void setSubtasks(task.id, next)
              }}
            />
          </div>
        ))}
        <div className="sub">
          <PlusIcon size={16} color="var(--text-2)" />
          <input
            type="text"
            aria-label="添加步骤"
            placeholder="添加步骤，回车保存"
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && newSub.trim()) {
                void setSubtasks(task.id, [...task.subtasks, newSubtask(newSub.trim())])
                setNewSub('')
              }
            }}
          />
        </div>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="d-note" style={{ fontWeight: 500 }}>
          备注
        </label>
        <textarea
          id="d-note"
          className="note"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== task.note && void updateTask(task.id, { note })}
        />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn ghost danger"
          onClick={() => {
            void deleteTask(task.id)
            onDeleted(task)
          }}
        >
          删除
        </button>
      </div>
    </aside>
  )
}

const REMIND_OPTIONS: [string, string][] = [
  ['0', '准时'],
  ['5', '提前 5 分钟'],
  ['15', '提前 15 分钟'],
  ['30', '提前 30 分钟'],
  ['60', '提前 1 小时'],
  ['off', '不提醒'],
]

const WEEK = [1, 2, 3, 4, 5, 6, 0]
const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六']

function RepeatField({ task }: { task: Task }) {
  const r = task.repeat
  const base = fromKey(task.date ?? todayKey())

  function save(repeat: Repeat | null) {
    // 收集箱里的事设了重复，就从今天起第一个符合的日子开始；
    // 已有日期但不再符合新规则的，挪到之后第一个符合的日子
    const today = todayKey()
    const from = task.date && task.date > today ? task.date : today
    const date = repeat && (!task.date || firstOnOrAfter(repeat, task.date) !== task.date) ? firstOnOrAfter(repeat, from) : task.date
    void updateTask(task.id, { repeat, date })
  }

  return (
    <div className="field" style={{ flexWrap: 'wrap', paddingBlock: 6 }}>
      <label htmlFor="d-repeat">重复</label>
      <select
        id="d-repeat"
        value={r?.kind ?? 'none'}
        onChange={(e) => {
          const k = e.target.value
          if (k === 'none') save(null)
          else if (k === 'daily' || k === 'weekdays') save({ kind: k })
          else if (k === 'weekly') save({ kind: 'weekly', days: [base.getDay()] })
          else if (k === 'monthly') save({ kind: 'monthly', day: base.getDate() })
        }}
      >
        <option value="none">不重复</option>
        <option value="daily">每天</option>
        <option value="weekdays">每个工作日</option>
        <option value="weekly">每周</option>
        <option value="monthly">每月</option>
      </select>
      {r?.kind === 'weekly' && (
        <div className="week-picker" role="group" aria-label="每周哪几天">
          {WEEK.map((d) => {
            const on = r.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={'周' + WEEK_NAMES[d]}
                className={on ? 'on' : ''}
                onClick={() => {
                  const days = on ? r.days.filter((x) => x !== d) : [...r.days, d]
                  if (days.length) save({ kind: 'weekly', days })
                }}
              >
                {WEEK_NAMES[d]}
              </button>
            )
          })}
        </div>
      )}
      {r?.kind === 'monthly' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={1}
            max={31}
            aria-label="每月几号"
            style={{ width: 64 }}
            value={r.day}
            onChange={(e) => {
              const day = Math.round(Number(e.target.value))
              if (day >= 1 && day <= 31) save({ kind: 'monthly', day })
            }}
          />
          号
        </span>
      )}
    </div>
  )
}
