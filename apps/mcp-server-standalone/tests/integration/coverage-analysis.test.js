'use strict';

/**
 * Integration: Coverage Analysis
 *
 * Tests that the coverage-gap concept works correctly:
 *   - Session summary nodes can be created and queried
 *   - importanceService.getOrphanNodes correctly identifies unconnected nodes
 *   - computeImportanceScores ranks well-connected nodes higher
 *   - getContext hub-node ordering reflects computed importance
 *   - getNodes search retrieves session summary nodes by title keyword
 */

const path = require('node:path');

const { describe, it, beforeAll, afterAll, run, assert } = require('../framework');
const { makeDb, nodeFixture }                            = require('../helpers');

// Resolved service paths
const NODE_SERVICE_PATH       = path.resolve(__dirname, '..', '..', 'services', 'nodeService');
const EDGE_SERVICE_PATH       = path.resolve(__dirname, '..', '..', 'services', 'edgeService');
const IMPORTANCE_SERVICE_PATH = path.resolve(__dirname, '..', '..', 'services', 'importanceService');

// ---------------------------------------------------------------------------
// Suite 1 — Session summary node creation and query
// ---------------------------------------------------------------------------
describe('Session summary node — create and query', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let summaryNode;

  beforeAll(() => {
    ctx         = makeDb();
    nodeService = require(NODE_SERVICE_PATH);

    summaryNode = nodeService.createNode({
      title:       'Session Summary — 2026-03-17 coverage analysis session',
      description: 'Coverage analysis integration session. Topics: orphan detection, importance scoring, hub ordering.',
      dimensions:  ['reference'],
      status:      'active',
      confidence:  'high',
      created_via: 'llm_auto',
    });
  });

  afterAll(() => ctx.close());

  // --- Test 1: session summary node can be created -------------------------
  it("createNode with title 'Session Summary — ...' can be created with status active", () => {
    assert.ok(summaryNode, 'createNode must return a node object');
    assert.ok(summaryNode.id > 0, 'returned node must have a positive integer id');
    assert.strictEqual(summaryNode.status, 'active',
      'session summary node must have status=active as specified');
    assert.ok(summaryNode.title.startsWith('Session Summary'),
      'title must be preserved as provided');
  });

  // --- Test 2: correct metadata (status=active, confidence=high) -----------
  it('session summary node has correct metadata (status=active, confidence=high)', () => {
    assert.strictEqual(summaryNode.status,     'active', 'status must be active');
    assert.strictEqual(summaryNode.confidence, 'high',   'confidence must be high');
  });

  // --- Test 7: getNodes search retrieves session summaries -----------------
  it("getNodes with search='Session Summary' retrieves session summaries", () => {
    const results = nodeService.getNodes({ search: 'Session Summary' });

    assert.ok(results.length >= 1,
      "getNodes with search='Session Summary' must return at least one result");

    const found = results.find((n) => n.id === summaryNode.id);
    assert.ok(found,
      'the created session summary node must appear in the search results');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Orphan detection
// ---------------------------------------------------------------------------
describe('importanceService.getOrphanNodes', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let edgeService;
  let importanceService;

  let orphanNode;
  let connectedNodeA;
  let connectedNodeB;

  beforeAll(() => {
    ctx               = makeDb();
    nodeService       = require(NODE_SERVICE_PATH);
    edgeService       = require(EDGE_SERVICE_PATH);
    importanceService = require(IMPORTANCE_SERVICE_PATH);

    orphanNode     = nodeService.createNode(nodeFixture({ title: 'Orphan Node — no edges' }));
    connectedNodeA = nodeService.createNode(nodeFixture({ title: 'Connected Node A' }));
    connectedNodeB = nodeService.createNode(nodeFixture({ title: 'Connected Node B' }));

    // Connect A → B so neither is an orphan
    edgeService.createEdge({
      from_node_id: connectedNodeA.id,
      to_node_id:   connectedNodeB.id,
      explanation:  'A relates to B for orphan-detection test coverage.',
    });
  });

  afterAll(() => ctx.close());

  // --- Test 3: findOrphans returns nodes with zero edges -------------------
  it('findOrphans (importanceService.getOrphanNodes) returns nodes with zero edges', () => {
    const orphans = importanceService.getOrphanNodes(100);
    const orphanIds = orphans.map((n) => n.id);

    assert.ok(orphanIds.includes(orphanNode.id),
      'the orphan node must appear in getOrphanNodes result');
  });

  // --- Test 4: findOrphans excludes connected nodes ------------------------
  it('findOrphans excludes nodes that have at least one edge', () => {
    const orphans = importanceService.getOrphanNodes(100);
    const orphanIds = orphans.map((n) => n.id);

    assert.ok(!orphanIds.includes(connectedNodeA.id),
      'connectedNodeA must NOT appear in orphan list (has an outbound edge)');
    assert.ok(!orphanIds.includes(connectedNodeB.id),
      'connectedNodeB must NOT appear in orphan list (has an inbound edge)');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Importance scoring and hub ordering
// ---------------------------------------------------------------------------
describe('computeImportanceScores and getContext hub ordering', () => {
  /** @type {ReturnType<typeof makeDb>} */
  let ctx;
  let nodeService;
  let edgeService;
  let importanceService;

  // Node IDs for comparison after scoring
  let hubNodeId;    // many in-edges  → should score high
  let leafNodeId;   // zero in-edges  → should score low

  beforeAll(() => {
    ctx               = makeDb();
    nodeService       = require(NODE_SERVICE_PATH);
    edgeService       = require(EDGE_SERVICE_PATH);
    importanceService = require(IMPORTANCE_SERVICE_PATH);

    // Build a star topology: hub ← leaf1, leaf2, leaf3
    const hub   = nodeService.createNode(nodeFixture({ title: 'Hub Node — many in-edges' }));
    const leaf1 = nodeService.createNode(nodeFixture({ title: 'Leaf 1' }));
    const leaf2 = nodeService.createNode(nodeFixture({ title: 'Leaf 2' }));
    const leaf3 = nodeService.createNode(nodeFixture({ title: 'Leaf 3' }));

    hubNodeId  = hub.id;
    leafNodeId = leaf1.id;

    // Three leaves all point to the hub — hub gets high in-degree
    edgeService.createEdge({ from_node_id: leaf1.id, to_node_id: hub.id,   explanation: 'leaf1 → hub' });
    edgeService.createEdge({ from_node_id: leaf2.id, to_node_id: hub.id,   explanation: 'leaf2 → hub' });
    edgeService.createEdge({ from_node_id: leaf3.id, to_node_id: hub.id,   explanation: 'leaf3 → hub' });
    // leaf1 has no inbound edges
  });

  afterAll(() => ctx.close());

  // --- Test 5: nodes with more in-edges score higher -----------------------
  it('computeImportanceScores across multi-node graph: nodes with more in-edges score higher', () => {
    importanceService.computeImportanceScores();

    const hubNode  = nodeService.getNodeById(hubNodeId);
    const leafNode = nodeService.getNodeById(leafNodeId);

    assert.ok(
      hubNode.importance_score > leafNode.importance_score,
      `hub importance_score (${hubNode.importance_score}) must exceed ` +
      `leaf importance_score (${leafNode.importance_score})`
    );
  });

  // --- Test 6: getContext hub nodes sorted by importance_score DESC --------
  it('after importance recompute, getContext hubNodes are sorted by importance_score DESC', () => {
    importanceService.computeImportanceScores();

    const context = nodeService.getContext();
    const hubNodes = context.hubNodes;

    assert.ok(Array.isArray(hubNodes) && hubNodes.length >= 1,
      'getContext must return a non-empty hubNodes array');

    // Verify descending order
    for (let i = 0; i < hubNodes.length - 1; i++) {
      assert.ok(
        hubNodes[i].importance_score >= hubNodes[i + 1].importance_score,
        `hubNodes[${i}].importance_score (${hubNodes[i].importance_score}) must be >= ` +
        `hubNodes[${i + 1}].importance_score (${hubNodes[i + 1].importance_score})`
      );
    }

    // Hub node must appear at the top
    assert.strictEqual(hubNodes[0].id, hubNodeId,
      'the hub node (highest in-degree) must be the first entry in hubNodes');
  });
});

// ---------------------------------------------------------------------------
run('Ra-h — Integration: Coverage Analysis').then(process.exit);
