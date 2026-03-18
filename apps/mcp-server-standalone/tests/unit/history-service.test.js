'use strict';

const { describe, it, beforeAll, afterAll, assert, run } = require('../framework');
const { makeDb, nodeFixture } = require('../helpers');

// ---------------------------------------------------------------------------
// history-service.test.js
// Unit tests for historyService
// ---------------------------------------------------------------------------

describe('recordChange — basic insert', () => {
  let ctx;
  let historyService;
  let nodeService;
  let node;

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');
    node = nodeService.createNode(nodeFixture({ title: 'History Target' }));
  });

  afterAll(() => ctx.close());

  it('inserts a single row with correct fields', () => {
    historyService.recordChange({
      nodeId:    node.id,
      fieldName: 'title',
      oldValue:  'Old Title',
      newValue:  'New Title',
      changedBy: 'user',
      sessionId: 'sess-abc',
    });

    const rows = ctx.db.prepare(
      'SELECT * FROM node_history WHERE node_id = ? AND field_name = ?'
    ).all(node.id, 'title');

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.node_id,    node.id);
    assert.equal(row.field_name, 'title');
    assert.equal(row.old_value,  'Old Title');
    assert.equal(row.new_value,  'New Title');
    assert.equal(row.changed_by, 'user');
    assert.equal(row.session_id, 'sess-abc');
    assert.ok(row.changed_at, 'changed_at must be set');
  });
});

describe('recordChange — value serialisation', () => {
  let ctx;
  let historyService;
  let nodeService;
  let node;

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');
    node = nodeService.createNode(nodeFixture({ title: 'Serialise Target' }));
  });

  afterAll(() => ctx.close());

  it('serialises non-string values to JSON', () => {
    historyService.recordChange({
      nodeId:    node.id,
      fieldName: 'dimensions',
      oldValue:  ['projects'],
      newValue:  ['projects', 'skill'],
    });

    const row = ctx.db.prepare(
      "SELECT * FROM node_history WHERE node_id = ? AND field_name = 'dimensions'"
    ).get(node.id);

    assert.ok(row, 'row must exist');
    assert.deepEqual(JSON.parse(row.old_value), ['projects']);
    assert.deepEqual(JSON.parse(row.new_value), ['projects', 'skill']);
  });

  it('handles null oldValue gracefully', () => {
    historyService.recordChange({
      nodeId:    node.id,
      fieldName: 'notes',
      oldValue:  null,
      newValue:  'some notes',
    });

    const row = ctx.db.prepare(
      "SELECT * FROM node_history WHERE node_id = ? AND field_name = 'notes'"
    ).get(node.id);

    assert.ok(row, 'row must exist');
    assert.strictEqual(row.old_value, null);
    assert.equal(row.new_value, 'some notes');
  });
});

describe('recordChanges — batch insert', () => {
  let ctx;
  let historyService;
  let nodeService;
  let node;

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');
    node = nodeService.createNode(nodeFixture({ title: 'Batch Target' }));
  });

  afterAll(() => ctx.close());

  it('inserts multiple rows in a single transaction', () => {
    const changes = [
      { fieldName: 'title',       oldValue: 'A', newValue: 'B' },
      { fieldName: 'description', oldValue: 'X', newValue: 'Y' },
      { fieldName: 'status',      oldValue: 'draft', newValue: 'active' },
    ];

    historyService.recordChanges(node.id, changes, 'llm_confirmed', 'sess-batch');

    const rows = ctx.db.prepare(
      'SELECT * FROM node_history WHERE node_id = ? ORDER BY id ASC'
    ).all(node.id);

    assert.equal(rows.length, 3);
    assert.equal(rows[0].field_name, 'title');
    assert.equal(rows[1].field_name, 'description');
    assert.equal(rows[2].field_name, 'status');
    // All rows should share the same session_id
    assert.ok(rows.every((r) => r.session_id === 'sess-batch'));
    // All rows should share the same changed_by
    assert.ok(rows.every((r) => r.changed_by === 'llm_confirmed'));
  });

  it('is a no-op on an empty changes array', () => {
    const before = ctx.db.prepare(
      'SELECT COUNT(*) as cnt FROM node_history WHERE node_id = ?'
    ).get(node.id);

    historyService.recordChanges(node.id, []);

    const after = ctx.db.prepare(
      'SELECT COUNT(*) as cnt FROM node_history WHERE node_id = ?'
    ).get(node.id);

    assert.equal(before.cnt, after.cnt);
  });
});

