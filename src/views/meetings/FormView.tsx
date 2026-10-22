import { useState, type ReactNode } from 'react'
import type { Meeting, MeetingKind, Repeat } from '../../db'
import { nowHM } from '../../lib/date'
import { parseInvite, formatMeetingNo, type Invite } from '../../lib/invite'
import { KIND_LABEL } from '../../lib/meeting'
import { REPEAT_LABEL } from '../../lib/series'
import { addMeeting, editMeeting, ensureSeries, type MeetingFields } from '../../meetings'
import { CheckIcon } from '../../components/Icons'
import { BackLink, type MeetingProps } from './shared'

type Draft = Omit<MeetingFields, 'end' | 'location' | 'meetingNo' | 'password' | 'link'> & {
  end: string
  location: string
  meetingNo: string
  password: string
  link: string
}

const REMIND_OPTIONS = [0, 5, 10, 15, 30]
/** 线下会议多留 5 分钟走过去 */
const defaultRemind = (kind: MeetingKind) => (kind === 'offline' ? 15 : 10)

function nextHalfHour(): string {
  const [h, m] = nowHM().split(':').map(Number)
  const total = Math.min(h * 60 + m + 30 - ((m + 30) % 30), 23 * 60 + 30)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function fromMeeting(m: Meeting): Draft {
  return {
    title: m.title,
    kind: m.kind,
    date: m.date,
    start: m.start,
    end: m.end ?? '',
    location: m.location ?? '',
    meetingNo: m.meetingNo ? formatMeetingNo(m.meetingNo) : '',
    password: m.password ?? '',
    link: m.link ?? '',
    remindBefore: m.remindBefore,
    repeat: m.repeat,
  }
}

function applyInvite(d: Draft, inv: Invite): Draft {
  return {
    ...d,
    title: inv.title ?? (d.title || '腾讯会议'),
    date: inv.date ?? d.date,
    start: inv.start ?? d.start,
    end: inv.end ?? d.end,
    meetingNo: inv.meetingNo ? formatMeetingNo(inv.meetingNo) : d.meetingNo,
    password: inv.password ?? d.password,
    link: inv.link ?? d.link,
    repeat: inv.repeat ?? d.repeat,
    // 线下会议粘贴了邀请，说明也能用腾讯会议接入
    kind: d.kind === 'offline' ? 'hybrid' : d.kind,
  }
}

const INVITE_KEYS: (keyof Invite)[] = ['title', 'date', 'start', 'end', 'meetingNo', 'password', 'link', 'repeat']

export function FormView(p: MeetingProps & { editing?: Meeting; invite?: string }) {
  const initialInvite = p.invite ? parseInvite(p.invite) : null
  const base: Draft = p.editing
    ? fromMeeting(p.editing)
    : {
        title: '',
        kind: 'online',
        date: p.today,
        start: nextHalfHour(),
        end: '',
        location: '',
        meetingNo: '',
        password: '',
        link: '',
        remindBefore: defaultRemind('online'),
        repeat: 'none',
      }
  const [d, setD] = useState<Draft>(initialInvite ? applyInvite(base, initialInvite) : base)
  const [inviteText, setInviteText] = useState(p.invite ?? '')
  const [recognized, setRecognized] = useState<Set<string>>(
    new Set(initialInvite ? INVITE_KEYS.filter((k) => initialInvite[k]) : []),
  )
  const [remindTouched, setRemindTouched] = useState(!!p.editing)
  const [prepText, setPrepText] = useState('')
  const [error, setError] = useState('')

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }))
    setRecognized((prev) => {
      if (!prev.has(k)) return prev
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  const recognize = (text: string) => {
    const inv = parseInvite(text)
    const keys = INVITE_KEYS.filter((k) => inv[k])
    if (keys.length === 0) {
      setError('没有识别出会议信息，请检查粘贴的是不是腾讯会议邀请。')
      return
    }
    setError('')
    setD((prev) => applyInvite(prev, inv))
    setRecognized(new Set(keys))
  }

  const setKind = (kind: MeetingKind) => {
    setD((prev) => ({ ...prev, kind, remindBefore: remindTouched ? prev.remindBefore : defaultRemind(kind) }))
  }

  async function save() {
    if (!d.title.trim()) return setError('请填写会议主题。')
    if (!d.date || !d.start) return setError('请填写日期和开始时间。')
    const digits = d.meetingNo.replace(/\D/g, '')
    const fields: MeetingFields = {
      title: d.title.trim(),
      kind: d.kind,
      date: d.date,
      start: d.start,
      end: d.end || null,
      location: d.kind !== 'online' ? d.location.trim() || null : null,
      meetingNo: d.kind !== 'offline' ? digits || null : null,
      password: d.kind !== 'offline' ? d.password.trim() || null : null,
      link: d.kind !== 'offline' ? d.link.trim() || null : null,
      remindBefore: d.remindBefore,
      repeat: d.repeat,
    }
    if (p.editing) {
      await editMeeting(p.editing, fields, p.today)
      p.go({ page: 'detail', id: p.editing.id })
    } else {
      const prep = prepText
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
      const m = await addMeeting(fields, prep)
      // 日期填在过去的例会，顺手把下一次建出来
      if (fields.repeat !== 'none') await ensureSeries(p.today)
      p.go({ page: 'detail', id: m.id })
    }
  }

  const field = (key: keyof Draft, label: string, input: ReactNode, wide = false) => (
    <div className={'form-field' + (wide ? ' wide' : '') + (recognized.has(key) ? ' recognized' : '')}>
      <label htmlFor={'mf-' + key}>
        {label}
        {recognized.has(key) && <span className="badge kind-online">已识别</span>}
      </label>
      {input}
    </div>
  )

  const text = (key: 'title' | 'location' | 'meetingNo' | 'password' | 'link', placeholder: string, mode?: 'numeric') => (
    <input
      id={'mf-' + key}
      value={d[key]}
      placeholder={placeholder}
      inputMode={mode}
      onChange={(e) => set(key, e.target.value)}
    />
  )

  const back = () => (p.editing ? p.go({ page: 'detail', id: p.editing.id }) : p.go({ page: 'list' }))

  return (
    <div className="column">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <BackLink label={p.editing ? '会议详情' : '会议日程'} onClick={back} />
        <h1 className="page-title">{p.editing ? '编辑会议' : '新建会议'}</h1>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span id="kind-label" className="subtle" style={{ fontSize: 13 }}>
          怎么开
        </span>
        <div className="choice-row" role="group" aria-labelledby="kind-label">
          {(['online', 'offline', 'hybrid'] as const).map((k) => (
            <button key={k} className="choice" aria-pressed={d.kind === k} onClick={() => setKind(k)}>
              {k === 'hybrid' ? '混合（线下 + 腾讯会议）' : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {d.kind !== 'offline' && (
        <section className="paste-box">
          <label htmlFor="invite" style={{ fontWeight: 600 }}>
            粘贴腾讯会议邀请，自动识别
          </label>
          <span className="tiny">在腾讯会议或微信里复制整段邀请文字，粘贴到这里。</span>
          <textarea
            id="invite"
            className="note"
            rows={5}
            value={inviteText}
            placeholder={'会议主题：…\n会议时间：…\n#腾讯会议：…'}
            onChange={(e) => setInviteText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (pasted) setTimeout(() => recognize(pasted))
            }}
          />
          <div className="btn-row">
            <button className="btn" onClick={() => recognize(inviteText)} disabled={!inviteText.trim()}>
              识别
            </button>
            {recognized.size > 0 && (
              <span role="status" className="ok-line">
                <CheckIcon size={14} />
                已识别 {recognized.size} 项，请核对下面的信息
              </span>
            )}
          </div>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="section-title">会议信息</h2>
        <div className="form-grid">
          {field('title', '会议主题', text('title', '例如：产品周会'), true)}
          {field(
            'date',
            '日期',
            <input id="mf-date" type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />,
          )}
          <div className="form-pair">
            {field('start', '开始', <input id="mf-start" type="time" value={d.start} onChange={(e) => set('start', e.target.value)} />)}
            {field('end', '结束', <input id="mf-end" type="time" value={d.end} onChange={(e) => set('end', e.target.value)} />)}
          </div>
          {d.kind !== 'online' && field('location', '地点 / 会议室', text('location', '例如：3 楼 小会议室'), true)}
          {d.kind !== 'offline' && field('meetingNo', '腾讯会议号', text('meetingNo', '9 位会议号', 'numeric'))}
          {d.kind !== 'offline' && field('password', '会议密码', text('password', '没有可不填'))}
          {d.kind !== 'offline' && field('link', '入会链接', text('link', 'https://meeting.tencent.com/…'), true)}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="section-title">提醒与重复</h2>
        <div className="field-inline">
          <label htmlFor="mf-remind">会前</label>
          <select
            id="mf-remind"
            value={d.remindBefore}
            onChange={(e) => {
              setRemindTouched(true)
              set('remindBefore', Number(e.target.value))
            }}
          >
            {REMIND_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '不提醒' : `${n} 分钟提醒我`}
              </option>
            ))}
          </select>
          {d.kind === 'offline' && <span className="tiny">线下会议多留几分钟走过去</span>}
        </div>
        <span className="tiny">开始记录过的会，结束 30 分钟后还没整理纪要，会再提醒一次。</span>
        <div className="field-inline" style={{ marginTop: 6 }}>
          <label htmlFor="mf-repeat">重复</label>
          <select id="mf-repeat" value={d.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)}>
            {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
              <option key={r} value={r}>
                {r === 'none' ? '不重复' : `${REPEAT_LABEL[r]}（例会）`}
              </option>
            ))}
          </select>
          {recognized.has('repeat') && <span className="badge kind-online">已识别</span>}
        </div>
        {d.repeat !== 'none' && (
          <span className="tiny">例会会自动生成下一次；上次留下、还没完成的待办会在下一次的详情和记录页里显示。</span>
        )}
        {p.editing?.seriesId && (
          <span className="tiny">
            {d.repeat === 'none' ? '改成不重复后，以后还没开的几次会删掉。' : '主题、时间、地点、会议号会同步修改到以后还没开的几次。'}
          </span>
        )}
      </section>

      {!p.editing && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="mf-prep" className="section-title">
            会前备注 <span className="tiny" style={{ fontWeight: 400 }}>（可选）</span>
          </label>
          <span className="tiny">想问的问题、要带的东西，一行一条。开会时会显示在记录页旁边。</span>
          <textarea
            id="mf-prep"
            className="note"
            rows={3}
            value={prepText}
            placeholder="例如：问清首页灰度从哪天开始"
            onChange={(e) => setPrepText(e.target.value)}
          />
        </section>
      )}

      {error && (
        <div role="alert" className="error-line">
          {error}
        </div>
      )}

      <div className="form-actions">
        <button className="btn tall" onClick={back}>
          取消
        </button>
        <button className="btn primary tall" onClick={() => void save()}>
          保存会议
        </button>
      </div>
    </div>
  )
}
