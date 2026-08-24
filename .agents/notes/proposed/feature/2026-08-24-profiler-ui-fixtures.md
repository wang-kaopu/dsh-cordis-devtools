# Agent Note: Waterfall profiler fixture UI

Status: proposed

## Problem

I5 的视觉层可以在 I2/I4 transport 接好前独立开发，只要严格依赖 I1 serializable trace contract。这样可以并行验证 trace 密度、listener/next 信息层级和 DSH-native composition，而不让 UI PR 同时修改 Host/RPC。

## Proposal

新增纯 props 驱动的 `ProfilerView`：

- props 接收 instrumentation status、`WaterfallDispatchTrace[]` 与可选 Fiber navigation callback；
- 复用 DSH `DisclosureRow` / `Pill`，不引入自造控件体系；
- trace collapsed row 显示 event、outcome、listener count 与可证明的 elapsed timing；
- expanded detail 显示 listener order/owner/outcome/entered-returned-settled facts 和每次 next-call；
- repeated/late next 作为多个事实记录呈现，不显示未经证明的 `veto` / `short-circuit`；
- raw args/return/error payload 永不渲染；
- 本 PR 只做 standalone fixture component + behavior tests，不接 DevtoolsShell tab、RPC/store 或 enable toggle。

## Alternatives considered

- 等 I2/I4 全完成后再做 UI。拒绝，会把 trace contract、transport 和视觉密度问题串行化。
- 现在就加第四个 top-level Profiler tab。拒绝，会和后续 real status/transport wiring 同时修改共享 shell，增加并行冲突。
- 用自定义 cards/button 代替 DSH primitives。拒绝，现有 UI 原则要求优先复用 DSH 组件并保持视觉一致。

## Acceptance criteria

- fixture component 只依赖 shared trace contract；
- enabled/disabled/conflict/unsupported 状态可明确显示；
- multiple listeners 与 repeated/late next 可展开观察；
- owner uid 可通过 callback 导航；
- 不出现 `veto` / `short-circuit` 等 contract 不支持的结论；
- 不新增不必要 border/divider；
- DOM 行为测试，不做源码字符串测试；
- repository policy、typecheck、tests、build、client bundle、real Web E2E 全绿。

## Risks

- 最终 I4 transport/status API 可能要求轻微 props adapter；通过保持 component 纯 props 可把变化限制在 integration 层。
- trace 密度可能在真实数据下更高，I5-B 接真实数据后再做性能/虚拟化决策。
