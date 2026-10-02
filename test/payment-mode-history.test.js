// Renaming "Net Banking" -> "NEFT/RTGS" and "UPI" -> "UPI / GPay" across the
// clinic's financial history is not a find-and-replace. Three things must
// hold, and each has cost someone somewhere real money when it did not:
//
//   1. Only payment-mode COLUMNS are touched. The word "UPI" in a remarks
//      note is prose, and rewriting it is editing someone's sentence.
//   2. Whole-cell matches only. "UPI" must not eat the "UPI" inside a cell
//      already correctly reading "UPI / GPay".
//   3. If any FORMULA matches on the old text, the conversion is refused. In
//      the finance book the Mode column decides which amount column a payment
//      lands in, and the monthly Totals add those up — a SUMIF on "UPI" would
//      quietly move a month's collection figure.

const fs = require('fs');
const path = require('path');

const GS = fs.readFileSync(path.join(__dirname, '..',
  'apps-script/maintenance/payment-mode-history.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

class Sheet {
  constructor(name, rows, formulas) {
    this.name = name; this.rows = rows.map(r => r.slice());
    this.f = formulas || {};
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, r) => Math.max(n, r.length), 0); }
  getRange(r, c, nr, nc) {
    const s = this;
    nr = nr || 1; nc = nc || 1;
    return {
      getValues: () => { const o = []; for (let i = 0; i < nr; i++)
        o.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      setValues: (v) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++)
        s.rows[r - 1 + i][c - 1 + j] = v[i][j]; },
      getFormulas: () => { const o = []; for (let i = 0; i < nr; i++) {
        const row = []; for (let j = 0; j < nc; j++) row.push(s.f[(r + i) + ',' + (c + j)] || '');
        o.push(row); } return o; },
      getA1Notation: () => 'R' + r + 'C' + c,
    };
  }
}
const Book = (sheets) => ({
  getName: () => 'Test Book',
  getId: () => 'TEST_BOOK_ID',
  getSheets: () => sheets,
});

