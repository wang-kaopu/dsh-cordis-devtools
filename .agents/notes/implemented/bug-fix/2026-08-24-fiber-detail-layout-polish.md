# Agent Note: DevTools detail layout and CSS Module injection

Status: implemented

## Problem

Fiber Inspector 最初暴露了统计摘要和属性详情的局部视觉问题；继续检查真实 DSH Web 后，Profiler 整体与 Timeline 展开详情也出现明显的浏览器默认流式布局：

- Fiber 第三个统计项 `recent dispatch-context hits` 容易单独换行；
- Fiber 属性的 label/value 行感较弱；
- Timeline 的 `<dl>` 明明声明了两列 grid，真实浏览器却呈现 `dt` 与 `dd` 上下堆叠；
- Profiler 的 header、status controls、trace/listener rows 也没有应用对应 module CSS。

构建检查发现根因不在 React 结构，而在 `tsdown.config.ts` 的 CSS Module inline plugin：每个 `.module.css` 都复用了同一个固定 `tagId = dsh-cordis-devtools/DevtoolsPanel.module.css`。主面板 CSS 先插入后，后续 `DetailList.module.css` 与 `ProfilerView.module.css` 会被 `querySelector` 误判为已经注入，从而完全跳过自己的 `<style>`。

## Decision

同时修复局部 Fiber 排版和真正的 CSS 注入边界：

- Fiber 统计卡保持三列并统一 stretch；label 使用更紧凑字号和单行布局；
- Fiber `state / parent / inject / events` 保留 `<dl>/<dt>/<dd>`，每个属性组自身成为 `76px + minmax(0, 1fr)` 两列 grid；
- 不重写 Timeline 或 Profiler React 结构，继续使用已经存在的 `DetailList.module.css` / `ProfilerView.module.css` 规则；
- CSS inline plugin 为每个模块生成稳定且唯一的 repository-relative style id，例如 `dsh-cordis-devtools/src/client/DetailList.module.css`；
- style id 不包含构建机绝对路径；
- built-client verification 提供最小 fake DOM，实际执行 bundle 后断言三份 CSS Module 都生成独立、非空的 style tag；
- 不修改数据、导航、Effects、RPC、observer/profiler semantics 或 shared contract。

## Alternatives considered

- 继续调整 Timeline/Profiler 的 margin、grid 参数。拒绝，因为对应 CSS 根本没有进入真实页面，继续调数值无法修复根因。
- 将三份 CSS 合并回 `DevtoolsPanel.module.css`。拒绝，因为这会逆转已经建立的 view/detail ownership；inline plugin 本来就应正确支持多个 CSS Module。
- 使用 CSS 内容 hash 作为唯一 id。未采用；repository-relative module path 更可读、稳定，并且避免暴露绝对构建路径。

## Consequences

真实 DSH Web 会同时注入主面板、DetailList 和 Profiler 三份 CSS Module。Timeline 展开详情重新按既有两列 definition-list 规则渲染，Profiler 恢复其紧凑 header / trace / listener 布局；Fiber 局部布局修复继续生效。

未来新增 `.module.css` 不会再因为固定 style id 与已有模块发生碰撞。built-client gate 会直接捕获同类回归，而不是只证明 module-loader factory 可执行。

## Verification

- repository policy / Agent Note gate；
- typecheck；
- full Vitest suite；
- build；
- built client bundle verification，包含多 CSS Module 独立 style 注入断言；
- real DSH Web E2E。
