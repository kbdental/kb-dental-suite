// The finance workbook names its amount columns after how the money arrived —
// CASH, QR Code, NEFT/RTGS, Cheque, SWIPE — which is a second vocabulary
// beside the payment-mode list. QR Code becomes UPI / GPay and SWIPE becomes
// Card so the book calls one thing by one name.
//
// This is safe in a way the Mode CELLS were not. Renaming those was refused
// because 2,801 formulas test for the literal "UPI" to decide which column a
// payment lands in. The HEADINGS are read by nothing. The script still checks,
// because "nobody reads it" is a claim about a book that keeps changing.

const fs = require('fs');
const path = require('path');

const GS = fs.readFileSync(path.join(__dirname, '..',
  'apps-script/maintenance/rename-finance-headings.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

class Sheet {
  constructor(name, rows, formulas) {
    this.name = name; this.rows = rows.map(r => r.slice()); this.f = formulas || {};
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, r) => Math.max(n, r.length), 0); }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues: () => { const o = []; for (let i = 0; i < nr; i++)
        o.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      getFormulas: () => { const o = []; for (let i = 0; i < nr; i++) {
        const row = []; for (let j = 0; j < nc; j++) row.push(s.f[(r + i) + ',' + (c + j)] || '');
        o.push(row); } return o; },
      setValue: (v) => { s.rows[r - 1][c - 1] = v; },
      getA1Notation: () => 'R' + r + 'C' + c,
    };
  }
}
const Book = (sheets) => ({ getName: () => 'Finance', getId: () => 'FIN', getSheets: () => sheets });

