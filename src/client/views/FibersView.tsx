import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DispatchRecord, ListenerSnapshot, LiveFiberSnapshot } from '../../shared/types.js'
import css from '../DevtoolsPanel.module.css'

export interface FibersViewProps {
  visibleFibers: LiveFiberSnapshot[]
  activeFiberUid?: number
  listeners: ListenerSnapshot[]
  dispatches: DispatchRecord[]
  onSelect(uid: number): void
}

export function FibersView({
  visibleFibers,
  activeFiberUid,
  listeners,
  dispatches,
  onSelect,
}: FibersViewProps) {
  const activeFiber = visibleFibers.find(fiber => fiber.uid === activeFiberUid) ?? visibleFibers[0]
  const ownedListeners = activeFiber === undefined
    ? []
    : listeners.filter(listener => listener.owner?.uid === activeFiber.uid)
  const ownedEventCount = new Set(ownedListeners.map(listener => listener.event)).size
  const recentDispatchHits = activeFiber === undefined
    ? 0
    : dispatches.filter(record => record.thisFiber?.uid === activeFiber.uid).length

  return (
    <div className={css.fibersBody}>
      <nav aria-label="Live Cordis fibers" className={css.fiberList}>
        {visibleFibers.length === 0 && <div className={css.emptyList}>No matching live fibers.</div>}
        {visibleFibers.map(fiber => (
          <button
            type="button"
            key={fiber.uid}
            data-fiber-uid={fiber.uid}
            className={`${css.fiberButton} ${activeFiber?.uid === fiber.uid ? css.fiberButtonActive : ''}`}
            onClick={() => { onSelect(fiber.uid) }}
          >
            <span className={css.fiberName}>{fiber.name}</span>
            <span className={css.fiberListMeta}>uid {fiber.uid}</span>
            <Pill>{fiber.state}</Pill>
          </button>
        ))}
      </nav>

      <main className={css.fiberDetail} data-testid="cordis-devtools-fiber-detail">
        {activeFiber === undefined ? (
          <div className={css.empty}>Select a live fiber.</div>
        ) : (
          <>
            <div className={css.detailHeader}>
              <strong className={css.eventHeading}>{activeFiber.name}</strong>
              <span className={css.detailMeta}>uid {activeFiber.uid} · {activeFiber.state}</span>
            </div>

            <div className={css.fiberStats}>
              <FiberStat label="owned listeners" value={ownedListeners.length} />
              <FiberStat label="owned events" value={ownedEventCount} />
              <FiberStat label="recent dispatch-context hits" value={recentDispatchHits} />
            </div>

            <div className={css.fiberFacts}>
              <Detail label="state" value={activeFiber.state} />
              <Detail
                label="parent"
                value={activeFiber.parent === null
                  ? 'unknown'
                  : `${activeFiber.parent.name} · uid ${activeFiber.parent.uid ?? 'disposed'} · ${activeFiber.parent.state}`}
              />
              <div className={css.fiberInjectRow}>
                <span className={css.detailLabel}>inject</span>
                {activeFiber.inject.length === 0 ? (
                  <span className={css.muted}>none</span>
                ) : (
                  <span className={css.injectPills}>
                    {activeFiber.inject.map(name => <Pill key={name}>{name}</Pill>)}
                  </span>
                )}
              </div>
            </div>

            <div className={css.fiberNotice}>
              Live registry inventory. Dispatch-context hits come only from the current bounded Timeline window.
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function FiberStat({ label, value }: { label: string; value: number }) {
  return (
    <div className={css.fiberStat}>
      <strong className={css.fiberStatValue}>{value}</strong>
      <span className={css.fiberStatLabel}>{label}</span>
    </div>
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
