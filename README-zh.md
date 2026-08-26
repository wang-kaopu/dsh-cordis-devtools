<div align="center">

# DSH DevTools for Agents

**让 Coding Agent 看见它正在修改的 Cordis 运行时。**

[English](README.md) · [简体中文](README-zh.md)

</div>

Coding Agent 可以读取插件源码，但通常无法直接看到源码在 DSH 中实际形成的 Cordis 运行时状态。

这会留下一个明显的 **evidence gap**：DSH 是否真的加载了这次修改？某个 Event 是否重复注册？旧的 Fiber 是否还存活？修复完成后，运行时拓扑到底发生了什么变化？

DSH DevTools 把这些运行时信息开放给 Agent。Agent 可以在修改前检查现场，在复现过程中等待目标行为出现，并在 reload 后比较前后的运行时状态。

| 调试问题                            | DevTools 提供的信息                                      |
| ----------------------------------- | -------------------------------------------------------- |
| reload 后运行时发生了什么变化？     | checkpoint + 语义化拓扑比较                              |
| 为什么某个 Event 看起来执行了两次？ | 实时 listener 注册、数量和所属 Fiber                     |
| 旧的插件实例还在运行吗？            | 当前 live Fiber 拓扑                                     |
| 复现过程中目标行为出现了吗？        | 最近的 dispatch 记录和过滤后的 runtime wait              |
| waterfall 调用链里发生了什么？      | profiler trace，包括 listener span、耗时和 `next()` 记录 |

典型的 Agent 调试流程：

```text
检查运行时
    ↓
捕获 checkpoint
    ↓
修改插件
    ↓
正常 reload + 复现问题
    ↓
等待 / 检查当前运行时
    ↓
比较 checkpoint
```

代码修改和 reload 沿用原有开发流程。DSH DevTools 缩小 source code 与 live runtime 之间的 evidence gap，让 Agent 能根据当前进程的实际状态继续分析和验证。

## Get started

### 1. 将 DevTools 加入 DSH Web profile

在本仓库或已经构建好的本地 package checkout 中执行：

```bash
pnpm install
pnpm build
dsh plugin --profile web add ./
```

之后可以从 DSH Web 侧栏底部打开 **Cordis DevTools**，直接查看当前运行时。

### 2. 连接 Codex 或其他 MCP Host

配置目标 DSH profile，并注册 package-local stdio bridge：

```bash
dsh-cordis-debug setup --profile web --agent codex
```

按照原有开发流程 reload DSH，然后检查连接：

```bash
dsh-cordis-debug doctor --profile web
```

`setup` 会为当前 profile 创建仅 owner 可读的 token 文件，启用本地 loopback MCP endpoint，并向 Codex 注册 `dsh-cordis-devtools-mcp`。

stdio bridge 在本地读取 credential，并把 MCP 请求转发给正在运行的 DSH 进程。token 不需要进入 prompt、tool arguments、日志或诊断结果。

