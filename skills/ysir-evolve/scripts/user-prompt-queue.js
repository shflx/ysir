#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const QUEUE_RELATIVE_PATH = path.join(".report", "evolve", "user-prompt-submit.jsonl");
const PROCESSING_RELATIVE_PATH = path.join(".report", "evolve", "user-prompt-submit.processing.jsonl");

function isNonEmptyFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function countRecords(filePath) {
  if (!isNonEmptyFile(filePath)) {
    return 0;
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim()).length;
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function ensureTrailingNewline(content) {
  if (!content || content.endsWith("\n")) {
    return content;
  }
  return `${content}\n`;
}

/**
 * 将当前队列原子切成一个处理批次，避免处理期间新写入的事件被误清理。
 */
function snapshot(projectRoot) {
  const queuePath = path.join(projectRoot, QUEUE_RELATIVE_PATH);
  const processingPath = path.join(projectRoot, PROCESSING_RELATIVE_PATH);

  if (isNonEmptyFile(processingPath)) {
    writeResult({
      status: "processing",
      path: PROCESSING_RELATIVE_PATH,
      records: countRecords(processingPath),
    });
    return;
  }

  if (!isNonEmptyFile(queuePath)) {
    if (fs.existsSync(queuePath)) {
      fs.unlinkSync(queuePath);
    }
    writeResult({
      status: "empty",
      path: null,
      records: 0,
    });
    return;
  }

  fs.renameSync(queuePath, processingPath);
  writeResult({
    status: "processing",
    path: PROCESSING_RELATIVE_PATH,
    records: countRecords(processingPath),
  });
}

/**
 * 当前批次处理成功后删除 processing 文件；新的队列文件不受影响。
 */
function commit(projectRoot) {
  const processingPath = path.join(projectRoot, PROCESSING_RELATIVE_PATH);
  const records = countRecords(processingPath);

  if (fs.existsSync(processingPath)) {
    fs.unlinkSync(processingPath);
  }

  writeResult({
    status: "committed",
    path: PROCESSING_RELATIVE_PATH,
    records,
  });
}

/**
 * 放弃当前批次时把 processing 内容还回队列，供后续 process 重试。
 */
function abort(projectRoot) {
  const queuePath = path.join(projectRoot, QUEUE_RELATIVE_PATH);
  const processingPath = path.join(projectRoot, PROCESSING_RELATIVE_PATH);

  if (!fs.existsSync(processingPath)) {
    writeResult({
      status: "no_processing",
      path: null,
      records: 0,
    });
    return;
  }

  const processingContent = ensureTrailingNewline(fs.readFileSync(processingPath, "utf8"));
  const queueContent = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, "utf8") : "";
  fs.writeFileSync(queuePath, `${processingContent}${queueContent}`, "utf8");
  fs.unlinkSync(processingPath);

  writeResult({
    status: "aborted",
    path: QUEUE_RELATIVE_PATH,
    records: countRecords(queuePath),
  });
}

function main() {
  const command = process.argv[2];
  const projectRoot = process.cwd();

  if (command === "snapshot") {
    snapshot(projectRoot);
    return;
  }
  if (command === "commit") {
    commit(projectRoot);
    return;
  }
  if (command === "abort") {
    abort(projectRoot);
    return;
  }

  console.error("Usage: node user-prompt-queue.js <snapshot|commit|abort>");
  process.exit(1);
}

main();
