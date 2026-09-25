#!/usr/bin/env node
// Runs every test/*.test.js and reports them all.
//
// This replaces a long `&&` chain in package.json, which had two faults. The
// first bit hard: one failing suite stopped the chain, so eight suites — 242
// checks — silently stopped running for weeks, and nothing said so. The second
// is quieter: every new test had to be appended to the chain by hand, and one
// that was forgotten simply never ran.
//
// So: suites are discovered from the directory, every one runs whatever the
// others do, and the exit code is non-zero if any failed.
//
//   node test/run-all.js              all suites
//   node test/run-all.js tooth range  only suites matching every word given
//   node test/run-all.js --list       names only, run nothing

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const filters = args.filter(a => !a.startsWith('--')).map(s => s.toLowerCase());

const suites = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.test.js'))
  .sort()
  .filter(f => filters.every(w => f.toLowerCase().includes(w)));

if (!suites.length) {
  console.error(filters.length
    ? 'No suite matches: ' + filters.join(' ')
    : 'No test/*.test.js files found.');
  process.exit(2);
}

if (listOnly) {
  suites.forEach(s => console.log('  ' + s));
  console.log('\n  ' + suites.length + ' suite(s)');
  process.exit(0);
}

// Chromium lives outside the repo in this sandbox; tests read CHROME_PATH.
const env = { ...process.env };
if (!env.CHROME_PATH && fs.existsSync('/opt/pw-browsers/chromium')) {
  env.CHROME_PATH = '/opt/pw-browsers/chromium';
}

// Suites print their own tally. Most end at "N passed, M failed"; one adds
// ", N total". Missing a suite's tally scores it zero and, if it exited 0,
// calls it ok — a silent nothing, the very fault this runner exists to catch.
// So the trailing clause is optional here, and a missing tally is reported
// below whatever the exit code was.
const COUNTS = /^\s*(\d+) passed, (\d+) failed(?:, \d+ total)?\s*$/m;
const results = [];
const started = Date.now();

console.log('Running ' + suites.length + ' suite(s)\n');

for (const file of suites) {
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [path.join(DIR, file)], {
    env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = (run.stdout || '') + (run.stderr || '');
  const m = COUNTS.exec(out);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // A suite with no tally is a failure of its own kind, whether it died or
  // exited 0 — it must never be mistaken for one that passed silently.
  const crashed = !m;
  const r = {
    file,
    passed: m ? Number(m[1]) : 0,
    failed: m ? Number(m[2]) : 0,
    crashed,
    status: run.status,
    secs,
    out,
  };
  results.push(r);

  const bad = r.failed > 0 || crashed;
  const mark = crashed ? 'CRASH' : (r.failed ? ' FAIL' : '   ok');
  const tally = crashed ? 'did not report a result' : r.passed + ' passed, ' + r.failed + ' failed';
  console.log(`  ${mark}  ${file.padEnd(44)} ${tally}  (${secs}s)`);
  if (bad) process.exitCode = 1;
}

const totalPassed = results.reduce((n, r) => n + r.passed, 0);
const totalFailed = results.reduce((n, r) => n + r.failed, 0);
const broken = results.filter(r => r.failed > 0 || r.crashed);
const mins = ((Date.now() - started) / 1000 / 60).toFixed(1);

console.log('\n' + '='.repeat(78));
console.log(`  ${suites.length} suite(s), ${totalPassed} passed, ${totalFailed} failed, ` +
  `${results.filter(r => r.crashed).length} crashed   (${mins} min)`);
console.log('='.repeat(78));

// The point of running everything is seeing everything, so the detail for each
// broken suite is reprinted here rather than left buried in the scrollback.
if (broken.length) {
  console.log('\nWhat failed:\n');
  for (const r of broken) {
    console.log('─'.repeat(78));
    console.log(r.crashed
      ? `${r.file} — no tally printed (exit ${r.status})`
      : `${r.file} — ${r.failed} failed`);
    console.log('─'.repeat(78));
    if (r.crashed) {
      console.log(r.out.trim().split('\n').slice(-25).join('\n'));
    } else {
      // Each FAIL line plus the expected/got line under it.
      const lines = r.out.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*FAIL\s/.test(line)) {
          console.log(line);
          if (lines[i + 1] && /expected|got/.test(lines[i + 1])) console.log(lines[i + 1]);
        }
      });
    }
    console.log('');
  }
  console.log(`Re-run one on its own:  node test/${broken[0].file}`);
}
