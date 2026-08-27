// Checks how a receipt is laid out for the finance sheet.
//
// The receipt chain is: Patient Fee Receipt -> Working -> Receipt No. / FY tabs.
// saveReceipt writes the entry tab ("Patient Fee Receipt") AND mirrors into
// "Working", which is what Receipt No. / the FY tabs / the E. Receipt No.
// sequence actually read from — the clinic's own Google Form writes straight
// into Working, so nothing else moves an app-saved receipt across on its own.
//
// History: an earlier version of the mirror wrote via mirror.getLastRow()+1,
// which is unsafe on a tab carrying a spilled ARRAYFORMULA (getLastRow()
// counts the formula's spilled output as if it were real data, landing the
// write ~190 rows past the actual last row and breaking the receipt
// numbering). A later version removed the mirror entirely to stop that, which
// stopped the corruption but also meant a receipt saved through the app never
// reached Working at all. The mirror is back, but the row it targets is now
// found by scanning a real data column from the bottom up (finFirstFreeRow_),
// the same fix already proven correct on the entry tab, never by trusting
// getLastRow().
//
// Headers below are copied verbatim from the live sheet, trailing spaces and
// all, since matching them is the point.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'out', 'Code.gs'), 'utf8');
const from = src.indexOf('function finCol_(');
const to = src.indexOf('function saveReceipt(p) {');
if (from < 0 || to < 0) { console.error('could not locate the receipt helpers'); process.exit(1); }

// The slice above also carries the gap-closing maintenance helpers, which read
// these two tab-name constants at load time (they are exercised properly in
// working-gap.test.js).
const ctx = { SpreadsheetApp: null, FIN_ENTRY_TAB: 'Patient Fee Receipt', FIN_MIRROR_TAB: 'Working' };
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) +
  ';this.finCol_ = finCol_; this.finReceiptRow_ = finReceiptRow_; this.finFirstFreeRow_ = finFirstFreeRow_;' +
  'this.localDateFromISO_ = localDateFromISO_;', ctx);
const { finCol_, finReceiptRow_, finFirstFreeRow_, localDateFromISO_ } = ctx;

// A minimal stand-in for a Sheet, enough for finFirstFreeRow_'s getLastRow()
// and getRange(...).getValues() calls. expectedCol (1-based), when given,
// asserts finFirstFreeRow_ actually asked for that column rather than
// silently defaulting to column A regardless of what was passed in.
function fakeSheet(colValues, lastRowOverride, expectedCol) {
  return {
    getLastRow: () => lastRowOverride !== undefined ? lastRowOverride : colValues.length,
    getRange: (row, c, numRows) => {
      if (expectedCol !== undefined && c !== expectedCol) {
        throw new Error(`expected getRange to be called with column ${expectedCol}, got ${c}`);
      }
      return { getValues: () => colValues.slice(row - 1, row - 1 + numRows).map(v => [v]) };
    },
  };
}

const ENTRY_HEADERS = ['Timestamp', 'UHID', "Patient's Name ", 'Nature of Professional Services',
  'Payment Mode', 'Amount', 'Payment Mode (Payment mode is more than one)',
  'Amount (Payment mode is more than one)', 'Remarks (If any)', 'Checked'];

const stamp = new Date('2026-08-22T00:00:00');
const p = {
  uhid: 'AL0777', patientName: 'Nafees Mirza', service: 'Consultation',
  mode1: 'Cash', amount1: '500', mode2: 'UPI', amount2: '250',
  remarks: 'part cash part upi',
};

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// --- entry tab -------------------------------------------------------------
const entry = finReceiptRow_(ENTRY_HEADERS, p, stamp);
eq('entry: Timestamp is a real Date, not text', entry[0] instanceof Date, true);
eq('entry: UHID',            entry[1], 'AL0777');
eq("entry: Patient's Name (trailing space in header)", entry[2], 'Nafees Mirza');
eq('entry: service',         entry[3], 'Consultation');
eq('entry: mode 1',          entry[4], 'Cash');
eq('entry: amount 1 numeric', entry[5], 500);
eq('entry: mode 2',          entry[6], 'UPI');
eq('entry: amount 2 numeric', entry[7], 250);
eq('entry: remarks',         entry[8], 'part cash part upi');
eq('entry: "Checked" left alone for the clinic', entry[9], '');
eq('entry: row width matches the tab', entry.length, ENTRY_HEADERS.length);

// --- a single (non-split) payment -----------------------------------------
const single = finReceiptRow_(ENTRY_HEADERS,
  { uhid: 'AL0778', patientName: 'X', service: 'Scaling', mode1: 'Cash', amount1: '800',
    mode2: '', amount2: '', remarks: '' }, stamp);
