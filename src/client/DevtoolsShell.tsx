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
  IconCloseOutline16,
  IconCordisPluginOutline14,
  IconRefreshOutline16,
  IconSearchOutline16,
  Input,
  Pill,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ListenerSnapshot } from '../shared/types.js'
import type { EventExplorerStore } from './store.js'
import type { ProfilerStore } from './profiler-store.js'
import { EventsView } from './views/EventsView.js'
import { TimelineView } from './views/TimelineView.js'
import { FibersView } from './views/FibersView.js'
import { ProfilerView } from './views/ProfilerView.js'
import css from './DevtoolsPanel.module.css'

export interface EventExplorerActionProps {
  wide: boolean
  store: EventExplorerStore
  profilerStore: ProfilerStore
}

type DevtoolsView = 'events' | 'timeline' | 'fibers' | 'profiler'

export function EventExplorerAction({ wide, store, profilerStore }: EventExplorerActionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const profilerState = useSyncExternalStore(
    profilerStore.subscribe,
    profilerStore.getSnapshot,
    profilerStore.getSnapshot,
  )
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DevtoolsView>('events')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [selectedFiberUid, setSelectedFiberUid] = useState<number>()
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [fiberStateFilter, setFiberStateFilter] = useState<string>('all')
  const [expandedDispatches, setExpandedDispatches] = useState<ReadonlySet<number>>(new Set())
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()
  const rootRef = useRef<HTMLDivElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  useEffect(() => {
    store.setOpen(open)
    return () => { if (open) store.setOpen(false) }
  }, [open, store])

  useEffect(() => {
    const active = open && view === 'profiler'
    profilerStore.setActive(active)
    return () => { if (active) profilerStore.setActive(false) }
  }, [open, profilerStore, view])

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
  const fibers = state.snapshot?.fibers ?? []
  const dispatches = state.snapshot?.dispatches ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleEvents = useMemo(
    () => events.filter(event => event.name.toLowerCase().includes(normalizedQuery)),
    [events, normalizedQuery],
  )
  const liveFiberUids = useMemo(
    () => new Set(fibers.map(fiber => fiber.uid)),
    [fibers],
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

  useEffect(() => {
    if (fibers.length === 0) {
      if (selectedFiberUid !== undefined) setSelectedFiberUid(undefined)
      return
    }
    if (selectedFiberUid === undefined || !fibers.some(fiber => fiber.uid === selectedFiberUid)) {
      setSelectedFiberUid(fibers[0].uid)
    }
  }, [fibers, selectedFiberUid])

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
  const fiberStates = useMemo(
    () => [...new Set(fibers.map(fiber => fiber.state))].sort(),
    [fibers],
  )

  useEffect(() => {
    if (modeFilter !== 'all' && !modes.includes(modeFilter)) setModeFilter('all')
  }, [modeFilter, modes])

  useEffect(() => {
    if (fiberStateFilter !== 'all' && !fiberStates.includes(fiberStateFilter)) setFiberStateFilter('all')
  }, [fiberStateFilter, fiberStates])

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

  const visibleFibers = useMemo(() => {
    return fibers
      .filter(fiber => fiberStateFilter === 'all' || fiber.state === fiberStateFilter)
      .filter((fiber) => {
        if (normalizedQuery.length === 0) return true
        return fiber.name.toLowerCase().includes(normalizedQuery)
          || String(fiber.uid).includes(normalizedQuery)
      })
  }, [fiberStateFilter, fibers, normalizedQuery])

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

  const openFiber = (uid: number): void => {
    if (!liveFiberUids.has(uid)) return
    setSelectedFiberUid(uid)
    setFiberStateFilter('all')
    setQuery('')
    setView('fibers')
  }

  const openEvent = (name: string): void => {
    if (!events.some(event => event.name === name)) return
    setSelected(name)
    setQuery('')
    setView('events')
  }

  const subtitle = view === 'profiler'
    ? profilerState.snapshot === undefined
      ? 'Profiler snapshot unavailable'
      : `${profilerState.snapshot.traces.length} waterfall traces · ${profilerState.snapshot.instrumentation}`
    : state.snapshot === undefined
      ? 'Runtime snapshot unavailable'
      : view === 'events'
        ? `${state.snapshot.events.length} events · ${state.snapshot.listeners.length} listeners`
        : view === 'timeline'
          ? `${state.snapshot.dispatches.length} recent dispatches · bounded history`
          : `${state.snapshot.fibers.length} live fibers · Cordis registry`

  const searchLabel = view === 'events'
    ? 'Search Cordis events'
    : view === 'timeline'
      ? 'Search Cordis dispatches'
      : 'Search live Cordis fibers'
  const searchPlaceholder = view === 'events'
    ? 'Search events…'
    : view === 'timeline'
      ? 'Search event or dispatch context…'
      : 'Search fiber name or uid…'
  const refreshLabel = view === 'profiler' ? 'Refresh profiler snapshot' : 'Refresh runtime snapshot'
  const activeError = view === 'profiler' ? profilerState.error : state.error
  const activeStale = view === 'profiler' ? profilerState.stale : state.stale

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
              <Tooltip label={refreshLabel} side="bottom" delayMs={400}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconRefreshOutline16 size={16} />}
                  className={css.iconOnly}
                  data-testid="cordis-devtools-refresh"
                  aria-label={refreshLabel}
                  disabled={view === 'profiler' ? profilerState.loading || profilerState.mutating : state.loading}
                  onClick={() => {
                    if (view === 'profiler') void profilerStore.refresh()
                    else void store.refresh()
                  }}
                />
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

          {activeError !== undefined && (
            <div role="status" data-testid="cordis-devtools-error" className={css.error}>
              {activeStale ? 'Stale snapshot · ' : ''}{activeError}
            </div>
          )}

          <div className={css.viewBar} aria-label="Cordis DevTools views">
            <Pill active={view === 'events'} onClick={() => { switchView('events') }}>Events</Pill>
            <Pill active={view === 'timeline'} onClick={() => { switchView('timeline') }}>Timeline</Pill>
            <Pill active={view === 'fibers'} onClick={() => { switchView('fibers') }}>Fibers</Pill>
            <Pill active={view === 'profiler'} onClick={() => { switchView('profiler') }}>Profiler</Pill>
          </div>

          {view !== 'profiler' && (
            <div className={css.toolbar}>
              <Input
                icon={<IconSearchOutline16 size={16} />}
                className={css.search}
                data-testid="cordis-devtools-search"
                aria-label={searchLabel}
                placeholder={searchPlaceholder}
                value={query}
                onChange={event => { setQuery(event.currentTarget.value) }}
              />
              {state.snapshot !== undefined && (
                <span className={css.timestamp}>
                  {new Date(state.snapshot.generatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}

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

          {view === 'fibers' && state.snapshot !== undefined && (
            <div className={css.modeFilters} data-testid="cordis-devtools-fiber-state-filters">
              <Pill active={fiberStateFilter === 'all'} onClick={() => { setFiberStateFilter('all') }}>all</Pill>
              {fiberStates.map(fiberState => (
                <Pill
                  key={fiberState}
                  active={fiberStateFilter === fiberState}
                  onClick={() => { setFiberStateFilter(fiberState) }}
                >
                  {fiberState}
                </Pill>
              ))}
            </div>
          )}

          <div className={css.body}>
            {view === 'profiler' ? (
              profilerState.snapshot === undefined ? (
                <div className={css.empty}>
                  {profilerState.loading ? 'Loading profiler snapshot…' : 'No profiler snapshot.'}
                </div>
              ) : (
                <ProfilerView
                  status={profilerState.snapshot.instrumentation}
                  traces={profilerState.snapshot.traces}
                  busy={profilerState.mutating}
                  onSetInstrumentation={enabled => { void profilerStore.setEnabled(enabled) }}
                  onOpenFiber={openFiber}
                />
              )
            ) : state.snapshot === undefined ? (
              <div className={css.empty}>
                {state.loading ? 'Loading runtime snapshot…' : 'No runtime snapshot.'}
              </div>
            ) : view === 'events' ? (
              <EventsView
                visibleEvents={visibleEvents}
                activeEventName={activeEvent?.name}
                activeListeners={activeListeners}
                liveFiberUids={liveFiberUids}
                onSelect={setSelected}
                onOpenFiber={openFiber}
              />
            ) : view === 'timeline' ? (
              <TimelineView
                dispatches={visibleDispatches}
                expanded={expandedDispatches}
                liveFiberUids={liveFiberUids}
                onToggle={toggleDispatch}
                onOpenFiber={openFiber}
              />
            ) : (
              <FibersView
                visibleFibers={visibleFibers}
                activeFiberUid={selectedFiberUid}
                listeners={state.snapshot.listeners}
                dispatches={state.snapshot.dispatches}
                onSelect={setSelectedFiberUid}
                onOpenEvent={openEvent}
              />
            )}
          </div>
        </section>
      )}
    </div>
  )
}
