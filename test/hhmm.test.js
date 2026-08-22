// Checks hhmm(), which turns a visit time into HH:MM whatever shape it arrives in.
//
// Sheets stores an "HH:MM" write as a time-of-day cell, which Apps Script reads
// back as a Date on the 1899-12-30 epoch. Passed through raw, check-in and
// check-out reached the browser as "1899-12-30T05:35:50.000Z" and were shown to
// staff exactly like that.
//
// The epoch date is the trap: in 1899 India ran at +05:21:10, not +05:30, so
// these must be read through the named zone. The expected values below are the
// real check-in and check-out times from the clinic's own Daysheet.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('const CLINIC_TZ =');
const to = html.indexOf('// Turnaround time between walk-in', from);
if (from < 0 || to < 0) { console.error('could not locate hhmm() in index.html'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(from, to) + ';this.hhmm = hhmm;', ctx);
const hhmm = ctx.hhmm;

const CASES = [
  // Straight from the reported Daysheet — these are the rows that displayed wrong.
  ['1899-12-30T05:35:50.000Z', '10:57', 'Sheets time cell — check-in'],
  ['1899-12-30T05:56:50.000Z', '11:18', 'Sheets time cell — check-out'],
  ['1899-12-30T05:01:50.000Z', '10:23', 'Sheets time cell — second patient'],
  ['1899-12-30T10:41:50.000Z', '16:03', 'Sheets time cell — afternoon'],

  // Already-clean values must pass through untouched.
  ['09:15', '09:15', 'plain HH:MM'],
  ['9:05',  '9:05',  'single-digit hour'],
  ['14:30:00', '14:30', 'HH:MM:SS trimmed'],

  // Nothing to show.
  ['', '', 'empty string'],
  [null, '', 'null'],
  [undefined, '', 'undefined'],

  // Unrecognised input is left alone rather than mangled into a wrong time.
  ['not a time', 'not a time', 'unparseable passes through'],
];

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(74));
console.log('hhmm() — VISIT TIME FORMATTING');
console.log('='.repeat(74));
for (const [input, want, label] of CASES) {
  const got = hhmm(input);
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label.padEnd(34) +
    JSON.stringify(input) + ' -> ' + JSON.stringify(got) +
    (ok ? '' : '   expected ' + JSON.stringify(want)));
}

// The specific mistake this guards against: reading the 1899 epoch as +05:30.
const naive = new Date(new Date('1899-12-30T05:35:50.000Z').getTime() + 5.5 * 3600e3)
  .toISOString().slice(11, 16);
const ok = hhmm('1899-12-30T05:35:50.000Z') !== naive;
ok ? pass++ : fail++;
console.log((ok ? '  PASS  ' : '  FAIL  ') +
  'does not use a hardcoded +05:30'.padEnd(34) +
  'named zone gives ' + JSON.stringify(hhmm('1899-12-30T05:35:50.000Z')) +
  ', fixed offset would give ' + JSON.stringify(naive));

console.log('='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
