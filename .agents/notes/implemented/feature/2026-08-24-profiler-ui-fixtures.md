# Agent Note: Waterfall profiler fixture UI

Status: implemented

## Problem

I5 的视觉层可以在 I2/I4 transport 接好前独立开发，只要严格依赖 I1 serializable trace contract，从而并行验证 trace 密度、listener/next 信息层级和 DSH-native composition。

## Decision

新增纯 props 驱动的 `ProfilerView`：

- 接收 instrumentation status、`WaterfallDispatchTrace[]` 与可选 Fiber navigation callback；
- 复用 DSH `DisclosureRow` / `Pill`；
- trace collapsed row 显示 event、outcome、listener count 与可证明 elapsed timing；
- expanded detail 显示 listener order/owner/outcome/entered-returned-settled facts 和每次 next-call；
- repeated/late next 按多个事实记录呈现，不显示 `veto` / `short-circuit`；
- raw args/return/error payload 不渲染；
- component 保持 standalone，不接 DevtoolsShell tab、RPC/store 或 enable toggle。

## Alternatives considered

- 等 I2/I4 全完成后再做 UI。拒绝，会把 trace contract、transport 和视觉验证串行化。
- 现在就加第四个 top-level Profiler tab。拒绝，会和后续 real status/transport wiring 同时修改共享 shell。
- 用自定义控件替代 DSH primitives。拒绝，现有 UI 原则要求优先复用 DSH 组件。

## Consequences

I5-B 后续只需提供真实 status/traces props 和导航 wiring；当前 component 可用 fixture 独立验证，并避免与 Host/RPC 分支冲突。真实高密度 trace 下的虚拟化/性能留到接入后再评估。
