#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const DEFAULT_REPORT_DIR = ".report";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17373;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl", ".yaml", ".yml"]);

function parseArgs(argv) {
  const args = {
    _: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function toEpochMillis(value) {
  if (!value) {
    return 0;
  }
  const millis = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function chronologicalHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  // state.history 正常是追加写入，但重试或人工调整后的旧报告可能出现时间乱序。
  // 这里做稳定排序，让界面能重建过程，同时不反写源文件。
  return history
    .map((item, index) => ({ item, index, at: toEpochMillis(item?.at) }))
    .sort((left, right) => {
      if (left.at && right.at && left.at !== right.at) {
        return left.at - right.at;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function listDirectories(dirPath) {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function listFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function firstMarkdownSection(content, headings) {
  if (!content) {
    return "";
  }

  const wanted = new Set(headings);
  const lines = content.split(/\r?\n/);
  let capturing = false;
  const captured = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      if (capturing) {
        break;
      }
      capturing = wanted.has(heading[1].trim());
      continue;
    }
    if (capturing) {
      captured.push(line);
    }
  }

  return cleanMarkdownSummary(captured.join("\n"));
}

function cleanMarkdownSummary(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .slice(0, 4)
    .join(" / ");
}

function titleFromTaskName(name) {
  const match = name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  const rawTitle = match ? match[1] : name;
  return rawTitle.replace(/[-_]+/g, " ").trim() || name;
}

function parseJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function statusLabel(status) {
  const labels = {
    current: "当前",
    completed: "完成",
    pending: "待处理",
    blocked: "阻塞",
    failed: "失败",
  };
  return labels[status] || status || "未知";
}

function normalizeNodes(state) {
  if (!state || !state.nodes || typeof state.nodes !== "object") {
    return [];
  }

  return Object.values(state.nodes).map((node) => ({
    id: node.id || "",
    label: node.label || node.stage || node.id || "",
    phase: node.phase || "",
    stage: node.stage || "",
    status: node.status || "",
    statusLabel: statusLabel(node.status),
    note: node.note || "",
    objective: node.objective || "",
    attempt: node.attempt || inferAttempt(node.id) || 1,
    template: node.template || "",
  }));
}

function inferAttempt(nodeId) {
  const match = String(nodeId || "").match(/@(\d+):/);
  return match ? Number(match[1]) : 1;
}

function buildProgress(nodes) {
  const effectiveNodes = latestLogicalNodes(nodes);
  const total = effectiveNodes.length;
  const completed = effectiveNodes.filter((node) => node.status === "completed").length;
  const unresolved = unresolvedProblemNodes(effectiveNodes);
  const failed = unresolved.filter((node) => node.status === "failed").length;
  const blocked = unresolved.filter((node) => node.status === "blocked").length;
  const current = effectiveNodes.find((node) => node.status === "current") || null;

  return {
    total,
    completed,
    failed,
    blocked,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    current,
  };
}

function logicalNodeKey(node) {
  return [node.phase || "", node.stage || node.label || node.id || ""].join(":");
}

function latestLogicalNodes(nodes) {
  // 重试会为同一逻辑 phase/stage 生成新的物理节点。进度和未解决异常应以
  // 最新尝试为准，避免把已经修复的旧失败节点继续算作当前问题。
  const latestByKey = new Map();
  nodes.forEach((node, index) => {
    const key = logicalNodeKey(node);
    const previous = latestByKey.get(key);
    const attempt = node.attempt || 1;
    if (!previous || attempt > previous.attempt || (attempt === previous.attempt && index > previous.index)) {
      latestByKey.set(key, { node, attempt, index });
    }
  });
  return [...latestByKey.values()]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.node);
}

function unresolvedProblemNodes(nodes) {
  return latestLogicalNodes(nodes)
    .filter((node) => ["failed", "blocked"].includes(node.status));
}

function evidenceTypeFromFileName(fileName) {
  if (fileName === "order.md") return "需求";
  if (fileName === "plan.md") return "方案";
  if (/^(access|visit|preview|usage|run|demo)(?:[-.]|$)/i.test(fileName)) return "访问";
  if (fileName.startsWith("test-round-")) return "测试";
  if (fileName.startsWith("cr-round-")) return "审查";
  if (/commit|acceptance|review|test/i.test(fileName)) return "证据";
  return "";
}

function collectEvidence(taskDir, taskRelativeDir) {
  // 证据栏是给人快速扫读的摘要，只提升常见顶层任务产物。
  // 原始文件查看入口仍允许打开 .report 下受支持的文本文件。
  return listFiles(taskDir)
    .filter((fileName) => {
      return Boolean(evidenceTypeFromFileName(fileName));
    })
    .map((fileName) => {
      const absolutePath = path.join(taskDir, fileName);
      return {
        type: evidenceTypeFromFileName(fileName),
        name: fileName,
        path: toPosix(path.join(taskRelativeDir, fileName)),
        updatedAt: getMtimeMs(absolutePath),
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function collectMarkdownFiles(dirPath, relativeDir) {
  return listFiles(dirPath)
    .filter((fileName) => TEXT_EXTENSIONS.has(path.extname(fileName)))
    .map((fileName) => {
      const absolutePath = path.join(dirPath, fileName);
      return {
        name: fileName,
        path: toPosix(path.join(relativeDir, fileName)),
        updatedAt: getMtimeMs(absolutePath),
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function parseTask(reportRoot, section, taskName) {
  // 把单个 .report 任务目录转换为大屏模型。这里产生的异常只用于展示；
  // 本脚本不会修改 state.json，也不会把判断反馈给 YSIR 工作流。
  const taskDir = path.join(reportRoot, section, taskName);
  const relativeDir = path.join(section, taskName);
  const orderPath = path.join(taskDir, "order.md");
  const planPath = path.join(taskDir, "plan.md");
  const statePath = path.join(taskDir, "state.json");
  const orderContent = readTextIfExists(orderPath);
  const planContent = readTextIfExists(planPath);
  const stateResult = fs.existsSync(statePath) ? parseJsonFile(statePath) : null;
  const anomalies = [];
  const files = collectMarkdownFiles(taskDir, relativeDir);
  let state = null;

  if (!fs.existsSync(statePath)) {
    anomalies.push({
      level: "warn",
      message: "缺少 state.json",
      path: toPosix(path.join(relativeDir, "state.json")),
    });
  } else if (!stateResult.ok) {
    anomalies.push({
      level: "error",
      message: `state.json 解析失败: ${stateResult.error}`,
      path: toPosix(path.join(relativeDir, "state.json")),
    });
  } else {
    state = stateResult.value;
  }

  const nodes = normalizeNodes(state);
  const progress = buildProgress(nodes);
  if (section === "in-progress" && state && !state.current) {
    anomalies.push({
      level: "warn",
      message: "进行中任务 current 为空",
      path: toPosix(path.join(relativeDir, "state.json")),
    });
  }
  if (progress.blocked > 0) {
    anomalies.push({
      level: "warn",
      message: `存在 ${progress.blocked} 个阻塞节点`,
      path: toPosix(path.join(relativeDir, "state.json")),
    });
  }
  if (progress.failed > 0) {
    anomalies.push({
      level: "error",
      message: `存在 ${progress.failed} 个失败节点`,
      path: toPosix(path.join(relativeDir, "state.json")),
    });
  }

  const evidence = collectEvidence(taskDir, relativeDir);
  const updatedAt = Math.max(
    getMtimeMs(taskDir),
    ...files.map((file) => file.updatedAt),
    ...evidence.map((item) => item.updatedAt),
    fs.existsSync(statePath) ? getMtimeMs(statePath) : 0
  );
  const goal = firstMarkdownSection(orderContent, [
    "任务目标",
    "需求描述",
    "已确认需求",
    "验收标准",
  ]) || firstMarkdownSection(planContent, ["方案目标", "实现策略", "分迭代的实现计划"]);

  return {
    id: `${section}/${taskName}`,
    section,
    status: section === "done" ? "done" : progress.blocked || progress.failed ? "blocked" : "in-progress",
    name: taskName,
    title: titleFromTaskName(taskName),
    path: toPosix(relativeDir),
    goal,
    orderPath: fs.existsSync(orderPath) ? toPosix(path.join(relativeDir, "order.md")) : "",
    planPath: fs.existsSync(planPath) ? toPosix(path.join(relativeDir, "plan.md")) : "",
    orderUpdatedAt: fs.existsSync(orderPath) ? getMtimeMs(orderPath) : 0,
    planUpdatedAt: fs.existsSync(planPath) ? getMtimeMs(planPath) : 0,
    statePath: fs.existsSync(statePath) ? toPosix(path.join(relativeDir, "state.json")) : "",
    stateCurrent: state?.current || "",
    stateSchema: typeof state?.schema === "string" ? state.schema : state?.schema?.name || "",
    updatedAt,
    progress,
    nodes,
    edges: Array.isArray(state?.edges) ? state.edges : [],
    history: chronologicalHistory(state?.history),
    evidence,
    files,
    anomalies,
  };
}

function scanDesign(reportRoot) {
  const designDir = path.join(reportRoot, "design");
  return collectMarkdownFiles(designDir, "design")
    .map((file) => ({
      ...file,
      title: file.name === "proj.md" ? "项目设计" : file.name.replace(/\.md$/, ""),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function buildDashboard(projectRoot, options = {}) {
  // 每次 API 请求都从磁盘重建模型，保持服务无状态；
  // 浏览器刷新即可看到最新的 .report 内容。
  const reportDir = options.report || DEFAULT_REPORT_DIR;
  const reportRoot = path.resolve(projectRoot, reportDir);
  const reportExists = fs.existsSync(reportRoot);
  const inProgressNames = reportExists ? listDirectories(path.join(reportRoot, "in-progress")) : [];
  const doneNames = reportExists ? listDirectories(path.join(reportRoot, "done")) : [];
  const inProgress = inProgressNames.map((taskName) => parseTask(reportRoot, "in-progress", taskName));
  const done = doneNames.map((taskName) => parseTask(reportRoot, "done", taskName));
  const tasks = [...inProgress, ...done].sort((left, right) => right.updatedAt - left.updatedAt);
  const activeTask = inProgress
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] || tasks[0] || null;
  const anomalies = tasks.flatMap((task) => task.anomalies.map((anomaly) => ({
    ...anomaly,
    taskId: task.id,
    taskTitle: task.title,
  })));
  const evidence = tasks
    .flatMap((task) => task.evidence.map((item) => ({
      ...item,
      taskId: task.id,
      taskTitle: task.title,
    })))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 24);
  const updatedAt = Math.max(
    getMtimeMs(reportRoot),
    ...tasks.map((task) => task.updatedAt),
    ...scanDesign(reportRoot).map((file) => file.updatedAt)
  );

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: path.basename(projectRoot),
      root: projectRoot,
      report: toPosix(path.relative(projectRoot, reportRoot) || reportDir),
      reportExists,
    },
    summary: {
      inProgress: tasks.filter((task) => task.status === "in-progress").length,
      done: done.length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      anomalies: anomalies.length,
      evidence: evidence.length,
      updatedAt,
    },
    activeTaskId: activeTask?.id || "",
    design: scanDesign(reportRoot),
    tasks,
    anomalies,
    evidence,
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, content, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(content);
}

function safeReportPath(reportRoot, relativePath) {
  // /api/file 会接收浏览器传入的路径，因此读取前必须先约束在 .report 内，
  // 拒绝任何从路径层面逃逸报告根目录的访问。
  let decoded = "";
  try {
    decoded = decodeURIComponent(relativePath || "");
  } catch {
    return null;
  }
  const absolutePath = path.resolve(reportRoot, decoded);
  if (absolutePath !== reportRoot && !absolutePath.startsWith(`${reportRoot}${path.sep}`)) {
    return null;
  }
  return absolutePath;
}

function createServer(projectRoot, options) {
  const reportRoot = path.resolve(projectRoot, options.report || DEFAULT_REPORT_DIR);

  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || DEFAULT_HOST}`);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendText(response, 200, renderHtml(), "text/html; charset=utf-8");
      return;
    }

    if (url.pathname === "/api/dashboard") {
      sendJson(response, 200, buildDashboard(projectRoot, options));
      return;
    }

    if (url.pathname.startsWith("/api/file/")) {
      const relativePath = url.pathname.slice("/api/file/".length);
      const absolutePath = safeReportPath(reportRoot, relativePath);
      if (!absolutePath) {
        sendJson(response, 403, { error: "path escapes .report" });
        return;
      }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        sendJson(response, 404, { error: "file not found" });
        return;
      }
      const ext = path.extname(absolutePath);
      if (!TEXT_EXTENSIONS.has(ext)) {
        sendJson(response, 415, { error: "unsupported file type" });
        return;
      }
      sendJson(response, 200, {
        path: toPosix(path.relative(reportRoot, absolutePath)),
        content: readTextIfExists(absolutePath),
      });
      return;
    }

    sendText(response, 404, "Not found", "text/plain; charset=utf-8");
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtml() {
  // 大屏故意内嵌在单文件脚本中：不需要构建工具、不依赖生成资产，
  // 也不在当前 HTTP 请求之外维护运行时状态。
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YSIR Headquarters</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111312;
      --panel: #f3eee2;
      --panel-2: #e6dfd0;
      --ink: #20231f;
      --muted: #6f776d;
      --line: rgba(32, 35, 31, 0.14);
      --dark-panel: #1a1e1b;
      --dark-line: rgba(243, 238, 226, 0.12);
      --green: #59d978;
      --amber: #e7b75a;
      --cyan: #7fd2c6;
      --red: #ff756f;
      --radius: 8px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at top left, rgba(127, 210, 198, 0.12), transparent 32rem), var(--bg);
      color: var(--panel);
    }
    button, input { font: inherit; }
    .shell {
      display: grid;
      grid-template-rows: 58px 1fr;
      min-height: 100vh;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 22px;
      border-bottom: 1px solid var(--dark-line);
      background: rgba(17, 19, 18, 0.88);
      backdrop-filter: blur(16px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid rgba(89, 217, 120, 0.4);
      border-radius: 8px;
      color: var(--green);
      font-weight: 800;
    }
    h1 {
      margin: 0;
      font-size: 17px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 2px;
      color: rgba(243, 238, 226, 0.55);
      font-size: 12px;
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      color: rgba(243, 238, 226, 0.72);
      font-size: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid var(--dark-line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(89, 217, 120, 0.12);
    }
    .refresh {
      min-height: 30px;
      padding: 0 12px;
      border: 1px solid rgba(127, 210, 198, 0.35);
      border-radius: 7px;
      background: rgba(127, 210, 198, 0.1);
      color: var(--panel);
      cursor: pointer;
    }
    .layout {
      display: grid;
      grid-template-columns: 292px minmax(0, 1fr) 330px;
      gap: 14px;
      padding: 14px;
      min-height: 0;
    }
    .sidebar, .main, .right-rail {
      min-width: 0;
    }
    .sidebar, .right-rail {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .right-rail .panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
    }
    .panel {
      background: var(--panel);
      color: var(--ink);
      border-radius: var(--radius);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .dark-card {
      background: var(--dark-panel);
      color: var(--panel);
      border: 1px solid var(--dark-line);
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 14px 10px;
      border-bottom: 1px solid var(--line);
    }
    .section-title {
      font-size: 13px;
      font-weight: 800;
    }
    .section-meta {
      font-size: 12px;
      color: var(--muted);
    }
    .summary-pills {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .summary-pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 0 8px;
      border: 1px solid rgba(222, 235, 228, 0.12);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.045);
      color: rgba(243, 238, 226, 0.76);
      font-size: 11px;
      font-weight: 850;
      white-space: nowrap;
    }
    .summary-pill.done {
      border-color: rgba(99, 226, 125, 0.22);
      background: rgba(99, 226, 125, 0.1);
      color: var(--green);
    }
    .summary-pill.rework,
    .summary-pill.pending {
      border-color: rgba(242, 189, 84, 0.24);
      background: rgba(242, 189, 84, 0.11);
      color: var(--amber);
    }
    .summary-pill.failed {
      border-color: rgba(255, 115, 95, 0.28);
      background: rgba(255, 115, 95, 0.12);
      color: var(--red);
    }
    .search {
      width: calc(100% - 24px);
      margin: 12px;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 0 11px;
      background: rgba(255, 255, 255, 0.5);
      color: var(--ink);
      outline: none;
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      padding: 0 12px 12px;
    }
    .filter {
      height: 30px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .filter.active {
      background: var(--ink);
      color: var(--panel);
      border-color: var(--ink);
    }
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0 12px 12px;
      max-height: calc(100vh - 220px);
      overflow: auto;
    }
    .task-item {
      display: grid;
      gap: 7px;
      width: 100%;
      padding: 11px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.38);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
    }
    .task-item.active {
      border-color: rgba(89, 217, 120, 0.75);
      box-shadow: inset 3px 0 0 var(--green);
      background: rgba(89, 217, 120, 0.1);
    }
    .task-title {
      font-size: 13px;
      font-weight: 800;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .task-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .mini-bar {
      height: 5px;
      border-radius: 999px;
      background: rgba(32, 35, 31, 0.12);
      overflow: hidden;
    }
    .mini-bar span {
      display: block;
      height: 100%;
      width: var(--value, 0%);
      background: linear-gradient(90deg, var(--green), var(--cyan));
    }
    .main {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 14px;
    }
    .overview {
      display: grid;
      grid-template-columns: 1.2fr repeat(4, minmax(100px, 0.42fr));
      gap: 12px;
    }
    .hero {
      padding: 18px;
      min-height: 154px;
      position: relative;
      overflow: hidden;
    }
    .hero-label {
      color: rgba(243, 238, 226, 0.58);
      font-size: 12px;
    }
    .hero h2 {
      margin: 8px 0 8px;
      font-size: 25px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .hero p {
      max-width: 820px;
      margin: 0;
      color: rgba(243, 238, 226, 0.68);
      font-size: 13px;
      line-height: 1.55;
    }
    .state-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .file-chip, .state-chip {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 9px;
      border-radius: 7px;
      border: 1px solid var(--dark-line);
      color: rgba(243, 238, 226, 0.78);
      background: rgba(255, 255, 255, 0.04);
      font-size: 12px;
    }
    .state-chip.current {
      color: #0f1a12;
      background: var(--green);
      border-color: var(--green);
      font-weight: 800;
    }
    .metric {
      padding: 14px;
      min-height: 104px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 850;
      color: var(--ink);
    }
    .metric-label {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .metric.accent-green { border-top: 3px solid var(--green); }
    .metric.accent-amber { border-top: 3px solid var(--amber); }
    .metric.accent-cyan { border-top: 3px solid var(--cyan); }
    .metric.accent-red { border-top: 3px solid var(--red); }
    .timeline-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 310px;
      min-height: 0;
    }
    .timeline {
      padding: 14px;
      overflow: auto;
      max-height: calc(100vh - 264px);
    }
    .node {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 12px;
      position: relative;
      padding-bottom: 13px;
    }
    .node:not(:last-child)::before {
      content: "";
      position: absolute;
      left: 8px;
      top: 20px;
      bottom: -4px;
      width: 1px;
      background: var(--line);
    }
    .node-dot {
      width: 17px;
      height: 17px;
      margin-top: 3px;
      border-radius: 999px;
      border: 2px solid rgba(32, 35, 31, 0.28);
      background: var(--panel);
      z-index: 1;
    }
    .node.current .node-dot { background: var(--green); border-color: var(--green); box-shadow: 0 0 0 5px rgba(89, 217, 120, 0.18); }
    .node.completed .node-dot { background: var(--ink); border-color: var(--ink); }
    .node.failed .node-dot { background: var(--red); border-color: var(--red); }
    .node.blocked .node-dot { background: var(--amber); border-color: var(--amber); }
    .node-card {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.36);
    }
    .node-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .node-name {
      font-size: 13px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .badge {
      flex: 0 0 auto;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(32, 35, 31, 0.08);
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
    .badge.current { background: rgba(89, 217, 120, 0.24); color: #176226; }
    .badge.failed { background: rgba(255, 117, 111, 0.18); color: #8d2925; }
    .badge.blocked { background: rgba(231, 183, 90, 0.22); color: #735017; }
    .node-detail {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .activity {
      padding: 14px;
      border-left: 1px solid var(--line);
      background: rgba(230, 223, 208, 0.58);
      overflow: auto;
      max-height: calc(100vh - 264px);
    }
    .activity-item {
      position: relative;
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      gap: 9px;
      align-items: center;
      min-height: 38px;
      padding: 7px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.3);
    }
    .activity-marker {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .activity-kind {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--muted);
    }
    .activity-kind.commit { background: var(--cyan); }
    .activity-kind.review { background: var(--blue); }
    .activity-kind.test { background: var(--green); }
    .activity-kind.file { background: var(--amber); }
    .activity-kind.failed { background: var(--red); }
    .activity-kind.failed::after {
      left: 4px;
      top: 7px;
      width: 8px;
      height: 0;
      border-width: 0 0 2px 0;
      transform: rotate(45deg);
      box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
    }
    .activity-kind.failed::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 7px;
      width: 8px;
      height: 0;
      border-bottom: 2px solid rgba(5, 11, 13, 0.9);
      transform: rotate(-45deg);
    }
    .activity-copy {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .activity-time {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
      justify-self: end;
    }
    .rail-list {
      display: grid;
      gap: 8px;
      padding: 12px;
      max-height: 300px;
      overflow: auto;
    }
    .rail-item {
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.38);
    }
    .rail-title {
      font-size: 12px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .rail-meta {
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .empty {
      padding: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .danger { color: var(--red); }
    .amber { color: #88601a; }
    .viewer {
      display: none;
      position: fixed;
      inset: 72px 28px 28px;
      z-index: 10;
      background: var(--panel);
      color: var(--ink);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.42);
      overflow: hidden;
    }
    .viewer.open { display: grid; grid-template-rows: 48px 1fr; }
    .viewer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      font-weight: 800;
    }
    .viewer pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    .link-button {
      border: 0;
      padding: 0;
      background: none;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: 250px minmax(0, 1fr); }
      .right-rail { display: none; }
      .overview { grid-template-columns: repeat(2, 1fr); }
      .hero { grid-column: span 2; }
    }
    @media (max-width: 820px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { order: 2; }
      .overview, .timeline-panel { grid-template-columns: 1fr; }
      .hero { grid-column: auto; }
      .top-actions .pill:nth-child(2) { display: none; }
    }

    /* 任务大屏视觉层：针对 YSIR Headquarters 大屏场景优化。 */
    :root {
      --bg: #070b0f;
      --panel: #101820;
      --panel-2: #141f28;
      --panel-3: #0c1218;
      --ink: #f5f0e5;
      --muted: #a7b0ad;
      --faint: #6f7c7a;
      --line: rgba(222, 235, 228, 0.12);
      --dark-panel: #101820;
      --dark-line: rgba(222, 235, 228, 0.12);
      --green: #63e27d;
      --amber: #f2bd54;
      --cyan: #78d8ce;
      --red: #ff735f;
      --cream: #f3ead8;
    }
    html { background: var(--bg); }
    body {
      min-width: 1120px;
      background:
        linear-gradient(90deg, rgba(99, 226, 125, 0.05), transparent 26%),
        radial-gradient(circle at 75% 18%, rgba(120, 216, 206, 0.08), transparent 28rem),
        var(--bg);
      color: var(--ink);
      overflow-x: auto;
    }
    .shell {
      min-width: 1120px;
      grid-template-rows: 56px 1fr;
    }
    .topbar {
      padding: 0 18px;
      background: rgba(7, 11, 15, 0.96);
      border-bottom-color: var(--line);
    }
    .mark {
      width: 32px;
      height: 32px;
      border-color: rgba(245, 240, 229, 0.32);
      color: var(--cream);
      background: linear-gradient(180deg, rgba(245, 240, 229, 0.1), rgba(245, 240, 229, 0.02));
      box-shadow: inset 0 0 0 1px rgba(99, 226, 125, 0.15);
    }
    h1 {
      font-size: 24px;
      color: var(--cream);
    }
    .subtitle { display: none; }
    .top-actions {
      gap: 10px;
      flex-wrap: nowrap;
    }
    .pill {
      border-radius: 7px;
      border-color: var(--line);
      background: rgba(255, 255, 255, 0.04);
      color: #cbd4d0;
    }
    .refresh {
      border-radius: 7px;
      border-color: var(--line);
      background: rgba(255, 255, 255, 0.05);
      color: var(--cream);
    }
    .layout {
      grid-template-columns: clamp(248px, 18vw, 282px) minmax(520px, 1fr) clamp(300px, 22vw, 354px);
      gap: 0;
      padding: 0;
      height: calc(100vh - 56px);
      min-height: 0;
      overflow: hidden;
    }
    .sidebar {
      gap: 0;
      padding: 16px 14px 18px 16px;
      border-right: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
        rgba(5, 11, 13, 0.72);
      min-height: 0;
      overflow: hidden;
    }
    .right-rail {
      gap: 12px;
      padding: 12px;
      border-left: 1px solid var(--line);
      min-height: 0;
      overflow: hidden;
    }
    .right-rail .panel:first-child {
      flex: 1 1 44%;
      min-height: 0;
    }
    .right-rail .panel:last-child {
      flex: 1.45 1 56%;
      min-height: 0;
    }
    .main {
      display: grid;
      gap: 10px;
      padding: 10px 12px;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
    }
    .overview,
    .timeline-panel {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }
    .panel {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
        var(--panel);
      color: var(--ink);
      border-color: var(--line);
      box-shadow: none;
    }
    .section-head {
      padding: 13px 14px;
      border-bottom-color: var(--line);
    }
    .section-title {
      color: var(--cream);
      font-size: 15px;
      letter-spacing: 0;
    }
    .section-meta, .metric-label, .task-line, .node-detail, .rail-meta, .activity-copy, .empty {
      color: var(--muted);
    }
    .search-wrap {
      position: relative;
      margin-bottom: 12px;
    }
    .search {
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      height: 38px;
      padding: 0 12px 0 36px;
      border: 1px solid rgba(222, 235, 228, 0.17);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.032);
      color: var(--ink);
      outline: none;
    }
    .search:focus {
      border-color: rgba(99, 226, 125, 0.42);
      box-shadow: 0 0 0 2px rgba(99, 226, 125, 0.08);
    }
    .search-icon,
    .search-kbd {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      pointer-events: none;
    }
    .search-icon {
      left: 12px;
      font-size: 16px;
    }
    .search-kbd {
      display: none;
    }
    .filters {
      grid-template-columns: 1fr;
      gap: 0;
      margin-bottom: 16px;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(222, 235, 228, 0.14);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.018);
    }
    .filter {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      height: 40px;
      padding: 0 11px 0 12px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid rgba(222, 235, 228, 0.08);
      border-radius: 0;
      color: #c7d0cc;
      text-align: left;
    }
    .filter::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0;
      background: var(--green);
      transition: width 120ms ease;
    }
    .filter.active::before { width: 3px; }
    .filter[data-filter="blocked"].active::before { background: var(--red); }
    .filter:last-child { border-bottom: 0; }
    .filter.active {
      background: linear-gradient(90deg, rgba(99, 226, 125, 0.11), rgba(99, 226, 125, 0.025));
      color: var(--green);
      border-color: rgba(99, 226, 125, 0.12);
    }
    .filter[data-filter="blocked"].active {
      background: linear-gradient(90deg, rgba(255, 115, 95, 0.2), rgba(242, 189, 84, 0.11));
      color: var(--red);
      border-color: rgba(255, 115, 95, 0.18);
    }
    .filter-label {
      display: inline-flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 0;
      gap: 9px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .filter-dot {
      width: 9px;
      height: 9px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--muted);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.03);
    }
    .filter-dot.green { background: var(--green); }
    .filter-dot.blue { background: #78a7d8; }
    .filter-dot.red { background: var(--red); }
    .filter-dot.gray { background: var(--faint); }
    .filter-count {
      flex: 0 0 20px;
      text-align: right;
      font-weight: 850;
    }
    .filters {
      align-content: start;
      grid-auto-rows: 40px;
      margin-bottom: 0;
      max-height: 178px;
      overflow: auto;
      min-height: 0;
      scrollbar-color: rgba(243, 238, 226, 0.28) rgba(255, 255, 255, 0.04);
      scrollbar-gutter: stable;
    }
    .task-list {
      display: grid;
      align-content: start;
      grid-auto-rows: max-content;
      gap: 10px;
      padding: 0;
      max-height: none;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      overscroll-behavior: contain;
      scrollbar-color: rgba(243, 238, 226, 0.28) rgba(255, 255, 255, 0.04);
      scrollbar-gutter: stable;
    }
    .filters::-webkit-scrollbar,
    .task-list::-webkit-scrollbar {
      width: 8px;
    }
    .filters::-webkit-scrollbar-track,
    .task-list::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 999px;
    }
    .filters::-webkit-scrollbar-thumb,
    .task-list::-webkit-scrollbar-thumb {
      background: rgba(243, 238, 226, 0.26);
      border-radius: 999px;
    }
    .filters::-webkit-scrollbar-thumb:hover,
    .task-list::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 226, 125, 0.5);
    }
    .task-item {
      padding: 0;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(99, 226, 125, 0.03), rgba(255, 255, 255, 0.018)),
        rgba(255, 255, 255, 0.018);
      border-color: rgba(222, 235, 228, 0.14);
      color: var(--ink);
      text-align: left;
    }
    .task-item.blocked {
      border-color: rgba(242, 189, 84, 0.22);
      background:
        linear-gradient(180deg, rgba(242, 189, 84, 0.045), rgba(255, 255, 255, 0.016)),
        rgba(255, 255, 255, 0.018);
    }
    .task-item.active {
      background:
        linear-gradient(180deg, rgba(99, 226, 125, 0.08), rgba(99, 226, 125, 0.02)),
        rgba(255, 255, 255, 0.022);
      border-color: rgba(99, 226, 125, 0.6);
      box-shadow: inset 4px 0 0 var(--green), 0 14px 28px rgba(0, 0, 0, 0.18);
    }
    .task-title { color: var(--cream); }
    .mini-bar { background: rgba(255, 255, 255, 0.08); }
    .overview { display: block; }
    .hero {
      grid-column: 1 / -1;
      height: auto;
      min-height: 0;
      padding: 0;
      border-radius: 5px;
      border-bottom: 1px solid var(--line);
    }
    .hero-label {
      display: flex;
      align-items: center;
      height: 40px;
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
      color: var(--cream);
      font-size: 16px;
      font-weight: 800;
    }
    .ops-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.42fr) minmax(0, 0.74fr) minmax(0, 0.74fr);
      gap: 16px;
      padding: 14px 18px 16px;
    }
    .ops-cell {
      min-width: 0;
      border-right: 1px solid var(--line);
      padding-right: 26px;
    }
    .ops-cell:last-child {
      border-right: 0;
      padding-right: 0;
    }
    .ops-label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .hero h2 {
      margin: 0 0 8px;
      font-size: 24px;
      color: var(--cream);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }
    .hero p {
      color: #c9d1cd;
      font-size: 13px;
      line-height: 1.55;
      max-width: 640px;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }
    .state-readout {
      color: var(--green);
      font-size: 22px;
      font-weight: 850;
      line-height: 1.15;
      overflow-wrap: normal;
    }
    .state-sub {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .state-chip-row {
      display: none;
    }
    .file-chip, .state-chip {
      min-height: 24px;
      border-radius: 5px;
      border-color: var(--line);
      color: #cbd5d0;
      background: rgba(255, 255, 255, 0.035);
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .state-chip.current {
      color: #08210e;
      background: var(--green);
      border-color: var(--green);
    }
    .stage-rail {
      display: grid;
      grid-template-columns: repeat(6, minmax(70px, 1fr));
      gap: 8px;
      padding: 12px 18px 13px;
      border-top: 1px solid rgba(222, 235, 228, 0.1);
      background: rgba(255, 255, 255, 0.012);
      align-items: start;
    }
    .stage-step {
      position: relative;
      display: grid;
      justify-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--muted);
      text-align: center;
    }
    .stage-step:not(:last-child)::after {
      content: "";
      position: absolute;
      top: 16px;
      left: calc(50% + 22px);
      right: calc(-50% + 22px);
      height: 2px;
      background: linear-gradient(90deg, rgba(99, 226, 125, 0.8), rgba(255, 255, 255, 0.18));
    }
    .stage-dot {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid var(--line);
      background: #0d151c;
      color: var(--muted);
      font-size: 13px;
      z-index: 1;
    }
    .stage-step.completed .stage-dot {
      color: var(--green);
      border-color: rgba(99, 226, 125, 0.38);
      background: rgba(99, 226, 125, 0.12);
    }
    .stage-step.current .stage-dot {
      color: #07170b;
      border-color: var(--green);
      background: var(--green);
      box-shadow: 0 0 0 8px rgba(99, 226, 125, 0.08);
    }
    .stage-name {
      color: var(--cream);
      font-weight: 800;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .stage-status {
      color: var(--muted);
      font-size: 12px;
    }
    .metric {
      display: none;
      min-height: 76px;
      padding: 12px;
      border-top: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.028);
    }
    .metric-value {
      color: var(--cream);
      font-size: 24px;
    }
    .timeline-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(140px, auto) minmax(0, 1fr);
      border-radius: 5px;
      border-top: 1px solid var(--line);
      min-height: 0;
      overflow: hidden;
    }
    .history-layer {
      min-width: 0;
      min-height: 0;
      border-bottom: 1px solid var(--line);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .timeline {
      display: flex;
      align-items: stretch;
      gap: 10px;
      padding: 10px 14px 10px;
      max-height: none;
      min-height: 0;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      scrollbar-color: rgba(243, 238, 226, 0.28) rgba(255, 255, 255, 0.04);
      scrollbar-gutter: stable;
    }
    .timeline::-webkit-scrollbar {
      height: 8px;
    }
    .timeline::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 999px;
    }
    .timeline::-webkit-scrollbar-thumb {
      background: rgba(243, 238, 226, 0.26);
      border-radius: 999px;
    }
    .timeline::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 226, 125, 0.5);
    }
    .node {
      display: block;
      flex: 0 0 var(--node-width, 188px);
      width: var(--node-width, 188px);
      padding-bottom: 0;
    }
    .node::before,
    .node:not(:last-child)::before,
    .node-dot {
      display: none;
    }
    .node-card {
      box-sizing: border-box;
      height: 100px;
      padding: 10px 10px 12px;
      border-color: var(--line);
      background: rgba(255, 255, 255, 0.035);
      overflow: hidden;
    }
    .timeline .node-top {
      display: block;
    }
    .node.current .node-card {
      border-color: rgba(99, 226, 125, 0.72);
      box-shadow: inset 0 0 0 1px rgba(99, 226, 125, 0.18);
    }
    .node-name {
      color: var(--cream);
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-title-label {
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 850;
    }
    .node-tags {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      min-width: 0;
      margin-top: 6px;
      overflow: visible;
      white-space: nowrap;
    }
    .node-title-stage {
      flex: 0 0 auto;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 1px 5px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 5px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.045);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.45;
    }
    .timeline .badge {
      flex: 0 0 auto;
      display: inline-flex;
      margin-top: 0;
      white-space: nowrap;
    }
    .node-detail {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .node-objective {
      -webkit-line-clamp: 2;
      margin-bottom: 2px;
    }
    .badge {
      background: rgba(255, 255, 255, 0.07);
      color: var(--muted);
    }
    .badge.current { color: var(--green); background: rgba(99, 226, 125, 0.12); }
    .activity {
      border-left: 0;
      border-top: 1px solid var(--line);
      background: transparent;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
      max-height: none;
      padding: 12px 14px 14px;
      overflow: hidden;
    }
    .activity .section-title {
      margin-bottom: 8px;
    }
    #activity-list {
      min-height: 0;
      max-height: none;
      overflow: auto;
      padding-right: 4px;
      border-top: 1px solid rgba(222, 235, 228, 0.08);
    }
    .activity-item {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      position: relative;
      min-height: 42px;
      margin-top: 7px;
      padding: 8px 12px;
      border: 1px solid rgba(222, 235, 228, 0.105);
      border-radius: 7px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.023));
      transition: border-color 140ms ease, background 140ms ease;
    }
    .activity-item::before {
      content: "";
      position: absolute;
      left: 17px;
      top: -8px;
      bottom: -8px;
      width: 1px;
      background: rgba(222, 235, 228, 0.12);
    }
    .activity-item:first-child::before {
      top: 17px;
    }
    .activity-item:last-child::before {
      bottom: 17px;
    }
    .activity-item:hover {
      border-color: rgba(99, 226, 125, 0.34);
      background: linear-gradient(180deg, rgba(99, 226, 125, 0.07), rgba(255, 255, 255, 0.026));
    }
    .activity-marker {
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      z-index: 1;
    }
    .activity-kind {
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: rgba(222, 235, 228, 0.44);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.035);
      position: relative;
    }
    .activity-kind::after {
      content: "";
      position: absolute;
      left: 5px;
      top: 3px;
      width: 4px;
      height: 7px;
      border: solid rgba(5, 11, 13, 0.9);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .activity-kind.commit { background: var(--cyan); }
    .activity-kind.review { background: #8eb7ee; }
    .activity-kind.test { background: var(--green); }
    .activity-kind.file { background: var(--amber); }
    .activity-kind.failed { background: var(--red); }
    .activity-kind.failed::after {
      left: 4px;
      top: 7px;
      width: 8px;
      height: 0;
      border-width: 0 0 2px 0;
      transform: rotate(45deg);
      box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
    }
    .activity-kind.failed::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 7px;
      width: 8px;
      height: 0;
      border-bottom: 2px solid rgba(5, 11, 13, 0.9);
      transform: rotate(-45deg);
    }
    .activity-item.failed {
      border-color: rgba(255, 115, 95, 0.28);
      background: linear-gradient(180deg, rgba(255, 115, 95, 0.09), rgba(255, 255, 255, 0.022));
    }
    .activity-copy {
      margin: 0;
      color: rgba(243, 238, 226, 0.88);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .activity-time {
      color: rgba(222, 235, 228, 0.66);
      font-size: 12px;
      white-space: nowrap;
      justify-self: end;
    }
    .rail-list {
      max-height: none;
      min-height: 0;
      overflow: auto;
      padding: 10px;
      scrollbar-color: rgba(243, 238, 226, 0.28) rgba(255, 255, 255, 0.04);
      scrollbar-gutter: stable;
    }
    .rail-list::-webkit-scrollbar {
      width: 8px;
    }
    .rail-list::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 999px;
    }
    .rail-list::-webkit-scrollbar-thumb {
      background: rgba(243, 238, 226, 0.26);
      border-radius: 999px;
    }
    .rail-list::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 226, 125, 0.5);
    }
    .rail-item {
      background: rgba(255, 255, 255, 0.035);
      border-color: var(--line);
      color: var(--ink);
    }
    .rail-item.error {
      border-color: rgba(255, 115, 95, 0.28);
      background: linear-gradient(90deg, rgba(255, 115, 95, 0.12), rgba(255, 115, 95, 0.045));
    }
    .rail-item.warn {
      border-color: rgba(242, 189, 84, 0.28);
      background: linear-gradient(90deg, rgba(242, 189, 84, 0.12), rgba(242, 189, 84, 0.045));
    }
    .rail-title { color: var(--cream); }
    .rail-title.danger { color: var(--red); }
    .rail-title.amber { color: var(--amber); }
    .viewer {
      background: var(--panel);
      color: var(--ink);
      border-color: var(--line);
    }
    .viewer-head { border-bottom-color: var(--line); }
    .side-label {
      margin: 0 4px 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }
    .project-select {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 34px;
      margin-bottom: 12px;
      padding: 0 11px;
      border: 1px solid rgba(222, 235, 228, 0.18);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.032);
      color: var(--cream);
      font-weight: 700;
    }
    .sidebar .panel {
      background: transparent;
      border: 0;
      box-shadow: none;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 14px;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    .sidebar-filter-area,
    .sidebar-task-area {
      display: grid;
      min-height: 0;
    }
    .sidebar-filter-area {
      grid-template-rows: auto auto auto;
    }
    .sidebar-task-area {
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .sidebar .section-head {
      padding: 14px 2px 10px;
      border-bottom: 0;
    }
    .filter-heading,
    .task-nav-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 14px 2px 8px;
      color: var(--cream);
      font-size: 14px;
      font-weight: 800;
    }
    .filter-heading {
      height: auto;
      margin: 8px 2px 7px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: rgba(243, 238, 226, 0.86);
      font-size: 13px;
    }
    .filter-heading span:first-child {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .task-nav-head {
      margin: 0 0 10px;
    }
    .task-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .task-count-badge {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }
    .ghost-action {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.035);
      color: var(--cream);
      font: inherit;
      cursor: pointer;
    }
    .ghost-action {
      min-height: 30px;
      padding: 0 9px;
      font-size: 12px;
    }
    .task-card-body {
      padding: 15px 12px 12px;
    }
    .task-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .task-status {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 0 8px;
      flex: 0 0 auto;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }
    .task-status.in-progress { color: var(--green); border-color: rgba(99, 226, 125, 0.25); background: rgba(99, 226, 125, 0.11); }
    .task-status.done { color: #9fc7f0; border-color: rgba(120, 167, 216, 0.24); background: rgba(120, 167, 216, 0.1); }
    .task-status.blocked { color: var(--red); border-color: rgba(255, 115, 95, 0.35); background: rgba(255, 115, 95, 0.1); }
    .task-description {
      margin: 0 0 14px;
      color: #c8d0cc;
      font-size: 12px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .task-progress {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 0;
      color: #d7ded9;
      font-size: 12px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 0 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.07);
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }
    .status-pill.current,
    .status-pill.completed {
      background: rgba(99, 226, 125, 0.12);
      color: var(--green);
    }
    .status-pill.failed {
      background: rgba(255, 115, 95, 0.14);
      color: var(--red);
    }
    .status-pill.blocked {
      background: rgba(242, 189, 84, 0.14);
      color: var(--amber);
    }
    .file-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .file-list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .file-time {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: 248px minmax(520px, 1fr) 300px; }
      .right-rail { display: flex; }
      .overview { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .hero { grid-column: 1 / -1; }
    }
    @media (max-width: 820px) {
      .layout { grid-template-columns: 248px minmax(520px, 1fr) 300px; }
      .sidebar { order: initial; }
      .overview { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .timeline-panel { grid-template-columns: minmax(0, 1fr); }
      .top-actions .pill:nth-child(2) { display: inline-flex; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark">Y</div>
        <div>
          <h1>YSIR Headquarters</h1>
          <div class="subtitle">.report 本地任务大屏</div>
        </div>
      </div>
      <div class="top-actions">
        <span class="pill"><span class="dot"></span><span id="server-pill">127.0.0.1</span></span>
        <span class="pill">最近更新 <span id="last-updated">--</span></span>
        <button class="refresh" id="refresh">刷新</button>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">
        <div class="side-label">项目</div>
        <div class="project-select"><span id="project-name">--</span><span>⌄</span></div>
        <section class="panel">
          <div class="sidebar-filter-area">
            <div class="search-wrap">
              <span class="search-icon">⌕</span>
              <input class="search" id="search" placeholder="搜索任务..." />
            </div>
            <div class="filter-heading"><span>筛选</span></div>
            <div class="filters">
              <button class="filter active" data-filter="in-progress"><span class="filter-label"><span class="filter-dot green"></span>进行中 / In Progress</span><span class="filter-count" id="filter-in-progress">0</span></button>
              <button class="filter" data-filter="done"><span class="filter-label"><span class="filter-dot blue"></span>已归档 / Done</span><span class="filter-count" id="filter-done">0</span></button>
              <button class="filter" data-filter="blocked"><span class="filter-label"><span class="filter-dot red"></span>Blocked</span><span class="filter-count" id="filter-blocked">0</span></button>
              <button class="filter" data-filter="all"><span class="filter-label"><span class="filter-dot gray"></span>全部 / All</span><span class="filter-count" id="filter-all">0</span></button>
            </div>
          </div>
          <div class="sidebar-task-area">
            <div class="task-nav-head">
              <span>任务列表</span>
              <span class="task-count-badge" id="task-count">0</span>
            </div>
            <div class="task-list" id="task-list"></div>
          </div>
        </section>
      </aside>
      <main class="main">
        <section class="overview">
          <article class="panel dark-card hero">
            <div class="hero-label">▤ 任务概览</div>
            <div class="ops-grid">
              <div class="ops-cell">
                <div class="ops-label">当前任务</div>
                <h2 id="active-title">等待扫描 .report</h2>
                <p id="active-goal" title="启动后会动态读取当前项目的 .report 目录。">启动后会动态读取当前项目的 .report 目录。</p>
              </div>
              <div class="ops-cell">
                <div class="ops-label">state.current</div>
                <div class="state-readout" id="current-node">--</div>
                <div class="state-sub" id="current-status">--</div>
              </div>
              <div class="ops-cell">
                <div class="ops-label">阶段 (Stage)</div>
                <div class="state-readout" id="current-stage">--</div>
                <div class="state-sub" id="current-phase">--</div>
              </div>
            </div>
            <div class="stage-rail" id="stage-rail"></div>
            <div class="state-chip-row" id="active-chips"></div>
          </article>
          <article class="panel metric accent-green">
            <div class="metric-value" id="metric-progress">0</div>
            <div class="metric-label">进行中</div>
          </article>
          <article class="panel metric accent-cyan">
            <div class="metric-value" id="metric-done">0</div>
            <div class="metric-label">已归档</div>
          </article>
          <article class="panel metric accent-amber">
            <div class="metric-value" id="metric-evidence">0</div>
            <div class="metric-label">证据</div>
          </article>
          <article class="panel metric accent-red">
            <div class="metric-value" id="metric-anomalies">0</div>
            <div class="metric-label">异常</div>
          </article>
        </section>
        <section class="panel timeline-panel">
          <div class="history-layer">
            <div class="section-head">
              <div class="section-title">历史节点 (History Nodes)</div>
              <div class="section-meta" id="timeline-meta">--</div>
            </div>
            <div class="timeline" id="timeline"></div>
          </div>
          <div class="activity note-flow">
            <div class="section-title">过程记录 (History Notes)</div>
            <div id="activity-list"></div>
          </div>
        </section>
      </main>
      <aside class="right-rail">
        <section class="panel">
          <div class="section-head">
            <div class="section-title">证据 (Evidence)</div>
            <div class="section-meta" id="evidence-count">0</div>
          </div>
          <div class="rail-list" id="evidence-list"></div>
        </section>
        <section class="panel">
          <div class="section-head">
            <div class="section-title">异常 (Anomalies)</div>
            <div class="section-meta" id="anomaly-count">0</div>
          </div>
          <div class="rail-list" id="anomaly-list"></div>
        </section>
      </aside>
    </div>
  </div>
  <div class="viewer" id="viewer">
    <div class="viewer-head">
      <span id="viewer-title">文件</span>
      <button class="refresh" id="viewer-close">关闭</button>
    </div>
    <pre id="viewer-content"></pre>
  </div>
  <script>
    const state = { data: null, activeTaskId: "", filter: "in-progress", search: "" };
    const $ = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    const formatTime = (value) => {
      if (!value) return "--";
      const date = typeof value === "number" ? new Date(value) : new Date(value);
      if (Number.isNaN(date.getTime())) return "--";
      return date.toLocaleString("zh-CN", { hour12: false });
    };
    const toMillis = (value) => {
      if (!value) return 0;
      const millis = typeof value === "number" ? value : new Date(value).getTime();
      return Number.isFinite(millis) ? millis : 0;
    };
    const classForStatus = (status) => ["current", "completed", "failed", "blocked"].includes(status) ? status : "";
    const textUnits = (value) => [...String(value || "")].reduce((total, char) => {
      return total + (/[\u3400-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1);
    }, 0);
    const timelineNodeWidth = (stage) => {
      const title = stage.timelineLabel || stage.label || "";
      const status = stage.statusLabel || "";
      const stageName = stage.stageName || stage.label || "";
      const titleWidth = 30 + textUnits(title) * 7.4;
      const tagsWidth = 60 + (textUnits(status) + textUnits(stageName)) * 7.2;
      return Math.min(360, Math.max(188, titleWidth, tagsWidth));
    };
    const stageIcon = (node) => {
      const value = [node.stage, node.label, node.id].join(" ").toLowerCase();
      if (value.includes("order")) return "▣";
      if (value.includes("plan")) return "▤";
      if (value.includes("develop") || value.includes("开发")) return "</>";
      if (value.includes("test") || value.includes("测试")) return "⚗";
      if (value.includes("review") || value.includes("审查")) return "◎";
      if (value.includes("commit") || value.includes("提交")) return "⇧";
      return "•";
    };
    const compactStageName = (node) => {
      const stage = node.stage || node.label || node.id || "";
      if (stage.includes("develop")) return "develop";
      if (stage.includes("acceptance-test")) return "test";
      if (stage.includes("acceptance-review")) return "review";
      if (stage.includes("delivery-commit")) return "commit";
      if (stage.includes("human-acceptance")) return "accept";
      return (node.label || stage || "node").replace(/^验收：/, "").replace(/^交付：/, "");
    };
    const matchesLifecycleStage = (node, key) => {
      const value = [node?.stage, node?.label, node?.id].join(" ").toLowerCase();
      if (key === "develop") return value.includes("develop") || value.includes("开发");
      if (key === "test") return value.includes("test") || value.includes("测试");
      if (key === "review") return value.includes("review") || value.includes("审查");
      if (key === "commit") return value.includes("commit") || value.includes("提交");
      return false;
    };
    const nodeLatestAt = (task, node) => {
      const events = (task?.history || []).filter((event) => event.node === node?.id);
      return Math.max(0, ...events.map((event) => toMillis(event.at)));
    };
    const latestNodeForStage = (task, key) => {
      return (task?.nodes || [])
        .filter((node) => matchesLifecycleStage(node, key))
        .map((node, index) => ({ node, index, at: nodeLatestAt(task, node), attempt: node.attempt || 1 }))
        .sort((left, right) => {
          if (left.at !== right.at) return right.at - left.at;
          if (left.attempt !== right.attempt) return right.attempt - left.attempt;
          return right.index - left.index;
        })[0]?.node || null;
    };
    const lifecycleStages = (task) => {
      // 顶部轨道：schema 层面的生命周期检查点。遇到重试时，每个阶段取最新节点，
      // 让任务概览反映修复后的结果。
      const current = task?.progress?.current;
      const nodes = nodesForCurrentAttempt(task);
      const findStage = (key) => nodes.find((node) => matchesLifecycleStage(node, key)) || latestNodeForStage(task, key);
      const planned = [
        { key: "order", label: "需求确认", objective: "确认需求目标与验收边界", status: task.orderPath ? "completed" : "pending", time: task.orderPath ? "已确认" : "待补充", icon: "▣" },
        { key: "plan", label: "方案确认", objective: "确认实现方案与执行路径", status: task.planPath ? "completed" : "pending", time: task.planPath ? "已完成" : "待补充", icon: "▤" },
        { key: "develop", label: "develop", node: findStage("develop"), icon: "</>" },
        { key: "test", label: "test", node: findStage("test"), icon: "⚗" },
        { key: "review", label: "review", node: findStage("review"), icon: "◎" },
        { key: "commit", label: "commit", node: findStage("commit"), icon: "⇧" },
      ];
      return planned.map((item) => {
        const node = item.node;
        const status = node?.status || item.status || "pending";
        return {
          ...item,
          status,
          statusLabel: node?.statusLabel || (status === "completed" ? "已完成" : status === "current" ? "进行中" : status === "failed" ? "失败" : "待开始"),
          active: current && node && current.id === node.id,
          detail: node?.note || item.time || "",
          timelineLabel: node?.label || item.label,
          timelineObjective: node?.objective || item.objective || "",
          stageName: node?.stage || item.key || item.label,
        };
      });
    };
    const timelineSummaryItems = (task) => {
      const stages = historyNodes(task);
      const completed = stages.filter((stage) => stage.status === "completed").length;
      const historicalProblems = stages.filter((stage) => ["failed", "blocked"].includes(stage.status)).length;
      const failed = task?.progress?.failed || 0;
      const blocked = task?.progress?.blocked || 0;
      const pending = stages.filter((stage) => !["completed", "failed", "blocked"].includes(stage.status)).length;
      const items = [{ kind: "done", label: String(completed) + " 完成" }];
      if (failed || blocked) {
        if (failed) items.push({ kind: "failed", label: String(failed) + " 失败待修复" });
        if (blocked) items.push({ kind: "failed", label: String(blocked) + " 阻塞待处理" });
        return items;
      }
      if (pending) {
        items.push({ kind: "pending", label: String(pending) + " 待处理" });
        return items;
      }
      if (historicalProblems) {
        items[0].label = String(completed + historicalProblems) + " 完成";
        items.push({ kind: "rework", label: String(historicalProblems) + " 次返工" });
      }
      return items;
    };
    const renderSummaryPills = (items) => {
      return '<span class="summary-pills">' + items.map((item) => {
        return '<span class="summary-pill ' + escapeHtml(item.kind) + '">' + escapeHtml(item.label) + '</span>';
      }).join("") + '</span>';
    };
    const nodeById = (task, nodeId) => (task?.nodes || []).find((node) => node.id === nodeId) || null;
    const historyNodeStatus = (item, node) => item?.status || node?.status || "pending";
    const historyNodes = (task) => {
      // 中间轨道：从 state.history 观察到的实际节点。order/plan 是文档产物，
      // 不是普通状态图节点，因此作为人工确认边界节点补入。
      const items = [];
      if (task?.orderPath) {
        items.push({
          id: "order",
          label: "需求确认",
          stage: "order",
          status: "completed",
          statusLabel: "完成",
          objective: "确认需求目标与验收边界",
          source: "order",
        });
      }
      if (task?.planPath) {
        items.push({
          id: "plan",
          label: "方案确认",
          stage: "plan",
          status: "completed",
          statusLabel: "完成",
          objective: "确认实现方案与执行路径",
          source: "plan",
        });
      }
      const seen = new Set(items.map((item) => item.id));
      const byId = new Map(items.map((item) => [item.id, item]));
      const history = [...(task?.history || [])].sort((left, right) => toMillis(left.at) - toMillis(right.at));
      for (const event of history) {
        if (!event.node) continue;
        const node = nodeById(task, event.node);
        const status = historyNodeStatus(event, node);
        const nextItem = {
          id: event.node,
          label: event.label || node?.label || event.node,
          stage: node?.stage || event.node,
          status,
          statusLabel: statusLabel(status),
          objective: event.objective || node?.objective || event.note || "",
          source: "history",
        };
        if (seen.has(event.node)) {
          Object.assign(byId.get(event.node), nextItem);
          continue;
        }
        items.push(nextItem);
        byId.set(event.node, nextItem);
        seen.add(event.node);
      }
      return items;
    };
    const nodesForCurrentAttempt = (task) => {
      // 任务仍在推进时优先展示当前尝试；已完成任务可能没有 current，
      // 因此回退到最新生命周期节点。
      const current = task?.progress?.current;
      if (!current) {
        const latest = ["develop", "test", "review", "commit"].map((key) => latestNodeForStage(task, key)).filter(Boolean);
        return latest.length ? latest : task?.nodes?.slice(0, 6) || [];
      }
      const attempt = current.attempt || 1;
      const phase = current.phase || "";
      const scoped = task.nodes.filter((node) => {
        return (node.attempt || 1) === attempt && (!phase || node.phase === phase);
      });
      return scoped.length ? scoped.slice(0, 6) : task.nodes.slice(0, 6);
    };
    async function loadDashboard() {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      state.data = await response.json();
      if (!state.activeTaskId) state.activeTaskId = state.data.activeTaskId;
      if (state.filter !== "all" && !state.data.tasks.some((task) => task.status === state.filter)) {
        state.filter = state.data.summary.blocked ? "blocked" : "all";
      }
      render();
    }
    function activeTask() {
      return state.data?.tasks.find((task) => task.id === state.activeTaskId) || state.data?.tasks[0] || null;
    }
    function render() {
      const data = state.data;
      if (!data) return;
      $("project-name").textContent = data.project.name;
      $("server-pill").textContent = location.host;
      $("last-updated").textContent = formatTime(data.summary.updatedAt || data.generatedAt);
      $("filter-in-progress").textContent = String(data.summary.inProgress);
      $("filter-done").textContent = String(data.summary.done);
      $("filter-blocked").textContent = String(data.summary.blocked || 0);
      $("filter-all").textContent = String(data.tasks.length);
      document.querySelectorAll(".filter").forEach((button) => {
        button.classList.toggle("active", button.dataset.filter === state.filter);
      });
      $("metric-progress").textContent = data.summary.inProgress;
      $("metric-done").textContent = data.summary.done;
      $("metric-evidence").textContent = data.summary.evidence;
      $("metric-anomalies").textContent = data.summary.anomalies;
      renderTaskList();
      renderActive();
      renderRails();
    }
    function filteredTasks() {
      const text = state.search.trim().toLowerCase();
      return state.data.tasks.filter((task) => {
        if (state.filter !== "all" && task.status !== state.filter) return false;
        if (!text) return true;
        return [task.title, task.name, task.path, task.goal].join(" ").toLowerCase().includes(text);
      });
    }
    function renderTaskList() {
      const tasks = filteredTasks().slice().sort((left, right) => right.updatedAt - left.updatedAt);
      $("task-count").textContent = String(tasks.length);
      $("task-list").innerHTML = tasks.length ? tasks.map((task) => \`
        <button class="task-item \${task.id === state.activeTaskId ? "active" : ""} \${task.status === "blocked" ? "blocked" : ""}" data-task-id="\${escapeHtml(task.id)}">
          <div class="task-card-body">
            <div class="task-heading">
              <span class="task-title">\${escapeHtml(task.title)}</span>
              <span class="task-status \${task.status}">\${task.status === "done" ? "Done" : task.status === "blocked" ? "Blocked" : "Active"}</span>
            </div>
            <p class="task-description">\${escapeHtml(task.goal || task.path)}</p>
            <div class="task-progress">
              <span>\${task.progress.percent}%</span>
              <div class="mini-bar"><span style="--value:\${task.progress.percent}%"></span></div>
              <span>\${task.progress.percent}%</span>
            </div>
          </div>
        </button>
      \`).join("") : '<div class="empty">没有匹配任务。</div>';
      document.querySelectorAll("[data-task-id]").forEach((button) => {
        button.addEventListener("click", () => {
          state.activeTaskId = button.dataset.taskId;
          render();
        });
      });
    }
    function renderActive() {
      const task = activeTask();
      if (!task) {
        const title = state.data.project.reportExists ? "暂无任务" : "未发现 .report";
        const goal = state.data.project.reportExists ? "当前 .report 中没有 in-progress 或 done 任务。" : "项目根目录下还没有 .report 目录。";
        $("active-title").textContent = title;
        $("active-title").title = title;
        $("active-goal").textContent = goal;
        $("active-goal").title = goal;
        $("current-node").textContent = "--";
        $("current-status").textContent = "--";
        $("current-stage").textContent = "--";
        $("current-phase").textContent = "--";
        $("stage-rail").innerHTML = "";
        $("active-chips").innerHTML = "";
        $("timeline").innerHTML = '<div class="empty">暂无状态图。</div>';
        $("timeline-meta").textContent = "--";
        $("activity-list").innerHTML = '<div class="empty">暂无活动。</div>';
        return;
      }
      const activeGoal = task.goal || "未从 order.md 或 plan.md 提取到摘要。";
      $("active-title").textContent = task.title;
      $("active-title").title = task.title;
      $("active-goal").textContent = activeGoal;
      $("active-goal").title = activeGoal;
      $("timeline-meta").innerHTML = renderSummaryPills(timelineSummaryItems(task));
      const current = task.progress.current;
      $("current-node").textContent = current ? compactStageName(current) : (task.progress.percent === 100 ? "done" : "current 为空");
      $("current-status").textContent = current ? task.stateCurrent : (task.progress.percent === 100 ? "状态图已完成" : "未确认");
      $("current-stage").textContent = current ? compactStageName(current) : (task.progress.percent === 100 ? "done" : "--");
      $("current-phase").textContent = current?.phase || task.stateSchema || "--";
      renderStageRail(task);
      const chips = [
        task.stateCurrent ? ["current", "current: " + task.stateCurrent] : ["", "current 为空"],
        task.stateSchema ? ["", "schema: " + task.stateSchema] : ["", "schema 未确认"],
        task.orderPath ? ["file", task.orderPath] : null,
        task.planPath ? ["file", task.planPath] : null,
        task.statePath ? ["file", task.statePath] : null,
      ].filter(Boolean);
      $("active-chips").innerHTML = chips.map(([kind, label]) => {
        const cls = kind === "current" ? "state-chip current" : "file-chip";
        const path = kind === "file" ? \` data-file="\${escapeHtml(label)}"\` : "";
        return \`<button class="\${cls} link-button"\${path}>\${escapeHtml(label)}</button>\`;
      }).join("");
      bindFileButtons();
      renderTimeline(task);
      renderActivity(task);
    }
    function renderStageRail(task) {
      const stages = lifecycleStages(task);
      $("stage-rail").innerHTML = stages.length ? stages.map((stage) => \`
        <div class="stage-step \${classForStatus(stage.status)}">
          <div class="stage-dot">\${escapeHtml(stage.icon)}</div>
          <div class="stage-name">\${escapeHtml(stage.label)}</div>
          <div class="stage-status">\${escapeHtml(stage.statusLabel)}</div>
        </div>
      \`).join("") : '<div class="empty">暂无阶段轨道。</div>';
    }
    function renderTimeline(task) {
      const stages = historyNodes(task);
      $("timeline").innerHTML = stages.length ? stages.map((stage) => \`
        <div class="node \${classForStatus(stage.status)}" style="--node-width: \${timelineNodeWidth(stage)}px">
          <div class="node-dot"></div>
          <div class="node-card">
            <div class="node-top">
              <div class="node-name">
                <span class="node-title-label">\${escapeHtml(stage.label || stage.id)}</span>
              </div>
            </div>
            <div class="node-tags">
              <span class="node-title-stage">\${escapeHtml(stage.stage || stage.id)}</span>
              <span class="badge \${classForStatus(stage.status)}">\${escapeHtml(stage.statusLabel)}</span>
            </div>
            <div class="node-detail node-objective">\${escapeHtml(stage.objective || "暂无目标说明")}</div>
          </div>
        </div>
      \`).join("") : '<div class="empty">该任务没有可展示的 state 节点。</div>';
    }
    function artifactFromNote(note) {
      const text = String(note || "");
      const file = text.match(/(?:^|\\s)([\\w.-]+\\.md)\\b/);
      if (file) return file[1];
      const commit = text.match(/\\bcommit\\s+([0-9a-f]{7,40})\\b/i);
      if (commit) return \`commit:\${commit[1].slice(0, 7)}\`;
      const test = text.match(/\\b(test-round-[\\w.-]+)\\b/i);
      if (test) return test[1];
      const review = text.match(/\\b(cr-round-[\\w.-]+)\\b/i);
      if (review) return review[1];
      return "";
    }
    function activityKind(artifact, note = "") {
      const text = [artifact, note].join(" ").toLowerCase();
      if (text.includes("commit")) return "commit";
      if (text.includes("test-round")) return "test";
      if (text.includes("cr-round") || text.includes("review")) return "review";
      if (artifact) return "file";
      return "";
    }
    function activityChip(kind, artifact) {
      if (!artifact) return "";
      const value = String(artifact);
      if (kind === "commit") return value.replace(/^commit:/, "commit · ");
      if (kind === "test") return \`test · \${value}\`;
      if (kind === "review") return \`review · \${value}\`;
      if (kind === "order") return \`order · \${value}\`;
      if (kind === "plan") return \`plan · \${value}\`;
      if (kind === "file") return \`file · \${value}\`;
      return value;
    }
    function resultFromHistory(item) {
      const note = String(item.note || "").trim();
      if (note) {
        const artifact = artifactFromNote(note);
        let result = note
          .replace(/\\bcommit\\s+[0-9a-f]{7,40}\\b/ig, "")
          .replace(/\\b[\\w.-]+\\.md\\b/g, "")
          .replace(/\\s*[;:/|]\\s*/g, " ")
          .replace(/\\s{2,}/g, " ")
          .trim();
        if (artifact) {
          const stem = artifact.replace(/\\.md$/i, "");
          result = result.replaceAll(artifact, "").replaceAll(stem, "").replace(/\\s{2,}/g, " ").trim();
        }
        if (artifact.startsWith("commit:") && (!result || result === statusLabel(item.status))) {
          return "代码已提交";
        }
        if (item.status === "current" && (!result || result === statusLabel(item.status))) {
          return "进入当前阶段";
        }
        return result || statusLabel(item.status);
      }
      if (item.status === "current") return "进入当前阶段";
      return statusLabel(item.status);
    }
    function statusLabel(status) {
      const labels = {
        completed: "已完成",
        current: "进行中",
        failed: "失败",
        blocked: "阻塞",
        pending: "待处理",
      };
      return labels[status] || status || "更新";
    }
    function renderActivity(task) {
      // 底部轨道只展示事件流。这里不展示产物标签，避免和证据面板重复，
      // 让过程记录更像简洁的操作日志。
      const rows = [
        task.orderPath ? {
          artifact: task.orderPath,
          at: toMillis(task.orderUpdatedAt),
          kind: "order",
          status: "completed",
          chip: activityChip("order", task.orderPath),
          path: task.orderPath,
          result: "需求确认完成",
          time: formatTime(task.orderUpdatedAt),
        } : null,
        task.planPath ? {
          artifact: task.planPath,
          at: toMillis(task.planUpdatedAt),
          kind: "plan",
          status: "completed",
          chip: activityChip("plan", task.planPath),
          path: task.planPath,
          result: "方案确认完成",
          time: formatTime(task.planUpdatedAt),
        } : null,
        ...task.history.filter((item) => ["completed", "failed"].includes(item.status)).map((item) => {
          const artifact = artifactFromNote(item.note);
          const kind = activityKind(artifact, item.note);
          return {
            artifact,
            at: toMillis(item.at),
            kind,
            status: item.status,
            chip: activityChip(kind, artifact),
            result: resultFromHistory(item),
            time: formatTime(item.at),
          };
        }),
      ].filter(Boolean).sort((left, right) => right.at - left.at);
      $("activity-list").innerHTML = rows.length ? rows.map((item) => \`
        <div class="activity-item \${classForStatus(item.status)}">
          <div class="activity-marker">
            <span class="activity-kind \${escapeHtml(item.kind || "")} \${item.status === "failed" ? "failed" : ""}"></span>
          </div>
          <div class="activity-copy">\${escapeHtml(item.result)}</div>
          <div class="activity-time">\${escapeHtml(item.time)}</div>
        </div>
      \`).join("") : '<div class="empty">暂无已完成或失败事件。</div>';
      bindFileButtons();
    }
    function renderRails() {
      const data = state.data;
      const task = activeTask();
      const evidence = task
        ? task.evidence.map((item) => ({ ...item, taskId: task.id, taskTitle: task.title }))
        : [];
      const anomalies = task
        ? task.anomalies.map((item) => ({ ...item, taskId: task.id, taskTitle: task.title }))
        : [];
      $("evidence-count").textContent = String(evidence.length);
      $("anomaly-count").textContent = String(anomalies.length);
      $("evidence-list").innerHTML = evidence.length ? evidence.map((item) => \`
        <div class="rail-item">
          <div class="rail-title file-row"><button class="link-button" data-file="\${escapeHtml(item.path)}">\${escapeHtml(item.type)} · \${escapeHtml(item.name)}</button><span class="status-pill completed">通过</span></div>
          <div class="rail-meta">\${escapeHtml(item.taskTitle)} / \${formatTime(item.updatedAt)}</div>
        </div>
      \`).join("") : '<div class="empty">暂无测试或审查证据。</div>';
      $("anomaly-list").innerHTML = anomalies.length ? anomalies.map((item) => \`
        <div class="rail-item \${item.level === "error" ? "error" : "warn"}">
          <div class="rail-title \${item.level === "error" ? "danger" : "amber"}">\${escapeHtml(item.message)}</div>
          <div class="rail-meta">\${escapeHtml(item.taskTitle)} / \${escapeHtml(item.path)}</div>
        </div>
      \`).join("") : "";
      bindFileButtons();
    }
    async function openFile(relativePath) {
      const response = await fetch("/api/file/" + encodeURIComponent(relativePath), { cache: "no-store" });
      const payload = await response.json();
      $("viewer-title").textContent = payload.path || relativePath;
      $("viewer-content").textContent = payload.content || payload.error || "";
      $("viewer").classList.add("open");
    }
    function bindFileButtons() {
      document.querySelectorAll("[data-file]").forEach((button) => {
        button.onclick = () => openFile(button.dataset.file);
      });
    }
    document.querySelectorAll(".filter").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        state.filter = button.dataset.filter;
        renderTaskList();
      });
    });
    $("search").addEventListener("input", (event) => {
      state.search = event.target.value;
      renderTaskList();
    });
    $("refresh").addEventListener("click", loadDashboard);
    $("viewer-close").addEventListener("click", () => $("viewer").classList.remove("open"));
    loadDashboard().catch((error) => {
      $("active-title").textContent = "读取失败";
      $("active-title").title = "读取失败";
      $("active-goal").textContent = error.message;
      $("active-goal").title = error.message;
    });
  </script>
</body>
</html>`;
}

function usage() {
  console.log([
    "Usage:",
    "  node headquarters.js serve [--report .report] [--host 127.0.0.1] [--port 17373]",
    "  node headquarters.js data [--report .report]",
  ].join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "serve";
  const projectRoot = process.cwd();
  const options = {
    report: args.report || DEFAULT_REPORT_DIR,
    host: args.host || DEFAULT_HOST,
    port: Number(args.port || DEFAULT_PORT),
  };

  if (command === "data") {
    process.stdout.write(`${JSON.stringify(buildDashboard(projectRoot, options), null, 2)}\n`);
    return;
  }

  if (command !== "serve") {
    usage();
    process.exit(1);
  }

  const server = createServer(projectRoot, options);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口已被占用: ${options.host}:${options.port}`);
      console.error("请使用 --port 指定其它端口。");
      process.exit(1);
    }
    if (error.code === "EPERM") {
      console.error(`无法监听本地地址: ${options.host}:${options.port}`);
      console.error("请检查当前环境是否允许启动本地 HTTP 服务。");
      process.exit(1);
    }
    throw error;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    console.log(`YSIR Headquarters running at http://${options.host}:${port}`);
    console.log(`Reading ${options.report} dynamically. Press Ctrl+C to stop.`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDashboard,
  createServer,
  parseArgs,
};
