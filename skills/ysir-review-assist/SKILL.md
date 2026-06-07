---
name: ysir-review-assist
description: 交互式逐文件代码审查辅助；按用户指定的 git 变更范围建立审查队列，每次展示一个文件的原始 diff 和深入审查判断，记录用户文件级审查结论，最终以用户结论为准。
---

# ysir-review-assist

## 目标

作为另一位审查者辅助用户逐文件审查代码变更。这个技能负责审查导航、原始 diff 展示和深入审查判断，但不替用户完成最终裁决。

## 核心原则

- 每次只展示一个文件，不一次性输出整份大型审查报告。
- 必须展示原始变更；不能只给摘要或结论。
- 助理必须给出深入审查判断，像另一位 reviewer 一样明确指出具体问题、风险、证据和建议，但不能把自己的判断表述为最终审查结论。
- 审查推进状态必须通过 `ysir-state` 脚本管理；每个文件按 `Agent 审查 -> 用户审查` 两个 schema 子节点推进，diff 内容仍通过 git 动态读取，不写入状态文件。
- 用户的文件级结论拥有最高优先级。
- 展示审查页和审查判断的同一轮回复中，禁止执行 `agent-done`。必须等用户首次回复后，才确认用户已经看见审查判断并推进到 `user-review`。
- 用户说“结束本轮审查”时，指的是整个审查流程结束，不再继续审查任何文件；此时只针对已经审查过的内容给出结论汇总。
- 若未发现具体问题，应明确说明“未发现具体问题”，并列出仍需用户关注的残余风险或测试缺口。
- 不自动修改代码、不自动提交代码；若用户要求修改，明确切换到实现任务。
- 兼容不同 Agent 运行环境：所有环境都统一生成审查页文件，并在回复中提供链接；Codex 环境中的具体行级问题使用 inline code comment 挂到源码行，非 Codex 环境中直接在回复正文展示行级问题。
- 行级 comment 只作为源码定位和附加展示，不能替代正文审查判断；正文必须完整写出每条 finding 的优先级、标题、风险原因、证据和建议，避免用户只看到 comment 标题却看不到判断内容。

## 使用流程

### 1. 建立审查会话

根据用户要求选择 git 变更范围:

```bash
node skills/ysir-review-assist/scripts/review-assist.js start --source staged
node skills/ysir-review-assist/scripts/review-assist.js start --source unstaged
node skills/ysir-review-assist/scripts/review-assist.js start --source working-tree
node skills/ysir-review-assist/scripts/review-assist.js start --source commit --ref HEAD
node skills/ysir-review-assist/scripts/review-assist.js start --source range --base main --head HEAD
```

`start` 会调用 `skills/ysir-state/scripts/state.js init --schema review-assist` 初始化 `.report/review-assist/state.json`。每个文件是一个 phase，并按 `review-assist` schema 展开为两个节点:

- `agent-review`: Agent 展示当前文件原始 diff，并给出深入审查判断。
- `user-review`: 等待用户给出最终文件级结论。

`.report/review-assist/state.json` 只保存状态图、当前指针、用户结论和 history；`.report/review-assist/meta.json` 只保存 git source 与文件 phase 映射；diff 内容每次通过 git 动态读取。

第一版只审查 git 已跟踪变更；未跟踪文件不会进入队列，需先进入 git 跟踪语义后再审查。

### 2. 生成当前文件审查页

```bash
node skills/ysir-review-assist/scripts/review-assist.js review
```

脚本会获取当前文件路径、进度和该文件原始 diff，并把带元信息的审查页写入 `.report/review-assist/files/{序号}-{文件名}.md`。审查页文件名会把原始路径安全化，去掉最后一个原始扩展名后再追加 `.md`，避免出现 `.md.md`。

审查页是统一的 diff 展示载体；`--codex-artifact` 仅作为兼容旧调用参数，普通 `review` 也必须生成审查页:

```bash
node skills/ysir-review-assist/scripts/review-assist.js review --codex-artifact
```

`review` 会在保留 stdout 原始 diff 的同时输出 `reviewPage: <path>`；带 `--codex-artifact` 时会额外输出同一路径的 `codexArtifact: <path>`。Agent 回复中应提供审查页的 Markdown 链接，并在对话中给出审查判断；不要再把整段 diff 粘贴进聊天。

行级问题按运行环境展示:

- Codex 环境: 使用 `::code-comment{...}` 挂到对应源码行；同时必须在正文完整展开同一条 finding，包括优先级、标题、风险原因、证据和建议。不能只在正文写“发现一个问题”，再把具体判断放进 inline comment 的 body。
- 非 Codex 环境: 在回复正文直接展示行级问题，包括优先级、文件路径、行号、问题和建议。

文件级结论在所有环境中保持一致：等待用户给出通过、跳过，或需要修改。

将脚本获取到的审查页链接展示给用户。注意：用户无法看到工具输出结果；必须把 `reviewPage` 路径转换为面向用户可见的 Markdown 链接。
随后给出该文件的深入审查判断:

- 这个文件改了什么。
- 是否存在具体 bug、行为回归、边界遗漏、状态不一致或维护性风险。
- 每个问题都应尽量关联到 diff 中的具体片段和原因；不确定时明确说明假设。
- 建议用户重点审查的片段和问题优先级。
- 当前文件需要的验证或测试，以及现有测试是否足够支撑这次变更。

本轮面向用户的可见回复必须以“审查页链接 -> 审查判断/行级问题 -> 等待用户结论”的结构结束，不能发送一个不含审查页链接的收口消息。

