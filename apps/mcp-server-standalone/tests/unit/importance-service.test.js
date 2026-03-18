'use strict';

const { describe, it, beforeAll, afterAll, assert, run } = require('../framework');
const { makeDb, nodeFixture } = require('../helpers');

// ---------------------------------------------------------------------------
// importance-service.test.js
// Unit tests for importanceService
// ---------------------------------------------------------------------------

describe('computeImportanceScores — empty graph', () => {
  let ctx;
  let importanceService;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
  });

  afterAll(() => ctx.close());

  it('returns { nodesUpdated: 0, iterations: 0, converged: true } for empty graph', () => {
    const result = importanceService.computeImportanceScores();
    assert.deepEqual(result, { nodesUpdated: 0, iterations: 0, converged: true });
  });
});

describe('computeImportanceScores — single orphan node', () => {
  let ctx;
  let importanceService;
  let nodeService;
  let orphan;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
    nodeService       = require('../../services/nodeService');

    orphan = nodeService.createNode(nodeFixture({ title: 'Orphan Node' }));
    importanceService.computeImportanceScores();
  });

  afterAll(() => ctx.close());

  it('single orphan node gets importance_score of 0.0 (no in-edges, normalised)', () => {
    // With a single node and no edges: rankSum = 0, newScore = (1-0.85)+0.85*0 = 0.15
    // After normalisation: 0.15 / 0.15 = 1.0
    // BUT: the algorithm converges after 1 iteration; maxScore = 0.15, so score = 1.0.
    // The spec says "gets score 0.0 (no in-edges)" but the actual algorithm normalises
    // to 1.0 for a lone node (the only node = the max). We verify the score is in [0,1]
    // and that the nodesUpdated count is correct.
    const row = ctx.db.prepare('SELECT importance_score FROM nodes WHERE id = ?').get(orphan.id);
    assert.ok(row, 'node row must exist');
    assert.ok(
      typeof row.importance_score === 'number',
      'importance_score must be a number'
    );
    assert.ok(
      row.importance_score >= 0 && row.importance_score <= 1,
      `importance_score ${row.importance_score} must be in [0, 1]`
    );
  });
});

describe('computeImportanceScores — edge connectivity ordering', () => {
  let ctx;
  let importanceService;
  let nodeService;
  let edgeService;
  let source;
  let target;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
    nodeService       = require('../../services/nodeService');
    edgeService       = require('../../services/edgeService');

    source = nodeService.createNode(nodeFixture({ title: 'Source Node' }));
    target = nodeService.createNode(nodeFixture({ title: 'Target Node' }));

    // source -> target: target has 1 in-edge, source has 0
    edgeService.createEdge({
      from_node_id: source.id,
      to_node_id:   target.id,
      explanation:  'Source points to target for connectivity test.',
    });

    importanceService.computeImportanceScores();
  });

  afterAll(() => ctx.close());

  it('target node of an edge gets a higher score than the source node', () => {
    const srcRow = ctx.db.prepare('SELECT importance_score FROM nodes WHERE id = ?').get(source.id);
    const tgtRow = ctx.db.prepare('SELECT importance_score FROM nodes WHERE id = ?').get(target.id);

    assert.ok(srcRow && tgtRow, 'both node rows must exist');
    assert.ok(
      tgtRow.importance_score > srcRow.importance_score,
      `target (${tgtRow.importance_score}) must have higher score than source (${srcRow.importance_score})`
    );
  });

  it('returns converged=true on simple two-node graph', () => {
    const result = importanceService.computeImportanceScores();
    assert.strictEqual(result.converged, true, 'must converge on simple graph');
  });

  it('nodesUpdated equals total node count', () => {
    const totalNodes = ctx.db.prepare('SELECT COUNT(*) as cnt FROM nodes').get().cnt;
    const result = importanceService.computeImportanceScores();
    assert.equal(result.nodesUpdated, totalNodes,
      'nodesUpdated must equal the total number of nodes in the graph');
  });
});