eq('single payment: second mode blank',   single[6], '');
eq('single payment: second amount blank', single[7], '');
eq('single payment: first amount numeric', single[5], 800);

// --- header matching is order-independent ---------------------------------
const SHUFFLED = ['UHID', 'Amount', 'Timestamp', "Patient's Name"];
const sh = finReceiptRow_(SHUFFLED, p, stamp);
eq('reordered headers: UHID follows its column',   sh[0], 'AL0777');
eq('reordered headers: Amount follows its column', sh[1], 500);
eq('reordered headers: Name follows its column',   sh[3], 'Nafees Mirza');

// --- an unknown column is left empty rather than guessed -------------------
const EXTRA = ENTRY_HEADERS.concat(['Some Future Column']);
eq('unknown column left empty', finReceiptRow_(EXTRA, p, stamp)[10], '');

// --- finFirstFreeRow_: the fix for the actual production bug ---------------
// This is the guard against the exact failure the clinic hit: a mirror write
// used getLastRow()+1 on a tab with a spilled ARRAYFORMULA, which reported a
// row ~190 past the real data and broke the E. Receipt No. sequence. The
// entry tab has no formulas today, but the function must still find the true
// last row by content, not by trusting getLastRow() blindly.

// Plain case: header row + 3 real rows, no gaps.
eq('firstFreeRow: right after 3 real rows',
  finFirstFreeRow_(fakeSheet(['Timestamp', new Date(), new Date(), new Date()])), 5);

// Empty sheet (header only).
eq('firstFreeRow: header only -> row 2', finFirstFreeRow_(fakeSheet(['Timestamp'])), 2);

// Truly empty sheet (getLastRow() returns 0).
eq('firstFreeRow: getLastRow() 0 -> row 2', finFirstFreeRow_(fakeSheet([], 0)), 2);

// The exact shape of the reported bug: getLastRow() says far more rows exist
// (spilled formula output) than actually have data in column A.
eq('firstFreeRow: ignores spilled rows past the real data',
  finFirstFreeRow_(fakeSheet(['Timestamp', new Date(), new Date(), '', '', '', '', ''])), 4);

// The same helper is now also used to target the Working mirror, scanning
// whatever column is actually passed in (UHID there, not necessarily
// column A) — confirms the column argument is honored, not defaulted away.
eq('firstFreeRow: scans column 3 when asked to, not column A',
  finFirstFreeRow_(fakeSheet(['UHID', 'AL0777', 'AL0778', '', '', '', '', ''], undefined, 3), 3), 4);

// --- localDateFromISO_: the timestamp-showing-05:30-instead-of-midnight fix
// new Date("2026-08-22") parses as UTC midnight, which an IST-timezone sheet
// then displays as 05:30 — not the plain local midnight every historical row
// (fed by the clinic's own Google Form) actually shows.
const local = localDateFromISO_('2026-08-22');
eq('localDateFromISO_: year/month/day match the input, not shifted by UTC parsing',
  [local.getFullYear(), local.getMonth(), local.getDate()], [2026, 7, 22]);
eq('localDateFromISO_: local midnight, not 05:30', [local.getHours(), local.getMinutes()], [0, 0]);
eq('localDateFromISO_: garbage input returns null, so saveReceipt falls back to "now"',
  localDateFromISO_('not a date'), null);
eq('localDateFromISO_: empty input returns null', localDateFromISO_(''), null);

// --- the mirror row must stop before Working's computed Date/Time columns -
const MIRROR_HEADERS = ['Timestamp', 'UHID', "Patient's Name ", 'Nature of Professional Services',
  'Payment Mode', 'Amount', 'Payment Mode (Payment mode is more than one)',
  'Amount (Payment mode is more than one)', 'Date', 'Time'];
const dateCol = finCol_(MIRROR_HEADERS, ['Date']);
const timeCol = finCol_(MIRROR_HEADERS, ['Time']);
let lastWritable = MIRROR_HEADERS.length;
[dateCol, timeCol].forEach(c => { if (c >= 0 && c < lastWritable) lastWritable = c; });
const mirrorRow = finReceiptRow_(MIRROR_HEADERS, p, stamp).slice(0, lastWritable);
eq('mirror row: stops before the ARRAYFORMULA columns (Date, Time)', mirrorRow.length, 8);
eq('mirror row: still carries the amounts', [mirrorRow[5], mirrorRow[7]], [500, 250]);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(74));
console.log('RECEIPT ROW — FINANCE SHEET LAYOUT');
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