其他支持 MCP 的 Host 可以使用 `setup` 输出的 bridge command，或者参考 [MCP connection guide](docs/agent-runtime-diagnostics.md#connecting-an-mcp-capable-agent)。

> 当前支持 package-local binary。本地 checkout 可以直接使用；npm package、Git tag 和 GitHub Release 需要单独发布。

### 3. 让 Agent 检查、修改并验证

可以直接给 Agent 一个带运行时验证要求的任务：

> 修改这个插件之前先检查当前 Cordis 运行时并捕获 checkpoint。完成修复后，等我 reload DSH 并重新复现问题，再比较当前运行时，只根据当前保留的 runtime evidence 下结论。

典型流程：

```text
list targets
    ↓
attach session
    ↓
snapshot / focused inspection
    ↓
capture checkpoint
    ↓
修改代码 + 正常 reload + 复现
    ↓
wait / inspect current runtime
    ↓
compare checkpoint
    ↓
detach session
```

可选的 [runtime-debugging Skill](skills/dsh-runtime-debugging/SKILL.md) 提供完整的 Agent 使用流程，包括 cursor、stale session、gap recovery 和 lease cleanup。

## Interfaces

### Agent tools

| 用途                 | Tools                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session 生命周期     | `cordis_list_debug_targets`, `cordis_attach_debug_session`, `cordis_debug_snapshot`, `cordis_wait_for_runtime_change`, `cordis_detach_debug_session` |
| 定点运行时查询       | `cordis_runtime_summary`, `cordis_inspect_event`, `cordis_inspect_fiber`, `cordis_search_dispatches`, `cordis_profiler_traces`                       |
| Runtime verification | `cordis_capture_checkpoint`, `cordis_compare_current`                                                                                                |
| Waterfall experiment | `cordis_waterfall_experiment_status`, `cordis_start_waterfall_experiment`, `cordis_stop_waterfall_experiment`                                        |

Session、snapshot、wait、focused diagnostics 和 verification 都属于只读路径。

Waterfall experiment tools 会在对应的认证和 capability 配置满足后提供。

### Human DevTools

DSH Web 侧栏提供四个视图：

- **Events**：查看实时 Event 注册、listener 顺序、ownership，以及 Event → Fiber 跳转；
- **Timeline**：查看最近的 observer dispatch 元数据；
- **Fibers**：查看 live Fiber 拓扑、ownership、Effects 和最近的 dispatch context；
- **Profiler**：查看 waterfall trace，并控制 profiling instrumentation。

Human UI 和 Agent 接口使用同一套 Host runtime state。

### JSON CLI

同一套调试能力也可以通过 `dsh-cordis-debug` CLI 使用：

```bash
dsh-cordis-debug targets
dsh-cordis-debug snapshot
dsh-cordis-debug checkpoint --output checkpoint.json
dsh-cordis-debug compare --baseline checkpoint.json
```

完整命令见 [CLI reference](docs/agent-runtime-diagnostics.md#json-cli)。

### Manual loopback MCP

无法直接启动 stdio MCP server 的 Host，也可以连接 DSH 进程内嵌的 loopback MCP endpoint：

```yaml
- id: dsh-cordis-devtools
  name: dsh-cordis-devtools
  config:
    mcp:
      enabled: true
      port: 43127
```

Endpoint：

```text
http://127.0.0.1:43127/mcp
```

本地只读调试可以不配置 token。外部 waterfall experiment 需要额外的认证和显式 experiment capability。详见 [MCP authentication](docs/agent-runtime-diagnostics.md#enabling-mcp-and-authentication)。

## How it works

DSH DevTools 在 DSH 进程内部采集 Cordis 运行时信息，由 Host 统一维护，再通过 MCP、CLI、DSH 集成和 Web UI 提供给 Agent 或开发者。

```text
                           Live Cordis runtime
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
          ObserverCollector              Waterfall instrumentation
          topology + dispatch                 opt-in
                 │                                 │
                 ▼                                 ▼
             snapshots                    WaterfallTraceStore
                 │                                 │
                 └──────────────┬──────────────────┘
                                ▼
                         DevtoolsService
                         Host-owned state
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
          AgentDebugService          RuntimeDiagnosticsQuery
        session / snapshot /          focused query /
        wait / experiment lease      checkpoint / compare
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                MCP / CLI / Skill / DSH / Web UI
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                  Agent                   Human
```

`DevtoolsService` 是 Host 侧的组合中心，管理运行时采集、近期历史、runtime notification、verification 和 profiling 协调状态。

`AgentDebugService` 提供面向 Agent 的调试会话能力，包括 target、session、snapshot、cursor、wait 和 experiment lease。

`RuntimeDiagnosticsQuery` 提供 Event、Fiber、dispatch、profiler trace 的定点查询，以及 checkpoint 捕获和语义化比较。

MCP、CLI、DSH 集成和 Web DevTools 都从这套 Host runtime state 获取信息，因此不同入口看到的是同一个 Cordis 运行时。

### Observer path

默认的 observer path 读取 Cordis 当前状态，并维护近期的运行时记录。

它提供：

- 实时 Event 和 listener 注册；
- listener 顺序、注册属性和所属 Fiber；
- 当前 live Fiber 拓扑；
- 最近的 dispatch 元数据；
- runtime snapshot；
- Event / Fiber / dispatch / trace 定点查询；
- checkpoint 捕获和前后比较；
- runtime change journal，供 Agent 等待运行时变化。

Observer 收集的内容限定在调试元数据范围内，不包含 Event 参数、返回值、prompt、tool result、文件内容、插件配置、token 或 credential。

### Runtime evidence

dispatch、profiler trace 和 runtime change observation 都有明确的保留窗口，旧记录会随着新数据进入逐步淘汰。

查询结果会带上对应的窗口状态：

- `timeout`：当前观察窗口内没有看到符合条件的变化；
- `gap`：当前 cursor 已经落后于保留窗口，需要重新获取 snapshot；
- checkpoint comparison：给出两个时点之间的语义变化。

例如：

```text
listener multiplicity: 2 → 1
Fiber "foo": removed
Event "bar": listener group added
```

这些结果可以直接作为 Agent 后续分析的 evidence。Root cause、confidence 和修复是否成立，则由 Agent 结合源码与运行时信息继续判断。

### Controlled waterfall profiling

Observer 可以覆盖拓扑、注册关系和 dispatch 等问题。单个 listener 的执行耗时、waterfall `next()` 调用等信息，则需要短暂进入执行链采集。

这类场景可以显式启动一次有限的 waterfall experiment：

```text
Agent / Human
     │
     ▼
WaterfallExperimentCoordinator
     │ exact owner + finite lease
     ▼
WaterfallInstrumentationController
     │
     ▼
WaterfallTraceStore
```

`WaterfallExperimentCoordinator` 统一管理 profiling ownership。

Agent experiment 会获得一个 `leaseId` 和有限 TTL。lease 到期后自动释放，主动停止时需要匹配当前的 `leaseId`。Human DevTools 可以随时执行 emergency stop。

Profiler 记录 Event、listener、ownership、timing、outcome 和 `next()` 等 profiling metadata，不保存业务 payload。

## Documentation

- [Architecture and invariants](docs/architecture.md)
- [Agent runtime diagnostics guide](docs/agent-runtime-diagnostics.md)
- [Controlled runtime experiments](docs/v0.6-controlled-runtime-experiments.md)
- [Runtime verification design](docs/v0.5-runtime-verification.md)
- [Development workflow](docs/development-workflow.md)

## Development

```bash
pnpm install
pnpm verify:policy
pnpm typecheck
pnpm test
pnpm build
pnpm verify:client-bundle
pnpm test:e2e:web
```

每次修改优先运行能够覆盖当前改动的最小检查集。

仓库约定和长期设计决策记录在 [AGENTS.md](AGENTS.md) 和 [.agents/notes](.agents/notes/README.md)。

## License

Apache-2.0