function boot(sheets, confirm, opts) {
  opts = opts || {};
  const logged = [];
  const fmt = (f, ...a) => { let i = 0; return String(f).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s')); };
  const opened = [];
  const SpreadsheetApp = {
    // A STANDALONE project — the finance workbook's is one — has no active
    // spreadsheet at all, and returns null here rather than throwing.
    getActiveSpreadsheet: () => (opts.standalone ? null : Book(sheets)),
    openById: (id) => { opened.push(id); return Book(sheets); },
  };
  let src = GS.replace('var CONFIRM_CONVERT = "";', 'var CONFIRM_CONVERT = "' + (confirm || '') + '";');
  if (opts.targetId !== undefined) {
    src = src.replace('var TARGET_SHEET_ID = "";', 'var TARGET_SHEET_ID = "' + opts.targetId + '";');
  }
  const api = new Function('SpreadsheetApp', 'Logger',
    src + '\nreturn { reportPaymentModeUsage, convertPaymentModeHistory };'
  )(SpreadsheetApp, { log: (...a) => logged.push(fmt(...a)) });
  return { api, logged, opened };
}

const financeTab = () => new Sheet('FY 2025-26', [
  ['Sl. No.', 'Date', 'UHID', 'Mode', 'Fee', 'Remarks'],
  [1, '7-Apr-2025', 'AK0403', 'UPI', 18000, 'paid by UPI at the desk'],
  [2, '8-Apr-2025', 'AA1135', 'Net Banking', 50000, ''],
  [3, '9-Apr-2025', 'AH1108', 'Cash', 3000, ''],
  [4, '9-Apr-2025', 'AH1109', 'UPI / GPay', 2000, ''],
  [5, '9-Apr-2025', 'AH1110', 'upi', 1000, ''],
]);

// --- it has to work in a STANDALONE project, not just a bound one ---------
// The finance workbook's Apps Script project is standalone, so
// getActiveSpreadsheet() returns nothing there. A script assuming otherwise
// fails on its first line, and the failure says nothing useful.
{
  const sh = financeTab();
  const { api, opened } = boot([sh], '', { standalone: true, targetId: 'FIN123' });
  api.reportPaymentModeUsage();
  eq('a standalone project opens the book it was told to', opened, ['FIN123']);
}
{
  const sh = financeTab();
  const { api, opened } = boot([sh], '', { standalone: false, targetId: '' });
  api.reportPaymentModeUsage();
  eq('a bound project still uses the book it belongs to', opened, []);
}
{
  // Told nothing, attached to nothing: say so plainly instead of dying on a
  // null twenty lines later.
  const { api } = boot([financeTab()], '', { standalone: true, targetId: '' });
  let msg = '';
  try { api.reportPaymentModeUsage(); } catch (e) { msg = e.message; }
  ok('an unattached project explains itself', /not attached to a spreadsheet/.test(msg), msg);
  ok('and names the ids to choose from', /1Zdxq3Xf/.test(msg) && /1DtoZ3MN/.test(msg), msg);
}

// --- the dry run counts, and changes nothing ------------------------------
{
  const sh = financeTab();
  const before = JSON.stringify(sh.rows);
  const { api, logged } = boot([sh]);
  api.reportPaymentModeUsage();
  eq('the dry run changes nothing', JSON.stringify(sh.rows), before);
  ok('it counts the Net Banking rows', logged.some(l => /"net banking" -> "NEFT\/RTGS"  1 row/.test(l)), logged);
  ok('and gives a total', logged.some(l => /Total: 1 cell/.test(l)), logged);
  // "UPI" is the stored name now, so it is not something to convert.
  eq('UPI is never offered for conversion',
    logged.some(l => /"upi" ->/.test(l)), false);
}

// --- no confirmation, no write -------------------------------------------
{
  const sh = financeTab();
  const before = JSON.stringify(sh.rows);
  const { api, logged } = boot([sh]);
  api.convertPaymentModeHistory();
  eq('nothing is written without CONFIRM_CONVERT', JSON.stringify(sh.rows), before);
  ok('and it says why', logged.some(l => /CONFIRM_CONVERT is not set/.test(l)), logged);
}

// --- the conversion -------------------------------------------------------
{
  const sh = financeTab();
  const { api } = boot([sh], 'YES');
  api.convertPaymentModeHistory();
  const modes = sh.rows.slice(1).map(r => r[3]);
  // Only Net Banking moves. UPI is the stored name and must be left exactly
  // as it is — 2,801 formulas in the real book test for that literal word.
  eq('only Net Banking is converted; UPI is untouched',
    modes, ['UPI', 'NEFT/RTGS', 'Cash', 'UPI / GPay', 'upi']);
  // 1 above: prose is not a payment mode.
  eq('the word UPI in a remarks note is not touched',
    sh.rows[1][5], 'paid by UPI at the desk');
  eq('and no amount is altered', sh.rows.slice(1).map(r => r[4]),
    [18000, 50000, 3000, 2000, 1000]);
}

// --- a column that is not a payment mode is ignored entirely --------------
{
  const other = new Sheet('Notes', [
    ['Date', 'Comment'],
    ['1-Apr', 'UPI'],
    ['2-Apr', 'Net Banking'],
  ]);
  const { api } = boot([other], 'YES');
  api.convertPaymentModeHistory();
  eq('a sheet with no mode column is left alone',
    other.rows.slice(1).map(r => r[1]), ['UPI', 'Net Banking']);
}

// --- 3: a formula matching the old text stops everything -----------------
{
  const sh = financeTab();
  const totals = new Sheet('Total', [['Month', 'Net Banking Collection'], ['April', 0]],
    { '2,2': '=SUMIF(\'FY 2025-26\'!D:D,"Net Banking",\'FY 2025-26\'!E:E)' });
  const before = JSON.stringify(sh.rows);
  const { api, logged } = boot([sh, totals], 'YES');
  api.convertPaymentModeHistory();
  eq('the conversion is refused outright', JSON.stringify(sh.rows), before);
  ok('and it names the formula',
    logged.some(l => /SUMIF/.test(l)), logged);
  ok('saying renaming would change what it adds up',
    logged.some(l => /would change what they add up/.test(l)), logged);
}
{
  // The same must be visible in the read-only report, before anyone commits.
  const sh = financeTab();
  const totals = new Sheet('Total', [['Month', 'X'], ['April', 0]],
    { '2,2': '=QUERY(A:D,"select D where D = \'Net Banking\'")' });
  const { api, logged } = boot([sh, totals]);
  api.reportPaymentModeUsage();
  ok('the dry run warns about the formula too',
    logged.some(l => /STOP/.test(l)), logged);
  ok('and says the convert will refuse',
    logged.some(l => /will refuse/.test(l)), logged);
}

// A formula's literals may be single- or double-quoted, and QUERY — the most
// dangerous case, because it re-totals silently — uses single. Looking only
// for double quotes let that one through.
[
  ['double-quoted SUMIF', '=SUMIF(D:D,"Net Banking",E:E)'],
  ['single-quoted QUERY', '=QUERY(A:D,"select D where D = \'Net Banking\'")'],
  ['a spelling with odd spacing', '=COUNTIF(D:D,"Net  Banking")'],
].forEach(([label, formula]) => {
  const sh = financeTab();
  const t = new Sheet('Total', [['Month', 'X'], ['April', 0]], { '2,2': formula });
  const before = JSON.stringify(sh.rows);
  const { api } = boot([sh, t], 'YES');
  api.convertPaymentModeHistory();
  eq('refused because of a ' + label, JSON.stringify(sh.rows), before);
});

// A word that is NOT being renamed must not block anything. The finance book
// has 2,801 formulas testing for "UPI", which stays exactly as it is — a guard
// built on a hardcoded list rather than on MODE_RENAMES would have refused
// every conversion for ever because of them.
{
  const sh = financeTab();
  const t = new Sheet('Total', [['Month', 'X'], ['April', 0]],
    { '2,2': '=IF(Working!$E2="UPI",Working!$F2,"")' });
  const { api } = boot([sh, t], 'YES');
  api.convertPaymentModeHistory();
  eq('a formula on UPI does not block the Net Banking conversion',
    sh.rows[2][3], 'NEFT/RTGS');
  eq('and UPI itself is left alone', sh.rows[1][3], 'UPI');
}

// A formula already using the NEW name is correct and unaffected by the
// rename, so it must not block the conversion.
{
  const sh = financeTab();
  const t = new Sheet('Total', [['Month', 'X'], ['April', 0]],
    { '2,2': '=SUMIF(D:D,"UPI / GPay",E:E)' });
  const { api } = boot([sh, t], 'YES');
  api.convertPaymentModeHistory();
  eq('a formula on the new name does not block it',
    sh.rows[2][3], 'NEFT/RTGS');
}

// --- renaming the column HEADINGS is a separate question ------------------
// The clinic wants QR Code -> UPI / GPay and SWIPE -> Card so the sheet's
// vocabulary matches the one mode list. Nothing in the app reads those
// headings; the risk is entirely the spreadsheet's own formulas, so the
// report has to say whether any refers to them.
{
  const sh = financeTab();
  const t = new Sheet('Total', [['Month', 'QR Code Collection'], ['April', 0]],
    { '2,2': "=QUERY('FY 2025-26'!A:Z,\"select sum(J) where G='QR Code'\")" });
  const { api, logged } = boot([sh, t]);
  api.reportPaymentModeUsage();
  ok('a formula naming a heading is reported',
    logged.some(l => /formula\(s\) refer to them by name/.test(l)), logged);
  ok('and the heading is named', logged.some(l => /QR Code/.test(l)), logged);
}
{
  const sh = financeTab();
  const t = new Sheet('Total', [['Month', 'QR'], ['April', 0]], { '2,2': '=SUM(J2:J)' });
  const { api, logged } = boot([sh, t]);
  api.reportPaymentModeUsage();
  ok('a formula using column letters is not a problem',
    logged.some(l => /renaming them changes nothing but the words on screen/.test(l)), logged);
}

// --- a clean book says so -------------------------------------------------
{
  const clean = new Sheet('FY 2026-27', [['Date', 'Mode'], ['1-Apr', 'Cash']]);
  const { api, logged } = boot([clean]);
  api.reportPaymentModeUsage();
  ok('a book with nothing to do says so',
    logged.some(l => /Nothing to convert in this book/.test(l)), logged);
  ok('and confirms no formula is at risk',
    logged.some(l => /cannot change any total/.test(l)), logged);
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('RENAMING PAYMENT MODES IN HISTORY, WITHOUT MOVING ANY MONEY');
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