function boot(sheets, confirm) {
  const logged = [];
  const fmt = (f, ...a) => { let i = 0; return String(f).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s')); };
  const api = new Function('SpreadsheetApp', 'Logger',
    GS.replace('var CONFIRM_HEADINGS = "";', 'var CONFIRM_HEADINGS = "' + (confirm || '') + '";') +
    '\nreturn { reportHeadingRenames, renameFinanceHeadings, renamedHeading_ };'
  )({ getActiveSpreadsheet: () => Book(sheets), openById: () => Book(sheets) },
    { log: (...a) => logged.push(fmt(...a)) });
  return { api, logged };
}

const fy = () => new Sheet('FY 2025-26', [
  ['Sl. No.', 'Mode', 'CASH', 'QR Code', 'NEFT/RTGS', 'Cheque', 'SWIPE Amount', 'SWIPE Received'],
  [1, 'UPI', '', 18000, '', '', '', ''],
]);
const totals = () => new Sheet('Total', [
  ['Month', 'CASH Collection', 'QR Code Collection', 'SWIPED Amount Total', 'SWIPE Received Total'],
  ['April', 1, 2, 3, 4],
]);

// --- the renaming itself, including the longer forms ----------------------
{
  const { api } = boot([fy()]);
  const r = api.renamedHeading_;
  eq('QR Code', r('QR Code'), 'UPI / GPay');
  eq('QR Code Collection', r('QR Code Collection'), 'UPI / GPay Collection');
  // CARD in capitals: FY 2026-27 was already renamed by hand that way, and
  // the renamed years have to agree with the current one, not introduce a
  // third spelling.
  eq('SWIPE Amount', r('SWIPE Amount'), 'CARD Amount');
  eq('SWIPE Received', r('SWIPE Received'), 'CARD Received');
  // SWIPED must be handled before SWIPE, or it half-matches into "CARDD".
  eq('SWIPED Amount Total', r('SWIPED Amount Total'), 'CARD Amount Total');
  // Exactly what the current year already reads, so the book ends up uniform.
  eq('matches the current year, heading for heading',
    ['QR Code', 'SWIPE Amount', 'SWIPE Received'].map(r),
    ['UPI / GPay', 'CARD Amount', 'CARD Received']);
  eq('and its Total tab too',
    ['QR Code Collection', 'SWIPED Amount Total', 'SWIPE Received Total'].map(r),
    ['UPI / GPay Collection', 'CARD Amount Total', 'CARD Received Total']);
  // A tab already renamed must be left completely alone on a re-run.
  eq('an already-renamed heading is not touched again', r('UPI / GPay'), null);
  eq('nor is CARD Amount', r('CARD Amount'), null);
  eq('a heading with neither word is left alone', r('NEFT/RTGS'), null);
  eq('and so is an empty cell', r(''), null);
}

// --- the dry run changes nothing -----------------------------------------
{
  const a = fy(), b = totals();
  const before = JSON.stringify([a.rows, b.rows]);
  const { api, logged } = boot([a, b]);
  api.reportHeadingRenames();
  eq('the dry run changes nothing', JSON.stringify([a.rows, b.rows]), before);
  ok('it lists what would change', logged.some(l => /"QR Code"  ->  "UPI \/ GPay"/.test(l)), logged);
  ok('and confirms no formula reads them',
    logged.some(l => /changes nothing but the words on screen/.test(l)), logged);
}

// --- no confirmation, no write -------------------------------------------
{
  const a = fy();
  const before = JSON.stringify(a.rows);
  const { api, logged } = boot([a]);
  api.renameFinanceHeadings();
  eq('nothing without CONFIRM_HEADINGS', JSON.stringify(a.rows), before);
  ok('and it says why', logged.some(l => /CONFIRM_HEADINGS is not set/.test(l)), logged);
}

// --- the write ------------------------------------------------------------
{
  const a = fy(), b = totals();
  const { api } = boot([a, b], 'YES');
  api.renameFinanceHeadings();
  eq('the FY headings are renamed', a.rows[0],
    ['Sl. No.', 'Mode', 'CASH', 'UPI / GPay', 'NEFT/RTGS', 'Cheque', 'CARD Amount', 'CARD Received']);
  eq('the Total headings too', b.rows[0],
    ['Month', 'CASH Collection', 'UPI / GPay Collection', 'CARD Amount Total', 'CARD Received Total']);
  // The whole point: only row 1.
  eq('no data row is touched', a.rows[1], [1, 'UPI', '', 18000, '', '', '', '']);
  eq('and the Mode cell still says UPI, as 2801 formulas require', a.rows[1][1], 'UPI');
}

// --- a heading produced by a formula is not overwritten with text ---------
{
  const a = new Sheet('FY 2024-25', [['Mode', 'QR Code'], ['UPI', 1]], { '1,2': "='Total'!C1" });
  const { api, logged } = boot([a], 'YES');
  api.renameFinanceHeadings();
  eq('a formula heading is left as a formula', a.rows[0][1], 'QR Code');
  const dry = boot([a]); dry.api.reportHeadingRenames();
  ok('and the report says it was skipped',
    dry.logged.some(l => /SKIPPED — it is a formula/.test(l)), dry.logged);
}

// --- a formula naming a heading stops it ---------------------------------
{
  const a = fy();
  const t = new Sheet('Total', [['Month', 'X'], ['April', 0]],
    { '2,2': "=QUERY('FY 2025-26'!A:Z,\"select sum(D) where B='QR Code'\")" });
  const before = JSON.stringify(a.rows);
  const { api, logged } = boot([a, t], 'YES');
  api.renameFinanceHeadings();
  eq('refused while a formula names one', JSON.stringify(a.rows), before);
  ok('and it says which', logged.some(l => /QR Code/.test(l)), logged);
}

// --- a formula naming UPI is irrelevant here ------------------------------
// The book is full of them and they have nothing to do with headings.
{
  const a = fy();
  const t = new Sheet('Total', [['Month', 'X'], ['April', 0]],
    { '2,2': '=IF(Working!$E2="UPI",Working!$F2,"")' });
  const { api } = boot([a, t], 'YES');
  api.renameFinanceHeadings();
  eq('the 2801 UPI formulas do not block a heading rename',
    a.rows[0][3], 'UPI / GPay');
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('FINANCE HEADINGS — WORDS ON SCREEN, AND NOTHING ELSE');
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
