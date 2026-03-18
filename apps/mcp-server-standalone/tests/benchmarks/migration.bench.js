'use strict';

/**
 * migration.bench.js
 *
 * Benchmarks migration timing:
 *   1. Apply all migrations to a fresh SQLite DB (measures open → migrated)
 *   2. Idempotent re-run on an already-migrated DB (should be near-zero work)
 *
 * Does NOT use makeDb() to avoid a circular dependency with sqlite-client.
 * Uses better-sqlite3 + the migration runner directly.
 */

const path = require('node:path');
const os   = require('node:os');
const fs   = require('node:fs');
const crypto = require('node:crypto');

const Database = require('better-sqlite3');
const { runMigrations } = require(path.resolve(__dirname, '../../migrations/runner'));

// ---------------------------------------------------------------------------
// Helper: create an isolated temp DB file path
// ---------------------------------------------------------------------------
function tempDbPath() {
  const id = crypto.randomBytes(6).toString('hex');
  return path.join(os.tmpdir(), `utu_bench_migration_${id}.sqlite`);
}

// ---------------------------------------------------------------------------
// Helper: open a fresh DB, apply pragmas, return { db, dbPath }
// ---------------------------------------------------------------------------
function openFreshDb() {
  const dbPath = tempDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 5000');
  db.pragma('foreign_keys = ON');
  return { db, dbPath };
}

// ---------------------------------------------------------------------------
// Scenario 1: Apply all 5 migrations to a fresh DB
// ---------------------------------------------------------------------------

/** @type {import('./types').BenchScenario} */
const applyAllMigrations = {
  name: 'Apply all 5 migrations to fresh DB',
  warmup: 3,
  iterations: 20,

  prepare: async () => {
    // No shared state needed — each bench() call creates its own DB.
    return {};
  },

  bench: async (_ctx) => {
    const { db, dbPath } = openFreshDb();
    try {
      runMigrations(db);
    } finally {
      try { db.close(); } catch (_) {}
      try { fs.unlinkSync(dbPath); } catch (_) {}
    }
  },

  teardown: async (_ctx) => {},
};

// ---------------------------------------------------------------------------
// Scenario 2: Idempotent re-run (0 pending migrations)
// ---------------------------------------------------------------------------

/** @type {import('./types').BenchScenario} */
const idempotentRerun = {
  name: 'Idempotent re-run (0 pending)',
  warmup: 5,
  iterations: 50,

  prepare: async () => {
    // Create ONE pre-migrated DB that is reused across all iterations.
    // The measured bench() just calls runMigrations() again — which should
    // detect 0 pending and return immediately.
    const { db, dbPath } = openFreshDb();
    runMigrations(db); // fully migrated
    return { db, dbPath };
  },

  bench: async (ctx) => {
    runMigrations(ctx.db);
  },

  teardown: async (ctx) => {
    try { ctx.db.close(); } catch (_) {}
    try { fs.unlinkSync(ctx.dbPath); } catch (_) {}
  },
};

module.exports = [applyAllMigrations, idempotentRerun];
