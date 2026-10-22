import { DetailView } from './DetailView'
import { FormView } from './FormView'
import { ListView } from './ListView'
import { LiveView } from './LiveView'
import { MinutesView } from './MinutesView'
import { NotFound, type MeetingProps, type MeetingRoute } from './shared'

export { ActionsView } from './ActionsView'
export type { MeetingProps, MeetingRoute } from './shared'

export function MeetingsSection(p: MeetingProps & { route: MeetingRoute; onOpenActions: () => void }) {
  const { route } = p
  if (route.page === 'list') return <ListView {...p} />
  if (route.page === 'new') return <FormView key={route.invite ?? 'new'} {...p} invite={route.invite} />
  const m = p.meetings.find((x) => x.id === route.id)
  if (!m) return <NotFound go={p.go} />
  if (route.page === 'edit') return <FormView key={m.id} {...p} editing={m} />
  if (route.page === 'live') return <LiveView key={m.id} {...p} m={m} />
  if (route.page === 'minutes') return <MinutesView key={m.id} {...p} m={m} />
  return <DetailView {...p} m={m} />
}
