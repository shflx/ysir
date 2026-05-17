---
name: ysir-evolve
description: 记录用户的编程习惯、风格与偏好，在正确的基础上持续产出更符合用户期望的结果。
---

# ysir-evolve

## 目标

记录并持续更新用户的编程习惯、风格与偏好，让后续编码 Agent 在满足正确性、需求与设计约束的前提下，产出更符合用户期望的结果。

## 核心原则

- 只负责形成和更新偏好文档，不直接编写业务代码或其它项目文档。
- 若 `.report/evolve.md` 已存在，默认在理解现有偏好文档基础上增量更新，而不是重写。
- 偏好只在正确性、需求、设计和明确约束允许的范围内生效，不得凌驾于这些基础要求之上。
- 输出内容应简洁、可执行、便于后续 Agent 直接遵循。

## 输出

- 默认输出路径：`.report/evolve.md`
- 自进化待处理队列：`.report/evolve/user-prompt-submit.jsonl`
- 自进化处理批次：`.report/evolve/user-prompt-submit.processing.jsonl`
- 自进化队列只作为临时输入来源，不是长期审计日志；本批处理成功后必须出队清理。
- 文档格式必须符合 [`references/evolve.md`](./references/evolve.md)

## 自进化事件来源

`ysir-evolve` 拥有自进化事件来源的注册和记录脚本:

```text
scripts/register-user-prompt-hook.js
scripts/user-prompt-submit-capture.js
scripts/user-prompt-queue.js
```

当项目配置 `evolve.enabled` 为 `true` 时，由 `ysir-configure` 调用注册脚本:

```bash
node {ysir-evolve技能目录}/scripts/register-user-prompt-hook.js
```

注册脚本负责:

- 将 `scripts/user-prompt-submit-capture.js` 复制到当前项目 `.codex/user-prompt-submit-capture.js`。
- 创建或合并项目级 `.codex/hooks.json`。
- 注册 Codex `UserPromptSubmit` command: `node .codex/user-prompt-submit-capture.js`，作为当前自进化能力的输入来源。
- 保留既有 hooks，不重复添加相同 command。

记录脚本只负责把 Codex 传入的 `UserPromptSubmit` 事件追加到 `.report/evolve/user-prompt-submit.jsonl` 待处理队列，不做偏好提炼、不上传、不阻断主流程。

## 工作流程

根据调用意图，`ysir-evolve` 支持三类动作:

- `install`: 注册自进化事件来源。
- `read`: 读取已沉淀的用户偏好与习惯，供 `ysir-regulation` 作为规范来源分发。
- `process`: 批量消费自进化待处理队列，更新用户偏好与习惯。

### 1. Install: 注册自进化事件来源

当用户要求启用自进化，或 `ysir-configure` 发现 `evolve.enabled` 为 `true` 且事件来源未注册时，运行:

```bash
node {ysir-evolve技能目录}/scripts/register-user-prompt-hook.js
```

该动作只安装或更新事件来源，不提炼偏好。

### 2. Read: 读取用户偏好与习惯

当 `ysir-regulation` 需要统一规范来源时，读取 `.report/evolve.md`:

- 若文件存在，提取对当前任务有帮助的用户习惯、代码风格偏好和交付偏好。
- 若文件不存在，返回“未发现用户偏好与习惯”，不要主动创建。
- 读取结果只作为低优先级协作约束，不得凌驾于正确性、用户当前明确指令、需求、设计、计划和项目规范之上。

### 3. Process: 批量处理自进化队列

- 若 `.report/evolve.md` 已存在，先阅读并理解已有偏好文档。
- 处理前先运行 `node {ysir-evolve技能目录}/scripts/user-prompt-queue.js snapshot`。
- 若输出 `status: "empty"`，表示没有待处理输入；不要创建空偏好文档。
- 若输出 `status: "processing"`，读取输出中的 `path`，只处理该 processing 批次。
- `snapshot` 会把 `.report/evolve/user-prompt-submit.jsonl` 原子移动为 `.report/evolve/user-prompt-submit.processing.jsonl`；处理期间新进入的用户输入会留在新的 `user-prompt-submit.jsonl`，等待下一批处理。
- 若用户明确要求重置，再按新标准重写。

处理原则:

- 高置信长期偏好可自动写入或更新 `.report/evolve.md`，例如用户明确表达“以后”“默认”“我喜欢”“不要”。
- 低置信、一次性或只属于当前任务的约束，不写入长期偏好；必要时保留为候选或忽略。
- 若新增偏好与既有偏好冲突，或可能降低正确性、测试质量、安全性、可维护性，必须向用户确认后再写入。
- 不记录密钥、账号、隐私数据或其它敏感内容。
- `.report/evolve.md` 中每条偏好应尽量包含适用场景和例外条件；不要在 Markdown 正文中记录完整来源，也不要为了审计长期保留完整用户输入。
- 只有在 `.report/evolve.md` 已成功更新，或已确认本批没有可沉淀的长期偏好后，运行 `node {ysir-evolve技能目录}/scripts/user-prompt-queue.js commit` 删除 processing 批次，完成本批出队。
- 若处理失败、中断、需要用户确认冲突，或无法判断是否成功，不要运行 `commit`；遗留 processing 批次会在下次 `process` 优先继续处理。

### 4. 主动确认关键偏好

确认以下三个问题(一个接一个提问):

```text
希望默认保留哪些编程习惯？
1. 小步迭代、优先复用现有实现、只做当前需求范围内的改动（默认）
2. 我来补充具体习惯
```

```text
希望默认遵循哪类代码风格与表达方式？
1. 简洁直接、命名清晰、必要时补充少量注释（默认）
2. 我来补充具体风格
```

```text
是否还有其它希望写入的个人偏好？
1. 没有其它偏好（默认）
2. 有，我来补充
```

该确认只在用户主动要求整理偏好、现有证据不足或存在冲突时使用；默认自进化处理不逐条打扰用户。

### 5. 交付确认

- 写入或更新 `.report/evolve.md` 后，向用户简要说明本次纳入了哪些习惯、风格与偏好。
- 若用户新增偏好与既有偏好文档冲突，应显式指出冲突项并征求最终确认。
