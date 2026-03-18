'use strict';

/**
 * Migration 004 — Importance score field.
 *
 * Adds `importance_score REAL DEFAULT 0.0` to `nodes`.
 * The score is computed by importanceService via iterative in-degree weighting
 * (simplified PageRank) and stored here for fast retrieval-time ranking.
 *
 * A dedicated index on importance_score DESC supports efficient top-N queries
 * used by the traversal seed selection and getContext hub nodes.
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
function up(db) {
  const existingCols = db.pragma('table_info(nodes)').map((c) => c.name);

  if (!existingCols.includes('importance_score')) {
    db.exec(`ALTER TABLE nodes ADD COLUMN importance_score REAL NOT NULL DEFAULT 0.0`);
  }

  if (!existingCols.includes('session_id')) {
    db.exec(`ALTER TABLE nodes ADD COLUMN session_id TEXT`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_importance ON nodes(importance_score DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id)`);

  // Edge provenance
  const edgeCols = db.pragma('table_info(edges)').map((c) => c.name);

  if (!edgeCols.includes('session_id')) {
    db.exec(`ALTER TABLE edges ADD COLUMN session_id TEXT`);
  }

  if (!edgeCols.includes('confidence')) {
    db.exec(`ALTER TABLE edges ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium'`);
  }
}

module.exports = { up };
