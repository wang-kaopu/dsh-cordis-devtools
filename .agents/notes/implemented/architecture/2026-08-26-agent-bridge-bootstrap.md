# Agent Note: DSH 本机 Agent Bridge 与自助接入

Status: implemented

## Problem

v0.7 已提供适合 Agent 的 MCP 调试工具、CLI 和 Skill，但它假定人类已完成三项本机配置：为 DSH profile 写入 MCP patch、生成并配置 bearer token，以及向 Codex 或其他 Agent host 注册 Streamable HTTP endpoint。Skill 只能编排已出现的工具，不能建立连接；模型也不应持有 token。

Chrome DevTools for agents 将这段连接工作收敛在本机 MCP server 中：Agent host 启动一个 stdio MCP 进程，该进程负责连接或启动 Chrome 并通过 CDP 取得能力。Agent 看到的是语义化 MCP tools 与 Skill，而不是调试端口、WebSocket 帧或凭据。

DSH 当前的 loopback HTTP MCP endpoint 和显式 target/session 模型足以作为 Host 侧调试服务，但缺少面向 Agent host 的受控本机接入层。直接要求每个 Agent 编辑 YAML、生成或粘贴 token，既不可靠也会让 secret 进入模型上下文。

This decision supersedes no shipped contract. It extends the deferred native protocol seam described in [the v0.7 Agent Debug decision](2026-08-25-dsh-devtools-for-agents.md) with an Agent-facing local bridge, not a CDP-compatible wire protocol.

## Decision

### Ship a local stdio MCP bridge

The package exposes a `dsh-cordis-devtools-mcp` binary. It is a stdio MCP server for Agent hosts and a Streamable HTTP MCP client for the already-running loopback DSH endpoint:

```text
Codex / Agent host
        | stdio MCP
dsh-cordis-devtools-mcp
        | authenticated loopback HTTP MCP
DSH dsh-cordis-devtools plugin
        | Host-owned AgentDebugService
Cordis runtime
```

The bridge exposes the existing DSH MCP tool schemas and result values without creating another runtime model, target registry, session registry, observation journal, or experiment coordinator. It never exposes its bearer token as a tool, resource, log field, error detail, or child-process argument. It connects lazily, reports a structured unavailable/not-configured condition before forwarding a call, and preserves the existing target epoch/stale-session semantics. It must not silently reconnect an old debug session to a replaced DSH target.

The documented Codex installation becomes a local stdio command:

```text
codex mcp add dsh-cordis-devtools -- dsh-cordis-devtools-mcp
```

The existing embedded HTTP MCP endpoint remains the supported integration for IDEs or explicit external clients. It stays loopback-only and retains its current token and experiment-capability behavior.

### Add explicit bootstrap and doctor commands

`dsh-cordis-debug` exposes three explicit, local-only commands:

```text
dsh-cordis-debug setup --profile web --agent codex
dsh-cordis-debug doctor --profile web
dsh-cordis-debug rotate-token --profile web
```

`setup` is the only command that edits local DSH/Codex configuration. It must require an explicit profile and Agent host selection; it must not infer a profile, change every profile, or start/reload DSH. It preserves unrelated id-targeted plugin configuration when updating the profile patch, enables MCP on loopback, creates a non-empty random token, registers the stdio bridge with the selected host, and prints only endpoint/profile/next-step facts. It must never print the token.

`doctor` is read-only. It reports profile patch state, endpoint reachability, authenticated MCP initialization, tool discovery, and whether the bridge can resolve credentials. It redacts all secret values.

`rotate-token` performs a coordinated replacement of the local token material and DSH profile setting, then reports that DSH must be reloaded before the new credential becomes live. It does not reload DSH itself and does not expose either old or new token.

### Store secrets outside prompts and ordinary project files

The DSH plugin supports a `mcp.tokenFile` configuration option. At activation, the Host reads one non-empty token from the designated local file; an inline `mcp.token` remains supported for existing manual installations but is deprecated in documentation. The runtime only retains the token in memory for the existing authorization check. The bridge reads the same local file, not an environment variable supplied by the model.

`setup` creates the token file under the chosen DSH profile directory with owner-only permissions. The profile patch stores the token-file path, endpoint port, and MCP enabled state; it does not contain the token itself. Input paths must be normalized, profile-scoped, and rejected when they escape the DSH profile directory. Symlinks and non-regular files are rejected for token reads/writes. If the platform cannot enforce owner-only permissions, setup fails closed and asks the user to configure the token manually.