describe('getHistory', () => {
  let ctx;
  let historyService;
  let nodeService;
  let node;

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');
    node = nodeService.createNode(nodeFixture({ title: 'History Order Target' }));

    // Insert three changes with slight delays so changed_at ordering is stable
    historyService.recordChange({ nodeId: node.id, fieldName: 'f1', oldValue: null, newValue: '1' });
    historyService.recordChange({ nodeId: node.id, fieldName: 'f2', oldValue: null, newValue: '2' });
    historyService.recordChange({ nodeId: node.id, fieldName: 'f3', oldValue: null, newValue: '3' });
  });

  afterAll(() => ctx.close());

  it('returns rows ordered ASC by changed_at (then id)', () => {
    const rows = historyService.getHistory(node.id);
    assert.ok(rows.length >= 3, 'should have at least 3 rows');

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      // Either changed_at is strictly earlier, or equal but id is non-decreasing
      const timePrev = new Date(prev.changed_at).getTime();
      const timeCurr = new Date(curr.changed_at).getTime();
      assert.ok(
        timePrev < timeCurr || (timePrev === timeCurr && prev.id <= curr.id),
        `Row ${i} is not in ASC order: prev.id=${prev.id} curr.id=${curr.id}`
      );
    }
  });

  it('returns an empty array for a node with no history', () => {
    const emptyNode = nodeService.createNode(nodeFixture({ title: 'No History Node' }));
    const rows = historyService.getHistory(emptyNode.id);
    assert.deepEqual(rows, []);
  });
});

describe('getRecentChanges', () => {
  let ctx;
  let historyService;
  let nodeService;

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');

    // Seed 5 nodes each with 4 changes (20 total)
    for (let i = 0; i < 5; i++) {
      const n = nodeService.createNode(nodeFixture({ title: `Recent Node ${i}` }));
      for (let j = 0; j < 4; j++) {
        historyService.recordChange({
          nodeId:    n.id,
          fieldName: `field_${j}`,
          oldValue:  null,
          newValue:  `value_${j}`,
        });
      }
    }
  });

  afterAll(() => ctx.close());

  it('respects the limit parameter', () => {
    const rows = historyService.getRecentChanges(7);
    assert.equal(rows.length, 7);
  });

  it('includes node_title from the nodes JOIN', () => {
    const rows = historyService.getRecentChanges(3);
    for (const row of rows) {
      assert.ok(typeof row.node_title === 'string' && row.node_title.length > 0,
        'node_title must be a non-empty string');
    }
  });
});

describe('getChangesBySession', () => {
  let ctx;
  let historyService;
  let nodeService;
  let node;
  const SESSION_A = 'session-aaa';
  const SESSION_B = 'session-bbb';

  beforeAll(() => {
    ctx = makeDb();
    historyService = require('../../services/historyService');
    nodeService    = require('../../services/nodeService');
    node = nodeService.createNode(nodeFixture({ title: 'Session Filter Node' }));

    historyService.recordChange({ nodeId: node.id, fieldName: 'f1', oldValue: null, newValue: 'v1', sessionId: SESSION_A });
    historyService.recordChange({ nodeId: node.id, fieldName: 'f2', oldValue: null, newValue: 'v2', sessionId: SESSION_B });
    historyService.recordChange({ nodeId: node.id, fieldName: 'f3', oldValue: null, newValue: 'v3', sessionId: SESSION_A });
  });

  afterAll(() => ctx.close());

  it('filters rows by session_id correctly', () => {
    const rowsA = historyService.getChangesBySession(SESSION_A);
    const rowsB = historyService.getChangesBySession(SESSION_B);

    assert.equal(rowsA.length, 2, 'SESSION_A should return 2 rows');
    assert.equal(rowsB.length, 1, 'SESSION_B should return 1 row');

    assert.ok(rowsA.every((r) => r.session_id === SESSION_A),
      'All SESSION_A rows must have correct session_id');
    assert.ok(rowsB.every((r) => r.session_id === SESSION_B),
      'All SESSION_B rows must have correct session_id');
  });
});

run('Ra-h — HistoryService').then(process.exit);
