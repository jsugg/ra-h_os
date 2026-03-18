type ToolTrace = {
  step?: unknown;
  purpose?: unknown;
  thoughts?: unknown;
  next_action?: unknown;
};

type WebSearchResult = {
  title?: unknown;
  url?: unknown;
};

type EmbeddingChunkResult = {
  text?: unknown;
  node_id?: unknown;
};

type QueryNodeResult = {
  id?: unknown;
  title?: unknown;
  formatted_display?: unknown;
};

type QueryEdgeResult = {
  from_node_id?: unknown;
  to_node_id?: unknown;
};

type ToolResultData = {
  message?: unknown;
  trace?: unknown;
  query?: unknown;
  results?: unknown;
  chunks?: unknown;
  title?: unknown;
  count?: unknown;
  formatted_display?: unknown;
  nodes?: unknown;
  edges?: unknown;
};

type ToolResultPayload = {
  success?: unknown;
  error?: unknown;
  message?: unknown;
  data?: ToolResultData;
};

function ensureString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function truncateOrDefault(value: string, limit = 180, fallback = ''): string {
  if (!value) return fallback;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function asRecord<T extends Record<string, unknown>>(value: unknown): T | null {
  return typeof value === 'object' && value !== null ? (value as T) : null;
}

export function summarizeToolExecution(toolName: string, args: unknown, result: unknown): string {
  const fallback = `${toolName} completed.`;

  if (typeof result === 'string') {
    const trimmed = result.trim();
    return trimmed || fallback;
  }

  const resultRecord = asRecord<ToolResultPayload>(result);
  if (!resultRecord) {
    return fallback;
  }

  if (resultRecord.success === false) {
    const error = ensureString(resultRecord.error) || 'unknown error';
    return `${toolName} failed: ${error}`;
  }

  const message = ensureString(resultRecord.message);
  if (message) {
    return message;
  }

  const resultData = asRecord<ToolResultData>(resultRecord.data);
  const argsRecord = asRecord<Record<string, unknown>>(args);

  if (toolName === 'think') {
    const trace = asRecord<ToolTrace>(resultData?.trace) ?? argsRecord ?? {};
    const step = ensureNumber(trace.step ?? argsRecord?.step);
    const purpose = ensureString(trace.purpose ?? argsRecord?.purpose) || 'planning';
    const thoughts = ensureString(trace.thoughts ?? argsRecord?.thoughts);
    const next = ensureString(trace.next_action ?? argsRecord?.next_action);

    let summary = `Plan${step ? ` step ${step}` : ''}: ${truncateOrDefault(purpose, 120, purpose)}`;
    if (thoughts) {
      summary += ` — ${truncateOrDefault(thoughts, 160, thoughts)}`;
    }
    if (next) {
      summary += `. Next: ${truncateOrDefault(next, 80, next)}`;
    }
    return summary;
  }

  if (toolName === 'webSearch') {
    const query = ensureString(argsRecord?.query) || ensureString(resultData?.query);
    const results = Array.isArray(resultData?.results) ? resultData.results : [];
    if (results.length > 0) {
      const items = results.slice(0, 3).map((entry) => {
        const searchResult = asRecord<WebSearchResult>(entry) ?? {};
        const title = ensureString(searchResult.title) || ensureString(searchResult.url) || 'Result';
        const url = ensureString(searchResult.url);
        return url ? `${truncateOrDefault(title, 80, title)} (${url})` : truncateOrDefault(title, 80, title);
      });
      return `Web search${query ? ` for "${truncateOrDefault(query, 60, query)}"` : ''}: ${items.join('; ')}`;
    }
    return `Web search${query ? ` for "${truncateOrDefault(query, 60, query)}"` : ''}: no results.`;
  }

  if (toolName === 'searchContentEmbeddings') {
    const query = ensureString(argsRecord?.query) || ensureString(resultData?.query);
    const chunks = Array.isArray(resultData?.chunks) ? resultData.chunks : [];
    if (chunks.length > 0) {
      const top = asRecord<EmbeddingChunkResult>(chunks[0]) ?? {};
      const snippet = ensureString(top.text);
      const nodeId = ensureNumber(top.node_id);
      const preview = truncateOrDefault(snippet, 160, snippet);
      return `Embedding search${query ? ` for "${truncateOrDefault(query, 60, query)}"` : ''} found ${chunks.length} chunk(s). Top${nodeId ? ` [NODE:${nodeId}]` : ''}: ${preview}`;
    }
    return `Embedding search${query ? ` for "${truncateOrDefault(query, 60, query)}"` : ''}: no matches.`;
  }

  if (toolName === 'youtubeExtract') {
    const title = ensureString(resultData?.title) || ensureString(argsRecord?.title);
    const formatted = ensureString(resultData?.formatted_display);
    if (formatted) {
      return `YouTube extract created ${formatted}.`;
    }
    if (title) {
      return `YouTube extract processed "${truncateOrDefault(title, 80, title)}".`;
    }
    return 'YouTube extract completed.';
  }

  if (toolName === 'queryNodes') {
    const nodes = Array.isArray(resultData?.nodes) ? resultData.nodes : [];
    if (nodes.length > 0) {
      const labels = nodes
        .slice(0, 3)
        .map((node) => {
          const queryNode = asRecord<QueryNodeResult>(node) ?? {};
          return ensureString(queryNode.formatted_display) || ensureString(queryNode.title) || `[NODE:${String(queryNode.id ?? '?')}]`;
        })
        .join(', ');
      return `Found ${nodes.length} node(s): ${labels}`;
    }
  }

  if (toolName === 'queryEdge') {
    const edges = Array.isArray(resultData?.edges) ? resultData.edges : [];
    if (edges.length > 0) {
      const edge = asRecord<QueryEdgeResult>(edges[0]) ?? {};
      return `Found ${edges.length} edge(s), e.g., ${String(edge.from_node_id ?? '?')} → ${String(edge.to_node_id ?? '?')}.`;
    }
    return 'No edges found.';
  }

  if (resultData?.formatted_display) {
    return ensureString(resultData.formatted_display) || fallback;
  }

  if (resultData?.title) {
    const title = ensureString(resultData.title);
    return `Processed "${truncateOrDefault(title, 80, title)}".`;
  }

  if (resultData?.count !== undefined) {
    const count = resultData.count;
    return `${toolName} returned ${count} item(s).`;
  }

  try {
    const preview = JSON.stringify(resultData ?? resultRecord);
    return truncateOrDefault(preview, 200, fallback);
  } catch (_error) {
    return fallback;
  }
}
