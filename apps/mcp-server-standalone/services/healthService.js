'use strict';

const { query } = require('./sqlite-client');

/**
 * Graph health metrics service.
 *
 * Computes a suite of observable quality signals for the knowledge graph.
 * These metrics surface degradation that would otherwise be invisible — drift
 * in write quality, topological gaps, and operational staleness.
 *
 * All metrics are computable from the existing schema with no external
 * dependencies. Call getHealthMetrics() to get the full report.
 *
 * Thresholds are conservative defaults; they will never produce false
 * positives on an actively maintained graph.
 */

/**
 * @typedef {Object} MetricResult
 * @property {string}  name        Human-readable metric name
 * @property {number}  value       Computed value
 * @property {string}  unit        e.g. '%', 'count', 'score', 'days'
 * @property {string}  status      'ok' | 'warn' | 'critical'
 * @property {string}  note        Interpretation of the current value
 */

/**
 * @typedef {Object} HealthReport
 * @property {number}         score     Weighted composite 0–100
 * @property {string}         grade     A | B | C | D | F
 * @property {MetricResult[]} metrics
 * @property {string[]}       recommendations  Prioritised action items
 */

/**
 * BFS shortest-path computation between the top N hub nodes.
 * Edges are treated as undirected for path-finding purposes.
 *
 * Returns null when fewer than 3 hubs exist (metric is not meaningful).
 *
 * @param {number} hubLimit  Number of top hub nodes to sample (by importance_score)
 * @returns {{ avgPathLength: number; unreachableCount: number; hubCount: number } | null}
 */
