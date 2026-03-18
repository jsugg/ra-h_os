'use strict';

/**
 * Migration 005 — Session tracking and skill execution log.
 *
 * sessions
 *   Tracks each MCP server process lifetime as a session. A new session_id is
 *   generated at startup and propagated to all node/edge writes in that session.
 *   This enables: per-session rollback, per-session diff view, coverage analysis
 *   across sessions, and detection of sessions with high write error rates.
 *
 * skill_executions
 *   Records every skill execution (readSkill + associated writes) for:
 *   - Skill recency monitoring (a skill not run in 90 days should be audited)
 *   - Output contract verification results
 *   - Cross-session skill coverage analysis
 *
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
function up(db) {
  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT    PRIMARY KEY,
      started_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at   TEXT,
      summary    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
  `);

  // Skill executions log
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_executions (
      id             INTEGER PRIMARY KEY,
      skill_name     TEXT    NOT NULL,
      executed_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      session_id     TEXT,
      nodes_read     TEXT,   -- JSON array of node IDs
      nodes_written  TEXT,   -- JSON array of node IDs
      edges_written  TEXT,   -- JSON array of edge IDs
      contract_passed INTEGER DEFAULT NULL   -- 1 = pass, 0 = fail, NULL = not checked
    );

    CREATE INDEX IF NOT EXISTS idx_skill_exec_name    ON skill_executions(skill_name, executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skill_exec_session ON skill_executions(session_id);
  `);

}

module.exports = { up };
