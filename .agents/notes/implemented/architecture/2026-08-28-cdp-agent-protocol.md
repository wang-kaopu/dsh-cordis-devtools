# Agent Note: 引入 CDP-shaped Agent 调试协议

Status: implemented

## Problem

当前 `dsh-cordis-devtools` 已经具备 Agent 调试协议最难的运行时基础：精确 target/session 身份、`targetEpoch`、bounded snapshot、单调 observation sequence、bounded journal、gap 检测、等待取消、精确 diagnostics 查询，以及由单一 coordinator 管理的有限期 profiler experiment lease。

但这些能力目前仍主要以一组不断增长的 MCP tool 暴露给 Agent。每增加一个调试能力，都倾向于增加一个新的顶层 tool 和一条新的工作流规则；Agent 必须提前知道这些名字，而不能像使用 Chrome DevTools Protocol 一样先发现协议，再通过统一的 command/event 模型探索 live runtime。

同时，浏览器 UI 仍通过 request/response snapshot + polling 消费状态，而 Host 已经存在实时 `RuntimeNotificationSource`。如果只给浏览器补 WebSocket/SSE，会改善刷新延迟，却不会建立 Agent、浏览器、CLI 和未来 debugger adapter 可以共享的调试协议边界。

本方案采用 CDP 有价值的部分：target、session、domain、command、event、schema discovery 和 JSON message shape；不模拟 Chromium/V8/DOM/Page/Network/Debugger 语义，也不以兼容 Chrome DevTools Frontend 为目标。

## Decision

在现有 Agent Debug Core 之上实现 transport-neutral DevTools Protocol 层。MCP 仍是 Agent 的主 transport，Agent 面通过少量 protocol primitives 访问可发现的 command/event 模型；新增调试能力优先增加 protocol command/event，而不是继续增加 MCP tool 名称。实现位于 `src/shared/devtools-protocol.ts`、`src/host/agent-debug/protocol.ts` 和 `src/host/mcp.ts`，target/session/journal/lease ownership 仍由现有 Core 持有。

### 1. 协议 JSON envelope

所有 adapter 使用同一套 CDP-shaped envelope。

Command：

```json
{
  "id": 17,
  "method": "Fiber.get",
  "params": { "uid": 31 },
  "sessionId": "debug-session-id"
}
```

Success response：

```json
{
  "id": 17,
  "result": { "fiber": {} },
  "sessionId": "debug-session-id"
}
```

Error response：

```json
{
  "id": 17,
  "error": {
    "code": -32001,
    "message": "stale debug session"
  },
  "sessionId": "debug-session-id"
}
```

Event：

```json
{
  "method": "Cordis.dispatchObserved",
  "params": {
    "sequence": 1042,
    "dispatchId": 381,
    "event": "agent/pre-step",
    "mode": "serial"
  },
  "sessionId": "debug-session-id"
}
```

`id` 只属于 command/response；event 没有 `id`。`sessionId` 对 session-scoped command/event 必须显式携带，不使用 MCP transport session 代替 debug session。

### 2. 第一版 Domain

第一版只实现当前 Host 已有权威数据可以支撑的 domain：

```text
Schema.*
Target.*
Cordis.*
Fiber.*
Profiler.*
```

第一版实现的 command 集：

```text
Schema.getDomains

Target.getTargets
Target.attachToTarget
Target.detachFromTarget

Cordis.enable
Cordis.disable
Cordis.getSnapshot
Cordis.getEvent
Cordis.getListeners
Cordis.searchDispatches

Fiber.list
Fiber.get

Profiler.enableEvents
Profiler.disableEvents
Profiler.getStatus
Profiler.getTraces
Profiler.startExperiment
Profiler.stopExperiment
```

其中 `*.enable` / `*.disable` 只控制该 debug session 是否接收对应低成本 protocol events；不得因为 `Profiler.enableEvents` 而自动开启 waterfall instrumentation。真正 instrumentation mutation 仍只能通过现有 `WaterfallExperimentCoordinator` 的有限 lease 语义进行。

第一版 event 只映射 Host 已经能权威产生的事实：

```text
Target.targetDestroyed
Cordis.dispatchObserved
Cordis.topologyInvalidated
Profiler.traceUpdated
Profiler.statusChanged
```

不要为了 API 对称性伪造 `Fiber.created`、`Fiber.disposed`、`Cordis.listenerExecuted`、dispatch completion 等当前无法直接证明的细粒度事件。后续只有在 Cordis 提供足够权威信号时再增加。

### 3. Protocol introspection

必须提供运行时协议发现，而不是把协议只写在 Skill 或 README 中。

`Schema.getDomains` 返回 machine-readable schema，至少包含：

- domain 名称与说明；
- command 名称、说明、参数 schema、返回 schema；
- event 名称、说明、参数 schema；
- experimental/deprecated 标志（如未来需要）；
- protocol version。

协议 schema 由 TypeScript contract 单一来源生成并通过 `Schema.getDomains` 暴露，避免 MCP schema、Browser client types、未来 WebSocket protocol JSON 各自维护一份。

### 4. MCP Agent primitive

