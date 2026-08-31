// Checks the fix for: two family members sharing one phone (very common with
// elderly patients) got flagged as duplicates of each other by mobile number
// alone, blocking the second person from getting their own UHID. Identity for
// this check is now name + date of birth; mobile is no longer part of it.

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
  grab('function findRegColumn_(', 'function saveRegistration(p)') +
  grab('function formatDOB(raw) {', 'function safeJSON(');

// A stand-in for the "Registrations" sheet.
const HEADERS = ['Timestamp', 'UHID', 'Full Name', 'Gender', 'Date of Birth', 'Mobile No.'];
function fakeSheet(rows) {
  const grid = [HEADERS, ...rows];
  return { getDataRange: () => ({ getValues: () => grid }) };
}

function makeCtx(rows) {
  const ctx = {
    getSheet: () => fakeSheet(rows),
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Asia/Kolkata' }) },
    Utilities: { formatDate: (d, tz, fmt) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.checkDuplicate=checkDuplicate;this.normaliseRegName_=normaliseRegName_;this.formatDOB=formatDOB;', ctx);
  return ctx;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// --- the reported scenario: two family members, same phone, different people
{
  const rows = [
    ['2026-01-01', 'AL0100', 'Kamla Devi', 'Female', '05/03/1948', '9876543210'],
  ];
  const ctx = makeCtx(rows);
  const res = ctx.checkDuplicate({ name: 'Ram Prasad', dob: '12/07/1945', mobile: '9876543210' });
  eq('same phone, different name+DOB -> not a duplicate', res.duplicate, false);
}

// --- the actual duplicate case: same person re-registering ------------------
{
  const rows = [
    ['2026-01-01', 'AL0100', 'Kamla Devi', 'Female', '05/03/1948', '9876543210'],
  ];
  const ctx = makeCtx(rows);
  const res = ctx.checkDuplicate({ name: 'Kamla Devi', dob: '05/03/1948', mobile: '9111111111' });
  eq('same name+DOB, even with a different phone -> duplicate', res.duplicate, true);
  eq('duplicate carries the existing UHID', res.existingUHID, 'AL0100');
}

// --- name matching is whitespace/case-insensitive ---------------------------
{
  const rows = [
    ['2026-01-01', 'AL0100', 'Kamla   Devi', 'Female', '05/03/1948', '9876543210'],
  ];
  const ctx = makeCtx(rows);
  const res = ctx.checkDuplicate({ name: '  kamla devi  ', dob: '05/03/1948', mobile: '' });
  eq('name match ignores case and extra whitespace', res.duplicate, true);
}

// --- same name, different DOB -> not a duplicate (e.g. father and son) ------
{
  const rows = [
    ['2026-01-01', 'AL0100', 'Suresh Kumar', 'Male', '01/01/1950', '9876543210'],
  ];
  const ctx = makeCtx(rows);
  const res = ctx.checkDuplicate({ name: 'Suresh Kumar', dob: '01/01/1980', mobile: '9876543210' });
  eq('same name, different DOB -> not a duplicate', res.duplicate, false);
}

// --- ISO-format DOB from the date picker matches a DD/MM/YYYY sheet value ---
{
  const rows = [
    ['2026-01-01', 'AL0100', 'Kamla Devi', 'Female', '05/03/1948', '9876543210'],
  ];
  const ctx = makeCtx(rows);
  const res = ctx.checkDuplicate({ name: 'Kamla Devi', dob: '1948-03-05', mobile: '' });
  eq('ISO-format input DOB still matches a DD/MM/YYYY sheet value', res.duplicate, true);
}

// --- missing name or DOB never claims a duplicate ---------------------------
{
  const rows = [['2026-01-01', 'AL0100', 'Kamla Devi', 'Female', '05/03/1948', '9876543210']];
  const ctx = makeCtx(rows);
  eq('no name -> not a duplicate', ctx.checkDuplicate({ name: '', dob: '05/03/1948' }).duplicate, false);
  eq('no dob -> not a duplicate', ctx.checkDuplicate({ name: 'Kamla Devi', dob: '' }).duplicate, false);
}

// --- an empty sheet never claims a duplicate ---------------------------------
{
  const ctx = makeCtx([]);
  eq('empty sheet -> not a duplicate', ctx.checkDuplicate({ name: 'Kamla Devi', dob: '05/03/1948' }).duplicate, false);
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('REGISTRATION DUPLICATE CHECK — NAME + DATE OF BIRTH, NOT PHONE');
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
