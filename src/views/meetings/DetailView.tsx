import type { Meeting } from '../../db'
import { longLabel, relativeLabel } from '../../lib/date'
import { formatMeetingNo } from '../../lib/invite'
import { isMine, isOthers, joinText, meetingStatus, statusLabel, timeRange } from '../../lib/meeting'
import { deleteMeeting, restoreMeeting } from '../../meetings'
import { ClockIcon, CopyIcon, PinIcon, VideoIcon } from '../../components/Icons'
import { REPEAT_LABEL } from '../../lib/series'
import { toIcs } from '../../lib/ics'
import { BackLink, KindBadge, copyText, downloadText, type MeetingProps } from './shared'
import { CarryOverList, PrepList } from './parts'

export function DetailView({ m, ...p }: MeetingProps & { m: Meeting }) {
  const st = meetingStatus(m, p.now)
  const count = (type: string) => m.notes.filter((n) => n.type === type).length
  const mine = m.notes.filter(isMine).length
  const others = m.notes.filter(isOthers).length
  const hasNotes = m.notes.length > 0

  return (
    <div className="column">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <BackLink label="会议日程" onClick={() => p.go({ page: 'list' })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 className="page-title">{m.title}</h1>
          <KindBadge kind={m.kind} />
          {m.repeat !== 'none' && <span className="badge">例会 · {REPEAT_LABEL[m.repeat]}</span>}
          <span className="badge">{statusLabel(m, p.now)}</span>
        </div>
        <div className="info-lines">
          <span>
            <ClockIcon size={16} />
            {relativeLabel(m.date, p.today)} · {longLabel(m.date)} {timeRange(m)}
          </span>
          {m.kind !== 'online' && (
            <span>
              <PinIcon size={16} />
              {m.location || '地点未填写'}
            </span>
          )}
          {m.kind !== 'offline' && (
            <span>
              <VideoIcon size={16} />
              腾讯会议 {m.meetingNo ? formatMeetingNo(m.meetingNo) : '（会议号未填写）'}
              {m.password && ` · 密码 ${m.password}`}
            </span>
          )}
        </div>
        <div className="btn-row" style={{ paddingTop: 4 }}>
          {m.kind !== 'offline' && m.link && (
            <a className="btn primary tall" href={m.link} target="_blank" rel="noreferrer">
              <VideoIcon size={16} />
              腾讯会议入会
            </a>
          )}
          {m.kind !== 'offline' && m.meetingNo && (
            <button className="btn tall" onClick={() => void copyText(joinText(m), p.onNotice, '已复制会议号和密码')}>
              <CopyIcon size={16} />
              复制会议号和密码
            </button>
          )}
          <button className={'btn tall' + (m.kind === 'offline' || !m.link ? ' primary' : '')} onClick={() => p.go({ page: 'live', id: m.id })}>
            {m.startedAt && !m.endedAt ? '继续记录' : hasNotes ? '补充记录' : '开始记录'}
          </button>
          {(hasNotes || st === 'done') && (
            <button className="btn tall" onClick={() => p.go({ page: 'minutes', id: m.id })}>
              {st === 'done' ? '查看纪要' : '整理纪要'}
            </button>
          )}
        </div>
      </header>

      <CarryOverList m={m} {...p} />
      <PrepList m={m} />

      <section className="panel">
        <h2>记录</h2>
        {hasNotes ? (
          <span className="subtle" style={{ fontSize: 13 }}>
            共 {m.notes.length} 条：决议 {count('decision')} · 我的待办 {mine} · 别人的待办 {others} · 问题 {count('question')} · 笔记{' '}
            {count('note')}
          </span>
        ) : (
          <span className="subtle" style={{ fontSize: 13 }}>
            还没有记录。开会时点「开始记录」，随手记下结论和领到的活。
          </span>
        )}
      </section>

      <section className="panel">
        <h2>提醒</h2>
        <span className="subtle" style={{ fontSize: 13 }}>
          {m.remindBefore > 0 ? `会前 ${m.remindBefore} 分钟提醒` : '会前不提醒'}
          {m.remindedAt && ' · 已提醒'}
        </span>
      </section>

      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <button
          className="btn ghost danger"
          onClick={() => {
            void deleteMeeting(m.id)
            p.go({ page: 'list' })
            p.onNotice(`已删除「${m.title}」`, () => void restoreMeeting(m.id))
          }}
        >
          删除会议
        </button>
        <div className="btn-row">
          <button
            className="btn tall"
            onClick={() => {
              // 例会把整个系列一起导出，日历里会继续重复
              const list = m.seriesId ? p.meetings.filter((x) => x.seriesId === m.seriesId) : [m]
              downloadText(`mylog-${m.date}.ics`, toIcs(list), 'text/calendar')
              p.onNotice('已下载日历文件，双击就能导入系统日历')
            }}
          >
            加到日历
          </button>
          <button className="btn tall" onClick={() => p.go({ page: 'edit', id: m.id })}>
            编辑
          </button>
        </div>
      </div>
    </div>
  )
}