MCP 主面收敛为少量 protocol primitive：

```text
cordis_devtools_get_protocol
cordis_devtools_list_targets
cordis_devtools_attach
cordis_devtools_send
cordis_devtools_read_events
cordis_devtools_wait_for_event
cordis_devtools_detach
```

其中 generic sender 是可发现 command 的统一入口；它本身不授予 mutation authority，MCP adapter 只在 bearer token 和显式 experiment capability 同时满足时放行 Profiler mutation。其余 primitive 仅负责 discovery、session、bounded read/wait 和 detach。

其中：

- `get_protocol`：返回协议 schema；
- `list_targets`：Target discovery convenience primitive；
- `attach`：返回 exact `targetId` / `targetEpoch` / `sessionId`；
- `send`：传入 `sessionId + method + params`，由统一 command router 分发；
- `read_events`：从 `afterSequence` 读取已保留事件；
- `wait_for_event`：bounded long-poll，支持 exact method/event filter、timeout、abort；
- `detach`：释放 session-owned waiter/cursor/lease。

现有 focused MCP tools 第一阶段继续保留，作为兼容/便利 adapter 委托到同一个 Core；不要立即删除或维护第二套状态。

### 5. Snapshot + event 一致性

不能出现“snapshot 构建期间发生了变化，但 Agent 既没在 snapshot 中看到，也从 event cursor 后看不到”的静默丢事件窗口。

采用 pre-snapshot barrier：

```text
capture current journal sequence = N
        ↓
build authoritative snapshot
        ↓
return snapshot + eventCursor=N
        ↓
consume events with sequence > N
```

这样 snapshot 构建期间发生的变化可能导致 snapshot 与后续 invalidation/event 有重叠，但不会静默漏掉。

如果 `afterSequence` 早于 journal 的 retained window，返回显式 `gap`，并附带 `oldestSequence`、`newestSequence`、`retained`、`truncated`。Agent 必须重新 `Cordis.getSnapshot` 后从新 cursor 恢复，不能把 bounded absence 当作“从未发生”。

### 6. Target/session 生命周期

复用当前 Agent Debug target/session 模型，不新建第二套 registry。

必须保持：

- target replacement 生成新的 target id/epoch；
- old session 不自动 rebind；
- detach、idle expiry、target replacement、target disposal、Host disposal 都会取消 pending waits；
- session-owned experiment lease 精确释放；
- sequence/cursor 不跨 target incarnation 复用；
- stale/session-not-found/error 都通过统一 protocol error 返回。

### 7. Browser 迁移边界

本分支完成 Protocol Core + MCP adapter；Browser protocol client、增量 reducer 和移除旧 snapshot polling 保持延期，不为了引入协议而删除现有 snapshot RPC。

推荐迁移顺序：

```text
Protocol Core
    ↓
MCP primitives
    ↓
Browser ProtocolClient bootstrap snapshot
    ↓
incremental event reduce
    ↓
确认稳定后移除 1s polling
```

Browser 也应最终消费同一 protocol contracts，避免出现 Agent protocol 与 Human UI runtime model 两套语义。

### 8. 文件级实现清单

Codex 实现时优先按下面边界修改；若实际代码已有更合适的同层文件，可调整文件名，但不要改变 ownership 原则。

#### Shared contract

- `src/shared/agent-debug.ts`
  - 保留现有 target/session 类型；必要时抽出可复用 identity/session 类型。
- 新增 `src/shared/devtools-protocol.ts`
  - 定义 command/response/error/event envelope；
  - 定义 protocol schema/domain descriptors；
  - 定义 method/event name union 或 registry types；
  - 不引入 MCP、HTTP、WebSocket、React、Cordis implementation 类型。
- 如 schema 过大，可新增 `src/shared/devtools-domains/*.ts`，但第一版不要过度拆分。

#### Host Core

- `src/host/agent-debug/service.ts`
  - 保持唯一 target/session/journal/lease owner，并提供 observation read 与 session domain subscription；
  - 保留 target/session/journal/lease 单一 ownership；
  - 增加 generic `send` command routing；
  - 增加 session domain subscription 状态。
- `src/host/agent-debug/observation-journal.ts`
  - 复用现有 sequence/read/wait/window/gap；
  - 仅补足 protocol event projection 所需能力；
  - 不创建第二个事件 journal。
- `src/host/runtime-notifications.ts`
  - 保持 transport-neutral Host facts；
  - protocol event 命名转换放在 protocol adapter/Core，不把 notification source 改成 CDP transport。
- 现有 diagnostics/query/trace/coordinator 文件
  - command handler 调用现有 authoritative query；
  - profiler mutation 委托现有 coordinator。

#### MCP

- `src/host/mcp.ts`
  - 注册上述 7 个 Agent protocol primitives；
  - schema validation 后调用同一个 Protocol Core；
  - existing focused tools 继续工作并优先委托 Core/现有 authoritative query；
  - 不在 MCP adapter 维护第二套 session/journal。
- `src/bridge/server.ts`
  - 仅在 bridge 的 tool forwarding/schema 需要时调整；
  - 不要求 bridge 直接消费任意 server push。

