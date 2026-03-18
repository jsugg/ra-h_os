'use strict';

const { query, transaction, getDb } = require('./sqlite-client');

/**
 * Append-only history service for node changes.
 *
 * Every field-level mutation to a node record is written here before the
 * UPDATE is committed to `nodes`. The history is immutable — rows are never
 * updated or deleted (except by ON DELETE CASCADE when the parent node is
 * removed).
 *
 * This service is called by nodeService.updateNode() — it is not a direct
 * MCP tool but is exposed via the getNodeHistory tool registered in index.js.
 */

/**
 * @typedef {Object} HistoryRow
 * @property {number}      id
 * @property {number}      node_id
 * @property {string}      changed_at   ISO-8601
 * @property {string}      changed_by   user | llm_auto | llm_confirmed
 * @property {string}      field_name
 * @property {string|null} old_value
 * @property {string|null} new_value
 * @property {string|null} session_id
 */

/**
 * Record a single field change.
 *
 * @param {object} params
 * @param {number}      params.nodeId
 * @param {string}      params.fieldName
 * @param {unknown}     params.oldValue
 * @param {unknown}     params.newValue
 * @param {string}      [params.changedBy]   default 'llm_auto'
 * @param {string|null} [params.sessionId]
 */
function recordChange({ nodeId, fieldName, oldValue, newValue, changedBy = 'llm_auto', sessionId = null }) {
  const now = new Date().toISOString();
  const serialize = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  };

  query(
    `INSERT INTO node_history
       (node_id, changed_at, changed_by, field_name, old_value, new_value, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nodeId, now, changedBy, fieldName, serialize(oldValue), serialize(newValue), sessionId]
  );
}

/**
 * Record multiple field changes in a single transaction.
 * Each entry in `changes` corresponds to one field mutation.
 *
 * @param {number}  nodeId
 * @param {Array<{ fieldName: string; oldValue: unknown; newValue: unknown }>} changes
 * @param {string}  [changedBy]
 * @param {string|null} [sessionId]
 */
function recordChanges(nodeId, changes, changedBy = 'llm_auto', sessionId = null) {
  if (!changes || changes.length === 0) return;

  const now = new Date().toISOString();
  const serialize = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  };

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO node_history
      (node_id, changed_at, changed_by, field_name, old_value, new_value, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const { fieldName, oldValue, newValue } of changes) {
      stmt.run(nodeId, now, changedBy, fieldName, serialize(oldValue), serialize(newValue), sessionId);
    }
  });
}

/**
 * Return the full ordered change history for a node.
 *
 * @param {number} nodeId
 * @returns {HistoryRow[]}
 */
function getHistory(nodeId) {
  return query(
    `SELECT id, node_id, changed_at, changed_by, field_name, old_value, new_value, session_id
     FROM node_history
     WHERE node_id = ?
     ORDER BY changed_at ASC, id ASC`,
    [nodeId]
  );
}

/**
 * Return the N most recent changes across all nodes.
 * Useful for session-level audit and Calibration review.
 *
 * @param {number} [limit]
 * @returns {HistoryRow[]}
 */
function getRecentChanges(limit = 50) {
  return query(
    `SELECT h.id, h.node_id, h.changed_at, h.changed_by, h.field_name,
            h.old_value, h.new_value, h.session_id, n.title as node_title
     FROM node_history h
     JOIN nodes n ON n.id = h.node_id
     ORDER BY h.changed_at DESC, h.id DESC
     LIMIT ?`,
    [limit]
  );
}

/**
 * Return all changes from a specific session.
 *
 * @param {string} sessionId
 * @returns {HistoryRow[]}
 */
function getChangesBySession(sessionId) {
  return query(
    `SELECT h.id, h.node_id, h.changed_at, h.changed_by, h.field_name,
            h.old_value, h.new_value, h.session_id, n.title as node_title
     FROM node_history h
     JOIN nodes n ON n.id = h.node_id
     WHERE h.session_id = ?
     ORDER BY h.changed_at ASC, h.id ASC`,
    [sessionId]
  );
}

module.exports = {
  recordChange,
  recordChanges,
  getHistory,
  getRecentChanges,
  getChangesBySession,
};
