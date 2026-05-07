#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OBJECTIVE_PREFIX = "先使用 ysir-regulation 了解与本次行动相关的规范；然后";
const DEFAULT_SCHEMA_PATH = path.join(__dirname, "../references/schemas/standard/schema.json");
const DEFAULT_SCHEMA_DISPLAY_PATH = "skills/ysir-state/references/schemas/standard/schema.json";

function fail(message) {
  console.error(message);
  process.exit(1);
}

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

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseList(value) {
  if (!value) {
    return [];
  }
  // 列表参数使用逗号分隔，让调用方无需为简单图操作构造 JSON。
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEdge(edge) {
  const [from, to] = edge.split(">").map((part) => part.trim());
  if (!from || !to) {
    fail(`边格式错误，应为 from>to: ${edge}`);
  }
  return { from, to };
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      fail(`${label} 存在重复项: ${value}`);
    }
    seen.add(value);
  }
}

function assertAcyclic(nodeIds, edges) {
  const indegree = Object.fromEntries(nodeIds.map((id) => [id, 0]));
  const outgoing = Object.fromEntries(nodeIds.map((id) => [id, []]));

  for (const edge of edges) {
    indegree[edge.to] += 1;
    outgoing[edge.from].push(edge.to);
  }

  // 用拓扑排序作为图写入门禁：无法访问全部节点即说明存在环。
  const queue = nodeIds.filter((id) => indegree[id] === 0);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    visited += 1;
    for (const next of outgoing[current]) {
      indegree[next] -= 1;
      if (indegree[next] === 0) {
        queue.push(next);
      }
    }
  }

  if (visited !== nodeIds.length) {
    fail("状态图必须是有向无环图，当前节点和边存在环");
  }
}

function makeTemplatePath(schemaDir, templatePath) {
  return path.join(schemaDir, templatePath).split(path.sep).join("/");
}

function expandSubStage(phaseId, subStage, schemaDir) {
  return {
    id: `${phaseId}:${subStage.id}`,
    phase: phaseId,
    stage: subStage.id,
    label: subStage.label || subStage.id,
    ...(subStage.objective ? { objective: subStage.objective } : {}),
    ...(subStage.template
      ? { template: makeTemplatePath(schemaDir, subStage.template) }
      : {}),
  };
}

function makeAttemptNodeId(phaseId, attempt, stageId) {
  return attempt > 1 ? `${phaseId}@${attempt}:${stageId}` : `${phaseId}:${stageId}`;
}

function resolveSchemaPath(schemaPath) {
  if (!schemaPath) {
    fail("当前状态图缺少 schema，无法重试");
  }
  if (path.isAbsolute(schemaPath)) {
    return schemaPath;
  }
  const cwdPath = path.resolve(process.cwd(), schemaPath);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  if (schemaPath === DEFAULT_SCHEMA_DISPLAY_PATH) {
    return DEFAULT_SCHEMA_PATH;
  }
  if (!fs.existsSync(cwdPath)) {
    fail(`schema 文件不存在: ${schemaPath}`);
  }
  return cwdPath;
}

