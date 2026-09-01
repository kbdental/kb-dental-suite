// Checks the fix for: the Daily Register table showed Walk-in and Consult
// columns that duplicated the automatically-tracked Check-in/Engaged times,
// and TAT (turnaround time) sat before Check-in/Check-out instead of after
// them. Walk-in/Consult are gone from the table now, TAT moved to the end,
// and TAT itself is recomputed as Check-in -> Check-out (the clinic-visit
// duration) rather than the old Walk-in -> Consult gap.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// tatBetween is a small top-level helper, easy to pull out and test directly.
const tatFrom = html.indexOf('function tatBetween(fromHHMM, toHHMM) {');
const tatTo = html.indexOf('\n}', tatFrom) + 2;
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(tatFrom, tatTo) + ';this.tatBetween = tatBetween;', ctx);
const { tatBetween } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// --- tatBetween itself, exercised the way it now feeds the table -----------
eq('check-in to check-out duration', tatBetween('10:00', '11:15'), '01:15');
eq('missing check-out -> blank, not a bogus duration', tatBetween('10:00', ''), '');
eq('missing check-in -> blank', tatBetween('', '11:15'), '');

// --- the on-screen table: header, column count, and TAT's new source -------
const gridSection = html.slice(html.indexOf('function DailyRegister('), html.indexOf('const CRM_B64'));

const headerMatch = /\["S\.No\.","UHID","Patient","Date","Procedure","Tooth","Work Done","Doctor",([^\]]+)\]/.exec(gridSection);
if (!headerMatch) { console.error('could not find the on-screen table header array'); process.exit(1); }
const trailingCols = headerMatch[1].split(',').map(s => s.replace(/"/g, ''));
eq('Walk-in column removed from the on-screen header', trailingCols.includes('Walk-in'), false);
eq('Consult column removed from the on-screen header', trailingCols.includes('Consult'), false);
eq('on-screen header ends Check-in, Engaged, Check-out, TAT — in that order',
  trailingCols, ['Check-in', 'Engaged', 'Check-out', 'TAT']);

eq('TAT is now computed from Check-in/Check-out, not the old Walk-in/Consult fields',
  /tatBetween\(at\.checkin,\s*at\.checkout\)/.test(gridSection), true);
eq('the removed e.tat (Walk-in→Consult) value is no longer read in this table',
  /e\.tat/.test(gridSection), false);

// --- the printed register: same header order, same TAT source --------------
const printHeaderMatch = /<th style="width:78pt">Doctor<\/th>([^]*?)<\/tr><\/thead>/.exec(gridSection);
if (!printHeaderMatch) { console.error('could not find the printed table header'); process.exit(1); }
const printCols = Array.from(printHeaderMatch[1].matchAll(/<th[^>]*>([^<]+)<\/th>/g)).map(m => m[1]);
eq('printed header ends Check-in, Engaged, Check-out, TAT — in that order',
  printCols, ['Check-in', 'Engaged', 'Check-out', 'TAT']);

const printRowFn = /const rows=filtered\.map[\s\S]*?\}\)\.join\(""\);/.exec(gridSection);
eq('printed rows compute TAT from Check-in/Check-out too',
  printRowFn && /tatBetween\(at\.checkin,\s*at\.checkout\)/.test(printRowFn[0]), true);
eq('printed rows no longer reference the removed Walk-in/Consult fields',
  printRowFn && /e\.timeWalkIn|e\.consultationTime/.test(printRowFn[0]), false);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('DAILY REGISTER — WALK-IN/CONSULT REMOVED, TAT AFTER CHECK-OUT');
console.log('='.repeat(78));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
