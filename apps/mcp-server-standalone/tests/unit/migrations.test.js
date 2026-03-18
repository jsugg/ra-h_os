'use strict';

/**
 * Unit tests — Migration Runner
 *
 * Verifies that every migration in the 001–005 series:
 *   - Creates the expected tables and columns
 *   - Seeds the expected data
 *   - Creates the expected indexes
 *   - Leaves the schema_migrations tracking table consistent
 *
 * Every test operates on its own isolated in-memory SQLite database
 * created by makeDb() so there is no shared state between suites.
 */

const { describe, it, beforeAll, afterAll, assert, run } = require('../framework');
const { makeDb } = require('../helpers');
const { runMigrations, currentVersion } = require('../../migrations/runner');

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Return sorted list of column names for a table.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {string[]}
 */
function columnNames(db, tableName) {
  return db.pragma(`table_info(${tableName})`).map((c) => c.name);
}

/**
 * Return the pragma row for a specific column (or undefined).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {string} colName
 * @returns {object|undefined}
 */
function columnInfo(db, tableName, colName) {
  return db.pragma(`table_info(${tableName})`).find((c) => c.name === colName);
}

/**
 * Return true if a table exists in sqlite_master.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {boolean}
 */
function tableExists(db, tableName) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
}

/**
 * Return true if an index exists in sqlite_master.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} indexName
 * @returns {boolean}
 */
function indexExists(db, indexName) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .get(indexName);
}

// ---------------------------------------------------------------------------
// Suite 1 — Runner core behaviour
// ---------------------------------------------------------------------------

