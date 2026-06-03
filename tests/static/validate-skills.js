#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const CONFIGURE_DIR = path.join(SKILLS_DIR, "ysir-configure");
const EVOLVE_DIR = path.join(SKILLS_DIR, "ysir-evolve");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listSkillDirs() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(SKILLS_DIR, entry.name))
    .sort();
}

// 仅解析当前技能文件使用到的简单 frontmatter 标量字段。
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return null;
  }

  const fields = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }
    fields[fieldMatch[1]] = fieldMatch[2].trim();
  }
  return fields;
}

// 收集技能文档中使用到的相对引用，兼容 markdown 链接和反引号中的路径说明。
function collectLinkedPaths(content) {
  const linkedPaths = new Set();

  for (const match of content.matchAll(/\]\((\.\/[^)]+)\)/g)) {
    linkedPaths.add(match[1]);
  }

  for (const match of content.matchAll(/`(\.\/references\/[^`]+)`/g)) {
    linkedPaths.add(match[1]);
  }

  for (const match of content.matchAll(/`(references\/[^`]+)`/g)) {
    linkedPaths.add(`./${match[1]}`);
  }

  return [...linkedPaths];
}

function toRepoRelative(filePath) {
  return path.relative(REPO_ROOT, filePath) || ".";
}

function validateConfigureDefaults(errors) {
  const ysirSkillPath = path.join(SKILLS_DIR, "ysir/SKILL.md");
  const skillPath = path.join(CONFIGURE_DIR, "SKILL.md");
  const evolveSkillPath = path.join(EVOLVE_DIR, "SKILL.md");
  const regulationSkillPath = path.join(SKILLS_DIR, "ysir-regulation/SKILL.md");
  const moveoutSkillPath = path.join(SKILLS_DIR, "ysir-moveout/SKILL.md");
  const quickChangeSchemaPath = path.join(SKILLS_DIR, "ysir-state/references/schemas/quick-change/schema.json");
  const templatePath = path.join(CONFIGURE_DIR, "references/ysir.yaml");
  const registerScriptPath = path.join(EVOLVE_DIR, "scripts/register-user-prompt-hook.js");
  const captureScriptPath = path.join(EVOLVE_DIR, "scripts/user-prompt-submit-capture.js");
  const queueScriptPath = path.join(EVOLVE_DIR, "scripts/user-prompt-queue.js");
  const evolveTemplatePath = path.join(EVOLVE_DIR, "references/evolve.md");
  const ysirSkillContent = readFile(ysirSkillPath);
  const skillContent = readFile(skillPath);
  const evolveSkillContent = readFile(evolveSkillPath);
  const registerScriptContent = fs.existsSync(registerScriptPath)
    ? readFile(registerScriptPath)
    : "";
  const queueScriptContent = fs.existsSync(queueScriptPath)
    ? readFile(queueScriptPath)
    : "";
  const evolveTemplateContent = readFile(evolveTemplatePath);
  const regulationSkillContent = readFile(regulationSkillPath);
  const moveoutSkillContent = readFile(moveoutSkillPath);
  const quickChangeSchemaContent = fs.existsSync(quickChangeSchemaPath)
    ? readFile(quickChangeSchemaPath)
    : "";
  const templateContent = readFile(templatePath);

  if (!templateContent.includes("developmentMethod: standard")) {
    errors.push("skills/ysir-configure/references/ysir.yaml: 缺少默认 developmentMethod: standard");
  }
  if (!/evolve:\n\s+enabled: true/.test(templateContent)) {
    errors.push("skills/ysir-configure/references/ysir.yaml: 缺少默认开启的 evolve.enabled");
  }
  for (const field of [
    "designParticipation",
    "requirementClarification",
    "requirementConfirmation",
    "planConfirmation",
    "acceptance",
  ]) {
    const fieldPattern = new RegExp(`${field}:\\n\\s+enabled: false`);
    if (!fieldPattern.test(templateContent)) {
      errors.push(`skills/ysir-configure/references/ysir.yaml: ${field} 默认应关闭`);
    }
  }
  if (!skillContent.includes("standard") || !skillContent.includes("tdd")) {
    errors.push("skills/ysir-configure/SKILL.md: 需要说明 developmentMethod 可选 standard/tdd");
  }
  if (!skillContent.includes("参与设计")) {
    errors.push("skills/ysir-configure/SKILL.md: 需要说明参与设计配置");
  }
  if (
    !skillContent.includes("不是业务功能配置") ||
    !skillContent.includes("默认配置含义") ||
    !skillContent.includes("必须完整发送以下固定提示") ||
    !skillContent.includes("不得自行压缩或省略其中的用途说明、影响范围、默认配置含义和可回复方式")
  ) {
    errors.push("skills/ysir-configure/SKILL.md: 首次配置前需要完整解释 ysir.yaml 和默认配置含义，不得压缩提示");
  }
  if (
    !ysirSkillContent.includes("`ysir.yaml` 不存在") ||
    !ysirSkillContent.includes("完整使用 `ysir-configure` 中的固定首次配置提示") ||
    !ysirSkillContent.includes("不得在本技能中自行概述、压缩或改写")
  ) {
    errors.push("skills/ysir/SKILL.md: 缺失 ysir.yaml 首次配置门禁，不能自行压缩配置提示");
  }
  if (!skillContent.includes("UserPromptSubmit") || !skillContent.includes(".codex/hooks.json")) {
    errors.push("skills/ysir-configure/SKILL.md: 需要说明 UserPromptSubmit hook 注册");
  }
  if (
    !skillContent.includes(".codex/user-prompt-submit-capture.js") ||
    !evolveSkillContent.includes(".codex/user-prompt-submit-capture.js") ||
    !registerScriptContent.includes('path.join(".codex", CAPTURE_SCRIPT_NAME)')
  ) {
    errors.push("ysir-evolve hook 安装位置必须收敛到项目级 .codex 目录");
  }
  if (
    skillContent.includes("hooks/user-prompt-submit-capture.js") ||
    evolveSkillContent.includes("hooks/user-prompt-submit-capture.js")
  ) {
    errors.push("技能文档不应再要求创建项目根目录 hooks/user-prompt-submit-capture.js");
  }
  if (!fs.existsSync(registerScriptPath)) {
    errors.push("skills/ysir-evolve/scripts/register-user-prompt-hook.js: 缺少 hook 注册脚本");
  }
  if (!fs.existsSync(captureScriptPath)) {
    errors.push("skills/ysir-evolve/scripts/user-prompt-submit-capture.js: 缺少自进化事件记录脚本");
  }
  if (!fs.existsSync(queueScriptPath)) {
    errors.push("skills/ysir-evolve/scripts/user-prompt-queue.js: 缺少自进化队列批处理脚本");
  }
  if (!evolveSkillContent.includes("自进化事件来源")) {
    errors.push("skills/ysir-evolve/SKILL.md: 需要说明自进化事件来源");
  }
  if (
    !evolveSkillContent.includes("不要在 Markdown 正文中记录完整来源") ||
    !evolveTemplateContent.includes("处理成功后清理")
  ) {
    errors.push("skills/ysir-evolve: 需要说明 evolve.md 不记录完整来源且原始输入成功处理后清理");
  }
  if (!evolveSkillContent.includes("install") || !evolveSkillContent.includes("read") || !evolveSkillContent.includes("process")) {
    errors.push("skills/ysir-evolve/SKILL.md: 需要说明 install/read/process 三类动作");
  }
  if (
    !evolveSkillContent.includes("user-prompt-submit.processing.jsonl") ||
    !evolveSkillContent.includes("snapshot") ||
    !evolveSkillContent.includes("commit") ||
    !queueScriptContent.includes("abort") ||
    !queueScriptContent.includes("fs.renameSync(queuePath, processingPath)") ||
    !queueScriptContent.includes("fs.unlinkSync(processingPath)")
  ) {
    errors.push("ysir-evolve process 必须按批次消费 user-prompt-submit.jsonl，并在成功后出队清理");
  }
  if (!regulationSkillContent.includes(".report/evolve.md")) {
    errors.push("skills/ysir-regulation/SKILL.md: 需要把用户偏好与习惯作为规范来源");
  }
  if (!moveoutSkillContent.includes("自进化处理")) {
    errors.push("skills/ysir-moveout/SKILL.md: 归档后需要触发自进化处理");
  }
  if (!fs.existsSync(quickChangeSchemaPath)) {
    errors.push("skills/ysir-state/references/schemas/quick-change/schema.json: 缺少 quick-change schema");
  }
  if (
    !ysirSkillContent.includes("quick-change 路线") ||
    !ysirSkillContent.includes("直接使用 `ysir-state` 初始化 `quick-change` schema 状态图")
  ) {
    errors.push("skills/ysir/SKILL.md: 需要说明 quick-change 场景识别和路由");
  }
  if (!moveoutSkillContent.includes("--schema quick-change")) {
    errors.push("skills/ysir-moveout/SKILL.md: 缺少 quick-change schema 初始化说明");
  }
  if (
    !quickChangeSchemaContent.includes('"id": "scope-check"') ||
    !quickChangeSchemaContent.includes('"id": "implement"') ||
    !quickChangeSchemaContent.includes('"id": "verify"') ||
    !quickChangeSchemaContent.includes('"id": "delivery-commit"')
  ) {
    errors.push("quick-change schema 需要包含 scope-check/implement/verify/delivery-commit 节点");
  }
}

