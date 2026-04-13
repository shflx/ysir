"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_SKILLS_DIR = path.join(REPO_ROOT, "skills");
const DEFAULT_AGENT_CMD = "codex";
// `--ask-for-approval` 是 codex 顶层参数，`--sandbox` 是 exec 子命令参数。
const DEFAULT_AGENT_ARGS = ["--ask-for-approval", "never", "exec", "--sandbox", "workspace-write"];
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }

  return result.stdout;
}

function copyDirectory(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => path.basename(sourcePath) !== ".DS_Store",
  });
}

function readSkillMetadata(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const metadata = {
    name: path.basename(skillDir),
    description: "",
  };

  if (frontmatter) {
    for (const line of frontmatter[1].split("\n")) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        metadata[match[1]] = match[2];
      }
    }
  }

  return metadata;
}

function createAgentsInstructions(projectDir) {
  const localSkillsDir = path.join(projectDir, ".codex", "skills");
  // 让真实 Codex 在 fixture 内使用当前仓库的技能副本，而不是用户本地已安装版本。
  const skillEntries = fs
    .readdirSync(localSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const skillDir = path.join(localSkillsDir, entry.name);
      const metadata = readSkillMetadata(skillDir);
      const skillPath = path.join(skillDir, "SKILL.md");
      return `- ${metadata.name}: ${metadata.description} (file: ${skillPath})`;
    })
    .sort();

  return [
    `# AGENTS.md instructions for ${projectDir}`,
    "",
    "<INSTRUCTIONS>",
    "## Skills",
    "A skill is a set of local instructions to follow that is stored in a `SKILL.md` file.",
    "### Available skills",
    ...skillEntries,
    "### How to use skills",
    "- If the user names a skill with `$SkillName` or plain text, open its `SKILL.md` and follow the workflow.",
    "- Resolve relative paths from the skill directory first.",
    "- Load only the referenced files needed for the task.",
    "</INSTRUCTIONS>",
    "",
  ].join("\n");
}

function initGit(projectDir) {
  runCommand("git", ["init", "--quiet"], { cwd: projectDir });
  runCommand("git", ["config", "user.email", "ysir@example.test"], { cwd: projectDir });
  runCommand("git", ["config", "user.name", "YSIR Test"], { cwd: projectDir });
  runCommand("git", ["add", "."], { cwd: projectDir });
  runCommand("git", ["commit", "-m", "test: initial fixture", "--quiet"], { cwd: projectDir });
}

function createFixture(prefix, setupProject) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const codexHome = path.join(projectDir, ".codex-home");

  // 同时支持 AGENTS.md 指向的项目内技能副本，以及可选 CODEX_HOME 隔离模式。
  copyDirectory(SOURCE_SKILLS_DIR, path.join(codexHome, "skills"));
  copyDirectory(SOURCE_SKILLS_DIR, path.join(projectDir, ".codex", "skills"));
  writeFile(path.join(projectDir, "AGENTS.md"), createAgentsInstructions(projectDir));

  setupProject(projectDir);
  initGit(projectDir);

  return {
    codexHome,
    projectDir,
  };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.error?.code !== "ENOENT";
}

function parseAgentArgs() {
  if (!process.env.YSIR_AGENT_ARGS) {
    return DEFAULT_AGENT_ARGS;
  }
  return JSON.parse(process.env.YSIR_AGENT_ARGS);
}

function formatAgentFailure(reason, stdout, stderr) {
  return [
    reason,
    "",
    "Agent stdout:",
    stdout || "<empty>",
    "",
    "Agent stderr:",
    stderr || "<empty>",
  ].join("\n");
}

function runAgent(testEnv, prompt) {
  const command = process.env.YSIR_AGENT_CMD || DEFAULT_AGENT_CMD;
  const args = parseAgentArgs();
  const timeoutMs = Number(process.env.YSIR_INTEGRATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  if (!commandExists(command)) {
    console.log(
      `SKIP: coding agent "${command}" not found. Install Codex or set YSIR_AGENT_CMD.`
    );
    process.exit(0);
  }

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
    };

    // 默认复用本机 Codex 登录态；只有显式开启时才隔离 CODEX_HOME。
    if (process.env.YSIR_ISOLATE_CODEX_HOME === "1") {
      env.CODEX_HOME = testEnv.codexHome;
    }

    const child = spawn(command, [...args, prompt], {
      cwd: testEnv.projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(formatAgentFailure(`Agent timed out after ${timeoutMs}ms`, stdout, stderr)));
        return;
      }
      if (code !== 0) {
        reject(new Error(formatAgentFailure(`Agent exited with ${code}`, stdout, stderr)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function cleanupFixture(testEnv) {
  if (process.env.YSIR_KEEP_FIXTURE === "1") {
    console.log(`Fixture retained at: ${testEnv.projectDir}`);
  } else {
    fs.rmSync(testEnv.projectDir, { recursive: true, force: true });
  }
}

function assertIncludes(content, expected, label, errors) {
  if (!content.includes(expected)) {
    errors.push(`${label}: expected to include "${expected}"`);
  }
}

function assertNotIncludes(content, unexpected, label, errors) {
  if (content.includes(unexpected)) {
    errors.push(`${label}: expected not to include "${unexpected}"`);
  }
}

function assertMatches(content, pattern, label, errors) {
  if (!pattern.test(content)) {
    errors.push(`${label}: expected to match ${pattern}`);
  }
}

function assertNotMatches(content, pattern, label, errors) {
  if (pattern.test(content)) {
    errors.push(`${label}: expected not to match ${pattern}`);
  }
}

function assertFileExists(filePath, label, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label}: expected file to exist`);
  }
}

function assertFileNotExists(filePath, label, errors) {
  if (fs.existsSync(filePath)) {
    errors.push(`${label}: expected file not to exist`);
  }
}

function reportErrors(title, errors, output, testEnv) {
  if (errors.length === 0) {
    return;
  }

  console.error(`${title} failed:\n`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error("\nAgent output:\n");
  console.error(output);
  console.error(`\nFixture retained at: ${testEnv.projectDir}`);
  process.exit(1);
}

module.exports = {
  assertFileExists,
  assertFileNotExists,
  assertIncludes,
  assertMatches,
  assertNotMatches,
  assertNotIncludes,
  cleanupFixture,
  createFixture,
  readFileIfExists,
  reportErrors,
  runAgent,
  runCommand,
  writeFile,
};
