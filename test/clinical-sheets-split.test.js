// The four JSON-blob forms (RCT, Implant Surgery, Implant Prosthetic, Crown
// Bridge) shared one "Clinical Sheets" tab, and both reading and saving pulled
// the whole range — including every record's JSON blob — just to locate one
// patient's row. This runs the real Apps Script functions against a fake
// spreadsheet: the split into per-form tabs, and, by counting the cells each
// call actually touches, that the blob column is no longer read to find a row.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- a spreadsheet just real enough, that counts what gets read -------------
let cellsRead = 0;
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getRange(r, c, nr, nc) {
    const sheet = this;
    return {
      getValues() {
        cellsRead += nr * nc;
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sheet.rows[r - 1 + i] || [];
          out.push(row.slice(c - 1, c - 1 + nc));
        }
        return out;
      },
      setValues(vals) {
        for (let i = 0; i < nr; i++) {
          while (sheet.rows.length < r - 1 + i + 1) sheet.rows.push([]);
          const row = sheet.rows[r - 1 + i];
          for (let j = 0; j < nc; j++) row[c - 1 + j] = vals[i][j];
        }
      },
    };
  }
  appendRow(v) { this.rows.push(v.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
}

const book = {};
function getSheet(name) {
  if (!book[name]) book[name] = new FakeSheet(name);
  return book[name];
}
const safeParseJSON = v => { try { return JSON.parse(v); } catch (e) { return null; } };
const safeJSON = v => (typeof v === 'string' ? v : JSON.stringify(v));
const logged = [];
const Logger = { log: (...a) => logged.push(a.join(' ')) };

// Pull just the clinical-sheet functions out of Code.gs and run them for real.
function slice(from, to) {
  const a = GS.indexOf(from);
  const b = GS.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('could not slice ' + from);
  return GS.slice(a, b);
}
const src = slice('var CLINICAL_SHEETS_SHARED_TAB', '// ════════════════════════════════════════════════════════════\n// DAILY REGISTER');
const api = new Function('getSheet', 'safeParseJSON', 'safeJSON', 'Logger',
  src + '\nreturn { getClinicalSheets, saveClinicalSheets, migrateClinicalSheetsToOwnTabs, clinicalSheetTabName_, CLINICAL_SHEET_TABS };'
)(getSheet, safeParseJSON, safeJSON, Logger);

// --- each form gets its own tab, and not the historical flat one -----------
eq('RCT has its own tab', api.clinicalSheetTabName_('RCT'), 'Clinical Sheets - RCT');
eq('Crown Bridge has its own tab', api.clinicalSheetTabName_('Crown Bridge'), 'Clinical Sheets - Crown Bridge');
ok('the per-form tabs never collide with the historical flat tabs',
  Object.values(api.CLINICAL_SHEET_TABS).every(t => t.indexOf('Clinical Sheets - ') === 0),
  Object.values(api.CLINICAL_SHEET_TABS));
eq('an unknown type still falls back to the shared tab',
  api.clinicalSheetTabName_('Something Else'), 'Clinical Sheets');

// --- saving writes to the form's own tab ----------------------------------
api.saveClinicalSheets({ uhid: 'AL0801', patientName: 'A', sheetType: 'RCT', allTeeth: { t: 36 } });
api.saveClinicalSheets({ uhid: 'AL0801', patientName: 'A', sheetType: 'Crown Bridge', allTeeth: { t: 11 } });
eq('the RCT record lands in the RCT tab', book['Clinical Sheets - RCT'].rows.length, 2);
eq('the Crown & Bridge record lands in its own tab', book['Clinical Sheets - Crown Bridge'].rows.length, 2);

// --- two forms for one patient no longer overwrite each other -------------
eq('RCT reads back its own record',
  api.getClinicalSheets({ uhid: 'AL0801', sheetType: 'RCT' }).allTeeth, { t: 36 });
eq('Crown & Bridge reads back its own record',
  api.getClinicalSheets({ uhid: 'AL0801', sheetType: 'Crown Bridge' }).allTeeth, { t: 11 });

// --- saving twice updates in place rather than piling up rows -------------
api.saveClinicalSheets({ uhid: 'AL0801', patientName: 'A', sheetType: 'RCT', allTeeth: { t: 46 } });
eq('re-saving updates the row instead of appending', book['Clinical Sheets - RCT'].rows.length, 2);
eq('and the newer record is what reads back',
  api.getClinicalSheets({ uhid: 'AL0801', sheetType: 'RCT' }).allTeeth, { t: 46 });

// --- records written before the split are still found ---------------------
const shared = getSheet('Clinical Sheets');
shared.rows = [
  ['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At'],
  ['AL0900', 'Old Patient', 'RCT', JSON.stringify({ legacy: true }), '2026-01-01T00:00:00Z'],
  ['AL0901', 'Other', 'Implant Surgery', JSON.stringify({ legacy: 'imp' }), '2026-01-02T00:00:00Z'],
];
eq('a pre-split record is still found without migrating',
  api.getClinicalSheets({ uhid: 'AL0900', sheetType: 'RCT' }).allTeeth, { legacy: true });

// --- the migration is a copy, and re-running it changes nothing -----------
api.migrateClinicalSheetsToOwnTabs();
eq('the legacy RCT record is now in the RCT tab',
  api.getClinicalSheets({ uhid: 'AL0900', sheetType: 'RCT' }).allTeeth, { legacy: true });
ok('nothing is deleted from the shared tab', shared.rows.length === 3, shared.rows.length);
const afterFirst = JSON.stringify(book['Clinical Sheets - RCT'].rows);
api.migrateClinicalSheetsToOwnTabs();
eq('running the migration again is a no-op',
  JSON.stringify(book['Clinical Sheets - RCT'].rows), afterFirst);
ok('the migration says plainly that nothing was deleted',
  logged.some(l => /nothing was deleted/i.test(l)), logged);

// --- a newer record is never overwritten by an older one ------------------
api.saveClinicalSheets({ uhid: 'AL0900', patientName: 'Old Patient', sheetType: 'RCT', allTeeth: { fresh: true } });
api.migrateClinicalSheetsToOwnTabs();
eq('migration will not clobber a newer record with the stale shared copy',
  api.getClinicalSheets({ uhid: 'AL0900', sheetType: 'RCT' }).allTeeth, { fresh: true });

// --- saving moves the stale shared row rather than leaving a duplicate ----
ok('the stale shared row is gone once the record is saved again',
  !shared.rows.some(r => String(r[0]).toUpperCase() === 'AL0900' && r[2] === 'RCT'),
  shared.rows.map(r => r[0] + '/' + r[2]));

// --- THE READ FIX: locating a row must not touch the blob column ----------
const blob = JSON.stringify({ big: 'x'.repeat(500) });
const rct = getSheet('Clinical Sheets - RCT');
rct.rows = [['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At']];
for (let i = 0; i < 200; i++) {
  rct.rows.push(['AL' + (1000 + i), 'P' + i, 'RCT', blob, '2026-02-01T00:00:00Z']);
}

cellsRead = 0;
api.getClinicalSheets({ uhid: 'AL1199', sheetType: 'RCT' });
const readCells = cellsRead;
// 200 rows x 3 key columns to find it, plus the 5 cells of the row itself.
ok('a read scans only the key columns, not all five', readCells <= 200 * 3 + 5, readCells);
ok('a read no longer pulls all 200 blobs (that would be 1000 cells)',
  readCells < 200 * 5, readCells);

cellsRead = 0;
api.saveClinicalSheets({ uhid: 'AL1199', patientName: 'P199', sheetType: 'RCT', allTeeth: { t: 1 } });
ok('a save is just as frugal', cellsRead < 200 * 5, cellsRead);

// --- and the split means each tab is a quarter the size to begin with -----
ok('a lookup only ever scans the one form\'s tab',
  !logged.some(l => /Crown Bridge/.test(l)) && book['Clinical Sheets - Crown Bridge'].rows.length === 2,
  book['Clinical Sheets - Crown Bridge'].rows.length);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('CLINICAL SHEETS — ONE TAB PER FORM, AND ROW LOOKUP WITHOUT THE BLOBS');
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
