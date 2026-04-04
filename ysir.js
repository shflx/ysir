#!/usr/bin/env node

"use strict";

// YSIR 安装向导:
// 1. 发现仓库内可安装的技能
// 2. 以交互式方式选择目标工具和安装位置
// 3. 将技能复制到 Codex 或 Claude Code 的约定目录
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const REPO_ROOT = __dirname;
const SOURCE_SKILLS_DIR = path.join(REPO_ROOT, "skills");
// 统一维护终端配色，避免输出样式散落在脚本各处。
const ANSI = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};
const FIELD_LABEL_WIDTH = 10;
const TOTAL_STEPS = 3;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/**
 * 为终端输出附加 ANSI 颜色。
 */
function colorize(text, color) {
  return `${color}${text}${ANSI.reset}`;
}

/**
 * 组合多个 ANSI 样式。
 */
function styleText(text, ...styles) {
  return `${styles.join("")}${text}${ANSI.reset}`;
}

/**
 * 终端路径高亮，突出用户最关心的目标位置。
 */
function stylePath(targetPath) {
  return styleText(targetPath, ANSI.bright, ANSI.cyan);
}

/**
 * 工具名高亮，突出本次安装面向的 coding agent。
 */
function styleTool(toolName) {
  return styleText(toolName, ANSI.bright, ANSI.magenta);
}

/**
 * 统一动作型提示语配色。
 */
function styleAction(text) {
  return colorize(text, ANSI.cyan);
}

/**
 * 去除 ANSI 转义，便于计算盒子宽度。
 */
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * 粗略计算终端显示宽度，覆盖当前脚本涉及到的中文与常见宽字符场景。
 */
