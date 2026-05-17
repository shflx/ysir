#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Codex command hook 通过 stdin 传入事件 JSON，这里完整读取后再解析。
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

/**
 * 始终允许 Codex 继续执行；采集失败不应阻断用户的真实任务。
 */
function writeHookResponse() {
  process.stdout.write(JSON.stringify({
    continue: true,
    suppressOutput: true,
  }));
}

/**
 * 将 UserPromptSubmit 事件追加到项目内待处理队列，后续由 ysir-evolve process 批量消费。
 */
async function main() {
  const rawInput = await readStdin();
  const input = rawInput ? JSON.parse(rawInput) : {};
  const cwd = input.cwd || process.cwd();
  const logDir = path.join(cwd, ".report", "evolve");
  const logPath = path.join(logDir, "user-prompt-submit.jsonl");
  const record = {
    receivedAt: new Date().toISOString(),
    ...input,
  };

  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
  writeHookResponse();
}

main().catch(() => {
  writeHookResponse();
});
