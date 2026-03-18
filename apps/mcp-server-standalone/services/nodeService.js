'use strict';

const { query, transaction, getDb } = require('./sqlite-client');
const historyService = require('./historyService');
const sessionService = require('./sessionService');

/**
 * Node CRUD service.
 *
 * Write-path enhancements over the original:
 *   - createNode injects session_id, status, confidence, created_via
 *   - updateNode records field-level history before committing, runs
 *     semantic conflict detection on description changes
 *   - promoteNode transitions lifecycle status
 */

/** @typedef {'active'|'draft'|'deprecated'|'superseded'|'uncertain'} NodeStatus */
/** @typedef {'high'|'medium'|'low'} Confidence */
/** @typedef {'user'|'llm_auto'|'llm_confirmed'} CreatedVia */

const VALID_STATUSES = new Set(['active', 'draft', 'deprecated', 'superseded', 'uncertain']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_CREATED_VIA = new Set(['user', 'llm_auto', 'llm_confirmed']);

/**
 * Minimum token overlap ratio to flag a description change as a potential
 * conflict. If the new description has < threshold Jaccard similarity with the
 * old, the node status is set to 'uncertain' automatically.
 */
const CONFLICT_SIMILARITY_THRESHOLD = 0.3;

/**
 * Compute a token-level Jaccard similarity between two strings.
 * Intentionally lightweight — catches wholesale replacements, not minor edits.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function jaccardSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * SELECT projection shared by all read queries.
 */
const NODE_SELECT_SQL = `
  SELECT n.id, n.title, n.description, n.notes, n.link, n.event_date, n.metadata, n.chunk,
         n.created_at, n.updated_at, n.status, n.confidence, n.created_via,
         n.importance_score, n.session_id,
         COALESCE(
           (SELECT JSON_GROUP_ARRAY(d.dimension) FROM node_dimensions d WHERE d.node_id = n.id),
           '[]'
         ) as dimensions_json
  FROM nodes n
`;

/**
 * Deserialise a raw database row into a Node object.
 *
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function deserialiseNode(row) {
  return {
    ...row,
    dimensions: JSON.parse(row.dimensions_json || '[]'),
    metadata: row.metadata
      ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
      : null,
    dimensions_json: undefined,
  };
}

/**
 * Return nodes matching optional filters.
 *
 * @param {object} [filters]
 * @param {string[]} [filters.dimensions]
 * @param {string}   [filters.search]
 * @param {string}   [filters.status]
 * @param {string}   [filters.confidence]
 * @param {number}   [filters.limit]
 * @param {number}   [filters.offset]
 * @param {string}   [filters.created_after]
 * @param {string}   [filters.created_before]
 * @param {string}   [filters.event_after]
 * @param {string}   [filters.event_before]
 * @returns {Record<string, unknown>[]}
 */
function getNodes(filters = {}) {
  const {
    dimensions, search, status, confidence,
    limit = 100, offset = 0,
    created_after, created_before, event_after, event_before,
  } = filters;

  let sql = NODE_SELECT_SQL + ' WHERE 1=1';
  const params = [];

  if (dimensions && dimensions.length > 0) {
    sql += ` AND EXISTS (
      SELECT 1 FROM node_dimensions nd
      WHERE nd.node_id = n.id
      AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
    )`;
    params.push(...dimensions);
  }

  if (search) {
    sql += ` AND (n.title LIKE ? COLLATE NOCASE
             OR n.description LIKE ? COLLATE NOCASE
             OR n.notes LIKE ? COLLATE NOCASE)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (status) {
    if (Array.isArray(status)) {
      sql += ` AND n.status IN (${status.map(() => '?').join(',')})`;
      params.push(...status);
    } else {
      sql += ' AND n.status = ?';
      params.push(status);
    }
  }
  if (confidence) { sql += ' AND n.confidence = ?'; params.push(confidence); }

  if (created_after)  { sql += ' AND n.created_at >= ?'; params.push(created_after); }
  if (created_before) { sql += ' AND n.created_at <  ?'; params.push(created_before); }
  if (event_after)    { sql += ' AND n.event_date  >= ?'; params.push(event_after); }
  if (event_before)   { sql += ' AND n.event_date  <  ?'; params.push(event_before); }

  if (search) {
    sql += ` ORDER BY
      CASE WHEN LOWER(n.title) = LOWER(?) THEN 1 ELSE 6 END,
      CASE WHEN LOWER(n.title) LIKE LOWER(?) THEN 2 ELSE 6 END,
      CASE WHEN n.title LIKE ? COLLATE NOCASE THEN 3 ELSE 6 END,
      CASE WHEN n.description LIKE ? COLLATE NOCASE THEN 4 ELSE 6 END,
      n.updated_at DESC`;
    params.push(search, `${search}%`, `%${search}%`, `%${search}%`);
  } else {
    sql += ' ORDER BY n.importance_score DESC, n.updated_at DESC';
  }

  sql += ' LIMIT ?';
  params.push(limit);

  if (offset > 0) {
    sql += ' OFFSET ?';
    params.push(offset);
  }

  return query(sql, params).map(deserialiseNode);
}

/**
 * Fetch a single node by primary key.
 *
 * @param {number} id
 * @returns {Record<string, unknown> | null}
 */
function getNodeById(id) {
  const rows = query(NODE_SELECT_SQL + ' WHERE n.id = ?', [id]);
  return rows.length > 0 ? deserialiseNode(rows[0]) : null;
}

/**
 * Strip common extraction artefacts from a raw title string.
 *
 * @param {string} title
 * @returns {string}
 */
function sanitizeTitle(title) {
  let clean = title.trim();
  if (clean.startsWith('Title: ')) clean = clean.slice(7);
  if (clean.endsWith(' / X')) clean = clean.slice(0, -4);
  clean = clean.replace(/\s+/g, ' ');
  return clean.slice(0, 160);
}

/**
 * Create a new node.
 *
 * @param {object} nodeData
 * @param {string}      nodeData.title
 * @param {string}      [nodeData.description]
 * @param {string}      [nodeData.notes]
 * @param {string}      [nodeData.link]
 * @param {string}      [nodeData.event_date]
 * @param {string[]}    [nodeData.dimensions]
 * @param {string}      [nodeData.chunk]
 * @param {object}      [nodeData.metadata]
 * @param {NodeStatus}  [nodeData.status]      Default: 'draft'
 * @param {Confidence}  [nodeData.confidence]  Default: 'medium'
 * @param {CreatedVia}  [nodeData.created_via] Default: 'llm_auto'
 * @returns {Record<string, unknown>}
 */
function createNode(nodeData) {
  const {
    title: rawTitle,
    description,
    notes,
    link,
    event_date,
    dimensions = [],
    chunk,
    metadata = {},
    status,            // no default — derived from created_via below
    confidence = 'medium',
    created_via = 'llm_auto',
  } = nodeData;

  const title = sanitizeTitle(rawTitle);
  const now = new Date().toISOString();
  const sessionId = sessionService.getCurrentSessionId();
  const db = getDb();

  // Compute safeCreatedVia first so status default can depend on it:
  // user-initiated writes default to 'active'; LLM writes default to 'draft'.
  const safeCreatedVia = VALID_CREATED_VIA.has(created_via) ? created_via : 'llm_auto';
  const defaultStatus = safeCreatedVia === 'user' ? 'active' : 'draft';
  const safeStatus = VALID_STATUSES.has(status) ? status : defaultStatus;
  const safeConfidence = VALID_CONFIDENCE.has(confidence) ? confidence : 'medium';

  let chunkToStore = chunk ?? null;
  if (!chunkToStore?.trim()) {
    const fallback = [title, description, notes].filter(Boolean).join('\n\n').trim();
    if (fallback) chunkToStore = fallback;
  }

  const nodeId = transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO nodes
        (title, description, notes, link, event_date, metadata, chunk,
         status, confidence, created_via, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description ?? null,
      notes ?? null,
      link ?? null,
      event_date ?? null,
      JSON.stringify(metadata),
      chunkToStore,
      safeStatus,
      safeConfidence,
      safeCreatedVia,
      sessionId,
      now,
      now
    );

    const id = Number(result.lastInsertRowid);

    if (dimensions.length > 0) {
      const dimStmt = db.prepare(
        'INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)'
      );
      for (const dimension of dimensions) {
        dimStmt.run(id, dimension);
      }
    }

    return id;
  });

  return getNodeById(nodeId);
}

/**
 * Update an existing node.
 *
 * - Records field-level history before committing any change.
 * - Detects description conflicts and flags the node as 'uncertain'.
 * - `notes` is APPENDED by default (pass appendNotes=false to replace).
 *
 * @param {number} id
 * @param {object} updates
 * @param {object} [options]
 * @param {boolean} [options.appendNotes]   default true
 * @param {string}  [options.changedBy]     default 'llm_auto'
 * @returns {{ node: Record<string, unknown>; changed_fields: object[]; conflict_detected: boolean }}
 */
function updateNode(id, updates, options = {}) {
  const { appendNotes = true, changedBy = 'llm_auto' } = options;
  const {
    title, description, notes, link, event_date,
    dimensions, chunk, metadata, status, confidence,
  } = updates;
  const now = new Date().toISOString();
  const db = getDb();
  const sessionId = sessionService.getCurrentSessionId();

  const existing = getNodeById(id);
  if (!existing) {
    throw new Error(`Node with ID ${id} not found. Use rah_search_nodes to find nodes by keyword.`);
  }

  /** @type {Array<{ fieldName: string; oldValue: unknown; newValue: unknown }>} */
  const changes = [];
  let conflictDetected = false;

  if (title !== undefined && title !== existing.title) {
    changes.push({ fieldName: 'title', oldValue: existing.title, newValue: title });
  }

  if (description !== undefined && description !== existing.description) {
    const similarity = jaccardSimilarity(
      String(existing.description || ''),
      String(description || '')
    );
    conflictDetected = similarity < CONFLICT_SIMILARITY_THRESHOLD && Boolean(existing.description);
    changes.push({ fieldName: 'description', oldValue: existing.description, newValue: description });
  }

  if (notes !== undefined) {
    const finalNotes = appendNotes && existing.notes
      ? existing.notes + '\n\n' + notes
      : notes;
    if (finalNotes !== existing.notes) {
      changes.push({ fieldName: 'notes', oldValue: existing.notes, newValue: finalNotes });
    }
  }

  if (link !== undefined && link !== existing.link) {
    changes.push({ fieldName: 'link', oldValue: existing.link, newValue: link });
  }
  if (event_date !== undefined && event_date !== existing.event_date) {
    changes.push({ fieldName: 'event_date', oldValue: existing.event_date, newValue: event_date });
  }
  if (chunk !== undefined && chunk !== existing.chunk) {
    changes.push({ fieldName: 'chunk', oldValue: existing.chunk, newValue: chunk });
  }
  if (metadata !== undefined) {
    changes.push({ fieldName: 'metadata', oldValue: existing.metadata, newValue: metadata });
  }
  if (status !== undefined && VALID_STATUSES.has(status) && status !== existing.status) {
    changes.push({ fieldName: 'status', oldValue: existing.status, newValue: status });
  }
  if (confidence !== undefined && VALID_CONFIDENCE.has(confidence) && confidence !== existing.confidence) {
    changes.push({ fieldName: 'confidence', oldValue: existing.confidence, newValue: confidence });
  }

  // Record history before mutation
  if (changes.length > 0) {
    historyService.recordChanges(id, changes, changedBy, sessionId);
  }

  // Commit update
  transaction(() => {
    const setFields = [];
    const params = [];

    if (title !== undefined) { setFields.push('title = ?'); params.push(title); }
    if (description !== undefined) { setFields.push('description = ?'); params.push(description); }

    if (notes !== undefined) {
      const finalNotes = appendNotes && existing.notes
        ? existing.notes + '\n\n' + notes
        : notes;
      setFields.push('notes = ?');
      params.push(finalNotes);
    }

    if (link !== undefined) { setFields.push('link = ?'); params.push(link); }
    if (event_date !== undefined) { setFields.push('event_date = ?'); params.push(event_date); }
    if (chunk !== undefined) { setFields.push('chunk = ?'); params.push(chunk); }
    if (metadata !== undefined) { setFields.push('metadata = ?'); params.push(JSON.stringify(metadata)); }

    // If conflict detected, force status to 'uncertain' unless caller is explicitly overriding
    const resolvedStatus = conflictDetected
      ? 'uncertain'
      : (status && VALID_STATUSES.has(status) ? status : undefined);

    if (resolvedStatus !== undefined) { setFields.push('status = ?'); params.push(resolvedStatus); }
    if (confidence !== undefined && VALID_CONFIDENCE.has(confidence)) {
      setFields.push('confidence = ?');
      params.push(confidence);
    }

    setFields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    if (setFields.length > 1) {
      db.prepare(`UPDATE nodes SET ${setFields.join(', ')} WHERE id = ?`).run(...params);
    }

    if (Array.isArray(dimensions)) {
      db.prepare('DELETE FROM node_dimensions WHERE node_id = ?').run(id);
      const dimStmt = db.prepare('INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)');
      for (const dim of dimensions) {
        dimStmt.run(id, dim);
      }
    }
  });

  const updatedNode = getNodeById(id);

  return {
    node: updatedNode,
    changed_fields: changes.map((c) => ({
      field: c.fieldName,
      old: c.oldValue,
      new: c.newValue,
    })),
    conflict_detected: conflictDetected,
  };
}

/**
 * Transition a node's lifecycle status.
 *
 * @param {number}     id
 * @param {NodeStatus} newStatus
 * @param {string}     [changedBy]
 * @returns {Record<string, unknown>}
 */
function promoteNode(id, newStatus, changedBy = 'llm_auto') {
  if (!VALID_STATUSES.has(newStatus)) {
    throw new Error(`Invalid status "${newStatus}". Valid values: ${[...VALID_STATUSES].join(', ')}`);
  }

  const existing = getNodeById(id);
  if (!existing) {
    throw new Error(`Node with ID ${id} not found.`);
  }

  if (existing.status === newStatus) {
    return existing;
  }

  const sessionId = sessionService.getCurrentSessionId();
  historyService.recordChange({
    nodeId: id,
    fieldName: 'status',
    oldValue: existing.status,
    newValue: newStatus,
    changedBy,
    sessionId,
  });

  query('UPDATE nodes SET status = ?, updated_at = ? WHERE id = ?', [
    newStatus,
    new Date().toISOString(),
    id,
  ]);

  return getNodeById(id);
}

/**
 * Delete a node by ID.
 *
 * @param {number} id
 * @returns {boolean}
 */
function deleteNode(id) {
  const result = query('DELETE FROM nodes WHERE id = ?', [id]);
  if (result.changes === 0) {
    throw new Error(`Node with ID ${id} not found. Use rah_search_nodes to find nodes by keyword.`);
  }
  return true;
}

/**
 * Return total node count.
 *
 * @returns {number}
 */
function getNodeCount() {
  return Number(query('SELECT COUNT(*) as count FROM nodes')[0].count);
}

/**
 * Return the knowledge graph context overview.
 * Used by the getContext MCP tool.
 *
 * @returns {object}
 */
function getContext() {
  const nodeCount = query('SELECT COUNT(*) as count FROM nodes')[0].count;
  const edgeCount = query('SELECT COUNT(*) as count FROM edges')[0].count;

  const dimensionService = require('./dimensionService');
  const dimensions = dimensionService.getDimensions();

  const recentNodes = query(`
    SELECT n.id, n.title, n.description, n.status, n.confidence,
           GROUP_CONCAT(nd.dimension) as dimensions
    FROM nodes n
    LEFT JOIN node_dimensions nd ON n.id = nd.node_id
    GROUP BY n.id
    ORDER BY n.created_at DESC
    LIMIT 5
  `);

  const hubNodes = query(`
    SELECT n.id, n.title, n.description, n.status, n.importance_score,
           COUNT(e.id) as edge_count
    FROM nodes n
    LEFT JOIN edges e ON n.id = e.from_node_id OR n.id = e.to_node_id
    GROUP BY n.id
    ORDER BY n.importance_score DESC, edge_count DESC
    LIMIT 5
  `);

  const draftCount = Number(
    query(`SELECT COUNT(*) as c FROM nodes WHERE status IN ('draft', 'uncertain')`)[0].c
  );
  const orphanCount = Number(
    query(`
      SELECT COUNT(*) as c FROM nodes n
      WHERE NOT EXISTS (
        SELECT 1 FROM edges e WHERE e.from_node_id = n.id OR e.to_node_id = n.id
      )
    `)[0].c
  );

  const nodeCountNum = Number(nodeCount);
  const orphanPct = nodeCountNum > 0 ? (orphanCount / nodeCountNum) * 100 : 0;
  const draftPct = nodeCountNum > 0 ? (draftCount / nodeCountNum) * 100 : 0;
  const healthDegraded = nodeCountNum > 0 && (orphanPct > 20 || draftPct > 30);

  return {
    stats: { nodeCount, edgeCount, dimensionCount: dimensions.length },
    dimensions,
    recentNodes,
    hubNodes,
    healthSignals: { draftCount, orphanCount, healthDegraded },
  };
}

module.exports = {
  getNodes,
  getNodeById,
  createNode,
  updateNode,
  promoteNode,
  deleteNode,
  getNodeCount,
  getContext,
};
