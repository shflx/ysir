#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// review-assist 的 state.json 由 ysir-state 脚本创建和推进；diff 始终通过 git 动态读取。
const STATE_PATH = path.join(".report", "review-assist", "state.json");
const META_PATH = path.join(".report", "review-assist", "meta.json");
const ARTIFACTS_DIR = path.join(".report", "review-assist", "files");
const STATE_SCRIPT = path.resolve(__dirname, "../../ysir-state/scripts/state.js");
const VALID_SOURCES = new Set(["staged", "unstaged", "working-tree", "commit", "range"]);
const VALID_DECISIONS = new Set(["approved", "changes-requested", "skipped"]);
const SCHEMA_NAME = "review-assist";
const AGENT_STAGE = "agent-review";
const USER_STAGE = "user-review";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} 失败:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function repoRoot() {
  return runGit(["rev-parse", "--show-toplevel"]).trim();
}

function ensureRepoRoot() {
  const root = repoRoot();
  // 所有相对路径状态都以仓库根目录为准，避免从子目录运行时写错位置。
  process.chdir(root);
  return root;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureStateDir() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    fail("审查状态不存在，请先执行 start。");
  }
  return readJson(STATE_PATH);
}

function loadMeta() {
  if (!fs.existsSync(META_PATH)) {
    fail("审查元数据不存在，请先执行 start。");
  }
  return readJson(META_PATH);
}

function saveMeta(meta) {
  writeJson(META_PATH, meta);
}

