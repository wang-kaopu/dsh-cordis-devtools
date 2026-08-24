# Agent Note: Fiber detail definition list

Status: implemented

## Problem

Fiber 详情中的 `state` / `parent` 使用普通文本行，而 `inject` / `events` 使用另一套自定义 row + Pill 容器。虽然控件复用了 DSH primitives，但 label/value 布局由两套本地 CSS 维护，导致普通文本与 24px 高的 DSH Pill 在视觉基线上不一致。

## Decision

采用 DSH `PluginInventorySettingsTab` 已使用的详情布局模式：用语义化 `<dl>/<dt>/<dd>` 统一 Fiber facts 的 label/value 两列结构。

- `state`、`parent`、`inject`、`events` 全部进入同一个 definition list；
- `events` 继续复用 DSH `Pill`，不替换现有交互控件；
- label 列使用固定宽度，value 列使用 `minmax(0, 1fr)`；
- 行高按 DSH Pill 的 24px 高度统一，使文本与 Pill 第一行自然对齐；
- 不增加 border/divider，不改变 Fiber 数据、导航、Effects 或 RPC。

## Alternatives considered

- 分别给 `events` / `inject` 增加 margin 或 padding。拒绝，因为这是针对当前字体和 Pill 高度的补丁，容易再次失配。
- 新增本地 `PropertyRow` React 组件。拒绝，因为当前只有一个详情区域需要该模式，DSH 自身也直接使用 `<dl>/<dt>/<dd>`，没有公开的 PropertyRow primitive。

## Consequences

Fiber facts 使用单一、语义化且更接近 DSH 官方实现的布局模型；普通文本、muted text 和 Pill group 共享同一 value column 和首行高度。不会引入新的 UI primitive、状态或运行时行为。

## Verification

- repository policy；
- typecheck；
- component tests；
- build / client bundle verification；
- real DSH Web E2E。
