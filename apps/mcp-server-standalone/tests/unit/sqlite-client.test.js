'use strict';

const path = require('node:path');

const { describe, it, beforeAll, afterAll, assert, run } = require(
  path.resolve(__dirname, '../framework.js')
);
const { makeDb } = require(
  path.resolve(__dirname, '../helpers.js')
);

describe('sqlite-client statement cache', () => {
  let close;
  let sqliteClient;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    sqliteClient = require(path.resolve(__dirname, '../../services/sqlite-client.js'));
  });

  afterAll(() => close());

  it('reuses a prepared statement for repeated identical SQL', () => {
    const db = sqliteClient.getDb();
    const originalPrepare = db.prepare.bind(db);
    let prepareCount = 0;

    db.prepare = (sql) => {
      prepareCount++;
      return originalPrepare(sql);
    };

    try {
      sqliteClient.query('SELECT COUNT(*) AS count FROM nodes');
      sqliteClient.query('SELECT COUNT(*) AS count FROM nodes');
      sqliteClient.query('SELECT COUNT(*) AS count FROM nodes');
    } finally {
      db.prepare = originalPrepare;
    }

    assert.strictEqual(prepareCount, 1);
  });
});

describe('sqlite-client shutdown maintenance', () => {
  let close;
  let sqliteClient;

  beforeAll(() => {
    const ctx = makeDb();
    close = ctx.close;
    sqliteClient = require(path.resolve(__dirname, '../../services/sqlite-client.js'));
  });

  afterAll(() => close());

  it('runs WAL truncation and optimize before closing the database', () => {
    const db = sqliteClient.getDb();
    const originalPragma = db.pragma.bind(db);
    const seenPragmas = [];

    db.pragma = (sql, options) => {
      seenPragmas.push(sql);
      return originalPragma(sql, options);
    };

    sqliteClient.closeDatabase();

    assert.ok(seenPragmas.includes('wal_checkpoint(TRUNCATE)'));
    assert.ok(seenPragmas.includes('optimize'));
  });
});

run('Ra-h — sqlite-client').then(process.exit);
