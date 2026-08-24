# Agent Note: Instrumentation service and profiler RPC

Status: implemented

## Problem

I2 core 与 I4 bounded trace store 已独立合并，但 production `apply()` 仍只提供 observer collector，RPC 也只有 `snapshot`。需要把 instrumentation 生命周期、trace retention 和 loopback 控制/读取接起来，同时不能让默认 observer polling 变重，也不能默认开启 instrumentation。

## Decision

新增 Host `DevtoolsService` 组合现有 `ObserverCollector`、`WaterfallTraceStore` 与 `WaterfallInstrumentationController`：

- 构造后 instrumentation 保持 `disabled`；
- 原 `snapshot()` 仍只返回 v0.2 observer 数据；
- `profilerSnapshot()` 独立返回 `{ generatedAt, instrumentation, traces }`；
- `setInstrumentationEnabled(enabled)` 显式 enable/disable，并返回最新 profiler snapshot；
- `maxTraces` 作为独立 bounded trace capacity 配置，不提供 auto-enable；
- `dispose()` 只在 controller 仍 enabled 时尝试恢复自己的 instance patch；conflict 时不覆盖第三方；
- `apply()` 继续 provide `cordisDevtools`，但实例改为组合 service，并用 `ctx.effect()` 绑定 disposal。

RPC 继续复用 `/cordis-devtools` loopback channel，新增：

- `profiler/snapshot`；
- `instrumentation/enable`；
- `instrumentation/disable`。

旧 `snapshot` endpoint 与返回 shape 保持不变。Shared trace contract 新增 profiler snapshot/status service types，供 Host 与后续 client integration 共用。

## Alternatives considered

- 把 profiler traces 直接加进 `DevtoolsSnapshot`。拒绝；默认 observer polling 不应承担 instrumented trace 负担。
- 在 `ObserverCollector` 内直接 new controller/store。拒绝；collector 继续保持 behavior-neutral observer 职责。
- 用 plugin config 自动开启 instrumentation。拒绝；I0 要求显式 opt-in，重启后不得自动保持 enabled。
- 新建第二 RPC channel。拒绝；同一个 loopback diagnostics channel 下独立 endpoint 足够。

## Consequences

Host 已具备真实 profiler control/read path，但客户端仍需单独接入 Profiler tab/poller/toggle。默认 Events/Timeline/Fibers 继续使用原 snapshot endpoint；只在用户进入 profiler 并显式 enable 后才会产生 waterfall traces。当前 profiler RPC 返回 bounded snapshot，不宣称 lossless/cursor transport。
