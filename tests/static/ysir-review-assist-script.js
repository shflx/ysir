#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "skills/ysir-review-assist/scripts/review-assist.js");

function runNode(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGit(args, cwd) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function main() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "ysir-review-assist-"));
  const errors = [];

  assert(runGit(["init"], fixtureDir).status === 0, "git init should succeed", errors);
  runGit(["config", "user.email", "review@example.com"], fixtureDir);
  runGit(["config", "user.name", "Review Test"], fixtureDir);

  writeFile(path.join(fixtureDir, "README.md"), "# Demo\n");
  assert(runGit(["add", "README.md"], fixtureDir).status === 0, "git add README should succeed", errors);
  assert(runGit(["commit", "-m", "initial"], fixtureDir).status === 0, "initial commit should succeed", errors);

  writeFile(path.join(fixtureDir, "README.md"), "# Demo\n\nchanged\nline two\nline three\n");
  writeFile(path.join(fixtureDir, "src/app.js"), "console.log('hello');\n");
  assert(runGit(["add", "README.md", "src/app.js"], fixtureDir).status === 0, "git add staged files should succeed", errors);
  writeFile(path.join(fixtureDir, "notes.txt"), "unstaged\n");

  const start = runNode(["start", "--source", "staged"], fixtureDir);
  assert(start.status === 0, `start staged failed:\n${start.stderr}`, errors);
  assert(start.stdout.includes("文件数: 2"), "start should list two staged files", errors);
  assert(start.stdout.includes("README.md"), "start should include README.md", errors);
  assert(start.stdout.includes("src/app.js"), "start should include src/app.js", errors);

  const statePath = path.join(fixtureDir, ".report/review-assist/state.json");
  const metaPath = path.join(fixtureDir, ".report/review-assist/meta.json");
  const artifactsDir = path.join(fixtureDir, ".report/review-assist/files");
  const artifactPath = path.join(fixtureDir, ".report/review-assist/files/001-README.md");
  assert(fs.existsSync(statePath), "state.json should be created", errors);
  assert(fs.existsSync(metaPath), "meta.json should be created", errors);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  assert(state.schema.name === "review-assist", "state schema should be review-assist", errors);
  assert(!("reviewAssist" in state), "state should not persist review assist source metadata", errors);
  assert(meta.source.mode === "staged", "meta source should be staged", errors);
  assert(meta.files.length === 2, "meta should keep two files", errors);
  assert(state.current === "file-001:agent-review", "state should point to first agent review node", errors);
  assert(state.nodes["file-001:agent-review"].status === "current", "first agent review should be current", errors);
  assert(state.nodes["file-001:user-review"].status === "pending", "first user review should be pending", errors);
  assert(state.nodes["file-002:agent-review"].status === "pending", "second agent review should be pending", errors);
  assert(state.edges.some((edge) => edge.from === "file-001:agent-review" && edge.to === "file-001:user-review"), "state should connect agent review to user review", errors);
  assert(state.edges.some((edge) => edge.from === "file-001:user-review" && edge.to === "file-002:agent-review"), "state should connect first file to second file", errors);
  assert(!("repoRoot" in state), "state should not persist repoRoot", errors);
  assert(!("createdAt" in state), "state should not persist createdAt", errors);

  const review = runNode(["review"], fixtureDir);
  assert(review.status === 0, `review failed:\n${review.stderr}`, errors);
  assert(review.stdout.includes("--- 原始 diff ---"), "review should print raw diff marker", errors);
  assert(review.stdout.includes("README.md"), "review should print current file path", errors);
  assert(review.stdout.includes("+changed"), "review should print staged diff content", errors);
  assert(review.stdout.includes("+line three"), "review should print the full staged diff content", errors);
  assert(review.stdout.includes("reviewPage:"), "review should print review page path", errors);
  assert(!review.stdout.includes("还有更多 diff"), "review should not paginate long diff output", errors);
  assert(fs.existsSync(artifactPath), "review should create current file review markdown", errors);
  const showArtifactContent = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, "utf8") : "";
  assert(showArtifactContent.includes("## 原始 diff"), "review page should include raw diff section", errors);
  assert(showArtifactContent.includes("+changed"), "review page should include diff content", errors);
  assert(showArtifactContent.includes("+line three"), "review page should include the full diff content", errors);
  assert(showArtifactContent.includes("## 等待用户结论"), "review page should include user decision section", errors);

  const legacyShow = runNode(["show"], fixtureDir);
  assert(legacyShow.status !== 0, "show should no longer be a review assist command", errors);

  const artifactReview = runNode(["review", "--codex-artifact"], fixtureDir);
  assert(artifactReview.status === 0, `review --codex-artifact failed:\n${artifactReview.stderr}`, errors);
  assert(artifactReview.stdout.includes("reviewPage:"), "codex artifact mode should print review page path", errors);
  assert(artifactReview.stdout.includes("codexArtifact:"), "codex artifact mode should print compatibility artifact path", errors);
  const artifactContent = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, "utf8") : "";
  assert(artifactContent.includes("## 原始 diff"), "compatibility artifact should include raw diff section", errors);
  assert(artifactContent.includes("+changed"), "compatibility artifact should include diff content", errors);
  assert(artifactContent.includes("+line three"), "compatibility artifact should include the full diff content", errors);
  assert(artifactContent.includes("## 等待用户结论"), "compatibility artifact should include user decision section", errors);

  const prematureMark = runNode(["mark", "--decision", "approved", "--note", "too soon"], fixtureDir);
  assert(prematureMark.status !== 0, "mark should require user review node", errors);

  const blockedAgentDone = runNode(["agent-done", "--note", "agent reviewed"], fixtureDir);
  assert(blockedAgentDone.status !== 0, "agent-done should require explicit diff display confirmation", errors);

  const agentDone = runNode(["agent-done", "--diff-shown-to-user", "--note", "agent reviewed"], fixtureDir);
  assert(agentDone.status === 0, `agent-done failed:\n${agentDone.stderr}`, errors);
  const agentDoneState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(agentDoneState.current === "file-001:user-review", "agent-done should advance to user review", errors);
  assert(agentDoneState.nodes["file-001:agent-review"].status === "completed", "agent-done should complete agent review", errors);
  assert(agentDoneState.nodes["file-001:user-review"].status === "current", "agent-done should mark user review current", errors);

  const retry = runNode(["mark", "--decision", "changes-requested", "--note", "needs fix"], fixtureDir);
  assert(retry.status === 0, `changes-requested failed:\n${retry.stderr}`, errors);
  const retryState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(retryState.nodes["file-001:user-review"].status === "failed", "failed user review should keep workflow status", errors);
  assert(retryState.nodes["file-001:user-review"].note === "decision:changes-requested needs fix", "failed user review should record user decision in note", errors);
  assert(retryState.current === "file-001@2:agent-review", "changes-requested should create retry attempt", errors);
  assert(retryState.nodes["file-001@2:agent-review"].status === "current", "retry agent review should be current", errors);
  assert(retryState.edges.some((edge) => edge.from === "file-001:user-review" && edge.to === "file-001@2:agent-review"), "failed user review should point to retry attempt", errors);
  assert(retryState.edges.some((edge) => edge.from === "file-001@2:user-review" && edge.to === "file-002:agent-review"), "retry attempt should point to next file after pass", errors);

  const retrySummary = runNode(["summary"], fixtureDir);
  assert(retrySummary.status === 0, `retry summary failed:\n${retrySummary.stderr}`, errors);
  assert(retrySummary.stdout.includes("1. pending README.md"), "retry summary should keep current pending status", errors);
  assert(retrySummary.stdout.includes("attempt 1: changes-requested [failed] - needs fix"), "retry summary should include first attempt user note", errors);
  assert(retrySummary.stdout.includes("attempt 2: pending [pending]"), "retry summary should include pending retry attempt", errors);

  const retryAgentDone = runNode(["agent-done", "--diff-shown-to-user", "--note", "retry reviewed"], fixtureDir);
  assert(retryAgentDone.status === 0, `retry agent-done failed:\n${retryAgentDone.stderr}`, errors);

  const mark = runNode(["mark", "--decision", "approved", "--note", "ok"], fixtureDir);
  assert(mark.status === 0, `mark failed:\n${mark.stderr}`, errors);
  const markedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(markedState.nodes["file-001@2:user-review"].status === "completed", "approved user review should keep workflow status", errors);
  assert(markedState.nodes["file-001@2:user-review"].note === "decision:approved ok", "mark should save decision note", errors);
  assert(markedState.current === "file-002:agent-review", "approved retry should advance to next file agent review", errors);
  assert(markedState.history.filter((entry) => entry.node === "file-001@2:user-review").length === 1, "approved user review should append only one history record", errors);
  assert(markedState.history.length >= 4, "review flow should append history", errors);

  const list = runNode(["list"], fixtureDir);
  assert(list.status === 0, `list failed:\n${list.stderr}`, errors);
  assert(list.stdout.includes("> 2/2 pending src/app.js"), "list should show current second file", errors);
  const listedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(listedState.current === "file-002:agent-review", "list should not change current", errors);
  assert(listedState.nodes["file-001@2:user-review"].status === "completed", "list should keep workflow status", errors);
  assert(listedState.nodes["file-002:agent-review"].status === "current", "list should keep target agent review current", errors);

  const summary = runNode(["summary"], fixtureDir);
  assert(summary.status === 0, `summary failed:\n${summary.stderr}`, errors);
  assert(summary.stdout.includes("approved: 1"), "summary should count approved files", errors);
  assert(summary.stdout.includes("pending: 1"), "summary should count pending files", errors);
  assert(summary.stdout.includes("attempt 1: changes-requested [failed] - needs fix"), "summary should retain earlier user change request note", errors);
  assert(summary.stdout.includes("attempt 2: approved [completed] - ok"), "summary should include approved retry user note", errors);
  assert(summary.stdout.includes("审查页文件夹已清理"), "summary should report review page cleanup", errors);
  assert(!fs.existsSync(artifactsDir), "summary should remove review page directory", errors);

  const reviewAfterSummary = runNode(["review"], fixtureDir);
  assert(reviewAfterSummary.status === 0, `review after summary failed:\n${reviewAfterSummary.stderr}`, errors);
  assert(fs.existsSync(artifactsDir), "review after summary should recreate review page directory", errors);

  const reset = runNode(["reset"], fixtureDir);
  assert(reset.status === 0, `reset failed:\n${reset.stderr}`, errors);
  assert(!fs.existsSync(statePath), "reset should remove state.json", errors);
  assert(!fs.existsSync(metaPath), "reset should remove meta.json", errors);
  assert(!fs.existsSync(artifactsDir), "reset should remove review page directory", errors);

  const unstagedStart = runNode(["start", "--source", "unstaged"], fixtureDir);
  assert(unstagedStart.status === 0, `start unstaged failed:\n${unstagedStart.stderr}`, errors);
  assert(unstagedStart.stdout.includes("文件数: 0"), "unstaged source should ignore untracked files", errors);
  const emptyList = runNode(["list"], fixtureDir);
  assert(emptyList.status === 0, `list should work on empty review queue:\n${emptyList.stderr}`, errors);
  const emptyState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(emptyState.current === "", "empty list should not corrupt current", errors);
  assert(emptyState.nodes["empty-review-queue:agent-review"].status === "completed", "empty queue should keep workflow status", errors);
  assert(emptyState.nodes["empty-review-queue:user-review"].status === "completed", "empty queue user review should keep workflow status", errors);
  assert(emptyState.nodes["empty-review-queue:user-review"].note === "decision:skipped 审查队列为空", "empty queue should record skipped decision in note", errors);

  if (errors.length > 0) {
    console.error("YSIR review assist script test failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("YSIR review assist script test passed.");
}

main();
