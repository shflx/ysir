# Ysir

为编程助手提供稳定、可审计的交付能力。

> *Yes, Sir.*

## 概览

### 设计思想

相信 Agent 的智慧，以少量、清晰、稳定的工程化约束替代层层接管。

### 目标

- 交付结果可用
- 交付过程清晰可追踪
- 需求、方案与实现保持一致
- 可作为后续维护与迭代的基础。

### 工作原理

YSIR 将一组面向交付的工程约束拆成独立技能，并把它们接入编程助手。不同技能分别负责需求梳理、设计沉淀、实现规划、代码落地与符合性检查，避免将整个流程耦合在一次对话里。

[`ysir.js`](/Users/shuffle/codes/project/ysir/ysir.js) 负责安装这些技能，[`skills/`](/Users/shuffle/codes/project/ysir/skills) 定义各阶段行为规范，`.report/` 用来沉淀设计、计划、测试、审查和归档产物。这样同一个需求从提出到完成，会沿着统一、可追踪的交付路径推进，而不是停留在一次性的代码生成。

## 快速开始

### 安装

```bash
git clone https://github.com/shflx/ysir.git
cd ysir
node ysir.js
```

<p align="center">
  <img src="docs/image/configure.gif" alt="YSIR configure wizard" width="860" />
</p>

安装向导将引导你完成目标工具与安装目录配置。

### 使用

安装完成后，打开目标工具，即可通过技能名直接触发对应能力。

```text
# 从0到1完成软件落地
$ysir 实现本地密码管理工具
```

```text
# 功能/机制详细设计
$ysir-design 设计加密机制
```

## 核心组成

### 技能介绍

| 技能 | 作用 |
| --- | --- |
| `ysir` | 默认总控技能，负责串联从需求到实现的端到端交付流程。 |
| `ysir-design` | 负责项目设计或功能/机制设计，沉淀可复用的设计文档。 |
| `ysir-order` | 负责需求梳理，将模糊指令收敛为结构化需求结果。 |
| `ysir-plan` | 负责实现规划，选择软件方法 schema，并初始化可执行状态图。 |
| `ysir-moveout` | 负责读取状态图并执行当前阶段。 |
| `ysir-inspect` | 负责检查实现是否与设计、需求和方案保持一致，并在必要时推动整改。 |
| `ysir-state` | 负责维护任务过程中的阶段有向图，为其他技能提供可靠的进度门禁。 |
| `ysir-regulation` | 负责提供统一的项目文档空间、通用、开发、测试、审查和提交规范入口。 |

### 产物

文档产物默认围绕 `.report/` 组织：

```text
.report/
├── design/
│   ├── proj.md
│   └── {功能/机制名}.md
├── in-progress/{日期}-{需求简短描述}/
│   ├── order.md
│   ├── plan.md
│   ├── test-round-{round}.md
│   └── cr-round-{round}.md
└── done/{日期}-{需求简短描述}/
```

- `design/`：沉淀项目设计与功能/机制设计文档
- `in-progress/`：记录当前进行中的需求文档、实现计划、测试与代码审查结果
- `done/`：归档已完成需求对应的过程文档

## License

MIT. 详见 [LICENSE](/Users/shuffle/codes/project/ysir/LICENSE).
