# Agent Note: Fiber Effects UI

Status: implemented

## Problem

Host/shared 已经把 Cordis `fiber.getEffects()` 投影为 live `EffectSnapshot { label, children }` tree，但 Fibers 详情还没有展示这份生命周期诊断信息，因此 O3-H 的数据目前对用户不可见。

## Decision

在现有 Fibers 详情中增加一个 `Effects` 区域，直接消费 `activeFiber.effects`：

- 显示根 effect 数量；
- 空数组明确显示没有 labeled live effects；
- 递归展示 `label + children`；
- 有 children 的节点复用 DSH `DisclosureRow` 展开/折叠；
- leaf 使用同一 DSH row chrome 但不可展开，不制造不存在的详情；
- Fiber 切换时不创建第二份 effect 数据或历史缓存。

同时把 `ObserverCollector` 兼容签名中的唯一显式 `any[]` 最小替换为 `never[]`，不改变运行时逻辑。

## Alternatives considered

- 新增第四个顶层 Effects view。拒绝，因为 effects 是 Fiber-owned live metadata，放在 Fiber 详情里诊断路径更自然。
- 从 listener/service registry 重建 effects。拒绝，因为会把推断结果冒充 Cordis `getEffects()` 的权威树。
- 默认展开整个树。拒绝，因为大型插件可能产生较深 effect tree，会挤压现有 Fiber facts。
- 引入自定义 tree widget。拒绝，DSH `DisclosureRow` 已能表达递归展开，不需要额外交互体系。

## Consequences

Fiber Inspector 从“生命周期身份/依赖摘要”扩展到“Cordis 已标注的 live lifecycle effects”。展示仍是 observer-only；没有 listener wrapping、额外 RPC、poller、Host history 或原始 disposer/config/args 暴露。深层树需要用户逐层展开，但默认界面不会被完整 effect tree 挤满。

UI 没有新增高对比边框或分割线；树层级只通过 DSH disclosure chrome、缩进和弱 metadata 表达。展开状态仅属于当前浏览器 presentation state，并以 fiber uid + effect path 做键，不成为新的 runtime 数据源。

## Verification

- component test 覆盖空 effects；
- component test 覆盖 root/child 递归展开；
- Fiber 切换后展示对应 live tree；
- real DSH Web smoke 进入 Fibers 后验证 Effects surface；
- full repository policy/typecheck/test/build/client-bundle 和 web-e2e 在 PR 中作为 merge gate；
- TS/TSX 不再新增显式 `any`，原有唯一 `any[]` 已替换为 `never[]`。
