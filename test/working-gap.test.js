// Checks the maintenance pair that closes the self-perpetuating blank gap in
// the finance sheet's "Patient Fee Receipt" and "Working" tabs.
//
// Background: the original mirror bug stranded a block of REAL receipts far
// below the rest of the data. The clinic's Google Form appends below the last
// row containing anything, so every new response landed under the stranded
// block and the hole was preserved. The one thing that must never happen while
// closing it is deleting a row that carries data — these are live financial
// records — so that invariant is what most of this file checks.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'out', 'Code.gs'), 'utf8');
function grab(startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  const to = src.indexOf(endMarker, from);
  if (from < 0 || to < 0) { console.error('could not locate ' + startMarker); process.exit(1); }
  return src.slice(from, to);
}

const code =
  grab('function finCol_(', '// Builds the row against') +
  grab('var FIN_GAP_TABS', '// A receipt\'s date arrives');

// A stand-in for one finance tab. Row 1 is the header; `rows` are the data
// rows below it, each a full-width array.
function fakeSheet(headers, rows) {
  const grid = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    _grid: grid,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => grid.slice(row - 1, row - 1 + numRows)
                             .map(r => r.slice(col - 1, col - 1 + numCols))
      };
    },
    deleteRows(start, count) { grid.splice(start - 1, count); }
  };
}

const logs = [];
// `tabs` maps tab name -> fakeSheet, so a test can supply one tab or both.
function makeCtx(tabs) {
  const ctx = {
    FIN_ENTRY_TAB: 'Patient Fee Receipt',
    FIN_MIRROR_TAB: 'Working',
    getFinanceSheetId: () => 'FAKE',
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => tabs[n] || null }) },
    Logger: { log: (...a) => logs.push(a.join(' ')) }
  };
  vm.createContext(ctx);
  vm.runInContext(code +
    ';this.finScanTab_=finScanTab_;this.closeFinanceGaps=closeFinanceGaps;' +
    'this.reportFinanceGaps=reportFinanceGaps;this.finDataWidth_=finDataWidth_;' +
    'this.finCellEmpty_=finCellEmpty_;this.FIN_GAP_TABS=FIN_GAP_TABS;', ctx);
  return ctx;
}
// Most tests only care about one tab; give the other an already-clean stub.
const cleanStub = () => fakeSheet(['UHID'], [['X1']]);

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'true' });

// Working's shape: typed columns, then ARRAYFORMULA'd Date and Time.
const W_HEADERS = ['Sl. No.', 'UHID', "Patient's Name", 'Fee', 'Date', 'Time'];
const wRow = (sl, uhid, name, fee) => [sl, uhid, name, fee, '', ''];
// A row nobody typed into, but whose Date/Time carry ARRAYFORMULA spill — the
// exact shape that made getLastRow() lie and caused this whole mess.
const wSpill = () => ['', '', '', '', '2026-08-27', '10:30'];

// Patient Fee Receipt's shape: no Date/Time, but a trailing "Checked" checkbox
// column whose unticked boxes are a real `false` on every formatted row.
const E_HEADERS = ['Timestamp', 'UHID', "Patient's Name", 'Amount', 'Checked'];
const eRow = (ts, uhid, name, amt) => [ts, uhid, name, amt, false];
const eBlankBox = () => ['', '', '', '', false];   // blank row, checkbox present

// ── the reported scenario in Working: data, blank run, stranded receipts ──
{
  const sheet = fakeSheet(W_HEADERS, [
    wRow(1, 'AH0507', 'Kamal Chawla', 5000),
    wRow(2, 'AG0508', 'Yatik Choudhary', 1000),
    wSpill(), wSpill(), wSpill(),
    wRow(3, 'AC1014', 'Sudhir Batra', 15000)   // stranded below the gap
  ]);
  const ctx = makeCtx({ 'Working': sheet, 'Patient Fee Receipt': cleanStub() });

  const scan = ctx.finScanTab_('Working');
  eq('spill-only rows are not counted as data', scan.filled, [2, 3, 7]);
  eq('the blank run between data is found', scan.gaps, [{ start: 4, end: 6, count: 3 }]);

  ctx.closeFinanceGaps();
  const after = sheet._grid;
  eq('every data row survived', after.length, 4);           // header + 3 data
  eq('the stranded receipt slid up into sequence', after[3][1], 'AC1014');
  ok('no blank row left between data',
    after.slice(1).every(r => r.slice(0, 4).some(v => v !== '')), after.slice(1));
}

// ── the checkbox trap in Patient Fee Receipt ──────────────────────────────
{
  const sheet = fakeSheet(E_HEADERS, [
    eRow('17/08/2026', 'AL0803', 'Sachin Sareen', 4000),
    eBlankBox(), eBlankBox(),
    eRow('27/08/2026', 'AC1014', 'Sudhir Batra', 15000)
  ]);
  const ctx = makeCtx({ 'Patient Fee Receipt': sheet, 'Working': cleanStub() });

  const scan = ctx.finScanTab_('Patient Fee Receipt');
  eq('an unticked checkbox does not make a blank row look like data', scan.filled, [2, 5]);
  eq('the gap is found despite the checkbox column', scan.gaps, [{ start: 3, end: 4, count: 2 }]);

  ctx.closeFinanceGaps();
  eq('both real receipts kept', sheet._grid.slice(1).map(r => r[1]), ['AL0803', 'AC1014']);
}

