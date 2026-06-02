#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "skills/ysir-state/scripts/state.js");

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
  assert(
    schemaInit.stdout.includes("currentSubagent: true"),
    "schema init output should include current subagent mode",
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
    "standard",
    "--current",
    "setup-electron:develop",
  ], fixtureDir);
  assert(schemaCycleInit.status !== 0, "schema init should reject phase cycles", errors);

  const schemaState = JSON.parse(fs.readFileSync(schemaStatePath, "utf8"));
  assert(Object.keys(schemaState.nodes).length === 12, "schema init should expand 3 phases into 12 nodes", errors);
  assert(schemaState.schema.name === "standard", "schema name should be standard", errors);
  assert(!("path" in schemaState.schema), "schema state should not expose schema path", errors);
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
  assert(schemaState.nodes["setup-electron:develop"].subagent === true, "develop node should enable subagent mode", errors);
  assert(schemaState.nodes["setup-electron:delivery-commit"].subagent === false, "delivery commit node should disable subagent mode", errors);
  assert(
    schemaState.edges.some((edge) => edge.from === "setup-electron:delivery-commit" && edge.to === "implement-main-window:develop"),
    "schema init should connect adjacent expanded phases",
    errors
  );

  const tddStatePath = path.join(schemaTaskDir, "tdd-state.json");
  const tddInit = run([
    "init",
    "--state",
    tddStatePath,
    "--nodes",
    "implement-parser,render-summary",
    "--schema",
    "tdd",
  ], fixtureDir);
  assert(tddInit.status === 0, `tdd schema init failed:\n${tddInit.stderr}`, errors);

  const tddState = JSON.parse(fs.readFileSync(tddStatePath, "utf8"));
  assert(tddState.schema.name === "tdd", "tdd schema name should be tdd", errors);
  assert(Object.keys(tddState.nodes).length === 10, "tdd schema init should expand 2 phases into 10 nodes", errors);
  assert(tddState.current === "implement-parser:red-test", "tdd schema should start from red test", errors);
  assert(
    tddState.nodes["implement-parser:red-test"].objective.includes("最小可验证行为"),
    "tdd red stage should require one minimal behavior",
    errors
  );
  assert(tddState.nodes["implement-parser:red-test"].subagent === true, "tdd red stage should enable subagent mode", errors);
  assert(tddState.nodes["implement-parser:delivery-commit"].subagent === false, "tdd delivery commit should disable subagent mode", errors);
  assert(
    tddState.edges.some((edge) => edge.from === "implement-parser:red-test" && edge.to === "implement-parser:green-implementation"),
    "tdd schema should connect red to green",
    errors
  );
  assert(
    tddState.edges.some((edge) => edge.from === "implement-parser:green-implementation" && edge.to === "implement-parser:refactor"),
    "tdd schema should connect green to refactor",
    errors
  );
  assert(
    tddState.edges.some((edge) => edge.from === "implement-parser:delivery-commit" && edge.to === "render-summary:red-test"),
    "tdd schema should connect phase tail to next phase red test",
    errors
  );

  for (const note of ["失败测试已确认", "最小实现已通过", "重构后测试通过"]) {
    const advance = run([
      "advance",
      "--state",
      tddStatePath,
      "--note",
      note,
    ], fixtureDir);
    assert(advance.status === 0, `tdd advance failed:\n${advance.stderr}`, errors);
  }

  const nextAttemptTdd = run([
    "next-attempt",
    "--state",
    tddStatePath,
    "--status",
    "completed",
    "--note",
    "继续下一个最小行为",
  ], fixtureDir);
  assert(nextAttemptTdd.status === 0, `tdd next-attempt failed:\n${nextAttemptTdd.stderr}`, errors);

  const nextAttemptedTddState = JSON.parse(fs.readFileSync(tddStatePath, "utf8"));
  assert(nextAttemptedTddState.current === "implement-parser@2:red-test", "tdd next-attempt should move current to next attempt red test", errors);
  assert(nextAttemptedTddState.nodes["implement-parser:quality-review"].status === "completed", "tdd next-attempt should mark current node with provided status", errors);
  assert(nextAttemptedTddState.nodes["implement-parser@2:red-test"].subagent === true, "tdd next-attempt should preserve subagent mode on new nodes", errors);
  assert(
    nextAttemptedTddState.edges.some((edge) => edge.from === "implement-parser:quality-review" && edge.to === "implement-parser@2:red-test"),
    "tdd next-attempt should connect current node to next attempt red test",
    errors
  );
  assert(
    nextAttemptedTddState.edges.some((edge) => edge.from === "implement-parser@2:delivery-commit" && edge.to === "render-summary:red-test"),
    "tdd next-attempt should migrate phase successor edge to next attempt tail",
    errors
  );
  assert(
    !nextAttemptedTddState.edges.some((edge) => edge.from === "implement-parser:quality-review" && edge.to === "implement-parser:delivery-commit"),
    "tdd next-attempt should remove old current outgoing edge",
    errors
  );

  const legacySchemaStatePath = path.join(schemaTaskDir, "legacy-schema-path-state.json");
  const legacySchemaState = JSON.parse(JSON.stringify(schemaState));
  legacySchemaState.schema.path = "skills/ysir-state/references/schemas/standard/schema.json";
  writeFile(legacySchemaStatePath, `${JSON.stringify(legacySchemaState, null, 2)}\n`);
  for (const note of ["实现完成", "测试通过"]) {
    const advance = run([
      "advance",
      "--state",
      legacySchemaStatePath,
      "--note",
      note,
    ], fixtureDir);
    assert(advance.status === 0, `legacy schema advance failed:\n${advance.stderr}`, errors);
  }
  const nextAttemptLegacySchema = run([
    "next-attempt",
    "--state",
    legacySchemaStatePath,
    "--status",
    "failed",
    "--note",
    "旧 state.json 仍可按 schema.name 追加 attempt",
  ], fixtureDir);
  assert(nextAttemptLegacySchema.status === 0, `legacy schema next-attempt failed:\n${nextAttemptLegacySchema.stderr}`, errors);

  const humanAcceptanceStatePath = path.join(schemaTaskDir, "human-acceptance-state.json");
  const humanAcceptanceInit = run([
    "init",
    "--state",
    humanAcceptanceStatePath,
    "--nodes",
    "setup-electron,implement-main-window",
    "--human-acceptance",
    "true",
  ], fixtureDir);
  assert(humanAcceptanceInit.status === 0, `human acceptance init failed:\n${humanAcceptanceInit.stderr}`, errors);
  assert(
    humanAcceptanceInit.stdout.includes("currentStage: develop"),
    "show output should include current stage",
    errors
  );

  const humanAcceptanceState = JSON.parse(fs.readFileSync(humanAcceptanceStatePath, "utf8"));
  assert(Object.keys(humanAcceptanceState.nodes).length === 10, "human acceptance init should add one node per phase", errors);
  assert(humanAcceptanceState.humanAcceptance === true, "state should record human acceptance option", errors);
  assert(
    humanAcceptanceState.nodes["setup-electron:human-acceptance"].stage === "human-acceptance",
    "human acceptance node should use stage metadata",
    errors
  );
  assert(
    humanAcceptanceState.nodes["setup-electron:human-acceptance"].subagent === false,
    "human acceptance node should disable subagent mode",
    errors
  );
  assert(
    humanAcceptanceState.edges.some((edge) => edge.from === "setup-electron:delivery-commit" && edge.to === "setup-electron:human-acceptance"),
    "human acceptance should follow phase delivery",
    errors
  );
  assert(
    humanAcceptanceState.edges.some((edge) => edge.from === "setup-electron:human-acceptance" && edge.to === "implement-main-window:develop"),
    "phase transition should start from human acceptance node",
    errors
  );

  for (const note of ["实现完成", "测试通过", "审查通过", "提交完成"]) {
    const advance = run([
      "advance",
      "--state",
      humanAcceptanceStatePath,
      "--note",
      note,
    ], fixtureDir);
    assert(advance.status === 0, `human acceptance advance failed:\n${advance.stderr}`, errors);
  }

  const nextAttemptHumanAcceptance = run([
    "next-attempt",
    "--state",
    humanAcceptanceStatePath,
    "--status",
    "failed",
    "--note",
    "用户验收不通过，需要返工",
  ], fixtureDir);
  assert(nextAttemptHumanAcceptance.status === 0, `human acceptance next-attempt failed:\n${nextAttemptHumanAcceptance.stderr}`, errors);

  const nextAttemptedHumanAcceptanceState = JSON.parse(fs.readFileSync(humanAcceptanceStatePath, "utf8"));
  assert(
    nextAttemptedHumanAcceptanceState.current === "setup-electron@2:develop",
    "human acceptance next-attempt should move current to next attempt start",
    errors
  );
  assert(
    nextAttemptedHumanAcceptanceState.nodes["setup-electron:human-acceptance"].status === "failed",
    "human acceptance next-attempt should mark failed acceptance node",
    errors
  );
  assert(
    nextAttemptedHumanAcceptanceState.nodes["setup-electron@2:human-acceptance"].stage === "human-acceptance",
    "human acceptance next-attempt should add acceptance node to next attempt",
    errors
  );
  assert(
    nextAttemptedHumanAcceptanceState.edges.some((edge) => edge.from === "setup-electron@2:delivery-commit" && edge.to === "setup-electron@2:human-acceptance"),
    "human acceptance next-attempt should keep acceptance after next attempt delivery",
    errors
  );
  assert(
    nextAttemptedHumanAcceptanceState.edges.some((edge) => edge.from === "setup-electron@2:human-acceptance" && edge.to === "implement-main-window:develop"),
    "human acceptance next-attempt should migrate phase successor edge to next attempt acceptance",
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

  const nextAttemptSchema = run([
    "next-attempt",
    "--state",
    schemaStatePath,
    "--status",
    "failed",
    "--note",
    "代码审查发现结构问题，需要修改实现",
  ], fixtureDir);
  assert(nextAttemptSchema.status === 0, `schema next-attempt failed:\n${nextAttemptSchema.stderr}`, errors);

  const nextAttemptedState = JSON.parse(fs.readFileSync(schemaStatePath, "utf8"));
  assert(nextAttemptedState.current === "setup-electron@2:develop", "next-attempt should move current to next attempt start", errors);
  assert(nextAttemptedState.nodes["setup-electron:acceptance-review"].status === "failed", "next-attempt should mark current node with provided status", errors);
  assert(nextAttemptedState.nodes["setup-electron@2:develop"].status === "current", "next-attempt start should be current", errors);
  assert(nextAttemptedState.nodes["setup-electron@2:develop"].attempt === 2, "next-attempt nodes should include attempt metadata", errors);
  assert(nextAttemptedState.nodes["setup-electron@2:develop"].subagent === true, "next-attempt nodes should preserve subagent mode", errors);
  assert(nextAttemptedState.nodes["setup-electron@2:acceptance-review"].attemptOf === "setup-electron:acceptance-review", "next-attempt nodes should reference original node", errors);
  assert(
    nextAttemptedState.edges.some((edge) => edge.from === "setup-electron:acceptance-review" && edge.to === "setup-electron@2:develop"),
    "next-attempt should connect current node to next attempt start",
    errors
  );
  assert(
    nextAttemptedState.edges.some((edge) => edge.from === "setup-electron@2:delivery-commit" && edge.to === "implement-main-window:develop"),
    "next-attempt should migrate phase successor edge to next attempt tail",
    errors
  );
  assert(
    !nextAttemptedState.edges.some((edge) => edge.from === "setup-electron:acceptance-review" && edge.to === "setup-electron:delivery-commit"),
    "next-attempt should remove old current outgoing edge",
    errors
  );

  const rawNextAttempt = run([
    "next-attempt",
    "--state",
    statePath,
    "--status",
    "failed",
    "--note",
    "原始图不支持 next-attempt",
  ], fixtureDir);
  assert(rawNextAttempt.status !== 0, "next-attempt should reject raw graphs without schema", errors);

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
