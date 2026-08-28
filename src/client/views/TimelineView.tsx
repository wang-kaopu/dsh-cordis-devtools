import type { ReactNode } from 'react'
import { DisclosureRow, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DispatchRecord } from '../../shared/types.js'
import detailCss from '../DetailList.module.css'
import css from '../DevtoolsPanel.module.css'

export interface TimelineViewProps {
  dispatches: DispatchRecord[]
  expanded: ReadonlySet<number>
  liveFiberUids: ReadonlySet<number>
  onToggle(id: number): void
  onOpenFiber(uid: number): void
}

export function TimelineView({
  dispatches,
  expanded,
  liveFiberUids,
  onToggle,
  onOpenFiber,
}: TimelineViewProps) {
  return (
    <main className={css.timeline} aria-label="Recent Cordis dispatches">
      <div className={css.timelineNotice}>
        Recent bounded dispatches. Dispatch scope is the explicit Cordis thisArg when provided, not the producer Fiber.
      </div>
      {dispatches.length === 0 ? (
        <div className={css.empty}>No matching dispatches.</div>
      ) : (
        <div className={css.timelineList}>
          {dispatches.map((record) => {
            const scope = record.thisFiber
            const scopeIsLive = scope?.uid !== null
              && scope?.uid !== undefined
              && liveFiberUids.has(scope.uid)
            return (
              <div key={record.id} data-dispatch-id={record.id} className={css.timelineCard}>
                <DisclosureRow
                  icon={<span className={css.dispatchDot} aria-hidden />}
                  title={record.event}
                  open={expanded.has(record.id)}
                  expandable
                  expandOnRowClick
                  onToggle={() => { onToggle(record.id) }}
                  collapsedContent={(
                    <span className={css.timelineCollapsed}>
                      <Pill>{record.mode}</Pill>
                      <span className={css.timelineMeta}>{formatTime(record.timestamp)}</span>
                      <span className={css.timelineMeta}>{record.registeredListeners} registered</span>
                    </span>
                  )}
                >
                  <dl className={detailCss.timelineDetails}>
                    <Detail label="dispatch id" value={String(record.id)} />
                    <Detail label="mode" value={String(record.mode)} />
                    <Detail label="arguments" value={String(record.argCount)} />
                    <Detail label="registered listeners" value={String(record.registeredListeners)} />
                    <Detail
                      label="dispatch scope"
                      value={scope === null
                        ? 'none'
                        : scopeIsLive && scope.uid !== null
                          ? (
                              <span className={detailCss.detailPills}>
                                <Pill onClick={() => { onOpenFiber(scope.uid as number) }}>{scope.name}</Pill>
                                <span>uid {scope.uid} · {scope.state}</span>
                              </span>
                            )
                          : `${scope.name} · uid ${scope.uid ?? 'disposed'} · ${scope.state} · not live`}
                    />
                  </dl>
                </DisclosureRow>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}
