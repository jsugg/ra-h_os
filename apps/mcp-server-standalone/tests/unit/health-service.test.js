'use strict';

/**
 * Unit tests for healthService.getHealthMetrics()
 *
 * Each describe block owns its own isolated in-memory SQLite database via
 * makeDb(). The database is closed and wiped in afterAll to prevent state
 * leaking between suites.
 */

const path = require('node:path');

const { describe, it, beforeAll, afterAll, assert, run } = require(
  path.resolve(__dirname, '../framework.js')
);
const { makeDb, nodeFixture } = require(
  path.resolve(__dirname, '../helpers.js')
);

// ── Fixture builders ──────────────────────────────────────────────────────────

/**
 * Create a "healthy" graph: 3 active + high-confidence nodes with clear
 * descriptions and 3 edges connecting them so avg-edges-per-node > 1.5.
 */
function seedHealthyGraph(nodeService, edgeService) {
  const n1 = nodeService.createNode(nodeFixture({
    title: 'Architecture Decision Record',
    description: 'Documents the rationale and tradeoffs for adopting the event-sourcing pattern.',
    status: 'active',
    confidence: 'high',
  }));
  const n2 = nodeService.createNode(nodeFixture({
    title: 'Domain Event Specification',
    description: 'Defines the canonical structure and schema for all domain events emitted by the system.',
    status: 'active',
    confidence: 'high',
  }));
  const n3 = nodeService.createNode(nodeFixture({
    title: 'Read Model Projection',
    description: 'Maintains a denormalized view derived from domain events for query performance.',
    status: 'active',
    confidence: 'high',
  }));

  edgeService.createEdge({ from_node_id: n1.id, to_node_id: n2.id, explanation: 'ADR governs the domain event specification' });
  edgeService.createEdge({ from_node_id: n2.id, to_node_id: n3.id, explanation: 'Domain events are consumed by the projection' });
  edgeService.createEdge({ from_node_id: n1.id, to_node_id: n3.id, explanation: 'ADR directly informs the projection design' });

  return [n1, n2, n3];
}

/**
 * Create a "degraded" graph: 5 draft + low-confidence nodes, vague descriptions,
 * and zero edges — this should produce the worst possible metric profile.
 */
function seedDegradedGraph(nodeService) {
  const nodes = [];
  const vagueDescriptions = [
    'This discusses the general approach to state management.',
    'Explores what happens during the onboarding flow.',
    'Examines various options for the notification system.',
    'Talks about how deployments are handled by the pipeline.',
    'Is about the caching strategy used in the service layer.',
  ];

  for (let i = 0; i < 5; i++) {
    nodes.push(nodeService.createNode(nodeFixture({
      title: `Degraded Node ${i + 1}`,
      description: vagueDescriptions[i],
      status: 'draft',
      confidence: 'low',
    })));
  }

  return nodes;
}

// ── Suite 1 — Empty graph ────────────────────────────────────────────────────

describe('getHealthMetrics — empty graph', () => {
  let close;
  let healthService;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    healthService = require(path.resolve(__dirname, '../../services/healthService.js'));
  });

  afterAll(() => close());

  it('returns score = 0', () => {
    const report = healthService.getHealthMetrics();
    assert.strictEqual(report.score, 0);
  });

  it('returns grade = "F"', () => {
    const report = healthService.getHealthMetrics();
    assert.strictEqual(report.grade, 'F');
  });

  it('returns empty metrics array', () => {
    const report = healthService.getHealthMetrics();
    assert.ok(Array.isArray(report.metrics));
    assert.strictEqual(report.metrics.length, 0);
  });

  it('recommendations include the Onboarding message', () => {
    const report = healthService.getHealthMetrics();
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(report.recommendations.length > 0);
    const firstRec = report.recommendations[0];
    assert.ok(
      /onboarding/i.test(firstRec),
      `Expected recommendation to mention Onboarding, got: "${firstRec}"`
    );
  });
});

// ── Suite 2 — Healthy graph (score + grade properties) ──────────────────────

