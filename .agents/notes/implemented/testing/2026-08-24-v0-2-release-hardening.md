# Agent Note: v0.2 release hardening

Status: implemented

## Problem

O1–O4 已交付，v0.2 的 observer-only 功能闭环已经形成，但 roadmap 的 release-hardening 条件还需要被固化为可重复验证的测试和版本/文档状态，避免“文档说安全”但关键边界没有直接回归保护。

## Decision

O5 只做收口，不增加新的诊断能力：

- 增加 release-hardening 回归测试，直接验证 dispatch history 有界、raw dispatch arguments 不进入 snapshot、安装 ObserverCollector 不替换已经注册的 target listener callback identity；
- 将 package version 从 `0.1.0` 提升到 `0.2.0`，但不创建 Git tag、不发布 npm；
- 更新 README / roadmap，使 v0.2 状态与当前已交付 O1–O5 一致；
- 继续以现有 policy/typecheck/test/build/client-bundle + real DSH Web E2E 作为 merge gate；
- 不开始 I0，不引入 listener wrapping、instrumented mode、trace contract 或新的 transport。

## Alternatives considered

- 只更新文档，不新增回归测试。拒绝，因为 bounded / metadata-first / no-wrapper 是 v0.2 的核心安全边界，应该有直接可执行的证明。
- 在 O5 顺便开始 waterfall instrumentation。拒绝，因为 roadmap 明确要求 I0 architecture checkpoint 先行，而且会破坏 O5 作为 observer-only 收口任务的边界。
- 创建 `v0.2.0` tag 或发布 npm。拒绝，本任务只负责仓库内 release readiness；外部发布应是单独、显式的 maintainer 动作。

## Consequences

合并后仓库元数据与文档会明确进入 v0.2，关键 observer-only 不变量会有专门的回归测试。生产运行时逻辑保持不变；唯一生产文件变化是 package version 元数据。

## Verification

- release-hardening tests 通过；
- `pnpm verify:policy`；
- `pnpm typecheck`；
- `pnpm test`；
- `pnpm build`；
- `pnpm verify:client-bundle`；
- real DSH Web E2E；
- 最终 diff 自审确认没有 target listener wrapper / instrumentation / 新 history / raw argument capture。
