# Agent Note: v0.3 release hardening

Status: proposed

## Problem

I0–I5 已经在 `main` 形成 opt-in waterfall profiler 的完整实现，但仓库还不能准确称为 v0.3 完成：

- `package.json` 仍是 `0.2.0`；
- README / architecture / roadmap / parallel-work 仍把 instrumented mode 描述成未来工作或只描述三个 Web views；
- 已批准并实现的 v0.3 roadmap / I0 architecture Agent Notes 仍留在 `proposed/architecture`，决策生命周期未闭合；
- 当前 real DSH Web smoke 只覆盖 `disabled → enabled → disabled`，还没有稳定证明真实 Host waterfall trace 能到达 Profiler UI 并被展开检查；
- v0.3 的默认 observer、bounded retention、metadata-only、explicit opt-in、fail-closed 等 release invariants 分散在多个测试里，缺少一个面向 milestone 的收口回归层。

I6 只做 integration / release hardening，不增加新的 profiler 语义或新的 production capability。

## Proposal

### 1. 仓库版本进入 0.3.0，但不发布

- `package.json` 从 `0.2.0` 提升到 `0.3.0`；
- 不创建 Git tag；
- 不执行 npm publish；
- 不增加 release workflow。

这与 v0.2 O5 的做法一致：仓库元数据表达 release readiness，外部发布仍是单独的 maintainer 动作。

### 2. 增加 v0.3 milestone hardening tests

在现有 release-hardening coverage 上补充直接不变量：

- `DevtoolsService` 构造后 instrumentation 必须是 `disabled`，且 observer snapshot 不包含 profiler traces；
- disabled path 不安装 instance-level dispatch patch；
- explicit enable 后只产生 bounded waterfall traces，raw arguments / return values / error objects 不进入 profiler snapshot；
- explicit disable 恢复自己的 patch；
- unsupported/conflict 继续 fail closed，不覆盖第三方 dispatch；
- shared trace contract 不出现 `selfTime`、不可撤销 `shortCircuit` / `veto` 结论或 raw payload 字段。

不复制 I2/I3 的完整 behavior matrix；release test 只锁 milestone-level boundaries，详细 semantic parity 仍由现有 instrumentation/parity suites 负责。

### 3. real DSH Web smoke 增加真实 trace inspect

不向 production 增加 test-only RPC、hidden config 或 probe API。

在 `e2e/fixtures/waterfall-probe/` 增加一个仅测试 profile 使用的最小 Cordis 插件：

- 通过 DSH CLI 与当前 checkout 一起安装到 disposable Web profile；
- 注册一个真实 waterfall listener；
- lifecycle-owned interval 周期调用真实 `ctx.waterfall('cordis-devtools-e2e/probe', ...)`；
- 不采集外部数据、不调用模型、不需要 API key。

浏览器 smoke 流程升级为：

`Profiler disabled → explicit enable → 等待 probe trace → 展开 trace → 验证 listener / next fact → explicit disable`。

这样验证的是真实 DSH Host、真实 Cordis waterfall、真实 profiler transport 和真实浏览器 UI 的组合路径，同时测试夹具不会进入 production runtime。

### 4. 同步文档与决策生命周期

- README 更新为四个 views，并记录 observer/default 与 profiler/opt-in 双路径；
- architecture 更新 Host `DevtoolsService`、instrumentation controller、bounded trace store、独立 profiler RPC/store/poller，以及 explicit instrumentation boundary；
- roadmap 把 I0–I6 标为已交付，并把 `selfTime` / definitive short-circuit 等未证明语义明确移到 deferred；
- parallel-work 在顶部标为已完成的历史执行计划，避免继续被读成待办列表；
- 把已批准并实现的 `v0-3-roadmap` 与 `v0-3-waterfall-instrumentation` Notes 从 `proposed/architecture` 迁到 `implemented/architecture`，保留原决策与 rejected alternatives，只把状态/结果改成已实现事实。

### 5. overhead 只记录证据，不制造 CI 性能预算

保留 I3 的 disabled/enabled microbenchmark harness。I6 文档说明它用于数量级/回归观察，不把单次 hosted runner 的波动固化成百分比 pass/fail 门槛。本轮不引入 benchmark budget gate。

## Alternatives considered

### 只改 README / version

拒绝。I6 的关键价值是把真实 trace transport/UI path 和 release invariants 固化成可重复证据，而不是只宣告版本号。

### 为 E2E 增加 production `profiler/probe` RPC

拒绝。测试便利不应该扩大 production mutation/transport surface，尤其是 v0.3 刚完成 privacy 和 explicit opt-in 收口。

### 依赖 DSH Web 自身“碰巧”触发某个 waterfall

拒绝。当前 Web 操作没有一个足够稳定且无模型/API-key依赖的 Host waterfall 触发点；依赖运行时偶然流量会造成 flaky E2E。测试 profile fixture 能提供真实 Cordis 行为同时保持 determinism。

### 把 `selfTime` 或 `shortCircuit` 补进 v0.3 再收口

拒绝。I0 已明确这些语义在 repeated/late `next()` 与 async/reentrant 情况下不够稳固。I6 不借 release hardening 扩大诊断 contract。

### 创建 v0.3.0 tag / npm publish

拒绝。I6 只建立仓库内 release readiness；外部发布需要 maintainer 单独明确执行。

## Acceptance criteria

- package metadata 为 `0.3.0`，没有 tag/publish workflow；
- README / architecture / roadmap 与当前实现一致；
- v0.3 roadmap / I0 Agent Notes 已闭合到 implemented；
- milestone hardening tests 直接覆盖 default-disabled、observer/profiler separation、bounded/privacy、disable restore、no unsupported timing conclusion；
- real DSH Web E2E 稳定覆盖 `enable → real waterfall trace → inspect → disable`；
- probe 仅存在于 E2E fixture/profile，不进入 production bundle/API；
- `pnpm verify:policy`、typecheck、tests、build、client bundle、real DSH Web E2E 全绿；
- 最终 diff 自审确认没有新增 production profiler semantic field、payload capture、auto-enable、remote transport 或 release publish 动作。

## Risks

- E2E fixture 的 interval 必须由 Cordis effect lifecycle 清理，避免污染临时 DSH 进程；
- probe event 会进入 observer Timeline，但只存在于 CI disposable profile，不改变 production package；
- 文档从“计划”切换为“已交付”时不能把尚未实现的 `selfTime` / definitive chain-stop 推断误写成 v0.3 capability；
- package version bump 只代表 repository readiness，不应被描述成已经发布到 npm。
