# Agent Note: 增加 CDP-shaped WebSocket endpoint

Status: implemented

## Problem

`dsh-cordis-devtools` 当前以 MCP 作为 Agent 主入口，浏览器侧使用现有 RPC/UI 路径。即使后续完成 CDP-shaped Protocol Core，外部 debugger/CLI/IDE/CDP client 仍缺少一个真正的长连接 wire adapter，无法像普通 CDP consumer 一样通过 WebSocket 发送 command 并实时接收 event。

这个需求与“让 Chrome DevTools Frontend 直接调试 Cordis”不同。Cordis 没有 Chromium 的 DOM/Page/Network/Debugger/V8 等语义，因此本方案只实现 CDP-shaped discovery + WebSocket wire compatibility：沿用 command/response/event JSON envelope、target/session、schema discovery 和实时 event push，不模拟浏览器 domain，也不承诺 `chrome://inspect` 或 Chrome DevTools Frontend 可用。

本方案是独立的后续 transport adapter。它应建立在统一 DevTools Protocol Core 之上；若 Protocol Core 尚未实现，Codex 应先补齐本 Note 所需的最小 transport-neutral command/event 接口，而不是在 WebSocket server 内复制一套 target/session/journal/diagnostics 状态。

## Decision

增加一个可选、默认关闭、loopback-only 的 CDP-shaped WebSocket adapter，共享现有 Protocol Core、target/session、bounded observation journal、security policy 和 profiler coordinator。实现位于 `src/host/protocol-websocket.ts`，由 `src/index.ts` 的 `protocol.websocket` 配置按 Cordis Fiber 生命周期安装；独立 listener 默认使用 `127.0.0.1:43128`，认证复用 `src/host/auth.ts` 的 Bearer 校验。

target-scoped connection 建立时自动 attach，并通过 `Target.attachedToTarget` 握手事件返回 session；`Cordis.readEvents` 复用同一 Core journal 进行 replay/gap recovery。实时推送使用每连接一个 Core `waitForEvent()` waiter，连接建立时仅保留 Target 生命周期事件，Cordis/Profiler 必须显式 enable。每连接 outbound queue 同时受消息数与 UTF-8 字节数限制，超限以稳定 close code 显式断开。

### 1. Discovery endpoints

当配置显式启用 WebSocket adapter 后，Host 提供：

```text
GET /json/version
GET /json/list
GET /json/protocol
```

`/json/version` 返回本产品自己的协议身份，不伪造 Chrome/Chromium 版本：

```json
{
  "Browser": "dsh-cordis-devtools/0.x",
  "Protocol-Version": "1.0"
}
```

如果需要暴露 browser-level WebSocket，可额外返回：

```json
{
  "webSocketDebuggerUrl": "ws://127.0.0.1:<port>/devtools/browser/<id>"
}
```

但第一版可以只实现 target-scoped endpoint，不强制 browser-level connection。

`/json/list` 返回当前可调试 target：

```json
[
  {
    "id": "<targetId>",
    "type": "cordis-runtime",
    "title": "Cordis Runtime",
    "description": "Live DSH/Cordis runtime",
    "webSocketDebuggerUrl": "ws://127.0.0.1:<port>/devtools/page/<targetId>"
  }
]
```

不要伪造 `url`、`faviconUrl`、`devtoolsFrontendUrl` 等没有真实意义的 Chromium 字段。若某个第三方 client 需要字段存在，应记录为兼容性需求后再增加，而不是提前假造语义。

`/json/protocol` 直接返回 Protocol Core 的 machine-readable schema；不得维护第二份 WebSocket 专用 protocol definition。

### 2. WebSocket endpoint

第一版实现：

```text
WS /devtools/page/{targetId}
```

连接建立时：

1. 验证 target 当前存在且 `targetId` 精确匹配；
2. 创建一个 protocol/debug session，绑定 exact target id + epoch；
3. 建立 connection-owned lifecycle；
4. 只在显式 domain enable 后推送对应事件；
5. socket close / error 时 detach session 并取消 wait/subscription/lease。

