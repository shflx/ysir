#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileExists,
  assertIncludes,
  cleanupFixture,
  createFixture,
  readFileIfExists,
  reportErrors,
  runAgent,
  writeFile,
} = require("./helpers");

const REPORT_PATH = ".report/inspect/2026-04-10-global.md";

function setupProject(projectDir) {
  writeFile(
    path.join(projectDir, ".report/design/proj.md"),
    [
      "## 项目定位",
      "",
      "- 一个最小 Node.js greeting 模块。",
      "",
      "## 设计约束",
      "",
      "- `src/greeting.js` 导出 `greet(name)`。",
      "- `greet(name)` 返回 `Hello, {name}!`。",
      "- 未传入姓名时返回 `Hello, world!`。",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-inspect-it",
        version: "1.0.0",
        type: "module",
      },
      null,
      2
    )}\n`
  );

  writeFile(
    path.join(projectDir, "src/greeting.js"),
    [
      "export function greet(name = \"world\") {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
    ].join("\n")
  );
}

async function main() {
  const testEnv = createFixture("ysir-inspect-it-", setupProject);
  const prompt = [
    `在当前项目中使用 $ysir-inspect 执行全局检查，并输出检查报告到 ${REPORT_PATH}。`,
    "这是专门对整个项目做质量审核；只对照 .report/design/proj.md 与当前实现。",
    "当前实现与设计一致；如无冲突，报告中说明无整改项即可，不要修改实现代码。",
    "当前是非交互集成测试；生成全局检查报告后退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const fullReportPath = path.join(testEnv.projectDir, REPORT_PATH);
  const reportContent = readFileIfExists(fullReportPath);
  const sourceContent = readFileIfExists(path.join(testEnv.projectDir, "src/greeting.js"));
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  assertFileExists(fullReportPath, REPORT_PATH, errors);
  assertIncludes(reportContent, "## 整改内容", REPORT_PATH, errors);
  assertIncludes(reportContent, "无", REPORT_PATH, errors);
  assertIncludes(sourceContent, "Hello, ${name}!", "src/greeting.js", errors);

  reportErrors("YSIR inspect integration test", errors, output, testEnv);
  console.log("YSIR inspect integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
