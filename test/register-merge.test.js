// Checks the Daily Register merge fix.
//
// Reported bug: a patient having several clinical actions on the same visit
// (X-ray, Digital Scan, Local Anesthesia, ...) — each of which calls
// saveToDailyRegister on save — was creating one register row PER action
// instead of one row for the whole day's visit. saveToDailyRegister now
// looks for an existing row with the same UHID + date and merges into it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'out', 'Code.gs'), 'utf8');
const from = src.indexOf('function combineRegisterField_');
const to = src.indexOf('function saveToDailyRegister(p) {');
if (from < 0 || to < 0) { console.error('could not locate the register merge helpers'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) +
  ';this.combineRegisterField_ = combineRegisterField_;' +
  'this.preferLatestNonBlank_ = preferLatestNonBlank_;' +
  'this.keepFirstNonBlank_ = keepFirstNonBlank_;', ctx);
const { combineRegisterField_, preferLatestNonBlank_, keepFirstNonBlank_ } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: got === want, got, want });

// --- combineRegisterField_ (Procedure Done, Work Done, Tooth No., etc.) ---
eq('combine: empty + new -> new', combineRegisterField_('', 'X-ray'), 'X-ray');
eq('combine: old + empty -> old', combineRegisterField_('X-ray', ''), 'X-ray');
eq('combine: old + new -> joined',
  combineRegisterField_('X-ray', 'Digital Scan'), 'X-ray | Digital Scan');
eq('combine: three in a row', combineRegisterField_('X-ray | Digital Scan', 'Local Anesthesia'),
  'X-ray | Digital Scan | Local Anesthesia');
eq('combine: does not duplicate an already-recorded value',
  combineRegisterField_('X-ray | Digital Scan', 'X-ray'), 'X-ray | Digital Scan');
eq('combine: both empty -> empty', combineRegisterField_('', ''), '');

// --- preferLatestNonBlank_ (compliance questions) -------------------------
eq('latest: blank old, answered new -> new', preferLatestNonBlank_('', 'Yes'), 'Yes');
eq('latest: answered old, blank new -> keeps old', preferLatestNonBlank_('Yes', ''), 'Yes');
eq('latest: answered old, different new -> new wins (a correction)',
  preferLatestNonBlank_('No', 'Yes'), 'Yes');

// --- keepFirstNonBlank_ (walk-in time, TAT, patient identity fields) -----
eq('first: blank old, new value -> fills the gap', keepFirstNonBlank_('', '10:05'), '10:05');
eq('first: old already set -> unchanged by a later save', keepFirstNonBlank_('10:05', '10:47'), '10:05');

// --- end-to-end: saveToDailyRegister against a fake sheet ---------------
// The helpers above are correct in isolation; this drives the actual
// row-matching logic (same UHID + same date -> merge, not append), which is
// where the reported bug lived.
const e2eFrom = src.indexOf('function formatDateISO');
const e2eToMarker = src.indexOf('// ════', src.indexOf('function saveToDailyRegister'));
if (e2eFrom < 0 || e2eToMarker < 0) { console.error('could not locate saveToDailyRegister for the end-to-end test'); process.exit(1); }

function fakeSheet() {
  let headers = null;
  let rows = [];
  return {
    getLastRow: () => (headers ? rows.length + 1 : 0),
    getLastColumn: () => headers.length,
    getRange: (r, c, numRows, numCols) => ({
      getValues: () => {
        if (r === 1) return [headers];
        return rows.slice(r - 2, r - 2 + (numRows || 1));
      },
      setValues: (vals) => { rows[r - 2] = vals[0]; },
    }),
    getDataRange: () => ({ getValues: () => [headers, ...rows] }),
    appendRow: (row) => { if (!headers) headers = row; else rows.push(row); },
  };
}

const e2eCtx = { getSheet: () => e2eCtx.__sheet };
vm.createContext(e2eCtx);
vm.runInContext(src.slice(e2eFrom, e2eToMarker) + ';this.saveToDailyRegister = saveToDailyRegister;', e2eCtx);

e2eCtx.__sheet = fakeSheet();
const base = { uhid: 'AL0777', patientName: 'Test Patient', date: '2026-08-25', operatingDoctor: 'Dr. Mittel' };

e2eCtx.saveToDailyRegister({ ...base, procedureDone: 'X-ray', workDone: 'X-ray taken, wrt 26.' });
let r1 = e2eCtx.saveToDailyRegister({ ...base, procedureDone: 'Digital Scan', workDone: 'Full arch scan done.' });
let r2 = e2eCtx.saveToDailyRegister({ ...base, procedureDone: 'Local Anesthesia', workDone: 'LA administered.' });

const allRows = e2eCtx.__sheet.getDataRange().getValues();
const headers2 = allRows[0];
const col2 = (name) => headers2.indexOf(name);
const dataRows = allRows.slice(1).filter(r => r[col2('UHID')]);

eq('three same-day saves for one patient -> exactly one register row', dataRows.length, 1);
eq('second save reports merged, not a fresh append', r1.merged, true);
eq('third save also merges into the same row', r2.merged, true);
eq('Procedure Done lists all three, combined', dataRows[0][col2('Procedure Done')],
  'X-ray | Digital Scan | Local Anesthesia');
eq('Work Done lists all three, combined', dataRows[0][col2('Work Done')],
  'X-ray taken, wrt 26. | Full arch scan done. | LA administered.');

// A different day for the same patient must NOT merge into that row.
e2eCtx.saveToDailyRegister({ ...base, date: '2026-08-26', procedureDone: 'Scaling', workDone: 'Full mouth scaling.' });
const afterNextDay = e2eCtx.__sheet.getDataRange().getValues().slice(1).filter(r => r[col2('UHID')]);
eq('a different day for the same patient creates a new row, not a merge', afterNextDay.length, 2);

// A different patient, same day, must NOT merge either.
e2eCtx.saveToDailyRegister({ uhid: 'AL0888', patientName: 'Other Patient', date: '2026-08-25', procedureDone: 'Consultation' });
const afterOtherPatient = e2eCtx.__sheet.getDataRange().getValues().slice(1).filter(r => r[col2('UHID')]);
eq('a different patient on the same day creates a new row, not a merge', afterOtherPatient.length, 3);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(74));
console.log('DAILY REGISTER — SAME-DAY MERGE');
console.log('='.repeat(74));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
