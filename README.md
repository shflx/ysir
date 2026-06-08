# Ysir

为编程助手提供稳定、可审计的交付能力。

> *Yes, Sir.*

## 概览

### 设计思想

相信 Agent 的智慧，以清晰、稳定的工程化约束，为交付过程提供可靠边界。

YSIR 不试图替代 Agent 的判断，而是把需求、方案、实现、验证、审查和交付沉淀为可追踪的本地证据。它适合希望 Agent 自主推进、但又需要过程边界和后续可维护性的项目。

### 适合场景

- 希望让 Agent 独立推进实现，但需要清晰边界和过程留痕。
- 希望需求、方案、实现、验证和审查能够互相对齐。
- 希望每次交付都留下可供后续维护者接手的上下文。
- 希望在标准开发、TDD、小改动和缺陷修复之间选择不同轻重的流程。

YSIR 还提供状态图、辅助审查和本地任务大屏等机制，让推进边界、文件级判断和过程状态都有清晰载体，使 Coding Agent 更适合作为持续协作的工程伙伴。

### 工作原理

YSIR 将一组面向交付的工程约束拆成独立技能，并把它们接入编程助手。不同技能分别负责项目理解、策略配置、需求梳理、设计沉淀、实现规划、代码落地、审查辅助与符合性检查，避免将整个流程耦合在一次对话里。

[`ysir.js`](./ysir.js) 负责安装这些技能，[`skills/`](./skills) 定义各阶段行为规范，`.report/` 用来沉淀设计、需求、计划、状态图、测试、审查、自进化偏好和归档产物。实现阶段通过状态图推进，确保每次只处理当前节点，并在完成、返工、人工验收和逐文件审查时留下明确轨迹。

## 快速开始

### 安装

安装前请确保本机已安装 Git 和 Node.js。

可以让本地 Coding Agent 帮你安装：

```text
请从 https://github.com/shflx/ysir 拉取项目，并根据当前工具完成 YSIR 安装。
```

也可以手动安装：

```bash
git clone https://github.com/shflx/ysir.git
cd ysir
```

交互式安装：

```bash
node ysir.js
```

或使用非交互安装：

```bash
node ysir.js --tool codex --yes
node ysir.js --tool claude --yes
```

<p align="center">
  <img src="docs/image/configure.gif" alt="YSIR configure wizard" width="860" />
</p>

安装向导将引导你完成目标工具与安装目录配置。

### 使用

安装完成后，在 Codex 或 Claude Code 中打开目标项目，即可通过技能名直接触发对应能力。

下面的 `$ysir-*` 不是 shell 命令，而是发送给已安装 Coding Agent 的提示。

常见场景：

| 场景 | 给 Agent 的示例 |
| --- | --- |
| 理解当前项目 | `$ysir-understand 阅读当前项目` |
| 端到端交付 | `$ysir 实现本地密码管理工具` |
| 小范围快速改造 | `$ysir 快速把配置文件路径支持为绝对路径，并补最小验证` |
| 缺陷修复 | `$ysir 修复用户导出 CSV 时中文乱码的问题，保留现有 API` |
| 功能或机制设计 | `$ysir-design 设计加密机制` |
| 逐文件辅助审查 | `$ysir-review-assist 审查 staged 变更` |
| 查看过程状态 | `$ysir-headquarters 查看当前任务状态` |

`$ysir` 会根据任务自动选择完整交付、小范围改造或缺陷修复路线（`standard`、`quick-change`、`bug-fix`）；需要完整流程时直接描述需求，需要小改或修复时说明边界、错误现象或复现方式即可。

首次在项目中使用 YSIR 时，YSIR 会通过 `ysir-configure` 初始化 `ysir.yaml`，包括人工参与策略、软件开发方法和自进化能力。

执行过程中，YSIR 会在当前项目的本地 `.report/` 目录中记录需求、计划、状态图、验证、审查和归档结果。

## 核心组成

### 配置与流程

项目级策略由根目录 `ysir.yaml` 管理。它决定 YSIR 使用哪种开发方法、是否启用自进化能力，以及人在设计、需求澄清、需求确认、计划确认和验收阶段是否参与。

默认配置偏向自动推进：使用 `standard` 流程，开启自进化能力，关闭设计参与、需求澄清、需求确认、计划确认和人工验收。

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

当前内置状态图流程：

