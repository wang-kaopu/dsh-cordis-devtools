import type {
  WaterfallExperimentStartInput,
  WaterfallExperimentStartResult,
  WaterfallExperimentStatus,
  WaterfallExperimentStopInput,
  WaterfallExperimentStopResult,
} from '../shared/experiments.js'
import type { McpWaterfallExperimentControl } from './mcp.js'

export interface McpExperimentControlSource {
  waterfallExperimentStatus(): WaterfallExperimentStatus
  startAgent(source: 'mcp', input?: WaterfallExperimentStartInput): WaterfallExperimentStartResult
  stopAgent(input: WaterfallExperimentStopInput): WaterfallExperimentStopResult
}

/** Adapt the service-owned coordinator API to the narrow MCP transport contract. */
export function createMcpExperimentControl(
  source: McpExperimentControlSource,
): McpWaterfallExperimentControl {
  return {
    status: () => source.waterfallExperimentStatus(),
    startAgent: (_source, input) => source.startAgent('mcp', input),
    stopAgent: input => source.stopAgent(input),
  }
}
