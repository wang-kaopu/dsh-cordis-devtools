import { DisclosureRow, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DispatchRecord } from '../../shared/types.js'
import css from '../DevtoolsPanel.module.css'

export interface TimelineViewProps {
  dispatches: DispatchRecord[]
  expanded: ReadonlySet<number>
  onToggle(id: number): void
}

export function TimelineView({ dispatches, expanded, onToggle }: TimelineViewProps) {
  return (
    <main className={css.timeline} aria-label="Recent Cordis dispatches">
      <div className={css.timelineNotice}>
        Recent bounded dispatches. This view is not a complete or lossless audit log.
      </div>
      {dispatches.length === 0 ? (
        <div className={css.empty}>No matching dispatches.</div>
      ) : (
        <div className={css.timelineList}>
          {dispatches.map(record => (
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
                <div className={css.timelineDetail}>
                  <Detail label="dispatch id" value={String(record.id)} />
                  <Detail label="mode" value={String(record.mode)} />
                  <Detail label="arguments" value={String(record.argCount)} />
                  <Detail label="registered listeners" value={String(record.registeredListeners)} />
                  <Detail
                    label="dispatch context"
                    value={record.thisFiber === null
                      ? 'unknown'
                      : `${record.thisFiber.name} · uid ${record.thisFiber.uid ?? 'disposed'} · ${record.thisFiber.state}`}
                  />
                </div>
              </DisclosureRow>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.timelineDetailRow}>
      <span className={css.detailLabel}>{label}</span>
      <span className={css.detailValue}>{value}</span>
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
