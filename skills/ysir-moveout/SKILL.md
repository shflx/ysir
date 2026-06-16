---
name: ysir-moveout
description: 落地实现当前需求，并使用 ysir-state 状态图进行进度门禁和阶段推进。
---

# ysir-moveout

## 目标

完成当前需求的落地实现、验证和交付动作，并使用 `ysir-state` 维护的状态图控制进度门禁。

## 核心原则

1. 以完成当前需求落地为目标；`ysir-state` 只用于进度门禁和阶段推进，不替代工程判断。
2. `current` 是唯一执行边界；不跳步、不合并节点、不增量补图、不手写 `state.json`。
3. `current` 节点是否使用 subagent 模式由节点 `subagent` 字段决定；`subagent: true` 必须启动 subagent，`subagent: false` 允许主 agent 直接执行，未配置时沿用默认 subagent 模式。
4. 完成用 `advance`，返工或续轮用 `next-attempt`；每次更新后必须重新 `show`，以状态图输出判断下一步。
5. 若需求、设计、计划、规范或当前实现之间存在冲突，暂停推进并向用户确认。

## 工作流程

执行前以 `state.json` 为唯一进度入口；若当前任务目录存在 `plan.md`，可用于理解当前节点对应的业务边界，但不得用计划文档替代状态图判断进度。

### 1. 准备状态图

若没有 `state.json`，使用 `quick-change` schema 初始化一个最小状态图:

```bash
node skills/ysir-state/scripts/state.js init \
  --state .report/in-progress/{task}/state.json \
  --nodes "{当前快速改造事项}" \
  --schema quick-change
```

`quick-change` 的 `scope-check` 节点必须先确认当前事项确实目标明确、影响边界清楚、改动范围小且验证方式明确；若发现范围扩大或风险升高，应暂停推进并说明原因，不在 `ysir-moveout` 内自行切换 schema 或重启标准流程。

### 2. 读取当前节点

```bash
node skills/ysir-state/scripts/state.js show \
  --state .report/in-progress/{task}/state.json
```

读取后确认:

- 当前节点 ID。
- 当前节点所属阶段 `phase`。
- 当前子阶段 `stage` / `label`。
- 当前子阶段目标 `objective`。
- 是否存在 `template`。
- 当前节点的 subagent 模式 `subagent` / `currentSubagent`。
- 当前节点的前后依赖边。
- 若当前节点没有后继节点，完成该节点并推进后进入归档流程。

### 3. 执行当前节点

- 若当前节点 `stage` 为 `human-acceptance`，不要启动 subagent；直接暂停并请求用户验收当前计划阶段成果。用户确认通过后使用 `advance` 推进状态图；用户不通过且需要返工时使用 `next-attempt --status failed`。
- 若当前节点 `subagent` / `currentSubagent` 为 `true`，主 agent 在执行任何当前节点工程工作前，必须先为该 `current` 节点启动 subagent；不得用主 agent 直接实现、测试、审查或提交当前节点。若当前 Agent 环境默认不允许启动 subagent，应暂停当前节点执行，向用户请求启用 subagent 能力；用户启用后再继续分派。
- 若当前节点 `subagent` / `currentSubagent` 为 `false`，主 agent 可以直接执行该节点，但仍必须遵守当前节点边界、完成必要验证，并在完成后更新状态图。
- 若当前节点没有配置 `subagent`，默认按 subagent 模式执行，以兼容旧状态图和旧 schema。
- 当 subagent 模式启用时，主 agent 向 subagent 提供当前节点 ID、`phase`、`stage` / `label`、`objective`、`template`、前后依赖、相关需求/计划/设计上下文和完成标准，不要指导 subagent 具体该怎么做。
- 当 subagent 模式启用时，subagent 必须完整执行 `currentObjective`；其中包含使用 `ysir-regulation` 了解与本次行动相关规范的前置目标。
- 当 subagent 模式启用时，subagent 只执行当前节点对应工作；不得跳到后继节点，不得更新 `state.json`，不得改写与当前节点无关的内容。
- 当 subagent 模式启用且节点存在 `template` 时，subagent 按需读取模板并用于阶段产物格式。
- 当 subagent 模式启用且节点需要测试、审查、提交或其它验证时，subagent 必须实际执行对应动作并返回证据。
- 当 subagent 模式启用时，subagent 返回结果必须说明完成情况、规范遵守说明、关键改动、验证命令或证据、遗留问题；涉及代码改动时必须列出改动文件。规范遵守说明应对照 `ysir-regulation` 说明本节点主要适用哪些约束，以及是否存在偏离；不适用时说明原因。
- 当 subagent 模式启用时，主 agent 验收 subagent 结果；只有 subagent 完成当前节点要求的实现、验证或产物后，才进入状态图更新。若 subagent 返回结果缺少规范遵守说明，应要求补充后再推进状态图。
- 当 subagent 模式启用但 subagent 未完成当前节点时，主 agent 不得自行补做节点工作；应继续分派 subagent、按 `next-attempt --status failed` 表达返工，或在冲突阻塞时暂停确认。
- 若发现需求、计划或设计冲突，暂停并向用户确认。

