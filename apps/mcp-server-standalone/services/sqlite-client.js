'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runMigrations } = require('../migrations/runner');

/**
 * Get the database file path.
 * Priority: RAH_DB_PATH env var > default macOS app-data location.
 *
 * @returns {string}
 */
function getDatabasePath() {
  if (process.env.RAH_DB_PATH) {
    return process.env.RAH_DB_PATH;
  }

  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'RA-H',
    'db',
    'rah.sqlite'
  );
}

/** @type {import('better-sqlite3').Database | null} */
let db = null;
/** @type {Map<string, import('better-sqlite3').Statement>} */
let stmtCache = new Map();
/** @type {NodeJS.Timeout | null} */
let maintenanceTimer = null;
let lastOptimizeAt = 0;

const MAX_CACHED_STATEMENTS = 100;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const OPTIMIZE_INTERVAL_MS = 60 * 60 * 1000;

function clearStatementCache() {
  stmtCache.clear();
}

/**
 * Return a cached prepared statement or prepare and cache it.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} sql
 * @returns {import('better-sqlite3').Statement}
 */
function getCachedStatement(database, sql) {
  const cached = stmtCache.get(sql);
  if (cached) {
    stmtCache.delete(sql);
    stmtCache.set(sql, cached);
    return cached;
  }

  const stmt = database.prepare(sql);
  stmtCache.set(sql, stmt);
  if (stmtCache.size > MAX_CACHED_STATEMENTS) {
    const oldestKey = stmtCache.keys().next().value;
    if (oldestKey) {
      stmtCache.delete(oldestKey);
    }
  }
  return stmt;
}

function clearMaintenanceTimer() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

/**
 * Run lightweight SQLite maintenance to bound WAL growth and refresh planner stats.
 *
 * @param {{ checkpointMode?: 'PASSIVE' | 'TRUNCATE'; forceOptimize?: boolean }} [options]
 */
function runMaintenance(options = {}) {
  if (!db) return;

  const { checkpointMode = 'PASSIVE', forceOptimize = false } = options;

  try {
    db.pragma(`wal_checkpoint(${checkpointMode})`);
  } catch (error) {
    console.error(`[RA-H] Warning: WAL checkpoint (${checkpointMode}) failed:`, error.message);
  }

  const now = Date.now();
  if (!forceOptimize && now - lastOptimizeAt < OPTIMIZE_INTERVAL_MS) {
    return;
  }

  try {
    db.pragma('optimize');
    lastOptimizeAt = now;
  } catch (error) {
    console.error('[RA-H] Warning: PRAGMA optimize failed:', error.message);
  }
}

function scheduleMaintenance() {
  if (maintenanceTimer) return;

  maintenanceTimer = setInterval(() => {
    runMaintenance();
  }, MAINTENANCE_INTERVAL_MS);

  if (typeof maintenanceTimer.unref === 'function') {
    maintenanceTimer.unref();
  }
}

/**
 * Initialize the database connection and run all pending migrations.
 * Idempotent — safe to call multiple times; only runs once per process.
 *
 * @returns {import('better-sqlite3').Database}
 */
function initDatabase() {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();

  // Ensure parent directory exists for brand-new databases
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    console.error('[RA-H] Creating new database at:', dbPath);
  }

  db = new Database(dbPath);

  // Performance pragmas — applied before migrations so they take effect
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 5000');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Apply all pending migrations
  const applied = runMigrations(db);
  if (applied > 0) {
    console.error(`[RA-H] Applied ${applied} migration(s) successfully.`);
  }

  lastOptimizeAt = Date.now();
  scheduleMaintenance();

  console.error('[RA-H] Database ready:', dbPath);
  return db;
}

/**
 * Return the current database instance.
 * Throws if initDatabase() has not been called.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Execute a SQL statement and return results.
 * SELECT/WITH/PRAGMA/RETURNING → array of rows.
 * Everything else → { changes, lastInsertRowid }.
 *
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Record<string, unknown>[] | { changes: number; lastInsertRowid: number }}
 */
function query(sql, params = []) {
  const database = getDb();
  const stmt = getCachedStatement(database, sql);

  const sqlLower = sql.trim().toLowerCase();
  const isSelect =
    sqlLower.startsWith('select') ||
    sqlLower.startsWith('with') ||
    sqlLower.startsWith('pragma') ||
    sqlLower.includes('returning');

  if (isSelect) {
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  }

  const result = params.length > 0 ? stmt.run(...params) : stmt.run();
  return {
    changes: result.changes,
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

/**
 * Execute a callback inside a SQLite transaction.
 * Rolls back automatically if the callback throws.
 *
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function transaction(callback) {
  const database = getDb();
  return database.transaction(callback)();
}

/**
 * Close the database connection.
 * After calling this, initDatabase() must be called again to re-open.
 */
function closeDatabase() {
  if (db) {
    clearMaintenanceTimer();
    try {
      runMaintenance({ checkpointMode: 'TRUNCATE', forceOptimize: true });
    } finally {
      clearStatementCache();
      db.close();
      db = null;
    }
  }
}

module.exports = {
  initDatabase,
  getDb,
  query,
  transaction,
  closeDatabase,
  getDatabasePath,
};
