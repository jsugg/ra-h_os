export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

// New Node-based type system replacing rigid Item categorization
export interface Node {
  id: number;
  title: string;
  description?: string;
  notes?: string;             // User's notes/thoughts about this node
  link?: string;
  event_date?: string | null; // When the thing actually happened (ISO 8601)
  dimensions: string[];       // Flexible dimensions replacing type + stage + segment + tags
  embedding?: Buffer;         // Node-level embedding (BLOB data)
  chunk?: string;
  metadata?: Record<string, unknown> | null; // Flexible metadata storage
  created_at: string;
  updated_at: string;
  edge_count?: number;       // Derived count of edges, included in some queries

  // Optional embedding fields
  embedding_updated_at?: string;
  embedding_text?: string;
  chunk_status?: 'not_chunked' | 'chunking' | 'chunked' | 'error' | null;
}

export interface Chunk {
  id: number;
  node_id: number;           // Updated from item_id to node_id
  chunk_idx?: number;
  text: string;
  embedding?: number[];
  embedding_type: string;
  metadata?: Record<string, unknown> | null; // Updated from extras to metadata
  created_at: string;
}

export interface Edge {
  id: number;
  from_node_id: number;
  to_node_id: number;
  context?: EdgeContext | Record<string, unknown> | null;
  source: EdgeSource;
  created_at: string;
}

export type EdgeSource = 'user' | 'ai_similarity' | 'helper_name';

export type EdgeContextType =
  | 'created_by'   // Content → Creator (book by author, podcast by host)
  | 'part_of'      // Part → Whole (episode of podcast, person discussed in book)
  | 'source_of'    // Derivative → Source (insight from article)
  | 'related_to';  // Default — anything else or when unsure

export type EdgeCreatedVia = 'ui' | 'agent' | 'mcp' | 'workflow' | 'quicklink' | 'quick_capture_auto';

export interface EdgeContext {
  // SYSTEM-INFERRED (AI classifies from explanation + nodes)
  type: EdgeContextType;
  confidence: number;   // 0-1
  inferred_at: string;  // ISO timestamp

  // PROVIDED AT CREATION / EDIT
  explanation: string;

  // SYSTEM-MANAGED
  created_via: EdgeCreatedVia;
}

// New NodeFilters interface replacing rigid ItemFilters
export interface NodeFilters {
  dimensions?: string[];      // Filter by dimensions (replaces stage/type filtering)
  search?: string;           // Text search in title/content
  searchMode?: 'standard' | 'hybrid'; // standard = FTS/LIKE, hybrid = add node-vector retrieval
  limit?: number;
  offset?: number;
  sortBy?: 'updated' | 'edges' | 'created' | 'event_date';  // Sort by updated_at, edge count, created_at, or event_date
  dimensionsMatch?: 'any' | 'all';  // 'any' = OR (default), 'all' = AND
  createdAfter?: string;     // ISO date (YYYY-MM-DD) — nodes created on or after
  createdBefore?: string;    // ISO date (YYYY-MM-DD) — nodes created before
  eventAfter?: string;       // ISO date (YYYY-MM-DD) — nodes with event_date on or after
  eventBefore?: string;      // ISO date (YYYY-MM-DD) — nodes with event_date before
}

export interface ChunkData {
  node_id: number;           // Updated from item_id
  chunk_idx?: number;
  text: string;
  embedding?: number[];
  embedding_type: string;
  metadata?: Record<string, unknown> | null; // Updated from extras
}

export interface EdgeData {
  from_node_id: number;
  to_node_id: number;
  explanation: string;
  created_via: EdgeCreatedVia;
  source: EdgeSource;
  skip_inference?: boolean; // reserved for bulk imports / migrations
}

export interface ChatData {
  user_message?: string;
  assistant_message?: string;
  thread_id: string;
  focused_node_id?: number;  // Updated from focused_item_id
  metadata?: Record<string, unknown> | null;
  embedding?: number[];      // Renamed from content_embedding
}

// New NodeConnection interface
export interface NodeConnection {
  id: number;
  connected_node: Node;      // Updated from connected_item
  edge: Edge;
}

export interface DatabaseError {
  message: string;
  code?: string;
  details?: Record<string, unknown> | null;
}

// Dimension interface for dimension management
export interface Dimension {
  name: string;
  description?: string | null;
  icon?: string | null;
  is_priority: boolean;
  updated_at: string;
}
