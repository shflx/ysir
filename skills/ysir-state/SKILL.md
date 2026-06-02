---
name: ysir-state
description: 管理任务过程中的阶段有向图，为其他技能提供简单可靠的状态读取、节点更新和进度门禁能力；适用于实现阶段、分迭代推进或其它需要跨上下文维护进度的阶段化过程。
---

# ysir-state

## 何时使用

当任务存在多个需要按顺序或依赖关系推进的阶段，并且后续技能需要可靠读取、更新或判断进度门禁时，使用本技能维护 `state.json`。

典型场景:

- `ysir-plan` 根据计划文档初始化阶段图。
- `ysir-moveout` 读取阶段图确认当前应推进的阶段，并在阶段完成后更新状态。
- 其它技能需要跨上下文共享阶段状态、避免跳步、漏步或重复执行。

注意:

- 阶段可以是实现阶段，例如“搭建 Electron 框架”“实现主界面”“接入本地存储”。
- 阶段也可以是其它过程阶段，由调用技能按当前任务自行定义。
- 脚本不内置业务规则，不解析计划文档，不判断阶段是否应该推进；这些判断由当前 LLM 基于需求、计划和规范完成。
- 若需要选择或扩展软件方法 schema，读取 [`references/schema-design.md`](./references/schema-design.md)。

## 怎么使用

状态文件默认放在当前任务目录:

```text
.report/in-progress/{日期}-{需求简短描述}/state.json
```

所有状态读取和更新都必须通过脚本完成，不要手写 `state.json`。

### 1. 初始化阶段图

由调用技能先根据当前任务设计节点和边，再初始化状态文件。

直接初始化:

```bash
node skills/ysir-state/scripts/state.js init \
  --state .report/in-progress/{task}/state.json \
  --nodes "setup-electron,implement-main-window,wire-storage" \
  --edges "setup-electron>implement-main-window,implement-main-window>wire-storage"
```

使用软件方法 schema 展开子阶段，`--schema` 传入 schema 名称:

```bash
node skills/ysir-state/scripts/state.js init \
  --state .report/in-progress/{task}/state.json \
  --nodes "setup-electron,implement-main-window,wire-storage" \
  --schema standard
```

也可以传入其它已存在的 schema 名称:

```bash
node skills/ysir-state/scripts/state.js init \
  --state .report/in-progress/{task}/state.json \
  --nodes "setup-electron,implement-main-window,wire-storage" \
  --schema tdd
```

若 `ysir-configure` 显示人工验收开启，在初始化时插入人工验收节点:

```bash
node skills/ysir-state/scripts/state.js init \
  --state .report/in-progress/{task}/state.json \
  --nodes "setup-electron,implement-main-window,wire-storage" \
  --human-acceptance true
```

参数说明:

- `--state`: 状态文件路径。
- `--nodes`: 节点列表，逗号分隔；使用 schema 时表示待展开的计划阶段。
- `--edges`: 有向边列表，逗号分隔；单条边格式为 `from>to`。使用 schema 时表示计划阶段之间的依赖；不传则按 `--nodes` 顺序连接。
- `--schema`: 可选的软件方法 schema 名称；默认使用 `standard`，按 references/schemas/{schema}/schema.json 加载。若要初始化不展开 schema 的原始自定义图，传 `--schema none`。
- `--human-acceptance`: 可选；为 `true` 时，在每个计划阶段末尾插入 `human-acceptance` 节点。
- `--current`: 可选，当前节点；不传时默认使用展开后的第一个节点。

状态图必须是有向无环图；脚本会在初始化时拒绝成环的图。

### 2. 读取阶段图

```bash
node skills/ysir-state/scripts/state.js show \
  --state .report/in-progress/{task}/state.json
```

读取结果用于判断当前阶段、当前子阶段目标、可推进节点和已有状态。

`show` 会在 `currentObjective` 中动态拼接“先使用 `ysir-regulation` 了解与本次行动相关的规范”的前置目标。该内容只出现在读取输出中，不写入状态文件，也不作为独立机制或命令存在。

若当前节点由 schema 子阶段展开且配置了 `subagent`，`show` 会输出 `currentSubagent: true|false`。该字段只表示是否使用 subagent 模式执行，不表示 subagent 身份、模型或工具配置。

### 3. 推进当前节点

```bash
node skills/ysir-state/scripts/state.js advance \
  --state .report/in-progress/{task}/state.json \
  --note "Electron 框架已搭建"
```

`advance` 会自动完成当前节点并推进 `current`:

- 当前节点只有一个后继时，自动切换到该后继节点。
- 当前节点没有后继时，清空 `current`，表示状态图已走到结尾。
- 当前节点存在多个后继时，必须传入 `--next <node-id>` 明确选择。
- `--note`: 简短说明或证据。

多后继推进示例:

```bash
node skills/ysir-state/scripts/state.js advance \
  --state .report/in-progress/{task}/state.json \
  --next "implement-main-window" \
  --note "Electron 框架已搭建"
```

### 4. 追加下一轮 attempt

当当前节点需要进入同一 `phase` 的下一轮子图时，使用 `next-attempt`。常见场景包括当前节点失败需要返工，或当前 attempt 已完成但 schema 要求继续下一个最小行为。`next-attempt` 只支持使用 schema 展开的状态图。

```bash
node skills/ysir-state/scripts/state.js next-attempt \
  --state .report/in-progress/{task}/state.json \
  --status failed \
  --note "代码审查发现结构问题，需要修改实现"
```

若当前 attempt 已完成但需要继续下一轮，例如 TDD 进入下一个最小行为:

```bash
node skills/ysir-state/scripts/state.js next-attempt \
  --state .report/in-progress/{task}/state.json \
  --status completed \
  --note "继续下一个最小行为"
```

`next-attempt` 会自动:

- 将当前节点标记为 `--status` 指定的状态。
- 追加同一 `phase` 的下一轮 attempt 子图。
- 将当前节点指向新 attempt 的起点。
- 将原 phase 尾部的后继阶段边迁移到新 attempt 的尾部。
- 将 `current` 指向新 attempt 的第一个节点。

### 5. 手动修正节点状态

仅在需要标记阻塞、修正误操作或补充说明时使用 `set`。正常完成和推进当前节点时优先使用 `advance`。

```bash
node skills/ysir-state/scripts/state.js set \
  --state .report/in-progress/{task}/state.json \
  --node "setup-electron" \
  --status "blocked" \
  --note "等待用户确认窗口技术栈"
```

参数说明:

- `--node`: 要更新的节点。
- `--status`: 节点状态，例如 `pending`、`current`、`blocked`、`completed`。
- `--note`: 简短说明或证据。
- `--current`: 按需手动修正当前节点指针。

### 6. 使用约束

- 节点、边、状态含义由调用技能定义。
- 脚本只做初始化、读取、推进、追加下一轮 attempt 和必要状态修正。
- 门禁判断由调用技能基于状态图、需求文档、计划文档和项目规范完成。
- 正常阶段完成后使用 `advance` 推进；`set` 只用于人工修正、阻塞标记或补充状态。
- 当前节点失败或 schema 要求继续下一轮时，使用 `next-attempt` 追加新 attempt，不在图中回退或成环。
- `note` 只记录简短说明，不写长篇报告正文。
