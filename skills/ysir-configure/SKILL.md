---
name: ysir-configure
description: 管理项目级 ysir.yaml 配置，用于控制 human-in-the-loop 行为，包括需求澄清、需求确认、计划确认和人工验收。
---

# ysir-configure

## 目标

创建、读取或更新项目根目录的 `ysir.yaml`，用配置明确人的参与程度，并让其它 YSIR 技能按同一套 human-in-the-loop 策略执行。

## 配置文件

默认配置文件路径:

```text
ysir.yaml
```

若文件不存在，必须先进行一次性配置交互，再写入 `ysir.yaml`。

## 配置项

```yaml
humanInTheLoop:
  requirementClarification:
    enabled: true
  requirementConfirmation:
    enabled: true
  planConfirmation:
    enabled: true
  acceptance:
    enabled: true
```

- `requirementClarification`: 需求澄清；开启后，允许通过多次询问把需求梳理清楚。
- `requirementConfirmation`: 需求确认；开启后，需求文档产出后必须让用户检查确认。
- `planConfirmation`: 计划确认；开启后，实现方案计划产出后必须让用户检查确认。
- `acceptance`: 人工验收；开启后，在交付成果需要人工判断时让用户验收。

## 使用方式

### 1. 读取配置

当其它 YSIR 技能需要判断是否要询问、确认或人工验收时，先读取 `ysir.yaml`。

若配置文件不存在，先执行“首次配置”，一次性向用户确认全部配置项，然后写入 `ysir.yaml` 并读取配置。

### 2. 首次配置

当用户要求初始化、启用或配置 human-in-the-loop 行为，或其它技能读取配置但 `ysir.yaml` 不存在时，执行首次配置。

首次配置应尽量一次完成，减少交互负担。向用户一次性确认以下项目:

```text
请确认 YSIR 的 human-in-the-loop 配置：

1. 需求澄清：是否允许通过多次询问梳理清楚需求？默认开启
2. 需求确认：需求文档产出后是否需要你检查确认？默认开启
3. 计划确认：实现方案计划产出后是否需要你检查确认？默认开启
4. 人工验收：交付成果需要人工判断时是否需要你验收？默认开启

可直接回复“使用默认配置”，或按项说明要关闭/开启哪些配置。
```

若用户回复“使用默认配置”或只调整部分项目，未提及项目使用默认值。

完成确认后，根据结果创建 `ysir.yaml`。

### 3. 更新配置

更新配置时只改用户明确要求的字段，保留其它配置不变。

若用户表达为“少问一点”“严格确认”“关闭人工验收”等自然语言，先映射到对应字段，再更新 `ysir.yaml`。

### 4. 配置解释

当用户询问当前配置含义时，读取 `ysir.yaml` 并解释每个开关对后续流程的影响。

## 约束

- 本技能只维护配置，不执行需求澄清、计划编写、实现或验收。
- `ysir.yaml` 是项目级配置，应放在仓库根目录。
- 不要把配置项写入各个需求文档；其它技能按需读取 `ysir.yaml`。
- 未配置的字段使用默认值；若文件缺失，则先完成首次配置并落地配置文件。
