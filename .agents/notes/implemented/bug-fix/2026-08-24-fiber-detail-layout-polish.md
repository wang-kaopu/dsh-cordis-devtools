# Agent Note: Fiber detail layout polish

Status: implemented

## Problem

Fiber Inspector 的统计摘要与属性详情仍有两个局部视觉问题：

- 第三个统计项 `recent dispatch-context hits` 在当前三列宽度下容易换成两行，使三项摘要的高度和阅读节奏不一致；
- Fiber 属性虽然已经使用语义化 `<dl>/<dt>/<dd>`，但四组属性依赖 `display: contents` 共同参与一个外层 grid，实际渲染时 label/value 的行感较弱，也更容易受到内容高度影响。

## Decision

只修这两个局部布局，不扩大到搜索栏、左右栏比例或滚动条：

- Fiber 统计卡保持三列，卡片统一 stretch；label 使用同一更紧凑字号并保持单行，避免第三项单独换行；
- Fiber `state / parent / inject / events` 保留现有 `<dl>/<dt>/<dd>` 语义，但每个属性组自身成为 `76px + minmax(0, 1fr)` 的两列 grid；
- Timeline detail list 继续保留原来的 shared-grid / `display: contents` 布局，不随本修复调整；
- 不修改 Fiber 数据、导航、Effects、RPC、observer/profiler 行为或任何 shared contract。

## Alternatives considered

- 缩短统计项文案。未采用，因为现有名称准确表达它是 bounded dispatch-context hit，而不是更宽泛的 dispatch count；仅通过布局即可解决换行。
- 继续使用 Fiber 外层总 grid，再靠 margin/padding 微调。未采用，因为每一项独立两列更直接，也不会影响 Timeline 当前已稳定的布局。
- 同时调整左右栏宽度或滚动条。拒绝，超出本次明确限定的修复范围。

## Consequences

Fiber summary 三项在桌面三列布局下保持一致高度和单行 label；属性区每个 label/value 形成稳定的一行两列关系，多行 Pill/value 仍可在右列内部自然换行。Timeline 与其他视图布局保持不变。

## Verification

- repository policy / Agent Note gate；
- typecheck；
- existing client component tests；
- build / built client bundle verification；
- real DSH Web E2E。
