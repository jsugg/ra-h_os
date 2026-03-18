#!/usr/bin/env node
'use strict';

/**
 * Ra-h — Test Suite Orchestrator
 *
 * Runs all unit and integration test files sequentially in a clean subprocess
 * per file. Collects pass/fail/skip counts, prints a final summary table,
 * and exits with code 1 if any file has failures.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const NODE = process.execPath;

// ANSI
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

const SUITES = [
  { label: 'unit', dir: path.join(__dirname, 'unit') },
  { label: 'integration', dir: path.join(__dirname, 'integration') },
];

const filter = process.argv[2] ? process.argv[2].toLowerCase() : null;

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join(dir, f));
}

function parseOutput(output) {
  // Parse the summary line from framework.js output:
  // "N passed  N failed  N skipped  (N total, Nms)"
  const passMatch  = output.match(/(\d+) passed/);
  const failMatch  = output.match(/(\d+) failed/);
  const skipMatch  = output.match(/(\d+) skipped/);
  const timeMatch  = output.match(/(\d+(?:\.\d+)?)ms\)/);
  return {
    pass:  passMatch  ? parseInt(passMatch[1],  10) : 0,
    fail:  failMatch  ? parseInt(failMatch[1],  10) : 0,
    skip:  skipMatch  ? parseInt(skipMatch[1],  10) : 0,
    ms:    timeMatch  ? parseFloat(timeMatch[1])    : 0,
  };
}

async function main() {
  const banner = `
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗
║              Ra-h — Test Suite                           ║
╚══════════════════════════════════════════════════════════╝${C.reset}
`;
  process.stdout.write(banner);

  const results = [];
  let anyFail = false;
  const t0 = performance.now();

  for (const suite of SUITES) {
    const files = collectFiles(suite.dir);
    if (files.length === 0) continue;

    process.stdout.write(`\n${C.bold}${C.yellow}── ${suite.label.toUpperCase()} ──────────────────────────────────────${C.reset}\n`);

    for (const file of files) {
      const name = path.basename(file, '.test.js');
      if (filter && !name.toLowerCase().includes(filter)) continue;

      const label = `  ${suite.label}/${name}`;
      process.stdout.write(`\n${C.bold}${label}${C.reset}\n`);

      const tFile = performance.now();
      const result = spawnSync(NODE, [file], {
        stdio: 'pipe',
        encoding: 'utf-8',
        env: { ...process.env },
      });

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      const combined = stdout + (stderr ? `\n${C.grey}[stderr] ${stderr}${C.reset}` : '');

      // Print test output (trimmed framework lines)
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) process.stdout.write(`${line}\n`);
      }

      const stats = parseOutput(stdout);
      const fileDuration = performance.now() - tFile;

      const status = (result.status !== 0 || stats.fail > 0)
        ? `${C.red}FAIL${C.reset}`
        : `${C.green}PASS${C.reset}`;

      if (result.status !== 0 && stats.pass === 0 && stats.fail === 0) {
        // Process crashed without output
        process.stdout.write(`  ${C.red}Process exited with code ${result.status}${C.reset}\n`);
        if (stderr.trim()) process.stdout.write(`  ${C.grey}${stderr.trim()}${C.reset}\n`);
        results.push({ label: name, suite: suite.label, pass: 0, fail: 1, skip: 0, ms: fileDuration, status: 'CRASH' });
        anyFail = true;
      } else {
        results.push({ label: name, suite: suite.label, ...stats, ms: fileDuration, status: result.status === 0 && stats.fail === 0 ? 'PASS' : 'FAIL' });
        if (result.status !== 0 || stats.fail > 0) anyFail = true;
      }
    }
  }

  const totalMs = performance.now() - t0;

  // Final summary table
  const totPass  = results.reduce((s, r) => s + r.pass, 0);
  const totFail  = results.reduce((s, r) => s + r.fail, 0);
  const totSkip  = results.reduce((s, r) => s + r.skip, 0);
  const totTests = totPass + totFail + totSkip;

  process.stdout.write(`\n\n${'═'.repeat(66)}\n`);
  process.stdout.write(`${C.bold}  SUMMARY${C.reset}\n`);
  process.stdout.write(`${'─'.repeat(66)}\n`);

  const COL_W = 32;
  const header = `  ${'File'.padEnd(COL_W)} ${'Pass'.padEnd(6)} ${'Fail'.padEnd(6)} ${'Skip'.padEnd(6)} ${'Time'.padEnd(8)} Status`;
  process.stdout.write(`${C.bold}${C.grey}${header}${C.reset}\n`);
  process.stdout.write(`${'─'.repeat(66)}\n`);

  for (const r of results) {
    const fileLabel = `${r.suite}/${r.label}`.padEnd(COL_W);
    const passStr = String(r.pass).padEnd(6);
    const failStr = (r.fail > 0 ? `${C.red}${r.fail}${C.reset}` : '0').padEnd(r.fail > 0 ? 6 + 9 : 6);
    const skipStr = String(r.skip).padEnd(6);
    const timeStr = `${r.ms.toFixed(0)}ms`.padEnd(8);
    const statusStr = r.status === 'PASS' ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
    process.stdout.write(`  ${fileLabel} ${passStr} ${failStr} ${skipStr} ${timeStr} ${statusStr}\n`);
  }

  process.stdout.write(`${'─'.repeat(66)}\n`);

  const passLine  = totPass > 0  ? `${C.green}${totPass} passed${C.reset}` : '0 passed';
  const failLine  = totFail > 0  ? `${C.red}${totFail} failed${C.reset}`   : '0 failed';
  const skipLine  = totSkip > 0  ? `${C.yellow}${totSkip} skipped${C.reset}` : '';
  const parts     = [passLine, failLine, skipLine].filter(Boolean);

  process.stdout.write(`\n  ${parts.join('   ')}   ${C.grey}${totTests} total · ${totalMs.toFixed(0)}ms${C.reset}\n`);
  process.stdout.write(`${'═'.repeat(66)}\n\n`);

  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
