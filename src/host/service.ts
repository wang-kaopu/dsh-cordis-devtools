import type { Context } from '@deepseek-ai/cordis'
import type {
  WaterfallExperimentId,
  WaterfallExperimentSource,
  WaterfallExperimentStartInput,
  WaterfallExperimentStartResult,
  WaterfallExperimentStatus,
  WaterfallExperimentStopInput,
  WaterfallExperimentStopResult,
} from '../shared/experiments.js'
import type { CordisDevtoolsService, DevtoolsSnapshot } from '../shared/types.js'
import type {
  WaterfallProfilerService,
  WaterfallProfilerSnapshot,
} from '../shared/trace.js'
import { ObserverCollector } from './collector.js'
import { RuntimeDiagnosticsQuery } from './diagnostics.js'
import { AgentDebugService } from './agent-debug/service.js'
import { AgentDebugProtocol } from './agent-debug/protocol.js'
import { WaterfallInstrumentationController } from './instrumentation/waterfall-controller.js'
import { WaterfallExperimentCoordinator } from './instrumentation/waterfall-experiment-coordinator.js'
import { RuntimeNotificationSource } from './runtime-notifications.js'
import { WaterfallTraceStore } from './trace-store.js'

export interface DevtoolsServiceOptions {
  maxDispatches?: number
  maxTraces?: number
}

export class DevtoolsService implements CordisDevtoolsService, WaterfallProfilerService {
  private readonly observer: ObserverCollector
  private readonly traces: WaterfallTraceStore
  private readonly instrumentation: WaterfallInstrumentationController
  private readonly experiments: WaterfallExperimentCoordinator
  private readonly runtimeNotifications: RuntimeNotificationSource
  /** Host-owned transport-neutral Agent Debug facade. */
  readonly agentDebug: AgentDebugService
  /** Generic protocol router over the Agent Debug facade. */
  readonly agentDebugProtocol: AgentDebugProtocol
  readonly diagnostics: RuntimeDiagnosticsQuery

  constructor(ctx: Context, options: DevtoolsServiceOptions = {}) {
    this.runtimeNotifications = new RuntimeNotificationSource()
    this.observer = new ObserverCollector(ctx, {
      maxDispatches: options.maxDispatches,
      runtimeNotifications: this.runtimeNotifications,
    })
    this.traces = new WaterfallTraceStore({
      maxTraces: options.maxTraces,
      runtimeNotifications: this.runtimeNotifications,
    })

    // The controller owns trace creation while the coordinator owns mutation.
    // The indirection avoids a second ownership flag while breaking the
    // construction cycle: traces ask for the coordinator's current lease only
    // after instrumentation has been acquired.
    let resolveExperimentId: () => WaterfallExperimentId | undefined = () => undefined
    this.instrumentation = new WaterfallInstrumentationController(ctx, this.traces, {
      resolveExperimentId: () => resolveExperimentId(),
    })
    this.experiments = new WaterfallExperimentCoordinator(this.instrumentation, {
      runtimeNotifications: this.runtimeNotifications,
    })
    resolveExperimentId = () => this.experiments.currentExperimentId()

    this.agentDebug = new AgentDebugService({
      ports: {
        snapshot: () => this.observer.snapshot(),
        profilerSnapshot: () => this.profilerSnapshot(),
        startAgent: (source, input) => this.experiments.startAgent(source, input),
        stopAgent: input => this.experiments.stopAgent(input),
        runtimeNotifications: this.runtimeNotifications,
      },
    })
    this.diagnostics = new RuntimeDiagnosticsQuery(this)
    this.agentDebugProtocol = new AgentDebugProtocol(this.agentDebug, this.diagnostics)
  }

  snapshot(): DevtoolsSnapshot {
    return this.observer.snapshot()
  }

  clearDispatches(): void {
    this.observer.clearDispatches()
  }

  subscribe(listener: () => void): () => void {
    return this.observer.subscribe(listener)
  }

  waterfallExperimentStatus(): WaterfallExperimentStatus {
    return this.experiments.status()
  }

  startAgent(
    source: WaterfallExperimentSource,
    input: WaterfallExperimentStartInput = {},
  ): WaterfallExperimentStartResult {
    return this.experiments.startAgent(source, input)
  }

  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult {
    return this.experiments.stopAgent(input)
  }

  profilerSnapshot(): WaterfallProfilerSnapshot {
    const experiment = this.experiments.status()
    return {
      generatedAt: experiment.generatedAt,
      instrumentation: experiment.instrumentation,
      experiment,
      traces: [...this.traces.snapshot()],
    }
  }

  /** Human control boundary used by the existing browser Profiler RPC. */
  setInstrumentationEnabled(enabled: boolean): WaterfallProfilerSnapshot {
    if (enabled) this.experiments.startHuman()
    else this.experiments.forceStop()
    return this.profilerSnapshot()
  }

  dispose(): void {
    this.agentDebug.dispose()
    this.experiments.dispose()
    this.runtimeNotifications.dispose()
  }
}
