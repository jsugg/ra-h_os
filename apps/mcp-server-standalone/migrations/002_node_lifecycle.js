'use strict';

/**
 * Migration 002 — Node lifecycle fields.
 *
 * Adds three columns to `nodes` that enable the write-path reliability layer:
 *
 *   status      — lifecycle state for every node
 *                 active | draft | deprecated | superseded | uncertain
 *                 Default: 'active' so existing rows are unaffected.
 *
 *   confidence  — LLM certainty about the write
 *                 high | medium | low
 *                 Default: 'medium' for existing rows.
 *
 *   created_via — origin of the write
 *                 user | llm_auto | llm_confirmed
 *                 Default: 'llm_auto' (conservative assumption for old rows).
 *
 * ALTER TABLE … ADD COLUMN is safe on existing databases. SQLite ignores the
 * statement with an error only when the column already exists — we guard with
 * a column-existence check so the migration is always idempotent.
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
function up(db) {
  const existingCols = db.pragma('table_info(nodes)').map((c) => c.name);

  if (!existingCols.includes('status')) {
    db.exec(`ALTER TABLE nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }

  if (!existingCols.includes('confidence')) {
    db.exec(`ALTER TABLE nodes ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium'`);
  }

  if (!existingCols.includes('created_via')) {
    db.exec(`ALTER TABLE nodes ADD COLUMN created_via TEXT NOT NULL DEFAULT 'llm_auto'`);
  }

  // Index for lifecycle queries (e.g. "show all drafts")
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_confidence ON nodes(confidence)`);
}

module.exports = { up };
