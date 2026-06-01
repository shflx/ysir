---
name: ysir-headquarters
description: 启动轻量本地动态网站，将 `.report` 渲染为只读的人类任务大屏，用于查看当前任务、状态进度、证据和异常。
---

# ysir-headquarters

## 目标

启动一个只读的本地动态网站，把当前项目的 `.report` 内容整理成给人看的任务大屏。

## 核心原则

- 只服务人类查看，不作为其它技能或 Agent 的数据契约。
- 只读 `.report`，不修改任务文档、不推进 `state.json`、不参与交付流程。
- 保持轻量：不使用数据库、不要求前端构建、不默认暴露到局域网。
- 每次页面请求动态读取 `.report`，刷新页面即可看到最新报告状态。

## 使用方式

默认在当前项目根目录启动本地服务:

```bash
node skills/ysir-headquarters/scripts/headquarters.js serve
```

默认地址:

```text
http://127.0.0.1:17373
```

可选参数:

```bash
node skills/ysir-headquarters/scripts/headquarters.js serve \
  --report .report \
  --host 127.0.0.1 \
  --port 17373
```

若只想检查 `.report` 扫描结果，可输出 JSON:

```bash
node skills/ysir-headquarters/scripts/headquarters.js data
```

## 页面内容

- 当前战况：进行中任务数、已归档任务数、异常数、最近更新时间。
- 任务导航：按进行中、已归档和异常筛选任务。
- 当前任务：任务目标摘要、`state.current`、当前阶段、进度与下一步边界。
- 状态时间线：展示 `state.json` 节点、状态、阶段和说明。
- 证据面板：测试报告、代码审查报告、提交/验收相关记录。
- 异常面板：缺少 `state.json`、状态解析失败、进行中任务没有 current 等问题。

## 约束

- 服务默认绑定 `127.0.0.1`，不要默认绑定 `0.0.0.0`。
- 页面和 API 只读取当前项目 `.report` 内的文件。
- 若 `.report` 不存在，页面应显示空状态，而不是报错退出。
- 本技能不要求其它 YSIR 流程自动调用；用户需要查看时手动启动即可。