#### Browser

- Browser client 当前不改动；后续迁移仍从 `src/client/port.ts` / `src/client/store.ts` 开始，并保留旧 snapshot RPC 作为过渡。
- Timeline/Fiber/Profiler views
  - 尽量只消费 store state，不把 transport 逻辑塞进 view。

### 9. 测试清单

至少增加以下确定性测试：

- protocol schema 能列出第一版 domains/commands/events；
- command envelope → handler → response envelope 的 id/sessionId 保持正确；
- unknown method 返回稳定 protocol error；
- stale session / replaced target 返回稳定错误且不 rebind；
- session `enable/disable` 只控制事件投递，不误开 instrumentation；
- observation → protocol event 的 sequence 单调；
- `readEvents(afterSequence)` 不重复返回 `<= afterSequence`；
- `waitForEvent` 支持 method/event filter、timeout、abort；
- journal overflow 后 old cursor 返回 `gap`；
- snapshot pre-barrier 场景不会静默漏掉 snapshot 构建期间的 notification；
- detach/expiry/disposal 会取消 waiter 并释放 exact-owner lease；
- focused legacy MCP tools 与 generic protocol primitives 观察到同一 authoritative state；
- 不采集 raw args/returns/error message/prompts/tool output/file contents/token。

优先扩展现有：

```text
tests/agent-debug-service.spec.ts
tests/mcp-agent-debug.spec.ts
tests/agent-debugging-proof.spec.ts
```

可新增：

```text
tests/devtools-protocol.spec.ts
tests/devtools-protocol-mcp.spec.ts
```

## Alternatives considered

**保留现有 MCP tools，只给浏览器增加实时 SSE/WebSocket。** 不作为主方案，因为它只解决 Human UI freshness，没有解决 Agent 调试接口持续膨胀和不可探索的问题。

**直接让 Agent 使用 raw CDP WebSocket。** 不作为主方案，因为 MCP-capable coding Agent 更适合 bounded tool call + cursor + long-poll；让模型宿主维持任意长连接会增加 integration 成本，而且当前 journal/wait 语义已经更适合 Agent turn。

**完整兼容 Chrome DevTools Protocol。** 不采用，因为 Cordis 没有真实的 DOM/Page/Network/Debugger/V8 execution-context 等浏览器语义。为了让 Chrome DevTools Frontend 工作而伪造这些 domain 会制造错误诊断和巨大维护成本。

**继续每个能力增加一个 MCP tool。** 不采用，因为 tool namespace 会随功能线性增长，Agent 需要提前知道所有能力，无法通过协议 schema 自发现。

**重新实现一套独立 target/session/event state machine。** 不采用。当前 `AgentDebugService`、observation journal 和 coordinator 已经提供正确的 identity、bounded retention、gap、wait cancellation、lease ownership；协议层必须复用它们。

## Consequences

实现提供 transport-neutral 的 CDP-shaped protocol schema 与 JSON envelope 类型，包含 `Schema`、`Target`、`Cordis`、`Fiber`、`Profiler` domains，并通过 MCP primitives 完成 discover → attach → send → wait/read → query → detach 全流程。

事件使用单调 sequence，支持 bounded read/wait、timeout、abort、gap 和 pre-snapshot barrier；target replacement 不会自动 rebind 旧 session。Profiler event subscription 与 instrumentation mutation 分离，mutation 继续由唯一 `WaterfallExperimentCoordinator` 管理并受 MCP token/capability/lease/exact-owner cleanup 约束。

现有 focused MCP tools 保持可用且不拥有平行 runtime/debugger 状态。协议和文档明确不宣称 Chrome DevTools Frontend、Chromium domains、`chrome://inspect` 或 native WebSocket 兼容。`tests/devtools-protocol.spec.ts` 与 `tests/devtools-protocol-mcp.spec.ts` 覆盖核心和真实 MCP 入口；完整 policy/typecheck/test/build 作为交付验证。

## Deferred work and safeguards

**协议层与现有 Agent Debug Core 重复 ownership。** 这是最高风险。当前实现只包装现有单一 owner，没有新建 target registry、session registry、journal、trace store 或 coordinator。

**generic `send` 降低可发现性。** 通过 `Schema.getDomains`、详细 description、machine-readable params/results schema 和 Skill 的 discover-first workflow 约束；schema 不只存在于文档中。

**snapshot/event race 导致 Agent 得到错误稳定性判断。** 当前实现使用 pre-snapshot sequence barrier 与显式 gap recovery，并继续声明 bounded absence 不是 complete history。

**Domain `enable` 被误实现成 profiler mutation。** event subscription 与 instrumentation ownership 是不同 contract；会改变 profiling 行为的命令走现有 coordinator/approval/security 边界。

**CDP-shaped 命名被误读为完整 CDP 兼容。** protocol metadata、README、architecture 和 Skill 均明确：兼容的是 command/event/session JSON 模型，不是 Chromium semantic domains 或 DevTools Frontend。Native WebSocket/discovery transport 和 Browser 增量迁移仍需后续决策。