function computeHubPathLengths(hubLimit = 10) {
  const hubRows = query(`
    SELECT n.id
    FROM nodes n
    WHERE EXISTS (SELECT 1 FROM edges e WHERE e.from_node_id = n.id OR e.to_node_id = n.id)
    ORDER BY n.importance_score DESC, n.id DESC
    LIMIT ?
  `, [hubLimit]);

  if (hubRows.length < 3) return null;

  // Build undirected adjacency list from all edges
  const allEdges = query('SELECT from_node_id, to_node_id FROM edges');
  /** @type {Map<number, number[]>} */
  const adj = new Map();
  for (const { from_node_id: f, to_node_id: t } of allEdges) {
    if (!adj.has(f)) adj.set(f, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(f).push(t);
    adj.get(t).push(f);
  }

  const hubIds = hubRows.map((r) => r.id);
  let totalLength = 0;
  let reachable = 0;
  let unreachable = 0;

  for (const src of hubIds) {
    // BFS from src
    const dist = new Map([[src, 0]]);
    const queue = [src];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const d = dist.get(cur);
      for (const nb of (adj.get(cur) || [])) {
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }

    for (const tgt of hubIds) {
      if (tgt === src) continue;
      const d = dist.get(tgt);
      if (d !== undefined) {
        totalLength += d;
        reachable++;
      } else {
        unreachable++;
      }
    }
  }

  const avgPathLength = reachable > 0 ? totalLength / reachable : Infinity;
  return { avgPathLength, unreachableCount: unreachable, hubCount: hubIds.length };
}

/** Weak verb patterns used in vague node descriptions. */
const WEAK_VERB_PATTERN = /\b(discusses|explores|examines|talks about|is about|delves into|covers|looks at)\b/i;
const WEAK_VERB_SQL_TERMS = [
  'discusses',
  'explores',
  'examines',
  'talks about',
  'is about',
  'delves into',
  'covers',
  'looks at',
];

/**
 * Compute the full health report.
 *
 * @returns {HealthReport}
 */
function getHealthMetrics() {
  const metrics = [];

  // ── 1. Total counts ────────────────────────────────────────────────────────
  const [totals] = query(
    'SELECT COUNT(*) as node_count FROM nodes'
  );
  const nodeCount = Number(totals.node_count);

  const [edgeTotals] = query(
    'SELECT COUNT(*) as edge_count FROM edges'
  );
  const edgeCount = Number(edgeTotals.edge_count);

  if (nodeCount === 0) {
    return {
      score: 0,
      grade: 'F',
      metrics: [],
      recommendations: ['Graph is empty. Run the Onboarding skill to bootstrap your knowledge graph.'],
    };
  }

  // ── 2. Orphan node % ───────────────────────────────────────────────────────
  const [orphanRow] = query(`
    SELECT COUNT(*) as count FROM nodes n
    WHERE NOT EXISTS (
      SELECT 1 FROM edges e WHERE e.from_node_id = n.id OR e.to_node_id = n.id
    )
  `);
  const orphanCount = Number(orphanRow.count);
  const orphanPct = nodeCount > 0 ? (orphanCount / nodeCount) * 100 : 0;

  metrics.push({
    name: 'Orphan node %',
    value: Math.round(orphanPct * 10) / 10,
    unit: '%',
    status: orphanPct > 40 ? 'critical' : orphanPct > 20 ? 'warn' : 'ok',
    note: `${orphanCount} of ${nodeCount} nodes have no edges`,
  });

  // ── 3. Draft/uncertain node % ──────────────────────────────────────────────
  const statusRows = query(
    `SELECT status, COUNT(*) as count FROM nodes GROUP BY status`
  );
  const statusMap = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.count)]));
  const draftCount = (statusMap.draft || 0) + (statusMap.uncertain || 0);
  const draftPct = (draftCount / nodeCount) * 100;

  metrics.push({
    name: 'Unconfirmed node %',
    value: Math.round(draftPct * 10) / 10,
    unit: '%',
    status: draftPct > 50 ? 'critical' : draftPct > 30 ? 'warn' : 'ok',
    note: `${draftCount} nodes in draft/uncertain state`,
  });

  // ── 4. Low-confidence write % ──────────────────────────────────────────────
  const confRows = query(
    `SELECT confidence, COUNT(*) as count FROM nodes GROUP BY confidence`
  );
  const confMap = Object.fromEntries(confRows.map((r) => [r.confidence, Number(r.count)]));
  const lowConfCount = confMap.low || 0;
  const lowConfPct = (lowConfCount / nodeCount) * 100;

  metrics.push({
    name: 'Low-confidence node %',
    value: Math.round(lowConfPct * 10) / 10,
    unit: '%',
    status: lowConfPct > 30 ? 'critical' : lowConfPct > 15 ? 'warn' : 'ok',
    note: `${lowConfCount} nodes with low write confidence`,
  });

  // ── 5. Vague description % ─────────────────────────────────────────────────
  const [descriptionTotals] = query(
    `SELECT COUNT(*) as count FROM nodes WHERE description IS NOT NULL AND description != ''`
  );
  const totalDescriptions = Number(descriptionTotals.count);
  const vagueCandidates = query(
    `SELECT description
     FROM nodes
     WHERE description IS NOT NULL
       AND description != ''
       AND (${WEAK_VERB_SQL_TERMS.map(() => 'LOWER(description) LIKE ?').join(' OR ')})`,
    WEAK_VERB_SQL_TERMS.map((term) => `%${term}%`)
  );
  const vagueCount = vagueCandidates.filter(
    (r) => WEAK_VERB_PATTERN.test(r.description)
  ).length;
  const vaguePct = totalDescriptions > 0
    ? (vagueCount / totalDescriptions) * 100
    : 0;

  metrics.push({
    name: 'Vague description %',
    value: Math.round(vaguePct * 10) / 10,
    unit: '%',
    status: vaguePct > 20 ? 'critical' : vaguePct > 10 ? 'warn' : 'ok',
    note: `${vagueCount} descriptions contain weak/vague verbs`,
  });

  // ── 6. Dimension balance (skew) ────────────────────────────────────────────
  const dimCounts = query(
    `SELECT nd.dimension, COUNT(*) as count
     FROM node_dimensions nd
     GROUP BY nd.dimension`
  );

  let dimensionSkewStatus = 'ok';
  let dimensionSkewNote = 'Dimension distribution is balanced';

  if (dimCounts.length >= 2) {
    const counts = dimCounts.map((r) => Number(r.count));
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    const skewRatio = minCount > 0 ? maxCount / minCount : maxCount;

    dimensionSkewStatus = skewRatio > 10 ? 'critical' : skewRatio > 3 ? 'warn' : 'ok';
    dimensionSkewNote = `Max/min dimension ratio: ${Math.round(skewRatio * 10) / 10}×`;

    metrics.push({
      name: 'Dimension skew ratio',
      value: Math.round(skewRatio * 10) / 10,
      unit: '×',
      status: dimensionSkewStatus,
      note: dimensionSkewNote,
    });
  }

  // ── 7. Hub connectivity (avg shortest path between top hub nodes) ──────────
  const hubStats = computeHubPathLengths(10);
  if (hubStats) {
    const { avgPathLength, unreachableCount, hubCount } = hubStats;
    const hubStatus = unreachableCount > 0
      ? 'critical'
      : avgPathLength > 4 ? 'warn' : 'ok';
    // Use 99 as sentinel value when hubs are disconnected (Infinity is not JSON-safe)
    const hubValue = unreachableCount > 0 ? 99 : Math.round(avgPathLength * 10) / 10;
    metrics.push({
      name: 'Hub connectivity',
      value: hubValue,
      unit: 'hops',
      status: hubStatus,
      note: unreachableCount > 0
        ? `${unreachableCount} of ${hubCount * (hubCount - 1)} hub-pair paths are unreachable`
        : `Avg ${Math.round(avgPathLength * 10) / 10} hops between top ${hubCount} hub nodes`,
    });
  }

  // ── 8. Avg edges per node ──────────────────────────────────────────────────
  const avgEdges = nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0; // *2: each edge touches 2 nodes
  metrics.push({
    name: 'Avg edges per node',
    value: Math.round(avgEdges * 10) / 10,
    unit: 'edges',
    status: avgEdges < 0.5 ? 'critical' : avgEdges < 1.5 ? 'warn' : 'ok',
    note: `${edgeCount} total edges across ${nodeCount} nodes`,
  });

  // ── 9. Skill execution recency ─────────────────────────────────────────────
  let skillRecencyStatus = 'ok';
  let skillRecencyNote = 'No skill execution history yet';
  let maxDaysSinceSkill = 0;

  try {
    const skillRows = query(`
      SELECT skill_name, MAX(executed_at) as last_run
      FROM skill_executions
      GROUP BY skill_name
    `);

    if (skillRows.length > 0) {
      const now = Date.now();
      const daysSince = skillRows.map((r) => {
        const ms = now - new Date(r.last_run).getTime();
        return Math.floor(ms / (1000 * 60 * 60 * 24));
      });
      maxDaysSinceSkill = Math.max(...daysSince);
      skillRecencyStatus = maxDaysSinceSkill > 90 ? 'warn' : 'ok';
      skillRecencyNote = `Most stale skill last run ${maxDaysSinceSkill} days ago`;
    }
  } catch (_) {
    // skill_executions table may not exist yet in older databases
  }

  metrics.push({
    name: 'Skill recency (max days)',
    value: maxDaysSinceSkill,
    unit: 'days',
    status: skillRecencyStatus,
    note: skillRecencyNote,
  });

  // ── 10. Compute composite health score ────────────────────────────────────
  const score = computeHealthScore(metrics);
  const grade = scoreToGrade(score);

  // ── 11. Generate prioritised recommendations ──────────────────────────────
  const recommendations = buildRecommendations(metrics, {
    orphanCount,
    draftCount,
    lowConfCount,
    vagueCount,
    nodeCount,
  });

  return { score, grade, metrics, recommendations };
}

