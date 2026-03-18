'use strict';

const { query, transaction, getDb } = require('./sqlite-client');

/**
 * Importance scoring service.
 *
 * Computes a PageRank-style importance score for every node based on edge
 * connectivity. Nodes referenced by many other nodes (high in-degree) receive
 * higher scores. The algorithm runs iteratively until convergence or a maximum
 * iteration count.
 *
 * Scores are persisted to nodes.importance_score so retrieval tools can rank
 * by importance without running the algorithm on every query.
 *
 * The score is NOT a true PageRank (no dangling-node normalisation, no
 * teleportation factor) — it is a simplified iterative in-degree weighting
 * appropriate for small personal knowledge graphs (< 10,000 nodes).
 *
 * Call computeImportanceScores() after bulk writes or periodically at
 * Calibration time. For single-node updates the incremental version is used.
 */

const DAMPING = 0.85;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 1e-6;
const INITIAL_SCORE = 1.0;

/**
 * Run the full importance computation across all nodes.
 * Updates nodes.importance_score in a single transaction.
 *
 * @returns {{ nodesUpdated: number; iterations: number; converged: boolean }}
 */
function computeImportanceScores() {
  const nodes = query('SELECT id FROM nodes');
  if (nodes.length === 0) {
    return { nodesUpdated: 0, iterations: 0, converged: true };
  }

  const edges = query('SELECT from_node_id, to_node_id FROM edges');

  const nodeIds = nodes.map((n) => n.id);
  const N = nodeIds.length;

  // Build adjacency: out-edges per source node
  /** @type {Map<number, number[]>} */
  const outEdges = new Map();
  /** @type {Map<number, number[]>} */
  const inEdges = new Map();

  for (const id of nodeIds) {
    outEdges.set(id, []);
    inEdges.set(id, []);
  }

  for (const edge of edges) {
    const from = edge.from_node_id;
    const to = edge.to_node_id;
    if (outEdges.has(from) && inEdges.has(to)) {
      outEdges.get(from).push(to);
      inEdges.get(to).push(from);
    }
  }

  // Initialise scores
  /** @type {Map<number, number>} */
  let scores = new Map(nodeIds.map((id) => [id, INITIAL_SCORE]));

  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iterations++;
    /** @type {Map<number, number>} */
    const newScores = new Map();
    let maxDelta = 0;

    for (const id of nodeIds) {
      const incoming = inEdges.get(id) || [];
      let rankSum = 0;

      for (const srcId of incoming) {
        const srcOutCount = outEdges.get(srcId)?.length || 1;
        rankSum += (scores.get(srcId) || INITIAL_SCORE) / srcOutCount;
      }

      const newScore = (1 - DAMPING) + DAMPING * rankSum;
      newScores.set(id, newScore);
      maxDelta = Math.max(maxDelta, Math.abs(newScore - (scores.get(id) || INITIAL_SCORE)));
    }

    scores = newScores;

    if (maxDelta < CONVERGENCE_THRESHOLD) {
      converged = true;
      break;
    }
  }

  // Normalise to [0, 1] range
  const maxScore = Math.max(...scores.values());
  if (maxScore > 0) {
    for (const [id, score] of scores) {
      scores.set(id, score / maxScore);
    }
  }

  // Persist to database
  const db = getDb();
  const updateStmt = db.prepare('UPDATE nodes SET importance_score = ? WHERE id = ?');

  transaction(() => {
    for (const [id, score] of scores) {
      updateStmt.run(Number(score.toFixed(6)), id);
    }
  });

  return { nodesUpdated: N, iterations, converged };
}

/**
 * Return the top N nodes by importance score.
 * Useful for getContext hub node selection and traversal seeding.
 *
 * @param {number} [limit]
 * @returns {Array<{ id: number; title: string; importance_score: number; edge_count: number }>}
 */
function getTopNodes(limit = 10) {
  return query(
    `SELECT n.id, n.title, n.importance_score,
            COUNT(e.id) as edge_count
     FROM nodes n
     LEFT JOIN edges e ON n.id = e.from_node_id OR n.id = e.to_node_id
     GROUP BY n.id
     ORDER BY n.importance_score DESC, edge_count DESC
     LIMIT ?`,
    [limit]
  );
}

/**
 * Return nodes with zero edges (topological orphans).
 * These are prime candidates for connection or deletion during Calibration.
 *
 * @param {number} [limit]
 * @returns {Array<{ id: number; title: string; status: string; created_at: string }>}
 */
function getOrphanNodes(limit = 50) {
  return query(
    `SELECT n.id, n.title, n.status, n.created_at
     FROM nodes n
     WHERE NOT EXISTS (
       SELECT 1 FROM edges e
       WHERE e.from_node_id = n.id OR e.to_node_id = n.id
     )
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

module.exports = {
  computeImportanceScores,
  getTopNodes,
  getOrphanNodes,
};