function runNodeScript(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`node ${args.join(" ")} 失败:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function runState(args) {
  return runNodeScript([STATE_SCRIPT, ...args]);
}

function stateAdvance(note) {
  const args = ["advance", "--state", STATE_PATH];
  if (note !== undefined) {
    args.push("--note", note);
  }
  return runState(args);
}

function sourceFromArgs(args) {
  const sourceName = String(args.source || "").trim();
  if (!VALID_SOURCES.has(sourceName)) {
    fail(`缺少或不支持 --source，可选: ${[...VALID_SOURCES].join(", ")}`);
  }
  if (sourceName === "commit") {
    if (!args.ref) {
      fail("commit source 需要 --ref <commit>");
    }
    return { type: "commit", ref: String(args.ref) };
  }
  if (sourceName === "range") {
    if (!args.base || !args.head) {
      fail("range source 需要 --base <base> --head <head>");
    }
    return { type: "range", base: String(args.base), head: String(args.head) };
  }
  return { type: "working-tree", mode: sourceName };
}

function nameStatusArgs(source) {
  // source 决定审查文件范围；start 时固化文件队列，review 时再动态读取 diff。
  if (source.type === "commit") {
    return ["diff-tree", "--no-commit-id", "--name-status", "-r", source.ref];
  }
  if (source.type === "range") {
    return ["diff", "--name-status", `${source.base}...${source.head}`];
  }
  if (source.mode === "staged") {
    return ["diff", "--cached", "--name-status"];
  }
  if (source.mode === "unstaged") {
    return ["diff", "--name-status"];
  }
  return ["diff", "--name-status", "HEAD"];
}

function parseNameStatus(output) {
  // git name-status 的 rename 行会包含旧路径和新路径；审查队列使用最终路径。
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0];
      const pathValue = parts[parts.length - 1];
      return { status, path: pathValue };
    });
}

function collectFiles(source) {
  const entries = parseNameStatus(runGit(nameStatusArgs(source)));
  return entries.map((entry, index) => ({
    phase: `file-${String(index + 1).padStart(3, "0")}`,
    path: entry.path,
    gitStatus: entry.status,
  }));
}

function makeNodeId(file, stage, attempt = 1) {
  return attempt > 1 ? `${file.phase}@${attempt}:${stage}` : `${file.phase}:${stage}`;
}

function diffArgs(source, filePath) {
  // 只为当前文件生成 diff，保证逐文件审查不会一次性淹没用户。
  if (source.type === "commit") {
    return ["show", "--format=", "--find-renames", source.ref, "--", filePath];
  }
  if (source.type === "range") {
    return ["diff", "--find-renames", `${source.base}...${source.head}`, "--", filePath];
  }
  if (source.mode === "staged") {
    return ["diff", "--cached", "--find-renames", "--", filePath];
  }
  if (source.mode === "unstaged") {
    return ["diff", "--find-renames", "--", filePath];
  }
  return ["diff", "--find-renames", "HEAD", "--", filePath];
}

function statusForFile(source, filePath) {
  const entry = parseNameStatus(runGit(nameStatusArgs(source))).find((item) => item.path === filePath);
  return entry ? entry.status : "?";
}

function currentFileEntry(state, meta) {
  const files = meta.files || [];
  if (files.length === 0) {
    fail("审查队列为空。");
  }
  const currentNode = state.current || makeNodeId(files[0], AGENT_STAGE);
  const currentPhase = state.nodes[currentNode]?.phase || currentNode.split(":")[0].split("@")[0];
  const currentEntry = files.find((entry) => entry.phase === currentPhase);
  if (!currentEntry) {
    fail(`当前审查节点不在文件队列中: ${currentNode}`);
  }
  return currentEntry;
}

function fileEntryByPhase(meta, phaseId) {
  return (meta.files || []).find((entry) => entry.phase === phaseId);
}

function entryIndex(meta, entry) {
  return (meta.files || []).findIndex((item) => item.phase === entry.phase);
}

function decisionForFile(state, entry) {
  const nodeId = latestNodeIdForFile(state, entry, USER_STAGE);
  const node = state.nodes[nodeId];
  if (!node) {
    return "pending";
  }
  if (node.status === "failed") {
    return "changes-requested";
  }
  return userDecisionFromNote(node.note) || "pending";
}

function userReviewNodesForFile(state, entry) {
  return Object.values(state.nodes)
    .filter((node) => node.phase === entry.phase && node.stage === USER_STAGE)
    .sort((left, right) => (left.attempt || 1) - (right.attempt || 1));
}

function reviewNodeDecision(node) {
  if (!node) {
    return "pending";
  }
  if (node.status === "failed") {
    return "changes-requested";
  }
  return userDecisionFromNote(node.note) || "pending";
}

function maxAttemptForFile(state, entry) {
  return Object.values(state.nodes)
    .filter((node) => node.phase === entry.phase)
    .reduce((max, node) => Math.max(max, node.attempt || 1), 0);
}

function latestNodeIdForFile(state, entry, stage) {
  const attempt = Math.max(1, maxAttemptForFile(state, entry));
  return makeNodeId(entry, stage, attempt);
}

function userDecisionFromNote(note) {
  const match = String(note || "").match(/^decision:(approved|changes-requested|skipped)(?:\s|$)/);
  return match ? match[1] : "";
}

function decisionNote(decision, note) {
  const suffix = String(note || "").trim();
  return suffix ? `decision:${decision} ${suffix}` : `decision:${decision}`;
}

function readableNote(note) {
  return String(note || "").replace(/^decision:[^\s]+\s?/, "");
}

function currentStage(state) {
  return state.current && state.nodes[state.current] ? state.nodes[state.current].stage || "" : "";
}

function currentAttempt(state) {
  return state.current && state.nodes[state.current] ? state.nodes[state.current].attempt || 1 : 1;
}

function sanitizeArtifactName(filePath) {
  const name = String(filePath || "file")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutExtension = name.replace(/\.[A-Za-z0-9]+$/, "");
  return withoutExtension || name || "file";
}

function artifactPathFor(entry, index) {
  const prefix = String(index + 1).padStart(3, "0");
  return path.join(ARTIFACTS_DIR, `${prefix}-${sanitizeArtifactName(entry.path)}.md`);
}

function markdownFence(content, language) {
  const text = String(content || "");
  const longestFence = text
    .match(/`{3,}/g)
    ?.reduce((max, fence) => Math.max(max, fence.length), 3) || 3;
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${language || ""}\n${text}\n${fence}`;
}

function writeReviewPage(details) {
  const artifactPath = artifactPathFor(details.entry, details.index);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const content = [
    `# Review: ${details.file}`,
    "",
    `- Progress: ${details.index + 1}/${details.files.length}`,
    `- Git status: ${details.status}`,
    `- Source: ${describeSource(details.meta.source)}`,
    `- State current: ${details.state.current || ""}`,
    `- Stage: ${currentStage(details.state) || ""}`,
    `- Decision: ${details.decision}${details.displayNote ? ` (${details.displayNote})` : ""}`,
    `- Diff lines: ${details.diffLineCount}`,
    "",
    "## 原始 diff",
    "",
    markdownFence(details.diffText, "diff"),
    "",
    "## 审查判断",
    "",
    "等待 Agent 在对话中给出审查判断。Codex 环境中，具体行级问题使用 inline code comment 挂到源码行；非 Codex 环境中，在回复正文直接展示行级问题。",
    "",
    "## 等待用户结论",
    "",
    "请给出文件级结论：通过、跳过，或需要修改。",
    "",
  ].join("\n");
  fs.writeFileSync(artifactPath, content, "utf8");
  return path.resolve(artifactPath);
}

