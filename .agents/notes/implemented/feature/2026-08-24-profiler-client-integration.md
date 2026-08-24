# Agent Note: Profiler client integration

Status: implemented

## Problem

Host 已通过独立 loopback RPC 提供 profiler snapshot 与 explicit instrumentation enable/disable，`ProfilerView` 也已作为纯 props component 合并。需要把两者接进真实 DSH Web，同时保持原 Events/Timeline/Fibers observer poller 不变，并确保“打开 Profiler”本身不会自动开启 instrumentation。

## Decision

### 独立 Profiler port/store

新增 `profiler-port.ts` 与 `profiler-store.ts`，不修改现有 `EventExplorerStore`：

- `profiler/snapshot` 只读 profiler metadata；
- `instrumentation/enable|disable` 只有 explicit toggle 才调用；
- profiler store 只在 `open && view === 'profiler'` 时 activate，1s polling 与 observer poller 分离；
- request 不重叠；explicit mutation 会 abort 正在进行的 profiler read，避免用户点击被后台 polling 吞掉；
- 切走/关闭时停止 timer、abort request，并清理 loading/mutating 状态；
- refresh/mutation 失败保留上一次成功 snapshot 并标 stale；
- RPC boundary 完整校验 instrumentation state、trace/listener/next metadata shape。

### 第四个 Profiler view

`DevtoolsShell` 增加 `Profiler` tab：

- observer store 仍按 panel open 生命周期工作；
- profiler store 仅 Profiler tab 激活；
- Profiler 隐藏 Events/Timeline/Fibers 共用 search/filter toolbar，不制造未定义的 profiler 搜索语义；
- header refresh 在 Profiler 下只刷新 profiler snapshot；
- profiler error/stale 独立显示；
- trace owner 通过既有 `openFiber(uid)` 返回 Fibers，若 uid 不在 live inventory 则保持不可导航。

### 显式 instrumentation control

`ProfilerView` 复用 DSH `Button` / `Pill`：

- disabled → `Enable profiling`；
- enabled → `Disable profiling`；
- conflict / unsupported 只显示解释，不提供误导性的 toggle；
- mutation 期间禁用按钮，但文案保持稳定，避免周期性 jitter；
- 不增加额外 divider/border 体系。

### Verification coverage

新增 profiler port/store/shell tests，并扩展 real DSH Web smoke：

- 打开 Profiler 只 fetch snapshot，不 enable；
- observer fetch count 不因普通三视图导航改变；
- explicit toggle 立即采用 Host 返回状态；
- owner → Fiber 会 deactivate profiler store；
- real Web smoke 验证真实 Host `disabled → enabled → disabled`，不依赖模型调用或特定 trace 出现。

## Alternatives considered

- 把 profiler traces 合并进 `EventExplorerStore`。拒绝；会让默认 observer polling 承担 instrumented trace 负担，并破坏 Host transport 分离。
- 打开 Profiler 自动 enable。拒绝；违反 I0 explicit opt-in，纯查看 UI 不应产生 runtime mutation。
- 共用 search/filter toolbar。拒绝；profiler contract 尚未定义过滤语义，避免无效共享状态。
- 新建独立 modal/panel。拒绝；现有 DevTools shell 足够，第四个 view 可直接复用 cross-navigation。

## Consequences

v0.3 waterfall profiler 从 Host 到真实 DSH Web 已形成显式 opt-in 闭环：默认 observer 路径不启用 instrumentation；只有进入 Profiler 后才增加独立 read polling，只有用户点击控制按钮才 patch runtime。两个 transport/store 生命周期保持分离，后续若增加 cursor/revision 或 profiler filtering，可在 profiler 专用路径演进而不改变 v0.2 snapshot contract。
