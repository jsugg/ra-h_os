'use strict';

/**
 * Unit tests for edgeService
 *
 * Each describe block owns its own isolated in-memory SQLite database via
 * makeDb(). Nodes are created first (required for foreign-key constraints),
 * then edges are created against those node IDs. The database is closed and
 * wiped in afterAll to prevent state leaking between suites.
 *
 * IMPORTANT: createEdge expects from_node_id / to_node_id at the service layer.
 * sourceId / targetId are MCP tool aliases only — do NOT use them here.
 */

const path = require('node:path');

const { describe, it, beforeAll, afterAll, assert, run } = require(
  path.resolve(__dirname, '../framework.js')
);
const { makeDb, nodeFixture } = require(
  path.resolve(__dirname, '../helpers.js')
);

// ── Shared node factory ───────────────────────────────────────────────────────

function makeNodes(nodeService, count = 2) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push(nodeService.createNode(nodeFixture({
      title: `Edge Test Node ${i + 1}`,
      description: `Fixture node ${i + 1} created for edge-service unit tests.`,
      status: 'active',
      confidence: 'high',
    })));
  }
  return nodes;
}

// ── Suite 1 — createEdge ─────────────────────────────────────────────────────

describe('createEdge', () => {
  let close;
  let edgeService;
  let nodeA;
  let nodeB;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
    [nodeA, nodeB] = makeNodes(nodeService, 2);
  });

  afterAll(() => close());

  it('creates an edge and returns the persisted object', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Node A depends on Node B for data.',
    });

    assert.ok(edge, 'Expected edge to be returned');
    assert.ok(typeof edge.id === 'number', `Expected numeric id, got ${typeof edge.id}`);
  });

  it('injects a non-null string session_id', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Session provenance test edge.',
    });

    assert.ok(edge.session_id, 'Expected session_id to be truthy');
    assert.strictEqual(typeof edge.session_id, 'string', 'Expected session_id to be a string');
    assert.ok(edge.session_id.trim().length > 0, 'Expected session_id to be non-empty');
  });

  it('stores confidence on the context JSON object', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'High-confidence relationship established by design review.',
      confidence: 'high',
    });

    assert.ok(edge.context, 'Expected context to be present');
    assert.strictEqual(
      edge.context.confidence,
      'high',
      `Expected context.confidence "high", got "${edge.context.confidence}"`
    );
  });

  it('stores medium confidence by default on the context JSON', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Default confidence test.',
    });

    assert.strictEqual(
      edge.context.confidence,
      'medium',
      `Expected default context.confidence "medium", got "${edge.context.confidence}"`
    );
  });

  it('throws when explanation is missing', () => {
    assert.throws(
      () => edgeService.createEdge({ from_node_id: nodeA.id, to_node_id: nodeB.id }),
      /explanation/i,
      'Expected error about missing explanation'
    );
  });

  it('throws when explanation is an empty string', () => {
    assert.throws(
      () => edgeService.createEdge({
        from_node_id: nodeA.id,
        to_node_id: nodeB.id,
        explanation: '   ',
      }),
      /explanation/i,
      'Expected error for whitespace-only explanation'
    );
  });

  it('throws when from_node_id is missing', () => {
    assert.throws(
      () => edgeService.createEdge({
        to_node_id: nodeB.id,
        explanation: 'Missing from_node_id test.',
      }),
      /from_node_id/i,
      'Expected error about missing from_node_id'
    );
  });

  it('throws when to_node_id is missing', () => {
    assert.throws(
      () => edgeService.createEdge({
        from_node_id: nodeA.id,
        explanation: 'Missing to_node_id test.',
      }),
      /to_node_id/i,
      'Expected error about missing to_node_id'
    );
  });

  it('context.explanation matches the provided explanation text', () => {
    const explanationText = 'Validates that the explanation flows through to the persisted context.';
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: explanationText,
    });

    assert.ok(edge.context, 'Expected context to be present');
    assert.strictEqual(
      edge.context.explanation,
      explanationText,
      `context.explanation mismatch: got "${edge.context.explanation}"`
    );
  });

  it('persists from_node_id and to_node_id correctly', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Verifying node IDs are stored correctly.',
    });

    assert.strictEqual(edge.from_node_id, nodeA.id);
    assert.strictEqual(edge.to_node_id, nodeB.id);
  });
});

// ── Suite 2 — getEdgeById ─────────────────────────────────────────────────────

describe('getEdgeById', () => {
  let close;
  let edgeService;
  let createdEdge;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));

    const [nodeA, nodeB] = makeNodes(nodeService, 2);
    createdEdge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Test edge for getEdgeById retrieval.',
    });
  });

  afterAll(() => close());

  it('returns the edge when queried by its ID', () => {
    const found = edgeService.getEdgeById(createdEdge.id);
    assert.ok(found, 'Expected edge to be found');
    assert.strictEqual(found.id, createdEdge.id);
  });

  it('returns null for a non-existent ID', () => {
    const notFound = edgeService.getEdgeById(999999);
    assert.strictEqual(notFound, null, 'Expected null for missing edge ID');
  });

  it('deserializes context as an object (not a raw string)', () => {
    const found = edgeService.getEdgeById(createdEdge.id);
    assert.ok(found.context && typeof found.context === 'object', 'Expected context to be a parsed object');
  });
});

