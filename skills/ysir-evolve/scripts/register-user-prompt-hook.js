#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// 注册后的项目内脚本路径和 hooks.json 命令必须保持一致，避免 Codex 找不到采集脚本。
const CAPTURE_SCRIPT_NAME = "user-prompt-submit-capture.js";
const PROJECT_CAPTURE_SCRIPT = path.join(".codex", CAPTURE_SCRIPT_NAME);
const LEGACY_PROJECT_CAPTURE_SCRIPT = path.join("hooks", CAPTURE_SCRIPT_NAME);
const HOOK_COMMAND = `node ${PROJECT_CAPTURE_SCRIPT}`;
const LEGACY_HOOK_COMMAND = `node ${LEGACY_PROJECT_CAPTURE_SCRIPT}`;

/**
 * 读取既有 hooks.json；文件不存在时按空配置处理，便于首次注册。
 */
function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * 将 ysir-evolve 自带的采集脚本安装到当前项目，供项目级 Codex hook 调用。
 */
function ensureCaptureScript(projectRoot) {
  const sourcePath = path.join(__dirname, CAPTURE_SCRIPT_NAME);
  const targetPath = path.join(projectRoot, PROJECT_CAPTURE_SCRIPT);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
}

/**
 * 合并写入项目级 hooks.json，只追加缺失的 YSIR hook，保留用户已有配置。
 */
function ensureHookConfig(projectRoot) {
  const hooksPath = path.join(projectRoot, ".codex", "hooks.json");
  const config = readJsonIfExists(hooksPath);
  config.hooks = config.hooks && typeof config.hooks === "object" ? config.hooks : {};

  const entries = Array.isArray(config.hooks.UserPromptSubmit)
    ? config.hooks.UserPromptSubmit
    : [];
  const hasYsirHook = entries.some((entry) => {
    return Array.isArray(entry.hooks) && entry.hooks.some((hook) => {
      if (!hook || hook.type !== "command") {
        return false;
      }
      if (hook.command === LEGACY_HOOK_COMMAND) {
        hook.command = HOOK_COMMAND;
      }
      return hook.command === HOOK_COMMAND;
    });
  });

  if (!hasYsirHook) {
    entries.push({
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
          timeout: 2,
        },
      ],
    });
  }

  config.hooks.UserPromptSubmit = entries;
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * 以当前工作目录作为目标项目根目录注册自进化事件来源。
 */
function main() {
  const projectRoot = process.cwd();
  ensureCaptureScript(projectRoot);
  ensureHookConfig(projectRoot);
  console.log("YSIR UserPromptSubmit hook registered.");
}

main();