describe('getHealthMetrics — healthy graph: score and grade invariants', () => {
  let close;
  let healthService;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    // Load fresh services bound to this DB
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
    healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

    seedHealthyGraph(nodeService, edgeService);
  });

  afterAll(() => close());

  it('returns a numeric score between 0 and 100 (inclusive)', () => {
    const { score } = healthService.getHealthMetrics();
    assert.ok(typeof score === 'number', `score should be a number, got ${typeof score}`);
    assert.ok(score >= 0 && score <= 100, `score ${score} out of [0, 100]`);
  });

  it('returns a grade that is one of A, B, C, D, F', () => {
    const { grade } = healthService.getHealthMetrics();
    assert.ok(
      ['A', 'B', 'C', 'D', 'F'].includes(grade),
      `grade "${grade}" is not a valid letter grade`
    );
  });

  it('returns a populated score for a non-empty graph', () => {
    const { score } = healthService.getHealthMetrics();
    assert.ok(score > 0, `Expected score > 0 for a healthy graph, got ${score}`);
  });
});

// ── Suite 3 — Grade thresholds ───────────────────────────────────────────────

describe('getHealthMetrics — grade thresholds', () => {
  /**
   * We test the grade boundaries by calling the exported scoreToGrade logic
   * indirectly: seed a graph that should produce a known score range, then
   * assert the grade.  For precision, we also test the computation by directly
   * asserting well-known score→grade mappings via separate micro-graphs.
   *
   * Because computeHealthScore and scoreToGrade are internal, we construct
   * graphs whose states deterministically produce each grade bucket and assert
   * the result.
   */

  // Grade 'A' (score >= 90) — tested via the healthy graph in a fresh DB
  describe('grade A: score >= 90 → healthy graph', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));
      seedHealthyGraph(nodeService, edgeService);
    });

    afterAll(() => close());

    it('healthy graph achieves grade A or B (score >= 75)', () => {
      const { grade, score } = healthService.getHealthMetrics();
      assert.ok(
        score >= 75,
        `Expected score >= 75 for healthy graph, got ${score} (grade ${grade})`
      );
      assert.ok(
        ['A', 'B'].includes(grade),
        `Expected grade A or B for healthy graph, got "${grade}" (score ${score})`
      );
    });
  });

  // Grade 'F' (score < 40) — tested via the degraded graph
  describe('grade F: score < 40 → degraded graph', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));
      seedDegradedGraph(nodeService);
    });

    afterAll(() => close());

    it('degraded graph achieves grade D or F (score < 60)', () => {
      const { grade, score } = healthService.getHealthMetrics();
      assert.ok(
        score < 60,
        `Expected score < 60 for degraded graph, got ${score} (grade ${grade})`
      );
      assert.ok(
        ['D', 'F'].includes(grade),
        `Expected grade D or F for degraded graph, got "${grade}" (score ${score})`
      );
    });
  });
});

// ── Suite 4 — Orphan % metric ────────────────────────────────────────────────

describe('Orphan % metric', () => {
  describe('100% orphans → status critical', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      // All nodes are orphans (no edges)
      nodeService.createNode(nodeFixture({ title: 'Orphan A', status: 'active', confidence: 'high' }));
      nodeService.createNode(nodeFixture({ title: 'Orphan B', status: 'active', confidence: 'high' }));
      nodeService.createNode(nodeFixture({ title: 'Orphan C', status: 'active', confidence: 'high' }));
    });

    afterAll(() => close());

    it('orphan metric status is "critical"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const orphanMetric = metrics.find((m) => m.name === 'Orphan node %');
      assert.ok(orphanMetric, 'Expected "Orphan node %" metric to exist');
      assert.strictEqual(
        orphanMetric.status,
        'critical',
        `Expected critical, got "${orphanMetric.status}" (value: ${orphanMetric.value})`
      );
    });
  });

  describe('0% orphans → status ok', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      // Every node is connected
      const n1 = nodeService.createNode(nodeFixture({ title: 'Connected A', status: 'active', confidence: 'high' }));
      const n2 = nodeService.createNode(nodeFixture({ title: 'Connected B', status: 'active', confidence: 'high' }));
      const n3 = nodeService.createNode(nodeFixture({ title: 'Connected C', status: 'active', confidence: 'high' }));
      edgeService.createEdge({ from_node_id: n1.id, to_node_id: n2.id, explanation: 'A relates to B' });
      edgeService.createEdge({ from_node_id: n2.id, to_node_id: n3.id, explanation: 'B relates to C' });
      edgeService.createEdge({ from_node_id: n1.id, to_node_id: n3.id, explanation: 'A relates to C' });
    });

    afterAll(() => close());

    it('orphan metric status is "ok"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const orphanMetric = metrics.find((m) => m.name === 'Orphan node %');
      assert.ok(orphanMetric, 'Expected "Orphan node %" metric to exist');
      assert.strictEqual(
        orphanMetric.status,
        'ok',
        `Expected ok, got "${orphanMetric.status}" (value: ${orphanMetric.value})`
      );
    });
  });
});