function getDisplayWidth(text) {
  const plainText = stripAnsi(text);
  let width = 0;

  for (const char of plainText) {
    const codePoint = char.codePointAt(0);
    if (
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }

  return width;
}

/**
 * 按终端显示宽度补齐字符串。
 */
function padDisplayEnd(text, width) {
  const padding = Math.max(0, width - getDisplayWidth(text));
  return `${text}${" ".repeat(padding)}`;
}

/**
 * 按终端显示宽度左侧补齐字符串。
 */
function padDisplayStart(text, width) {
  const padding = Math.max(0, width - getDisplayWidth(text));
  return `${" ".repeat(padding)}${text}`;
}

/**
 * 打印向导步骤标题，让交互流程更清晰。
 */
function printStep(step, title) {
  console.log(`\n${colorize(`[${step}/${TOTAL_STEPS}]`, ANSI.cyan)} ${colorize(title, ANSI.bright)}`);
}

/**
 * 统一打印键值行，避免不同步骤的展示样式各写各的。
 */
function printField(label, value, color) {
  const renderedValue = color ? colorize(value, color) : value;
  console.log(`  ${colorize(label.padEnd(FIELD_LABEL_WIDTH), ANSI.dim)} ${renderedValue}`);
}

/**
 * 输出已完成步骤摘要。
 */
function printSuccess(label, value) {
  console.log(`${colorize("✔", ANSI.green)} ${label}: ${value}`);
}

/**
 * 清理上一轮渲染的菜单区域，便于方向键切换时整块重绘。
 */
function clearRenderedBlock(lineCount) {
  if (lineCount <= 0 || !process.stdout.isTTY) {
    return;
  }

  readline.moveCursor(process.stdout, 0, -lineCount);
  readline.cursorTo(process.stdout, 0);
  readline.clearScreenDown(process.stdout);
}

/**
 * 输出信息卡片，用于安装前确认和安装后结果展示。
 */
function printBox(title, rows) {
  const innerWidth = Math.max(
    39,
    ...rows.map((row) => getDisplayWidth(row) + 2),
    getDisplayWidth(title) + 4
  );
  const titlePadding = innerWidth - getDisplayWidth(title) - 2;
  const left = Math.floor(titlePadding / 2);
  const right = titlePadding - left;

  console.log("");
  console.log(`╔${"═".repeat(left)} ${title} ${"═".repeat(right)}╗`);
  rows.forEach((row) => {
    console.log(`║ ${padDisplayEnd(row, innerWidth - 1)}║`);
  });
  console.log(`╚${"═".repeat(innerWidth)}╝`);
}

/**
 * 输出安装前确认区域。
 */
function printPlanBox(tool, destinations) {
  const entries = [
    {
      label: "工具",
      value: styleTool(tool === "codex" ? "Codex" : "Claude Code"),
    },
    {
      label: "目录",
      value: stylePath(toDisplayPath(destinations.mainDir)),
    },
  ];

  const labelWidth = Math.max(...entries.map((entry) => getDisplayWidth(entry.label)));
  const rows = entries.map((entry) => {
    return `${padDisplayStart(entry.label, labelWidth)}: ${entry.value}`;
  });

  printBox("安装清单", rows);
}

/**
 * 输出结果分隔标题，让安装结果从前面的问答流中明确跳出。
 */
function printResultDivider(title) {
  const width = 45;
  const text = ` ${title} `;
  const filler = width - getDisplayWidth(text);
  const left = Math.floor(filler / 2);
  const right = filler - left;

  console.log("");
  console.log(colorize(`${"━".repeat(left)}${text}${"━".repeat(right)}`, ANSI.cyan));
}

/**
 * 在异步安装期间显示动态指示器。
 */
function startSpinner(text) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${text}\n`);
    return () => { };
  }

  let frameIndex = 0;
  const render = () => {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${colorize(SPINNER_FRAMES[frameIndex], ANSI.cyan)} ${text}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  render();
  const timer = setInterval(render, 80);

  return () => {
    clearInterval(timer);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
}

/**
 * 输出符合项目气质的启动 Banner。
 */
function printBanner() {
  const art = [
    "",
    "   O7   Yes, Sir.",
    "  /|",
    "  / \\   Built to deliver.",
  ].join("\n");

  console.log(styleText(art, ANSI.bright, ANSI.white));
  console.log("");
}

/**
 * 解析命令行参数。
 */
function parseArgs(argv) {
  const args = {
    yes: false,
  };
  const requireValue = (flagName, value) => {
    if (!value || value.startsWith("-")) {
      throw new Error(`${flagName} 需要提供参数值。`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--tool":
      case "-t":
        args.tool = requireValue(token, argv[index + 1]);
        index += 1;
        break;
      case "--dest":
      case "-d":
        args.dest = requireValue(token, argv[index + 1]);
        index += 1;
        break;
      case "--yes":
      case "-y":
        args.yes = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (token.startsWith("--")) {
          throw new Error(`未知参数: ${token}`);
        }
    }
  }

  return args;
}

/**
 * 输出帮助信息。
 */
function printHelp() {
  console.log("用法:");
  console.log("  node configure.js");
  console.log("  node configure.js --tool codex --yes");
  console.log("");
  console.log("参数:");
  console.log("  --tool, -t    目标工具: codex | claude");
  console.log("  --dest, -d    自定义目标目录");
  console.log("  --yes, -y     跳过确认，直接使用默认值");
}

/**
 * 将用户输入标准化为脚本内部使用的工具标识。
 */
function normalizeTool(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "codex") {
    return "codex";
  }
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claudecode") {
    return "claude";
  }
  return null;
}

/**
 * 展开以 `~` 开头的用户目录写法，方便兼容命令行输入。
 */
function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * 在写入前确保目标目录存在。
 */
async function ensureDir(targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
}

/**
 * 扫描仓库中的技能目录，并读取每个技能的基本元信息。
 */
function discoverSkills() {
  return fs
    .readdirSync(SOURCE_SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const skillDir = path.join(SOURCE_SKILLS_DIR, entry.name);
      const skillFile = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        return null;
      }

      const content = fs.readFileSync(skillFile, "utf8");
      const frontmatter = parseFrontmatter(content);
      return {
        dirName: entry.name,
        name: frontmatter.name || entry.name,
        description: frontmatter.description || "未提供描述",
        sourceDir: skillDir,
        skillFile,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 从 SKILL.md 的 frontmatter 中提取 `name`、`description` 等字段。
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {};
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((result, line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return result;
      }
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      result[key] = value;
      return result;
    }, {});
}

/**
 * 创建交互式命令行界面。
 */
function createPromptInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 对 readline.question 做 Promise 封装，便于统一使用 async/await。
 */
function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * 读取文本输入，支持默认值回填。
 */
async function askText(rl, prompt, defaultValue) {
  const answer = (await question(rl, `  ${styleAction(">")} ${styleAction(prompt)}: `)).trim();
  return answer || defaultValue || "";
}

/**
 * 读取编号选择题输入。
 */
async function askChoice(rl, title, options, defaultIndex) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return new Promise((resolve) => {
      let selectedIndex = defaultIndex;
      let renderedLineCount = 0;

      const render = () => {
        clearRenderedBlock(renderedLineCount);

        const lines = [
          `${colorize("[1/3]", ANSI.cyan)} ${colorize(title, ANSI.bright)}`,
          ...options.map((option, index) => {
            const selected = index === selectedIndex;
            const cursor = selected ? colorize("›", ANSI.green) : " ";
            const label = selected ? colorize(option.label, ANSI.bright) : option.label;
            return `  ${cursor} [${index + 1}] ${label}`;
          }),
          colorize("  ↑/↓ 切换，Enter 确认", ANSI.dim),
        ];
        process.stdout.write(`${lines.join("\n")}\n`);
        renderedLineCount = lines.length;
      };

      const cleanup = () => {
        process.stdin.off("keypress", onKeypress);
        process.stdout.write("\x1B[?25h");
        process.stdin.setRawMode(false);
        clearRenderedBlock(renderedLineCount);
      };

      const onKeypress = (character, key = {}) => {
        if (key.ctrl && key.name === "c") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }

        if (key.name === "up") {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          render();
          return;
        }

        if (key.name === "down") {
          selectedIndex = (selectedIndex + 1) % options.length;
          render();
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          const selected = options[selectedIndex];
          cleanup();
          resolve(selected.value);
          return;
        }

        const numericIndex = Number.parseInt(character, 10) - 1;
        if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < options.length) {
          selectedIndex = numericIndex;
          render();
        }
      };

      readline.emitKeypressEvents(process.stdin, rl);
      process.stdout.write("\x1B[?25l");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("keypress", onKeypress);
      render();
    });
  }

  printStep(1, title);
  options.forEach((option, index) => {
    console.log(`  [${index + 1}] ${option.label}`);
  });

  while (true) {
    const answer = (await question(
      rl,
      `  ${styleAction(">")} ${styleAction(`请输入编号（默认 ${defaultIndex + 1}）`)}: `
    )).trim();
    const picked = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
    if (Number.isInteger(picked) && picked >= 0 && picked < options.length) {
      return options[picked].value;
    }
    console.log(colorize(`  输入无效，请输入 1-${options.length}。`, ANSI.yellow));
  }
}

/**
 * 读取是/否确认输入。
 */
async function askYesNo(rl, prompt, defaultValue) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = (await question(
    rl,
    `  ${styleAction("?")} ${styleAction(prompt)} [${suffix}] ${colorize("›", ANSI.cyan)} `
  )).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  if (["y", "yes"].includes(answer)) {
    return true;
  }
  if (["n", "no"].includes(answer)) {
    return false;
  }
  console.log(colorize("输入无效，按默认值处理。", ANSI.yellow));
  return defaultValue;
}

/**
 * 计算 Codex 技能安装目录。
 */
function getCodexDestination(customDest) {
  const codexHome = process.env.CODEX_HOME
    ? expandHome(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return path.resolve(expandHome(customDest || path.join(codexHome, "skills")));
}

/**
 * 计算 Claude Code 技能安装目录。
 */
function getClaudeSkillsDestination(customDest) {
  return path.resolve(expandHome(customDest || path.join(os.homedir(), ".claude", "skills")));
}

/**
 * 统一路径展示格式，避免不同平台分隔符影响终端可读性。
 */
function toDisplayPath(targetPath) {
  return targetPath.split(path.sep).join("/");
}

/**
 * 复制技能目录，同时忽略 Finder 产生的无关文件，并允许按需裁剪子目录。
 */
async function copyDirectory(sourceDir, targetDir, options = {}) {
  const { excludeRelativeDirs = [] } = options;

  await fs.promises.cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      if (path.basename(sourcePath) === ".DS_Store") {
        return false;
      }

      const relativePath = path.relative(sourceDir, sourcePath);
      if (!relativePath) {
        return true;
      }

      return !excludeRelativeDirs.some((dirName) => {
        return relativePath === dirName || relativePath.startsWith(`${dirName}${path.sep}`);
      });
    },
  });
}

/**
 * 选择目标工具；命令行已指定时直接复用，未指定时再进入向导。
 */
async function chooseTool(rl, args) {
  const tool = normalizeTool(args.tool);
  if (tool) {
    printSuccess("选择接入目标", styleTool(tool === "codex" ? "Codex" : "Claude Code"));
    return tool;
  }

  const selectedTool = await askChoice(
    rl,
    "选择接入目标",
    [
      {
        label: "Codex",
        value: "codex",
      },
      {
        label: "Claude Code",
        value: "claude",
      },
    ],
    0
  );

  printSuccess("选择接入目标", styleTool(selectedTool === "codex" ? "Codex" : "Claude Code"));
  return selectedTool;
}

/**
 * 当前向导固定安装仓库中的全部技能，避免用户在工具层面做过细选择。
 */
async function chooseSkills(_rl, _args, availableSkills) {
  return availableSkills;
}

/**
 * 选择安装目标目录。
 */
async function chooseDestination(rl, tool, args) {
  if (tool === "codex") {
    const defaultDest = getCodexDestination(args.dest);
    if (args.yes) {
      printSuccess("确认安装目录", stylePath(toDisplayPath(defaultDest)));
      return { mainDir: defaultDest };
    }
    if (process.stdin.isTTY && process.stdout.isTTY) {
      printStep(2, "确认安装目录");
      printField("默认目录", stylePath(toDisplayPath(defaultDest)));
      const answer = await askText(rl, "输入目录，直接回车使用默认值", defaultDest);
      clearRenderedBlock(3);
      const destination = path.resolve(expandHome(answer));
      printSuccess("确认安装目录", stylePath(toDisplayPath(destination)));
      return { mainDir: destination };
    }

    printStep(2, "确认安装目录");
    printField("默认目录", stylePath(toDisplayPath(defaultDest)));
    const answer = await askText(rl, "输入目录，直接回车使用默认值", defaultDest);
    const destination = path.resolve(expandHome(answer));
    printSuccess("确认安装目录", stylePath(toDisplayPath(destination)));
    return { mainDir: destination };
  }

  const defaultSkillsDir = getClaudeSkillsDestination(args.dest);
  if (args.yes) {
    printSuccess("确认安装目录", stylePath(toDisplayPath(defaultSkillsDir)));
    return { mainDir: defaultSkillsDir };
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    printStep(2, "确认安装目录");
    printField("默认目录", stylePath(toDisplayPath(defaultSkillsDir)));
    const answer = await askText(rl, "输入目录，直接回车使用默认值", defaultSkillsDir);
    clearRenderedBlock(3);
    const skillsDir = path.resolve(expandHome(answer));
    printSuccess("确认安装目录", stylePath(toDisplayPath(skillsDir)));
    return { mainDir: skillsDir };
  }

  printStep(2, "确认安装目录");
  printField("默认目录", stylePath(toDisplayPath(defaultSkillsDir)));
  const answer = await askText(rl, "输入目录，直接回车使用默认值", defaultSkillsDir);
  const skillsDir = path.resolve(expandHome(answer));
  printSuccess("确认安装目录", stylePath(toDisplayPath(skillsDir)));
  return { mainDir: skillsDir };
}

/**
 * 打印本次安装计划，便于用户在写入前再次确认。
 */
function printPlan(tool, destinations, options = {}) {
  const { showStep = true } = options;
  if (showStep) {
    printStep(3, "确认安装计划");
  }
  printPlanBox(tool, destinations);
}

/**
 * Codex 安装模式: 直接复制完整 skill 目录结构。
 */
async function installToCodex(selectedSkills, destinationDir) {
  await ensureDir(destinationDir);
  for (const skill of selectedSkills) {
    const targetDir = path.join(destinationDir, skill.dirName);
    await copyDirectory(skill.sourceDir, targetDir);
  }
}

/**
 * Claude 安装模式: 复制 skill 主体，但不携带仅供 Codex 使用的 agents 子目录。
 */
async function installToClaude(selectedSkills, destinationDir) {
  await ensureDir(destinationDir);
  for (const skill of selectedSkills) {
    const targetDir = path.join(destinationDir, skill.dirName);
    await copyDirectory(skill.sourceDir, targetDir, {
      excludeRelativeDirs: ["agents"],
    });
  }
}

/**
 * 输出安装完成提示和关键目录位置。
 */
function printDone(tool, destinations) {
  const toolName = tool === "codex" ? "Codex" : "Claude Code";

  printResultDivider("安装结果");
  console.log(`${colorize("✨", ANSI.green)} ${colorize("安装完成!", ANSI.bright)}`);
  console.log(`${colorize("YSIR", ANSI.cyan)} 已成功集成至 ${styleTool(toolName)}。`);

  if (tool === "codex") {
    console.log(
      `${colorize("💡 下一步", ANSI.yellow)} ${colorize("重新启动 Codex", ANSI.bright)}，这些技能将自动生效。`
    );
    return;
  }

  console.log(
    `${colorize("💡 下一步", ANSI.yellow)} ${colorize("重新启动 Claude Code", ANSI.bright)}，这些技能将自动生效。`
  );
}

/**
 * 主流程:
 * 1. 向导式收集配置
 * 2. 执行安装
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const availableSkills = discoverSkills();
  if (availableSkills.length === 0) {
    throw new Error("未发现可安装的技能目录。");
  }

  printBanner();

  const rl = createPromptInterface();

  try {
    const tool = await chooseTool(rl, args);
    if (!tool) {
      throw new Error("未识别的目标工具，请使用 codex 或 claude。");
    }

    const selectedSkills = await chooseSkills(rl, args, availableSkills);
    const destinations = await chooseDestination(rl, tool, args);

    printPlan(tool, destinations, {
      showStep: !args.yes,
    });

    const shouldContinue = args.yes
      ? true
      : await askYesNo(rl, "确认开始安装", true);

    if (!args.yes && process.stdin.isTTY && process.stdout.isTTY) {
      clearRenderedBlock(1);
    }

    if (!shouldContinue) {
      console.log(colorize("已取消。", ANSI.yellow));
      return;
    }

    const stopSpinner = startSpinner("正在将 YSIR 写入目标目录...");

    try {
      if (tool === "codex") {
        await installToCodex(selectedSkills, destinations.mainDir);
      } else {
        await installToClaude(selectedSkills, destinations.mainDir);
      }
    } finally {
      stopSpinner();
    }

    printDone(tool, destinations);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(colorize(`\n配置失败: ${error.message}`, ANSI.red));
  process.exitCode = 1;
});
