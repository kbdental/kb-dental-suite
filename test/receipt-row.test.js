// Checks how a receipt is laid out for the finance sheet.
//
// The receipt chain is: Patient Fee Receipt -> Working -> Receipt No. / FY tabs.
// Two things make this easy to get wrong, and both are asserted here:
//
//   1. "Working" is not formula-linked to the entry tab — columns A:H are a
//      static mirror — so a row written only to the entry tab never reaches
//      "Receipt No.", which is what the app reads back.
//   2. Working's Date and Time columns are an ARRAYFORMULA spilling from row 2.
//      Writing into a spilled cell breaks the whole array, so the mirror must
//      stop before them.
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

const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) + ';this.finCol_ = finCol_; this.finReceiptRow_ = finReceiptRow_;', ctx);
const { finCol_, finReceiptRow_ } = ctx;

const ENTRY_HEADERS = ['Timestamp', 'UHID', "Patient's Name ", 'Nature of Professional Services',
  'Payment Mode', 'Amount', 'Payment Mode (Payment mode is more than one)',
  'Amount (Payment mode is more than one)', 'Remarks (If any)', 'Checked'];

const MIRROR_HEADERS = ['Timestamp', 'UHID', "Patient's Name ", 'Nature of Professional Services',
  'Payment Mode', 'Amount', 'Payment Mode (Payment mode is more than one)',
  'Amount (Payment mode is more than one)', 'Date', 'Time'];

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

// --- mirror tab ------------------------------------------------------------
const dateCol = finCol_(MIRROR_HEADERS, ['Date']);
const timeCol = finCol_(MIRROR_HEADERS, ['Time']);
let lastWritable = MIRROR_HEADERS.length;
[dateCol, timeCol].forEach(c => { if (c >= 0 && c < lastWritable) lastWritable = c; });
const mirror = finReceiptRow_(MIRROR_HEADERS, p, stamp).slice(0, lastWritable);

eq('mirror: stops before the ARRAYFORMULA columns', mirror.length, 8);
checks.push({ name: 'mirror: never reaches Date (col I)',
  ok: mirror.length <= dateCol, got: mirror.length, want: '<= ' + dateCol });
checks.push({ name: 'mirror: never reaches Time (col J)',
  ok: mirror.length <= timeCol, got: mirror.length, want: '<= ' + timeCol });
eq('mirror: carries the same amounts', [mirror[5], mirror[7]], [500, 250]);

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
