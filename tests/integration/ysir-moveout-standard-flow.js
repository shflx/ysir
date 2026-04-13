#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileExists,
  assertFileNotExists,
  assertIncludes,
  assertMatches,
  assertNotIncludes,
  assertNotMatches,
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
      "- 用于验证 ysir-moveout 标准实现流程的最小项目。",
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
      "## 需求描述",
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
      "## 实现思路",
      "",
      "- 使用 `src/calc.js` 导出计算函数。",
      "- 使用 `node:test` 编写单元测试。",
      "",
      "## 预期改动范围",
      "",
      "- `src/calc.js`",
      "- `test/calc.test.js`",
      "",
      "## 分迭代的实现计划",
      "",
      "- 迭代1: 新增 `add(a, b)`，包含实现、单元测试和验证。",
      "",
      "- 迭代2: 新增 `multiply(a, b)`，包含实现、单元测试和验证。",
      "",
      "## 已完成列表",
      "",
    ].join("\n")
  );
}

async function main() {
  const testEnv = createFixture("ysir-moveout-it-", setupProject);
  const prompt = [
    `在当前项目中使用 $ysir-moveout 执行 ${TASK_DIR}/plan.md。`,
    "严格遵循技能要求和计划文档。",
    "只执行计划中的第一个未完成迭代，不要进入后续迭代。",
    // 非交互测试没有用户验收输入，必须把“请求验收”作为退出点。
    "当前是非交互集成测试；到达人工验收节点时，请在最终回复中请求用户验收并立即退出，不要等待输入、不要提交代码。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const calcSource = readFileIfExists(path.join(testEnv.projectDir, "src/calc.js"));
  const calcTest = readFileIfExists(path.join(testEnv.projectDir, "test/calc.test.js"));
  const planContent = readFileIfExists(path.join(testEnv.projectDir, `${TASK_DIR}/plan.md`));
  const testReportPath = path.join(testEnv.projectDir, `${TASK_DIR}/test-round-1.md`);
  const codeReviewPath = path.join(testEnv.projectDir, `${TASK_DIR}/cr-round-1.md`);
  const testReport = readFileIfExists(testReportPath);
  const codeReview = readFileIfExists(codeReviewPath);
  const gitStatus = runCommand("git", ["status", "--short"], { cwd: testEnv.projectDir });
  const gitLog = runCommand("git", ["log", "--oneline"], { cwd: testEnv.projectDir });
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  // 标准流程验收点：完成当前迭代闭环，但不能提交、归档或进入后续迭代。
  assertIncludes(calcSource, "add", "src/calc.js", errors);
  assertIncludes(calcTest, "add", "test/calc.test.js", errors);
  assertNotIncludes(calcSource, "multiply", "src/calc.js", errors);
  assertNotIncludes(calcTest, "multiply", "test/calc.test.js", errors);
  assertMatches(output, /验收|确认/, "agent output", errors);

  assertFileExists(testReportPath, `${TASK_DIR}/test-round-1.md`, errors);
  assertFileExists(codeReviewPath, `${TASK_DIR}/cr-round-1.md`, errors);
  assertIncludes(testReport, "## 遗留缺陷", `${TASK_DIR}/test-round-1.md`, errors);
  assertIncludes(testReport, "## 结论", `${TASK_DIR}/test-round-1.md`, errors);
  assertIncludes(testReport, "add", `${TASK_DIR}/test-round-1.md`, errors);
  assertNotIncludes(testReport, "multiply(a, b)` 的实现", `${TASK_DIR}/test-round-1.md`, errors);
  assertIncludes(codeReview, "## 问题汇总", `${TASK_DIR}/cr-round-1.md`, errors);
  assertIncludes(codeReview, "## 审查总结", `${TASK_DIR}/cr-round-1.md`, errors);

  assertMatches(planContent, /已完成列表[\s\S]*迭代1/, `${TASK_DIR}/plan.md`, errors);
  assertNotMatches(planContent, /已完成列表[\s\S]*迭代2/, `${TASK_DIR}/plan.md`, errors);
  assertNotIncludes(gitLog, "add(a, b)", "git log", errors);
  assertMatches(gitStatus, /src\/calc\.js|test\/calc\.test\.js/, "git status", errors);
  assertFileNotExists(path.join(testEnv.projectDir, ".report/inspect"), ".report/inspect", errors);
  assertFileNotExists(path.join(testEnv.projectDir, ".report/done"), ".report/done", errors);

  try {
    runCommand(process.execPath, ["--test"], { cwd: testEnv.projectDir });
  } catch (error) {
    errors.push(`node --test failed:\n${error.message}`);
  }

  reportErrors("YSIR moveout standard flow integration test", errors, output, testEnv);
  console.log("YSIR moveout standard flow integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