// ── a zero amount is still a receipt, and must never be deleted ───────────
{
  const sheet = fakeSheet(E_HEADERS, [
    eRow('22/08/2026', 'AH0507', 'Kamal Chawla', 0),   // a real 0-value row
    eBlankBox(),
    eRow('27/08/2026', 'AC1014', 'Sudhir Batra', 15000)
  ]);
  const ctx = makeCtx({ 'Patient Fee Receipt': sheet, 'Working': cleanStub() });
  ctx.closeFinanceGaps();
  eq('a zero-amount receipt survives', sheet._grid.slice(1).map(r => r[1]), ['AH0507', 'AC1014']);
}

// ── data width stops before the columns that lie ──────────────────────────
{
  const ctx = makeCtx({ 'Working': cleanStub(), 'Patient Fee Receipt': cleanStub() });
  eq('width stops at the Date column', ctx.finDataWidth_(W_HEADERS), 4);
  eq('width stops at the Checked column', ctx.finDataWidth_(E_HEADERS), 4);
  eq('no Date/Time/Checked -> full width', ctx.finDataWidth_(['A', 'B', 'C']), 3);
  eq('false reads as empty (checkbox)', ctx.finCellEmpty_(false), true);
  eq('zero does NOT read as empty', ctx.finCellEmpty_(0), false);
}

// ── trailing blanks below the last data row are left alone ────────────────
{
  const sheet = fakeSheet(W_HEADERS, [
    wRow(1, 'A1', 'One', 100), wRow(2, 'A2', 'Two', 200), wSpill(), wSpill()
  ]);
  const ctx = makeCtx({ 'Working': sheet, 'Patient Fee Receipt': cleanStub() });
  eq('trailing blanks are not treated as a gap', ctx.finScanTab_('Working').gaps, []);
  ctx.closeFinanceGaps();
  eq('nothing deleted when the only blanks are trailing', sheet._grid.length, 5);
}

// ── several gaps at once, deleted bottom-up without shifting each other ───
{
  const sheet = fakeSheet(W_HEADERS, [
    wRow(1, 'A1', 'One', 100),
    wSpill(),
    wRow(2, 'A2', 'Two', 200),
    wSpill(), wSpill(),
    wRow(3, 'A3', 'Three', 300)
  ]);
  const ctx = makeCtx({ 'Working': sheet, 'Patient Fee Receipt': cleanStub() });
  eq('both gaps found', ctx.finScanTab_('Working').gaps,
    [{ start: 3, end: 3, count: 1 }, { start: 5, end: 6, count: 2 }]);
  ctx.closeFinanceGaps();
  eq('all three data rows kept, in order',
    sheet._grid.slice(1).map(r => r[1]), ['A1', 'A2', 'A3']);
}

// ── both tabs cleaned in one run ──────────────────────────────────────────
{
  const w = fakeSheet(W_HEADERS, [wRow(1, 'W1', 'One', 1), wSpill(), wRow(2, 'W2', 'Two', 2)]);
  const e = fakeSheet(E_HEADERS, [eRow('d', 'E1', 'One', 1), eBlankBox(), eRow('d', 'E2', 'Two', 2)]);
  const ctx = makeCtx({ 'Working': w, 'Patient Fee Receipt': e });
  ctx.closeFinanceGaps();
  eq('Working closed', w._grid.slice(1).map(r => r[1]), ['W1', 'W2']);
  eq('Patient Fee Receipt closed', e._grid.slice(1).map(r => r[1]), ['E1', 'E2']);
}

// ── an already-clean sheet is left completely untouched ───────────────────
{
  const sheet = fakeSheet(W_HEADERS, [wRow(1, 'A1', 'One', 100), wRow(2, 'A2', 'Two', 200)]);
  const ctx = makeCtx({ 'Working': sheet, 'Patient Fee Receipt': cleanStub() });
  const before = JSON.stringify(sheet._grid);
  ctx.closeFinanceGaps();
  eq('a clean sheet is not modified', JSON.stringify(sheet._grid), before);
}

// ── reportFinanceGaps never mutates ───────────────────────────────────────
{
  const sheet = fakeSheet(W_HEADERS, [wRow(1, 'A1', 'One', 100), wSpill(), wRow(2, 'A2', 'Two', 200)]);
  const ctx = makeCtx({ 'Working': sheet, 'Patient Fee Receipt': cleanStub() });
  const before = JSON.stringify(sheet._grid);
  ctx.reportFinanceGaps();
  eq('report changes nothing', JSON.stringify(sheet._grid), before);
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('FINANCE TABS — CLOSING THE BLANK GAP SAFELY');
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