describe('Migration Runner — core', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('runMigrations() applies all 5 migrations on a fresh database', () => {
    // makeDb() already calls initDatabase() which runs migrations internally,
    // so currentVersion must already be 5. We just assert the post-init state.
    assert.strictEqual(currentVersion(ctx.db), 5);
  });

  it('runMigrations() is idempotent — second call returns 0 new migrations', () => {
    const applied = runMigrations(ctx.db);
    assert.strictEqual(applied, 0);
  });

  it('currentVersion() returns 5 after a full migration run', () => {
    assert.strictEqual(currentVersion(ctx.db), 5);
  });

  it('schema_migrations table has exactly 5 rows', () => {
    const count = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get().n;
    assert.strictEqual(count, 5);
  });

  it('schema_migrations rows have contiguous versions 1–5', () => {
    const versions = ctx.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all()
      .map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4, 5]);
  });

  it('schema_migrations rows carry non-empty name values', () => {
    const names = ctx.db
      .prepare('SELECT name FROM schema_migrations ORDER BY version ASC')
      .all()
      .map((r) => r.name);
    for (const name of names) {
      assert.ok(name && name.length > 0, `Migration name must not be empty, got: ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Migration 001: Initial schema
// ---------------------------------------------------------------------------

describe('Migration 001 — initial schema', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('nodes table exists', () => {
    assert.ok(tableExists(ctx.db, 'nodes'), 'nodes table must exist');
  });

  it('edges table exists', () => {
    assert.ok(tableExists(ctx.db, 'edges'), 'edges table must exist');
  });

  it('node_dimensions table exists', () => {
    assert.ok(tableExists(ctx.db, 'node_dimensions'), 'node_dimensions table must exist');
  });

  it('dimensions table exists', () => {
    assert.ok(tableExists(ctx.db, 'dimensions'), 'dimensions table must exist');
  });

  it('nodes table has all baseline columns', () => {
    const cols = columnNames(ctx.db, 'nodes');
    const required = [
      'id', 'title', 'description', 'notes', 'link',
      'event_date', 'created_at', 'updated_at', 'metadata',
      'chunk', 'embedding', 'embedding_updated_at', 'embedding_text',
      'chunk_status',
    ];
    for (const col of required) {
      assert.ok(cols.includes(col), `nodes must have column: ${col}`);
    }
  });

  it('edges table has all baseline columns', () => {
    const cols = columnNames(ctx.db, 'edges');
    const required = ['id', 'from_node_id', 'to_node_id', 'source', 'created_at', 'context'];
    for (const col of required) {
      assert.ok(cols.includes(col), `edges must have column: ${col}`);
    }
  });

  it('node_dimensions table has node_id and dimension columns', () => {
    const cols = columnNames(ctx.db, 'node_dimensions');
    assert.ok(cols.includes('node_id'), 'node_dimensions must have node_id');
    assert.ok(cols.includes('dimension'), 'node_dimensions must have dimension');
  });

  it('dimensions table has name, description, icon, is_priority, updated_at columns', () => {
    const cols = columnNames(ctx.db, 'dimensions');
    for (const col of ['name', 'description', 'icon', 'is_priority', 'updated_at']) {
      assert.ok(cols.includes(col), `dimensions must have column: ${col}`);
    }
  });

  it('nodes.chunk_status has default "not_chunked"', () => {
    const col = columnInfo(ctx.db, 'nodes', 'chunk_status');
    assert.ok(col, 'chunk_status column must exist');
    assert.strictEqual(col.dflt_value, "'not_chunked'");
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Migration 002: Node lifecycle fields
// ---------------------------------------------------------------------------

describe('Migration 002 — node lifecycle fields', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('nodes has status column', () => {
    assert.ok(columnNames(ctx.db, 'nodes').includes('status'), 'nodes must have status');
  });

  it('nodes has confidence column', () => {
    assert.ok(columnNames(ctx.db, 'nodes').includes('confidence'), 'nodes must have confidence');
  });

  it('nodes has created_via column', () => {
    assert.ok(columnNames(ctx.db, 'nodes').includes('created_via'), 'nodes must have created_via');
  });

  it('nodes.status default is "active"', () => {
    const col = columnInfo(ctx.db, 'nodes', 'status');
    assert.strictEqual(col.dflt_value, "'active'", 'status default must be active');
  });

  it('nodes.confidence default is "medium"', () => {
    const col = columnInfo(ctx.db, 'nodes', 'confidence');
    assert.strictEqual(col.dflt_value, "'medium'", 'confidence default must be medium');
  });

  it('nodes.created_via default is "llm_auto"', () => {
    const col = columnInfo(ctx.db, 'nodes', 'created_via');
    assert.strictEqual(col.dflt_value, "'llm_auto'", 'created_via default must be llm_auto');
  });

  it('index idx_nodes_status exists on nodes(status)', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_status'), 'idx_nodes_status must exist');
  });

  it('index idx_nodes_confidence exists on nodes(confidence)', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_confidence'), 'idx_nodes_confidence must exist');
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Migration 003: Node history table
// ---------------------------------------------------------------------------

describe('Migration 003 — node_history table', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('node_history table exists', () => {
    assert.ok(tableExists(ctx.db, 'node_history'), 'node_history table must exist');
  });

  it('node_history has all required columns', () => {
    const cols = columnNames(ctx.db, 'node_history');
    const required = [
      'id', 'node_id', 'changed_at', 'changed_by',
      'field_name', 'old_value', 'new_value', 'session_id',
    ];
    for (const col of required) {
      assert.ok(cols.includes(col), `node_history must have column: ${col}`);
    }
  });

  it('node_history has no unexpected extra required columns (column count check)', () => {
    const cols = columnNames(ctx.db, 'node_history');
    // Must include at minimum 8 defined columns
    assert.ok(cols.length >= 8, `node_history must have at least 8 columns, got ${cols.length}`);
  });

  it('node_history.changed_at has DEFAULT CURRENT_TIMESTAMP', () => {
    const col = columnInfo(ctx.db, 'node_history', 'changed_at');
    assert.ok(col, 'changed_at column must exist');
    assert.strictEqual(col.dflt_value, 'CURRENT_TIMESTAMP');
  });

  it('node_history.changed_by has DEFAULT "llm_auto"', () => {
    const col = columnInfo(ctx.db, 'node_history', 'changed_by');
    assert.ok(col, 'changed_by column must exist');
    assert.strictEqual(col.dflt_value, "'llm_auto'");
  });

  it('node_history.old_value is nullable', () => {
    const col = columnInfo(ctx.db, 'node_history', 'old_value');
    assert.ok(col, 'old_value column must exist');
    assert.strictEqual(col.notnull, 0, 'old_value must be nullable');
  });

  it('node_history.new_value is nullable', () => {
    const col = columnInfo(ctx.db, 'node_history', 'new_value');
    assert.ok(col, 'new_value column must exist');
    assert.strictEqual(col.notnull, 0, 'new_value must be nullable');
  });

  it('node_history.session_id is nullable', () => {
    const col = columnInfo(ctx.db, 'node_history', 'session_id');
    assert.ok(col, 'session_id column must exist');
    assert.strictEqual(col.notnull, 0, 'session_id must be nullable');
  });

  it('index idx_history_node_id exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_history_node_id'), 'idx_history_node_id must exist');
  });

  it('index idx_history_session_id exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_history_session_id'), 'idx_history_session_id must exist');
  });

  it('index idx_history_changed_at exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_history_changed_at'), 'idx_history_changed_at must exist');
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Migration 004: Importance score and session_id on nodes/edges
// ---------------------------------------------------------------------------

describe('Migration 004 — importance_score and session_id', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('nodes has importance_score column', () => {
    assert.ok(
      columnNames(ctx.db, 'nodes').includes('importance_score'),
      'nodes must have importance_score'
    );
  });

  it('nodes.importance_score is REAL type', () => {
    const col = columnInfo(ctx.db, 'nodes', 'importance_score');
    assert.ok(col, 'importance_score must exist');
    assert.strictEqual(col.type.toUpperCase(), 'REAL', 'importance_score must be REAL');
  });

  it('nodes.importance_score default is 0.0', () => {
    const col = columnInfo(ctx.db, 'nodes', 'importance_score');
    assert.strictEqual(col.dflt_value, '0.0', 'importance_score default must be 0.0');
  });

  it('nodes has session_id column', () => {
    assert.ok(
      columnNames(ctx.db, 'nodes').includes('session_id'),
      'nodes must have session_id'
    );
  });

  it('nodes.session_id is nullable', () => {
    const col = columnInfo(ctx.db, 'nodes', 'session_id');
    assert.strictEqual(col.notnull, 0, 'nodes.session_id must be nullable');
  });

  it('edges has confidence column', () => {
    assert.ok(
      columnNames(ctx.db, 'edges').includes('confidence'),
      'edges must have confidence'
    );
  });

  it('edges.confidence default is "medium"', () => {
    const col = columnInfo(ctx.db, 'edges', 'confidence');
    assert.strictEqual(col.dflt_value, "'medium'", 'edges.confidence default must be medium');
  });

  it('edges has session_id column', () => {
    assert.ok(
      columnNames(ctx.db, 'edges').includes('session_id'),
      'edges must have session_id'
    );
  });

  it('edges.session_id is nullable', () => {
    const col = columnInfo(ctx.db, 'edges', 'session_id');
    assert.strictEqual(col.notnull, 0, 'edges.session_id must be nullable');
  });

  it('index idx_nodes_importance exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_importance'), 'idx_nodes_importance must exist');
  });

  it('index idx_nodes_session_id exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_session_id'), 'idx_nodes_session_id must exist');
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Migration 005: Sessions and skill_executions tables
// ---------------------------------------------------------------------------

describe('Migration 005 — sessions and skill_executions tables', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('sessions table exists', () => {
    assert.ok(tableExists(ctx.db, 'sessions'), 'sessions table must exist');
  });

  it('sessions has id, started_at, ended_at, summary columns', () => {
    const cols = columnNames(ctx.db, 'sessions');
    for (const col of ['id', 'started_at', 'ended_at', 'summary']) {
      assert.ok(cols.includes(col), `sessions must have column: ${col}`);
    }
  });

  it('sessions.started_at has DEFAULT CURRENT_TIMESTAMP', () => {
    const col = columnInfo(ctx.db, 'sessions', 'started_at');
    assert.ok(col, 'started_at column must exist');
    assert.strictEqual(col.dflt_value, 'CURRENT_TIMESTAMP');
  });

  it('sessions.ended_at is nullable', () => {
    const col = columnInfo(ctx.db, 'sessions', 'ended_at');
    assert.strictEqual(col.notnull, 0, 'sessions.ended_at must be nullable');
  });

  it('skill_executions table exists', () => {
    assert.ok(tableExists(ctx.db, 'skill_executions'), 'skill_executions table must exist');
  });

  it('skill_executions has all required columns', () => {
    const cols = columnNames(ctx.db, 'skill_executions');
    const required = [
      'id', 'skill_name', 'executed_at', 'session_id',
      'nodes_read', 'nodes_written', 'edges_written', 'contract_passed',
    ];
    for (const col of required) {
      assert.ok(cols.includes(col), `skill_executions must have column: ${col}`);
    }
  });

  it('skill_executions.executed_at has DEFAULT CURRENT_TIMESTAMP', () => {
    const col = columnInfo(ctx.db, 'skill_executions', 'executed_at');
    assert.ok(col, 'executed_at column must exist');
    assert.strictEqual(col.dflt_value, 'CURRENT_TIMESTAMP');
  });

  it('index idx_sessions_started exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_sessions_started'), 'idx_sessions_started must exist');
  });

  it('index idx_skill_exec_name exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_skill_exec_name'), 'idx_skill_exec_name must exist');
  });

  it('index idx_skill_exec_session exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_skill_exec_session'), 'idx_skill_exec_session must exist');
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — Default dimensions baseline
// ---------------------------------------------------------------------------

describe('Default dimensions baseline', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  const EXPECTED_DESCRIPTIONS = {
    research: 'Research material, sources, investigation tracks.',
    ideas: 'Concepts, hypotheses, rough insights, possible directions.',
    projects: 'Active work with deliverables and timelines.',
    memory: 'Session memory, summaries, retained working context.',
    preferences: 'Working style, collaboration preferences, user defaults.',
  };

  it('seeds exactly the five original default dimensions with canonical descriptions', () => {
    const rows = ctx.db.prepare(`
      SELECT name, description, is_priority
      FROM dimensions
      ORDER BY name
    `).all();

    assert.deepEqual(rows, [
      { name: 'ideas', description: EXPECTED_DESCRIPTIONS.ideas, is_priority: 1 },
      { name: 'memory', description: EXPECTED_DESCRIPTIONS.memory, is_priority: 1 },
      { name: 'preferences', description: EXPECTED_DESCRIPTIONS.preferences, is_priority: 1 },
      { name: 'projects', description: EXPECTED_DESCRIPTIONS.projects, is_priority: 1 },
      { name: 'research', description: EXPECTED_DESCRIPTIONS.research, is_priority: 1 },
    ]);
  });

  it('does not seed temporary replacement dimensions such as project/tool/reference', () => {
    const count = ctx.db.prepare(`
      SELECT COUNT(*) AS n
      FROM dimensions
      WHERE name IN ('project', 'person', 'decision', 'tool', 'principle', 'goal', 'reference')
    `).get().n;
    assert.strictEqual(count, 0, 'temporary replacement dimensions must not be present in the baseline');
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — Key indexes presence
// ---------------------------------------------------------------------------

describe('Key indexes', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('idx_nodes_status exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_status'));
  });

  it('idx_nodes_importance exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_nodes_importance'));
  });

  it('idx_history_node_id exists (covers node_history(node_id))', () => {
    assert.ok(indexExists(ctx.db, 'idx_history_node_id'));
  });

  it('idx_edges_from exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_edges_from'));
  });

  it('idx_edges_to exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_edges_to'));
  });

  it('idx_dim_by_dimension exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_dim_by_dimension'));
  });

  it('idx_dim_by_node exists', () => {
    assert.ok(indexExists(ctx.db, 'idx_dim_by_node'));
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — Data integrity smoke tests
// ---------------------------------------------------------------------------

describe('Data integrity — write and read-back', () => {
  let ctx;

  beforeAll(() => {
    ctx = makeDb();
  });

  afterAll(() => ctx.close());

  it('can insert and retrieve a node with all migration-added columns', () => {
    ctx.db.prepare(`
      INSERT INTO nodes
        (title, status, confidence, created_via, importance_score, session_id)
      VALUES
        ('Test node', 'active', 'high', 'user', 0.75, 'sess-001')
    `).run();

    const row = ctx.db
      .prepare('SELECT * FROM nodes WHERE title = ?')
      .get('Test node');

    assert.ok(row, 'inserted node must be retrievable');
    assert.strictEqual(row.status, 'active');
    assert.strictEqual(row.confidence, 'high');
    assert.strictEqual(row.created_via, 'user');
    assert.strictEqual(row.importance_score, 0.75);
    assert.strictEqual(row.session_id, 'sess-001');
  });

  it('can insert a node_history row and retrieve it', () => {
    const nodeRow = ctx.db
      .prepare('SELECT id FROM nodes LIMIT 1')
      .get();
    assert.ok(nodeRow, 'a node must exist to attach history to');

    ctx.db.prepare(`
      INSERT INTO node_history (node_id, changed_by, field_name, old_value, new_value, session_id)
      VALUES (?, 'user', 'title', 'Old Title', 'Test node', 'sess-001')
    `).run(nodeRow.id);

    const hist = ctx.db
      .prepare('SELECT * FROM node_history WHERE node_id = ?')
      .get(nodeRow.id);

    assert.ok(hist, 'history row must be retrievable');
    assert.strictEqual(hist.field_name, 'title');
    assert.strictEqual(hist.old_value, 'Old Title');
    assert.strictEqual(hist.new_value, 'Test node');
  });

  it('can insert and retrieve a session row', () => {
    ctx.db.prepare(`
      INSERT INTO sessions (id, summary) VALUES ('sess-001', 'smoke test session')
    `).run();

    const sess = ctx.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get('sess-001');

    assert.ok(sess, 'session must be retrievable');
    assert.strictEqual(sess.summary, 'smoke test session');
    assert.ok(sess.started_at, 'started_at must be auto-populated');
  });

  it('can insert a skill_execution row', () => {
    ctx.db.prepare(`
      INSERT INTO skill_executions (skill_name, session_id, nodes_read, nodes_written, contract_passed)
      VALUES ('readKnowledge', 'sess-001', '[1]', '[2,3]', 1)
    `).run();

    const exec = ctx.db
      .prepare('SELECT * FROM skill_executions WHERE skill_name = ?')
      .get('readKnowledge');

    assert.ok(exec, 'skill_execution must be retrievable');
    assert.strictEqual(exec.contract_passed, 1);
    assert.strictEqual(exec.nodes_read, '[1]');
  });

  it('deleting a node cascades to node_history', () => {
    // Insert a fresh node and attach history
    const { lastInsertRowid } = ctx.db.prepare(`
      INSERT INTO nodes (title, status, confidence, created_via)
      VALUES ('Temp node', 'draft', 'low', 'llm_auto')
    `).run();

    ctx.db.prepare(`
      INSERT INTO node_history (node_id, changed_by, field_name, old_value, new_value)
      VALUES (?, 'llm_auto', 'status', NULL, 'draft')
    `).run(lastInsertRowid);

    // Confirm history exists
    const before = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM node_history WHERE node_id = ?')
      .get(lastInsertRowid).n;
    assert.strictEqual(before, 1, 'history row must exist before delete');

    // Delete the node
    ctx.db.prepare('DELETE FROM nodes WHERE id = ?').run(lastInsertRowid);

    // History must have been cascade-deleted
    const after = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM node_history WHERE node_id = ?')
      .get(lastInsertRowid).n;
    assert.strictEqual(after, 0, 'history rows must be cascade-deleted with node');
  });
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

run('Ra-h — Migrations').then(process.exit);
