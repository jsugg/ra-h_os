'use strict';

/**
 * Integration: Write Path
 *
 * Tests the full LLM write lifecycle across nodeService + historyService +
 * sessionService using a single, shared isolated database.
 *
 * Scenario: create draft → verify history starts empty → update (minor, no
 * conflict) → update (major, conflict) → promote to active → verify final
 * state and full history trail.
 */

const path = require('node:path');

const { describe, it, beforeAll, afterAll, run, assert } = require('../framework');
const { makeDb, nodeFixture }                            = require('../helpers');

// Resolved service paths — safe after clearModuleCache() calls inside makeDb()
const NODE_SERVICE_PATH    = path.resolve(__dirname, '..', '..', 'services', 'nodeService');
const HISTORY_SERVICE_PATH = path.resolve(__dirname, '..', '..', 'services', 'historyService');
const SESSION_SERVICE_PATH = path.resolve(__dirname, '..', '..', 'services', 'sessionService');

// ---------------------------------------------------------------------------
// Suite 1 — Core write-path lifecycle
// ---------------------------------------------------------------------------
describe('LLM write path — create → update → promote', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let historyService;
  let sessionService;

  // Shared node state threaded across tests in the scenario
  let node;
  let descriptionBeforeConflict;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    historyService = require(HISTORY_SERVICE_PATH);
    sessionService = require(SESSION_SERVICE_PATH);

    // Create the initial node used throughout this scenario
    node = nodeService.createNode(nodeFixture({
      title:       'Write Path Integration Node',
      description: 'Initial description for the write path test node.',
      status:      'draft',
      confidence:  'medium',
      created_via: 'llm_auto',
    }));
  });

  afterAll(() => ctx.close());

  // --- Test 1: draft defaults -----------------------------------------------
  it('new node starts in draft status, confidence medium, created_via llm_auto', () => {
    assert.strictEqual(node.status,      'draft',    'status should be draft');
    assert.strictEqual(node.confidence,  'medium',   'confidence should be medium');
    assert.strictEqual(node.created_via, 'llm_auto', 'created_via should be llm_auto');
  });

  // --- Test 2: session_id ---------------------------------------------------
  it('new node has session_id matching getCurrentSessionId()', () => {
    const sessionId = sessionService.getCurrentSessionId();
    assert.strictEqual(node.session_id, sessionId,
      'node.session_id must equal the active session id');
  });

  // --- Test 3: minor update — no conflict -----------------------------------
  it('first update on a node with minor description change: conflict_detected=false', () => {
    const { conflict_detected } = nodeService.updateNode(node.id, {
      description: 'Initial description for the write path test node — with a minor addition.',
    });
    assert.strictEqual(conflict_detected, false,
      'overlapping description change should NOT trigger conflict');

    // Refresh shared node reference
    node = nodeService.getNodeById(node.id);
  });

  // --- Test 4: minor update — status stays draft ----------------------------
  it('minor update: status remains draft, NOT set to uncertain', () => {
    assert.strictEqual(node.status, 'draft',
      'a non-conflicting update must not change the status');
  });

  // --- Test 5: major update — conflict detected -----------------------------
  it('major description replacement (wholly different words): conflict_detected=true', () => {
    // Capture description before conflict update for history assertion later
    descriptionBeforeConflict = node.description;

    const { conflict_detected } = nodeService.updateNode(node.id, {
      description: 'Completely different topic: quantum entanglement patterns in photonic circuits.',
    });
    assert.strictEqual(conflict_detected, true,
      'wholly different description should trigger conflict detection');

    // Refresh shared node reference
    node = nodeService.getNodeById(node.id);
  });

  // --- Test 6: conflict → status uncertain ---------------------------------
  it('conflict update: node status auto-set to uncertain', () => {
    assert.strictEqual(node.status, 'uncertain',
      'nodeService must auto-promote status to uncertain on conflict');
  });

  // --- Test 7: conflict → history has description record -------------------
  it('conflict update: node_history has a record for the description change', () => {
    const history = historyService.getHistory(node.id);
    const descriptionChanges = history.filter((r) => r.field_name === 'description');
    assert.ok(descriptionChanges.length >= 1,
      'at least one description history record must exist after conflict update');
  });

  // --- Test 8: history old_value matches pre-conflict description ----------
  it('conflict update: history old_value matches pre-update description', () => {
    const history = historyService.getHistory(node.id);
    // Find the most recent description change (the conflict one)
    const descChanges = history
      .filter((r) => r.field_name === 'description')
      .sort((a, b) => b.id - a.id);

    assert.ok(descChanges.length >= 1, 'description history row must exist');
    assert.strictEqual(
      descChanges[0].old_value,
      descriptionBeforeConflict,
      'old_value in history must equal the description that existed before the conflict update'
    );
  });

  // --- Test 9: promote uncertain → active ----------------------------------
  it("promoteNode(id, 'active', 'user') transitions uncertain → active", () => {
    const promoted = nodeService.promoteNode(node.id, 'active', 'user');
    assert.strictEqual(promoted.status, 'active',
      'promoteNode must set status to active');

    // Keep reference up to date
    node = promoted;
  });

  // --- Test 10: promotion recorded in history ------------------------------
  it('after promotion: node_history has record of status change from uncertain to active', () => {
    const history = historyService.getHistory(node.id);
    const statusChanges = history.filter(
      (r) => r.field_name === 'status' && r.new_value === 'active' && r.old_value === 'uncertain'
    );
    assert.strictEqual(statusChanges.length, 1,
      'exactly one history row must record the uncertain→active transition');
  });

  // --- Test 11: changed_by = 'user' in promotion record --------------------
  it("after promotion: changed_by = 'user' in history", () => {
    const history = historyService.getHistory(node.id);
    const promotionRecord = history.find(
      (r) => r.field_name === 'status' && r.new_value === 'active'
    );
    assert.ok(promotionRecord, 'promotion history record must exist');
    assert.strictEqual(promotionRecord.changed_by, 'user',
      "changed_by must be 'user' as passed to promoteNode");
  });

  // --- Test 12: full history count -----------------------------------------
  it('full sequence: create → 2 updates → 1 promote → getHistory returns 3 records', () => {
    // History records are field-level changes:
    //   Update 1 (minor): 1 description change = 1 row
    //   Update 2 (conflict): 1 description change (+ status auto-set, but that happens
    //     inside the UPDATE, not via recordChanges directly — only description in changes[])
    //     = 1 row
    //   Promote: 1 status change = 1 row
    // Total: 3 rows
    const history = historyService.getHistory(node.id);
    assert.strictEqual(history.length, 3,
      `expected exactly 3 history records; got ${history.length}`);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Multi-node session affinity
// ---------------------------------------------------------------------------
describe('Multiple nodes share session_id', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let sessionService;
  let nodes;

  beforeAll(() => {
    ctx           = makeDb();
    nodeService   = require(NODE_SERVICE_PATH);
    sessionService = require(SESSION_SERVICE_PATH);

    nodes = [
      nodeService.createNode(nodeFixture({ title: 'Session Node A' })),
      nodeService.createNode(nodeFixture({ title: 'Session Node B' })),
      nodeService.createNode(nodeFixture({ title: 'Session Node C' })),
    ];
  });

  afterAll(() => ctx.close());

  it('multiple nodes created in same session share identical session_id', () => {
    const sessionId = sessionService.getCurrentSessionId();

    for (const node of nodes) {
      assert.strictEqual(node.session_id, sessionId,
        `node "${node.title}" must have session_id = ${sessionId}`);
    }

    // Also verify all three are equal to each other
    assert.strictEqual(nodes[0].session_id, nodes[1].session_id);
    assert.strictEqual(nodes[1].session_id, nodes[2].session_id);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Cascade delete
// ---------------------------------------------------------------------------
describe('deleteNode removes all node_history records (CASCADE)', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let historyService;
  let nodeId;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    historyService = require(HISTORY_SERVICE_PATH);

    // Create node and generate some history
    const node = nodeService.createNode(nodeFixture({ title: 'Cascade Delete Test Node' }));
    nodeId = node.id;

    // Two updates to generate history rows
    nodeService.updateNode(nodeId, { description: 'First update — generates a history record.' });
    nodeService.updateNode(nodeId, { description: 'Second update — wholly new content to force another record.' });
  });

  afterAll(() => ctx.close());

  it('deleteNode removes all node_history records (CASCADE)', () => {
    // Confirm history exists before delete
    const historyBefore = historyService.getHistory(nodeId);
    assert.ok(historyBefore.length > 0, 'must have history records before delete');

    // Delete the node
    nodeService.deleteNode(nodeId);

    // History must be gone due to ON DELETE CASCADE
    const historyAfter = ctx.db
      .prepare('SELECT * FROM node_history WHERE node_id = ?')
      .all(nodeId);

    assert.strictEqual(historyAfter.length, 0,
      'all node_history rows must be deleted via CASCADE when the node is removed');
  });
});

// ---------------------------------------------------------------------------
run('Ra-h — Integration: Write Path').then(process.exit);