/**
 * Compute a weighted composite score 0–100 from metric statuses.
 *
 * @param {MetricResult[]} metrics
 * @returns {number}
 */
function computeHealthScore(metrics) {
  const weights = {
    'Orphan node %': 2,
    'Unconfirmed node %': 1.5,
    'Low-confidence node %': 1.5,
    'Vague description %': 2,
    'Dimension skew ratio': 1,
    'Hub connectivity': 1.5,
    'Avg edges per node': 2,
    'Skill recency (max days)': 1,
  };

  const statusPenalty = { ok: 0, warn: 0.5, critical: 1.0 };

  let totalWeight = 0;
  let totalPenalty = 0;

  for (const m of metrics) {
    const w = weights[m.name] || 1;
    totalWeight += w;
    totalPenalty += w * (statusPenalty[m.status] || 0);
  }

  if (totalWeight === 0) return 100;
  const rawScore = 100 * (1 - totalPenalty / totalWeight);
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * @param {number} score
 * @returns {string}
 */
function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Build an ordered list of action recommendations from metric results.
 *
 * @param {MetricResult[]} metrics
 * @param {object} counts
 * @returns {string[]}
 */
function buildRecommendations(metrics, { orphanCount, draftCount, lowConfCount, vagueCount, nodeCount }) {
  const recs = [];

  const critical = metrics.filter((m) => m.status === 'critical');
  const warned = metrics.filter((m) => m.status === 'warn');

  for (const m of critical) {
    if (m.name === 'Orphan node %') {
      recs.push(`Connect or deprecate ${orphanCount} orphan nodes — run findOrphans tool.`);
    } else if (m.name === 'Vague description %') {
      recs.push(`Rewrite ${vagueCount} vague node descriptions — search for weak-verb language.`);
    } else if (m.name === 'Unconfirmed node %') {
      recs.push(`Review ${draftCount} draft/uncertain nodes — run queryDraft tool.`);
    } else if (m.name === 'Low-confidence node %') {
      recs.push(`Validate ${lowConfCount} low-confidence nodes with the user — run queryDraft tool.`);
    } else if (m.name === 'Hub connectivity') {
      recs.push('Top hub nodes are poorly connected or unreachable. Run the Connect skill to bridge isolated clusters.');
    } else if (m.name === 'Avg edges per node') {
      recs.push('Run the Connect skill to establish relationships between isolated nodes.');
    } else if (m.name === 'Dimension skew ratio') {
      recs.push('Review dimension distribution — one dimension is dominating the graph. Consider splitting or renaming.');
    }
  }

  for (const m of warned) {
    if (m.name === 'Orphan node %' && !recs.some((r) => r.includes('orphan'))) {
      recs.push(`${orphanCount} orphan nodes detected — run findOrphans and consider connecting them.`);
    } else if (m.name === 'Skill recency (max days)') {
      recs.push('One or more skills have not been run in over 90 days. Run Calibration to re-anchor the graph.');
    } else if (m.name === 'Vague description %' && !recs.some((r) => r.includes('vague'))) {
      recs.push(`${vagueCount} vague descriptions found. Tighten them during next Calibration.`);
    }
  }

  if (recs.length === 0) {
    recs.push('Graph health is good. Continue regular Calibration to maintain quality.');
  }

  return recs;
}

module.exports = {
  getHealthMetrics,
};
