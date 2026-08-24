# Agent Note: Instrumentation semantic parity and overhead

Status: implemented

## Problem

I2 core 已经能显式启用 waterfall instrumentation，I1 behavior matrix 和 I3 harness scaffold 也已合并，需要把同一 caller-visible scenario 成对运行在 uninstrumented / instrumented runtime 下，并给 disabled/enabled 路径建立实际 overhead 样本。

## Decision

新增真实 paired parity tests：

- candidate prepare hook 使用真实 `WaterfallInstrumentationController.enable()`；
- baseline 与 candidate 每次都创建独立 Cordis `Context`；
- 每个 scenario 只使用 harness 传入的 Context，避免内部新建未 instrument 的 runtime；
- 覆盖 zero listener、multi listener/order、no-next、prepend、context filter/this、sync throw identity、Promise fulfill/reject identity facts、async before/after next、nested、repeated next、late next、dispose/restart；
- correctness 只比较 caller-visible scenario observation，不把 profiler trace 当 oracle；
- disabled/enabled microbenchmark 各采固定样本，只记录 samples/mean/min/max，不设置百分比 CI gate。

## Alternatives considered

- 只把 I2 自身测试视为 parity。拒绝；I2 tests 验证局部 invariants，I3 需要独立 paired runner。
- 直接跨 runtime 比较 Error/Promise 对象。拒绝；identity 在 scenario 内转成 `sameError` / `samePromise` 稳定事实。
- 在 CI 添加固定 overhead 百分比 gate。拒绝；hosted runner 抖动较大，当前先建立 measurement pipeline。

## Consequences

I2 的 caller-visible semantic parity 现在有独立回归层；未来 instrumentation 改动若影响顺序、this、throw/reject identity、Promise identity 或 continuation 行为会直接触发 paired failure。性能数据目前只作为可重复样本，不宣称稳定预算。