function expandSchema(nodes, phaseEdges, schemaPath, schemaDisplayPath = schemaPath) {
  const schema = readJson(schemaPath);
  const schemaDir = path.dirname(schemaDisplayPath);
  if (!Array.isArray(schema.subStages) || schema.subStages.length === 0) {
    fail(`schema 缺少 subStages: ${schemaPath}`);
  }

  const schemaEdges = Array.isArray(schema.edges) ? schema.edges : [];
  assertUnique(schema.subStages.map((subStage) => subStage.id), "schema.subStages");
  const expandedNodes = [];
  const expandedEdges = [];

  for (const phaseId of nodes) {
    for (const subStage of schema.subStages) {
      if (!subStage.id) {
        fail(`schema subStages 存在缺少 id 的条目: ${schemaPath}`);
      }
      expandedNodes.push(expandSubStage(phaseId, subStage, schemaDir));
    }

    for (const edge of schemaEdges) {
      if (!edge.from || !edge.to) {
        fail(`schema edges 存在缺少 from/to 的条目: ${schemaPath}`);
      }
      expandedEdges.push({
        from: `${phaseId}:${edge.from}`,
        to: `${phaseId}:${edge.to}`,
      });
    }
  }

  // schema 只描述单个计划阶段内部流程；跨阶段依赖由 --edges 或节点顺序决定。
  const phaseTransitions = phaseEdges.length > 0
    ? phaseEdges
    : nodes.slice(0, -1).map((from, index) => ({ from, to: nodes[index + 1] }));

  for (const transition of phaseTransitions) {
    if (!nodes.includes(transition.from) || !nodes.includes(transition.to)) {
      fail(`阶段边引用了不存在的节点: ${transition.from}>${transition.to}`);
    }
    const lastStage = schema.subStages[schema.subStages.length - 1].id;
    const firstStage = schema.subStages[0].id;
    // 跨计划阶段时，只连接阶段边界，避免把 schema 内部流程和计划依赖混在一起。
    expandedEdges.push({
      from: `${transition.from}:${lastStage}`,
      to: `${transition.to}:${firstStage}`,
    });
  }

  return {
    schema: {
      name: schema.name || path.basename(schemaPath),
      path: schemaDisplayPath.split(path.sep).join("/"),
    },
    nodes: expandedNodes,
    edges: expandedEdges,
  };
}

function createState(args) {
  const inputNodes = parseList(args.nodes);
  assertUnique(inputNodes, "nodes");
  const inputEdges = parseList(args.edges).map(parseEdge);
  const schemaPath = args.schema === "none" ? "" : (args.schema || DEFAULT_SCHEMA_PATH);
  const schemaDisplayPath = args.schema ? args.schema : DEFAULT_SCHEMA_DISPLAY_PATH;
  const expanded = schemaPath
    ? expandSchema(inputNodes, inputEdges, schemaPath, schemaDisplayPath)
    : {
      schema: null,
      nodes: inputNodes.map((id) => ({ id })),
      edges: inputEdges,
    };
  const nodeIds = expanded.nodes.map((node) => node.id);
  const current = args.current || nodeIds[0] || "";

  if (nodeIds.length === 0) {
    fail("缺少 --nodes node-a,node-b");
  }
  if (current && !nodeIds.includes(current)) {
    fail(`current 不在 nodes 中: ${current}`);
  }

  for (const edge of expanded.edges) {
    if (!nodeIds.includes(edge.from) || !nodeIds.includes(edge.to)) {
      fail(`边引用了不存在的节点: ${edge.from}>${edge.to}`);
    }
  }
  assertAcyclic(nodeIds, expanded.edges);

  return {
    version: 1,
    current,
    schema: expanded.schema,
    nodes: Object.fromEntries(
      expanded.nodes.map((node) => [
        node.id,
        {
          ...node,
          status: node.id === current ? "current" : "pending",
          note: "",
        },
      ])
    ),
    edges: expanded.edges,
    history: [],
    updatedAt: nowIso(),
  };
}

function requireState(args) {
  if (!args.state) {
    fail("缺少 --state <state.json>");
  }
  return readJson(args.state);
}

function assertNodeExists(state, id) {
  if (!state.nodes[id]) {
    fail(`节点不存在: ${id}`);
  }
}

function setCurrent(state, currentId) {
  assertNodeExists(state, currentId);
  // current 是单一指针；移动时清理旧 current 标记。
  for (const node of Object.values(state.nodes)) {
    if (node.status === "current" && node.id !== currentId) {
      node.status = "pending";
    }
  }
  state.current = currentId;
  if (state.nodes[currentId].status === "pending") {
    state.nodes[currentId].status = "current";
  }
}

function getNextNodes(state, nodeId) {
  return state.edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => edge.to);
}

