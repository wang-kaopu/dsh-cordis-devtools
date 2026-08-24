# Agent Note: v0.3 waterfall instrumentation architecture

Status: proposed

## Problem

v0.2 的 observer path 只能从 `internal/dispatch`、listener registry 和 live Fiber state 观察 Cordis 已经暴露的事实。它无法可靠回答 waterfall 中哪些 listener 实际进入、每个 listener 花了多久、`next()` 调用了几次、链在什么位置停止等问题。

I0 必须在写 production instrumentation 前确定一个可撤销、默认关闭、尽量不改变 Cordis 语义的插桩边界。

当前 discovery 基于 DeepSeek Harness `master` 中 `@deepseek-ai/cordis` 4.0.1：

- `EventsService.dispatch()` 负责解析 `thisArg` / event name、触发一次 `internal/dispatch`、执行 `Context.filter`，最后把匹配 Hook 的 callback 绑定到 dispatch `thisArg`；
- `EventsService.waterfall()` 只消费 `dispatch('waterfall', args)` 返回的 callback 数组，并通过 `cbs.shift()` + 一个零参数 continuation 组成链；
- `EventsService.unregister()` 用 `hook.callback === callback` 删除 listener；
- `ctx.on()` 在注册前通过 `ctx.reflect.bind()` 包装 callback，再把这个 callback 放进 `_hooks`；
- `ctx.waterfall` 是 `ctx.mixin('events', ...)` 对 `ctx.events.waterfall` 的动态转发。

因此，直接替换 `_hooks[].callback` 会破坏 disposer / unregister identity；直接重写 `waterfall()` 又会复制最敏感的 continuation 语义。

## Proposal

### 1. 默认 observer path 完全不插桩

instrumentation 默认关闭。安装 DevTools、打开面板、普通 snapshot polling 都不修改 target listener、`EventsService.waterfall()` 或 `_hooks`。

v0.3 通过 loopback-only DevTools RPC 暴露一个显式 enable / disable 控制。UI 必须持续显示当前 instrumentation 状态；不能静默启用，也不跨进程重启自动保持 enabled。

### 2. 只在 enabled 时安装 instance-level `ctx.events.dispatch` adapter

推荐 seam 是当前 runtime 的 `ctx.events.dispatch` 实例方法，而不是 Hook callback 或 `waterfall()` 本身。

- 非 `waterfall` mode：原样 delegate 到保存的原始 `dispatch`；
- `waterfall` mode：由一个隔离的 Cordis compatibility adapter 执行当前 4.0.1 `dispatch()` 等价逻辑，并返回 **dispatch-local wrapped callbacks**；
- `_hooks` 中保存的 callback 永远不改；
- `EventsService.waterfall()` 本身不改，继续使用 Cordis 原生 `cbs.shift()` / `next()` 机制。

waterfall adapter 必须保持当前 dispatch 顺序：

1. 从参数中解析可选 `thisArg`；
2. 读取 event name；
3. 对非 internal event 精确触发一次 `internal/dispatch`；
4. 读取 `thisArg?.[Context.filter]`；
5. 对每个 Hook 只执行一次 filter 判断；
6. 保持原 Hook 顺序；
7. 用原 callback 的 `bind(thisArg)` 结果作为实际 target，再在 dispatch-local 层包 instrumentation wrapper。

之所以不先调用原 `dispatch()` 再重新匹配 Hook metadata，是因为那会再次执行 filter；filter 是用户可观察函数，双调用本身就是语义变化。

### 3. 每次 dispatch 创建独立 trace context

每个 waterfall invocation 创建自己的 trace context，不使用全局“当前 listener”可变栈作为正确性的前提。

每个 dispatch-local wrapper至少持有：

- 当前 dispatch trace id；
- event；
- dispatch order；
- 对应 Hook 的 runtime-local listener id；
- owner Fiber snapshot/reference；
- 进入时间；
- listener 自己观察到的 `next()` call records。

I1 再冻结最终 serializable contract；I0 不承诺 `selfTime`。

### 4. `next()` 只做一层透明 delegation

wrapper 调用 target listener 时，只替换最后一个 `next` 参数为 traced continuation。其他参数不采集、不复制进 trace。

traced continuation：

- 每次调用都新增一个 next-call record；
- 每次都立即调用原始 `next()` 一次；
- 返回原始 `next()` 的原值 / 原 Promise / 原 thenable；
- 原始 throw 原样抛出；
- 不阻止重复 `next()`；
- 不缓存 downstream result；
- 不把“调用过一次 next”强行解释为只有一个 downstream。

Cordis 当前允许 repeated `next()` 继续消费剩余 `cbs`，所以 profiler 必须记录事实，不能把第二次调用视作非法并拦截。

### 5. 不发布不可撤销的 `shortCircuit: boolean`

listener settled 时“尚未观察到 next”不等于未来永远不会调用 next：listener 可以保存 continuation 并在返回后晚些调用。

因此 I1 应优先记录 continuation events / counts / timestamps，而不是在 listener 返回瞬间固化一个不可更正的 `shortCircuit` 布尔值。UI 只有在 trace 当前事实足够时才能显示“未观察到 next / late next / chain stopped”等状态。

### 6. 保持同步返回、throw 和 Promise identity

listener wrapper 不能写成 `async function`，否则同步 listener 会被强制 Promise 化。

- 同步返回：返回同一个值；
- 同步 throw：记录 outcome 后重新抛出同一个 error object；
- Promise / thenable：必须把 target 原始返回对象原样返回给 Cordis/caller，不能返回 `.then()` 派生 Promise。

