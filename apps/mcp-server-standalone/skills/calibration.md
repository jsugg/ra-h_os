---
name: Calibration
description: "Run periodic check-ins to recalibrate goals, projects, preferences, and graph structure."
when_to_use: "User asks for a check-in, reset, review, or strategic recalibration."
when_not_to_use: "Single isolated question with no strategic update needed."
success_criteria: "Graph reflects current reality: updated hubs, changed priorities, explicit deltas, coverage gaps addressed, importance scores current."
---

# Calibration

## Objective

Re-anchor the graph to the user's current state, address write-quality accumulation, and close coverage gaps.

## Check-in Sequence

### 1. Orient
- Call `getContext` to see current stats and health signals.
- Call `getHealth` for the full health score and recommendations.
- Note: draft count, orphan count, health grade.

### 2. Review Hub Nodes
- Pull the top 5–10 hub nodes by `importance_score`.
- For each: is it still accurate? Has anything changed? Does it need updating?
- Use `getNodeHistory` to see what changed since last calibration.

### 3. Confirm Drafted Nodes
- Call `queryDraft` to surface all `draft` and `uncertain` nodes.
- For each node: confirm with user → `promoteNode(id, 'active', 'user')`.
- For conflicts (uncertain): review old vs new description → resolve or deprecate.

### 4. Ask What Changed
- Goals, priorities, constraints, beliefs, working assumptions, active projects.
- For each change: update existing node vs create new one.
- If a belief or project has changed substantially: deprecate old node, create new, add supersession edge.

### 5. Close Coverage Gaps
- Call `findCoverageGaps` to surface recurring topics not captured.
- For each gap candidate: should this be a node? If yes, create it.
- Call `findOrphans` — for each orphan: connect it or deprecate it.

### 6. Recompute Importance
- After writes are complete, call `computeImportance` to update importance scores.
- This ensures the next `getContext` returns accurate hub nodes.

### 7. Create Session Summary
- Call `createSessionSummary` with a summary of what was reviewed and changed.
- This feeds future `findCoverageGaps` analysis.

## Write Guidance

- Prefer updating existing nodes when continuity matters.
- Create new nodes for genuine shifts in direction/identity/approach.
- Add edges that explain evolution: `[old node] superseded by [new node]`.
- Set `confidence: 'high'` and `created_via: 'user'` for user-confirmed facts.
- Never leave a calibration session with unreviewed `draft`/`uncertain` nodes.

## Output

- Health grade before and after
- What changed (updated vs newly created)
- Draft/uncertain nodes resolved
- Coverage gaps addressed
- What should be reviewed next calibration
