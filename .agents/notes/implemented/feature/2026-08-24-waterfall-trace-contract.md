# Agent Note: Waterfall trace contract

Status: implemented

## Problem

I0 已批准 dispatch-local waterfall instrumentation，但 I2、I4 和 I5 需要一个稳定、可序列化且不夸大事实的 trace contract。late/repeated `next()` 意味着 listener 返回时不能固化 `veto` / `shortCircuit`，而 async listener 又需要区分同步返回与 Promise settlement。

## Decision

`src/shared/trace.ts` 定义 v0.3 waterfall profiler 的 metadata-only contract：

- dispatch/listener 使用 trace/span id；
- 记录 event、owner、dispatch order、entered/returned/settled timing、outcome category、next-call facts；
- 每次 `next()` 调用独立记录，允许 repeated/late call；
- outcome 区分 running/returned/threw/pending/fulfilled/rejected；
- 不提供 `selfTime`、`shortCircuit`、raw args、return value 或 error payload/message；
- trace 可以按同一 id 被 sink 覆盖更新，使 late continuation 在 retention 窗口内追加事实；
- `WaterfallTraceSink.write()` 与 `WaterfallTraceReader.snapshot()` 只定义 Host 内部最薄边界，不定义 I4 的 cursor/transport 语义。

## Alternatives considered

- 在现有 `DevtoolsSnapshot` 中直接加入 profiler 字段。拒绝，因为 observer snapshot 与 instrumented trace 的 retention/transport 语义不同。
- 直接定义 `shortCircuit: boolean`。拒绝，因为 late `next()` 可以在 listener return/settle 后出现。
- 发布 `selfTime = total - downstream`。拒绝，因为 repeated `next()`、async work 和 reentrancy 下没有稳定语义。

## Consequences

I2 可以只依赖 sink 产生 trace，I4 可以独立实现 bounded store，I5 可以直接基于纯 fixture 开发。contract 保持 metadata-only，并明确允许同一 trace 在 initial return 后被修订；revision/cursor/finalization 仍由 I4 决定。
