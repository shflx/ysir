#!/usr/bin/env node

"use strict";

const path = require("node:path");

const {
  assertFileExists,
  assertIncludes,
  assertNotIncludes,
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
      "- 使用 Node.js 原生能力实现命令行参数解析。",
      "- 使用 node:test 编写单元测试。",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, `${TASK_DIR}/order.md`),
    [
      "## 需求描述",
      "",
      "- 为 Node.js CLI 增加 `--name` 参数。",
      "- 传入 `--name Ada` 时输出 `Hello, Ada!`。",
      "- 未传入 `--name` 时输出 `Hello, world!`。",
      "",
      "## 验收标准",
      "",
      "- 覆盖传入姓名时的输出。",
      "- 覆盖未传姓名时的默认输出。",
      "",
    ].join("\n")
  );

  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-plan-it",
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

  writeFile(path.join(projectDir, "src/cli.js"), "export function main() {}\n");
}

async function main() {
  const testEnv = createFixture("ysir-plan-it-", setupProject);
  const planPath = `${TASK_DIR}/plan.md`;
  const prompt = [
    `在当前项目中使用 $ysir-plan，根据 ${TASK_DIR}/order.md 生成 ${planPath}。`,
    "当前是非交互集成测试；信息已经足够，不要追问。",
    "只允许编辑方案文档，不要修改实现代码或测试代码；生成后退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const fullPlanPath = path.join(testEnv.projectDir, planPath);
  const planContent = readFileIfExists(fullPlanPath);
  const cliSource = readFileIfExists(path.join(testEnv.projectDir, "src/cli.js"));
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  assertFileExists(fullPlanPath, planPath, errors);
  assertIncludes(planContent, "## 方案目标", planPath, errors);
  assertIncludes(planContent, "## 输入依据", planPath, errors);
  assertIncludes(planContent, "## 实现策略", planPath, errors);
  assertIncludes(planContent, "## 执行方法", planPath, errors);
  assertIncludes(planContent, "## 改动范围", planPath, errors);
  assertIncludes(planContent, "## 验证策略", planPath, errors);
  assertIncludes(planContent, "## 分迭代的实现计划", planPath, errors);
  assertIncludes(planContent, "## 风险与注意事项", planPath, errors);
  assertIncludes(planContent, "## 状态图初始化", planPath, errors);
  assertIncludes(planContent, "--name", planPath, errors);
  assertIncludes(planContent, "测试", planPath, errors);
  assertIncludes(cliSource, "export function main() {}", "src/cli.js", errors);
  assertNotIncludes(cliSource, "Hello", "src/cli.js", errors);

  reportErrors("YSIR plan integration test", errors, output, testEnv);
  console.log("YSIR plan integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
