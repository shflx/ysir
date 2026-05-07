#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileExists,
  assertFileNotExists,
  assertIncludes,
  cleanupFixture,
  createFixture,
  readFileIfExists,
  reportErrors,
  runAgent,
  writeFile,
} = require("./helpers");

const TASK_DIR = ".report/in-progress/2026-04-10-greeting";

function setupProject(projectDir) {
  writeFile(
    path.join(projectDir, ".report/design/proj.md"),
    [
      "## 项目定位",
      "",
      "- 一个最小 Node.js CLI 项目。",
      "",
      "## 技术约束",
      "",
      "- 使用 Node.js 原生能力实现。",
      "- 需求梳理阶段不得编写代码。",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-order-it",
        version: "1.0.0",
        type: "module",
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const testEnv = createFixture("ysir-order-it-", setupProject);
  const orderPath = `${TASK_DIR}/order.md`;
  const prompt = [
    `在当前项目中使用 $ysir-order，将下面的完整需求整理为 ${orderPath}。`,
    "需求: 为 Node.js CLI 增加 --name 参数；传入 --name Ada 时输出 `Hello, Ada!`；未传入时输出 `Hello, world!`。",
    "验收: 覆盖传入姓名、未传姓名两个场景；需求梳理阶段只允许编辑文档，不允许编写实现代码。",
    "当前是非交互集成测试；信息已经完整，不要追问，直接输出需求文档后退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const fullOrderPath = path.join(testEnv.projectDir, orderPath);
  const orderContent = readFileIfExists(fullOrderPath);
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  assertFileExists(fullOrderPath, orderPath, errors);
  assertIncludes(orderContent, "## 任务目标", orderPath, errors);
  assertIncludes(orderContent, "## 已确认需求", orderPath, errors);
  assertIncludes(orderContent, "## 验收标准", orderPath, errors);
  assertIncludes(orderContent, "## 范围与约束", orderPath, errors);
  assertIncludes(orderContent, "## 关键上下文与未确认点", orderPath, errors);
  assertIncludes(orderContent, "--name", orderPath, errors);
  assertIncludes(orderContent, "Hello", orderPath, errors);
  assertFileNotExists(path.join(testEnv.projectDir, "src"), "src", errors);

  reportErrors("YSIR order integration test", errors, output, testEnv);
  console.log("YSIR order integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
