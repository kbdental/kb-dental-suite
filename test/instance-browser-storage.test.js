// Browser storage is per-ORIGIN, and every instance of this app is served from
// the same URL — only ?clinic= differs. So a bare key like "kbdc_doctors" is
// one box shared by every instance on that machine: editing the doctor list in
// the empanelled app would change the main clinic's, and unlocking Master or
// Finance in one would unlock it in the other. The unlock flags and the
// session token make that a good deal worse than a shared preference.
//
// This runs the real scopedKey out of index.html against both instance ids,
// and then checks that no storage call anywhere in the file bypasses it.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// The real functions, sliced from the file rather than reimplemented — a copy
// here could pass while the app shipped something else.
const from = html.indexOf('function scopedKey(');
const to = html.indexOf('const DEFAULT_DOCTORS');
ok('scopedKey and lsKey are in index.html', from > 0 && to > from, [from, to]);
const src = html.slice(from, to);

function load(instanceId) {
  const window = { KB_INSTANCE_ID: instanceId };
  return new Function('window', src + '\nreturn { scopedKey, lsKey };')(window);
}

// --- main is untouched, so nothing already saved is lost -------------------
const main = load('main');
eq('main keeps the original doctors key', main.lsKey('doctors'), 'kbdc_doctors');
eq('main keeps the original unlock key',
  main.scopedKey('kbdc_master_unlocked'), 'kbdc_master_unlocked');
eq('main keeps the original token key',
  main.scopedKey('kbdc_session_token'), 'kbdc_session_token');
// Before the instance layer has run there is no id; that must behave as main.
eq('an unset instance id behaves as main', load(undefined).lsKey('doctors'), 'kbdc_doctors');

// --- a non-main instance gets its own box ---------------------------------
const emp = load('empanelled');
eq('the empanelled doctors list is its own',
  emp.lsKey('doctors'), 'kbdc_empanelled_doctors');
eq('so is its Master unlock',
  emp.scopedKey('kbdc_master_unlocked'), 'kbdc_empanelled_master_unlocked');
eq('so is its Finance unlock',
  emp.scopedKey('kbdc_fin_unlocked_pnl'), 'kbdc_empanelled_fin_unlocked_pnl');
eq('and its session token', emp.scopedKey('kbdc_session_token'), 'kbdc_empanelled_session_token');

// The point of all of it: no key may be shared between two instances.
const keys = ['kbdc_doctors', 'kbdc_master_unlocked', 'kbdc_reports_unlocked',
  'kbdc_fin_unlocked_pnl', 'kbdc_fin_unlocked_receipt', 'kbdc_session_token'];
const shared = keys.filter(k => main.scopedKey(k) === emp.scopedKey(k));
eq('no key is shared between main and empanelled', shared, []);

// --- and nothing in the file may bypass it --------------------------------
// A call site added later with a bare literal would reintroduce the sharing
// silently, so the file is checked rather than trusted.
const calls = html.match(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*[^)]*/g) || [];
ok('there are storage calls to check', calls.length > 0, calls.length);
const unscoped = calls.filter(c => !/\(\s*(scopedKey|lsKey)\(/.test(c));
eq('every storage call goes through scopedKey or lsKey', unscoped, []);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('ONE BROWSER, SEVERAL INSTANCES — NO SHARED STORAGE');
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
