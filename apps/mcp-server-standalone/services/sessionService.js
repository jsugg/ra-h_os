'use strict';

const crypto = require('node:crypto');
const { query, getDb } = require('./sqlite-client');

/**
 * Session lifecycle management.
 *
 * Each MCP server process lifetime is a single session. A session_id is
 * generated at startup (startSession) and stored as a module-level singleton.
 * All node and edge writes in this process receive this session_id for
 * provenance tracking.
 *
 * Sessions are used for:
 *   - Per-session rollback (find all writes from a given session)
 *   - Coverage gap analysis (what was discussed vs. what was saved)
 *   - Skill execution attribution
 */

/** @type {string | null} */
let _currentSessionId = null;

/**
 * Start a new session for this process lifetime.
 * Writes the session record to the database.
 * Must be called after initDatabase().
 *
 * @returns {string} The new session ID.
 */
function startSession() {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  query(
    'INSERT INTO sessions (id, started_at) VALUES (?, ?)',
    [id, now]
  );

  _currentSessionId = id;
  return id;
}

/**
 * Return the session ID for this process.
 * Initialises lazily on first call (safe for any call order with initDatabase).
 *
 * @returns {string}
 */
function getCurrentSessionId() {
  if (!_currentSessionId) {
    _currentSessionId = startSession();
  }
  return _currentSessionId;
}

/**
 * Mark the current session as ended, optionally attaching a summary.
 *
 * @param {string} [summary]
 */
function endCurrentSession(summary) {
  if (!_currentSessionId) return;

  const now = new Date().toISOString();
  query(
    'UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?',
    [now, summary ?? null, _currentSessionId]
  );
}

/**
 * Return the N most recent sessions.
 *
 * @param {number} [limit]
 * @returns {Array<{ id: string; started_at: string; ended_at: string|null; summary: string|null }>}
 */
function getRecentSessions(limit = 10) {
  return query(
    'SELECT id, started_at, ended_at, summary FROM sessions ORDER BY started_at DESC LIMIT ?',
    [limit]
  );
}

/**
 * Return a single session by ID.
 *
 * @param {string} sessionId
 * @returns {{ id: string; started_at: string; ended_at: string|null; summary: string|null } | null}
 */
function getSessionById(sessionId) {
  const rows = query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Update an existing session's summary.
 *
 * @param {string} sessionId
 * @param {string} summary
 */
function updateSessionSummary(sessionId, summary) {
  query(
    'UPDATE sessions SET summary = ? WHERE id = ?',
    [summary, sessionId]
  );
}

module.exports = {
  startSession,
  getCurrentSessionId,
  endCurrentSession,
  getRecentSessions,
  getSessionById,
  updateSessionSummary,
};