// 静态校验覆盖技能元数据和引用路径。
function main() {
  const errors = [];
  const skillDirs = listSkillDirs();

  for (const skillDir of skillDirs) {
    const skillName = path.basename(skillDir);
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) {
      errors.push(`${toRepoRelative(skillDir)}: 缺少 SKILL.md`);
      continue;
    }

    const skillContent = readFile(skillFile);
    const frontmatter = parseFrontmatter(skillContent);

    if (!frontmatter) {
      errors.push(`${toRepoRelative(skillFile)}: 缺少 frontmatter`);
    } else {
      if (!frontmatter.name) {
        errors.push(`${toRepoRelative(skillFile)}: frontmatter 缺少 name`);
      } else if (frontmatter.name !== skillName) {
        errors.push(
          `${toRepoRelative(skillFile)}: frontmatter.name="${frontmatter.name}" 与目录名 "${skillName}" 不一致`
        );
      }

      if (!frontmatter.description) {
        errors.push(`${toRepoRelative(skillFile)}: frontmatter 缺少 description`);
      }
    }

    for (const relativeRef of collectLinkedPaths(skillContent)) {
      const targetPath = path.resolve(skillDir, relativeRef);
      if (!fs.existsSync(targetPath)) {
        errors.push(
          `${toRepoRelative(skillFile)}: 引用了不存在的文件 ${relativeRef}`
        );
      }
    }
  }
  validateConfigureDefaults(errors);

  if (errors.length > 0) {
    console.error("YSIR static validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`YSIR static validation passed (${skillDirs.length} skills checked).`);
}

main();
