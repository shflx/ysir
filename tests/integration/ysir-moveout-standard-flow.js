#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileNotExists,
  assertIncludes,
  assertMatches,
  assertNotIncludes,
  cleanupFixture,
  createFixture,
  readFileIfExists,
  reportErrors,
  runAgent,
  runCommand,
  writeFile,
} = require("./helpers");

const FIXED_DATE = "2026-04-10";
const TASK_SLUG = "calc";
const TASK_DIR = `.report/in-progress/${FIXED_DATE}-${TASK_SLUG}`;

function setupProject(projectDir) {
  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-moveout-it",
        version: "1.0.0",
        type: "module",
        scripts: {
          test: "node --test",
        },
      },
      null,
      2
    )}\n`
  );

  writeFile(path.join(projectDir, "src/calc.js"), "export const placeholder = true;\n");

  writeFile(
    path.join(projectDir, ".report/design/proj.md"),
    [
      "## 项目定位",
      "",
      "- 用于验证 ysir-moveout 状态图执行器的最小项目。",
      "",
      "## 技术选型",
      "",
      "- Node.js",
      "- node:test",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, `${TASK_DIR}/order.md`),
    [
      "## 任务目标",
      "",
      "- 为 `src/calc.js` 增加基础计算函数。",
      "",
      "## 验收标准",
      "",
      "- 第一个迭代只交付 `add(a, b)` 及其测试。",
      "- 第二个迭代交付 `multiply(a, b)` 及其测试。",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, `${TASK_DIR}/plan.md`),
    [
      "## 方案目标",
      "",
      "- 使用 `src/calc.js` 导出计算函数。",
      "",
      "## 分迭代的实现计划",
      "",
      "### 迭代 1: add",
      "",
      "- 目标: 新增 `add(a, b)`。",
      "- 改动: `src/calc.js`",
      "- 验证: 当前节点只负责开发，不执行测试。",
      "",
      "### 迭代 2: multiply",
      "",
      "- 目标: 新增 `multiply(a, b)`。",
      "- 改动: `src/calc.js`",
      "",
      "## 状态图初始化",
      "",
      "- state: `.report/in-progress/2026-04-10-calc/state.json`",
      "- nodes: add,multiply",
      "- edges: add>multiply",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, `${TASK_DIR}/state.json`),
    `${JSON.stringify(
      {
        version: 1,
        current: "add:develop",
        schema: {
          name: "standard",
        },
        nodes: {
          "add:develop": {
            id: "add:develop",
            phase: "add",
            stage: "develop",
            label: "开发",
            status: "current",
            note: "",
          },
          "add:acceptance-test": {
            id: "add:acceptance-test",
            phase: "add",
            stage: "acceptance-test",
            label: "验收：测试",
            template: "skills/ysir-state/references/schemas/standard/test.md",
            status: "pending",
            note: "",
          },
          "multiply:develop": {
            id: "multiply:develop",
            phase: "multiply",
            stage: "develop",
            label: "开发",
            status: "pending",
            note: "",
          },
        },
        edges: [
          {
            from: "add:develop",
            to: "add:acceptance-test",
          },
          {
            from: "add:acceptance-test",
            to: "multiply:develop",
          },
        ],
        history: [],
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const testEnv = createFixture("ysir-moveout-it-", setupProject);
  const prompt = [
    `在当前项目中使用 $ysir-moveout 执行 ${TASK_DIR}/state.json 的当前节点。`,
    "当前节点是 add:develop，只负责实现 add(a, b)；不要执行测试节点、不要创建测试报告或代码审查报告、不要提交代码。",
    "当前是非交互集成测试；完成当前节点后更新 state.json 到下一个节点并退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const calcSource = readFileIfExists(path.join(testEnv.projectDir, "src/calc.js"));
  const calcTest = readFileIfExists(path.join(testEnv.projectDir, "test/calc.test.js"));
  const testReportPath = path.join(testEnv.projectDir, `${TASK_DIR}/test-round-1.md`);
  const codeReviewPath = path.join(testEnv.projectDir, `${TASK_DIR}/cr-round-1.md`);
  const stateContent = readFileIfExists(path.join(testEnv.projectDir, `${TASK_DIR}/state.json`));
  const gitStatus = runCommand("git", ["status", "--short"], { cwd: testEnv.projectDir });
  const gitLog = runCommand("git", ["log", "--oneline"], { cwd: testEnv.projectDir });
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  // 状态图执行器只完成当前节点，不跨入测试、审查或下一开发阶段。
  assertIncludes(calcSource, "add", "src/calc.js", errors);
  assertNotIncludes(calcSource, "multiply", "src/calc.js", errors);
  assertNotIncludes(calcTest, "add", "test/calc.test.js", errors);
  assertMatches(stateContent, /"current":\s*"add:acceptance-test"/, `${TASK_DIR}/state.json`, errors);
  assertMatches(stateContent, /"add:develop"[\s\S]*"status":\s*"completed"/, `${TASK_DIR}/state.json`, errors);

  assertFileNotExists(testReportPath, `${TASK_DIR}/test-round-1.md`, errors);
  assertFileNotExists(codeReviewPath, `${TASK_DIR}/cr-round-1.md`, errors);
  assertNotIncludes(gitLog, "add(a, b)", "git log", errors);
  assertMatches(gitStatus, /src\/calc\.js|state\.json/, "git status", errors);
  assertFileNotExists(path.join(testEnv.projectDir, ".report/inspect"), ".report/inspect", errors);
  assertFileNotExists(path.join(testEnv.projectDir, ".report/done"), ".report/done", errors);

  reportErrors("YSIR moveout standard flow integration test", errors, output, testEnv);
  console.log("YSIR moveout standard flow integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
