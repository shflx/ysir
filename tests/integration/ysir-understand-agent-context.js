#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileNotExists,
  assertIncludes,
  assertNotIncludes,
  cleanupFixture,
  createFixture,
  readFileIfExists,
  reportErrors,
  runAgent,
  runCommand,
  writeFile,
} = require("./helpers");

function setupProject(projectDir) {
  writeFile(
    path.join(projectDir, "README.md"),
    [
      "# Greeting Tool",
      "",
      "一个最小 Node.js greeting 模块。",
      "",
      "## 验证",
      "",
      "```bash",
      "node --test",
      "```",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-understand-it",
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

  writeFile(
    path.join(projectDir, ".report/design/proj.md"),
    [
      "## 项目定位",
      "",
      "- 提供 `greet(name)` greeting 函数。",
      "",
      "## 技术选型",
      "",
      "- Node.js",
      "- node:test",
      "",
    ].join("\n")
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
  const testEnv = createFixture("ysir-understand-it-", setupProject);
  writeFile(
    path.join(testEnv.projectDir, "src/greeting.js"),
    [
      "export function greet(name = \"friend\") {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
    ].join("\n")
  );

  const prompt = [
    "在当前项目中使用 $ysir-understand 理解项目，输出 Coding Agent 可继续使用的 Agent Context。",
    "当前是非交互集成测试；默认只读，不要保存文档，不要修改任何文件，输出后退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const sourceContent = readFileIfExists(path.join(testEnv.projectDir, "src/greeting.js"));
  const gitStatus = runCommand("git", ["status", "--short"], { cwd: testEnv.projectDir });
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  assertIncludes(output, "Agent Context", "agent output", errors);
  assertIncludes(output, "## 读取范围", "agent output", errors);
  assertIncludes(output, "## 项目与现状", "agent output", errors);
  assertIncludes(output, "## 当前任务状态", "agent output", errors);
  assertIncludes(output, "## 目录与模块地图", "agent output", errors);
  assertIncludes(output, "## 工作区最新变更", "agent output", errors);
  assertIncludes(output, "接手优先入口", "agent output", errors);
  assertIncludes(output, "dirty", "agent output", errors);
  assertIncludes(output, "Node.js", "agent output", errors);
  assertIncludes(sourceContent, "friend", "src/greeting.js", errors);
  assertIncludes(gitStatus, "src/greeting.js", "git status", errors);
  assertFileNotExists(path.join(testEnv.projectDir, ".report/understand"), ".report/understand", errors);
  assertNotIncludes(output, "实现计划", "agent output", errors);

  reportErrors("YSIR understand integration test", errors, output, testEnv);
  console.log("YSIR understand integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
