// A book copied from the PMS and cleared comes across with some Master lists
// empty. This fills those from the main book — and the property that matters
// is what it must NOT do: never write to the main book, never overwrite a list
// this book already has, and never touch Clinic Profile, which is the new
// instance's own identity and would otherwise put K. B. Dental's letterhead on
// empanelled paperwork.

const fs = require('fs');
const path = require('path');
const GS = fs.readFileSync(path.join(__dirname, '..',
  'apps-script/maintenance/copy-masters-from-main.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const MAIN = '1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4';
const COPY = '1COPYcopy';

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; this.writes = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, r) => Math.max(n, r.length), 0); }
  getRange(r, c, nr, nc) {
    const s = this;
    return {
      getValues: () => { const o = []; for (let i = 0; i < nr; i++)
        o.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      setValues: (v) => { s.writes++; for (let i = 0; i < nr; i++) {
        while (s.rows.length < r + i) s.rows.push([]);
        for (let j = 0; j < nc; j++) s.rows[r - 1 + i][c - 1 + j] = v[i][j]; } },
    };
  }
}
class Book {
  constructor(id, name, tabs) {
    this.id = id; this.name = name; this.tabs = {}; this.inserted = [];
    Object.keys(tabs).forEach(k => { this.tabs[k] = new Sheet(k, tabs[k]); });
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(n) { return this.tabs[n] || null; }
  insertSheet(n) { this.inserted.push(n); return (this.tabs[n] = new Sheet(n, [])); }
  writes() { return Object.values(this.tabs).reduce((n, s) => n + s.writes, 0); }
}

const hdr = ['A', 'B'];
function mainBook() {
  return new Book(MAIN, 'K. B. DENTAL SUITE - PMS', {
    'Doctors': [hdr, ['Dr A', 1], ['Dr B', 2]],
    'Chairs': [hdr, ['Chair 1', 1]],
    'Payment Modes': [hdr, ['Cash', 1], ['UPI', 2]],
    'Implant Brands': [hdr],                       // header only: empty
    'Clinic Profile': [hdr, ['K.B. Dental', 1]],
    'Treatments Master': [hdr, ['Scaling', 1]],
  });
}

function boot(copy, confirm) {
  const src = mainBook();
  const SpreadsheetApp = {
    getActiveSpreadsheet: () => copy,
    openById: (id) => (id === MAIN ? src : copy),
  };
  const logged = [];
  // Apps Script's Logger.log substitutes %s with the arguments that follow.
  // Joining them instead would let a test pass on output no one could read.
  const fmt = (f, ...a) => {
    let i = 0;
    return String(f).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s')) +
      a.slice(i).map(x => ' ' + x).join('');
  };
  const api = new Function('SpreadsheetApp', 'Logger',
    GS.replace('var CONFIRM_MASTERS = "";', 'var CONFIRM_MASTERS = "' + (confirm || '') + '";') +
    '\nreturn { reportMastersGap, copyMastersFromMainBook };'
  )(SpreadsheetApp, { log: (...a) => logged.push(fmt(...a)) });
  return { api, src, copy, logged };
}

const clearedCopy = () => new Book(COPY, 'KB Dental — PMS Empaneled', {
  'Doctors': [hdr],                                  // empty, should fill
  'Payment Modes': [hdr],                            // empty, should fill
  'Clinic Profile': [hdr, ['Empanelled Clinic', 9]], // its own, must survive
  'Treatments Master': [hdr, ['Scaling', 1]],        // already filled
});

// --- the dry run reports without changing anything -------------------------
{
  const e = boot(clearedCopy());
  e.api.reportMastersGap();
  eq('the dry run writes nothing', e.copy.writes(), 0);
  ok('it names what it would fill',
    e.logged.some(l => /Would fill .*Doctors/.test(l)), e.logged.slice(-4));
  ok('it says Clinic Profile is never copied',
    e.logged.some(l => /Clinic Profile is never copied/.test(l)), e.logged);
}

// --- without CONFIRM_MASTERS, nothing happens ------------------------------
{
  const e = boot(clearedCopy());
  e.api.copyMastersFromMainBook();
  eq('no confirmation means no write', e.copy.writes(), 0);
  ok('and it says why', e.logged.some(l => /CONFIRM_MASTERS is not set/.test(l)), e.logged);
}

// --- the copy itself -------------------------------------------------------
{
  const e = boot(clearedCopy(), 'YES');
  e.api.copyMastersFromMainBook();
  eq('an empty list is filled from main', e.copy.getSheetByName('Doctors').rows.length, 3);
  eq('including its header row', e.copy.getSheetByName('Doctors').rows[0], hdr);
  eq('a list missing entirely is created', e.copy.getSheetByName('Chairs').rows.length, 2);
  ok('and it was inserted, not assumed', e.copy.inserted.indexOf('Chairs') >= 0, e.copy.inserted);

  // The three things it must never do.
  eq('a list that already has rows is left alone',
    e.copy.getSheetByName('Treatments Master').rows.length, 2);
  eq('this book keeps its OWN Clinic Profile',
    e.copy.getSheetByName('Clinic Profile').rows[1], ['Empanelled Clinic', 9]);
  eq('nothing is ever written to the main book', e.src.writes(), 0);
  eq('and no tab is created there', e.src.inserted, []);

  // Empty in main is not something to copy.
  ok('a list empty in main is not created here',
    !e.copy.getSheetByName('Implant Brands'), 'Implant Brands');
}

// --- running it twice changes nothing the second time ----------------------
{
  const e = boot(clearedCopy(), 'YES');
  e.api.copyMastersFromMainBook();
  const after = JSON.stringify(e.copy.tabs['Doctors'].rows);
  e.logged.length = 0;
  e.api.copyMastersFromMainBook();
  eq('a second run leaves the filled list as it was',
    JSON.stringify(e.copy.tabs['Doctors'].rows), after);
  ok('and says nothing needed filling',
    e.logged.some(l => /Nothing needed filling/.test(l)), e.logged);
}

// --- it refuses to run in the main book ------------------------------------
{
  const e = boot(mainBook(), 'YES');
  e.api.copyMastersFromMainBook();
  ok('it refuses to run in the source book',
    e.logged.some(l => /REFUSED/.test(l)), e.logged);
  eq('and changes nothing there', e.copy.writes(), 0);
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('COPYING MASTERS INTO A NEW INSTANCE, WITHOUT TOUCHING THE MAIN BOOK');
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
