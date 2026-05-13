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
      "template": "optional-template.md"
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

## 展开规则

- 展开后的节点 ID 为 `{计划阶段}:{schema子阶段}`。
- 展开后的节点保留 `phase`、`stage`、`label`、`objective`、`template` 元数据。
- schema 内部 `edges` 会在每个计划阶段内重复应用。
- `init --edges` 表示计划阶段之间的依赖；脚本会连接 `from` 阶段最后一个子阶段到 `to` 阶段第一个子阶段。
- 若未提供 `init --edges`，脚本按 `--nodes` 顺序连接相邻计划阶段。

## 已有 schema

- `standard`: 标准开发流程，按 `develop -> acceptance-test -> acceptance-review -> delivery-commit` 展开。
- `tdd`: TDD 流程，按 `red-test -> green-implementation -> refactor -> quality-review -> delivery-commit` 展开；`quality-review` 判断是否继续下一个最小行为或返工，需要继续时使用 `next-attempt` 追加新 attempt，保持状态图有向无环。

## 扩展边界

- schema 只描述通用方法阶段，不写具体需求内容。
- schema 应优先描述阶段目标；模板只是可选产物格式提示。
- 复杂条件分支由调用技能在初始化时直接传 `--nodes` / `--edges` 定义；初始化后不通过增量补图改变执行边界。
- schema 不判断阶段是否完成；完成判断由调用技能基于状态、规范和上下文完成。
