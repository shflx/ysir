#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "skills/ysir-headquarters/scripts/headquarters.js");

function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function main() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "ysir-headquarters-"));
  const taskDir = path.join(fixtureDir, ".report/in-progress/2026-05-18-demo");
  const doneDir = path.join(fixtureDir, ".report/done/2026-05-17-finished");
  const errors = [];

  writeFile(
    path.join(fixtureDir, ".report/design/proj.md"),
    [
      "# Project",
      "",
      "## 项目定位",
      "",
      "- 一个测试项目。",
      "",
    ].join("\n")
  );
  writeFile(
    path.join(taskDir, "order.md"),
    [
      "## 任务目标",
      "",
      "- 实现 Headquarters 大屏。",
      "",
      "## 验收标准",
      "",
      "- 能展示状态和证据。",
      "",
    ].join("\n")
  );
  writeFile(
    path.join(taskDir, "plan.md"),
    [
      "## 方案目标",
      "",
      "- 动态读取 .report。",
      "",
    ].join("\n")
  );
  writeFile(path.join(taskDir, "access.md"), "# 访问文档\n\n本地访问地址：http://127.0.0.1:17373\n");
  writeFile(
    path.join(taskDir, "state.json"),
    `${JSON.stringify(
      {
        version: 1,
        current: "build-ui:develop",
        schema: { name: "standard" },
        nodes: {
          "build-ui:develop": {
            id: "build-ui:develop",
            phase: "build-ui",
            stage: "develop",
            label: "开发",
            status: "current",
            note: "",
            objective: "实现动态网站",
          },
          "build-ui:acceptance-test": {
            id: "build-ui:acceptance-test",
            phase: "build-ui",
            stage: "acceptance-test",
            label: "验收：测试",
            status: "failed",
            note: "首次测试失败",
          },
          "build-ui@2:acceptance-test": {
            id: "build-ui@2:acceptance-test",
            phase: "build-ui",
            stage: "acceptance-test",
            label: "验收：测试",
            status: "completed",
            note: "重测通过",
          },
        },
        edges: [
          { from: "build-ui:develop", to: "build-ui:acceptance-test" },
          { from: "build-ui:acceptance-test", to: "build-ui@2:acceptance-test" },
        ],
        history: [
          {
            node: "build-ui:acceptance-test",
            status: "completed",
            note: "测试通过",
            at: "2026-05-18T10:10:00.000Z",
          },
          {
            node: "build-ui:develop",
            status: "completed",
            note: "开发完成",
            at: "2026-05-18T10:00:00.000Z",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  writeFile(path.join(taskDir, "test-round-1.md"), "# 测试报告\n\n通过。\n");
  writeFile(path.join(doneDir, "order.md"), "## 任务目标\n\n- 已完成任务。\n");

  const data = run(["data"], fixtureDir);
  assert(data.status === 0, `data command failed:\n${data.stderr}`, errors);

  const dashboard = JSON.parse(data.stdout);
  assert(dashboard.summary.inProgress === 1, "should count one in-progress task", errors);
  assert(dashboard.summary.done === 1, "should count one done task", errors);
  assert(dashboard.summary.evidence === 5, "should count task documents and test evidence", errors);
  assert(dashboard.activeTaskId === "in-progress/2026-05-18-demo", "should pick active in-progress task", errors);

  const task = dashboard.tasks.find((item) => item.id === "in-progress/2026-05-18-demo");
  assert(task, "active task should exist", errors);
  assert(task.stateCurrent === "build-ui:develop", "should read state current", errors);
  assert(task.nodes.length === 3, "should normalize state nodes", errors);
  assert(task.progress.total === 2, "progress should use latest logical nodes instead of obsolete failed attempts", errors);
  assert(task.progress.percent === 50, "current progress should ignore obsolete failed attempts", errors);
  assert(task.progress.failed === 0, "fixed failed nodes should not count as unresolved failures", errors);
  assert(task.anomalies.length === 0, "fixed failed nodes should not create task anomalies", errors);
  assert(task.evidence.some((item) => item.name === "order.md" && item.type === "需求"), "should collect order.md as requirement evidence", errors);
  assert(task.evidence.some((item) => item.name === "plan.md" && item.type === "方案"), "should collect plan.md as plan evidence", errors);
  assert(task.evidence.some((item) => item.name === "access.md" && item.type === "访问"), "should collect access documents as evidence", errors);
  assert(task.evidence.some((item) => item.name === "test-round-1.md" && item.type === "测试"), "should collect test evidence", errors);
  assert(task.goal.includes("Headquarters"), "should extract task goal", errors);
  assert(task.orderUpdatedAt > 0, "should expose order.md timestamp for history notes", errors);
  assert(task.planUpdatedAt > 0, "should expose plan.md timestamp for history notes", errors);
  assert(task.history[0].node === "build-ui:develop", "history should be exposed in chronological order", errors);
  assert(task.history[1].node === "build-ui:acceptance-test", "history should keep later events after earlier events", errors);

  const scriptSource = fs.readFileSync(SCRIPT_PATH, "utf8");
  assert(scriptSource.includes("function evidenceTypeFromFileName"), "evidence collection should classify report documents", errors);
  assert(scriptSource.includes('fileName === "order.md"'), "evidence should include requirement documents", errors);
  assert(scriptSource.includes('fileName === "plan.md"'), "evidence should include plan documents", errors);
  assert(scriptSource.includes('label: "需求确认"'), "timeline order card should use a readable Chinese label", errors);
  assert(scriptSource.includes('label: "方案确认"'), "timeline plan card should use a readable Chinese label", errors);
  assert(scriptSource.includes("const stages = historyNodes(task);"), "timeline meta should use history-derived nodes", errors);
  assert(scriptSource.includes("次返工"), "timeline meta should summarize fixed historical failures as rework", errors);
  assert(scriptSource.includes("summary-pill"), "timeline meta should render styled summary pills", errors);
  assert(!scriptSource.includes("节点完成"), "timeline meta should not use misleading fraction-style node completion text", errors);
  assert(scriptSource.includes("History Notes"), "middle panel should label history note flow", errors);
  assert(!scriptSource.includes("Schema 路线"), "schema rail should be merged into current overview without a separate title", errors);
  assert(!scriptSource.includes("schema-layer"), "schema rail should not render as a separate middle panel layer", errors);
  assert(!scriptSource.includes("schema-meta"), "schema rail should not keep a separate section meta element", errors);
  assert(scriptSource.includes('["completed", "failed"].includes(item.status)'), "history notes should show completed and failed events", errors);
  assert(scriptSource.includes(".activity-item.failed"), "history notes should visually distinguish failed events", errors);
  assert(scriptSource.includes('result: "需求确认完成"'), "history notes should include order completion", errors);
  assert(scriptSource.includes('result: "方案确认完成"'), "history notes should include plan completion", errors);
  assert(scriptSource.includes("latestNodeForStage(task, key)"), "schema rail should summarize latest node status per stage", errors);
  assert(scriptSource.includes("const history = [...(task?.history || [])].sort((left, right) => toMillis(left.at) - toMillis(right.at));"), "history nodes should be built from chronological events", errors);
  assert(!scriptSource.includes('id="files-list"'), "right rail should not render the recent files panel", errors);
  assert(!scriptSource.includes('id="files-count"'), "right rail should not render the recent files count", errors);
  assert(!scriptSource.includes("data-filter-jump"), "left sidebar should not render the show-all task shortcut", errors);
  assert(!scriptSource.includes("＋ 新建"), "left sidebar task list should not render the new-task shortcut", errors);
  assert(!scriptSource.includes("task-meta-row"), "left sidebar task cards should not render the bottom metadata block", errors);
  assert(scriptSource.includes("-webkit-line-clamp: 2;"), "active task copy should be clamped so long text does not push history notes down", errors);
  assert(scriptSource.includes('$("active-goal").title = activeGoal;'), "active task copy should preserve full text in a hover title", errors);
  assert(scriptSource.includes("grid-template-rows: minmax(140px, auto) minmax(0, 1fr);"), "history nodes should use compact content height and leave more room for history notes", errors);
  assert(scriptSource.includes("height: 100px;"), "history node cards should keep a small bottom breathing space", errors);
  assert(scriptSource.includes("padding: 10px 10px 12px;"), "history node cards should keep a small bottom padding", errors);
  assert(!scriptSource.includes("activity-meta-line"), "history notes should not render artifact chips in the middle column", errors);
  assert(!scriptSource.includes("activity-chip"), "history notes should not render artifact chips", errors);
  assert(!scriptSource.includes("没有发现明显异常"), "anomaly panel should stay blank when there are no anomalies", errors);
  assert(!scriptSource.includes(">主题<"), "top bar should not render an inert theme tag", errors);
  assert(!scriptSource.includes("系统正常"), "top bar should not render an inert system status tag", errors);
  assert(!scriptSource.includes("⌘K"), "search box should not render an inert keyboard shortcut hint", errors);
  assert(!scriptSource.includes("▽</span>筛选"), "filter heading should not repeat the filter affordance icon", errors);
  assert(!scriptSource.includes("<span>›</span></div>"), "filter heading should not render an inert collapse arrow", errors);
  assert(scriptSource.includes("height: 34px;"), "project selector should be more compact", errors);
  assert(scriptSource.includes("▤ 任务概览"), "overview panel should use the task overview title", errors);
  assert(scriptSource.includes("const task = activeTask();"), "right rail should derive evidence and anomalies from the active task", errors);
  assert(scriptSource.includes("task.evidence.map"), "right rail evidence should follow the active task", errors);
  assert(scriptSource.includes("task.anomalies.map"), "right rail anomalies should follow the active task", errors);
  assert(scriptSource.includes("grid-template-rows: auto minmax(0, 1fr);"), "left sidebar should let filters fit content and task list fill remaining space", errors);
  assert(scriptSource.includes("sidebar-filter-area"), "left sidebar should group search and filters into a scrollable area", errors);
  assert(scriptSource.includes("sidebar-task-area"), "left sidebar should group the task header and task list into a scrollable area", errors);
  assert(scriptSource.includes("max-height: 178px;"), "left filter area should stay compact while remaining scrollable", errors);
  assert(scriptSource.includes("overflow-y: auto;"), "task list should support vertical scrolling when there are many tasks", errors);
  assert(scriptSource.includes("filteredTasks().slice().sort((left, right) => right.updatedAt - left.updatedAt)"), "task list should render newest tasks first", errors);
  assert(scriptSource.includes(".sort((left, right) => right.updatedAt - left.updatedAt);"), "markdown files should be sorted by mtime", errors);
  assert(scriptSource.includes("].filter(Boolean).sort((left, right) => right.at - left.at);"), "activity feed should show recent rows first", errors);

  const emptyFixture = fs.mkdtempSync(path.join(os.tmpdir(), "ysir-headquarters-empty-"));
  const emptyData = run(["data"], emptyFixture);
  assert(emptyData.status === 0, `empty data command failed:\n${emptyData.stderr}`, errors);
  const emptyDashboard = JSON.parse(emptyData.stdout);
  assert(emptyDashboard.project.reportExists === false, "missing .report should be a clean empty state", errors);

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.rmSync(emptyFixture, { recursive: true, force: true });

  if (errors.length > 0) {
    console.error("YSIR headquarters script test failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("YSIR headquarters script test passed.");
}

main();
