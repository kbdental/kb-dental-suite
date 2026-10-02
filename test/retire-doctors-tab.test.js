// Two doctors lists lived in each book: "Doctor Details" (what Master edits,
// with phone, email and role) and "Doctors" (names only, written by the
// settings screen). On top of both, the backend carried a hardcoded pair of
// names that won whenever a tab was empty — which both were.
//
// Doctor Details is the one list. This moves across any name that exists ONLY
// in the old tab and then deletes it. The thing that must not happen: a name
// coming back from the names-only list and flattening the phone, email and
// role already recorded against it.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/maintenance/retire-doctors-tab.gs'), 'utf8');
const CODE = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

class Sheet {
  constructor(n, rows) { this.name = n; this.rows = rows.map(r => r.slice()); }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    return { getValues: () => { const o = []; for (let i = 0; i < nr; i++)
      o.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; } };
  }
  appendRow(v) { this.rows.push(v.slice()); }
}
function Book(tabs, id) {
  const t = {};
  Object.keys(tabs).forEach(k => t[k] = new Sheet(k, tabs[k]));
  return {
    tabs: t, deleted: [],
    getName: () => 'Test Book',
    getId: () => id || 'PMS',
    getSheetByName(n) { return t[n] || null; },
    insertSheet(n) { return (t[n] = new Sheet(n, [])); },
    deleteSheet(sh) { this.deleted.push(sh.getName()); delete t[sh.getName()]; },
  };
}
function boot(book, confirm) {
  const logged = [];
  const fmt = (f, ...a) => { let i = 0; return String(f).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s')); };
  const api = new Function('SpreadsheetApp', 'Logger',
    GS.replace('var CONFIRM_RETIRE = "";', 'var CONFIRM_RETIRE = "' + (confirm || '') + '";') +
    '\nreturn { reportDoctorsTabs, retireDoctorsTab };'
  )({ getActiveSpreadsheet: () => book }, { log: (...a) => logged.push(fmt(...a)) });
  return { api, logged };
}

const HDR = ['Name', 'Phone', 'Email', 'Role', 'Updated At'];

// --- the dry run changes nothing -----------------------------------------
{
  const b = Book({
    'Doctor Details': [HDR, ['Dr. Viveyk Mittel', '99', 'v@x', 'Doctor', 't']],
    'Doctors': [['Doctor Name', 'Updated At'], ['Dr. Viveyk Mittel', 't'], ['Dr. Locum', 't']],
  });
  const { api, logged } = boot(b);
  api.reportDoctorsTabs();
  eq('the dry run deletes nothing', b.deleted, []);
  eq('and adds nothing', b.tabs['Doctor Details'].rows.length, 2);
  ok('it names what would move', logged.some(l => /WOULD BE MOVED/.test(l)), logged);
  ok('specifically the one that is only in the old tab',
    logged.some(l => /^   Dr\. Locum$/.test(l)), logged);
}

// --- no confirmation, no change ------------------------------------------
{
  const b = Book({ 'Doctor Details': [HDR], 'Doctors': [['Doctor Name'], ['Dr. A']] });
  const { api, logged } = boot(b);
  api.retireDoctorsTab();
  eq('nothing without CONFIRM_RETIRE', b.deleted, []);
  ok('and it says why', logged.some(l => /CONFIRM_RETIRE is not set/.test(l)), logged);
}

// --- the move, and the thing that must not happen ------------------------
{
  const b = Book({
    'Doctor Details': [HDR, ['Dr. Viveyk Mittel', '99', 'v@x', 'Doctor', 't']],
    'Doctors': [['Doctor Name', 'Updated At'], ['Dr. Viveyk Mittel', 't'], ['Dr. Locum', 't']],
  });
  const { api } = boot(b, 'YES');
  api.retireDoctorsTab();
  const rows = b.tabs['Doctor Details'].rows;
  eq('the name only in the old tab is moved across', rows.length, 3);
  eq('with a sensible role and blanks for what it never had',
    rows[2].slice(0, 4), ['Dr. Locum', '', '', 'Doctor']);
  // THE one that matters: the names-only list must not overwrite details.
  eq('a doctor already on file keeps phone, email and role',
    rows[1], ['Dr. Viveyk Mittel', '99', 'v@x', 'Doctor', 't']);
  eq('and is not duplicated',
    rows.filter(r => r[0] === 'Dr. Viveyk Mittel').length, 1);
  eq('the old tab is deleted', b.deleted, ['Doctors']);
}

// --- a book already done, and one that never had the tab -----------------
{
  const b = Book({ 'Doctor Details': [HDR, ['Dr. A', '', '', 'Doctor', 't']] });
  const { api, logged } = boot(b, 'YES');
  api.retireDoctorsTab();
  eq('a book without the old tab is untouched', b.deleted, []);
  ok('and says so', logged.some(l => /Nothing to do/.test(l)), logged);
}
{
  // Every name already across: nothing moves, the tab still goes.
  const b = Book({
    'Doctor Details': [HDR, ['Dr. A', '', '', 'Doctor', 't']],
    'Doctors': [['Doctor Name'], ['Dr. A']],
  });
  const { api } = boot(b, 'YES');
  api.retireDoctorsTab();
  eq('nothing is duplicated', b.tabs['Doctor Details'].rows.length, 2);
  eq('and the tab is still retired', b.deleted, ['Doctors']);
}

// --- it refuses the finance book -----------------------------------------
{
  const b = Book({ 'Doctors': [['Doctor Name'], ['Dr. A']] },
    '1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI');
  const { api, logged } = boot(b, 'YES');
  api.retireDoctorsTab();
  eq('the finance book is refused', b.deleted, []);
  ok('and it says why', logged.some(l => /is the finance workbook/.test(l)), logged);
}

// --- the backend must not recreate the tab -------------------------------
// getSheet() creates a tab that is missing, so leaving the old functions in
// would have brought "Doctors" back the first time one was called.
eq('the old list is no longer routed',
  /case "getDoctorsList"|case "saveDoctorsList"/.test(CODE), false);
eq('and its functions are gone',
  /function getDoctorsList\(|function saveDoctorsList\(/.test(CODE), false);
// It carried its own hardcoded pair on top of everything else.
eq('with the hardcoded names that outranked Master',
  /doctors = \["Dr\. Viveyk Mittel", "Dr\. Manika Mittel"\]/.test(CODE), false);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('ONE DOCTORS LIST — THE SECOND TAB RETIRED');
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
