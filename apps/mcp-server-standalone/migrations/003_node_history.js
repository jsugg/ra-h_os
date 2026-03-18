'use strict';

/**
 * Migration 003 — Append-only node history table.
 *
 * Every field-level change to a node record writes a row here before the
 * UPDATE is committed. This enables:
 *   - Full rollback to any previous state
 *   - Diff-viewing per node
 *   - Detection of LLM drift over time
 *   - Cross-session provenance audit
 *
 * Schema decisions:
 *   - `field_name` is the column that changed (title, description, notes, etc.)
 *   - `old_value` / `new_value` are TEXT (JSON-serialised for complex fields)
 *   - `changed_by` mirrors nodes.created_via: user | llm_auto | llm_confirmed
 *   - `session_id` links to sessions.id (nullable — pre-session writes have NULL)
 *   - ON DELETE CASCADE so history is cleaned up when a node is deleted
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_history (
      id          INTEGER PRIMARY KEY,
      node_id     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      changed_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      changed_by  TEXT    NOT NULL DEFAULT 'llm_auto',
      field_name  TEXT    NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      session_id  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_history_node_id    ON node_history(node_id, changed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_session_id ON node_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_history_changed_at ON node_history(changed_at DESC);
  `);
}

module.exports = { up };
