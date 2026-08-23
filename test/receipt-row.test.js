// Checks how a receipt is laid out for the finance sheet.
//
// The receipt chain is: Patient Fee Receipt -> Working -> Receipt No. / FY tabs.
// saveReceipt writes ONLY the entry tab ("Patient Fee Receipt") — an earlier
// version also mirrored the row into "Working" using getLastRow(), which is
// unsafe on a tab carrying a spilled ARRAYFORMULA (it lands the row far past
// the real data). That mirror is gone; whatever keeps Working in step with
// the entry tab today is the clinic's own existing mechanism, untouched here.
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

const ctx = { SpreadsheetApp: null };
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) +
  ';this.finCol_ = finCol_; this.finReceiptRow_ = finReceiptRow_; this.finFirstFreeRow_ = finFirstFreeRow_;', ctx);
const { finCol_, finReceiptRow_, finFirstFreeRow_ } = ctx;

// A minimal stand-in for a Sheet, enough for finFirstFreeRow_'s getLastRow()
// and getRange(...).getValues() calls.
function fakeSheet(colAValues, lastRowOverride) {
  return {
    getLastRow: () => lastRowOverride !== undefined ? lastRowOverride : colAValues.length,
    getRange: (row, col, numRows) => ({
      getValues: () => colAValues.slice(row - 1, row - 1 + numRows).map(v => [v]),
    }),
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
