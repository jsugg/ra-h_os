'use strict';

/**
 * Migration 001 — Initial schema baseline.
 *
 * Extracts the CREATE TABLE statements that were previously inlined in
 * sqlite-client.js initDatabase(). For databases that already have these
 * tables the IF NOT EXISTS guards make this a no-op. For brand-new databases
 * it creates the full initial schema including indexes and default dimensions.
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id                   INTEGER PRIMARY KEY,
      title                TEXT,
      description          TEXT,
      notes                TEXT,
      link                 TEXT,
      event_date           TEXT,
      created_at           TEXT,
      updated_at           TEXT,
      metadata             TEXT,
      chunk                TEXT,
      embedding            BLOB,
      embedding_updated_at TEXT,
      embedding_text       TEXT,
      chunk_status         TEXT DEFAULT 'not_chunked'
    );

    CREATE TABLE IF NOT EXISTS edges (
      id           INTEGER PRIMARY KEY,
      from_node_id INTEGER NOT NULL,
      to_node_id   INTEGER NOT NULL,
      source       TEXT,
      created_at   TEXT,
      context      TEXT,
      FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id)   REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_node_id);

    CREATE TABLE IF NOT EXISTS node_dimensions (
      node_id   INTEGER NOT NULL,
      dimension TEXT    NOT NULL,
      PRIMARY KEY (node_id, dimension),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_dim_by_dimension ON node_dimensions(dimension, node_id);
    CREATE INDEX IF NOT EXISTS idx_dim_by_node      ON node_dimensions(node_id, dimension);

    CREATE TABLE IF NOT EXISTS dimensions (
      name        TEXT PRIMARY KEY,
      description TEXT,
      icon        TEXT,
      is_priority INTEGER DEFAULT 0,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO dimensions (name, description, is_priority) VALUES
      ('research',    'Research material, sources, investigation tracks.', 1),
      ('ideas',       'Concepts, hypotheses, rough insights, possible directions.', 1),
      ('projects',    'Active work with deliverables and timelines.', 1),
      ('memory',      'Session memory, summaries, retained working context.', 1),
      ('preferences', 'Working style, collaboration preferences, user defaults.', 1);
  `);
}

module.exports = { up };
