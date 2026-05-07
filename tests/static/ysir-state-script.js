#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "skills/ysir-state/scripts/state.js");
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  "skills/ysir-state/references/schemas/standard/schema.json"
);

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
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "ysir-state-static-"));
  const taskDir = path.join(fixtureDir, ".report/in-progress/2026-05-06-demo");
  const statePath = path.join(taskDir, "state.json");
  const errors = [];

  writeFile(path.join(taskDir, ".keep"), "");

  const init = run([
    "init",
    "--state",
    statePath,
    "--nodes",
    "setup-electron,implement-main-window,wire-storage,polish-settings",
    "--edges",
    "setup-electron>implement-main-window,implement-main-window>wire-storage,implement-main-window>polish-settings,wire-storage>polish-settings",
    "--schema",
    "none",
    "--current",
    "setup-electron",
  ], fixtureDir);
  assert(init.status === 0, `init failed:\n${init.stderr}`, errors);
  assert(fs.existsSync(statePath), "state.json should exist", errors);

  const duplicateInit = run([
    "init",
    "--state",
    path.join(taskDir, "duplicate-state.json"),
    "--nodes",
    "setup-electron,setup-electron",
    "--schema",
    "none",
  ], fixtureDir);
  assert(duplicateInit.status !== 0, "init should reject duplicate nodes", errors);

  const cycleInit = run([
    "init",
    "--state",
    path.join(taskDir, "cycle-state.json"),
    "--nodes",
    "setup-electron,implement-main-window,polish-settings",
    "--edges",
    "setup-electron>implement-main-window,implement-main-window>polish-settings,polish-settings>setup-electron",
    "--schema",
    "none",
  ], fixtureDir);
  assert(cycleInit.status !== 0, "init should reject cycles", errors);

  const advanceToMainWindow = run([
    "advance",
    "--state",
    statePath,
    "--note",
    "Electron 框架已搭建",
  ], fixtureDir);
  assert(advanceToMainWindow.status === 0, `advance failed:\n${advanceToMainWindow.stderr}`, errors);

  const ambiguousAdvance = run([
    "advance",
    "--state",
    statePath,
    "--note",
    "主窗口已完成",
  ], fixtureDir);
  assert(ambiguousAdvance.status !== 0, "advance should require --next when current has multiple successors", errors);

  const advanceToStorage = run([
    "advance",
    "--state",
    statePath,
    "--next",
    "wire-storage",
    "--note",
    "主窗口已完成",
  ], fixtureDir);
  assert(advanceToStorage.status === 0, `advance with --next failed:\n${advanceToStorage.stderr}`, errors);

  const advanceToPolish = run([
    "advance",
    "--state",
    statePath,
    "--note",
    "存储已完成",
  ], fixtureDir);
  assert(advanceToPolish.status === 0, `advance to terminal node failed:\n${advanceToPolish.stderr}`, errors);

  const terminalAdvance = run([
    "advance",
    "--state",
    statePath,
    "--note",
    "收尾已完成",
  ], fixtureDir);
  assert(terminalAdvance.status === 0, `terminal advance failed:\n${terminalAdvance.stderr}`, errors);

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(state.current === "", "current should be empty after terminal advance", errors);
  assert(state.nodes["setup-electron"].status === "completed", "setup-electron should be completed", errors);
  assert(state.nodes["implement-main-window"].status === "completed", "implement-main-window should be completed", errors);
  assert(state.nodes["wire-storage"].status === "completed", "wire-storage should be completed", errors);
  assert(state.nodes["polish-settings"].status === "completed", "polish-settings should be completed", errors);
  assert(state.edges.some((edge) => edge.from === "wire-storage" && edge.to === "polish-settings"), "wire-storage -> polish-settings edge should exist", errors);

  const schemaTaskDir = path.join(fixtureDir, ".report/in-progress/2026-05-06-schema-demo");
  const schemaStatePath = path.join(schemaTaskDir, "state.json");
  writeFile(path.join(schemaTaskDir, ".keep"), "");

  const schemaInit = run([
    "init",
    "--state",
    schemaStatePath,
    "--nodes",
    "setup-electron,implement-main-window,wire-storage",
    "--current",
    "setup-electron:develop",
  ], fixtureDir);
  assert(schemaInit.status === 0, `default schema init failed:\n${schemaInit.stderr}`, errors);
  assert(
    schemaInit.stdout.includes("currentObjective: 先使用 ysir-regulation 了解与本次行动相关的规范；然后根据当前计划阶段完成工程实现"),
    "schema init output should include regulation reading in current objective",
    errors
  );

  const schemaCycleStatePath = path.join(schemaTaskDir, "cycle-state.json");
  const schemaCycleInit = run([
    "init",
    "--state",
    schemaCycleStatePath,
    "--nodes",
    "setup-electron,implement-main-window",
    "--edges",
    "setup-electron>implement-main-window,implement-main-window>setup-electron",
    "--schema",
    SCHEMA_PATH,
    "--current",
    "setup-electron:develop",
  ], fixtureDir);
  assert(schemaCycleInit.status !== 0, "schema init should reject phase cycles", errors);

  const schemaState = JSON.parse(fs.readFileSync(schemaStatePath, "utf8"));
  assert(Object.keys(schemaState.nodes).length === 12, "schema init should expand 3 phases into 12 nodes", errors);
  assert(schemaState.schema.name === "standard", "schema name should be standard", errors);
  assert(schemaState.nodes["setup-electron:develop"].status === "current", "first expanded node should be current", errors);
  assert(schemaState.nodes["wire-storage:delivery-commit"].phase === "wire-storage", "expanded node should keep phase metadata", errors);
  assert(
    schemaState.nodes["setup-electron:acceptance-test"].template.endsWith("skills/ysir-state/references/schemas/standard/test.md"),
    "expanded node should include schema template path",
    errors
  );
  assert(
    schemaState.nodes["setup-electron:develop"].objective.includes("工程实现"),
    "expanded node should include schema objective",
    errors
  );
  assert(
    schemaState.edges.some((edge) => edge.from === "setup-electron:delivery-commit" && edge.to === "implement-main-window:develop"),
    "schema init should connect adjacent expanded phases",
    errors
  );

  const advanceSchemaToTest = run([
    "advance",
    "--state",
    schemaStatePath,
    "--note",
    "实现完成",
  ], fixtureDir);
  assert(advanceSchemaToTest.status === 0, `schema advance to test failed:\n${advanceSchemaToTest.stderr}`, errors);

  const advanceSchemaToReview = run([
    "advance",
    "--state",
    schemaStatePath,
    "--note",
    "测试通过",
  ], fixtureDir);
  assert(advanceSchemaToReview.status === 0, `schema advance to review failed:\n${advanceSchemaToReview.stderr}`, errors);

  const retrySchema = run([
    "retry",
    "--state",
    schemaStatePath,
    "--note",
    "代码审查发现结构问题，需要修改实现",
  ], fixtureDir);
  assert(retrySchema.status === 0, `schema retry failed:\n${retrySchema.stderr}`, errors);

  const retriedState = JSON.parse(fs.readFileSync(schemaStatePath, "utf8"));
  assert(retriedState.current === "setup-electron@2:develop", "retry should move current to next attempt start", errors);
  assert(retriedState.nodes["setup-electron:acceptance-review"].status === "failed", "retry should mark failed node", errors);
  assert(retriedState.nodes["setup-electron@2:develop"].status === "current", "retry start should be current", errors);
  assert(retriedState.nodes["setup-electron@2:develop"].attempt === 2, "retry nodes should include attempt metadata", errors);
  assert(retriedState.nodes["setup-electron@2:acceptance-review"].retryOf === "setup-electron:acceptance-review", "retry nodes should reference original node", errors);
  assert(
    retriedState.edges.some((edge) => edge.from === "setup-electron:acceptance-review" && edge.to === "setup-electron@2:develop"),
    "retry should connect failed node to next attempt start",
    errors
  );
  assert(
    retriedState.edges.some((edge) => edge.from === "setup-electron@2:delivery-commit" && edge.to === "implement-main-window:develop"),
    "retry should migrate phase successor edge to next attempt tail",
    errors
  );
  assert(
    !retriedState.edges.some((edge) => edge.from === "setup-electron:acceptance-review" && edge.to === "setup-electron:delivery-commit"),
    "retry should remove old failed node outgoing edge",
    errors
  );

  const rawRetry = run([
    "retry",
    "--state",
    statePath,
    "--note",
    "原始图不支持 retry",
  ], fixtureDir);
  assert(rawRetry.status !== 0, "retry should reject raw graphs without schema", errors);

  fs.rmSync(fixtureDir, { recursive: true, force: true });

  if (errors.length > 0) {
    console.error("YSIR state script test failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("YSIR state script test passed.");
}

main();
