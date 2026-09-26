// The Apps Script project is copied to make a new instance — the empanelled
// book, a new branch. A copy carries Code.gs's hardcoded file IDs with it, so
// a bare `stored || SOME_MAIN_CLINIC_ID` default sends that instance's clinical
// records and its money into K. B. Dental's own files. Nothing on screen would
// say so, and the frontend instance guard cannot prevent it — by then the
// request is already inside the wrong project.
//
// This runs the real getFinanceSheetId / getClinicalSheetId against a fake
// Script Properties store, once as the main clinic's book and once as a copy.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const MAIN = '1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4';
const FINANCE = '1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI';
const COPY = '1COPYcopyCOPYcopyCOPYcopyCOPYcopyCOPYcopy';

function slice(from, to) {
  const a = GS.indexOf(from);
  const b = GS.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('could not slice ' + from);
  return GS.slice(a, b);
}

// Everything from the guard down to the end of getFinanceSheetId, plus the two
// clinical-id functions — the real source, not a copy of it.
const guardSrc = slice('var MAIN_PMS_SHEET_ID', '// DANGER, historically:');
const clinicalSrc = slice('var CLINICAL_SHEET_ID_DEFAULT', 'function getClinicalSheet(');

function load(ssId, props) {
  const PropertiesService = {
    getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }),
  };
  return new Function('SS_ID', 'PropertiesService',
    guardSrc + '\n' + clinicalSrc +
    '\nreturn { getFinanceSheetId, getClinicalSheetId, defaultSheetId_ };'
  )(ssId, PropertiesService);
}

// --- the main clinic's own book: unchanged behaviour -----------------------
const main = load(MAIN, {});
eq('the main clinic still gets its finance sheet', main.getFinanceSheetId(), FINANCE);
eq('the main clinic still gets its PMS book for clinical records',
  main.getClinicalSheetId(), MAIN);

// --- a copy: must keep to itself ------------------------------------------
const copy = load(COPY, {});
ok('a copy never falls back to the main clinic\'s finance sheet',
  copy.getFinanceSheetId() !== FINANCE, copy.getFinanceSheetId());
eq('a copy keeps its money in itself', copy.getFinanceSheetId(), COPY);
ok('a copy never falls back to the main clinic\'s PMS book',
  copy.getClinicalSheetId() !== MAIN, copy.getClinicalSheetId());
eq('a copy keeps its clinical records in itself', copy.getClinicalSheetId(), COPY);

// --- an explicit Script Property still wins, in either book ---------------
eq('a set FINANCE_SHEET_ID is honoured in the main clinic',
  load(MAIN, { FINANCE_SHEET_ID: 'X1' }).getFinanceSheetId(), 'X1');
eq('a set FINANCE_SHEET_ID is honoured in a copy',
  load(COPY, { FINANCE_SHEET_ID: 'X2' }).getFinanceSheetId(), 'X2');
eq('a set CLINICAL_SHEET_ID is honoured in a copy',
  load(COPY, { CLINICAL_SHEET_ID: 'X3' }).getClinicalSheetId(), 'X3');

// --- and the source itself must not reintroduce a bare default ------------
ok('the finance id goes through the copy-safe default',
  /return stored \|\| defaultSheetId_\(FINANCE_SHEET_ID_DEFAULT\)/.test(GS));
ok('the clinical id goes through the copy-safe default',
  /return stored \|\| defaultSheetId_\(CLINICAL_SHEET_ID_DEFAULT\)/.test(GS));
// The one-off copy tool reads the records out of THIS book. Reading from a
// hardcoded main-clinic id would copy K. B. Dental's records into the
// empanelled instance's new file.
ok('the copy tool reads this book\'s own records',
  /var from = SpreadsheetApp\.openById\(getClinicalSheetId\(\)\)/.test(GS));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('A COPIED BOOK NEVER FALLS BACK TO THE MAIN CLINIC\'S FILES');
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
