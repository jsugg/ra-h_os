'use strict';

const { query, getDb } = require('./sqlite-client');
const sessionService = require('./sessionService');

/**
 * Edge CRUD service.
 *
 * Enhancements over original:
 *   - createEdge injects session_id and confidence for provenance tracking
 *   - Edge context JSON includes confidence from the write-time call
 */

/** @typedef {'high'|'medium'|'low'} Confidence */

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Safely parse a context JSON blob.
 *
 * @param {string|object|null} context
 * @returns {object|string|null}
 */
function parseContext(context) {
  if (!context) return null;
  if (typeof context === 'object') return context;
  try {
    return JSON.parse(context);
  } catch {
    return context;
  }
}

/**
 * Return edges, optionally filtered by node.
 *
 * @param {object} [filters]
 * @param {number}  [filters.nodeId]
 * @param {number}  [filters.limit]
 * @returns {object[]}
 */
function getEdges(filters = {}) {
  const { nodeId, limit = 50 } = filters;

  let sql = 'SELECT * FROM edges';
  const params = [];

  if (nodeId) {
    sql += ' WHERE from_node_id = ? OR to_node_id = ?';
    params.push(nodeId, nodeId);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return query(sql, params).map((row) => ({ ...row, context: parseContext(row.context) }));
}

/**
 * Return a single edge by ID.
 *
 * @param {number} id
 * @returns {object|null}
 */
function getEdgeById(id) {
  const rows = query('SELECT * FROM edges WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  return { ...rows[0], context: parseContext(rows[0].context) };
}

/**
 * Create a new edge with session provenance.
 *
 * @param {object}     edgeData
 * @param {number}     edgeData.from_node_id
 * @param {number}     edgeData.to_node_id
 * @param {string}     edgeData.explanation
 * @param {string}     [edgeData.source]      default 'mcp'
 * @param {Confidence} [edgeData.confidence]  default 'medium'
 * @returns {object}
 */
function createEdge(edgeData) {
  const {
    from_node_id,
    to_node_id,
    explanation,
    source = 'mcp',
    confidence = 'medium',
  } = edgeData;

  if (!from_node_id || !to_node_id) {
    throw new Error('from_node_id and to_node_id are required');
  }

  if (!explanation || !explanation.trim()) {
    throw new Error('Edge explanation is required');
  }

  const safeConfidence = VALID_CONFIDENCE.has(confidence) ? confidence : 'medium';
  const sessionId = sessionService.getCurrentSessionId();
  const now = new Date().toISOString();
  const db = getDb();

  const context = {
    type: 'related_to',
    confidence: safeConfidence,
    inferred_at: now,
    explanation: explanation.trim(),
    created_via: 'mcp',
  };

  const stmt = db.prepare(`
    INSERT INTO edges (from_node_id, to_node_id, context, source, session_id, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    from_node_id,
    to_node_id,
    JSON.stringify(context),
    source,
    sessionId,
    safeConfidence,
    now
  );

  return getEdgeById(Number(result.lastInsertRowid));
}

/**
 * Update an edge explanation.
 *
 * @param {number} id
 * @param {object} updates
 * @param {string}  [updates.explanation]
 * @param {object}  [updates.context]
 * @returns {object}
 */
function updateEdge(id, updates) {
  const { explanation, context: contextUpdates } = updates;
  const db = getDb();

  const existing = getEdgeById(id);
  if (!existing) {
    throw new Error(`Edge with ID ${id} not found. Use rah_query_edges to find edges by node ID.`);
  }

  if (explanation && explanation.trim()) {
    const now = new Date().toISOString();
    const newContext = {
      ...existing.context,
      explanation: explanation.trim(),
      inferred_at: now,
      created_via: 'mcp',
    };
    db.prepare('UPDATE edges SET context = ? WHERE id = ?').run(JSON.stringify(newContext), id);
  } else if (contextUpdates) {
    const newContext = { ...existing.context, ...contextUpdates };
    db.prepare('UPDATE edges SET context = ? WHERE id = ?').run(JSON.stringify(newContext), id);
  }

  return getEdgeById(id);
}

/**
 * Delete an edge.
 *
 * @param {number} id
 * @returns {boolean}
 */
function deleteEdge(id) {
  const result = query('DELETE FROM edges WHERE id = ?', [id]);
  if (result.changes === 0) {
    throw new Error(`Edge with ID ${id} not found. Use rah_query_edges to find edges by node ID.`);
  }
  return true;
}

/**
 * Return all edges connected to a node, enriched with neighbour node info.
 *
 * @param {number} nodeId
 * @returns {object[]}
 */
function getNodeConnections(nodeId) {
  const sql = `
    SELECT
      e.*,
      CASE WHEN e.from_node_id = ? THEN n_to.id          ELSE n_from.id          END as connected_node_id,
      CASE WHEN e.from_node_id = ? THEN n_to.title        ELSE n_from.title        END as connected_node_title,
      CASE WHEN e.from_node_id = ? THEN n_to.description  ELSE n_from.description  END as connected_node_description
    FROM edges e
    LEFT JOIN nodes n_from ON e.from_node_id = n_from.id
    LEFT JOIN nodes n_to   ON e.to_node_id   = n_to.id
    WHERE e.from_node_id = ? OR e.to_node_id = ?
    ORDER BY e.created_at DESC
  `;

  return query(sql, [nodeId, nodeId, nodeId, nodeId, nodeId]).map((row) => ({
    edgeId: row.id,
    from_node_id: row.from_node_id,
    to_node_id: row.to_node_id,
    context: parseContext(row.context),
    connected_node: {
      id: row.connected_node_id,
      title: row.connected_node_title,
      description: row.connected_node_description,
    },
  }));
}

/**
 * Return total edge count.
 *
 * @returns {number}
 */
function getEdgeCount() {
  return Number(query('SELECT COUNT(*) as count FROM edges')[0].count);
}

module.exports = {
  getEdges,
  getEdgeById,
  createEdge,
  updateEdge,
  deleteEdge,
  getNodeConnections,
  getEdgeCount,
};
