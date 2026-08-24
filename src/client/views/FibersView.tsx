import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DispatchRecord,
  EffectSnapshot,
  ListenerSnapshot,
  LiveFiberSnapshot,
} from '../../shared/types.js'
import css from '../DevtoolsPanel.module.css'

export interface FibersViewProps {
  visibleFibers: LiveFiberSnapshot[]
  activeFiberUid?: number
  listeners: ListenerSnapshot[]
  dispatches: DispatchRecord[]
  onSelect(uid: number): void
  onOpenEvent(name: string): void
}

export function FibersView({
  visibleFibers,
  activeFiberUid,
  listeners,
  dispatches,
  onSelect,
  onOpenEvent,
}: FibersViewProps) {
  const listRef = useRef<HTMLElement>(null)
  const [expandedEffects, setExpandedEffects] = useState<Set<string>>(() => new Set())
  const activeFiber = visibleFibers.find(fiber => fiber.uid === activeFiberUid) ?? visibleFibers[0]
  const ownedListeners = activeFiber === undefined
    ? []
    : listeners.filter(listener => listener.owner?.uid === activeFiber.uid)
  const ownedEvents = [...new Set(ownedListeners.map(listener => listener.event))].sort()
  const recentDispatchHits = activeFiber === undefined
    ? 0
    : dispatches.filter(record => record.thisFiber?.uid === activeFiber.uid).length

  useEffect(() => {
    if (activeFiber === undefined) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-fiber-uid="${activeFiber.uid}"]`)
    if (typeof row?.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeFiber?.uid])

  const toggleEffect = (id: string): void => {
    setExpandedEffects((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={css.fibersBody}>
      <nav ref={listRef} aria-label="Live Cordis fibers" className={css.fiberList}>
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
              <FiberStat label="owned events" value={ownedEvents.length} />
              <FiberStat label="recent dispatch-context hits" value={recentDispatchHits} />
            </div>

            <dl className={css.fiberDetails}>
              <div>
                <dt>state</dt>
                <dd>{activeFiber.state}</dd>
              </div>
              <div>
                <dt>parent</dt>
                <dd>
                  {activeFiber.parent === null
                    ? 'unknown'
                    : `${activeFiber.parent.name} · uid ${activeFiber.parent.uid ?? 'disposed'} · ${activeFiber.parent.state}`}
                </dd>
              </div>
              <div>
                <dt>inject</dt>
                <dd>
                  {activeFiber.inject.length === 0 ? (
                    <span className={css.muted}>none</span>
                  ) : (
                    <span className={css.detailPills}>
                      {activeFiber.inject.map(name => <Pill key={name}>{name}</Pill>)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>events</dt>
                <dd>
                  {ownedEvents.length === 0 ? (
                    <span className={css.muted}>none</span>
                  ) : (
                    <span className={css.detailPills}>
                      {ownedEvents.map(name => (
                        <Pill key={name} onClick={() => { onOpenEvent(name) }}>{name}</Pill>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <EffectsSection
              fiberUid={activeFiber.uid}
              effects={activeFiber.effects}
              expanded={expandedEffects}
              onToggle={toggleEffect}
            />
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

interface EffectsSectionProps {
  fiberUid: number
  effects: EffectSnapshot[]
  expanded: ReadonlySet<string>
  onToggle(id: string): void
}

function EffectsSection({ fiberUid, effects, expanded, onToggle }: EffectsSectionProps) {
  return (
    <section className={css.effectsSection} data-testid="cordis-devtools-effects">
      <div className={css.effectsHeader}>
        <strong className={css.effectsTitle}>Effects</strong>
        <span className={css.effectsMeta}>
          {effects.length} root{effects.length === 1 ? '' : 's'}
        </span>
      </div>
      {effects.length === 0 ? (
        <div className={css.effectsEmpty}>No labeled live effects.</div>
      ) : (
        <EffectTree
          fiberUid={fiberUid}
          effects={effects}
          path=""
          expanded={expanded}
          onToggle={onToggle}
        />
      )}
    </section>
  )
}

interface EffectTreeProps extends EffectsSectionProps {
  path: string
}

function EffectTree({ fiberUid, effects, path, expanded, onToggle }: EffectTreeProps) {
  return (
    <div className={css.effectTree}>
      {effects.map((effect, index) => {
        const effectPath = path === '' ? String(index) : `${path}.${index}`
        const id = `${fiberUid}:${effectPath}`
        const expandable = effect.children.length > 0
        const open = expandable && expanded.has(id)

        return (
          <div key={id} className={css.effectNode} data-effect-path={effectPath}>
            <DisclosureRow
              icon={<span className={css.effectDot} aria-hidden />}
              title={effect.label}
              open={open}
              expandable={expandable}
              expandOnRowClick={expandable}
              onToggle={() => { if (expandable) onToggle(id) }}
              collapsedContent={expandable
                ? <span className={css.effectMeta}>{effect.children.length} child{effect.children.length === 1 ? '' : 'ren'}</span>
                : undefined}
            >
              {expandable && (
                <div className={css.effectChildren}>
                  <EffectTree
                    fiberUid={fiberUid}
                    effects={effect.children}
                    path={effectPath}
                    expanded={expanded}
                    onToggle={onToggle}
                  />
                </div>
              )}
            </DisclosureRow>
          </div>
        )
      })}
    </div>
  )
}