此时必须停在当前文件的 `agent-review` 节点，禁止立刻执行 `agent-done`。原因是 `agent-done` 表示“用户已经看见审查判断并进入用户审查”，只能在用户对本轮审查回复后成立。

若用户在建立审查会话时或当前文件审查前已经明确要求跳过某个文件或某类文件（例如“跳过 readme”），可以不生成该文件审查页，直接执行:

```bash
node skills/ysir-review-assist/scripts/review-assist.js agent-done --diff-shown-to-user --note "按用户明确要求跳过，未展示 diff"
node skills/ysir-review-assist/scripts/review-assist.js mark --decision skipped --note "按用户明确要求跳过"
```

这个例外只适用于用户明确指定的跳过规则；不能用它替代普通文件的审查展示。此时 `--diff-shown-to-user` 表示该文件因用户规则无需展示 diff，note 必须写明“按用户明确要求跳过，未展示 diff”，避免和正常审查完成混淆。

用户首次回复后，无论用户只是说“继续/收到”，还是直接给出“通过 / 跳过 / 需要修改”，都先执行:

```bash
node skills/ysir-review-assist/scripts/review-assist.js agent-done --diff-shown-to-user --note "已展示原始 diff 并给出审查判断"
```

`agent-done` 会通过 `ysir-state advance` 完成当前文件的 `agent-review` 节点，并推进到同一文件的 `user-review` 节点。`--diff-shown-to-user` 是强制门禁，确认的是当前文件审查页链接和审查判断已经出现在上一轮面向用户的可见回复中，且审查页包含原始 diff；不是确认 `review` 命令执行过。

若用户首次回复已经包含文件级结论，则在 `agent-done` 成功进入 `user-review` 后，紧接着执行对应的 `mark`；也就是同一轮连续推进两步。

### 3. 记录用户结论

用户明确给出结论后，记录用户结论到审查状态图。执行 `mark` 前必须已经位于 `user-review`；若仍在 `agent-review`，先按上一节执行 `agent-done`。

```bash
# 通过
node skills/ysir-review-assist/scripts/review-assist.js mark --decision approved --note "ok"

# 按要求修改
node skills/ysir-review-assist/scripts/review-assist.js mark --decision changes-requested --note "需要修改..."

# 跳过
node skills/ysir-review-assist/scripts/review-assist.js mark --decision skipped --note "跳过"
```

不要替用户标记通过；只有用户明确给出结论时才执行 `mark`。`mark` 只允许在 `user-review` 节点执行，用户结论写入节点 `note`，节点状态仍保持 `completed` 或 `failed` 这类流程状态:

- 通过: 使用 `--decision approved`，通过 `ysir-state advance` 推进到下一个文件的 `agent-review`，并在 `note` 中记录用户结论。
- 跳过: 使用 `--decision skipped`，通过 `ysir-state advance` 推进到下一个文件的 `agent-review`，并在 `note` 中记录用户结论。
- 按要求修改: 使用 `--decision changes-requested`，通过 `ysir-state next-attempt` 追加同一文件的下一轮 `agent-review -> user-review` attempt，并把当前指针推进到下一轮 `agent-review`；本轮用户节点以 `failed` 表达返工，具体结论写入 `note`。

### 4. 查看状态

```bash
node skills/ysir-review-assist/scripts/review-assist.js list
```

`list` 只用于查看当前状态图中的文件队列和当前节点。不要提供额外的手动游标移动命令；当前节点只能由用户首次回复后执行的 `agent-done`，或记录“通过 / 跳过 / 按要求修改”的 `mark` 命令通过 `ysir-state` 推进。

用户说“继续”时，若当前在 `agent-review` 且上一轮已经展示了当前文件审查判断，先执行 `agent-done` 进入 `user-review`，然后等待用户给出文件级结论；不要重新展示同一文件，也不要替用户跳到下一个文件。若当前在 `agent-review` 但尚未展示当前文件审查判断，生成审查页并展示判断。若当前在 `user-review`，等待用户给出文件级结论，不要替用户跳到下一个文件。

### 5. 汇总

```bash
node skills/ysir-review-assist/scripts/review-assist.js summary
```

`summary` 代表本轮审查结束，输出汇总后必须删除 `.report/review-assist/files` 审查页文件夹，避免过程 diff 文件残留。

脚本只负责输出结构化汇总原料，不负责自然语言整合。`summary` 应逐文件列出当前状态，并列出该文件所有 `user-review` attempt 的 decision、节点状态和用户 note，确保 `changes-requested` 等历史结论不会因后续 attempt 未处理而丢失。

Agent 必须基于 `summary` 的结构化原料，向用户整理一份人工可读的审查结论汇总:

- 只整合用户文件级结论、用户备注和未审文件；助理审查判断不是最终结论，不能混入最终裁决。
- 对同一文件的多轮 attempt，保留每轮用户结论和备注，尤其说明是否曾要求修改、原因是什么、后续是否已复审通过。
- 对当前仍 pending 的文件，说明它是尚未审查、等待用户结论，还是在要求修改后的下一轮 attempt 中等待复审。
- 若某文件没有任何用户结论，只能标为未审或待用户结论，不能推断通过。

## 约束

- `.report/review-assist/state.json` 和 `.report/review-assist/meta.json` 属于本地审查过程数据，不纳入版本管理；`.report/review-assist/files` 属于临时审查页目录，审查结束时必须清理。
- 若用户要求审查范围变化，重新 `start` 建立新会话；新会话会替换上一轮本地审查状态，不保留多审查会话历史。
- 若 git 变更内容在审查过程中变化，文件队列仍以 `start` 时为准，`review` 动态读取当前 diff。
- 二进制文件或 diff 不可用时，只说明 git 输出，不编造内容。