| 流程 | 用途 |
| --- | --- |
| `standard` | 标准开发流程：开发、验收测试、代码审查、提交。 |
| `tdd` | TDD 流程：围绕最小可验证行为循环红灯测试、绿灯实现、重构和质量判断。 |
| `quick-change` | 小范围快速改造流程：边界确认、快速实现、最小验证、提交。 |
| `bug-fix` | 缺陷修复流程：问题定位、最小修复、回归验证、提交。 |
| `review-assist` | 逐文件辅助审查流程：Agent 审查、用户审查。 |

其中 `standard`、`tdd`、`quick-change` 和 `bug-fix` 用于实现交付，`review-assist` 用于独立的逐文件审查会话。

### 技能介绍

多数情况下，用户主要直接使用 `ysir`、`ysir-understand`、`ysir-design`、`ysir-review-assist` 和 `ysir-headquarters`；需要调整项目策略时使用 `ysir-configure`。

其余技能主要由 YSIR 工作流按需调用，用来维护需求、计划、状态图、规范和交付检查。

| 技能 | 作用 |
| --- | --- |
| `ysir` | 默认总控技能，负责串联从需求到实现的端到端交付流程。 |
| `ysir-configure` | 负责管理 `ysir.yaml`，控制人工参与策略、软件开发方法和自进化能力。 |
| `ysir-understand` | 负责帮助 Agent 快速理解当前项目，梳理后续开发接手所需的关键信息。 |
| `ysir-design` | 负责项目设计或功能/机制设计，沉淀可复用的设计文档。 |
| `ysir-order` | 负责需求梳理，将模糊指令收敛为结构化需求结果。 |
| `ysir-plan` | 负责形成实现规划，选择合适流程，并初始化可执行状态图。 |
| `ysir-moveout` | 负责按状态图落地当前节点，并推进完成、返工和归档流程。 |
| `ysir-inspect` | 负责检查实现是否与设计、需求和方案保持一致，并在必要时提出整改要求。 |
| `ysir-state` | 负责维护任务过程中的阶段有向图，为其它技能提供进度门禁。 |
| `ysir-regulation` | 负责提供通用、开发、测试、审查和提交规范入口。 |
| `ysir-evolve` | 负责基于本地证据沉淀用户习惯、风格与协作偏好。 |
| `ysir-review-assist` | 负责建立逐文件审查队列，展示原始 diff，并辅助用户记录文件级结论。 |
| `ysir-headquarters` | 负责把 `.report` 渲染为本地只读任务大屏，用于查看任务状态、证据和异常。 |

### 产物

YSIR 的过程产物默认保存在当前项目的 `.report/` 目录中，用来记录设计、需求、计划、状态图、验证、审查和归档结果，方便后续 Agent 或维护者接手。

项目级策略则由根目录 `ysir.yaml` 管理。

这些产物默认只保存在本地项目中，不依赖远程服务。

```text
.report/
├── design/
│   ├── proj.md
│   └── {功能/机制名}.md
├── evolve.md
├── evolve/
│   ├── user-prompt-submit.jsonl
│   └── user-prompt-submit.processing.jsonl
├── in-progress/{日期}-{需求简短描述}/
│   ├── order.md
│   ├── plan.md
│   ├── state.json
│   ├── test-round-{round}.md
│   └── cr-round-{round}.md
├── review-assist/
│   ├── state.json
│   ├── meta.json
│   └── files/
└── done/{日期}-{需求简短描述}/
```

- `design/`：沉淀项目设计与功能/机制设计文档
- `evolve.md`：沉淀可复用的用户习惯、风格与协作偏好
- `evolve/`：保存待处理的本地提示事件队列和当前 processing 批次，用于后续提炼偏好
- `in-progress/`：记录当前进行中的需求文档、实现计划、状态图、测试与代码审查结果
- `review-assist/`：保存逐文件审查会话状态；`files/` 是临时审查页目录，审查结束后清理；diff 内容仍从 git 动态读取
- `done/`：归档已完成需求对应的过程文档

是否提交 `.report/` 取决于项目协作策略；它适合保留审计轨迹，但可能包含需求、审查和偏好信息。

启用自进化能力时，YSIR 会维护项目级 Codex hook。自进化当前仍是初步能力，主要支持 Codex 环境：

```text
.codex/hooks.json
.codex/user-prompt-submit-capture.js
```

该 hook 只把 `UserPromptSubmit` 事件写入本地待处理队列，不提炼偏好、不上传、不阻断主流程。

## License

[MIT License](./LICENSE)