### 4. 更新状态图

当前节点完成后，通过 `advance` 推进状态图。

完成当前节点:

```bash
node skills/ysir-state/scripts/state.js advance \
  --state .report/in-progress/{task}/state.json \
  --note "{简短完成依据}"
```

若当前节点只有一个后继节点，`advance` 会自动将当前节点标记为 `completed` 并推进 `current`。

若当前节点存在多个后继节点，选择明确后传入 `--next`:

```bash
node skills/ysir-state/scripts/state.js advance \
  --state .report/in-progress/{task}/state.json \
  --next "{next-node}" \
  --note "{简短完成依据}"
```

若当前节点没有后继节点，`advance` 会清空 `current`，表示状态图已走到结尾。

每次 `advance` 后必须重新执行 `show`，以状态图输出作为下一步判断依据。若 `show` 后仍存在 `current`，继续回到步骤 2 读取并执行后继节点。

若 `show` 后 `current` 为空，进入步骤 5 归档本地需求过程文档。

`note` 只写简短依据，例如测试命令、报告路径、提交哈希或用户确认。

当前节点需要进入下一轮 attempt:

若当前节点失败，且后续工作需要改动代码或重新从当前阶段的实现环节开始，使用 `next-attempt --status failed` 追加新 attempt:

```bash
node skills/ysir-state/scripts/state.js next-attempt \
  --state .report/in-progress/{task}/state.json \
  --status failed \
  --note "{失败原因和返工依据}"
```

若当前节点已完成，但当前 schema 目标要求继续下一轮，例如继续下一个最小行为，使用 `next-attempt --status completed`:

```bash
node skills/ysir-state/scripts/state.js next-attempt \
  --state .report/in-progress/{task}/state.json \
  --status completed \
  --note "{继续下一轮的依据}"
```

每次 `next-attempt` 后必须重新执行 `show`，读取新 attempt 的 `current` 节点并继续回到步骤 2。不要通过手动改状态、补节点或补边来表达返工或续轮。

### 5. 归档本地文档

仅当 `show` 确认 `current` 为空时，归档本地需求过程文档。

归档要求:

- 将 `.report/in-progress/{task}/` 移动到 `.report/done/{task}/`。
- 不归档 `.report/design/` 下的长期设计文档。
- 归档完成后，进入步骤 6 自进化处理。

### 6. 自进化处理

归档完成后，若 `ysir.yaml` 中 `evolve.enabled` 未配置或为 `true`，调用 `ysir-evolve` 执行 `process` 动作。

处理完成后，本次需求落地结束。

若 `evolve.enabled` 为 `false`，跳过本步骤，本次需求落地结束。
