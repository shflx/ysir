---
name: ysir-regulation
description: 提供通用、开发、提交等规范模板，供其他技能按需引用和复用。
---

# ysir-regulation

## 目标与定位

作为ysir工作流中的规范管理技能，为其他技能提供统一的规范入口，避免在各技能中重复维护开发、提交和通用规范。

**注：本技能的确认门禁优先级高于通用策略。**

用户偏好与习惯也是规范来源之一。若 `.report/evolve.md` 存在，读取后作为低优先级协作约束提供给调用技能；其优先级低于正确性、用户当前明确指令、需求、设计、计划和本技能 reference 规范。

## 项目文档空间说明

- 根目录: .report/

  - 设计文档目录: design/

    - 项目设计文档: proj.md

    - 功能/机制设计文档: {功能/机制名}.md

  - 进行中的任务文档目录: in-progress/{日期}-{需求简短描述}/

    - 需求文档: order.md

    - 计划文档: plan.md

    - 测试报告: test-round-{round}.md

    - 代码审查报告: cr-round-{round}.md

  - 已完成的任务文档目录: done/{日期}-{需求简短描述}/

默认阅读内容: 项目设计文档、本次需求对应的任务文档

按需阅读内容: 功能/机制设计文档

注：项目文档空间中的文件不纳入版本管理

## 使用方式

- 该技能本身不直接承担需求实现、设计或规划工作，只提供规范内容。

- 其他技能需要规范约束时，按需读取对应 reference 文件，不要一次性全部加载。

- 默认先读 `references/general.md`。

- 其次根据地图阅读相应的规范文档。

- 若 `.report/evolve.md` 存在，同时读取其中的用户偏好与习惯；若不存在，跳过且不要主动创建。

- 使用用户偏好时，只作为表达方式、协作方式、实现风格和交付呈现的辅助约束；若偏好与当前任务或规范冲突，以当前任务和规范为准，并在必要时说明取舍。

## 规范文档地图

- 通用规范: `references/general.md`

- 开发规范: `references/development.md`

- 测试规范: `references/testing.md`

- 代码审查规范: `references/code-review.md`

- 代码提交规范: `references/commit.md`

- 用户偏好与习惯: `.report/evolve.md`