若未来需要 multiplex 多 target/session，再增加：

```text
WS /devtools/browser/{browserId}
```

并采用 CDP flattened session 风格在 frame 顶层携带 `sessionId`。第一版不要为了“更像 Chrome”而先实现不需要的 browser multiplexing。

### 3. Wire message shape

WebSocket 文本 frame 使用与 Protocol Core 相同的 CDP-shaped JSON。

Command：

```json
{
  "id": 1,
  "method": "Cordis.getSnapshot",
  "params": {},
  "sessionId": "..."
}
```

Response：

```json
{
  "id": 1,
  "result": {
    "snapshot": {},
    "eventCursor": 1042
  },
  "sessionId": "..."
}
```

Error：

```json
{
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found"
  },
  "sessionId": "..."
}
```

Event：

```json
{
  "method": "Cordis.dispatchObserved",
  "params": {
    "sequence": 1043,
    "dispatchId": 381,
    "event": "agent/pre-step",
    "mode": "serial"
  },
  "sessionId": "..."
}
```

只接受 JSON text frames。binary frame、batch command、compression 等第一版不需要实现，除非当前 HTTP/WebSocket stack 自动处理且不增加额外协议语义。

### 4. Event push 与 bounded journal

WebSocket 不是新的事件事实来源。

事件链路必须是：

```text
RuntimeNotificationSource
        ↓
Protocol Core / observation journal
        ↓
per-session domain filter
        ↓
WebSocket outbound queue
```

不要让 WebSocket adapter 直接订阅 Cordis internals，也不要创建独立的 unbounded event history。

实时 push 与 journal recovery 同时保留：

- 正常连接：事件一产生就推送；
- client 可通过 protocol command 读取 `afterSequence` 之后保留的 events；
- 重连后可使用上次 sequence 尝试 replay；
- sequence 已掉出 retained window 时返回 explicit `gap`，要求 fresh snapshot；
- bounded absence 不表示 complete history。

这样 WebSocket 只是低延迟 delivery path，journal 仍提供可恢复性。

### 5. Backpressure

必须显式定义慢消费者策略，不能让 WebSocket 把原有 bounded runtime history 变成 unbounded memory queue。

每个 connection 维护 bounded outbound queue，例如按“消息数量 + 估算字节数”双上限控制。具体默认值可在实现时根据现有 retention/config 风格选择，但必须满足：

- queue 有明确上限；
- 超限时不静默无限增长；
- 不静默丢 event 后继续假装 stream 完整；
- 推荐直接 close slow consumer，并使用稳定 close reason/code；
- client 重连后通过 sequence/journal replay 或 snapshot+cursor 恢复。

如果底层 WebSocket library 暴露 `bufferedAmount`，可作为辅助信号，但不能替代应用层 bounded queue/recovery contract。

### 6. Security

沿用当前产品的本地安全边界：

- adapter 默认关闭；
- 默认仅监听 `127.0.0.1`；
- 不为了兼容 `chrome://inspect` 自动开放 LAN；
- 复用 MCP/Host 已有 bearer token 配置策略或抽取共享 auth policy；
- token 不出现在 `/json/*` payload、protocol event、logs、diagnostics、target metadata 中；
- profiler mutation 继续要求现有 capability/token/lease 约束；
- WebSocket connection 本身不能绕过 coordinator ownership。

浏览器原生 WebSocket API 不方便设置 `Authorization` header，因此第一版必须明确认证方式。推荐优先级：

1. 如果该 endpoint 只供本机受控 client 使用，可配置独立 `websocket.requireToken`，默认继承现有安全策略；
2. 支持 `Authorization: Bearer ...` 的非浏览器 client 走 header；
3. 如必须支持浏览器 client，再单独设计短期一次性 ticket/query token，不直接把长期 bearer token 放 URL；
4. 不要默认接受永久 token query string。

如果当前 server stack 无法安全支持浏览器 WebSocket 鉴权，第一版可以明确只支持能设置 header 的 CLI/IDE/CDP client。

### 7. Config

建议在现有 plugin config 下新增独立可选配置：

