import { useEffect, useRef } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListenerSnapshot } from '../../shared/types.js'
import css from '../DevtoolsPanel.module.css'

export interface EventsViewProps {
  visibleEvents: Array<{ name: string; listenerCount: number }>
  activeEventName?: string
  activeListeners: ListenerSnapshot[]
  liveFiberUids: ReadonlySet<number>
  onSelect(name: string): void
  onOpenFiber(uid: number): void
}

export function EventsView({
  visibleEvents,
  activeEventName,
  activeListeners,
  liveFiberUids,
  onSelect,
  onOpenFiber,
}: EventsViewProps) {
  const listRef = useRef<HTMLElement>(null)
  const activeEvent = visibleEvents.find(event => event.name === activeEventName) ?? visibleEvents[0]

  useEffect(() => {
    if (activeEvent === undefined) return
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-event-name]') ?? [])]
      .find(element => element.dataset.eventName === activeEvent.name)
    if (typeof row?.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeEvent?.name])

  return (
    <div className={css.eventsBody}>
      <nav ref={listRef} aria-label="Cordis events" className={css.eventList}>
        {visibleEvents.length === 0 && <div className={css.emptyList}>No matching events.</div>}
        {visibleEvents.map(event => (
          <button
            type="button"
            key={event.name}
            data-event-name={event.name}
            className={`${css.eventButton} ${activeEvent?.name === event.name ? css.eventButtonActive : ''}`}
            onClick={() => { onSelect(event.name) }}
          >
            <span className={css.eventName}>{event.name}</span>
            <span className={css.count}>{event.listenerCount}</span>
          </button>
        ))}
      </nav>

      <main className={css.detail}>
        {activeEvent === undefined ? (
          <div className={css.empty}>Select an event.</div>
        ) : (
          <>
            <div className={css.detailHeader}>
              <strong className={css.eventHeading}>{activeEvent.name}</strong>
              <span className={css.detailMeta}>{activeEvent.listenerCount} live listeners</span>
            </div>
            <div className={css.listenerList}>
              {activeListeners.map((listener) => {
                const owner = listener.owner
                const ownerIsLive = owner?.uid !== null
                  && owner?.uid !== undefined
                  && liveFiberUids.has(owner.uid)
                return (
                  <article key={listener.id} data-listener-id={listener.id} className={css.listenerCard}>
                    <div className={css.listenerHead}>
                      <span className={css.order}>#{listener.order}</span>
                      <code className={css.listenerId}>listener {listener.id}</code>
                      <span className={css.flags}>
                        {listener.prepend && <Pill>prepend</Pill>}
                        {listener.global && <Pill>global</Pill>}
                        {!listener.prepend && !listener.global && <span className={css.muted}>normal</span>}
                      </span>
                    </div>
                    <div className={css.ownerRow}>
                      <span className={css.ownerLabel}>owner</span>
                      {owner === null ? (
                        <span className={css.muted}>unknown</span>
                      ) : (
                        <>
                          {ownerIsLive && owner.uid !== null ? (
                            <Pill onClick={() => { onOpenFiber(owner.uid as number) }}>{owner.name}</Pill>
                          ) : (
                            <strong>{owner.name}</strong>
                          )}
                          <span className={css.ownerMeta}>
                            uid {owner.uid ?? 'disposed'} · {owner.state}{ownerIsLive ? '' : ' · not live'}
                          </span>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