// ── Suite 3 — getEdges ────────────────────────────────────────────────────────

describe('getEdges', () => {
  let close;
  let edgeService;
  let nodeA;
  let nodeB;
  let nodeC;
  let edgeAB;
  let edgeBC;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));

    [nodeA, nodeB, nodeC] = makeNodes(nodeService, 3);

    edgeAB = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'A to B relationship for filter test.',
    });
    edgeBC = edgeService.createEdge({
      from_node_id: nodeB.id,
      to_node_id: nodeC.id,
      explanation: 'B to C relationship for filter test.',
    });
    // Third edge not connected to nodeA
    edgeService.createEdge({
      from_node_id: nodeB.id,
      to_node_id: nodeC.id,
      explanation: 'Unrelated edge for limit test.',
    });
  });

  afterAll(() => close());

  it('returns all edges when no filter is applied', () => {
    const edges = edgeService.getEdges();
    assert.ok(Array.isArray(edges), 'Expected array');
    assert.ok(edges.length >= 3, `Expected at least 3 edges, got ${edges.length}`);
  });

  it('returns only edges connected to the given nodeId', () => {
    const edges = edgeService.getEdges({ nodeId: nodeA.id });
    assert.ok(Array.isArray(edges), 'Expected array');

    // All returned edges must reference nodeA
    for (const edge of edges) {
      const connected = edge.from_node_id === nodeA.id || edge.to_node_id === nodeA.id;
      assert.ok(connected, `Edge ${edge.id} is not connected to nodeA (${nodeA.id})`);
    }

    // The A→B edge must be in the result
    const edgeIds = edges.map((e) => e.id);
    assert.ok(edgeIds.includes(edgeAB.id), 'Expected edgeAB to be in nodeA results');
  });

  it('respects the limit parameter', () => {
    const edges = edgeService.getEdges({ limit: 1 });
    assert.ok(Array.isArray(edges), 'Expected array');
    assert.strictEqual(edges.length, 1, `Expected exactly 1 edge with limit=1, got ${edges.length}`);
  });

  it('returns an empty array when no edges match the nodeId filter', () => {
    // Create a completely isolated node (no edges)
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    const isolatedNode = nodeService.createNode(nodeFixture({ title: 'Isolated', status: 'active', confidence: 'high' }));

    const edges = edgeService.getEdges({ nodeId: isolatedNode.id });
    assert.strictEqual(edges.length, 0, 'Expected no edges for isolated node');
  });
});

// ── Suite 4 — updateEdge ──────────────────────────────────────────────────────

describe('updateEdge', () => {
  let close;
  let edgeService;
  let createdEdge;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));

    const [nodeA, nodeB] = makeNodes(nodeService, 2);
    createdEdge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Original explanation before update.',
    });
  });

  afterAll(() => close());

  it('updates the explanation in the context', () => {
    const newExplanation = 'Updated explanation reflecting new understanding.';
    const updated = edgeService.updateEdge(createdEdge.id, { explanation: newExplanation });

    assert.ok(updated, 'Expected updated edge to be returned');
    assert.ok(updated.context, 'Expected context to be present');
    assert.strictEqual(
      updated.context.explanation,
      newExplanation,
      `context.explanation mismatch after update: got "${updated.context.explanation}"`
    );
  });

  it('throws for a non-existent edge ID', () => {
    assert.throws(
      () => edgeService.updateEdge(999999, { explanation: 'Should not reach here.' }),
      /not found/i,
      'Expected "not found" error for missing edge'
    );
  });

  it('persists the explanation change across a fresh getEdgeById call', () => {
    const finalExplanation = 'Final explanation after persistence verification.';
    edgeService.updateEdge(createdEdge.id, { explanation: finalExplanation });

    const refetched = edgeService.getEdgeById(createdEdge.id);
    assert.strictEqual(
      refetched.context.explanation,
      finalExplanation,
      'Explanation not persisted after update'
    );
  });
});

// ── Suite 5 — deleteEdge ──────────────────────────────────────────────────────

describe('deleteEdge', () => {
  let close;
  let edgeService;
  let nodeA;
  let nodeB;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
    [nodeA, nodeB] = makeNodes(nodeService, 2);
  });

  afterAll(() => close());

  it('removes the edge successfully and returns true', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Edge to be deleted in deletion test.',
    });

    const result = edgeService.deleteEdge(edge.id);
    assert.strictEqual(result, true, 'Expected deleteEdge to return true');
  });

  it('edge is no longer retrievable after deletion', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Edge to verify absence after deletion.',
    });
    const edgeId = edge.id;

    edgeService.deleteEdge(edgeId);

    const gone = edgeService.getEdgeById(edgeId);
    assert.strictEqual(gone, null, 'Expected null for deleted edge');
  });

  it('throws for a non-existent edge ID', () => {
    assert.throws(
      () => edgeService.deleteEdge(999999),
      /not found/i,
      'Expected "not found" error when deleting missing edge'
    );
  });
});