### Keep the v0.7 observation and mutation boundary

The bridge forwards only the already-published MCP tools. Read-only session tools remain behavior-neutral. External profiling still requires both the existing MCP experiment capability and a non-empty token. The bridge does not grant DSH-native identity, bypass one-shot DSH approval, add arbitrary dispatch/evaluation/reload, collect payloads, or make automatic root-cause claims.

### Scope concurrency explicitly

Multiple Agent hosts may run independent bridge processes. They share the embedded Host endpoint but remain isolated by the existing opaque debug-session ids, target epochs, session limits, bounded waiters, and experiment coordinator. The bridge has no global selected target and no auto-attach/rebind behavior. Bootstrap/configuration commands are serialized by a profile-scoped advisory lock so two Agents cannot race while rewriting one patch or token file.

## Alternatives considered

### Tell the Agent to edit profile YAML and register HTTP MCP directly

Rejected. This leaks operational complexity into every debugging task, makes patch replacement mistakes likely, and encourages token flow through prompts or command arguments. A Skill cannot guarantee that the Agent host actually registered the connection.

### Expose raw DSH Debug WebSocket/CDP compatibility first

Rejected for this scope. A raw protocol still requires an Agent-facing client, credential handling, startup/discovery, and task-sized tool selection. There is no concrete IDE consumer requiring raw WebSocket frames. The bridge solves the immediate Agent product gap while retaining the future transport-neutral core.

### Make the bridge connect to DSH without authentication

Rejected. Loopback is not a confidentiality boundary against other local software, and the existing Host contract requires a token whenever one is configured. The bridge should protect the credential from model context, not remove Host authentication.

### Put the token only in an environment variable configured by Codex

Rejected as the primary route. It leaves DSH profile activation and token lifecycle manual, varies by Agent host launch model, and cannot let an Agent perform setup without placing a secret in a host-specific environment. Environment-variable registration remains a documented manual alternative.

### Have setup automatically reload/restart DSH

Rejected. Reloading can disrupt a live Harness and has no safe generic lifecycle contract. Setup and rotation report the required human-controlled reload, and doctor verifies the post-reload state.

## Consequences

- A user can run one explicit profile-scoped setup command, reload DSH normally, and add the stdio bridge to Codex without ever copying a token into chat or MCP tool input.
- The bridge exposes the existing DSH MCP tool set to a real stdio MCP client and forwards target/session/snapshot/wait/detach semantics unchanged.
- A real Agent host can discover the bridge tools after registration; `doctor` proves endpoint reachability and authenticated tool discovery without printing credentials.
- Setup preserves unrelated plugin configuration; invalid/missing profile, unreadable token file, unsafe permissions, symlink/path escape, DSH-not-reloaded, unavailable endpoint, and bad authentication return actionable redacted failures.
- Rotation invalidates the old bridge credential after normal DSH reload; no log, result, snapshot, checkpoint, trace, or test fixture contains either token.
- Concurrent bridge processes do not share selected-target state, and concurrent setup/rotation cannot corrupt a profile patch or token file.
- Existing inline-token HTTP MCP clients remain compatible; external experiment authority, DSH approval, Human emergency stop, bounded histories, and observer-mode dispatch behavior remain unchanged.
- Unit, MCP integration, packed-artifact CLI/bridge smoke, and real DSH Web E2E cover setup/doctor/rotation and an authenticated stdio bridge workflow.

## Remaining limitations

- DSH profile patch semantics are id-targeted replacement; preservation of unrelated plugin settings must be verified against the installed DSH loader rather than reconstructed from assumptions.
- Secure file permission and symlink behavior differ across platforms. The initial release should support the current macOS/Linux local-profile path and fail closed elsewhere rather than claim portable secret storage.
- Updating Codex configuration is an external user setting. `setup --agent codex` needs a stable, supported Codex registration command and must leave a clear manual fallback if it is unavailable.
- The bridge adds a second process and an HTTP hop. It must have bounded connection/retry behavior and error classification so a stopped DSH does not create opaque Agent failures.
- The package is not yet a published npm release. The stdio installation command is a target UX; packaging/release evidence must precede claiming `npx` availability.
