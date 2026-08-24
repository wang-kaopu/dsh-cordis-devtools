# Agent Note: Waterfall behavior matrix

Status: proposed

## Problem

I2 必须证明 instrumented mode 没有改变 Cordis waterfall 的原生语义。只靠实现后写测试容易把 wrapper 的错误行为当成预期，因此需要先把当前 `@deepseek-ai/cordis` 4.0.1 的 waterfall 行为固定成独立 baseline oracle。

## Proposal

新增真实 Cordis integration matrix，只调用原生 `Context` / `ctx.on()` / `ctx.waterfall()`，不引用 DevTools instrumentation 实现。覆盖：

- zero listener；
- single/multiple listener 与 before/after next 顺序；
- no-next veto；
- prepend ordering；
- context filter；
- same `this`；
- sync throw identity；
- Promise identity 与 fulfilled/rejected propagation；
- async work before/after next；
- nested waterfall；
- repeated next；
- late next；
- listener disposer / restart while runtime remains live。

每个 scenario 断言 caller 可观察的返回值/对象 identity、事件顺序、this、error/rejection identity 与 side effects。测试不定义 profiler trace schema。

## Alternatives considered

- 等 I2 完成后直接测试 instrumentation。拒绝，因为会缺少独立 oracle，容易把实现行为反向定义成预期。
- mock Cordis `dispatch()` / `_hooks`。拒绝，因为矩阵的目的就是锁定真实 upstream continuation/filter/registration 语义。
- 把所有 case 塞进一个超长测试。拒绝，因为单个失败难定位，也不利于 I3 paired harness 复用 scenario。

## Acceptance criteria

- 使用真实 `@deepseek-ai/cordis`；
- 不 import production instrumentation；
- I0 指定的关键 waterfall case 都有明确断言；
- repeated/late next 的事实按 Cordis 当前实际行为锁定，不人为禁止；
- tests 可作为 I3 parity 的 baseline oracle；
- repository policy、typecheck、tests、build、client bundle、real DSH Web E2E 全绿。

## Risks

- upstream Cordis 版本升级可能合法改变行为；此时 matrix 应主动失败并触发 compatibility review，而不是静默放宽断言。
- late-next 测试需要确定性调度，避免依赖任意 sleep。
