# Agent Note: Instrumentation service and profiler RPC

Status: proposed

## Problem

I2 core 与 I4 bounded trace store 已独立合并，但 production `apply()` 仍只提供 observer collector，当前 RPC 也只有 `snapshot`。需要把 instrumentation 生命周期、trace retention 和 loopback 控制/读取接起来，同时不能让默认 observer polling 变重，也不能默认开启 instrumentation。

## Proposal

新增 Host `DevtoolsService` 作为组合服务，内部持有：

- 现有 `ObserverCollector`；
- `WaterfallTraceStore`；
- `WaterfallInstrumentationController`。

服务保持以下边界：

- 构造后 instrumentation 状态必须是 `disabled`；
- 现有 `snapshot()` 仍只返回 v0.2 observer 数据，不追加 trace；
- 新增 `profilerSnapshot()` 返回 `{ generatedAt, instrumentation, traces }`；
- 新增 `setInstrumentationEnabled(enabled)` 显式调用 controller enable/disable，并返回最新 profiler snapshot；
- 新增 `maxTraces` 配置，但不新增 auto-enable 配置；
- plugin disposal 时尝试 disable instrumentation；若 runtime 已被第三方 patch，沿用 controller fail-closed 语义，不覆盖对方；
- 保持 `cordisDevtools` service 名称，`apply()` 改为 provide 组合 service。

RPC 仍使用同一 `/cordis-devtools` loopback channel，增加：

- `profiler/snapshot`；
- `instrumentation/enable`；
- `instrumentation/disable`。

旧 `snapshot` endpoint 保持兼容。Mutation endpoint 不接受 arbitrary payload，也不暴露 raw trace payload 之外的 metadata contract。

## Alternatives considered

- 把 profiler traces 直接加进现有 `DevtoolsSnapshot`。拒绝；observer 1s polling 不应被 instrumented trace retention/transport 放大。
- 在 `ObserverCollector` 内直接 new controller/store。拒绝；collector 的职责是 behavior-neutral observer，组合 service 更清晰。
- 用 plugin config `instrumentation: true` 启动自动开启。拒绝；I0 要求显式 opt-in，进程重启后不得自动保持 enabled。
- 新建第二个 RPC channel。拒绝；同一 loopback diagnostics service 下用独立 endpoint 足够，减少 Connection 注册面。

## Acceptance criteria

- plugin 启动默认 disabled；
- observer `snapshot` shape/endpoint 不变；
- profiler snapshot 与 observer snapshot 分离；
- enable/disable RPC 仅 loopback，且 repeated toggle 幂等；
- conflict/unsupported state 原样暴露，不静默回退；
- trace store bounded，`maxTraces` 生效；
- disposal 尝试恢复 instrumentation patch；
- 现有 host RPC tests 保持，并新增 profiler/control tests；
- repository policy、typecheck、tests、build、client bundle、real Web E2E 全绿。

## Risks

- service 接线会修改 `src/index.ts`、`src/host/rpc.ts` 与 shared service/RPC types，后续客户端 wiring 必须从本 PR 合并后的 fresh main 开分支。
- 当前 profiler snapshot 是 bounded snapshot，不宣称 lossless/cursor transport；cursor/revision 仍可后续增强。
