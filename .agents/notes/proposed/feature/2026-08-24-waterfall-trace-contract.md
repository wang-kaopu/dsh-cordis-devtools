# Agent Note: Waterfall trace contract

Status: proposed

## Problem

I0 已批准 dispatch-local waterfall instrumentation，但 I2、I4 和 I5 需要一个稳定、可序列化且不夸大事实的 trace contract。尤其是 late/repeated `next()` 意味着 listener 返回时不能固化 `veto` / `shortCircuit`，而 async listener 又需要区分同步返回与 Promise settlement。

## Proposal

新增独立 `src/shared/trace.ts`，冻结 v0.3 waterfall profiler 的共享 metadata contract：

- dispatch 与 listener 使用稳定的 trace/span id；
- 只记录 event、owner、dispatch order、entered/returned/settled timing、outcome category、next-call facts；
- `next()` 每次调用都是独立 record，允许 repeated/late call；
- 不提供 `selfTime`、raw args、return value、error payload/message；
- outcome 区分 sync return/throw 与 async pending/fulfilled/rejected；
- trace lifecycle 允许先返回再被 late continuation 追加事实，I4 决定最终 retention/revision 机制；
- 暴露很薄的 `WaterfallTraceSink` / `WaterfallTraceReader` 边界，使 I2、I4、I5 可独立开发。

## Alternatives considered

- 在现有 `DevtoolsSnapshot` 中直接加入 profiler 字段。拒绝，因为 observer snapshot 与 instrumented trace 的 retention/transport 语义不同，过早耦合会妨碍 I4。
- 直接定义 `shortCircuit: boolean`。拒绝，因为 late `next()` 可以在 listener return/settle 后出现，布尔值会过早冻结错误结论。
- 发布 `selfTime = total - downstream`。拒绝，因为 repeated `next()`、async work 和 reentrancy 下该值不具备稳定语义。

## Acceptance criteria

- contract 可 JSON 序列化，不含函数、Error、Promise 或 raw payload；
- 没有 `selfTime` / `shortCircuit` 字段；
- repeated/late `next()` 可表示；
- sync/async outcome 可区分且不保存值或错误内容；
- I2 可只依赖 sink 写入；I4 可只依赖 shared types 实现 bounded store；I5 可用纯 fixture 开发；
- typecheck、tests、build、client bundle、real DSH Web E2E 全绿。

## Risks

- contract 一旦被 I2/I4/I5 同时依赖，后续改名成本会放大，因此本 PR 只冻结必要事实，不加入推测性字段。
- late continuation 会让 trace 在 initial return 后仍可变化，最终 revision/cursor/finalization 由 I4 单独决定。
