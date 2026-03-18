'use strict';

/**
 * Migration runner for RA-H standalone MCP server.
 *
 * Applies numbered migrations in order, tracking applied versions in
 * `schema_migrations`. Idempotent: re-running never re-applies a migration.
 * Each migration receives the raw better-sqlite3 Database instance and must
 * be synchronous (SQLite is synchronous; transactions are handled here).
 */

const path = require('node:path');
const fs = require('node:fs');

/** @typedef {{ version: number, name: string, up: (db: import('better-sqlite3').Database) => void }} Migration */

const MIGRATIONS_DIR = __dirname;

/**
 * Ensure the schema_migrations tracking table exists.
 * Called before any migration run.
 *
 * @param {import('better-sqlite3').Database} db
 */
function ensureTrackerTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Return the set of already-applied migration versions.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<number>}
 */
function appliedVersions(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((r) => Number(r.version)));
}

/**
 * Load all migration modules from this directory, sorted by version number.
 * Migration files must be named `NNN_<name>.js` where NNN is a zero-padded integer.
 *
 * @returns {Migration[]}
 */
function loadMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.js$/.test(f) && f !== 'runner.js')
    .sort();

  return files.map((file) => {
    const version = parseInt(file.split('_')[0], 10);
    const name = file.replace(/^\d+_/, '').replace(/\.js$/, '');
    // eslint-disable-next-line import/no-dynamic-require
    const mod = require(path.join(MIGRATIONS_DIR, file));

    if (typeof mod.up !== 'function') {
      throw new Error(`Migration ${file} must export an "up" function.`);
    }

    return { version, name, up: mod.up };
  });
}

/**
 * Run all pending migrations against the provided database instance.
 * Returns the number of migrations applied.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number} count of migrations applied
 */
function runMigrations(db) {
  ensureTrackerTable(db);

  const applied = appliedVersions(db);
  const migrations = loadMigrations();
  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    return 0;
  }

  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
  );

  let count = 0;
  for (const migration of pending) {
    const txn = db.transaction(() => {
      migration.up(db);
      markApplied.run(migration.version, migration.name);
    });
    txn();
    count++;
    console.error(`[ra-h] Applied migration ${migration.version}: ${migration.name}`);
  }

  return count;
}

/**
 * Return the current schema version (highest applied migration version).
 * Returns 0 if no migrations have been applied.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function currentVersion(db) {
  ensureTrackerTable(db);
  const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
  return row && row.v != null ? Number(row.v) : 0;
}

module.exports = { runMigrations, currentVersion };