function cleanupReviewPages() {
  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
}

function printStateHeader(meta) {
  console.log(`source: ${describeSource(meta.source)}`);
  console.log(`state: ${STATE_PATH}`);
  console.log(`meta: ${META_PATH}`);
  console.log("");
}

function describeSource(source) {
  if (source.type === "commit") {
    return `commit ${source.ref}`;
  }
  if (source.type === "range") {
    return `range ${source.base}...${source.head}`;
  }
  return source.mode;
}

function startCommand(args) {
  ensureRepoRoot();
  const source = sourceFromArgs(args);
  const files = collectFiles(source);
  const meta = {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    reviewAssist: true,
    source,
    files,
  };
  ensureStateDir();
  if (fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
  }
  const phaseIds = files.map((file) => file.phase).join(",");
  if (phaseIds) {
    runState([
      "init",
      "--state",
      STATE_PATH,
      "--nodes",
      phaseIds,
      "--schema",
      SCHEMA_NAME,
    ]);
  } else {
    runState([
      "init",
      "--state",
      STATE_PATH,
      "--nodes",
      "empty-review-queue",
      "--schema",
      SCHEMA_NAME,
      "--current",
      "empty-review-queue:agent-review",
    ]);
    stateAdvance("审查队列为空");
    stateAdvance(decisionNote("skipped", "审查队列为空"));
  }
  saveMeta(meta);
  console.log(`审查会话已建立: ${describeSource(source)}`);
  console.log(`文件数: ${files.length}`);
  files.forEach((file, index) => {
    console.log(`${index + 1}. ${file.path}`);
  });
}

function listCommand() {
  ensureRepoRoot();
  const state = loadState();
  const meta = loadMeta();
  const files = meta.files || [];
  printStateHeader(meta);
  files.forEach((file, index) => {
    const marker = state.nodes[state.current]?.phase === file.phase ? ">" : " ";
    const decision = decisionForFile(state, file);
    const stage = state.nodes[state.current]?.phase === file.phase ? ` ${currentStage(state)}` : "";
    console.log(`${marker} ${index + 1}/${files.length} ${decision} ${file.path}`);
    if (stage) {
      console.log(`  currentStage:${stage} attempt=${currentAttempt(state)}`);
    }
  });
}

function reviewCommand(args) {
  ensureRepoRoot();
  const state = loadState();
  const meta = loadMeta();
  const entry = currentFileEntry(state, meta);
  const file = entry.path;
  const index = entryIndex(meta, entry);
  const files = meta.files || [];
  const status = statusForFile(meta.source, file);
  const decision = decisionForFile(state, entry);
  const note = state.nodes[latestNodeIdForFile(state, entry, USER_STAGE)]?.note || "";
  const displayNote = readableNote(note);
  const diffText = runGit(diffArgs(meta.source, file)) || "(当前 git 没有返回该文件 diff 内容)";
  const diffLineCount = diffText.split("\n").length;
  const details = {
    state,
    meta,
    entry,
    file,
    index,
    files,
    status,
    decision,
    displayNote,
    diffText,
    diffLineCount,
  };

  console.log(`[${index + 1}/${files.length}] ${status} ${file}`);
  console.log(`decision: ${decision}${displayNote ? ` (${displayNote})` : ""}`);
  console.log(`source: ${describeSource(meta.source)}`);
  console.log(`stateCurrent: ${state.current || ""}`);
  console.log(`stage: ${currentStage(state) || ""}`);
  console.log(`diff lines: ${diffLineCount}`);
  console.log("");
  console.log("--- 原始 diff ---");
  console.log(diffText);
  const artifactPath = writeReviewPage(details);
  console.log("");
  console.log(`reviewPage: ${artifactPath}`);
  if (args["codex-artifact"] === true) {
    console.log(`codexArtifact: ${artifactPath}`);
  }
}