```yaml
protocol:
  websocket:
    enabled: false
    host: 127.0.0.1
    port: 43128
```

实际字段名应与当前 `src/index.ts` / MCP config 风格保持一致。不要复用 MCP port 后再用隐式 path upgrade，除非当前 HTTP server ownership 已经允许安全共享且测试更简单；共享端口与独立端口二选一时，优先选择 lifecycle ownership 更清晰的方案。

### 8. 文件级实现清单

#### Shared protocol

- 复用/新增 `src/shared/devtools-protocol.ts`
  - command/response/error/event envelope；
  - domain schema；
  - protocol version；
  - transport-neutral error codes；
  - 不包含 WebSocket implementation 类型。

#### Protocol Core

- `src/host/agent-debug/service.ts` 或后续统一 Protocol Core
  - 提供 generic command dispatch；
  - 提供 attach/detach；
  - 提供 session event subscription；
  - 提供 read/replay/gap 接口；
  - 保持 target/session/journal/lease single ownership。
- `src/host/runtime-notifications.ts`
  - 不改造成 WebSocket bus；继续只发布 Host facts。

#### WebSocket adapter

建议新增：

```text
src/host/protocol-websocket.ts
```

或目录：

```text
src/host/protocol-websocket/server.ts
src/host/protocol-websocket/connection.ts
```

职责：

- HTTP discovery handlers；
- WebSocket upgrade；
- auth；
- parse/validate JSON frame；
- 调用 Protocol Core；
- serialize response/event；
- bounded outbound queue；
- socket lifecycle → session lifecycle；
- 不直接查询 Cordis internals。

#### Service composition

- `src/host/service.ts`
  - 创建/销毁可选 WebSocket adapter；
  - Protocol Core 先于 adapter 创建，adapter 先于 Core dispose；
  - startup failure 默认不要破坏 Human observer/MCP 主路径，除非现有 `failOnStartupError` 语义明确要求。
- `src/index.ts`
  - 增加 schema/config validation；
  - 默认 disabled + loopback。

#### Dependencies

- 优先复用项目现有 HTTP/WebSocket 能力；
- 若必须新增 `ws` 等依赖，保持依赖只用于 Host transport adapter；
- 不把 WebSocket 类型泄漏到 `src/shared`。

### 9. 测试清单

至少覆盖：

- disabled 默认不监听端口；
- `/json/version`、`/json/list`、`/json/protocol` 内容不伪造 Chromium semantics；
- unknown target WebSocket upgrade 被拒绝；
- valid target connect 后产生 exact session；
- command frame id/method/params/sessionId 正确路由并返回 response；
- malformed JSON、non-object、missing method、unknown method 返回稳定错误或按策略 close；
- `Domain.enable/disable` 控制 event delivery；
- event sequence 与 journal sequence 一致且单调；
- disconnect 会 detach session、取消 waiter、清理 subscription；
- target replacement/disposal 会让连接/session 进入 stale/closed 状态，不 rebind；
- slow consumer 达到 outbound queue 上限时显式断开，不 unbounded 增长；
- reconnect + retained sequence 可以 replay；
- reconnect cursor 落后 retained window 时收到 gap 并可 snapshot recovery；
- token 未出现在 discovery/event/log/diagnostic payload；
- unauthorized connection 无法调用 read-only 或 profiler mutation（按最终 auth policy）；
- profiler mutation 仍由 coordinator exact-owner lease 控制；
- Host disposal 关闭 listener/server/socket 并释放所有 session。

建议新增：

```text
tests/protocol-websocket.spec.ts
tests/protocol-discovery.spec.ts
```

如果实现与真实 network stack 相关，测试应尽量启动 loopback ephemeral port 的真实 server/client，而不是只 mock WebSocket object。

### 10. 实施顺序

```text
1. 确认/补齐 transport-neutral Protocol Core
2. 增加 config + lifecycle shell（默认 disabled）
3. 实现 /json/protocol + /json/list + /json/version
4. 实现 target-scoped WebSocket command/response
5. 接入 domain event push
6. 接入 bounded outbound queue
7. 接入 replay/gap recovery
8. 完成 auth/security tests
9. 再评估是否需要 browser-level /devtools/browser/{id}
```

