'use strict';

/**
 * Integration: Session Lifecycle
 *
 * Tests the full session lifecycle integrated across nodes, edges, and the
 * sessions table. Each suite uses its own isolated in-memory database so
 * session state never leaks between test groups.
 */

const path = require('node:path');

const { describe, it, beforeAll, afterAll, run, assert } = require('../framework');
const { makeDb, nodeFixture }                            = require('../helpers');

// Resolved service paths
const NODE_SERVICE_PATH    = path.resolve(__dirname, '..', '..', 'services', 'nodeService');
const EDGE_SERVICE_PATH    = path.resolve(__dirname, '..', '..', 'services', 'edgeService');
const HISTORY_SERVICE_PATH = path.resolve(__dirname, '..', '..', 'services', 'historyService');
const SESSION_SERVICE_PATH = path.resolve(__dirname, '..', '..', 'services', 'sessionService');

// ---------------------------------------------------------------------------
// Suite 1 — Session record creation and node/edge provenance
// ---------------------------------------------------------------------------
describe('Session record, node provenance, edge provenance', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let edgeService;
  let sessionService;

  let sessionId;
  let nodeA;
  let nodeB;
  let edge;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    edgeService    = require(EDGE_SERVICE_PATH);
    sessionService = require(SESSION_SERVICE_PATH);

    // Trigger session init
    sessionId = sessionService.getCurrentSessionId();

    nodeA = nodeService.createNode(nodeFixture({ title: 'Session Lifecycle Node A' }));
    nodeB = nodeService.createNode(nodeFixture({ title: 'Session Lifecycle Node B' }));
    edge  = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id:   nodeB.id,
      explanation:  'A is related to B for session lifecycle testing purposes.',
    });
  });

  afterAll(() => ctx.close());

  // --- Test 1: session record exists in sessions table ---------------------
  it('session record exists in sessions table after server init', () => {
    const row = ctx.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId);

    assert.ok(row, 'a sessions row must exist for the current session id');
    assert.strictEqual(row.id, sessionId);
    assert.ok(row.started_at, 'started_at must be populated');
  });

  // --- Test 2: nodes share session_id --------------------------------------
  it('all nodes created within the same process share the session_id from getCurrentSessionId()', () => {
    assert.strictEqual(nodeA.session_id, sessionId,
      'nodeA.session_id must equal the active session id');
    assert.strictEqual(nodeB.session_id, sessionId,
      'nodeB.session_id must equal the active session id');
  });

  // --- Test 3: edges share session_id --------------------------------------
  it('all edges created within the same process share the session_id', () => {
    assert.strictEqual(edge.session_id, sessionId,
      'edge.session_id must equal the active session id');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — endCurrentSession and updateSessionSummary
// ---------------------------------------------------------------------------
describe('endCurrentSession and updateSessionSummary', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let sessionService;

  let sessionId;
  let nodeBeforeEnd;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    sessionService = require(SESSION_SERVICE_PATH);

    sessionId = sessionService.getCurrentSessionId();

    // Create a node before ending the session
    nodeBeforeEnd = nodeService.createNode(nodeFixture({ title: 'Pre-End Node' }));
  });

  afterAll(() => ctx.close());

  // --- Test 4: endCurrentSession sets ended_at -----------------------------
  it('endCurrentSession sets ended_at to a valid ISO timestamp', () => {
    sessionService.endCurrentSession();

    const row = ctx.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId);

    assert.ok(row.ended_at, 'ended_at must be set after endCurrentSession()');

    // Verify it is a parseable ISO-8601 timestamp
    const parsed = new Date(row.ended_at);
    assert.ok(!isNaN(parsed.getTime()),
      `ended_at "${row.ended_at}" must parse as a valid date`);
  });

  // --- Test 5: updateSessionSummary persists the text ----------------------
  it('updateSessionSummary persists the text', () => {
    const summary = 'Session summary: tested lifecycle integration end-to-end.';
    sessionService.updateSessionSummary(sessionId, summary);

    const row = ctx.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId);

    assert.strictEqual(row.summary, summary,
      'summary column must equal the value passed to updateSessionSummary');
  });

  // --- Test 7: nodes created before end still have the session_id ----------
  it('nodes created BEFORE endCurrentSession still have the session_id', () => {
    // Fetch the node fresh from the DB after session end to confirm session_id unchanged
    const refreshed = nodeService.getNodeById(nodeBeforeEnd.id);
    assert.strictEqual(refreshed.session_id, sessionId,
      'pre-existing node session_id must not be altered by endCurrentSession');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — getRecentSessions and getChangesBySession
// ---------------------------------------------------------------------------
describe('getRecentSessions and getChangesBySession', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let sessionService;
  let historyService;

  let sessionId;
  let nodeA;
  let nodeB;

  beforeAll(() => {
    ctx            = makeDb();
    nodeService    = require(NODE_SERVICE_PATH);
    sessionService = require(SESSION_SERVICE_PATH);
    historyService = require(HISTORY_SERVICE_PATH);

    sessionId = sessionService.getCurrentSessionId();

    // Create nodes and generate history so getChangesBySession has rows to return
    nodeA = nodeService.createNode(nodeFixture({ title: 'History Node A' }));
    nodeB = nodeService.createNode(nodeFixture({ title: 'History Node B' }));

    nodeService.updateNode(nodeA.id, {
      description: 'Updated description for Node A — adds history record.',
    });
    nodeService.updateNode(nodeB.id, {
      description: 'Updated description for Node B — adds history record.',
    });
  });

  afterAll(() => ctx.close());

  // --- Test 6: getRecentSessions returns the active session ----------------
  it('getRecentSessions returns the active session', () => {
    const sessions = sessionService.getRecentSessions(10);
    const found = sessions.find((s) => s.id === sessionId);

    assert.ok(found, 'getRecentSessions must include the current session');
    assert.ok(found.started_at, 'active session must have started_at set');
  });

  // --- Test 8: getChangesBySession returns all history records for session --
  it('getChangesBySession returns all history records for the session', () => {
    const changes = historyService.getChangesBySession(sessionId);

    // Two description updates → 2 history rows minimum
    assert.ok(changes.length >= 2,
      `expected at least 2 history records for session; got ${changes.length}`);

    // Every returned row must have the correct session_id
    for (const change of changes) {
      assert.strictEqual(change.session_id, sessionId,
        `history row id=${change.id} must carry session_id=${sessionId}`);
    }

    // Records for both nodes must be present
    const nodeIds = changes.map((c) => c.node_id);
    assert.ok(nodeIds.includes(nodeA.id),
      'history must contain a record for nodeA');
    assert.ok(nodeIds.includes(nodeB.id),
      'history must contain a record for nodeB');
  });
});

// ---------------------------------------------------------------------------
run('Ra-h — Integration: Session Lifecycle').then(process.exit);