function agentDoneCommand(args) {
  ensureRepoRoot();
  const state = loadState();
  const meta = loadMeta();
  if (args["diff-shown-to-user"] !== true) {
    fail("agent-done 必须带 --diff-shown-to-user，表示当前文件原始 diff 已经出现在面向用户的可见回复中。");
  }
  if (!state.current) {
    fail("当前审查状态没有 current 节点。");
  }
  const node = state.nodes[state.current];
  if (!node || node.stage !== AGENT_STAGE) {
    fail(`当前节点不是 Agent 审查节点: ${state.current || ""}`);
  }
  const entry = fileEntryByPhase(meta, node.phase);
  if (!entry) {
    fail(`当前审查节点不在文件队列中: ${state.current}`);
  }
  const note = args.note ? String(args.note) : "";
  stateAdvance(note);
  const userNodeId = makeNodeId(entry, USER_STAGE, node.attempt || 1);
  console.log(`Agent 审查已完成: ${entry.path}`);
  console.log(`当前进入用户审查: ${userNodeId}`);
}

function markCommand(args) {
  ensureRepoRoot();
  const state = loadState();
  const meta = loadMeta();
  const decision = String(args.decision || "").trim();
  if (!VALID_DECISIONS.has(decision)) {
    fail(`缺少或不支持 --decision，可选: ${[...VALID_DECISIONS].join(", ")}`);
  }
  const currentNode = state.nodes[state.current];
  if (!currentNode || currentNode.stage !== USER_STAGE) {
    fail(`当前节点不是用户审查节点，请先完成 Agent 审查: ${state.current || ""}`);
  }
  const entry = currentFileEntry(state, meta);
  if (currentNode.phase !== entry.phase) {
    fail(`当前节点与待标记文件不一致: ${entry.path}`);
  }
  const note = decisionNote(decision, args.note ? String(args.note) : "");
  if (decision === "changes-requested") {
    runState(["next-attempt", "--state", STATE_PATH, "--status", "failed", "--note", note]);
  } else {
    stateAdvance(note);
  }
  console.log(`已记录: ${entry.path} -> ${decision}`);
}

function summaryCommand() {
  ensureRepoRoot();
  const state = loadState();
  const meta = loadMeta();
  const files = meta.files || [];
  printStateHeader(meta);
  const counts = { approved: 0, "changes-requested": 0, skipped: 0, pending: 0 };
  for (const file of files) {
    const decision = decisionForFile(state, file);
    counts[decision] += 1;
  }
  console.log(`approved: ${counts.approved}`);
  console.log(`changes-requested: ${counts["changes-requested"]}`);
  console.log(`skipped: ${counts.skipped}`);
  console.log(`pending: ${counts.pending}`);
  console.log("");
  files.forEach((file, index) => {
    const decision = decisionForFile(state, file);
    console.log(`${index + 1}. ${decision} ${file.path}`);
    const reviewNodes = userReviewNodesForFile(state, file);
    for (const node of reviewNodes) {
      const attempt = node.attempt || 1;
      const nodeDecision = reviewNodeDecision(node);
      const note = readableNote(node.note);
      const noteText = note ? ` - ${note}` : "";
      console.log(`   - attempt ${attempt}: ${nodeDecision} [${node.status}]${noteText}`);
    }
  });
  cleanupReviewPages();
  console.log("");
  console.log(`审查页文件夹已清理: ${ARTIFACTS_DIR}`);
}

function resetCommand() {
  ensureRepoRoot();
  if (fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
  }
  if (fs.existsSync(META_PATH)) {
    fs.unlinkSync(META_PATH);
  }
  cleanupReviewPages();
  console.log("审查状态已清理。");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case "start":
      startCommand(args);
      break;
    case "list":
      listCommand();
      break;
    case "review":
      reviewCommand(args);
      break;
    case "agent-done":
      agentDoneCommand(args);
      break;
    case "mark":
      markCommand(args);
      break;
    case "summary":
      summaryCommand();
      break;
    case "reset":
      resetCommand();
      break;
    default:
      fail("用法: review-assist.js start|list|review|agent-done|mark|summary|reset");
  }
}

main();
