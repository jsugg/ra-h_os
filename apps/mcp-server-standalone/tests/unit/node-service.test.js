'use strict';

/**
 * Unit tests for services/nodeService.js
 *
 * Each describe block gets its own isolated in-memory SQLite database via
 * makeDb(). The module cache is cleared around every makeDb() call, which
 * ensures nodeService, historyService, and sessionService each receive the
 * fresh sqlite-client singleton for that database.
 *
 * Pattern:
 *   beforeAll  → ctx = makeDb(); nodeService = require(...)
 *   beforeEach → wipe nodes/edges/node_history/node_dimensions rows
 *   afterAll   → ctx.close()
 */

const path = require('node:path');
const { describe, it, beforeAll, afterAll, beforeEach, run, assert } = require('../framework');
const { makeDb, nodeFixture, seedNodes }                              = require('../helpers');

// ---------------------------------------------------------------------------
// Paths are resolved so re-requires after clearModuleCache() still work.
// ---------------------------------------------------------------------------
const NODE_SERVICE_PATH    = path.resolve(__dirname, '../../services/nodeService');
const HISTORY_SERVICE_PATH = path.resolve(__dirname, '../../services/historyService');

// ---------------------------------------------------------------------------
// describe('createNode')
// ---------------------------------------------------------------------------
describe('createNode', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;

  beforeAll(() => {
    ctx         = makeDb();
    nodeService = require(NODE_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('creates node with correct defaults (status=draft, confidence=medium, created_via=llm_auto)', () => {
    const node = nodeService.createNode({ title: 'Defaults Test', description: 'A test node.' });

    assert.strictEqual(node.status,      'draft');
    assert.strictEqual(node.confidence,  'medium');
    assert.strictEqual(node.created_via, 'llm_auto');
  });

  it('session_id is injected automatically (not null, is a string)', () => {
    const node = nodeService.createNode(nodeFixture());

    assert.ok(node.session_id !== null && node.session_id !== undefined,
      'session_id should not be null');
    assert.strictEqual(typeof node.session_id, 'string',
      'session_id should be a string');
    assert.ok(node.session_id.length > 0, 'session_id should be non-empty');
  });

  it('custom status/confidence/created_via are respected', () => {
    const node = nodeService.createNode(nodeFixture({
      status:      'active',
      confidence:  'high',
      created_via: 'user',
    }));

    assert.strictEqual(node.status,      'active');
    assert.strictEqual(node.confidence,  'high');
    assert.strictEqual(node.created_via, 'user');
  });

  it('invalid status falls back to draft', () => {
    const node = nodeService.createNode(nodeFixture({ status: 'NOT_REAL' }));

    assert.strictEqual(node.status, 'draft');
  });

  it('title sanitization strips "Title: " prefix', () => {
    const node = nodeService.createNode({ title: 'Title: My Clean Title', description: 'desc' });

    assert.strictEqual(node.title, 'My Clean Title');
  });

  it('chunk fallback: when no chunk provided, falls back to title+description', () => {
    const title       = 'Fallback Chunk Node';
    const description = 'This description provides the fallback chunk content.';
    const node        = nodeService.createNode({ title, description });

    assert.ok(node.chunk, 'chunk should be set via fallback');
    assert.ok(node.chunk.includes(title),       'chunk should include the title');
    assert.ok(node.chunk.includes(description), 'chunk should include the description');
  });

  it('dimensions are stored correctly', () => {
    const node = nodeService.createNode(nodeFixture({
      dimensions: ['projects', 'decision'],
    }));

    assert.ok(Array.isArray(node.dimensions), 'dimensions should be an array');
    assert.ok(node.dimensions.includes('projects'), 'should contain projects');
    assert.ok(node.dimensions.includes('decision'), 'should contain decision');
    assert.strictEqual(node.dimensions.length, 2);
  });

  it('returns fully populated node object including new fields', () => {
    const node = nodeService.createNode(nodeFixture({
      title:       'Full Node',
      description: 'Full node description for completeness check.',
      notes:       'Some notes.',
      status:      'active',
      confidence:  'high',
      created_via: 'llm_confirmed',
      dimensions:  ['tool'],
    }));

    assert.ok(node.id              !== undefined, 'id must be present');
    assert.ok(node.title           !== undefined, 'title must be present');
    assert.ok(node.description     !== undefined, 'description must be present');
    assert.ok(node.notes           !== undefined, 'notes must be present');
    assert.ok(node.status          !== undefined, 'status must be present');
    assert.ok(node.confidence      !== undefined, 'confidence must be present');
    assert.ok(node.created_via     !== undefined, 'created_via must be present');
    assert.ok(node.session_id      !== undefined, 'session_id must be present');
    assert.ok(node.importance_score !== undefined, 'importance_score must be present');
    assert.ok(node.created_at      !== undefined, 'created_at must be present');
    assert.ok(node.updated_at      !== undefined, 'updated_at must be present');
    assert.ok(Array.isArray(node.dimensions),     'dimensions must be an array');
  });
});

// ---------------------------------------------------------------------------
// describe('updateNode')
// ---------------------------------------------------------------------------
describe('updateNode', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;
  /** @type {typeof import('../../services/historyService')} */
  let historyService;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    historyService = require(HISTORY_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('returns changed_fields array with field/old/new', () => {
    const created = nodeService.createNode(nodeFixture({ title: 'Original Title' }));
    const result  = nodeService.updateNode(created.id, { title: 'Updated Title' });

    assert.ok(Array.isArray(result.changed_fields), 'changed_fields should be an array');
    assert.ok(result.changed_fields.length > 0, 'should have at least one changed field');

    const titleChange = result.changed_fields.find((f) => f.field === 'title');
    assert.ok(titleChange, 'title change should be in changed_fields');
    assert.strictEqual(titleChange.old, 'Original Title');
    assert.strictEqual(titleChange.new, 'Updated Title');
  });

  it('returns conflict_detected=false for minor description edit', () => {
    // Similar words — high Jaccard similarity
    const desc    = 'The quick brown fox jumps over the lazy dog near the river bank';
    const created = nodeService.createNode(nodeFixture({ description: desc }));

    // Minor edit: replace one word. Jaccard similarity will be well above 0.3.
    const minorEdit = 'The quick brown fox jumps over the lazy dog near the river shore';
    const result    = nodeService.updateNode(created.id, { description: minorEdit });

    assert.strictEqual(result.conflict_detected, false);
  });

  it('returns conflict_detected=true for wholesale description replacement (completely different words)', () => {
    const original = 'The quick brown fox jumps over the lazy dog';
    const created  = nodeService.createNode(nodeFixture({ description: original }));

    // Completely different vocabulary — Jaccard similarity will be near 0
    const replacement = 'Quantum computing leverages superposition entanglement algorithms cryptography';
    const result      = nodeService.updateNode(created.id, { description: replacement });

    assert.strictEqual(result.conflict_detected, true);
  });

  it('conflict_detected=true sets node status to uncertain', () => {
    const original = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const created  = nodeService.createNode(nodeFixture({ status: 'active', description: original }));

    const replacement = 'Completely unrelated vocabulary xenon phosphorus ruthenium osmium';
    const result      = nodeService.updateNode(created.id, { description: replacement });

    assert.strictEqual(result.conflict_detected, true);
    assert.strictEqual(result.node.status, 'uncertain');
  });

  it('unchanged fields are NOT included in changed_fields', () => {
    const created = nodeService.createNode(nodeFixture({
      title:       'Stable Title',
      description: 'Stable description that will not change at all.',
    }));

    // Only update notes — title and description should not appear in changed_fields
    const result = nodeService.updateNode(created.id, { notes: 'New note content.' }, { appendNotes: false });

    const fields = result.changed_fields.map((f) => f.field);
    assert.ok(!fields.includes('title'),       'title should not be in changed_fields');
    assert.ok(!fields.includes('description'), 'description should not be in changed_fields');
    assert.ok(fields.includes('notes'),        'notes should be in changed_fields');
  });

  it('appendNotes=true appends to existing notes', () => {
    const created = nodeService.createNode(nodeFixture({ notes: 'First note.' }));

    const result = nodeService.updateNode(
      created.id,
      { notes: 'Second note.' },
      { appendNotes: true }
    );

    assert.ok(result.node.notes.includes('First note.'),  'should retain original note');
    assert.ok(result.node.notes.includes('Second note.'), 'should append new note');
  });

  it('appendNotes=false replaces notes', () => {
    const created = nodeService.createNode(nodeFixture({ notes: 'Old note content.' }));

    const result = nodeService.updateNode(
      created.id,
      { notes: 'Replacement note.' },
      { appendNotes: false }
    );

    assert.strictEqual(result.node.notes, 'Replacement note.');
    assert.ok(!result.node.notes.includes('Old note content.'), 'old note should be gone');
  });

  it('status can be explicitly updated', () => {
    const created = nodeService.createNode(nodeFixture({ status: 'draft' }));
    const result  = nodeService.updateNode(created.id, { status: 'active' });

    assert.strictEqual(result.node.status, 'active');
    const statusChange = result.changed_fields.find((f) => f.field === 'status');
    assert.ok(statusChange, 'status change should be recorded in changed_fields');
    assert.strictEqual(statusChange.old, 'draft');
    assert.strictEqual(statusChange.new, 'active');
  });

  it('throws for non-existent node ID', async () => {
    try {
      nodeService.updateNode(999999, { title: 'Ghost Update' });
      assert.fail('Should have thrown for non-existent node');
    } catch (err) {
      assert.ok(err.message.includes('999999'), 'Error should mention the ID');
    }
  });

  it('dimensions are replaced entirely', () => {
    const created = nodeService.createNode(nodeFixture({ dimensions: ['projects', 'tool'] }));

    const result = nodeService.updateNode(created.id, { dimensions: ['decision'] });

    assert.deepEqual(result.node.dimensions, ['decision'],
      'dimensions should be fully replaced with the new array');
  });

  it('history service records changes when updateNode is called', () => {
    const created = nodeService.createNode(nodeFixture({ title: 'History Check Node' }));
    nodeService.updateNode(created.id, { title: 'History Check Updated' });

    const history = historyService.getHistory(created.id);
    assert.ok(history.length > 0, 'history should have at least one record');

    const titleRecord = history.find((h) => h.field_name === 'title');
    assert.ok(titleRecord, 'history should contain a title change record');
    assert.strictEqual(titleRecord.old_value, 'History Check Node');
    assert.strictEqual(titleRecord.new_value, 'History Check Updated');
  });
});

// ---------------------------------------------------------------------------
// describe('promoteNode')
// ---------------------------------------------------------------------------
describe('promoteNode', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;
  /** @type {typeof import('../../services/historyService')} */
  let historyService;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    historyService = require(HISTORY_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('transitions draft → active correctly', () => {
    const created  = nodeService.createNode(nodeFixture({ status: 'draft' }));
    const promoted = nodeService.promoteNode(created.id, 'active');

    assert.strictEqual(promoted.status, 'active');
    assert.strictEqual(promoted.id,     created.id);
  });

  it('records history entry for status change', () => {
    const created = nodeService.createNode(nodeFixture({ status: 'draft' }));
    nodeService.promoteNode(created.id, 'active', 'user');

    const history = historyService.getHistory(created.id);
    assert.ok(history.length > 0, 'should have history entries');

    const statusRecord = history.find((h) => h.field_name === 'status');
    assert.ok(statusRecord,                          'history should contain a status record');
    assert.strictEqual(statusRecord.old_value, 'draft');
    assert.strictEqual(statusRecord.new_value, 'active');
    assert.strictEqual(statusRecord.changed_by, 'user');
  });

  it('throws for invalid status', () => {
    const created = nodeService.createNode(nodeFixture());

    try {
      nodeService.promoteNode(created.id, 'INVALID_STATUS');
      assert.fail('Should have thrown for invalid status');
    } catch (err) {
      assert.ok(err.message.includes('INVALID_STATUS'),
        'Error should mention the invalid status value');
    }
  });

  it('throws for non-existent node', () => {
    try {
      nodeService.promoteNode(999999, 'active');
      assert.fail('Should have thrown for non-existent node');
    } catch (err) {
      assert.ok(err.message.includes('999999'), 'Error should mention the ID');
    }
  });

  it('noop when promoting to same status — returns existing node without history entry', () => {
    const created  = nodeService.createNode(nodeFixture({ status: 'active' }));
    const result   = nodeService.promoteNode(created.id, 'active');

    // Status unchanged
    assert.strictEqual(result.status, 'active');

    // No history row should have been written for this noop
    const history      = historyService.getHistory(created.id);
    const statusChange = history.find((h) => h.field_name === 'status');
    assert.ok(!statusChange, 'noop promote should not write a history entry');
  });
});

// ---------------------------------------------------------------------------
// describe('getNodes')
// ---------------------------------------------------------------------------
describe('getNodes', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;

  beforeAll(() => {
    ctx         = makeDb();
    nodeService = require(NODE_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('filter by status=draft returns only drafts', () => {
    nodeService.createNode(nodeFixture({ title: 'Draft One',  status: 'draft'  }));
    nodeService.createNode(nodeFixture({ title: 'Draft Two',  status: 'draft'  }));
    nodeService.createNode(nodeFixture({ title: 'Active One', status: 'active' }));

    const results = nodeService.getNodes({ status: 'draft' });

    assert.ok(results.length === 2, `Expected 2 drafts, got ${results.length}`);
    assert.ok(results.every((n) => n.status === 'draft'), 'All results should be draft');
  });

  it('filter by confidence=low returns only low confidence nodes', () => {
    nodeService.createNode(nodeFixture({ title: 'Low One',    confidence: 'low'  }));
    nodeService.createNode(nodeFixture({ title: 'Low Two',    confidence: 'low'  }));
    nodeService.createNode(nodeFixture({ title: 'High One',   confidence: 'high' }));
    nodeService.createNode(nodeFixture({ title: 'Medium One', confidence: 'medium' }));

    const results = nodeService.getNodes({ confidence: 'low' });

    assert.ok(results.length === 2, `Expected 2 low-confidence nodes, got ${results.length}`);
    assert.ok(results.every((n) => n.confidence === 'low'), 'All results should be low confidence');
  });

  it('filter by dimensions returns only matching nodes', () => {
    nodeService.createNode(nodeFixture({ title: 'Tool Node',     dimensions: ['tool']    }));
    nodeService.createNode(nodeFixture({ title: 'Person Node',   dimensions: ['person']  }));
    nodeService.createNode(nodeFixture({ title: 'Project Node',  dimensions: ['projects'] }));

    const results = nodeService.getNodes({ dimensions: ['tool'] });

    assert.ok(results.length >= 1,                          'Should find at least one tool node');
    assert.ok(results.every((n) => n.dimensions.includes('tool')),
      'All results should have the tool dimension');
    assert.ok(!results.some((n) => n.title === 'Person Node'),  'Person Node should not appear');
    assert.ok(!results.some((n) => n.title === 'Project Node'), 'Project Node should not appear');
  });

  it('search by keyword in title', () => {
    nodeService.createNode(nodeFixture({ title: 'Zeppelin Architecture Guide' }));
    nodeService.createNode(nodeFixture({ title: 'Database Migrations Overview' }));
    nodeService.createNode(nodeFixture({ title: 'Zeppelin Performance Tuning' }));

    const results = nodeService.getNodes({ search: 'Zeppelin' });

    assert.ok(results.length === 2, `Expected 2 Zeppelin nodes, got ${results.length}`);
    assert.ok(results.every((n) => n.title.includes('Zeppelin')),
      'All results should have Zeppelin in the title');
  });

  it('limit/offset pagination returns correct slice', () => {
    // Seed 5 nodes
    seedNodes(nodeService, 5);

    const page1 = nodeService.getNodes({ limit: 2, offset: 0 });
    const page2 = nodeService.getNodes({ limit: 2, offset: 2 });

    assert.strictEqual(page1.length, 2, 'Page 1 should have 2 results');
    assert.strictEqual(page2.length, 2, 'Page 2 should have 2 results');

    const page1Ids = page1.map((n) => n.id);
    const page2Ids = page2.map((n) => n.id);

    // No overlap between pages
    const overlap = page1Ids.filter((id) => page2Ids.includes(id));
    assert.strictEqual(overlap.length, 0, 'Pages should not overlap');
  });
});

// ---------------------------------------------------------------------------
// describe('deleteNode')
// ---------------------------------------------------------------------------
describe('deleteNode', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;

  beforeAll(() => {
    ctx         = makeDb();
    nodeService = require(NODE_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('deletes successfully and node is no longer retrievable', () => {
    const created = nodeService.createNode(nodeFixture({ title: 'To Be Deleted' }));
    assert.ok(created.id, 'Node should be created');

    const deleted = nodeService.deleteNode(created.id);
    assert.strictEqual(deleted, true, 'deleteNode should return true');

    const fetched = nodeService.getNodeById(created.id);
    assert.strictEqual(fetched, null, 'Node should not be retrievable after deletion');
  });

  it('throws for non-existent ID', () => {
    try {
      nodeService.deleteNode(999999);
      assert.fail('Should have thrown for non-existent node');
    } catch (err) {
      assert.ok(err.message.includes('999999'), 'Error should mention the ID');
    }
  });
});

// ---------------------------------------------------------------------------
// describe('getContext')
// ---------------------------------------------------------------------------
describe('getContext', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  /** @type {typeof import('../../services/nodeService')} */
  let nodeService;

  beforeAll(() => {
    ctx         = makeDb();
    nodeService = require(NODE_SERVICE_PATH);
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.db.exec('DELETE FROM node_dimensions');
    ctx.db.exec('DELETE FROM node_history');
    ctx.db.exec('DELETE FROM edges');
    ctx.db.exec('DELETE FROM nodes');
  });

  it('returns stats with nodeCount, edgeCount, dimensionCount', () => {
    // Seed 3 nodes
    seedNodes(nodeService, 3);

    const context = nodeService.getContext();

    assert.ok(context.stats !== undefined,                      'stats should be present');
    assert.ok(context.stats.nodeCount !== undefined,            'nodeCount should be present');
    assert.ok(context.stats.edgeCount !== undefined,            'edgeCount should be present');
    assert.ok(context.stats.dimensionCount !== undefined,       'dimensionCount should be present');
    assert.ok(Number(context.stats.nodeCount) >= 3,             'nodeCount should reflect seeded nodes');
    assert.ok(Number(context.stats.dimensionCount) >= 0,        'dimensionCount should be a non-negative number');
  });

  it('returns healthSignals with draftCount and orphanCount', () => {
    nodeService.createNode(nodeFixture({ status: 'draft',    title: 'Draft Node'     }));
    nodeService.createNode(nodeFixture({ status: 'active',   title: 'Active Node'    }));
    nodeService.createNode(nodeFixture({ status: 'uncertain',title: 'Uncertain Node' }));

    const context = nodeService.getContext();

    assert.ok(context.healthSignals                  !== undefined, 'healthSignals should be present');
    assert.ok(context.healthSignals.draftCount       !== undefined, 'draftCount should be present');
    assert.ok(context.healthSignals.orphanCount      !== undefined, 'orphanCount should be present');
    // draft + uncertain = 2
    assert.ok(Number(context.healthSignals.draftCount) >= 2,
      'draftCount should include both draft and uncertain statuses');
    // No edges seeded — all nodes are orphans
    assert.ok(Number(context.healthSignals.orphanCount) >= 3,
      'orphanCount should count nodes with no edges');
  });

  it('hub nodes are ordered by importance_score DESC', () => {
    // Create nodes and manually set importance_score for ordering verification
    const n1 = nodeService.createNode(nodeFixture({ title: 'Low Importance'  }));
    const n2 = nodeService.createNode(nodeFixture({ title: 'High Importance' }));
    const n3 = nodeService.createNode(nodeFixture({ title: 'Mid Importance'  }));

    // Manually assign importance scores so order is deterministic
    ctx.db.prepare('UPDATE nodes SET importance_score = ? WHERE id = ?').run(10.0, n1.id);
    ctx.db.prepare('UPDATE nodes SET importance_score = ? WHERE id = ?').run(90.0, n2.id);
    ctx.db.prepare('UPDATE nodes SET importance_score = ? WHERE id = ?').run(50.0, n3.id);

    const context = nodeService.getContext();

    assert.ok(Array.isArray(context.hubNodes), 'hubNodes should be an array');
    assert.ok(context.hubNodes.length >= 3,    'hubNodes should include our seeded nodes');

    // Verify descending importance_score order
    const scores = context.hubNodes.map((n) => Number(n.importance_score));
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(scores[i] >= scores[i + 1],
        `hubNodes[${i}] score (${scores[i]}) should be >= hubNodes[${i + 1}] score (${scores[i + 1]})`);
    }
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
run('Ra-h — NodeService').then(process.exit);
