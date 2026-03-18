#!/usr/bin/env node
'use strict';

/**
 * run-benchmarks.js
 *
 * Ra-h MCP Server — Benchmark Runner
 *
 * Usage:
 *   node tests/run-benchmarks.js
 *   node tests/run-benchmarks.js --filter migration
 *
 * Loads every *.bench.js file from tests/benchmarks/, runs each scenario
 * using the prepare / bench / teardown contract, collects per-iteration
 * timings, and prints a formatted results table followed by a summary.
 *
 * Contract for each scenario exported from a bench file:
 * {
 *   name: string,
 *   warmup: number,       // unmetered warm-up iterations
 *   iterations: number,   // metered iterations
 *   prepare: async () => ctx,          // called once; returns context
 *   bench: async (ctx) => void,        // called warmup+iterations times
 *   teardown: async (ctx) => void,     // optional cleanup
 * }
 */

const path = require('node:path');
const fs   = require('node:fs');
const { performance } = require('node:perf_hooks');

// ---------------------------------------------------------------------------
// ANSI colours
// ---------------------------------------------------------------------------
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  grey:    '\x1b[90m',
  bgRed:   '\x1b[41m',
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics from an array of millisecond samples.
 *
 * @param {number[]} samples
 * @returns {{ min: number, max: number, mean: number, p50: number, p95: number, p99: number, opsPerSec: number }}
 */
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const p50  = sorted[Math.floor(n * 0.50)];
  const p95  = sorted[Math.floor(n * 0.95)];
  const p99  = sorted[Math.floor(n * 0.99)];
  return {
    min:      sorted[0],
    max:      sorted[n - 1],
    mean,
    p50,
    p95,
    p99,
    opsPerSec: mean > 0 ? Math.round(1000 / mean) : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a millisecond value to a readable string.
 * Sub-millisecond values show 3 decimal places; >= 1000ms shows in seconds.
 *
 * @param {number} ms
 * @returns {string}
 */
function fmtMs(ms) {
  if (ms < 0.001) return '< 0.001ms';
  if (ms < 1)     return `${ms.toFixed(3)}ms`;
  if (ms < 1000)  return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format ops/sec with thousands separator.
 *
 * @param {number} ops
 * @returns {string}
 */
function fmtOps(ops) {
  if (!isFinite(ops)) return '∞';
  return ops.toLocaleString('en-US');
}

/**
 * Left-pad a string to a fixed width (truncating if longer).
 *
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
function pad(s, width) {
  // Strip ANSI escape codes for length calculation
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= width) return s;
  return s + ' '.repeat(width - visible.length);
}

/**
 * Right-align a string within a fixed width.
 *
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
function rpad(s, width) {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= width) return s;
  return ' '.repeat(width - visible.length) + s;
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

/**
 * Print a horizontal separator line.
 *
 * @param {number[]} colWidths
 * @param {string}   [colour]
 */
function printSeparator(colWidths, colour = C.grey) {
  const line = colWidths.map((w) => '─'.repeat(w + 2)).join('┼');
  process.stdout.write(`${colour}├${line}┤${C.reset}\n`);
}

/**
 * Print a table row.
 *
 * @param {string[]} cells
 * @param {number[]} colWidths
 * @param {boolean[]} [rightAlign]  Per-column right-align flags
 */
function printRow(cells, colWidths, rightAlign = []) {
  const parts = cells.map((cell, i) => {
    const w = colWidths[i];
    return rightAlign[i] ? rpad(cell, w) : pad(cell, w);
  });
  process.stdout.write(`│ ${parts.join(' │ ')} │\n`);
}

// ---------------------------------------------------------------------------
// Slow benchmark threshold (ms mean)
// ---------------------------------------------------------------------------
const SLOW_THRESHOLD_MS = 500; // warn if mean iteration time > 500ms

// ---------------------------------------------------------------------------
// Discovery: load all bench files
// ---------------------------------------------------------------------------

const BENCH_DIR = path.resolve(__dirname, 'benchmarks');

/**
 * Discover and load all *.bench.js files from the benchmarks directory.
 * Each file exports an array of scenario objects.
 *
 * @param {string} [filter]  Optional substring filter on scenario name or file name
 * @returns {{ file: string, scenarios: object[] }[]}
 */
function loadBenchFiles(filter) {
  const files = fs.readdirSync(BENCH_DIR)
    .filter((f) => f.endsWith('.bench.js'))
    .sort()
    .map((f) => path.join(BENCH_DIR, f));

  const loaded = [];
  for (const filePath of files) {
    let scenarios;
    try {
      scenarios = require(filePath);
    } catch (err) {
      process.stderr.write(`${C.red}[LOAD ERROR] ${filePath}: ${err.message}${C.reset}\n`);
      continue;
    }

    if (!Array.isArray(scenarios)) {
      process.stderr.write(`${C.yellow}[WARN] ${filePath} does not export an array — skipping.${C.reset}\n`);
      continue;
    }

    const filtered = filter
      ? scenarios.filter(
          (s) =>
            s.name.toLowerCase().includes(filter.toLowerCase()) ||
            path.basename(filePath).toLowerCase().includes(filter.toLowerCase())
        )
      : scenarios;

    if (filtered.length > 0) {
      loaded.push({ file: path.basename(filePath), scenarios: filtered });
    }
  }

  return loaded;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

/**
 * Run a single scenario and return its stats.
 *
 * @param {object} scenario
 * @returns {Promise<{ name: string, samples: number[], s: object, error?: string }>}
 */
async function runScenario(scenario) {
  const { name, warmup = 5, iterations = 50 } = scenario;
  const benchFn    = scenario.bench;
  const prepareFn  = scenario.prepare  || (async () => ({}));
  const teardownFn = scenario.teardown || (async () => {});

  process.stdout.write(
    `  ${C.cyan}>${C.reset} ${pad(name, 50)} ` +
    `${C.grey}warmup:${warmup} iters:${iterations}${C.reset}\n`
  );

  let ctx;
  try {
    ctx = await prepareFn();
  } catch (err) {
    process.stdout.write(`    ${C.red}prepare() failed: ${err.message}${C.reset}\n`);
    return { name, samples: [], s: null, error: err.message };
  }

  // ── Warm-up (unmetered) ────────────────────────────────────────────────
  for (let i = 0; i < warmup; i++) {
    try {
      await benchFn(ctx);
    } catch (err) {
      process.stdout.write(`    ${C.yellow}warm-up error (iter ${i}): ${err.message}${C.reset}\n`);
    }
  }

  // ── Measured iterations ────────────────────────────────────────────────
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      await benchFn(ctx);
    } catch (err) {
      process.stdout.write(`    ${C.red}bench error (iter ${i}): ${err.message}${C.reset}\n`);
      // Continue collecting — partial results are still useful
    }
    samples.push(performance.now() - t0);
  }

  // ── Teardown ───────────────────────────────────────────────────────────
  try {
    await teardownFn(ctx);
  } catch (err) {
    process.stdout.write(`    ${C.yellow}teardown() error: ${err.message}${C.reset}\n`);
  }

  const s = stats(samples);
  return { name, samples, s };
}

// ---------------------------------------------------------------------------
// Results printing
// ---------------------------------------------------------------------------

const COL_WIDTHS = [48, 10, 10, 10, 10, 10, 10, 12];
const HEADERS    = ['Scenario', 'min', 'mean', 'p50', 'p95', 'p99', 'max', 'ops/sec'];
const RIGHT_ALIGN = [false, true, true, true, true, true, true, true];

/**
 * Print the full results table for a benchmark file.
 *
 * @param {string} fileName
 * @param {{ name: string, s: object, error?: string }[]} results
 */
function printResultsTable(fileName, results) {
  process.stdout.write(`\n${C.bold}${C.blue}${'━'.repeat(120)}${C.reset}\n`);
  process.stdout.write(`${C.bold}${C.blue}  ${fileName}${C.reset}\n`);
  process.stdout.write(`${C.bold}${C.blue}${'━'.repeat(120)}${C.reset}\n`);

  // Header row
  const headerCells = HEADERS.map((h, i) =>
    i === 0 ? `${C.bold}${C.white}${h}${C.reset}` : `${C.bold}${C.cyan}${h}${C.reset}`
  );
  printRow(headerCells, COL_WIDTHS, RIGHT_ALIGN);
  printSeparator(COL_WIDTHS, C.grey);

  for (const r of results) {
    if (r.error || !r.s) {
      const errCell = `${C.red}ERROR: ${r.error || 'unknown'}${C.reset}`;
      printRow([r.name, errCell, '', '', '', '', '', ''], COL_WIDTHS, RIGHT_ALIGN);
      continue;
    }

    const { s } = r;
    const isSlow = s.mean > SLOW_THRESHOLD_MS;

    const nameCell = isSlow
      ? `${C.yellow}${r.name}${C.reset}`
      : r.name;

    const meanCell = isSlow
      ? `${C.yellow}${fmtMs(s.mean)}${C.reset}`
      : `${C.green}${fmtMs(s.mean)}${C.reset}`;

    printRow(
      [
        nameCell,
        fmtMs(s.min),
        meanCell,
        fmtMs(s.p50),
        fmtMs(s.p95),
        fmtMs(s.p99),
        fmtMs(s.max),
        fmtOps(s.opsPerSec),
      ],
      COL_WIDTHS,
      RIGHT_ALIGN
    );
  }

  process.stdout.write(`${C.grey}${'─'.repeat(120)}${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

/**
 * Print a final summary table of all benchmark results.
 *
 * @param {{ file: string, name: string, s: object, error?: string }[]} allResults
 */
function printSummary(allResults) {
  process.stdout.write(`\n${C.bold}${C.magenta}${'═'.repeat(120)}${C.reset}\n`);
  process.stdout.write(`${C.bold}${C.magenta}  BENCHMARK SUMMARY${C.reset}\n`);
  process.stdout.write(`${C.bold}${C.magenta}${'═'.repeat(120)}${C.reset}\n`);

  const sumWidths = [52, 16, 10, 10, 10, 12];
  const sumHeaders = ['Scenario', 'File', 'mean', 'p95', 'p99', 'ops/sec'];
  const sumRight   = [false, false, true, true, true, true];

  const headerCells = sumHeaders.map((h) => `${C.bold}${C.white}${h}${C.reset}`);
  printRow(headerCells, sumWidths, sumRight);
  printSeparator(sumWidths, C.grey);

  for (const r of allResults) {
    if (r.error || !r.s) {
      printRow(
        [`${C.red}${r.name}${C.reset}`, r.file, 'ERROR', '', '', ''],
        sumWidths,
        sumRight
      );
      continue;
    }

    const { s } = r;
    const isSlow = s.mean > SLOW_THRESHOLD_MS;
    const nameCell = isSlow ? `${C.yellow}${r.name}${C.reset}` : r.name;
    const meanCell = isSlow ? `${C.yellow}${fmtMs(s.mean)}${C.reset}` : `${C.green}${fmtMs(s.mean)}${C.reset}`;

    printRow(
      [nameCell, r.file, meanCell, fmtMs(s.p95), fmtMs(s.p99), fmtOps(s.opsPerSec)],
      sumWidths,
      sumRight
    );
  }

  process.stdout.write(`${C.grey}${'─'.repeat(120)}${C.reset}\n`);

  // Slow benchmark callouts
  const slow = allResults.filter((r) => r.s && r.s.mean > SLOW_THRESHOLD_MS);
  if (slow.length > 0) {
    process.stdout.write(`\n${C.yellow}${C.bold}Slow benchmarks (mean > ${SLOW_THRESHOLD_MS}ms):${C.reset}\n`);
    for (const r of slow) {
      process.stdout.write(
        `  ${C.yellow}!${C.reset} ${r.name} — mean ${fmtMs(r.s.mean)}, p99 ${fmtMs(r.s.p99)}\n`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse optional --filter flag
  const filterIdx = process.argv.indexOf('--filter');
  const filter    = filterIdx !== -1 ? process.argv[filterIdx + 1] : undefined;

  process.stdout.write(`\n${C.bold}${C.cyan}Ra-h MCP Server — Benchmark Suite${C.reset}\n`);
  if (filter) {
    process.stdout.write(`${C.grey}Filter: "${filter}"${C.reset}\n`);
  }
  process.stdout.write(`${C.grey}Bench dir: ${BENCH_DIR}${C.reset}\n\n`);

  const benchFiles = loadBenchFiles(filter);

  if (benchFiles.length === 0) {
    process.stdout.write(`${C.red}No benchmark files found.${C.reset}\n`);
    process.exit(1);
  }

  /** @type {{ file: string, name: string, s: object|null, error?: string }[]} */
  const allResults = [];
  const globalStart = performance.now();

  for (const { file, scenarios } of benchFiles) {
    process.stdout.write(`\n${C.bold}Running: ${file}${C.reset}\n`);

    const fileResults = [];

    for (const scenario of scenarios) {
      const result = await runScenario(scenario);
      fileResults.push(result);
      allResults.push({ file, ...result });
    }

    printResultsTable(file, fileResults);
  }

  printSummary(allResults);

  const totalMs = performance.now() - globalStart;
  process.stdout.write(
    `\n${C.grey}Total wall time: ${(totalMs / 1000).toFixed(2)}s across ` +
    `${allResults.length} scenario(s)${C.reset}\n\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${C.red}Fatal: ${err.stack || err.message}${C.reset}\n`);
  process.exit(1);
});
