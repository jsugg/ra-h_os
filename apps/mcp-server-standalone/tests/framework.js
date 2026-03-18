'use strict';

/**
 * Ra-h Test Framework
 *
 * Minimal, zero-dependency test runner for CommonJS modules.
 * Designed for the Ra-h MCP server test suite.
 *
 * Features:
 *   - describe/it-style API
 *   - Before/after hooks (beforeAll, afterAll, beforeEach, afterEach)
 *   - Async support
 *   - Clear, colour-coded output
 *   - Exit code 1 on any failure
 *   - Per-test timing
 *   - Summary table at the end
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

// ANSI colour codes
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
};

const PASS = `${C.green}✓${C.reset}`;
const FAIL = `${C.red}✗${C.reset}`;
const SKIP = `${C.yellow}○${C.reset}`;

/** @type {Suite[]} */
const _suites = [];
let _currentSuite = null;

class Suite {
  constructor(name) {
    this.name = name;
    /** @type {TestCase[]} */
    this.tests = [];
    this._beforeAll = [];
    this._afterAll = [];
    this._beforeEach = [];
    this._afterEach = [];
  }
}

class TestCase {
  constructor(name, fn, skip = false) {
    this.name = name;
    this.fn = fn;
    this.skip = skip;
    this.passed = false;
    this.error = null;
    this.durationMs = 0;
  }
}

/**
 * Define a test suite.
 *
 * @param {string} name
 * @param {() => void} fn
 */
function describe(name, fn) {
  const suite = new Suite(name);
  const prev = _currentSuite;
  _currentSuite = suite;
  _suites.push(suite);
  fn();
  _currentSuite = prev;
}

/**
 * Define a test case.
 *
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function it(name, fn) {
  if (!_currentSuite) throw new Error('it() called outside describe()');
  _currentSuite.tests.push(new TestCase(name, fn, false));
}

it.skip = function (name, _fn) {
  if (!_currentSuite) throw new Error('it.skip() called outside describe()');
  _currentSuite.tests.push(new TestCase(name, null, true));
};

/**
 * @param {() => void | Promise<void>} fn
 */
function beforeAll(fn)  { if (_currentSuite) _currentSuite._beforeAll.push(fn); }
function afterAll(fn)   { if (_currentSuite) _currentSuite._afterAll.push(fn); }
function beforeEach(fn) { if (_currentSuite) _currentSuite._beforeEach.push(fn); }
function afterEach(fn)  { if (_currentSuite) _currentSuite._afterEach.push(fn); }

/**
 * Run all registered suites and print results.
 * Returns exit code (0 = all pass, 1 = failures).
 *
 * @param {string} [suiteName]  Optional label for the file header
 * @returns {Promise<number>}
 */
async function run(suiteName) {
  const header = suiteName ? `\n${C.bold}${C.cyan}${suiteName}${C.reset}\n` : '';
  process.stdout.write(header);

  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  const startAll = performance.now();

  for (const suite of _suites) {
    process.stdout.write(`\n  ${C.bold}${suite.name}${C.reset}\n`);

    // beforeAll
    for (const hook of suite._beforeAll) {
      try { await hook(); } catch (e) {
        process.stdout.write(`  ${C.red}  beforeAll failed: ${e.message}${C.reset}\n`);
      }
    }

    for (const test of suite.tests) {
      if (test.skip) {
        process.stdout.write(`    ${SKIP} ${C.grey}${test.name}${C.reset}\n`);
        totalSkip++;
        continue;
      }

      // beforeEach
      for (const hook of suite._beforeEach) {
        try { await hook(); } catch (_) {}
      }

      const t0 = performance.now();
      try {
        await test.fn();
        test.durationMs = performance.now() - t0;
        test.passed = true;
        totalPass++;
        const ms = test.durationMs < 1 ? `${C.grey}${test.durationMs.toFixed(2)}ms${C.reset}` : `${C.dim}${test.durationMs.toFixed(0)}ms${C.reset}`;
        process.stdout.write(`    ${PASS} ${test.name} ${ms}\n`);
      } catch (e) {
        test.durationMs = performance.now() - t0;
        test.passed = false;
        test.error = e;
        totalFail++;
        process.stdout.write(`    ${FAIL} ${C.red}${test.name}${C.reset}\n`);
        const errMsg = e.message || String(e);
        const errStack = (e.stack || '').split('\n').slice(1, 4).join('\n');
        process.stdout.write(`        ${C.red}${errMsg}${C.reset}\n`);
        if (errStack) process.stdout.write(`        ${C.grey}${errStack.trim()}${C.reset}\n`);
      }

      // afterEach
      for (const hook of suite._afterEach) {
        try { await hook(); } catch (_) {}
      }
    }

    // afterAll
    for (const hook of suite._afterAll) {
      try { await hook(); } catch (e) {
        process.stdout.write(`  ${C.red}  afterAll failed: ${e.message}${C.reset}\n`);
      }
    }
  }

  const totalMs = performance.now() - startAll;
  const total = totalPass + totalFail + totalSkip;

  process.stdout.write('\n');
  process.stdout.write(`${'─'.repeat(60)}\n`);

  const passStr  = totalPass  > 0 ? `${C.green}${totalPass} passed${C.reset}` : `0 passed`;
  const failStr  = totalFail  > 0 ? `${C.red}${totalFail} failed${C.reset}` : `0 failed`;
  const skipStr  = totalSkip  > 0 ? `${C.yellow}${totalSkip} skipped${C.reset}` : '';
  const parts = [passStr, failStr, skipStr].filter(Boolean);

  process.stdout.write(`${parts.join('  ')}  ${C.grey}(${total} total, ${totalMs.toFixed(0)}ms)${C.reset}\n`);
  process.stdout.write(`${'─'.repeat(60)}\n`);

  return totalFail > 0 ? 1 : 0;
}

module.exports = { describe, it, beforeAll, afterAll, beforeEach, afterEach, run, assert };
