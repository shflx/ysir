---
name: ysir-understand
description: 工程化理解项目并输出可供 Coding Agent 继续工作的 Agent Context。Use when the user asks to understand, read, inspect, onboard to, or summarize a codebase/current workspace for later development; especially before planning, implementation, review, or handing context to another agent.
---

# ysir-understand

## 目标

工程化理解当前项目，输出可供 Coding Agent 快速接手继续开发的 Agent Context。

## 核心原则

- 默认只读项目，不创建、不修改任何文件，只输出事实型接手上下文。
- 不输出未来需求预测、具体方案、整改计划或代码审查结论。
- 可以输出基于当前事实的接手边界和风险提醒。
- 明确区分已确认事实、合理推断和未确认点。
- 优先理解当前工作区真实状态；`.report` 是可选上下文，不存在时基于仓库实际文件继续输出。
- 若工作区 dirty，必须说明未提交变更及其对理解结论的影响。

## 工作流程

### 1. 读取项目入口

优先读取以下材料；不存在则跳过，`.report` 缺失时只在未确认点中说明：

- 项目说明: `README*`、`design.md`、`progress.md`
- YSIR 文档: `.report/design/proj.md`、`.report/in-progress/**/{order.md,plan.md,state.json}`
- 工程配置: `package.json`、`pyproject.toml`、`go.mod`、`Cargo.toml`、`Makefile`

若存在 `.report/in-progress/`，优先识别当前活跃任务目录，并读取其中的 `order.md`、`plan.md`、`state.json`。判断活跃任务时，优先参考当前用户请求、`state.json` 的 `current`、最近修改时间和工作区 diff；无法确定时标明未确认。

### 2. 读取实现结构

- 使用文件列表和目录结构识别项目类型、源码入口、测试入口和主要模块。
- 读取核心入口文件、配置文件、测试入口和关键辅助文件。
- 不要为了追求完整而读取所有源码；优先读取能解释模块职责和工作流的文件。

### 3. 读取最新状态

必须检查：

- 当前分支
- 工作区是否 dirty
- `git status --short`
- 工作区已暂存和未暂存 diff 摘要
- 按需读取关键 diff 内容

若用户特别要求理解“最新状况”，必须把未提交新增、删除、修改分别说明清楚。

### 4. 输出 Agent Context

默认在对话中输出，不落文件。结构必须符合 [`references/agent-context.md`](./references/agent-context.md)。

输出要求：

- 内容面向后续 Coding Agent，保持短、硬、可操作。
- 只描述当前项目事实、边界和可确认状态；推断必须标明。
- 若发现活跃任务状态图，说明当前任务目录、`current` 节点和下一步执行边界；没有则写“未发现进行中状态图”。
- “目录与模块地图”使用裁剪过的职责树，不要输出完整 `tree` dump；优先保留入口、核心模块、配置、测试和文档产物目录。
- “运行与验证”必须区分已发现命令和已实际执行的命令；未执行时不得暗示已验证。
- “工作区最新变更”必须说明 dirty workspace 及其影响。
- “约束与注意事项”只放容易影响后续开发正确性的约束。
- “未确认点”必须列出未读、未验证或只是推断的内容。
