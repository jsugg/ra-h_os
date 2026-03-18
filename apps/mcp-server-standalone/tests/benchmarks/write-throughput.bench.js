'use strict';

/**
 * write-throughput.bench.js
 *
 * Benchmarks the node write path at different operation shapes:
 *   1. Single node create
 *   2. Node create + 1 history record (triggered by updateNode)
 *   3. Bulk 50 node inserts (sequential, measures sustained write throughput)
 *   4. updateNode with conflict detection (Jaccard + history + status change)
 */

const path = require('node:path');
const { makeDb, clearModuleCache } = require(path.resolve(__dirname, '../helpers'));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a makeDb context and require the service layer bound to it.
 * Returns { ctx, nodeService } — the services are already pointing at the
 * isolated in-memory DB created by makeDb().
 */
function buildContext() {
  const ctx = makeDb();
  const nodeService = require(path.resolve(__dirname, '../../services/nodeService'));
  return { ctx, nodeService };
}

/**
 * Minimal valid node payload for createNode.
 *
 * @param {number} i  — numeric suffix to guarantee unique titles
 * @returns {object}
 */
function nodePayload(i) {
  return {
    title: `Bench Node ${i}`,
    description: `Benchmark test node ${i} — used to measure sustained write throughput under repeated insertions.`,
    dimensions: ['projects'],
    status: 'draft',
    confidence: 'medium',
    created_via: 'llm_auto',
  };
}

/**
 * A description with completely different vocabulary — guaranteed to trigger
 * Jaccard conflict detection (similarity well below 0.3).
 */
const CONFLICTING_DESC =
  'Completely revised entry: cryptography, quantum entanglement, blockchain ledger, distributed hash table, merkle tree verification algorithm.';

// ---------------------------------------------------------------------------
// Scenario 1: Single node create
// ---------------------------------------------------------------------------

let _singleCreateCounter = 0;

/** @type {import('./types').BenchScenario} */
const singleNodeCreate = {
  name: 'Single node create',
  warmup: 20,
  iterations: 200,

  prepare: async () => {
    const { ctx, nodeService } = buildContext();
    return { ctx, nodeService };
  },

  bench: async (ctx) => {
    _singleCreateCounter++;
    ctx.nodeService.createNode(nodePayload(_singleCreateCounter));
  },

  teardown: async (ctx) => {
    ctx.ctx.close();
    clearModuleCache();
  },
};

// ---------------------------------------------------------------------------
// Scenario 2: Node create + 1 history record
// ---------------------------------------------------------------------------

let _historyCounter = 0;

/** @type {import('./types').BenchScenario} */
const nodeCreatePlusHistory = {
  name: 'Node create + 1 history record',
  warmup: 20,
  iterations: 200,

  prepare: async () => {
    const { ctx, nodeService } = buildContext();
    return { ctx, nodeService };
  },

  bench: async (ctx) => {
    _historyCounter++;
    const node = ctx.nodeService.createNode(nodePayload(_historyCounter));
    ctx.nodeService.updateNode(node.id, {
      description: `Updated description for node ${_historyCounter} — this write triggers a history record via the change-tracking path.`,
    });
  },

  teardown: async (ctx) => {
    ctx.ctx.close();
    clearModuleCache();
  },
};

// ---------------------------------------------------------------------------
// Scenario 3: Bulk 50 node inserts (sequential)
// ---------------------------------------------------------------------------

let _bulkBatchCounter = 0;

/** @type {import('./types').BenchScenario} */
const bulk50Inserts = {
  name: 'Bulk 50 node inserts (transaction)',
  warmup: 5,
  iterations: 30,

  prepare: async () => {
    const { ctx, nodeService } = buildContext();
    return { ctx, nodeService };
  },

  bench: async (ctx) => {
    const base = _bulkBatchCounter * 50;
    _bulkBatchCounter++;
    for (let i = 0; i < 50; i++) {
      ctx.nodeService.createNode(nodePayload(base + i));
    }
  },

  teardown: async (ctx) => {
    ctx.ctx.close();
    clearModuleCache();
  },
};

// ---------------------------------------------------------------------------
// Scenario 4: updateNode with conflict detection
// ---------------------------------------------------------------------------

/** @type {import('./types').BenchScenario} */
const updateWithConflict = {
  name: 'updateNode with conflict detection',
  warmup: 20,
  iterations: 200,

  prepare: async () => {
    const { ctx, nodeService } = buildContext();
    // Create a base node that will be updated repeatedly.
    // Each iteration updates the SAME node so we measure only the update path,
    // including Jaccard similarity check and history record insertion.
    const base = nodeService.createNode({
      title: 'Conflict Bench Base Node',
      description: 'Original description with common vocabulary for similarity baseline testing.',
      dimensions: ['projects'],
      status: 'active',
      confidence: 'high',
      created_via: 'user',
    });
    return { ctx, nodeService, baseId: base.id };
  },

  bench: async (ctx) => {
    // Update with a completely different description every iteration.
    // This triggers: Jaccard check → conflict detected → status → 'uncertain' → history write.
    ctx.nodeService.updateNode(ctx.baseId, { description: CONFLICTING_DESC });
  },

  teardown: async (ctx) => {
    ctx.ctx.close();
    clearModuleCache();
  },
};

module.exports = [
  singleNodeCreate,
  nodeCreatePlusHistory,
  bulk50Inserts,
  updateWithConflict,
];
