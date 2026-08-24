# Agent Note: Instrumentation parity harness

Status: implemented

## Problem

I3 需要比较同一个 waterfall scenario 在 uninstrumented / instrumented runtime 下的 caller-observable behavior，并给 disabled/enabled overhead 建立可重复基线。I2 尚未实现时，可以先把与具体 instrumentation 解耦的 runner / observation / comparison 基础设施搭好。

## Decision

测试层新增独立 parity harness：

- `runScenario()` 每次创建全新 Cordis `Context`，执行可选 prepare hook 后运行 scenario；
- outcome 区分 sync returned/threw 与 async fulfilled/rejected；
- error identity 通过 caller-supplied token 映射为稳定 observation，避免跨 runtime 比较对象本体；
- `compareParity()` 使用 deep equality 比较 outcome/value/error token，并返回具体差异字段；
- `benchmark()` 只记录 samples/total/mean/min/max，不设性能阈值；
- helper 不 import production instrumentation 或 trace contract。

## Alternatives considered

- 把 parity assertions 直接写进 I2 tests。拒绝，因为会让 oracle、runner 和 production wrapper 同分支演化。
- 现在就添加固定百分比性能门槛。拒绝，因为还没有真实 enabled baseline，CI microbenchmark 噪声也较大。
- 依赖 I1 trace contract。拒绝；semantic parity 比较 caller-observable behavior，不应以 profiler 输出作为正确性来源。

## Consequences

I2 合并后可以仅通过 prepare hook 注入 instrumentation，复用同一个 paired runner；I3 后续只需增加真实 scenario 与 enabled/disabled benchmark，而不重写比较基础设施。当前 benchmark 是测量管道，不是性能 gate。
