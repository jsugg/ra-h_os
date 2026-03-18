'use strict';

/**
 * importance-scaling.bench.js
 *
 * Benchmarks PageRank computation at different graph scales.
 * For each scenario a fresh DB is prepared, N nodes and random edges are
 * seeded via direct SQL (bypassing the service layer for seeding speed), then
 * computeImportanceScores() is called and timed.
 *
 * Scales: 50, 200, 500, 1000 nodes.
 */

const path = require('node:path');
const { makeDb, clearModuleCache } = require(path.resolve(__dirname, '../helpers'));

// ---------------------------------------------------------------------------
// Seeding helpers (direct SQL — fast bulk insert)
// ---------------------------------------------------------------------------

/**
 * Seed N nodes and a random connected graph (1–3 edges per node) into db.
 * Uses prepared statements inside a single transaction for maximum throughput.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} n  Number of nodes to insert
 * @returns {number[]} Array of inserted node IDs
 */
function seedGraph(db, n) {
  const insertNode = db.prepare(
    `INSERT INTO nodes
       (title, description, status, confidence, created_via, importance_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0.0, datetime(), datetime())`
  );

  const insertEdge = db.prepare(
    `INSERT INTO edges
       (from_node_id, to_node_id, source, confidence, context, created_at)
     VALUES (?, ?, ?, ?, ?, datetime())`
  );

  const ids = [];

  // Insert nodes in a single transaction
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const result = insertNode.run(
        `Node ${i}`,
        `Description for node ${i} in the benchmark graph — used for importance score computation.`,
        'active',
        'medium',
        'bench'
      );
      ids.push(Number(result.lastInsertRowid));
    }
  })();

  // Add random edges — each node gets 1–3 outgoing edges to random targets.
  // Kept in a separate transaction so the node list is complete first.
  db.transaction(() => {
    for (let i = 0; i < ids.length; i++) {
      const edgeCount = 1 + (i % 3); // deterministic 1-3, avoids Math.random overhead
      for (let e = 0; e < edgeCount; e++) {
        const targetIdx = (i + e + 1) % ids.length; // simple deterministic target
        if (targetIdx !== i) {
          try {
            insertEdge.run(ids[i], ids[targetIdx], 'bench', 'medium', null);
          } catch (_) {
            // Ignore duplicate edge constraint violations on very small graphs
          }
        }
      }
    }
  })();

  return ids;
}

// ---------------------------------------------------------------------------
// Factory: create one bench scenario for a given node count
// ---------------------------------------------------------------------------

/**
 * @param {number} n
 * @param {number} warmup
 * @param {number} iterations
 * @returns {object}
 */
function makeImportanceBench(n, warmup, iterations) {
  return {
    name: `Importance compute — ${n} nodes`,
    warmup,
    iterations,

    prepare: async () => {
      // Each call to prepare() creates a fresh isolated DB seeded with N nodes.
      // The SAME db is reused for all warmup + measured iterations — we are
      // benchmarking the algorithm on a stable graph, not seeding time.
      const ctx = makeDb();
      const db = ctx.db;
      seedGraph(db, n);
      const importanceService = require(path.resolve(__dirname, '../../services/importanceService'));
      return { ctx, importanceService };
    },

    bench: async (ctx) => {
      ctx.importanceService.computeImportanceScores();
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
  makeImportanceBench(50,   3, 10),
  makeImportanceBench(200,  2,  5),
  makeImportanceBench(500,  1,  3),
  makeImportanceBench(1000, 1,  3),
];
