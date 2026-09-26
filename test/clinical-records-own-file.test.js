// Every clinical form's records moved into a spreadsheet of their own, apart
// from the PMS file that holds Registrations, Appointments and Finance links.
//
// This runs the real Apps Script functions against two fake spreadsheets — the
// PMS file and a new one — and holds the move to the rules it was built on:
//
//   * Deploying the code changes nothing until the clinic runs the copy.
//   * The copy never deletes or edits anything in the PMS file.
//   * The app is pointed at the new file only after every tab's copy has been
//     checked against its original, so no record ever looks blank.
//   * Once switched, the copy refuses to run, so live records can't be
//     overwritten from here.
//   * After the switch, all four JSON-blob forms and every flat form read and
//     save in the new file — none still reaches the PMS file through getSheet.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const PMS = '1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4';
const NEW = 'NEW-CLINICAL-FILE';

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// ── a spreadsheet just real enough ──────────────────────────────────────────
class FakeSheet {
  constructor(book, name, rows) { this.book = book; this.name = name; this.rows = rows || []; }
  getName() { return this.name; }
  setName(n) { this.name = n; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() { const s = this; return { getValues: () => s.rows.map(r => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const sheet = this;
    nr = nr || 1; nc = nc || 1;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sheet.rows[r - 1 + i] || [];
          const vals = [];
          for (let j = 0; j < nc; j++) vals.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(vals);
        }
        return out;
      },
      setValues(vals) {
        sheet.book.touch('write ' + sheet.name);
        for (let i = 0; i < nr; i++) {
          while (sheet.rows.length < r + i) sheet.rows.push([]);
          for (let j = 0; j < nc; j++) sheet.rows[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      },
    };
  }
  appendRow(v) { this.book.touch('append ' + this.name); this.rows.push(v.slice()); }
  deleteRow(r) { this.book.touch('deleteRow ' + this.name); this.rows.splice(r - 1, 1); }
  copyTo(target) {
    const rows = this.rows.map(r => r.slice());
    if (target.__truncate && target.__truncate[this.name]) rows.pop();  // simulate a bad copy
    const s = new FakeSheet(target, 'Copy of ' + this.name, rows);
    target.sheets.push(s);
    return s;
  }
}
class FakeBook {
  constructor(id) { this.id = id; this.sheets = []; this.ops = []; }
  touch(op) { this.ops.push(op); }
  getId() { return this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { this.touch('insert ' + n); const s = new FakeSheet(this, n, []); this.sheets.push(s); return s; }
  deleteSheet(s) { this.touch('deleteSheet ' + s.name); this.sheets = this.sheets.filter(x => x !== s); }
  add(n, rows) { const s = new FakeSheet(this, n, rows); this.sheets.push(s); return s; }
  snapshot() { return JSON.stringify(this.sheets.map(s => [s.name, s.rows])); }
}

// ── pull the real functions out of Code.gs ───────────────────────────────────
function slice(from, to) {
  const a = GS.indexOf(from);
  const b = GS.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('could not slice ' + from);
  return GS.slice(a, b);
}
const regionB = slice('var CLINICAL_SHEETS_SHARED_TAB',
  '// ════════════════════════════════════════════════════════════\n// DAILY REGISTER');
const regionA = slice('var CLINICAL_SHEET_ID_DEFAULT', '// ── One-time setup');
// The copy-safe default guard, which getClinicalSheetId now goes through: a
// copied book keeps its records in itself rather than in the main clinic's.
// It is sliced in with the rest so this runs the real fallback, not a stub.
const guard = slice('var MAIN_PMS_SHEET_ID', 'var FINANCE_SHEET_ID_DEFAULT');

function boot() {
  const books = { [PMS]: new FakeBook(PMS), [NEW]: new FakeBook(NEW) };
  const props = {};
  const logged = [];
  const getSheetCalls = [];
  const env = {
    books, props, logged, getSheetCalls,
    SpreadsheetApp: { openById: id => { if (!books[id]) throw new Error('no such file ' + id); return books[id]; } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    }) },
    Logger: { log: (...a) => logged.push(a.join(' ')) },
    // The PMS file's own accessor. Nothing clinical may reach it any more.
    getSheet: n => { getSheetCalls.push(n); return books[PMS].getSheetByName(n) || books[PMS].insertSheet(n); },
    safeParseJSON: v => { try { return JSON.parse(v); } catch (e) { return null; } },
    safeJSON: v => (typeof v === 'string' ? v : JSON.stringify(v)),
  };
  // This book IS the main clinic's here, which is what these cases are about.
  env.SS_ID = PMS;
  const names = ['SpreadsheetApp', 'PropertiesService', 'Logger', 'getSheet', 'safeParseJSON', 'safeJSON', 'SS_ID'];
  env.api = new Function(...names, guard + '\n' + regionB + '\n' + regionA +
    '\nreturn { getClinicalSheetId, getClinicalSheet, copyClinicalRecordsToNewFile, clinicalTabsToCopy_,' +
    ' getClinicalSheets, saveClinicalSheets, getClinicalRecords, saveClinicalRecord, CLINICAL_SHEET_ID_DEFAULT };'
  )(...names.map(n => env[n]));
  return env;
}

// ── 1. deploying the code on its own changes nothing ────────────────────────
{
  const e = boot();
  eq('with no property set, the clinical file is the PMS file', e.api.getClinicalSheetId(), PMS);
  eq('the fallback is the PMS file the backend has always used', e.api.CLINICAL_SHEET_ID_DEFAULT, PMS);

  e.api.saveClinicalRecord({ tabName: 'Denture', fields: { UHID: 'AL0901', 'Local Anesthesia': 'Lignox 2% A' } });
  e.api.saveClinicalSheets({ uhid: 'AL0901', patientName: 'A', sheetType: 'RCT', allTeeth: { t: 36 } });
  ok('a flat form still saves into the PMS file', !!e.books[PMS].getSheetByName('Denture'), e.books[PMS].sheets.map(s => s.name));
  ok('and so does an RCT record', !!e.books[PMS].getSheetByName('Clinical Sheets - RCT'), e.books[PMS].sheets.map(s => s.name));
  eq('and nothing is written to the new file', e.books[NEW].sheets.length, 0);
  // The rewrite: the four JSON-blob forms go through getClinicalSheet now.
  eq('no clinical tab is reached through the PMS file’s getSheet', e.getSheetCalls, []);
}

// ── 2. the copy refuses when it has nothing sensible to do ──────────────────
{
  const e = boot();
  e.api.copyClinicalRecordsToNewFile();
  eq('without CLINICAL_SHEET_ID_NEW, nothing switches', e.props.CLINICAL_SHEET_ID, undefined);
  ok('and it says what to set', e.logged.some(l => /CLINICAL_SHEET_ID_NEW/.test(l)), e.logged);

  const e2 = boot();
  e2.props.CLINICAL_SHEET_ID_NEW = PMS;
  e2.api.copyClinicalRecordsToNewFile();
  eq('pointing it at the PMS file itself is refused', e2.props.CLINICAL_SHEET_ID, undefined);
  ok('and it says it has to be a different file', e2.logged.some(l => /different/.test(l)), e2.logged);
}

// ── 3. the copy: everything across, nothing touched at home ─────────────────
const e = boot();
const pms = e.books[PMS];
pms.add('Registrations', [['UHID', 'Full Name'], ['AL0901', 'P K Roy']]);            // not clinical
pms.add('Denture', [['Timestamp', 'UHID', 'Local Anesthesia'], ['t1', 'AL0901', 'Septanest'], ['t2', 'AL0902', 'Other — Xylocaine 2%']]);
pms.add('RCT', [['Timestamp', 'UHID', 'Tooth No.'], ['t', 'AL0810', '24']]);
pms.add('Clinical Sheets - RCT', [['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At'],
  ['AL0810', 'P K Roy', 'RCT', JSON.stringify({ entries: [{ tooth: '24' }] }), '2026-09-01T00:00:00Z']]);
pms.add('Clinical Sheets', [['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At'],
  ['AL0700', 'Old', 'Crown Bridge', JSON.stringify({ legacy: true }), '2026-01-01T00:00:00Z']]);
e.books[NEW].add('Sheet1', []);
const before = pms.snapshot();
pms.ops = [];

e.props.CLINICAL_SHEET_ID_NEW = NEW;
e.api.copyClinicalRecordsToNewFile();

const nb = e.books[NEW];
eq('the app now points at the new file', e.props.CLINICAL_SHEET_ID, NEW);
for (const t of ['Denture', 'RCT', 'Clinical Sheets - RCT', 'Clinical Sheets']) {
  eq(t + ' arrived intact', JSON.stringify((nb.getSheetByName(t) || {}).rows), JSON.stringify(pms.getSheetByName(t).rows));
}
eq('copies carry the tab’s own name, not "Copy of …"',
  nb.sheets.filter(s => /^Copy of /.test(s.name)).map(s => s.name), []);
eq('Registrations is not clinical and is not copied', nb.getSheetByName('Registrations'), null);
eq('the new file’s empty Sheet1 is tidied away', nb.getSheetByName('Sheet1'), null);

// The PMS file must be byte-for-byte what it was.
eq('nothing in the PMS file was deleted or changed', pms.snapshot(), before);
eq('the copy performed no write of any kind on the PMS file', pms.ops, []);
ok('the log says so in words', e.logged.some(l => /Nothing in this spreadsheet was deleted or changed/.test(l)), e.logged);
ok('and names the tabs that were not there to copy',
  e.logged.some(l => /Not in this spreadsheet/.test(l) && /Pathology/.test(l)), e.logged);

// ── 4. after the switch, everything reads and saves in the new file ─────────
eq('a record copied across reads back from the new file',
  e.api.getClinicalSheets({ uhid: 'AL0810', sheetType: 'RCT' }).allTeeth, { entries: [{ tooth: '24' }] });
eq('a pre-split record still reads, from the copied shared tab',
  e.api.getClinicalSheets({ uhid: 'AL0700', sheetType: 'Crown Bridge' }).allTeeth, { legacy: true });
eq('flat-form history reads from the new file',
  e.api.getClinicalRecords({ tabName: 'Denture', uhid: 'AL0902' }).records.map(r => r['Local Anesthesia']),
  ['Other — Xylocaine 2%']);

pms.ops = [];
e.api.saveClinicalRecord({ tabName: 'Denture', fields: { UHID: 'AL0903', 'Local Anesthesia': 'Lidayn 2% A' } });
e.api.saveClinicalSheets({ uhid: 'AL0810', patientName: 'P K Roy', sheetType: 'RCT', allTeeth: { entries: [{ tooth: '24' }, { tooth: '25' }] } });
e.api.saveClinicalSheets({ uhid: 'AL0700', patientName: 'Old', sheetType: 'Crown Bridge', allTeeth: { resumed: true } });
eq('a new flat record lands in the new file', nb.getSheetByName('Denture').rows.length, 4);
eq('an RCT save updates the new file’s record',
  e.api.getClinicalSheets({ uhid: 'AL0810', sheetType: 'RCT' }).allTeeth.entries.length, 2);
eq('and after the switch the PMS file is never written to', pms.ops, []);
eq('the stale shared-tab row is cleaned up in the new file only',
  nb.getSheetByName('Clinical Sheets').rows.length, 1);
eq('while the PMS original of that row is left exactly where it was',
  pms.getSheetByName('Clinical Sheets').rows.length, 2);
eq('no clinical tab reached the PMS file through getSheet at any point', e.getSheetCalls, []);

// ── 5. once switched, it cannot be run over live data ───────────────────────
{
  const liveBefore = nb.snapshot();
  e.logged.length = 0;
  e.api.copyClinicalRecordsToNewFile();
  eq('running it again after the switch changes nothing', nb.snapshot(), liveBefore);
  ok('and says why it refused', e.logged.some(l => /already uses that spreadsheet/.test(l)), e.logged);
}

// ── 6. a copy that does not match its original stops the switch ─────────────
{
  const b = boot();
  b.books[PMS].add('Pedo', [['Timestamp', 'UHID'], ['t', 'AL0901'], ['t', 'AL0902']]);
  b.books[PMS].add('Scaling', [['Timestamp', 'UHID'], ['t', 'AL0901']]);
  b.books[NEW].__truncate = { Pedo: true };
  b.props.CLINICAL_SHEET_ID_NEW = NEW;
  b.api.copyClinicalRecordsToNewFile();
  eq('a short copy means the app is NOT switched', b.props.CLINICAL_SHEET_ID, undefined);
  ok('the log names the tab that did not match', b.logged.some(l => /NOT SWITCHED/.test(l) && /Pedo/.test(l)), b.logged);
  eq('so the app keeps using the PMS file', b.api.getClinicalSheetId(), PMS);

  // Run it again once whatever went wrong is fixed: the half-copied tab is
  // replaced, not duplicated.
  delete b.books[NEW].__truncate;
  b.api.copyClinicalRecordsToNewFile();
  eq('a clean re-run switches', b.props.CLINICAL_SHEET_ID, NEW);
  eq('with exactly one Pedo tab in the new file, not two',
    b.books[NEW].sheets.filter(s => s.name === 'Pedo' || s.name === 'Copy of Pedo').length, 1);
  eq('and it is the full copy', b.books[NEW].getSheetByName('Pedo').rows.length, 3);
}

// ── 7. no form is forgotten ─────────────────────────────────────────────────
// Every tab the app can save into must be on the copy list, or its records
// would silently stay behind in the PMS file after the switch.
{
  const e3 = boot();
  const copyList = e3.api.clinicalTabsToCopy_();
  const sent = [...HTML.matchAll(/tabName:\s*["']([^"']+)["']/g)].map(m => m[1]);
  const saved = [...GS.matchAll(/tabName:\s*"([^"]+)"/g)].map(m => m[1]);
  const every = [...new Set([...sent, ...saved])].sort();
  eq('every tab the app or backend saves into is on the copy list',
    every.filter(t => !copyList.includes(t)), []);
  for (const t of ['Clinical Sheets', 'Clinical Sheets - RCT', 'Clinical Sheets - Implant Surgery',
                   'Clinical Sheets - Implant Prosthetic', 'Clinical Sheets - Crown Bridge']) {
    ok(t + ' is on the copy list', copyList.includes(t), copyList);
  }
  eq('the copy list has no duplicates', copyList.length, new Set(copyList).size);
}

// ── 8. and in the source itself ─────────────────────────────────────────────
ok('the hardcoded clinical ID is gone from Code.gs',
  !/var CLINICAL_SHEET_ID\s*=\s*"1DtoZ3/.test(GS), null);
ok('the four JSON-blob forms no longer call the PMS file’s getSheet',
  !/[^l]getSheet\(/.test(regionB.replace(/getClinicalSheet\(/g, '')), null);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('CLINICAL RECORDS IN THEIR OWN SPREADSHEET — COPY, CHECK, THEN SWITCH');
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
