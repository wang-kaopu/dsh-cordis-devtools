# Agent Note: Profiler client integration

Status: proposed

## Problem

Host 已通过独立 loopback RPC 提供 profiler snapshot 与 explicit instrumentation enable/disable，`ProfilerView` 也已作为纯 props fixture component 合并。现在需要把两者接进真实 DSH Web，同时保持原 Events/Timeline/Fibers observer poller 不变，并确保“打开 Profiler”本身不会自动开启 instrumentation。

## Proposal

### 1. 独立 Profiler port/store

新增 profiler client port/store，与现有 observer `EventExplorerStore` 分离：

- `profiler/snapshot` 读取 `WaterfallProfilerSnapshot`；
- `instrumentation/enable|disable` 做显式 toggle；
- 仅 Profiler view 激活时启动 1s profiler polling；
- 不允许 overlapping requests；关闭 Profiler / panel 时停止并 abort；
- stale/error 保留上一次成功 traces/status，不清空诊断现场；
- mutation 成功立即采用 Host 返回 snapshot；失败保留旧状态并暴露 error；
- 打开 Profiler 只读取 snapshot，绝不隐式调用 enable endpoint。

### 2. DevtoolsShell 增加第四个 Profiler view

在现有 `Events | Timeline | Fibers` 后增加 `Profiler`：

- observer store 的生命周期/单 poller 逻辑保持不变；
- Profiler tab 激活时才 activate profiler store；切走时 deactivate；
- Profiler 不复用 Events/Timeline/Fibers 的 query/mode/state filter，以免一个无意义的共享搜索框干扰视图；
- owner Fiber Pill 继续复用现有 `openFiber(uid)` 导航，导航后 Profiler polling 自动停止；
- 不新增 router。

### 3. 显式 instrumentation control

扩展 `ProfilerView` props，使用 DSH `Button` / `Pill`：

- `disabled` → `Enable profiling`；
- `enabled` → `Disable profiling`；
- `conflict` / `unsupported` 不提供会误导的可执行 enable；明确展示状态；
- mutation 期间禁用按钮并保持稳定文本，避免 jitter；
- error 使用轻量文本，不新增 divider/border 体系。

不记住 enabled 状态；进程重启仍由 Host 返回 disabled。

### 4. 测试与真实 Web smoke

组件/store tests 验证：

- 打开 Profiler 只 snapshot，不 enable；
- profiler poller 与 observer poller 分离且无 overlap；
- explicit toggle endpoint 只调用一次并立即更新；
- 切走/关闭 panel 后停止 profiler poll；
- transient profiler error 保留 prior snapshot；
- owner Pill → Fiber 导航并停止 profiler poll。

real DSH Web E2E 增加 Profiler tab/default disabled/enable/disable smoke。测试不依赖真实运行时必然产生某条 waterfall trace，不调用模型或写假 API key；最后主动 disable，保持 runtime clean。

## Alternatives considered

- 把 profiler traces 合并进现有 `EventExplorerStore` 的 snapshot poller。拒绝；会让默认 observer polling 承担 instrumented trace 负担并破坏 Host 已建立的 transport 分离。
- 打开 Profiler 时自动 enable。拒绝；违反 I0 explicit opt-in，并让纯查看 UI 具有 runtime mutation 副作用。
- 在 Profiler 中复用共享 search/filter header。拒绝；当前 profiler contract 尚未冻结搜索语义，强行复用会增加无效共享状态。
- 新建独立 modal/panel。拒绝；DevTools 已有统一 shell，第四个 view 足够且能复用现有 cross-navigation。

## Acceptance criteria

- Profiler 是第四个 shell view；
- 打开 Profiler 不自动 enable；
- profiler polling 仅 active view 时运行，observer polling 行为不回归；
- enable/disable 必须 explicit user action；
- status/error/busy 清晰且不出现 refresh jitter；
- conflict/unsupported 不做静默恢复；
- owner → Fiber cross-nav 工作并停止 profiler polling；
- 现有三视图 filters/navigation/stale refresh tests 继续通过；
- real Web smoke 覆盖 disabled → enabled → disabled；
- repository policy、typecheck、tests、build、client bundle、real DSH Web E2E 全绿。

## Risks

- 两个 poller 共存时必须严格限制 profiler 仅在 active tab，避免无意义 RPC 放大。
- DSH primitive 的 disabled/button DOM 语义应以真实 package 行为测试，不绑死实现标签。
- E2E toggle 会临时 patch runtime，因此无论后续断言如何设计，都应在正常路径显式 disable；Host plugin disposal 仍是兜底恢复机制。
