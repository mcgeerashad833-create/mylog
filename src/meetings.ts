import { db, type Meeting, type MeetingKind, type MeetingNote, type PrepItem, type MeetingRepeat, type Task } from './db'
import { longLabel, todayKey } from './lib/date'
import { isMine, taskDateFor, type NoteInput } from './lib/meeting'
import { seriesToExtend } from './lib/series'
import { addTask, deleteTask, touch, updateTask } from './store'
import { uid } from './lib/uid'

const now = () => new Date().toISOString()

/**
 * 自动生成的例会用固定的 id 和一个很早的 updatedAt：
 * 两台设备各自生成同一次时内容一样、id 一样，同步后不会出现两份；
 * 任何一台设备上真正改过（包括删掉）的版本都比它新，同步时总是赢。
 */
const GENERATED_AT = '2000-01-01T00:00:00.000Z'
export const occurrenceId = (seriesId: string, date: string) => `${seriesId}_${date}`

const mark = (ids: string[], updatedAt: string) => touch('meetings', ids, updatedAt)

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
  repeat: MeetingRepeat
}

export async function addMeeting(f: MeetingFields, prep: string[] = []): Promise<Meeting> {
  const ts = now()
  const id = uid()
  const m: Meeting = {
    id,
    ...f,
    seriesId: f.repeat === 'none' ? null : id,
    notes: [],
    prep: prep.map((text) => ({ id: uid(), text, done: false })),
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
  await mark([id], ts)
  return m
}

export async function updateMeeting(id: string, patch: Partial<Omit<Meeting, 'id'>>): Promise<void> {
  const ts = now()
  await db.meetings.update(id, { ...patch, updatedAt: ts })
  await mark([id], ts)
}

/** 以后还没开的那几次例会：可以跟着改，也可以直接删掉 */
async function futureOccurrences(m: Meeting): Promise<Meeting[]> {
  if (!m.seriesId) return []
  const all = await db.meetings.where('seriesId').equals(m.seriesId).toArray()
  return all.filter((x) => x.id !== m.id && x.date > m.date && !x.startedAt && x.notes.length === 0)
}

/**
 * 编辑会议。例会的话，主题、时间、地点、会议号这些也同步到以后还没开的几次；
 * 改了日期或重复方式，以后那几次删掉重新生成；改成不重复就停掉这个例会。
 */
export async function editMeeting(m: Meeting, f: MeetingFields, today = todayKey()): Promise<void> {
  const timeChanged = f.date !== m.date || f.start !== m.start
  const seriesId = f.repeat === 'none' ? m.seriesId : (m.seriesId ?? m.id)
  await updateMeeting(m.id, { ...f, seriesId, ...(timeChanged ? { remindedAt: null } : {}) })

  const future = await futureOccurrences({ ...m, seriesId })
  if (future.length) {
    const ts = now()
    if (f.repeat === 'none' || f.repeat !== m.repeat || f.date !== m.date) {
      // 以后还没开过的几次删掉，并脱离这个例会，不占「删掉的那一次」的位置，之后可以重新生成
      const changes = { deletedAt: ts, seriesId: null, updatedAt: ts }
      await db.meetings.bulkUpdate(future.map((x) => ({ key: x.id, changes })))
    } else {
      const { date: _date, ...shared } = f
      const changes = { ...shared, ...(f.start !== m.start ? { remindedAt: null } : {}), updatedAt: ts }
      await db.meetings.bulkUpdate(future.map((x) => ({ key: x.id, changes })))
    }
    await mark(
      future.map((x) => x.id),
      ts,
    )
  }
  await ensureSeries(today)
}

/** 例会补建下一次：今天或以后没有的话，按重复方式生成一次 */
export async function ensureSeries(today = todayKey()): Promise<number> {
  return db.transaction('rw', db.meetings, db.outbox, async () => {
    const todo = seriesToExtend(await db.meetings.toArray(), today)
    for (const { from, date } of todo) {
      const id = occurrenceId(from.seriesId!, date)
      // 同一个 id 已经被「改成不重复」删掉过，这次是重新开始的例会：用当前时间，才能盖过那次删除
      const ts = (await db.meetings.get(id)) ? now() : GENERATED_AT
      await db.meetings.put({
        id,
        title: from.title,
        kind: from.kind,
        repeat: from.repeat,
        seriesId: from.seriesId,
        date,
        start: from.start,
        end: from.end,
        location: from.location,
        meetingNo: from.meetingNo,
        password: from.password,
        link: from.link,
        remindBefore: from.remindBefore,
        notes: [],
        prep: [],
        startedAt: null,
        endedAt: null,
        summarizedAt: null,
        remindedAt: null,
        nudgedAt: null,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      })
      await mark([id], ts)
    }
    return todo.length
  })
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
  await db.transaction('rw', db.meetings, db.outbox, async () => {
    const m = await db.meetings.get(id)
    if (!m) return
    const ts = now()
    await db.meetings.update(id, { notes: fn(m.notes), updatedAt: ts })
    await mark([id], ts)
  })
}

async function editPrep(id: string, fn: (prep: PrepItem[]) => PrepItem[]): Promise<void> {
  await db.transaction('rw', db.meetings, db.outbox, async () => {
    const m = await db.meetings.get(id)
    if (!m) return
    const ts = now()
    await db.meetings.update(id, { prep: fn(m.prep), updatedAt: ts })
    await mark([id], ts)
  })
}

export async function addPrep(meetingId: string, text: string): Promise<void> {
  await editPrep(meetingId, (prep) => [...prep, { id: uid(), text, done: false }])
}

export async function togglePrep(meetingId: string, prepId: string): Promise<void> {
  await editPrep(meetingId, (prep) => prep.map((p) => (p.id === prepId ? { ...p, done: !p.done } : p)))
}

export async function removePrep(meetingId: string, prepId: string): Promise<void> {
  await editPrep(meetingId, (prep) => prep.filter((p) => p.id !== prepId))
}

/** 导入腾讯会议智能纪要：一次加入多条，时间点记在最后 */
export async function importNotes(meetingId: string, inputs: NoteInput[], at: number): Promise<void> {
  const added = inputs.map((input): MeetingNote => ({ id: uid(), ...input, at, done: false, taskId: null, syncedDue: null }))
  await editNotes(meetingId, (notes) => [...notes, ...added])
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