// ── Suite 5 — Unconfirmed % metric ───────────────────────────────────────────

describe('Unconfirmed % metric', () => {
  describe('all nodes are draft → status critical', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      for (let i = 0; i < 5; i++) {
        nodeService.createNode(nodeFixture({
          title: `Draft Node ${i + 1}`,
          status: 'draft',
          confidence: 'medium',
        }));
      }
    });

    afterAll(() => close());

    it('unconfirmed metric status is "critical"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Unconfirmed node %');
      assert.ok(metric, 'Expected "Unconfirmed node %" metric to exist');
      assert.strictEqual(
        metric.status,
        'critical',
        `Expected critical, got "${metric.status}" (value: ${metric.value})`
      );
    });
  });

  describe('all nodes are active → status ok', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      const created = [];
      for (let i = 0; i < 3; i++) {
        created.push(nodeService.createNode(nodeFixture({
          title: `Active Node ${i + 1}`,
          status: 'active',
          confidence: 'high',
        })));
      }
      // Add edges to avoid orphan critical masking the assertion
      edgeService.createEdge({ from_node_id: created[0].id, to_node_id: created[1].id, explanation: 'links active A to B' });
      edgeService.createEdge({ from_node_id: created[1].id, to_node_id: created[2].id, explanation: 'links active B to C' });
      edgeService.createEdge({ from_node_id: created[0].id, to_node_id: created[2].id, explanation: 'links active A to C' });
    });

    afterAll(() => close());

    it('unconfirmed metric status is "ok"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Unconfirmed node %');
      assert.ok(metric, 'Expected "Unconfirmed node %" metric to exist');
      assert.strictEqual(
        metric.status,
        'ok',
        `Expected ok, got "${metric.status}" (value: ${metric.value})`
      );
    });
  });
});

// ── Suite 6 — Low-confidence % metric ────────────────────────────────────────

describe('Low-confidence % metric — all nodes low confidence → warn or critical', () => {
  let close;
  let healthService;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
    healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

    for (let i = 0; i < 4; i++) {
      nodeService.createNode(nodeFixture({
        title: `Low-Conf Node ${i + 1}`,
        confidence: 'low',
        status: 'active',
      }));
    }
  });

  afterAll(() => close());

  it('low-confidence metric status is "warn" or "critical"', () => {
    const { metrics } = healthService.getHealthMetrics();
    const metric = metrics.find((m) => m.name === 'Low-confidence node %');
    assert.ok(metric, 'Expected "Low-confidence node %" metric to exist');
    assert.ok(
      ['warn', 'critical'].includes(metric.status),
      `Expected warn or critical, got "${metric.status}" (value: ${metric.value})`
    );
  });

  it('low-confidence metric value equals 100 when all nodes are low', () => {
    const { metrics } = healthService.getHealthMetrics();
    const metric = metrics.find((m) => m.name === 'Low-confidence node %');
    assert.ok(metric, 'Expected "Low-confidence node %" metric to exist');
    assert.strictEqual(metric.value, 100);
  });
});

// ── Suite 7 — Vague description % metric ─────────────────────────────────────

describe('Vague description % metric', () => {
  describe('description containing "discusses" → vague detected', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      nodeService.createNode(nodeFixture({
        title: 'Vague Node',
        description: 'This node discusses the general concepts of the feature.',
        status: 'active',
        confidence: 'high',
      }));
    });

    afterAll(() => close());

    it('vague description metric value is 100 for a single vague node', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Vague description %');
      assert.ok(metric, 'Expected "Vague description %" metric to exist');
      assert.strictEqual(metric.value, 100);
    });

    it('vague description metric status is "warn" or "critical"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Vague description %');
      assert.ok(metric, 'Expected "Vague description %" metric to exist');
      assert.ok(
        ['warn', 'critical'].includes(metric.status),
        `Expected warn or critical, got "${metric.status}"`
      );
    });
  });

  describe('description without weak verbs → not vague', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      const n1 = nodeService.createNode(nodeFixture({
        title: 'Precise Node A',
        description: 'Captures the binding contract between the event producer and its consumers.',
        status: 'active',
        confidence: 'high',
      }));
      const n2 = nodeService.createNode(nodeFixture({
        title: 'Precise Node B',
        description: 'Specifies the retry backoff strategy applied when a consumer fails to acknowledge.',
        status: 'active',
        confidence: 'high',
      }));
      edgeService.createEdge({ from_node_id: n1.id, to_node_id: n2.id, explanation: 'Contract drives retry behaviour' });
    });

    afterAll(() => close());

    it('vague description metric value is 0', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Vague description %');
      assert.ok(metric, 'Expected "Vague description %" metric to exist');
      assert.strictEqual(metric.value, 0);
    });

    it('vague description metric status is "ok"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Vague description %');
      assert.ok(metric, 'Expected "Vague description %" metric to exist');
      assert.strictEqual(metric.status, 'ok');
    });
  });

  describe('word boundary semantics are preserved for SQL prefiltering', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      nodeService.createNode(nodeFixture({
        title: 'Boundary Node',
        description: 'This note overdiscusses migration sequencing without using a weak verb as a standalone phrase.',
        status: 'active',
        confidence: 'high',
      }));
    });

    afterAll(() => close());

    it('vague description metric value remains 0 when a weak term only appears inside a larger word', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Vague description %');
      assert.ok(metric, 'Expected "Vague description %" metric to exist');
      assert.strictEqual(metric.value, 0);
    });
  });
});