function advanceNode(state, args) {
  const id = state.current;
  if (!id) {
    fail("缺少 current 节点，无法推进");
  }
  assertNodeExists(state, id);

  const nextNodes = getNextNodes(state, id);
  let nextId = "";
  if (args.next) {
    assertNodeExists(state, args.next);
    if (!nextNodes.includes(args.next)) {
      fail(`next 不是当前节点后继: ${args.next}`);
    }
    nextId = args.next;
  } else if (nextNodes.length === 1) {
    nextId = nextNodes[0];
  } else if (nextNodes.length > 1) {
    fail(`当前节点存在多个后继，请传入 --next <node-id>: ${nextNodes.join(",")}`);
  }

  state.nodes[id].status = "completed";
  if (args.note !== undefined) {
    state.nodes[id].note = args.note;
  }

  if (nextId) {
    setCurrent(state, nextId);
  } else {
    state.current = "";
  }

  state.history.push({
    node: id,
    status: "completed",
    note: state.nodes[id].note,
    next: nextId,
    at: nowIso(),
  });
  state.updatedAt = nowIso();
  return state;
}

function maxAttemptForPhase(state, phaseId) {
  return Object.values(state.nodes)
    .filter((node) => node.phase === phaseId)
    .reduce((max, node) => Math.max(max, node.attempt || 1), 0);
}

function retryNode(state, args) {
  const id = state.current;
  if (!id) {
    fail("缺少 current 节点，无法重试");
  }
  assertNodeExists(state, id);

  const currentNode = state.nodes[id];
  if (!state.schema || !currentNode.phase || !currentNode.stage) {
    fail("retry 只支持使用 schema 展开的状态图");
  }
  if (currentNode.status !== "current") {
    fail(`只能重试 current 状态节点: ${id}`);
  }

  const schemaPath = resolveSchemaPath(state.schema.path);
  const schema = readJson(schemaPath);
  const subStages = Array.isArray(schema.subStages) ? schema.subStages : [];
  const schemaEdges = Array.isArray(schema.edges) ? schema.edges : [];
  if (subStages.length === 0) {
    fail(`schema 缺少 subStages: ${schemaPath}`);
  }
  assertUnique(subStages.map((subStage) => subStage.id), "schema.subStages");

  const phaseId = currentNode.phase;
  const currentAttempt = currentNode.attempt || 1;
  const nextAttempt = maxAttemptForPhase(state, phaseId) + 1;
  const schemaDir = path.dirname(state.schema.path);
  const firstStage = subStages[0].id;
  const lastStage = subStages[subStages.length - 1].id;
  const oldTailId = makeAttemptNodeId(phaseId, currentAttempt, lastStage);
  const newFirstId = makeAttemptNodeId(phaseId, nextAttempt, firstStage);
  const newTailId = makeAttemptNodeId(phaseId, nextAttempt, lastStage);
  const migratedEdges = state.edges
    .filter((edge) => edge.from === oldTailId)
    .map((edge) => ({ from: newTailId, to: edge.to }));

  currentNode.status = "failed";
  if (args.note !== undefined) {
    currentNode.note = args.note;
  }

  for (const subStage of subStages) {
    if (!subStage.id) {
      fail(`schema subStages 存在缺少 id 的条目: ${schemaPath}`);
    }
    const newNode = expandSubStage(`${phaseId}@${nextAttempt}`, subStage, schemaDir);
    const nodeId = makeAttemptNodeId(phaseId, nextAttempt, subStage.id);
    if (state.nodes[nodeId]) {
      fail(`重试节点已存在: ${nodeId}`);
    }
    state.nodes[nodeId] = {
      ...newNode,
      id: nodeId,
      phase: phaseId,
      attempt: nextAttempt,
      retryOf: makeAttemptNodeId(phaseId, 1, subStage.id),
      status: "pending",
      note: "",
    };
  }

  state.edges = state.edges.filter((edge) => edge.from !== id && edge.from !== oldTailId);
  for (const edge of schemaEdges) {
    if (!edge.from || !edge.to) {
      fail(`schema edges 存在缺少 from/to 的条目: ${schemaPath}`);
    }
    state.edges.push({
      from: makeAttemptNodeId(phaseId, nextAttempt, edge.from),
      to: makeAttemptNodeId(phaseId, nextAttempt, edge.to),
    });
  }
  state.edges.push({ from: id, to: newFirstId });
  state.edges.push(...migratedEdges);

  assertAcyclic(Object.keys(state.nodes), state.edges);
  setCurrent(state, newFirstId);
  state.history.push({
    node: id,
    status: "failed",
    note: currentNode.note,
    retryStart: newFirstId,
    at: nowIso(),
  });
  state.updatedAt = nowIso();
  return state;
}

