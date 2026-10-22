import { useState, type RefObject } from 'react'
import { parseQuickAdd } from '../lib/parse'
import { relativeLabel } from '../lib/date'
import { looksLikeInvite } from '../lib/invite'
import { addTask } from '../store'
import { PlusIcon } from './Icons'

interface Props {
  today: string
  /** 没写日期时放到哪里：今天，或 null 表示收集箱 */
  defaultDate: string | null
  placeholder: string
  inputRef: RefObject<HTMLInputElement | null>
  onNotice: (text: string) => void
  onInvite: (text: string) => void
}

export function QuickAdd({ today, defaultDate, placeholder, inputRef, onNotice, onInvite }: Props) {
  const [draft, setDraft] = useState('')
  const parsed = parseQuickAdd(draft, today)
  const target = parsed.date ?? defaultDate
  const targetLabel = target === null ? '收集箱' : relativeLabel(target, today)

  async function submit() {
    if (!parsed.title) return
    // 先清空再保存：保存是异步的，晚清空会吞掉用户紧接着输入的下一条
    setDraft('')
    await addTask({ title: parsed.title, date: target, time: parsed.time, star: parsed.star, tag: parsed.tag })
    // 加到当前页看不到的地方时，提示一下去了哪里
    if (target !== defaultDate) onNotice(`已加入「${targetLabel}」`)
  }

  return (
    <div>
      <div className="quick-add">
        <PlusIcon color="var(--accent)" />
        <label htmlFor="quick-add" className="sr-only">
          添加一件事
        </label>
        <input
          id="quick-add"
          ref={inputRef}
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            // 粘贴的是腾讯会议邀请，就去新建会议
            const text = e.clipboardData.getData('text')
            if (looksLikeInvite(text)) {
              e.preventDefault()
              onInvite(text)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
            if (e.key === 'Escape') {
              setDraft('')
              e.currentTarget.blur()
            }
          }}
        />
        <span className="kbd">Ctrl K</span>
      </div>
      {draft.trim() && parsed.chips.length > 0 && (
        <div className="chips">
          <span>识别到</span>
          {parsed.chips.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
          <span>· 回车加入「{targetLabel}」</span>
        </div>
      )}
    </div>
  )
}