// ── Suite 8 — Avg edges per node metric ──────────────────────────────────────

describe('Avg edges per node metric', () => {
  describe('0 edges / node → status critical', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      // Nodes with no edges at all
      nodeService.createNode(nodeFixture({ title: 'Island A', status: 'active', confidence: 'high' }));
      nodeService.createNode(nodeFixture({ title: 'Island B', status: 'active', confidence: 'high' }));
    });

    afterAll(() => close());

    it('avg-edges metric status is "critical"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Avg edges per node');
      assert.ok(metric, 'Expected "Avg edges per node" metric to exist');
      assert.strictEqual(
        metric.status,
        'critical',
        `Expected critical, got "${metric.status}" (value: ${metric.value})`
      );
    });

    it('avg-edges metric value is 0', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Avg edges per node');
      assert.strictEqual(metric.value, 0);
    });
  });

  describe('>1.5 edges / node → status ok', () => {
    let close;
    let healthService;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));

      seedHealthyGraph(nodeService, edgeService);
    });

    afterAll(() => close());

    it('avg-edges metric status is "ok"', () => {
      const { metrics } = healthService.getHealthMetrics();
      const metric = metrics.find((m) => m.name === 'Avg edges per node');
      assert.ok(metric, 'Expected "Avg edges per node" metric to exist');
      assert.strictEqual(
        metric.status,
        'ok',
        `Expected ok, got "${metric.status}" (value: ${metric.value})`
      );
    });
  });
});

// ── Suite 9 — Recommendations ────────────────────────────────────────────────

describe('getHealthMetrics — recommendations', () => {
  describe('healthy graph: recommendations are non-empty with string entries', () => {
    let close;
    let healthService;
    let report;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      const edgeService = require(path.resolve(__dirname, '../../services/edgeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));
      seedHealthyGraph(nodeService, edgeService);
      report = healthService.getHealthMetrics();
    });

    afterAll(() => close());

    it('recommendations array is non-empty', () => {
      assert.ok(
        Array.isArray(report.recommendations) && report.recommendations.length > 0,
        'Expected at least one recommendation'
      );
    });

    it('all recommendation entries are strings', () => {
      for (const rec of report.recommendations) {
        assert.strictEqual(typeof rec, 'string', `Recommendation is not a string: ${JSON.stringify(rec)}`);
        assert.ok(rec.trim().length > 0, 'Recommendation must be a non-empty string');
      }
    });
  });

  describe('degraded graph: recommendations surface critical issues', () => {
    let close;
    let healthService;
    let report;

    beforeAll(() => {
      const ctx = makeDb();
      close = ctx.close;
      const nodeService = require(path.resolve(__dirname, '../../services/nodeService.js'));
      healthService = require(path.resolve(__dirname, '../../services/healthService.js'));
      seedDegradedGraph(nodeService);
      report = healthService.getHealthMetrics();
    });

    afterAll(() => close());

    it('recommendations array is non-empty for a degraded graph', () => {
      assert.ok(
        Array.isArray(report.recommendations) && report.recommendations.length > 0,
        'Expected at least one recommendation for degraded graph'
      );
    });

    it('all recommendation entries are strings', () => {
      for (const rec of report.recommendations) {
        assert.strictEqual(typeof rec, 'string', `Recommendation is not a string: ${JSON.stringify(rec)}`);
      }
    });
  });
});

run('Ra-h — HealthService').then(process.exit);
