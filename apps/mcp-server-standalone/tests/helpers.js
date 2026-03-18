'use strict';

/**
 * Test helpers for Ra-h test suite.
 *
 * Provides per-test isolated SQLite databases so tests never share state.
 * Each call to makeDb() creates a fresh in-memory database with all
 * migrations applied.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Create a fresh, isolated SQLite database for a test.
 * Applies all migrations. Returns the raw db instance and a close() function.
 *
 * Uses a unique temp file per call so parallel tests don't collide.
 * The file is removed on close().
 *
 * @returns {{ db: import('better-sqlite3').Database, dbPath: string, close: () => void }}
 */
function makeDb() {
  const id = crypto.randomBytes(6).toString('hex');
  const dbPath = path.join(os.tmpdir(), `utu_test_${id}.sqlite`);

  // Set env var BEFORE requiring sqlite-client so getDatabasePath() picks it up.
  // We reset module registry to get a fresh singleton for each call.
  process.env.RAH_DB_PATH = dbPath;

  // Clear cached module instances so each makeDb() gets a fresh singleton
  clearModuleCache();

  const { initDatabase, closeDatabase, getDb } = require('../services/sqlite-client');
  initDatabase();

  function close() {
    try {
      closeDatabase();
    } catch (_) {}
    try {
      fs.unlinkSync(dbPath);
    } catch (_) {}
    clearModuleCache();
    delete process.env.RAH_DB_PATH;
  }

  return { db: getDb(), dbPath, close };
}

/**
 * Evict all Ra-h service and migration modules from Node's module cache
 * so the next require() gets a fresh singleton.
 */
function clearModuleCache() {
  const baseDir = path.resolve(__dirname, '..');
  const keys = Object.keys(require.cache).filter((k) =>
    k.startsWith(baseDir) && (
      k.includes('/services/') ||
      k.includes('/migrations/')
    )
  );
  for (const key of keys) {
    delete require.cache[key];
  }
}

/**
 * Build a minimal valid node payload for createNode().
 *
 * @param {Partial<object>} overrides
 * @returns {object}
 */
function nodeFixture(overrides = {}) {
  return {
    title: 'Test Node',
    description: 'Test node — fixture for unit test validation and correctness verification.',
    dimensions: ['projects'],
    status: 'draft',
    confidence: 'medium',
    created_via: 'llm_auto',
    ...overrides,
  };
}

/**
 * Seed N nodes into nodeService for bulk tests.
 * Returns array of created nodes.
 *
 * @param {object} nodeService
 * @param {number} count
 * @param {object} [overrides]
 * @returns {object[]}
 */
function seedNodes(nodeService, count, overrides = {}) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push(nodeService.createNode(nodeFixture({
      title: `Node ${i + 1}`,
      description: `Fixture node ${i + 1} — seeded for bulk test coverage and validation.`,
      ...overrides,
    })));
  }
  return nodes;
}

module.exports = { makeDb, clearModuleCache, nodeFixture, seedNodes };
