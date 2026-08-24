# Agent Note: Bounded waterfall trace store

Status: proposed

## Problem

I1 的 trace contract 允许同一 trace id 被 late continuation 修订，但尚未定义一个有界 Host 存储。I2 不应负责 retention，observer snapshot 也不应被 profiler trace 悄悄复用。

## Proposal

新增独立 `WaterfallTraceStore` 实现 `WaterfallTraceSink` 与 `WaterfallTraceReader`：

- 按 trace 首次写入顺序保留最多 `maxTraces` 条；
- 同 id 后续 write 原位更新，不刷新 retention age；
- 超限淘汰最早首次写入的 trace；
- write/snapshot 都复制 metadata tree，避免调用方持有引用后绕过 write 修订 store；
- maxTraces 必须为正整数，提供保守默认值；
- 本 PR 不定义 cursor/revision/RPC transport，transport 另做 I4-B 决策。

## Alternatives considered

- 复用 observer `RingBuffer`。拒绝，现有 ring append 语义不适合按 trace id 原位修订，强行复用会隐藏 late-next 更新。
- 更新 trace 时把它移动到 newest。拒绝，late next 不应无限延长旧 trace retention，否则活跃 continuation 可以挤掉更近期 dispatch。
- 直接在 sink 中保存调用方对象引用。拒绝，会允许无 write 的隐式变化并破坏 revision 语义。

## Acceptance criteria

- capacity 有界；
- existing-id update 不增加 size、不改变 eviction order；
- late revisions 可见；
- 写入后修改原对象不会改变 store；读取结果修改也不会改变 store；
- contract metadata 完整保留；
- 不修改 observer snapshot/RPC；
- repository policy、typecheck、tests、build、client bundle、real Web E2E 全绿。

## Risks

- deep-copy metadata 有额外分配；v0.3 初期优先保证 ownership/revision 正确，I3 后续测量真实开销。
- cursor/gap/reconnect 还未定义，不能把 `snapshot()` 宣称成 lossless transport。