若要获得 promise settled 时间和 fulfilled/rejected outcome，标准 JS 需要给原返回对象挂 side continuation。这个 side observation 会改变 native Promise 的 host-level handled/unhandled bookkeeping，即使 caller 看到的 Promise identity、resolve value 和 rejection reason 都保持不变。

I0 接受这个限制仅存在于**用户显式开启的 instrumented mode**，并要求 I3 parity/overhead harness 明确覆盖 rejection propagation；文档必须说明 instrumented mode 不是“零观察副作用”。默认 observer mode 仍然保持 behavior-neutral。

### 7. nested / reentrant waterfall 独立记录

nested 或 reentrant `ctx.waterfall()` 会创建新的 dispatch trace。v0.3 baseline 不要求通过 AsyncLocalStorage 构造跨-dispatch parent/child tree；先保证每个 invocation 自身的 listener/next 事实正确并通过 parity matrix。

如果以后需要 nested trace relation，应作为独立 contract 变更，而不是让 I2 的正确性依赖全局 async context。

### 8. enable / disable 必须 fail closed

Instrumentation controller 在 enable 时：

- 检查当前 `ctx.events.dispatch` 是否仍是预期 Cordis dispatch 实现，避免静默覆盖其他 runtime patch；
- 检查 `_hooks` / `Context.filter` 等 compatibility seam 是否存在；
- 只在 guard 全部通过时安装自己的 instance-level dispatch adapter；
- repeated enable 必须幂等。

在 disable / plugin disposal 时：

- 只有当当前 instance dispatch 仍然是 DevTools 安装的 wrapper 时才恢复原 descriptor / 原实现；
- 若另一个组件在 instrumentation 期间覆盖了 dispatch，不得强行覆盖对方，状态进入 conflict/fail-closed 并明确暴露；
- repeated disable 必须幂等。

初始 compatibility target 是当前已验证的 Cordis 4.0.1 行为。扩大支持范围必须先让 parity matrix 在新版本通过，不能仅因为类型还能编译就自动视为兼容。

### 9. privacy 仍然 metadata-first

v0.3 trace 默认不得保存：

- raw listener arguments；
- return values；
- thrown/rejected error object 或 message；
- prompts / tool results / file contents / config / credentials。

只保存 timing、listener identity/owner、order、next-call facts 和 outcome category。任何 payload capture 都留到 v0.3 之后的单独决策。

## Alternatives considered

### A. 原地替换 `_hooks[].callback`

拒绝。当前 `unregister()` 直接按 callback identity 查找 Hook，替换 callback 会使已有 disposer/`once()`/Fiber disposal 语义变脆弱，且恢复时需要处理在 instrumentation 期间新增、删除、重启的 listeners。

### B. 重写或 monkey-patch `EventsService.waterfall()`

拒绝。`waterfall()` 的 `cbs.shift()`、innermost next、repeated next 和返回语义正是需要测量而不是复制的核心。DevTools 不应该自己实现一份 Cordis continuation engine。

### C. 只监听 `internal/dispatch`

拒绝。它发生在 public listeners 执行之前，只能证明 dispatch occurrence，无法知道实际进入的 listener、duration、`next()` 或 veto/late-next。

### D. 调原 `dispatch()` 后再从 `_hooks` 重新 filter 一次做 metadata correlation

拒绝。会再次调用 `Context.filter`，可能产生额外副作用或不同结果，不能视为 behavior-preserving。

### E. 先要求 Cordis upstream 新增官方 instrumentation hook

这是长期最干净的方向，但不作为 v0.3 的前置条件。当前项目已经有隔离 private seam 的 compatibility adapter 先例；v0.3 可以在该边界内实现并用严格 parity tests 保护。若 upstream 后续提供官方 dispatch metadata/instrumentation seam，应优先迁移并减少本地镜像逻辑。

## Acceptance criteria

I0 只有在 maintainer 明确批准本 Note 后才算通过。之后 I1/I2 必须满足：

- disabled/default path 不修改 `_hooks`、target callback identity 或 `waterfall()`；
- instrumented path 不修改 `_hooks[].callback`；
- non-waterfall dispatch 完全 delegate 原实现；
- waterfall listener filtering 每个 Hook 每次 dispatch 最多执行一次；
- 原 Cordis `waterfall()` continuation engine 保持原实现；
- sync return / same error object / original Promise identity 保持；
- repeated next、late next、nested/reentrant waterfall 不被拦截；
- enable / disable / disposal / double-toggle / patch-conflict 有测试；
- compatibility 不满足时 fail closed，不静默猜测；
- I1 behavior matrix至少覆盖 zero listener、single/multiple listener、prepend、filtered listener、sync before/after next、async before/after next、throw、reject、nested waterfall、repeated next、late next、listener disposal/restart；
- I1 不发布尚未定义清楚的 `selfTime`；
- I3 同时验证 semantic parity 和 overhead。

## Risks

- **Upstream drift**：waterfall branch 需要镜像当前 `dispatch()` 的一小段 selection/filter/bind 逻辑；Cordis 升级后必须通过 compatibility guard + parity tests 才能扩大支持。
- **Promise handled-state**：为了观测 async settlement 挂 side continuation 会影响 host-level unhandled-rejection bookkeeping；这是 explicit instrumented mode 的已知代价，不允许扩散到 observer mode。
- **Monkey-patch conflict**：其他插件也可能 patch `ctx.events.dispatch`。因此安装和恢复都必须 compare-and-swap / fail closed，不能互相覆盖。
- **Overhead**：每个 waterfall invocation 会增加 dispatch-local closures、timing 和 next records。I3 必须给出 disabled/enabled 的实测基线。
- **Late continuation**：listener 返回/settle 后仍可能调用保存的 next，trace 不能过早冻结 chain-stop 结论；I4 retention 需要允许 bounded trace 在窗口内继续修订。
