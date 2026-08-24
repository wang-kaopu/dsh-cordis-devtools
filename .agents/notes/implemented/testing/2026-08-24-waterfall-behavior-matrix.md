# Agent Note: Waterfall behavior matrix

Status: implemented

## Problem

I2 必须证明 instrumented mode 没有改变 Cordis waterfall 的原生语义。只靠实现后写测试容易把 wrapper 的错误行为当成预期，因此需要先把当前 `@deepseek-ai/cordis` 4.0.1 的 waterfall 行为固定成独立 baseline oracle。

## Decision

新增真实 Cordis integration matrix，只调用原生 `Context` / `ctx.on()` / `ctx.waterfall()`，不引用 DevTools instrumentation。矩阵覆盖 zero listener、single/multiple listener、no-next veto、prepend、context filter、listener `this`、sync throw identity、Promise identity、fulfilled/rejected propagation、async before/after next、nested waterfall、repeated next、late next、listener dispose 与 plugin restart。

测试直接断言 caller 可观察的返回值/对象 identity、事件顺序、this、error/rejection identity 与 side effects。late-next 使用保存 continuation 后同步显式调用的方式，不依赖任意 sleep。

## Alternatives considered

- 等 I2 完成后直接测试 instrumentation。拒绝，因为会缺少独立 oracle，容易把实现行为反向定义成预期。
- mock Cordis `dispatch()` / `_hooks`。拒绝，因为矩阵的目的就是锁定真实 upstream continuation/filter/registration 语义。
- 用一个宽泛 snapshot 断言所有 case。拒绝，因为单项失败难以定位具体语义漂移。

## Consequences

I2/I3 获得独立于 profiler 实现的 upstream oracle。Cordis 版本升级若改变这些行为，会先触发 matrix 失败和 compatibility review，而不是静默把新行为当成兼容。
