'use strict';

const { describe, it, beforeAll, afterAll, assert, run } = require('../framework');
const { makeDb, nodeFixture } = require('../helpers');

// ---------------------------------------------------------------------------
// session-service.test.js
// Unit tests for sessionService
//
// IMPORTANT: makeDb() calls clearModuleCache(), which resets the module-level
// _currentSessionId singleton inside sessionService. Every describe block that
// calls makeDb() in beforeAll therefore starts with a fresh singleton.
// Tests that need the singleton to persist across multiple calls must NOT call
// makeDb() between those calls.
// ---------------------------------------------------------------------------

describe('startSession', () => {
  let ctx;
  let sessionService;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');
  });

  afterAll(() => ctx.close());

  it('inserts a session record with started_at', () => {
    const id = sessionService.startSession();

    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    assert.ok(row, 'session row must exist in database');
    assert.ok(row.started_at, 'started_at must be set');
    assert.strictEqual(row.ended_at, null, 'ended_at must be null initially');
    assert.strictEqual(row.summary, null, 'summary must be null initially');
  });

  it('returns a UUID-format string', () => {
    const id = sessionService.startSession();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(id, uuidRe, `"${id}" is not a valid UUID`);
  });
});

describe('getCurrentSessionId — singleton behaviour', () => {
  let ctx;
  let sessionService;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');
  });

  afterAll(() => ctx.close());

  it('returns the same ID on consecutive calls within the same process context', () => {
    const id1 = sessionService.getCurrentSessionId();
    const id2 = sessionService.getCurrentSessionId();
    const id3 = sessionService.getCurrentSessionId();

    assert.ok(id1, 'first call must return a non-empty string');
    assert.equal(id1, id2, 'second call must return the same ID');
    assert.equal(id1, id3, 'third call must return the same ID');
  });

  it('calls startSession lazily if not yet started', () => {
    // After makeDb() the singleton is null. Calling getCurrentSessionId() must
    // initialise it and return a UUID, and the row must exist in the DB.
    const id = sessionService.getCurrentSessionId();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(id, uuidRe, 'lazy-initialised id must be a UUID');

    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    assert.ok(row, 'session row must be created by lazy startSession()');
  });
});

describe('endCurrentSession', () => {
  let ctx;
  let sessionService;
  let sessionId;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');
    sessionId = sessionService.startSession();
  });

  afterAll(() => ctx.close());

  it('sets ended_at on the current session record', () => {
    const before = new Date().toISOString();
    sessionService.endCurrentSession();
    const after = new Date().toISOString();

    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    assert.ok(row.ended_at, 'ended_at must be set after endCurrentSession()');

    // ended_at should be within the before/after window
    assert.ok(row.ended_at >= before, 'ended_at must not be before the call');
    assert.ok(row.ended_at <= after,  'ended_at must not be after the call');
  });

  it('stores a summary text when provided', () => {
    // Start a new session for this assertion so ended_at is null again
    const newId = sessionService.startSession();
    const summary = 'Discussed project milestone planning and dependency graph.';
    sessionService.endCurrentSession(summary);

    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(newId);
    assert.equal(row.summary, summary, 'summary column must match provided text');
    assert.ok(row.ended_at, 'ended_at must also be set');
  });
});

describe('updateSessionSummary', () => {
  let ctx;
  let sessionService;
  let sessionId;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');
    sessionId = sessionService.startSession();
  });

  afterAll(() => ctx.close());

  it('updates the summary of a given session record', () => {
    const newSummary = 'Updated summary text from test.';
    sessionService.updateSessionSummary(sessionId, newSummary);

    const row = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    assert.equal(row.summary, newSummary, 'summary must match the updated value');
  });
});

describe('getRecentSessions', () => {
  let ctx;
  let sessionService;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');

    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      sessionService.startSession();
    }
  });

  afterAll(() => ctx.close());

  it('returns sessions ordered by started_at DESC', () => {
    const sessions = sessionService.getRecentSessions(10);
    assert.ok(sessions.length >= 5, 'must return at least 5 sessions');

    for (let i = 1; i < sessions.length; i++) {
      const prev = new Date(sessions[i - 1].started_at).getTime();
      const curr = new Date(sessions[i].started_at).getTime();
      assert.ok(
        prev >= curr,
        `sessions must be DESC: index ${i - 1} (${sessions[i - 1].started_at}) >= index ${i} (${sessions[i].started_at})`
      );
    }
  });
});

describe('getSessionById', () => {
  let ctx;
  let sessionService;
  let knownId;

  beforeAll(() => {
    ctx = makeDb();
    sessionService = require('../../services/sessionService');
    knownId = sessionService.startSession();
  });

  afterAll(() => ctx.close());

  it('returns the correct session for a known ID', () => {
    const session = sessionService.getSessionById(knownId);
    assert.ok(session, 'must return a session object');
    assert.equal(session.id, knownId, 'returned session.id must match requested ID');
    assert.ok(session.started_at, 'started_at must be present');
  });

  it('returns null for an unknown / missing ID', () => {
    const result = sessionService.getSessionById('non-existent-uuid-zzz');
    assert.strictEqual(result, null, 'must return null for unknown ID');
  });
});

run('Ra-h — SessionService').then(process.exit);