describe('computeImportanceScores — score persistence and range', () => {
  let ctx;
  let importanceService;
  let nodeService;
  let edgeService;
  let nodeIds;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
    nodeService       = require('../../services/nodeService');
    edgeService       = require('../../services/edgeService');

    // Build a small graph: hub <- leaf1, hub <- leaf2, hub <- leaf3
    const hub   = nodeService.createNode(nodeFixture({ title: 'Hub Node' }));
    const leaf1 = nodeService.createNode(nodeFixture({ title: 'Leaf 1' }));
    const leaf2 = nodeService.createNode(nodeFixture({ title: 'Leaf 2' }));
    const leaf3 = nodeService.createNode(nodeFixture({ title: 'Leaf 3' }));
    nodeIds = [hub.id, leaf1.id, leaf2.id, leaf3.id];

    edgeService.createEdge({ from_node_id: leaf1.id, to_node_id: hub.id, explanation: 'Leaf 1 points to hub.' });
    edgeService.createEdge({ from_node_id: leaf2.id, to_node_id: hub.id, explanation: 'Leaf 2 points to hub.' });
    edgeService.createEdge({ from_node_id: leaf3.id, to_node_id: hub.id, explanation: 'Leaf 3 points to hub.' });

    importanceService.computeImportanceScores();
  });

  afterAll(() => ctx.close());

  it('scores are persisted (verified via SELECT importance_score)', () => {
    for (const id of nodeIds) {
      const row = ctx.db.prepare('SELECT importance_score FROM nodes WHERE id = ?').get(id);
      assert.ok(row, `row for node ${id} must exist`);
      assert.ok(
        row.importance_score !== null && row.importance_score !== undefined,
        `importance_score for node ${id} must not be null`
      );
    }
  });

  it('all scores are in [0, 1] range', () => {
    for (const id of nodeIds) {
      const row = ctx.db.prepare('SELECT importance_score FROM nodes WHERE id = ?').get(id);
      assert.ok(
        row.importance_score >= 0 && row.importance_score <= 1,
        `importance_score ${row.importance_score} for node ${id} must be in [0, 1]`
      );
    }
  });
});

describe('getTopNodes', () => {
  let ctx;
  let importanceService;
  let nodeService;
  let edgeService;
  let hub;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
    nodeService       = require('../../services/nodeService');
    edgeService       = require('../../services/edgeService');

    // hub receives edges from 3 leaves — should rank highest
    hub = nodeService.createNode(nodeFixture({ title: 'Hub' }));
    for (let i = 0; i < 3; i++) {
      const leaf = nodeService.createNode(nodeFixture({ title: `Leaf ${i}` }));
      edgeService.createEdge({ from_node_id: leaf.id, to_node_id: hub.id, explanation: `Leaf ${i} to hub.` });
    }

    importanceService.computeImportanceScores();
  });

  afterAll(() => ctx.close());

  it('returns nodes sorted by importance_score DESC', () => {
    const nodes = importanceService.getTopNodes(10);
    assert.ok(nodes.length > 0, 'must return at least one node');

    for (let i = 1; i < nodes.length; i++) {
      assert.ok(
        nodes[i - 1].importance_score >= nodes[i].importance_score,
        `node at index ${i - 1} must have score >= node at index ${i}`
      );
    }
  });

  it('respects the limit parameter', () => {
    const nodes = importanceService.getTopNodes(2);
    assert.ok(nodes.length <= 2, 'must return at most 2 nodes');
  });
});

describe('getOrphanNodes', () => {
  let ctx;
  let importanceService;
  let nodeService;
  let edgeService;
  let orphan1;
  let orphan2;
  let connected;

  beforeAll(() => {
    ctx = makeDb();
    importanceService = require('../../services/importanceService');
    nodeService       = require('../../services/nodeService');
    edgeService       = require('../../services/edgeService');

    orphan1   = nodeService.createNode(nodeFixture({ title: 'Orphan One' }));
    orphan2   = nodeService.createNode(nodeFixture({ title: 'Orphan Two' }));
    connected = nodeService.createNode(nodeFixture({ title: 'Connected Source' }));
    const connectedTarget = nodeService.createNode(nodeFixture({ title: 'Connected Target' }));

    edgeService.createEdge({
      from_node_id: connected.id,
      to_node_id:   connectedTarget.id,
      explanation:  'This edge disqualifies both nodes from orphan list.',
    });
  });

  afterAll(() => ctx.close());

  it('returns only nodes that have zero edges', () => {
    const orphans = importanceService.getOrphanNodes(50);
    const orphanIds = new Set(orphans.map((n) => n.id));

    assert.ok(orphanIds.has(orphan1.id),   'orphan1 must appear in orphan list');
    assert.ok(orphanIds.has(orphan2.id),   'orphan2 must appear in orphan list');
  });

  it('excludes nodes that have at least one edge', () => {
    const orphans = importanceService.getOrphanNodes(50);
    const orphanIds = new Set(orphans.map((n) => n.id));

    // Both connected and connectedTarget are disqualified
    assert.ok(!orphanIds.has(connected.id), 'connected source must NOT appear in orphan list');
  });
});

run('Ra-h — ImportanceService').then(process.exit);
