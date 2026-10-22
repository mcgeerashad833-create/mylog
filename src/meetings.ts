import { db, type Meeting, type MeetingKind, type MeetingNote, type Task } from './db'
import { longLabel, todayKey } from './lib/date'
import { isMine, taskDateFor, type NoteInput } from './lib/meeting'
import { addTask, deleteTask, updateTask } from './store'

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export interface MeetingFields {
  title: string
  kind: MeetingKind
  date: string
  start: string
  end: string | null
  location: string | null
  meetingNo: string | null
  password: string | null
  link: string | null
  remindBefore: number
}

export async function addMeeting(f: MeetingFields): Promise<Meeting> {
  const ts = now()
  const m: Meeting = {
    id: uid(),
    ...f,
    notes: [],
    startedAt: null,
    endedAt: null,
    summarizedAt: null,
    remindedAt: null,
    nudgedAt: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.meetings.add(m)
  return m
}

export async function updateMeeting(id: string, patch: Partial<Omit<Meeting, 'id'>>): Promise<void> {
  await db.meetings.update(id, { ...patch, updatedAt: now() })
}

export async function deleteMeeting(id: string): Promise<void> {
  await updateMeeting(id, { deletedAt: now() })
}

export async function restoreMeeting(id: string): Promise<void> {
  await updateMeeting(id, { deletedAt: null })
}

/** 开始记录；重复调用不会重置开始时间 */
export async function startRecording(m: Meeting): Promise<void> {
  if (!m.startedAt) await updateMeeting(m.id, { startedAt: now(), endedAt: null })
  else if (m.endedAt) await updateMeeting(m.id, { endedAt: null })
}

export async function endRecording(id: string): Promise<void> {
  await updateMeeting(id, { endedAt: now() })
}

/** 改记录要读最新的一份再写回，避免两次快速修改互相覆盖 */
async function editNotes(id: string, fn: (notes: MeetingNote[]) => MeetingNote[]): Promise<void> {
  await db.transaction('rw', db.meetings, async () => {
    const m = await db.meetings.get(id)
    if (!m) return
    await db.meetings.update(id, { notes: fn(m.notes), updatedAt: now() })
  })
}

export async function addNote(meetingId: string, input: NoteInput, at: number): Promise<MeetingNote> {
  const note: MeetingNote = { id: uid(), ...input, at, done: false, taskId: null, syncedDue: null }
  await editNotes(meetingId, (notes) => [...notes, note])
  return note
}

export async function updateNote(meetingId: string, noteId: string, patch: Partial<Omit<MeetingNote, 'id'>>): Promise<void> {
  await editNotes(meetingId, (notes) => notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)))
}

/** 撤销删除：按记下的时间放回原处 */
export async function restoreNote(meetingId: string, note: MeetingNote): Promise<void> {
  await editNotes(meetingId, (notes) => [...notes.filter((n) => n.id !== note.id), note].sort((a, b) => a.at - b.at))
}

export async function removeNote(meetingId: string, noteId: string): Promise<void> {
  await editNotes(meetingId, (notes) => notes.filter((n) => n.id !== noteId))
}

export interface SyncResult {
  today: number
  later: number
  inbox: number
  others: number
}

/**
 * 保存纪要：我负责的待办变成 MyLog 任务（已有的更新标题和改过的截止日期），
 * 不再是我负责的、或已删掉的待办，对应任务也删掉（已完成的保留）。
 */
export async function saveMinutes(meetingId: string, today = todayKey()): Promise<SyncResult> {
  const result: SyncResult = { today: 0, later: 0, inbox: 0, others: 0 }
  const m = await db.meetings.get(meetingId)
  if (!m) return result

  const linked = (await db.tasks.where('meetingId').equals(meetingId).toArray()).filter((t) => !t.deletedAt)
  const byId = new Map<string, Task>(linked.map((t) => [t.id, t]))
  const keep = new Set<string>()
  const notes: MeetingNote[] = []

  for (const n of m.notes) {
    if (!isMine(n) || !n.text.trim()) {
      if (n.type === 'todo' && n.owner) result.others++
      notes.push(n.taskId ? { ...n, taskId: null, syncedDue: null } : n)
      continue
    }
    const date = taskDateFor(n.due, today)
    const task = n.taskId ? byId.get(n.taskId) : undefined
    if (task) {
      keep.add(task.id)
      const patch: Partial<Task> = {}
      if (task.title !== n.text) patch.title = n.text
      if (n.due !== n.syncedDue && !task.done) patch.date = date
      if (Object.keys(patch).length) await updateTask(task.id, patch)
      notes.push({ ...n, syncedDue: n.due })
    } else {
      const t = await addTask({ title: n.text, date, meetingId, note: `来自会议「${m.title}」（${longLabel(m.date)}）` })
      keep.add(t.id)
      notes.push({ ...n, taskId: t.id, syncedDue: n.due })
    }
    const d = task && n.due === n.syncedDue ? task.date : date
    if (d === null) result.inbox++
    else if (d <= today) result.today++
    else result.later++
  }

  for (const t of linked) if (!keep.has(t.id) && !t.done) await deleteTask(t.id)
  await updateMeeting(meetingId, { notes, summarizedAt: now(), endedAt: m.endedAt ?? (m.startedAt ? now() : null) })
  return result
}
