import type { CSSProperties, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../db'
import { relativeLabel } from '../lib/date'
import { CheckIcon, ClockIcon, GripIcon, ListIcon, StarIcon, CalendarIcon } from './Icons'

interface Props {
  task: Task
  today: string
  selected?: boolean
  showDate?: boolean
  onToggle: (t: Task) => void
  onOpen: (t: Task) => void
  /** 行尾的额外操作按钮（收集箱、遗留处理用） */
  actions?: ReactNode
  sortable?: boolean
}

export function TaskRow(props: Props) {
  if (props.sortable) return <SortableRow {...props} />
  return <RowView {...props} />
}

function SortableRow(props: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <RowView
      {...props}
      rowRef={setNodeRef}
      style={style}
      dragging={isDragging}
      grip={
        <button
          ref={setActivatorNodeRef}
          className="grip"
          aria-label={`拖动排序：${props.task.title}`}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
      }
    />
  )
}

function RowView({
  task,
  today,
  selected,
  showDate,
  onToggle,
  onOpen,
  actions,
  rowRef,
  style,
  dragging,
  grip,
}: Props & { rowRef?: (el: HTMLElement | null) => void; style?: CSSProperties; dragging?: boolean; grip?: ReactNode }) {
  const subDone = task.subtasks.filter((s) => s.done).length
  const late = !task.done && task.date !== null && task.date < today
  const hasMeta = task.time || task.subtasks.length > 0 || task.tag || (showDate && task.date) || late
  const cls = ['row', task.done && 'done', selected && 'selected', dragging && 'dragging'].filter(Boolean).join(' ')

  return (
    <div ref={rowRef} style={style} className={cls}>
      {grip ?? <span style={{ width: 20, flex: 'none' }} />}
      <button
        className={'check' + (task.done ? ' on' : '')}
        aria-label={(task.done ? '取消完成：' : '完成：') + task.title}
        aria-pressed={task.done}
        onClick={() => onToggle(task)}
      >
        <span>{task.done && <CheckIcon size={12} color="#fff" />}</span>
      </button>
      <button className="row-body" onClick={() => onOpen(task)} aria-label={`打开详情：${task.title}`}>
        <span className="row-title">{task.title}</span>
        {hasMeta && (
          <span className="meta">
            {late && <span className="late">{relativeLabel(task.date!, today)}遗留</span>}
            {showDate && task.date && !late && (
              <span>
                <CalendarIcon size={13} />
                {relativeLabel(task.date, today)}
              </span>
            )}
            {task.time && (
              <span>
                <ClockIcon size={13} />
                {task.time}
              </span>
            )}
            {task.subtasks.length > 0 && (
              <span>
                <ListIcon size={13} />
                {subDone}/{task.subtasks.length}
              </span>
            )}
            {task.tag && <span>#{task.tag}</span>}
          </span>
        )}
      </button>
      {actions && <div className="row-actions">{actions}</div>}
      {task.star && !task.done && (
        <span className="star" role="img" aria-label="重要">
          <StarIcon size={16} filled />
        </span>
      )}
    </div>
  )
}