// ── Suite 6 — getNodeConnections ──────────────────────────────────────────────

describe('getNodeConnections', () => {
  let close;
  let edgeService;
  let nodeA;
  let nodeB;
  let nodeC;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));

    [nodeA, nodeB, nodeC] = makeNodes(nodeService, 3);

    // A → B  (nodeA is the source)
    edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Outbound edge from A to B.',
    });

    // C → A  (nodeA is the target)
    edgeService.createEdge({
      from_node_id: nodeC.id,
      to_node_id: nodeA.id,
      explanation: 'Inbound edge from C to A.',
    });
  });

  afterAll(() => close());

  it('returns enriched connected_node info for each connection', () => {
    const connections = edgeService.getNodeConnections(nodeA.id);
    assert.ok(Array.isArray(connections), 'Expected array of connections');
    assert.ok(connections.length > 0, 'Expected at least one connection');

    for (const conn of connections) {
      assert.ok(conn.connected_node, 'Expected connected_node to be present');
      assert.ok(conn.connected_node.id, 'Expected connected_node.id');
      assert.ok(typeof conn.connected_node.title === 'string', 'Expected connected_node.title to be a string');
    }
  });

  it('returns both outbound (from) and inbound (to) edges for nodeA', () => {
    const connections = edgeService.getNodeConnections(nodeA.id);

    const fromAIds = connections
      .filter((c) => c.from_node_id === nodeA.id)
      .map((c) => c.connected_node.id);

    const toAIds = connections
      .filter((c) => c.to_node_id === nodeA.id)
      .map((c) => c.connected_node.id);

    assert.ok(fromAIds.includes(nodeB.id), 'Expected outbound edge from A to B in connections');
    assert.ok(toAIds.includes(nodeC.id), 'Expected inbound edge from C to A in connections');
  });

  it('returns exactly 2 connections for nodeA (one outbound, one inbound)', () => {
    const connections = edgeService.getNodeConnections(nodeA.id);
    assert.strictEqual(connections.length, 2, `Expected 2 connections for nodeA, got ${connections.length}`);
  });

  it('returns an empty array for a node with no edges', () => {
    // Create a fresh isolated node
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    const isolated = nodeService.createNode(nodeFixture({ title: 'Isolated for connections test', status: 'active', confidence: 'high' }));
    const connections = edgeService.getNodeConnections(isolated.id);
    assert.strictEqual(connections.length, 0, 'Expected 0 connections for isolated node');
  });

  it('each connection entry has edgeId, from_node_id, to_node_id, and context fields', () => {
    const connections = edgeService.getNodeConnections(nodeA.id);
    for (const conn of connections) {
      assert.ok(typeof conn.edgeId === 'number', `Missing or invalid edgeId on connection`);
      assert.ok(typeof conn.from_node_id === 'number', `Missing or invalid from_node_id`);
      assert.ok(typeof conn.to_node_id === 'number', `Missing or invalid to_node_id`);
      assert.ok(conn.context && typeof conn.context === 'object', `Expected context to be a parsed object`);
    }
  });
});

// ── Suite 7 — getEdgeCount ────────────────────────────────────────────────────

describe('getEdgeCount', () => {
  let close;
  let edgeService;
  let nodeA;
  let nodeB;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
    [nodeA, nodeB] = makeNodes(nodeService, 2);
  });

  afterAll(() => close());

  it('returns 0 when no edges exist', () => {
    const count = edgeService.getEdgeCount();
    assert.strictEqual(count, 0, `Expected 0, got ${count}`);
  });

  it('returns 1 after creating one edge', () => {
    edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'First edge for count test.',
    });
    const count = edgeService.getEdgeCount();
    assert.strictEqual(count, 1, `Expected 1, got ${count}`);
  });

  it('returns the correct total count after multiple edges', () => {
    edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Second edge for count test.',
    });
    edgeService.createEdge({
      from_node_id: nodeB.id,
      to_node_id: nodeA.id,
      explanation: 'Third edge for count test.',
    });
    const count = edgeService.getEdgeCount();
    assert.strictEqual(count, 3, `Expected 3, got ${count}`);
  });

  it('decrements correctly after a deletion', () => {
    const edge = edgeService.createEdge({
      from_node_id: nodeA.id,
      to_node_id: nodeB.id,
      explanation: 'Edge to be deleted in count decrement test.',
    });
    const beforeDelete = edgeService.getEdgeCount();

    edgeService.deleteEdge(edge.id);

    const afterDelete = edgeService.getEdgeCount();
    assert.strictEqual(afterDelete, beforeDelete - 1, `Expected count to decrease by 1`);
  });

  it('returns a number (not string or null)', () => {
    const count = edgeService.getEdgeCount();
    assert.strictEqual(typeof count, 'number', `Expected number, got ${typeof count}`);
    assert.ok(!Number.isNaN(count), 'Expected non-NaN count');
  });
});

run('Ra-h — EdgeService').then(process.exit);
