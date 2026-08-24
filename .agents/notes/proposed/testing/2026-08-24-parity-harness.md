# Agent Note: Instrumentation parity harness

Status: proposed

## Problem

I3 需要比较同一个 waterfall scenario 在 uninstrumented / instrumented runtime 下的 caller-observable behavior，并给 disabled/enabled overhead 建立可重复基线。I2 尚未实现时，也可以先把与具体 instrumentation 解耦的 runner / observation / comparison 基础设施搭好。

## Proposal

新增独立测试 helper：

- `runScenario(setup)` 创建全新 Cordis runtime，执行可选 prepare hook，再运行 scenario；
- scenario 只返回可 JSON/identity-aware 比较的 observation，不依赖 trace schema；
- `compareParity(baseline, candidate)` 比较 value/throw/reject category、object identity tokens、ordered side effects 与 this observations；
- 提供 benchmark sample runner，只采样 `performance.now()` / hrtime 的 aggregate，不设武断性能阈值；
- 当前 PR 先用 identity/no-op prepare 证明 harness 自身稳定；I2 合并后再注入 `enableInstrumentation` 完成真实 paired parity。

## Alternatives considered

- 把 parity assertions 直接写进 I2 tests。拒绝，因为会让 oracle、runner 和 production wrapper 同分支演化，降低独立性。
- 现在就添加固定百分比性能门槛。拒绝，因为还没有真实 enabled baseline，先记录可重复样本再决定预算。
- 依赖 I1 trace contract。拒绝；semantic parity 比较 caller-observable behavior，不应以 profiler 输出作为正确性来源。

## Acceptance criteria

- helper 不 import production instrumentation 或 trace contract；
- 每次 run 使用独立 Cordis Context，避免 listener/runtime 污染；
- 支持 sync return/throw、Promise fulfill/reject 与 identity observation；
- benchmark runner 返回 sample count、total/mean/min/max 等事实，不硬编码 pass/fail budget；
- 有 harness 自测证明相同 scenario 的两次运行 parity 成立、差异可被报告；
- repository policy、typecheck、tests、build、client bundle、real DSH Web E2E 全绿。

## Risks

- object identity 不能跨独立 runtime 直接用 `===` 比较，因此 scenario 必须把关键 identity 转成稳定 observation（例如 same-as-input / same-error sentinel），而不是比较两个 runtime 的对象本体。
- microbenchmark 噪声较大，本阶段只建立测量管道，不把 CI 机器波动变成硬失败。