第一版完成到第 8 步即可，不把 browser-level multiplexing 当作 MVP 条件。

## Alternatives considered

**让 WebSocket adapter 自己直接订阅 `RuntimeNotificationSource` 并维护 session。** 不采用，因为会复制 Agent Debug/Protocol Core 的 target/session/journal ownership，造成 MCP 与 WebSocket 行为漂移。

**只做 SSE。** 不作为该方案，因为 SSE 适合单向 Host→Client event，但 external CDP-style client 还需要同一长连接发送 command/接收 response。SSE 可以用于 Browser UI 的独立优化，但不是 CDP-shaped wire endpoint。

**完整实现 Chrome DevTools Protocol 和 Chrome DevTools Frontend 兼容。** 不采用，因为 Cordis 没有浏览器专属 domain 的真实语义。该 endpoint 只复用 CDP wire/model，不模拟 Chromium。

**默认开放 LAN 以方便远程调试。** 不采用。当前产品安全边界是本地 runtime debugging；remote exposure 需要单独认证、TLS、origin、network threat model 决策。

**遇到 backpressure 时静默丢最旧 event。** 不采用，因为 client 会误以为自己消费了连续实时流。应显式断开并通过 sequence/gap/snapshot recovery 恢复。

**把长期 bearer token 放在 WebSocket URL query。** 不作为默认方案，因为 URL 更容易进入 history/log/telemetry。优先 header；浏览器兼容需要另行设计短期 ticket。

## Consequences

- WebSocket adapter 默认关闭且默认只监听 loopback。
- 提供 `/json/version`、`/json/list`、`/json/protocol`，内容描述 dsh-cordis-devtools 自身，不伪造 Chrome/Chromium。
- 提供 `WS /devtools/page/{targetId}`，使用与 Protocol Core 相同的 CDP-shaped JSON command/response/error/event envelope。
- WebSocket connection 绑定 exact target incarnation 和 debug session；target replacement/disposal 不自动 rebind。
- domain enable/disable 控制 per-session event push，不自动开启 profiler instrumentation。
- 实时 push 复用同一 bounded journal sequence，支持 replay、gap 和 fresh snapshot recovery。
- outbound buffering 有明确上限；慢消费者不会导致 unbounded memory growth 或静默假连续。
- socket close、Host dispose、target dispose、session expiry 都会释放 subscription/waiter/session-owned lease。
- adapter 不直接读取 Cordis internals，不拥有第二套 target/session/journal/coordinator。
- authentication 不泄露长期 token；未授权 client 不能绕过现有 read/mutation security policy。
- 不宣称 Chrome DevTools Frontend、browser domains 或 `chrome://inspect` 兼容。
- 真实 loopback WebSocket tests、`pnpm verify:policy`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。

## Limitations

**WebSocket 与 Protocol Core 生命周期耦合错误。** 如果 adapter 比 Core 活得更久，可能在 teardown 中投递到已释放 session；必须定义明确 dispose 顺序并覆盖 Host shutdown/target replacement tests。

**慢 client 形成内存泄漏。** WebSocket push 天然容易积压；bounded outbound queue + explicit close + replay/gap 是必需 contract，不是优化项。

**认证方式与浏览器 WebSocket API 冲突。** 浏览器不能方便设置 Authorization header。第一版不要因此降低安全边界；可以先支持 CLI/IDE client，再单独设计短期 ticket。

**第三方 CDP client 假定 Chromium-specific discovery/domain。** 文档与 protocol metadata 必须明确这是 CDP-shaped Cordis debugger endpoint；只对 generic command/event consumer 提供兼容，不承诺 Puppeteer/Chrome DevTools Frontend 的高层功能可直接工作。

**共享 MCP HTTP server 可能造成 ownership/upgrade 复杂度。** 如果复用端口需要侵入现有 MCP server lifecycle，优先使用独立 loopback port；不要为了少一个端口牺牲 teardown 和 auth 清晰度。
