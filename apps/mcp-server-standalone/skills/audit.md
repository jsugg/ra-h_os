---
name: Audit
description: "Run a structured audit of graph quality, skill quality, operational consistency, and input coverage."
when_to_use: "User asks for review, QA, cleanup, or governance checks."
when_not_to_use: "Simple one-off write/read requests."
success_criteria: "Findings are prioritized, concrete, tied to actionable fixes, and include coverage gaps not just output quality."
---

# Audit

## Scope

1. **Node quality**: duplicates, vague descriptions, missing dates, weak titles, stale `draft`/`uncertain` nodes.
2. **Edge quality**: missing links, weak explanations, wrong directionality, orphan nodes.
3. **Dimension quality**: drift, overlap, low-signal categories, legacy dimension usage.
4. **Skill quality**: trigger clarity, overlap, dead/unused skills, execution recency.
5. **Coverage quality**: recurring topics not captured as nodes, systematic gaps in session summaries.

## Execution Sequence

### Step 1 — Run getHealth
Call `getHealth` first. It returns a scored health report with prioritised recommendations.
Review metrics with `critical` or `warn` status — these are the audit's primary targets.

### Step 2 — Node Quality
- Run `queryDraft` to list all `draft` and `uncertain` nodes. These represent unreviewed LLM writes.
- Run `sqliteQuery`:
  ```sql
  SELECT id, title, description FROM nodes
  WHERE description LIKE '%discusses%' OR description LIKE '%explores%'
     OR description LIKE '%examines%' OR description LIKE '%is about%'
  LIMIT 20
  ```
- Check for nodes with no `description` (null or empty).
- Check for duplicate or near-duplicate titles.

### Step 3 — Edge Quality
- Run `findOrphans` to list nodes with zero edges.
- Review hub nodes (high importance_score) — are their connections accurate and directional?
- Sample 10–15 edges via `sqliteQuery` and verify explanations read as sentences.

### Step 4 — Coverage Quality
- Run `createSessionSummary` if no summary exists for recent sessions.
- Run `findCoverageGaps` to surface recurring topics without dedicated nodes.
- Compare `stats.nodeCount` to session activity — is capture rate reasonable?

### Step 5 — Dimension Quality
- Run `queryDimensions` to check node counts per dimension.
- Flag dimensions with 0 nodes (dead dimensions).
- Flag dimensions with disproportionately high counts (possible over-generalisation).
- Check for overlapping or low-signal dimensions — propose consolidation where it improves clarity.

### Step 6 — Skill Quality
- Run `sqliteQuery`:
  ```sql
  SELECT skill_name, MAX(executed_at) as last_run, COUNT(*) as run_count
  FROM skill_executions GROUP BY skill_name ORDER BY last_run DESC
  ```
- Flag skills not run in > 90 days.
- Check skill descriptions against actual trigger conditions for accuracy.

## Output Format

1. **Critical issues** — block graph reliability, must fix
2. **High-impact improvements** — significant quality gains, should fix
3. **Cleanup actions** — polish, fix when convenient
4. **Coverage gaps** — what's missing from the graph
5. **Optional refinements** — nice to have

## Rules

- Use `getHealth` score and grade as the executive summary.
- Prefer specific evidence (node IDs, field values) over generic commentary.
- Propose the smallest high-leverage fixes first.
- Separate defects from optional polish.
- Coverage quality is as important as output quality.
