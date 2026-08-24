# Agent Note: Instrumentation semantic parity and overhead

Status: proposed

## Problem

I2 core 已经能显式启用 waterfall instrumentation，I1 behavior matrix 和 I3 harness scaffold 也已合并，但目前还没有把同一 caller-visible scenario 成对运行在 uninstrumented / instrumented runtime 下，也没有给 disabled/enabled 路径建立实际 overhead 样本。

## Proposal

在测试层扩展现有 parity harness，不修改 production instrumentation：

- 用真实 `WaterfallInstrumentationController` 作为 candidate prepare hook；
- baseline 与 candidate 每次都创建独立 Cordis `Context`；
- 覆盖 I1 matrix 中最关键的 caller-visible 语义：zero listener、multi listener/order、no-next、prepend、context filter/this、sync throw identity、Promise fulfill/reject identity facts、async before/after next、nested、repeated next、late next、dispose/restart；
- 比较结果只来自 scenario observation，不以 trace 输出作为 correctness oracle；
- 另加 disabled/enabled microbenchmark samples，记录事实并检查样本结构，不设易抖的百分比 CI 门槛；
- benchmark scenario 使用固定 listeners / fixed iterations，避免网络、I/O 或 timer sleep。

## Alternatives considered

- 只把 I2 自身测试视为 parity。拒绝；I2 测试验证局部 invariants，I3 必须用独立 paired runner 比较完整 caller-visible behavior。
- 直接比较两个 runtime 的 Error/Promise 对象。拒绝；跨 runtime identity 没意义，应在 scenario 内转换成 `sameError` / `samePromise` 等稳定 observation。
- 在 CI 添加固定 overhead 百分比 gate。拒绝；hosted runner 抖动较大，本阶段先记录 measurement pipeline 和数量级事实。

## Acceptance criteria

- candidate prepare hook 真实 enable I2 controller；
- baseline/candidate 对关键 waterfall matrix 全部 parity；
- repeated/late next 不被归一化或禁止；
- Promise / error identity 通过 scenario-local facts 验证；
- disabled/enabled benchmark 都产出 samples/mean/min/max；
- 测试不依赖 profiler trace 作为 parity oracle；
- repository policy、typecheck、tests、build、client bundle、real Web E2E 全绿。

## Risks

- benchmark 只能作为回归基线事实，不能从单次 CI 推导稳定性能预算。
- Promise settlement instrumentation 有 I0 已批准的 handled-state side observation；parity 关注 caller-visible resolve/reject/identity，不宣称 host-level unhandled bookkeeping 完全相同。
