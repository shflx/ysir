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

const EVOLVE_PATH = ".report/evolve.md";

function setupProject(projectDir) {
  writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "ysir-evolve-it",
        version: "1.0.0",
        type: "module",
      },
      null,
      2
    )}\n`
  );

  writeFile(
    path.join(projectDir, "src/index.js"),
    [
      "export function main() {",
      "  return \"ok\";",
      "}",
      "",
    ].join("\n")
  );
}

async function main() {
  const testEnv = createFixture("ysir-evolve-it-", setupProject);
  const prompt = [
    `在当前项目中使用 $ysir-evolve，将用户偏好整理为 ${EVOLVE_PATH}。`,
    "用户偏好: 我喜欢小步迭代、优先复用现有实现、命名清晰、少量但有用的注释；测试结论请直接给出，不要堆砌无关描述。",
    "当前是非交互集成测试；信息已经足够，不要追问，只允许编辑偏好文档，生成后退出。",
  ].join("\n");

  console.log(`Integration fixture: ${testEnv.projectDir}`);
  const { stdout, stderr } = await runAgent(testEnv, prompt);

  const fullEvolvePath = path.join(testEnv.projectDir, EVOLVE_PATH);
  const evolveContent = readFileIfExists(fullEvolvePath);
  const sourceContent = readFileIfExists(path.join(testEnv.projectDir, "src/index.js"));
  const output = `${stdout}\n${stderr}`;
  const errors = [];

  assertFileExists(fullEvolvePath, EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "## 编程习惯", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "## 代码风格偏好", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "## 使用原则", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "## 协作偏好", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "适用", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "例外", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "小步迭代", EVOLVE_PATH, errors);
  assertIncludes(evolveContent, "命名清晰", EVOLVE_PATH, errors);
  assertNotIncludes(evolveContent, "来源", EVOLVE_PATH, errors);
  assertIncludes(sourceContent, "return \"ok\";", "src/index.js", errors);
  assertNotIncludes(sourceContent, "注释", "src/index.js", errors);

  reportErrors("YSIR evolve integration test", errors, output, testEnv);
  console.log("YSIR evolve integration test passed.");
  cleanupFixture(testEnv);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
