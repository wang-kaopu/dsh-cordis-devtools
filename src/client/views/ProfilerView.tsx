import { useState } from 'react'
import { Button, DisclosureRow, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WaterfallExperimentStatus } from '../../shared/experiments.js'
import type {
  WaterfallDispatchTrace,
  WaterfallInstrumentationState,
  WaterfallListenerSpan,
} from '../../shared/trace.js'
import css from './ProfilerView.module.css'

export interface ProfilerViewProps {
  status: WaterfallInstrumentationState
  experiment?: WaterfallExperimentStatus
  traces: readonly WaterfallDispatchTrace[]
  liveFiberUids: ReadonlySet<number>
  busy?: boolean
  onSetInstrumentation?(enabled: boolean): void
  onOpenFiber?(uid: number): void
}

export function ProfilerView({
  status,
  experiment,
  traces,
  liveFiberUids,
  busy = false,
  onSetInstrumentation,
  onOpenFiber,
}: ProfilerViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const rows = [...traces].reverse()
  const agentOwner = experiment?.owner.kind === 'agent' ? experiment.owner : undefined
  const humanOwner = experiment?.owner.kind === 'human'
  const canToggle = (status === 'disabled' || status === 'enabled') && onSetInstrumentation !== undefined
  const toggleLabel = agentOwner !== undefined
    ? 'Stop Agent experiment'
    : status === 'enabled'
      ? 'Disable profiling'
      : 'Enable profiling'

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className={css.root} aria-label="Waterfall Profiler">
      <header className={css.header}>
        <div>
          <strong className={css.title}>Waterfall Profiler</strong>
          <div className={css.subtitle}>Instrumented traces · metadata only</div>
        </div>
        <div className={css.headerActions}>
          <Pill active={status === 'enabled'}>{status}</Pill>
          {agentOwner !== undefined && <Pill active>{`Agent · ${agentOwner.source}`}</Pill>}
          {humanOwner && <Pill>Human</Pill>}
          {canToggle && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="cordis-devtools-profiler-toggle"
              disabled={busy}
              onClick={() => { onSetInstrumentation(agentOwner !== undefined ? false : status !== 'enabled') }}
            >
              {toggleLabel}
            </Button>
          )}
        </div>
      </header>

      {agentOwner !== undefined && (
        <div className={css.statusNote} data-testid="cordis-devtools-profiler-agent-owner">
          {`Agent-owned ${agentOwner.source} experiment · expires ${formatExpiry(agentOwner.expiresAt)} · Human stop is available as an emergency action.`}
        </div>
      )}
      {status === 'conflict' && (
        <div className={css.statusNote}>Instrumentation is unavailable because another runtime patch owns dispatch.</div>
      )}
      {status === 'unsupported' && (
        <div className={css.statusNote}>This Cordis runtime is not compatible with waterfall instrumentation.</div>
      )}

      {rows.length === 0 ? (
        <div className={css.empty}>No waterfall traces in the current window.</div>
      ) : (
        <div className={css.traceList}>
          {rows.map((trace) => {
            const open = expanded.has(trace.id)
            return (
              <div key={trace.id} className={css.traceRow} data-trace-id={trace.id}>
                <DisclosureRow
                  icon={<span className={css.traceDot} aria-hidden />}
                  title={trace.event}
                  open={open}
                  expandable
                  expandOnRowClick
                  onToggle={() => { toggle(trace.id) }}
                  collapsedContent={(
                    <span className={css.summary}>
                      <Pill>{trace.outcome}</Pill>
                      <span>{trace.listeners.length} listener{trace.listeners.length === 1 ? '' : 's'}</span>
                      <span>{formatElapsed(trace.startedAt, trace.settledAt ?? trace.returnedAt)}</span>
                    </span>
                  )}
                >
                  <div className={css.traceDetail}>
                    {trace.listeners.length === 0 ? (
                      <div className={css.emptyDetail}>No listener entered yet.</div>
                    ) : trace.listeners.map(listener => (
                      <ListenerRow
                        key={listener.id}
                        traceStartedAt={trace.startedAt}
                        listener={listener}
                        liveFiberUids={liveFiberUids}
                        onOpenFiber={onOpenFiber}
                      />
                    ))}
                  </div>
                </DisclosureRow>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ListenerRow({
  traceStartedAt,
  listener,
  liveFiberUids,
  onOpenFiber,
}: {
  traceStartedAt: number
  listener: WaterfallListenerSpan
  liveFiberUids: ReadonlySet<number>
  onOpenFiber?: (uid: number) => void
}) {
  const owner = listener.owner
  const ownerIsLiveReference = owner?.uid !== null
    && owner?.uid !== undefined
    && liveFiberUids.has(owner.uid)
    && onOpenFiber !== undefined

  return (
    <div className={css.listenerRow} data-listener-span={listener.id}>
      <div className={css.listenerHead}>
        <span className={css.order}>#{listener.order + 1}</span>
        {owner === null ? (
          <span className={css.muted}>unknown owner</span>
        ) : ownerIsLiveReference ? (
          <Pill onClick={() => { onOpenFiber(owner.uid as number) }}>{owner.name}</Pill>
        ) : (
          <span>{owner.name}</span>
        )}
        <Pill>{listener.outcome}</Pill>
        <span className={css.elapsed}>{formatElapsed(listener.enteredAt, listener.settledAt ?? listener.returnedAt)}</span>
      </div>

      <dl className={css.listenerFacts}>
        <div><dt>entered</dt><dd>{formatOffset(traceStartedAt, listener.enteredAt)}</dd></div>
        <div><dt>returned</dt><dd>{formatOffset(traceStartedAt, listener.returnedAt)}</dd></div>
        <div><dt>settled</dt><dd>{formatOffset(traceStartedAt, listener.settledAt)}</dd></div>
      </dl>

      {listener.nextCalls.length > 0 && (
        <div className={css.nextCalls}>
          {listener.nextCalls.map(call => (
            <div key={call.id} className={css.nextCall}>
              <span>next #{call.id + 1}</span>
              <span>{formatOffset(traceStartedAt, call.calledAt)}</span>
              <Pill>{call.outcome}</Pill>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatElapsed(start: number, end: number | null): string {
  if (end === null) return 'in progress'
  return `${Math.max(0, end - start).toFixed(2)} ms`
}

function formatOffset(start: number, value: number | null): string {
  if (value === null) return '—'
  return `+${Math.max(0, value - start).toFixed(2)} ms`
}

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString()
}
