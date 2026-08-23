import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import type { ListenerSnapshot } from '../shared/types.js'
import type { EventExplorerStore } from './store.js'

export interface EventExplorerActionProps {
  wide: boolean
  store: EventExplorerStore
}

export function EventExplorerAction({ wide, store }: EventExplorerActionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()
  const rootRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={rootRef} data-cordis-devtools="root" style={styles.root}>
      <button
        type="button"
        data-testid="cordis-devtools-trigger"
        aria-label="Open Cordis DevTools"
        aria-expanded={open}
        title="Cordis DevTools"
        style={{ ...styles.trigger, ...(wide ? styles.triggerWide : styles.triggerRail) }}
        onClick={() => { setOpen(current => !current) }}
      >
        <span aria-hidden style={styles.triggerGlyph}>{'{ }'}</span>
        {wide && <span>Cordis DevTools</span>}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Cordis Event Explorer"
          data-testid="cordis-devtools-panel"
          style={{
            ...styles.panel,
            left: anchor?.left ?? 8,
            bottom: anchor?.bottom ?? 72,
          }}
        >
          <header style={styles.header}>
            <div>
              <strong style={styles.title}>Event Explorer</strong>
              <div style={styles.subtitle}>
                {state.snapshot === undefined
                  ? 'Runtime snapshot unavailable'
                  : `${state.snapshot.events.length} events · ${state.snapshot.listeners.length} listeners`}
              </div>
            </div>
            <div style={styles.headerActions}>
              <button
                type="button"
                data-testid="cordis-devtools-refresh"
                style={styles.smallButton}
                disabled={state.loading}
                onClick={() => { void store.refresh() }}
              >
                {state.loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                aria-label="Close Cordis DevTools"
                style={styles.iconButton}
                onClick={() => { setOpen(false) }}
              >
                ×
              </button>
            </div>
          </header>

          {state.error !== undefined && (
            <div
              role="status"
              data-testid="cordis-devtools-error"
              style={styles.error}
            >
              {state.stale ? 'Stale snapshot · ' : ''}{state.error}
            </div>
          )}

          <div style={styles.toolbar}>
            <input
              data-testid="cordis-devtools-search"
              aria-label="Search Cordis events"
              placeholder="Search events…"
              value={query}
              style={styles.search}
              onChange={event => { setQuery(event.currentTarget.value) }}
            />
            {state.snapshot !== undefined && (
              <span style={styles.timestamp}>
                {new Date(state.snapshot.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {state.snapshot === undefined ? (
            <div style={styles.empty}>
              {state.loading ? 'Loading runtime snapshot…' : 'No runtime snapshot.'}
            </div>
          ) : (
            <div style={styles.body}>
              <nav aria-label="Cordis events" style={styles.eventList}>
                {visibleEvents.length === 0 && (
                  <div style={styles.emptyList}>No matching events.</div>
                )}
                {visibleEvents.map(event => (
                  <button
                    type="button"
                    key={event.name}
                    data-event-name={event.name}
                    style={{
                      ...styles.eventButton,
                      ...(activeEvent?.name === event.name ? styles.eventButtonActive : {}),
                    }}
                    onClick={() => { setSelected(event.name) }}
                  >
                    <span style={styles.eventName}>{event.name}</span>
                    <span style={styles.count}>{event.listenerCount}</span>
                  </button>
                ))}
              </nav>

              <main style={styles.detail}>
                {activeEvent === undefined ? (
                  <div style={styles.empty}>Select an event.</div>
                ) : (
                  <>
                    <div style={styles.detailHeader}>
                      <strong style={styles.eventHeading}>{activeEvent.name}</strong>
                      <span style={styles.detailMeta}>{activeEvent.listenerCount} live listeners</span>
                    </div>
                    <div style={styles.listenerList}>
                      {activeListeners.map(listener => (
                        <article
                          key={listener.id}
                          data-listener-id={listener.id}
                          style={styles.listenerCard}
                        >
                          <div style={styles.listenerHead}>
                            <span style={styles.order}>#{listener.order}</span>
                            <code style={styles.listenerId}>listener {listener.id}</code>
                            <span style={styles.flags}>
                              {listener.prepend && <Flag>prepend</Flag>}
                              {listener.global && <Flag>global</Flag>}
                              {!listener.prepend && !listener.global && <span style={styles.muted}>normal</span>}
                            </span>
                          </div>
                          <div style={styles.ownerRow}>
                            <span style={styles.ownerLabel}>owner</span>
                            {listener.owner === null ? (
                              <span style={styles.muted}>unknown</span>
                            ) : (
                              <>
                                <strong>{listener.owner.name}</strong>
                                <span style={styles.muted}>
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
          )}
        </section>
      )}
    </div>
  )
}

function Flag({ children }: { children: string }) {
  return <span style={styles.flag}>{children}</span>
}

const layer = 'var(--dsw-alias-bg-layer-1, #fff)'
const layerRaised = 'var(--dsw-alias-bg-layer-2, #f7f7f8)'
const text = 'var(--dsw-alias-label-primary, #1f2328)'
const muted = 'var(--dsw-alias-label-secondary, #68707a)'
const border = 'var(--dsw-alias-border-primary, #d9dee5)'
const accent = 'var(--dsw-alias-brand-primary, #4f67ff)'

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative' },
  trigger: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 36, border: 'none', borderRadius: 8, background: 'transparent',
    color: text, cursor: 'pointer', font: 'inherit',
  },
  triggerWide: { width: '100%', justifyContent: 'flex-start', padding: '0 10px' },
  triggerRail: { width: 36, padding: 0 },
  triggerGlyph: { fontFamily: 'monospace', fontWeight: 700, color: accent },
  panel: {
    position: 'fixed', zIndex: 1000, width: 'min(760px, calc(100vw - 32px))',
    height: 'min(560px, 72vh)', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', border: `1px solid ${border}`, borderRadius: 12,
    background: layer, color: text, boxShadow: '0 18px 54px rgba(0,0,0,.22)',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '14px 16px', borderBottom: `1px solid ${border}`,
  },
  title: { fontSize: 15 },
  subtitle: { marginTop: 3, color: muted, fontSize: 12 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  smallButton: {
    border: `1px solid ${border}`, borderRadius: 7, padding: '5px 9px', background: layerRaised,
    color: text, cursor: 'pointer', font: 'inherit', fontSize: 12,
  },
  iconButton: {
    width: 30, height: 30, border: 'none', borderRadius: 7, background: 'transparent',
    color: muted, cursor: 'pointer', fontSize: 20, lineHeight: 1,
  },
  error: {
    padding: '8px 16px', borderBottom: `1px solid ${border}`,
    background: 'rgba(220, 60, 60, .08)', color: text, fontSize: 12,
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    borderBottom: `1px solid ${border}`,
  },
  search: {
    flex: 1, minWidth: 0, border: `1px solid ${border}`, borderRadius: 8,
    background: layerRaised, color: text, padding: '7px 9px', font: 'inherit', fontSize: 13,
  },
  timestamp: { color: muted, fontSize: 11, whiteSpace: 'nowrap' },
  body: { display: 'grid', gridTemplateColumns: 'minmax(220px, 34%) 1fr', minHeight: 0, flex: 1 },
  eventList: {
    minHeight: 0, overflow: 'auto', padding: 8, borderRight: `1px solid ${border}`,
    background: layerRaised,
  },
  eventButton: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 'none',
    borderRadius: 7, padding: '7px 8px', background: 'transparent', color: text,
    cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  eventButtonActive: { background: 'rgba(79, 103, 255, .12)' },
  eventName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 },
  count: { color: muted, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  emptyList: { padding: 10, color: muted, fontSize: 12 },
  detail: { minWidth: 0, minHeight: 0, overflow: 'auto', padding: 14 },
  detailHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  eventHeading: { minWidth: 0, overflowWrap: 'anywhere', fontSize: 14 },
  detailMeta: { color: muted, fontSize: 11, whiteSpace: 'nowrap' },
  listenerList: { display: 'grid', gap: 8 },
  listenerCard: { border: `1px solid ${border}`, borderRadius: 9, padding: 10, background: layerRaised },
  listenerHead: { display: 'flex', alignItems: 'center', gap: 8 },
  order: { width: 28, color: accent, fontWeight: 700, fontSize: 12 },
  listenerId: { fontSize: 11, color: text },
  flags: { marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' },
  flag: { padding: '2px 5px', borderRadius: 999, background: 'rgba(79, 103, 255, .12)', color: accent, fontSize: 10 },
  ownerRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 8, fontSize: 12 },
  ownerLabel: { color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' },
  listenerIdLabel: { color: muted },
  muted: { color: muted, fontSize: 11 },
  empty: { display: 'grid', placeItems: 'center', minHeight: 120, padding: 20, color: muted, fontSize: 12 },
}
