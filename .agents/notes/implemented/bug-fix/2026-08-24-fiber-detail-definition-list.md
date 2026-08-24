# Agent Note: Detail definition lists

Status: implemented

## Problem

Fiber 详情中的 `state` / `parent` 使用普通文本行，而 `inject` / `events` 使用另一套自定义 row + Pill 容器。虽然控件复用了 DSH primitives，但 label/value 布局由两套本地 CSS 维护，导致普通文本与 24px 高的 DSH Pill 在视觉基线上不一致。

进一步检查当前三个视图后，Timeline 展开详情存在同类结构：普通文本属性和带 Fiber Pill 的 `dispatch context` 混在自定义 flex row 中，也会让不同 value 类型依赖各自盒模型对齐。Events 的 owner 行则是刻意设计的一行 inline relationship，统一使用 `align-items: center`，不属于同类问题。

## Decision

采用 DSH `PluginInventorySettingsTab` 已使用的详情布局模式：用语义化 `<dl>/<dt>/<dd>` 统一 Fiber facts 和 Timeline details 的 label/value 两列结构。

- Fiber 的 `state`、`parent`、`inject`、`events` 全部进入同一个 definition list；
- Timeline 的 dispatch id、mode、arguments、registered listeners、dispatch context 进入同一 definition list；
- `events` 和 live dispatch context 继续复用 DSH `Pill`，不替换现有交互控件；
- label 列使用固定宽度，value 列使用 `minmax(0, 1fr)`；
- 行高按 DSH Pill 的 24px 高度统一，使普通文本与 Pill group 的首行自然对齐；
- 两个视图共享一个很薄的 `DetailList.module.css`，不新增 React PropertyRow primitive；
- 不增加 border/divider，不改变 Fiber/Timeline 数据、导航、Effects 或 RPC。

## Alternatives considered

- 分别给 `events` / `inject` / `dispatch context` 增加 margin 或 padding。拒绝，因为这是针对当前字体和 Pill 高度的补丁，容易再次失配。
- 新增本地 `PropertyRow` React 组件。拒绝，因为 DSH 自身直接使用 `<dl>/<dt>/<dd>`，且当前没有公开的 PropertyRow primitive。
- 同时改 Events owner row。拒绝，因为该区域是单行 inline relationship，而不是属性表；现有 flex 居中与 Pill 语义匹配，没有发现同类错位。

## Consequences

Fiber facts 与 Timeline details 都使用单一、语义化且更接近 DSH 官方实现的布局模型；普通文本、muted text 和 Pill group 共享稳定的 value column 和 24px 首行高度。不会引入新的 UI primitive、状态或运行时行为。

## Verification

- repository policy；
- typecheck；
- component tests；
- build / client bundle verification；
- real DSH Web E2E。
