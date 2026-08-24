# Agent Note: Waterfall instrumentation core

Status: implemented

## Problem

I0 已批准 instance-level `ctx.events.dispatch` adapter，I1 已冻结 metadata-only trace contract 与真实 Cordis 4.0.1 behavior matrix。I2 需要实现最小 opt-in core，同时保持 observer/default path 完全不插桩，并避免把 storage/RPC/UI 集成耦合进 core。

## Decision

新增 `WaterfallInstrumentationController`：

- 构造时注入 `Context`、`WaterfallTraceSink`、可测试 clock 和可选 listener metadata resolver；
- 默认 disabled，构造阶段不 patch runtime；
- `enable()` 仅在 `_hooks` 可用、dispatch 未被 instance patch 且仍等于构造时基线时安装 instance-level adapter；
- non-waterfall 完全 delegate 保存的原 dispatch；
- waterfall 镜像 Cordis 4.0.1 的 thisArg/name/internal-dispatch/filter/order/bind 逻辑，只生成 dispatch-local callback wrappers；
- `_hooks[].callback` 与 `EventsService.waterfall()` 不修改；
- listener wrapper 保持 sync return、same throw object、original Promise identity，并对 Promise settlement 做 I0 已批准的 side observation；
- traced `next()` 每次直接 delegate 原 continuation，允许 repeated/late call；
- trace 只写 I1 metadata contract，不保存 raw args/value/error payload；
- outermost listener 的返回/settle用于更新可证明的 dispatch outcome；零 listener 等无法从该 seam 证明 completion 的情况保持 `running`，不制造结论；
- `disable()` 只有当前 dispatch 仍是自己的 wrapper 时才移除 instance patch；第三方覆盖时进入 conflict 并保留第三方实现；
- storage、RPC、plugin config 与 UI wiring 留到 integration。

## Alternatives considered

- 在 I2 内直接创建 trace store。拒绝，I4 独立负责 retention，I2 只依赖 sink。
- 原地替换 Hook callback。拒绝，会威胁 disposer/unregister identity。
- 重写 `waterfall()`。拒绝，continuation engine 必须继续由 Cordis 原实现控制。
- 用 source-string 判断兼容版本。拒绝，使用运行时结构与 patch ownership guard。

## Consequences

I2 core 可以独立通过真实 Cordis 测试验证 callback identity、filter 次数、this、error/Promise identity、repeated/late next 和 patch conflict。默认 observer path 不受影响；真正的用户 enable control、共享 listener id resolver、store/RPC/UI 接线仍是后续 integration 工作。Promise settlement side observation 的 handled-state 代价只存在于显式 enabled mode。
