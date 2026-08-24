# Agent Note: Bounded waterfall trace store

Status: implemented

## Problem

I1 的 trace contract 允许同一 trace id 被 late continuation 修订，但需要一个与 observer snapshot 分离的有界 Host 存储。

## Decision

`WaterfallTraceStore` 同时实现 `WaterfallTraceSink` 与 `WaterfallTraceReader`：

- 默认最多保留 200 条，可通过正整数 `maxTraces` 配置；
- retention 顺序按 trace 首次写入确定；
- 同 id 后续 write 原位更新，不刷新 retention age；
- 超限淘汰最早首次写入的 trace；
- write 与 snapshot 都复制 trace/listener/owner/next-call metadata tree，修订必须通过显式 `write()`；
- 本实现只提供 Host 内 snapshot 读取，不定义 cursor/revision/RPC transport。

## Alternatives considered

- 复用 observer `RingBuffer`。拒绝，因为 append-only 语义不适合按 trace id 原位修订。
- 更新 trace 时移动到 newest。拒绝，因为 late continuation 不应无限延长旧 trace retention。
- 保存调用方对象引用。拒绝，会允许无 write 的隐式变化并破坏 store ownership。

## Consequences

I2 可以只面向 sink 写 trace，I4-B 后续可以在 store 外增加 revision/cursor transport；late next 会更新现有 trace，但不会改变其 eviction age。copy-on-write/read 带来额外分配，后续由 I3 测量实际成本。
