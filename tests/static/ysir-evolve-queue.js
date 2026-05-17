#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "skills/ysir-evolve/scripts/user-prompt-queue.js");
const FIXTURE_ROOT = path.join(REPO_ROOT, ".local", "test-fixtures");
const QUEUE_PATH = path.join(".report", "evolve", "user-prompt-submit.jsonl");
const PROCESSING_PATH = path.join(".report", "evolve", "user-prompt-submit.processing.jsonl");

function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function appendFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, content, "utf8");
}

function readJson(result) {
  return JSON.parse(result.stdout);
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function main() {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const fixtureDir = fs.mkdtempSync(path.join(FIXTURE_ROOT, "ysir-evolve-queue-"));
  const queuePath = path.join(fixtureDir, QUEUE_PATH);
  const processingPath = path.join(fixtureDir, PROCESSING_PATH);
  const errors = [];

  const empty = run(["snapshot"], fixtureDir);
  assert(empty.status === 0, `empty snapshot failed:\n${empty.stderr}`, errors);
  assert(readJson(empty).status === "empty", "snapshot should report empty queue", errors);

  writeFile(queuePath, "{\"prompt\":\"first\"}\n{\"prompt\":\"second\"}\n");

  const snapshot = run(["snapshot"], fixtureDir);
  assert(snapshot.status === 0, `snapshot failed:\n${snapshot.stderr}`, errors);
  const snapshotJson = readJson(snapshot);
  assert(snapshotJson.status === "processing", "snapshot should create processing batch", errors);
  assert(snapshotJson.records === 2, "snapshot should report two records", errors);
  assert(!fs.existsSync(queuePath), "queue should move into processing batch", errors);
  assert(fs.existsSync(processingPath), "processing batch should exist", errors);

  appendFile(queuePath, "{\"prompt\":\"third\"}\n");

  const commit = run(["commit"], fixtureDir);
  assert(commit.status === 0, `commit failed:\n${commit.stderr}`, errors);
  const commitJson = readJson(commit);
  assert(commitJson.status === "committed", "commit should report committed", errors);
  assert(commitJson.records === 2, "commit should report committed processing records", errors);
  assert(!fs.existsSync(processingPath), "commit should delete processing batch", errors);
  assert(fs.readFileSync(queuePath, "utf8").includes("third"), "commit must not delete newly queued records", errors);

  const nextSnapshot = run(["snapshot"], fixtureDir);
  assert(nextSnapshot.status === 0, `next snapshot failed:\n${nextSnapshot.stderr}`, errors);
  assert(readJson(nextSnapshot).records === 1, "next snapshot should process newly queued record", errors);

  appendFile(queuePath, "{\"prompt\":\"fourth\"}\n");

  const abort = run(["abort"], fixtureDir);
  assert(abort.status === 0, `abort failed:\n${abort.stderr}`, errors);
  const abortJson = readJson(abort);
  assert(abortJson.status === "aborted", "abort should report aborted", errors);
  assert(!fs.existsSync(processingPath), "abort should remove processing batch", errors);
  const restoredQueue = fs.readFileSync(queuePath, "utf8");
  assert(restoredQueue.includes("third"), "abort should restore processing record", errors);
  assert(restoredQueue.includes("fourth"), "abort should preserve queued record", errors);

  if (errors.length > 0) {
    console.error("YSIR evolve queue test failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("YSIR evolve queue test passed.");
}

main();
