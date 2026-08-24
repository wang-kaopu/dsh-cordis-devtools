import type { Context } from '@deepseek-ai/cordis'
import type { CordisDevtoolsService, DevtoolsSnapshot } from '../shared/types.js'
import type {
  WaterfallInstrumentationState,
  WaterfallProfilerService,
  WaterfallProfilerSnapshot,
} from '../shared/trace.js'
import { ObserverCollector } from './collector.js'
import { WaterfallInstrumentationController } from './instrumentation/waterfall-controller.js'
import { WaterfallTraceStore } from './trace-store.js'

export interface DevtoolsServiceOptions {
  maxDispatches?: number
  maxTraces?: number
}

export class DevtoolsService implements CordisDevtoolsService, WaterfallProfilerService {
  private readonly observer: ObserverCollector
  private readonly traces: WaterfallTraceStore
  private readonly instrumentation: WaterfallInstrumentationController

  constructor(ctx: Context, options: DevtoolsServiceOptions = {}) {
    this.observer = new ObserverCollector(ctx, {
      maxDispatches: options.maxDispatches,
    })
    this.traces = new WaterfallTraceStore({
      maxTraces: options.maxTraces,
    })
    this.instrumentation = new WaterfallInstrumentationController(ctx, this.traces)
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

  profilerSnapshot(): WaterfallProfilerSnapshot {
    return {
      generatedAt: Date.now(),
      instrumentation: this.instrumentation.state as WaterfallInstrumentationState,
      traces: [...this.traces.snapshot()],
    }
  }

  setInstrumentationEnabled(enabled: boolean): WaterfallProfilerSnapshot {
    if (enabled) this.instrumentation.enable()
    else this.instrumentation.disable()
    return this.profilerSnapshot()
  }

  dispose(): void {
    if (this.instrumentation.state === 'enabled') {
      this.instrumentation.disable()
    }
  }
}
