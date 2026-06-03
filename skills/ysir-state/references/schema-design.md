# 软件方法 schema 设计

## 目录结构

每个软件方法 schema 放在独立目录中:

```text
references/schemas/
├── standard/
│   ├── schema.json
│   ├── test.md
│   └── code-review.md
└── tdd/
    └── schema.json
```

## schema.json

```json
{
  "name": "schema-name",
  "description": "schema 说明",
  "subStages": [
    {
      "id": "sub-stage-id",
      "label": "展示名称",
      "objective": "该子阶段需要完成的事",
      "template": "optional-template.md",
      "subagent": true
    }
  ],
  "edges": [
    {
      "from": "sub-stage-id",
      "to": "next-sub-stage-id"
    }
  ]
}
```

- `subStages`: 每个计划阶段都会展开出的子阶段列表，核心是描述该子阶段要完成的工作。
- `edges`: 子阶段之间的有向边，只引用 `subStages[].id`。
- `objective`: 子阶段目标，说明执行该阶段应完成什么。
- `template`: 可选，指向同 schema 目录下的阶段产物模板；模板只用于产物格式辅助，不是 schema 的主要目标。
- `subagent`: 可选布尔值，表示该子阶段是否使用 subagent 模式执行；`true` 表示调用技能必须分派 subagent，`false` 表示允许主 agent 直接处理，未配置则由调用技能沿用默认策略。

## 展开规则

- 展开后的节点 ID 为 `{计划阶段}:{schema子阶段}`。
- 展开后的节点保留 `phase`、`stage`、`label`、`objective`、`template`、`subagent` 元数据。
- schema 内部 `edges` 会在每个计划阶段内重复应用。
- `init --edges` 表示计划阶段之间的依赖；脚本会连接 `from` 阶段最后一个子阶段到 `to` 阶段第一个子阶段。
- 若未提供 `init --edges`，脚本按 `--nodes` 顺序连接相邻计划阶段。

## 已有 schema

- `standard`: 标准开发流程，按 `develop -> acceptance-test -> acceptance-review -> delivery-commit` 展开。
- `tdd`: TDD 流程，按 `red-test -> green-implementation -> refactor -> quality-review -> delivery-commit` 展开；`quality-review` 判断是否继续下一个最小行为或返工，需要继续时使用 `next-attempt` 追加新 attempt，保持状态图有向无环。
- `quick-change`: 小功能点快速改造流程，按 `scope-check -> implement -> verify -> delivery-commit` 展开；`scope-check` 用于确认是否仍适合快速路径，若范围扩大或风险升高，应暂停推进并交还上层 workflow 判断。
- `bug-fix`: 缺陷修复流程，按 `investigate -> fix -> regression-test -> delivery-commit` 展开；`investigate` 合并复现和根因定位，必须基于证据确认问题，不确定时暂停推进。

## 扩展边界

- schema 只描述通用方法阶段，不写具体需求内容。
- schema 应优先描述阶段目标；模板只是可选产物格式提示。
- `subagent` 只是执行模式开关，不描述 subagent 身份、模型、工具或 prompt。
- 复杂条件分支由调用技能在初始化时直接传 `--nodes` / `--edges` 定义；初始化后不通过增量补图改变执行边界。
- schema 不判断阶段是否完成；完成判断由调用技能基于状态、规范和上下文完成。
