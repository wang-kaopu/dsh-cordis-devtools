# Agent Note: Waterfall instrumentation core

Status: proposed

## Problem

I0 已批准 instance-level `ctx.events.dispatch` adapter，I1 已冻结 metadata-only trace contract 与真实 Cordis 4.0.1 behavior matrix。现在需要实现最小 I2 core，同时保持 observer/default path 完全不插桩，并避免把 storage/RPC/UI 集成提前耦合进 core。

## Proposal

新增隔离的 Host instrumentation controller：

- 构造时注入 `Context`、`WaterfallTraceSink` 与可测试 clock；
- 默认 disabled，不在构造阶段 patch runtime；
- `enable()` 只在 compatibility guard 通过时给当前 `ctx.events` 安装 instance-level `dispatch` adapter；
- non-waterfall 完全 delegate 保存的原 dispatch；
- waterfall 镜像 Cordis 4.0.1 的 thisArg/name/internal-dispatch/filter/order/bind 逻辑，并只包装 dispatch-local callback；
- `_hooks[].callback` 与 `EventsService.waterfall()` 永远不改；
- listener wrapper 保持 sync return / same throw / original Promise identity，并对 Promise settlement 做已批准的 side observation；
- traced `next()` 每次都直接 delegate 原 continuation，允许 repeated/late call；
- trace 只写 metadata contract，不保存 raw args/value/error payload；
- `disable()` 仅在当前 dispatch 仍为自己的 wrapper 时恢复原 descriptor；发现 patch 冲突则 fail closed，不覆盖第三方；
- storage、RPC、plugin config 与 UI wiring 留到后续 integration。

## Alternatives considered

- 在 I2 内直接 new trace store。拒绝，I4 应能独立实现 storage，I2 只依赖 `WaterfallTraceSink`。
- 原地替换 Hook callback。拒绝，I0 已确认会威胁 disposer/unregister identity。
- 重写 `waterfall()`。拒绝，continuation engine 本身必须继续由 Cordis 原实现控制。
- 用 source-string 比较判断兼容版本。拒绝，脆弱且违背当前测试/兼容原则；使用运行时结构与 patch ownership guard。

## Acceptance criteria

- disabled path 不创建 instance `dispatch` patch；
- enable/disable 幂等；
- existing own-dispatch patch 时 enable fail closed；
- disable 时第三方覆盖自己的 wrapper则不强行恢复；
- non-waterfall delegate 原实现；
- waterfall filter 每 hook 每 dispatch 至多一次；
- hook callback identity 不变；
- sync return、same error object、Promise identity、repeated/late next、prepend/filter/this 行为通过 tests；
- trace 不含 raw payload，并可通过 sink 收到修订；
- repository policy、typecheck、tests、build、client bundle、real Web E2E 全绿。

## Risks

- Cordis private dispatch selection 逻辑升级会导致 compatibility drift；I3 matrix/parity 是扩大兼容范围的前置。
- Promise settlement side observation 会影响 handled/unhandled bookkeeping，仅存在于 explicit enabled mode。
- dispatch seam 无法天然观察所有“外层 waterfall 已返回”的情况（例如零 listener）；core 只记录能够从 dispatch-local execution 证明的事实，不制造虚假 completion。
