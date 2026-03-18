'use strict';

/**
 * health-metrics.bench.js
 *
 * Benchmarks getHealthMetrics() computation time at increasing graph sizes.
 * Seeds include variety across status, confidence, and description quality to
 * ensure all metric branches (orphan %, draft %, low-confidence %, vague
 * description %, dimension skew, avg edges/node) are exercised.
 *
 * Scales: 50/30, 200/150, 500/400.
 */

const path = require('node:path');
const { makeDb, clearModuleCache } = require(path.resolve(__dirname, '../helpers'));

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

const STATUSES    = ['active', 'draft', 'active', 'uncertain', 'active', 'draft'];
const CONFIDENCES = ['high', 'medium', 'low', 'high', 'medium', 'low'];
const CREATED_VIA = ['user', 'llm_auto', 'llm_confirmed'];
const DIMENSIONS  = ['projects', 'research', 'memory', 'ideas', 'preferences'];

// Some descriptions are intentionally vague to trigger that metric branch.
const DESCRIPTIONS = [
  'Discusses the core architecture decisions behind the system and their trade-offs.',
  'Concrete implementation of the retry mechanism with exponential back-off and jitter.',
  'Explores the relationship between latency and throughput under sustained write load.',
  'Defines the contract for external API consumers — authentication, rate limits, error codes.',
  'Examines alternative data structures for sparse graph traversal at scale.',
  'Covers the deployment pipeline from CI artefact to production rollout.',
  'Precise specification of the event sourcing pattern used in the write path.',
  'Talks about the monitoring strategy and alerting thresholds for SLO compliance.',
  'Documents the decision to use SQLite over Postgres for embedded use-cases.',
  'Looks at migration strategies for zero-downtime schema evolution.',
];

/**
 * Seed nodeCount nodes and edgeCount edges into db, with variety.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} nodeCount
 * @param {number} edgeCount
 */
function seedHealthGraph(db, nodeCount, edgeCount) {
  const insertNode = db.prepare(
    `INSERT INTO nodes
       (title, description, status, confidence, created_via, importance_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0.0, datetime(), datetime())`
  );

  const insertDim = db.prepare(
    `INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)`
  );

  const insertEdge = db.prepare(
    `INSERT INTO edges
       (from_node_id, to_node_id, source, confidence, context, created_at)
     VALUES (?, ?, ?, ?, ?, datetime())`
  );

  const ids = [];

  // Insert nodes with variety across status, confidence, description quality
  db.transaction(() => {
    for (let i = 0; i < nodeCount; i++) {
      const status     = STATUSES[i % STATUSES.length];
      const confidence = CONFIDENCES[i % CONFIDENCES.length];
      const createdVia = CREATED_VIA[i % CREATED_VIA.length];
      const desc       = DESCRIPTIONS[i % DESCRIPTIONS.length];

      const result = insertNode.run(
        `Health Node ${i}`,
        desc,
        status,
        confidence,
        createdVia
      );
      const nodeId = Number(result.lastInsertRowid);
      ids.push(nodeId);

      // Assign dimensions with intentional skew — projects dominates
      const dim = i % 5 === 0
        ? DIMENSIONS[1]  // research
        : i % 7 === 0
          ? DIMENSIONS[2]  // memory
          : DIMENSIONS[0]; // projects (majority)

      insertDim.run(nodeId, dim);
    }
  })();

  // Insert edges — approximately half the nodes are orphans when edgeCount is low
  if (ids.length > 1 && edgeCount > 0) {
    db.transaction(() => {
      let inserted = 0;
      let attempt  = 0;
      const maxAttempts = edgeCount * 4;

      while (inserted < edgeCount && attempt < maxAttempts) {
        attempt++;
        const fromIdx = attempt % ids.length;
        const toIdx   = (attempt * 3 + 7) % ids.length;
        if (fromIdx === toIdx) continue;

        try {
          insertEdge.run(ids[fromIdx], ids[toIdx], 'bench', 'medium', null);
          inserted++;
        } catch (_) {
          // Duplicate edge — skip, try next pair
        }
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {number} nodeCount
 * @param {number} edgeCount
 * @param {number} warmup
 * @param {number} iterations
 * @returns {object}
 */
function makeHealthBench(nodeCount, edgeCount, warmup, iterations) {
  return {
    name: `Health report — ${nodeCount} nodes, ${edgeCount} edges`,
    warmup,
    iterations,

    prepare: async () => {
      const ctx = makeDb();
      const db = ctx.db;
      seedHealthGraph(db, nodeCount, edgeCount);
      const healthService = require(path.resolve(__dirname, '../../services/healthService'));
      return { ctx, healthService };
    },

    bench: async (ctx) => {
      ctx.healthService.getHealthMetrics();
    },

    teardown: async (ctx) => {
      ctx.ctx.close();
      clearModuleCache();
    },
  };
}

// ---------------------------------------------------------------------------
// Exported scenarios
// ---------------------------------------------------------------------------

module.exports = [
  makeHealthBench(50,   30,  10, 50),
  makeHealthBench(200,  150,  5, 20),
  makeHealthBench(500,  400,  3, 10),
];
