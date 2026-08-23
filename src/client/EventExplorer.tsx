import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Button,
  DisclosureRow,
  IconCloseOutline16,
  IconCordisPluginOutline14,
  IconRefreshOutline16,
  IconSearchOutline16,
  Input,
  Pill,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DispatchRecord, ListenerSnapshot } from '../shared/types.js'
import type { EventExplorerStore } from './store.js'
import css from './DevtoolsPanel.module.css'

export interface EventExplorerActionProps {
  wide: boolean
  store: EventExplorerStore
}

type DevtoolsView = 'events' | 'timeline'

export function EventExplorerAction({ wide, store }: EventExplorerActionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DevtoolsView>('events')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [expandedDispatches, setExpandedDispatches] = useState<ReadonlySet<number>>(new Set())
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()
  const rootRef = useRef<HTMLDivElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  useEffect(() => {
    store.setOpen(open)
    return () => { if (open) store.setOpen(false) }
  }, [open, store])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect !== undefined) {
        setAnchor({
          left: Math.max(8, rect.left),
          bottom: Math.max(8, window.innerHeight - rect.top + 8),
        })
      }
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open, wide])

  const events = state.snapshot?.events ?? []
  const dispatches = state.snapshot?.dispatches ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEvents = useMemo(
    () => events.filter(event => event.name.toLowerCase().includes(normalizedQuery)),
    [events, normalizedQuery],
  )

  useEffect(() => {
    if (events.length === 0) {
      if (selected !== undefined) setSelected(undefined)
      return
    }
    if (selected === undefined || !events.some(event => event.name === selected)) {
      setSelected(events[0].name)
    }
  }, [events, selected])

  const activeEvent = visibleEvents.find(event => event.name === selected) ?? visibleEvents[0]
  const listenersById = useMemo(
    () => new Map((state.snapshot?.listeners ?? []).map(listener => [listener.id, listener])),
    [state.snapshot],
  )
  const activeListeners = activeEvent?.listenerIds
    .map(id => listenersById.get(id))
    .filter((listener): listener is ListenerSnapshot => listener !== undefined) ?? []

  const modes = useMemo(
    () => [...new Set(dispatches.map(record => String(record.mode)))].sort(),
    [dispatches],
  )

  useEffect(() => {
    if (modeFilter !== 'all' && !modes.includes(modeFilter)) setModeFilter('all')
  }, [modeFilter, modes])

  const visibleDispatches = useMemo(() => {
    return [...dispatches]
      .reverse()
      .filter(record => modeFilter === 'all' || record.mode === modeFilter)
      .filter((record) => {
        if (normalizedQuery.length === 0) return true
        return record.event.toLowerCase().includes(normalizedQuery)
          || record.thisFiber?.name.toLowerCase().includes(normalizedQuery) === true
      })
  }, [dispatches, modeFilter, normalizedQuery])

  const toggleDispatch = (id: number): void => {
    setExpandedDispatches((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const switchView = (next: DevtoolsView): void => {
    setView(next)
    setQuery('')
  }

  const subtitle = state.snapshot === undefined
    ? 'Runtime snapshot unavailable'
    : view === 'events'
      ? `${state.snapshot.events.length} events · ${state.snapshot.listeners.length} listeners`
      : `${state.snapshot.dispatches.length} recent dispatches · bounded history`

  return (
    <div ref={rootRef} data-cordis-devtools="root" className={css.root}>
      <Tooltip label="Cordis DevTools" side="right" disabled={wide}>
        <Button
          variant="ghost"
          size="md"
          icon={<IconCordisPluginOutline14 size={16} />}
          className={`${css.trigger} ${wide ? css.triggerWide : css.triggerRail}`}
          data-testid="cordis-devtools-trigger"
          aria-label="Open Cordis DevTools"
          aria-expanded={open}
          onClick={() => { setOpen(current => !current) }}
        >
          {wide ? 'Cordis DevTools' : undefined}
        </Button>
      </Tooltip>

      {open && (
        <section
          role="dialog"
          aria-label="Cordis DevTools"
          data-testid="cordis-devtools-panel"
          className={css.panel}
          style={{ left: anchor?.left ?? 8, bottom: anchor?.bottom ?? 72 }}
        >
          <header className={css.header}>
            <div>
              <div className={css.title}>Cordis DevTools</div>
              <div className={css.subtitle}>{subtitle}</div>
            </div>
            <div className={css.headerActions}>
              <Tooltip label="Refresh runtime snapshot" side="bottom" delayMs={400}>
                <Button
                  variant="toolbar"
                  size="sm"
                  icon={<IconRefreshOutline16 size={16} />}
                  data-testid="cordis-devtools-refresh"
                  disabled={state.loading}
                  onClick={() => { void store.refresh() }}
                >
                  Refresh
                </Button>
              </Tooltip>
              <Tooltip label="Close Cordis DevTools" side="bottom" delayMs={400}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconCloseOutline16 size={16} />}
                  className={css.iconOnly}
                  aria-label="Close Cordis DevTools"
                  onClick={() => { setOpen(false) }}
                />
              </Tooltip>
            </div>
          </header>

          {state.error !== undefined && (
            <div role="status" data-testid="cordis-devtools-error" className={css.error}>
              {state.stale ? 'Stale snapshot · ' : ''}{state.error}
            </div>
          )}

          <div className={css.viewBar} aria-label="Cordis DevTools views">
            <Pill active={view === 'events'} onClick={() => { switchView('events') }}>Events</Pill>
            <Pill active={view === 'timeline'} onClick={() => { switchView('timeline') }}>Timeline</Pill>
          </div>

          <div className={css.toolbar}>
            <Input
              icon={<IconSearchOutline16 size={16} />}
              className={css.search}
              data-testid="cordis-devtools-search"
              aria-label={view === 'events' ? 'Search Cordis events' : 'Search Cordis dispatches'}
              placeholder={view === 'events' ? 'Search events…' : 'Search event or dispatch context…'}
              value={query}
              onChange={event => { setQuery(event.currentTarget.value) }}
            />
            {state.snapshot !== undefined && (
              <span className={css.timestamp}>
                {new Date(state.snapshot.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {view === 'timeline' && state.snapshot !== undefined && (
            <div className={css.modeFilters} data-testid="cordis-devtools-mode-filters">
              <Pill active={modeFilter === 'all'} onClick={() => { setModeFilter('all') }}>all</Pill>
              {modes.map(mode => (
                <Pill
                  key={mode}
                  active={modeFilter === mode}
                  onClick={() => { setModeFilter(mode) }}
                >
                  {mode}
                </Pill>
              ))}
            </div>
          )}

          <div className={css.body}>
            {state.snapshot === undefined ? (
              <div className={css.empty}>
                {state.loading ? 'Loading runtime snapshot…' : 'No runtime snapshot.'}
              </div>
            ) : view === 'events' ? (
              <EventsView
                visibleEvents={visibleEvents}
                activeEventName={activeEvent?.name}
                activeListeners={activeListeners}
                onSelect={setSelected}
              />
            ) : (
              <TimelineView
                dispatches={visibleDispatches}
                expanded={expandedDispatches}
                onToggle={toggleDispatch}
              />
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function EventsView({
  visibleEvents,
  activeEventName,
  activeListeners,
  onSelect,
}: {
  visibleEvents: Array<{ name: string; listenerCount: number }>
  activeEventName?: string
  activeListeners: ListenerSnapshot[]
  onSelect(name: string): void
}) {
  const activeEvent = visibleEvents.find(event => event.name === activeEventName) ?? visibleEvents[0]
  return (
    <div className={css.eventsBody}>
      <nav aria-label="Cordis events" className={css.eventList}>
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
              {activeListeners.map(listener => (
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
                    {listener.owner === null ? (
                      <span className={css.muted}>unknown</span>
                    ) : (
                      <>
                        <strong>{listener.owner.name}</strong>
                        <span className={css.ownerMeta}>
                          uid {listener.owner.uid ?? 'disposed'} · {listener.owner.state}
                        </span>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function TimelineView({
  dispatches,
  expanded,
  onToggle,
}: {
  dispatches: DispatchRecord[]
  expanded: ReadonlySet<number>
  onToggle(id: number): void
}) {
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