function setNode(state, args) {
  const id = args.node || args.id;
  if (!id) {
    fail("缺少 --node <node-id>");
  }
  assertNodeExists(state, id);

  if (args.status) {
    state.nodes[id].status = args.status;
  }
  if (args.note !== undefined) {
    state.nodes[id].note = args.note;
  }
  if (args.current) {
    setCurrent(state, args.current);
  }

  state.history.push({
    node: id,
    status: state.nodes[id].status,
    note: state.nodes[id].note,
    at: nowIso(),
  });
  state.updatedAt = nowIso();
  return state;
}

function printState(state) {
  console.log(`current: ${state.current || ""}`);
  if (state.current && state.nodes[state.current]) {
    const currentNode = state.nodes[state.current];
    const objective = currentNode.objective
      ? `${OBJECTIVE_PREFIX}${currentNode.objective}`
      : "先使用 ysir-regulation 了解与本次行动相关的规范。";
    // show 面向后续 Agent 消费，显式列出当前节点语义和后继节点。
    console.log(`currentLabel: ${currentNode.label || ""}`);
    console.log(`currentPhase: ${currentNode.phase || ""}`);
    console.log(`currentStage: ${currentNode.stage || ""}`);
    console.log(`currentAttempt: ${currentNode.attempt || 1}`);
    console.log(`currentObjective: ${objective}`);
    console.log(`currentTemplate: ${currentNode.template || ""}`);
    const nextNodes = getNextNodes(state, state.current);
    console.log(`next: ${nextNodes.join(",")}`);
  }
  console.log("");
  console.log("nodes:");
  for (const node of Object.values(state.nodes)) {
    const label = node.label ? ` ${node.label}` : "";
    const attempt = node.attempt ? ` attempt=${node.attempt}` : "";
    const retryOf = node.retryOf ? ` retryOf=${node.retryOf}` : "";
    const objective = node.objective ? ` objective=${node.objective}` : "";
    const template = node.template ? ` template=${node.template}` : "";
    const note = node.note ? ` note=${node.note}` : "";
    console.log(`- ${node.id} [${node.status}]${label}${attempt}${retryOf}${objective}${template}${note}`);
  }
  console.log("");
  console.log("edges:");
  for (const edge of state.edges) {
    console.log(`- ${edge.from} -> ${edge.to}`);
  }
}

function usage() {
  console.log([
    "Usage:",
    "  node state.js init --state <state.json> --nodes <a,b,c> [--edges <a>b,b>c>] [--schema <schema.json>] [--current <node>]",
    "  node state.js show --state <state.json>",
    "  node state.js advance --state <state.json> [--note <text>] [--next <node>]",
    "  node state.js retry --state <state.json> [--note <text>]",
    "  node state.js set --state <state.json> --node <node> [--status <status>] [--note <text>] [--current <node>]",
  ].join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || args.help) {
    usage();
    return;
  }

  if (command === "init") {
    if (!args.state) {
      fail("缺少 --state <state.json>");
    }
    if (fs.existsSync(args.state) && !args.force) {
      fail(`状态文件已存在，如需覆盖请传入 --force: ${args.state}`);
    }
    const state = createState(args);
    writeJson(args.state, state);
    printState(state);
    return;
  }

  if (command === "show") {
    printState(requireState(args));
    return;
  }

  const state = requireState(args);
  let nextState;
  if (command === "advance") {
    nextState = advanceNode(state, args);
  } else if (command === "retry") {
    nextState = retryNode(state, args);
  } else if (command === "set") {
    nextState = setNode(state, args);
  } else {
    fail(`未知命令: ${command}`);
  }

  writeJson(args.state, nextState);
  printState(nextState);
}

main();
