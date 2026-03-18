---
name: DB Operations
description: "Use this for all graph read/write operations with strict data quality standards."
when_to_use: "Any request to read, create, update, connect, classify, or traverse graph data."
when_not_to_use: "Pure conversation with no graph interaction needed."
success_criteria: "Writes are explicit and correct; descriptions are concrete; edges and dimensions are high-signal; lifecycle fields are set appropriately."
---

# DB Operations

## Core Rules

1. Search before create to avoid duplicates.
2. Every create/update must include an explicit description of WHAT the thing is and WHY it matters.
3. Use event dates when known (when it happened, not when saved).
4. Apply dimensions deliberately; prefer existing dimensions over creating noisy new ones.
5. Create edges when relationships are meaningful; edge explanations should read as a sentence.
6. Set `confidence` honestly: `high` = directly stated by user, `medium` = inferred, `low` = uncertain.
7. New LLM-initiated nodes default to `status: draft`. Use `promoteNode` to set `active` once confirmed.

## Write Quality Contract

- `title`: clear and specific.
- `description`: concrete object-level description, not vague summaries. No weak verbs (discusses, explores, examines).
- `notes/content`: extra context, analysis, supporting detail.
- `link`: external source URL only.
- `status`: lifecycle state. `draft` for unconfirmed LLM writes. `active` for confirmed.
- `confidence`: `high` | `medium` | `low`. Reflects certainty at write time.
- `created_via`: `llm_auto` (default), `llm_confirmed` (user approved), `user` (user wrote directly).

## Node Lifecycle

```
draft → active       (promoteNode, user confirmed)
active → deprecated  (outdated, no longer relevant)
active → superseded  (replaced by a newer node — add edge explaining the supersession)
uncertain → active   (conflict resolved, description verified)
uncertain → deprecated (conflict resolved by removing the node)
```

A node is automatically set to `uncertain` if its description update has low Jaccard similarity
to the previous description — this signals a potential conflict requiring review.

## Dimension Taxonomy

Default dimensions (use these first unless the user already has a stronger local taxonomy):

| Dimension   | Use for                                                  | Do NOT use for                          |
|-------------|----------------------------------------------------------|-----------------------------------------|
| `research`    | Research material, sources, investigation tracks          | Final decisions or active delivery work |
| `ideas`       | Concepts, hypotheses, rough insights, possible directions | Concrete shipped decisions or owners    |
| `projects`    | Active work with deliverables and timelines               | Completed/archived work                 |
| `memory`      | Session memory, summaries, retained working context       | External sources or project records     |
| `preferences` | Working style, collaboration preferences, user defaults   | Project-specific facts                  |

If a truly new category is needed, create it explicitly with `createDimension`. The built-in baseline
is the five original dimensions above.

## Execution Pattern

1. Read context (search + relevant nodes + relevant edges).
2. Decide: create vs update vs connect.
3. Set lifecycle fields: status, confidence, created_via.
4. Execute minimum required writes.
5. Verify result reflects user intent exactly.
6. If updateNode returns `conflict_detected: true`, review the change and call promoteNode.

## node_history Table

Every field-level change to a node is recorded in `node_history` before being committed.
Use `getNodeHistory` to view the full change log for a node.
Use `sqliteQuery` with:
```sql
SELECT * FROM node_history WHERE node_id = ? ORDER BY changed_at ASC
```

## Do Not

- Create duplicate nodes when an update is correct.
- Write vague descriptions ("discusses", "explores", "is about").
- Create weak or directionless edges.
- Leave nodes in `draft` status indefinitely — confirm or deprecate.
- Ignore `conflict_detected: true` responses from updateNode.
