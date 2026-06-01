---
name: ysir-configure
description: 管理项目级 ysir.yaml 配置，用于控制 human-in-the-loop 行为、软件开发方法和自进化能力，包括参与设计、需求澄清、需求确认、计划确认、人工验收、standard/tdd 流程和 ysir-evolve。
---

# ysir-configure

## 目标

创建、读取或更新项目根目录的 `ysir.yaml`，用配置明确人的参与程度、软件开发方法和自进化策略，并让其它 YSIR 技能按同一套项目策略执行。

## 配置文件

默认配置文件路径:

```text
ysir.yaml
```

若文件不存在，必须先进行一次性配置交互，再写入 `ysir.yaml`。

## 配置项

```yaml
developmentMethod: standard
evolve:
  enabled: true
humanInTheLoop:
  designParticipation:
    enabled: false
  requirementClarification:
    enabled: false
  requirementConfirmation:
    enabled: false
  planConfirmation:
    enabled: false
  acceptance:
    enabled: false
```

完整默认配置见 [`references/ysir.yaml`](./references/ysir.yaml)。

- `developmentMethod`: 软件开发方法；可选 `standard` 或 `tdd`，默认 `standard`。
- `evolve.enabled`: 自进化能力；开启后，`ysir-evolve` 可基于本地证据持续提炼用户习惯、风格与偏好，并让后续 Agent 遵循。
- `designParticipation`: 参与设计；开启后，项目设计或重要机制设计需要让用户参与关键设计取舍。
- `requirementClarification`: 需求澄清；开启后，允许通过多次询问把需求梳理清楚。
- `requirementConfirmation`: 需求确认；开启后，需求文档产出后必须让用户检查确认。
- `planConfirmation`: 计划确认；开启后，实现方案计划产出后必须让用户检查确认。
- `acceptance`: 人工验收；开启后，在交付成果需要人工判断时让用户验收。

`evolve.enabled` 默认开启；除 `developmentMethod` 和 `evolve.enabled` 外，所有 human-in-the-loop 开关默认关闭；未配置字段按默认值处理。

## 使用方式

### 1. 读取配置

当其它 YSIR 技能需要判断软件开发方法、是否要询问、确认、人工验收或是否启用自进化能力时，先读取 `ysir.yaml`。

若配置文件不存在，先执行“首次配置”，一次性向用户确认全部配置项，然后写入 `ysir.yaml` 并读取配置。若 `evolve.enabled` 为 `true`，必须通过 `ysir-evolve` 的 `scripts/register-user-prompt-hook.js` 确保自进化事件来源已注册。

### 2. 首次配置

当用户要求初始化、启用或配置项目策略，或其它技能读取配置但 `ysir.yaml` 不存在时，执行首次配置。

首次配置应尽量一次完成，减少交互负担。向用户确认前，必须先解释 `ysir.yaml` 的用途和默认配置含义，避免用户误以为这是当前业务功能、游戏或需求本身的配置。

必须完整发送以下固定提示，不得自行压缩或省略其中的用途说明、影响范围、默认配置含义和可回复方式。

```text
YSIR 配置文件 ysir.yaml 不存在，需要先创建一次项目策略配置。

ysir.yaml 不是业务功能配置，也不是当前需求配置；它只决定 YSIR 后续工作流怎么运行：
- 使用哪种开发方法（standard 或 tdd）。
- 是否启用自进化能力。
- 是否在设计、需求、计划和验收阶段让你确认。

默认配置含义：
- 使用 standard 开发流程。
- 开启自进化能力。
- 关闭参与设计、需求澄清、需求确认、计划确认和人工验收。

这样我后续会尽量自动推进，只在真正阻塞或你明确要求时再停下来确认。

请确认 YSIR 的项目策略配置：

1. 软件开发方法：使用 standard 还是 tdd？默认 standard
2. 自进化能力：是否启用 ysir-evolve，让系统基于本地证据持续记录用户习惯、风格与偏好？默认开启
3. 参与设计：项目设计或重要机制设计时是否需要你参与关键取舍？默认关闭
4. 需求澄清：是否允许通过多次询问梳理清楚需求？默认关闭
5. 需求确认：需求文档产出后是否需要你检查确认？默认关闭
6. 计划确认：实现方案计划产出后是否需要你检查确认？默认关闭
7. 人工验收：交付成果需要人工判断时是否需要你验收？默认关闭

可直接回复“使用默认配置”，或按项说明要关闭/开启哪些配置。
```

若用户回复“使用默认配置”或只调整部分项目，未提及项目使用默认值。

完成确认后，根据结果创建 `ysir.yaml`。若自进化能力开启，同时运行 `node {ysir-evolve技能目录}/scripts/register-user-prompt-hook.js` 创建或更新项目级自进化事件 hook。

### 3. 更新配置

更新配置时只改用户明确要求的字段，保留其它配置不变。

若用户表达为“少问一点”“严格确认”“关闭人工验收”“使用 TDD”“开启自进化”“关闭自进化”等自然语言，先映射到对应字段，再更新 `ysir.yaml`。

若更新后 `evolve.enabled` 为 `true`，运行 `node {ysir-evolve技能目录}/scripts/register-user-prompt-hook.js` 确保自进化事件来源已注册；若为 `false`，只更新 `ysir.yaml`，不要自动删除用户已有 hook，除非用户明确要求移除。

### 4. 配置解释

当用户询问当前配置含义时，读取 `ysir.yaml` 并解释每个开关对后续流程的影响。

### 5. 注册自进化事件来源

当 `evolve.enabled` 为 `true` 时，创建或更新项目级 hook 文件:

```text
.codex/hooks.json
```

注册命令:

```bash
node {ysir-evolve技能目录}/scripts/register-user-prompt-hook.js
```

该脚本会在当前项目中确保以下自进化事件来源存在或被正确配置:

```text
.codex/user-prompt-submit-capture.js
.codex/hooks.json
```

目标配置:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .codex/user-prompt-submit-capture.js",
            "timeout": 2
          }
        ]
      }
    ]
  }
}
```

注册要求:

- 若 `.codex/hooks.json` 不存在，创建父目录和文件。
- 若文件已存在，保留所有既有 hook，只追加缺失的 YSIR `UserPromptSubmit` command，不重复添加相同 command。
- 不修改用户级 `~/.codex/hooks.json`；默认只做项目级 opt-in。
- 若项目内 `.codex/user-prompt-submit-capture.js` 不存在，从 `ysir-evolve/scripts/user-prompt-submit-capture.js` 复制生成。
- hook 只负责把 Codex 传入的 `UserPromptSubmit` 事件追加到 `.report/evolve/user-prompt-submit.jsonl` 待处理队列；不做偏好提炼、不上传、不阻断主流程。

## 约束

- 本技能只维护配置和自进化事件来源注册，不执行需求澄清、计划编写、实现、验收或偏好提炼。
- `ysir.yaml` 是项目级配置，应放在仓库根目录。
- `.codex/hooks.json` 是项目级 Codex hook 配置；启用自进化能力时允许创建或合并该文件。
- 不要把配置项写入各个需求文档；其它技能按需读取 `ysir.yaml`。
- `developmentMethod` 只能使用 `standard` 或 `tdd`；未配置时按 `standard` 处理。
- 未配置的 `evolve.enabled` 按开启处理；未配置的 human-in-the-loop 字段按关闭处理；若文件缺失，则先完成首次配置并落地配置文件。
