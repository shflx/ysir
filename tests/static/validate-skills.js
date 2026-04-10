#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");

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
