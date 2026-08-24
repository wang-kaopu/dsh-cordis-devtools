# Agent Note: v0.3 release hardening

Status: implemented

## Problem

I0–I5 已形成 opt-in waterfall profiler，但仓库仍存在 release-readiness 缺口：版本仍为 0.2.0，文档/Agent Note 状态落后于实现，real Web smoke 只证明 instrumentation toggle 而没有稳定检查真实 trace，且 milestone-level v0.3 invariants 缺少一层收口回归。

## Decision

I6 只做 integration / release hardening，不增加新的 profiler semantics。

### Repository version

- `package.json` 从 `0.2.0` 提升到 `0.3.0`；
- 不创建 Git tag；
- 不执行 npm publish；
- 不增加 release workflow。

仓库版本表达 readiness，外部发布仍是单独 maintainer 动作。

### Milestone hardening tests

现有 `tests/release-hardening.spec.ts` 在保留 v0.2 observer invariants 的同时增加 v0.3 milestone coverage：

- `DevtoolsService` 默认 instrumentation 为 `disabled`；
- observer snapshot 不包含 profiler traces；
- disabled path 不安装 DevTools instance dispatch patch；
- explicit enable 后 trace retention 仍 bounded；
- raw listener payload/return data 不进入 profiler snapshot；
- trace contract 不出现 `selfTime`、不可撤销 `shortCircuit` / `veto` 结论；
- explicit disable 恢复 DevTools-owned patch；
- 第三方覆盖 dispatch 时保持 `conflict` fail-closed，不强行恢复。

完整 waterfall semantic parity 仍由现有 I1/I2/I3 suites 负责，release test 不复制 behavior matrix。

### Deterministic real DSH Web trace inspection

新增 `e2e/fixtures/waterfall-probe/`，它只用于 disposable E2E profile：

- 作为独立 Cordis plugin 通过真实 DSH CLI 安装；
- 注册 `cordis-devtools-e2e/probe` waterfall listener；
- lifecycle-owned interval 周期调用真实 `ctx.waterfall()`；
- 不调用模型、不需要 API key，也不暴露 production test RPC。

real DSH Web smoke 现在验证：

`Profiler disabled → explicit enable → probe trace 到达浏览器 → 展开 trace → 检查 next #1 → explicit disable`。

Fixture 位于 `e2e/`，且不在 package `files` 列表中，因此不进入 production package/runtime。

### Documentation and decision lifecycle

- README 更新为四视图与 observer/default + profiler/opt-in 双路径；
- architecture 记录 DevtoolsService、dispatch instrumentation seam、bounded trace store、独立 profiler transport/store/poller、Promise side-observation limitation 与 fail-closed states；
- roadmap 把 O1–O5 / I0–I6 标为已交付，并明确 v0.3 不包含 `selfTime`、definitive chain-stop、payload capture 或非-waterfall profiling；
- parallel-work 标记为历史执行计划，而不是当前 backlog；
- 已批准并实现的 v0.3 roadmap / waterfall instrumentation Agent Notes 从 `proposed/architecture` 迁到 `implemented/architecture`，保留原决策和 rejected alternatives，并补实际 consequences/verification。

### Overhead evidence

继续使用 I3 disabled/enabled microbenchmark harness 作为数量级/回归证据，不把单次 hosted runner 的波动固化成 percentage budget gate。

## Alternatives considered

### 只更新版本号/README

拒绝。I6 需要把真实 trace transport/UI path 与 milestone invariants 固化成可重复证据，而不是只宣告完成。

### 增加 production profiler probe RPC

拒绝。测试便利不应扩大 production mutation/transport surface。

### 依赖 DSH Web 偶然触发 waterfall

拒绝。没有稳定且 keyless/model-free 的 Host Web 动作可保证 waterfall；E2E-only Cordis fixture 提供真实行为且 deterministic。

### 在 I6 顺便补 `selfTime` / definitive short-circuit

拒绝。I0 已明确这些语义在 async/repeated/late/reentrant continuation 下尚未足够稳固，release hardening 不扩大 contract。

### 创建 v0.3.0 tag / npm publish

拒绝。外部发布需要单独显式 maintainer 动作。

## Consequences

合并后仓库元数据、文档、Agent Note 生命周期和可执行证据都与 v0.3 实现一致。默认 observer path 仍不启用 instrumentation；Profiler 仍必须显式 enable；trace/observer retention 与 transports 仍分离；privacy contract 没有扩大。

0.3.0 表示 repository-ready，而不是已经发布到 npm 或打过 Git tag。

## Verification

PR 必须通过：

- repository policy / Agent Note / link checks；
- typecheck；
- full Vitest suite，包括 v0.2/v0.3 release invariants、behavior matrix、instrumentation core/parity/store/RPC/client tests；
- build；
- built client bundle verification；
- real DSH Web E2E，包含 `enable → real waterfall trace → inspect → disable`；
- final diff self-review：无 production test hook、无 auto-enable、无 raw payload capture、无 unsupported profiler field、无 remote transport、无 tag/publish/release workflow。
