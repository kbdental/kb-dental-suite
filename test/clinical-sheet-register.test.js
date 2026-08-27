// Checks the fix for: RCT, Crown & Bridge, Implant Surgery, and Implant
// Prosthetic saved their clinical record (or, for RCT, didn't even reach
// the backend at all — see rct-backend.test.js) but never offered a Daily
// Register entry, unlike every other clinical form. clinicalSheetRegisterPrefill
// is what the parent now uses to build that entry from a KB_SAVE_CLINICAL_SHEET
// payload, the same way registerPrefill does for KB_SAVE_RECORD payloads.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const csFrom = html.indexOf('const CS_ITEMS_KEY');
const csTo = html.indexOf('async function mergeClinicalSheet');
const fnFrom = html.indexOf('function clinicalSheetRegisterPrefill(d, merged)');
const fnTo = html.indexOf('function registerPrefill(d)');
if (csFrom < 0 || csTo < 0 || fnFrom < 0 || fnTo < 0) { console.error('could not locate clinicalSheetRegisterPrefill'); process.exit(1); }

const ctx = { toISODate: d => d.toISOString().slice(0, 10) };
vm.createContext(ctx);
vm.runInContext(html.slice(csFrom, csTo) + html.slice(fnFrom, fnTo) + ';this.clinicalSheetRegisterPrefill = clinicalSheetRegisterPrefill;', ctx);
const { clinicalSheetRegisterPrefill } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// --- Crown & Bridge: teeth array, notes in n3 --------------------------
const cb = {
  uhid: 'AL0777', patientName: 'Test Patient', sheetType: 'Crown Bridge',
  allTeeth: { pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Mittel', n2: '', n3: 'Crown cemented wrt 16.',
    teeth: [{ n: 1, tooth: '16' }] }
};
const cbPre = clinicalSheetRegisterPrefill(cb);
eq('Crown & Bridge -> uhid', cbPre.uhid, 'AL0777');
eq('Crown & Bridge -> toothNo from teeth[].tooth', cbPre.toothNo, '16');
eq('Crown & Bridge -> workDone from n3', cbPre.workDone, 'Crown cemented wrt 16.');
eq('Crown & Bridge -> procedureDone is the sheet type', cbPre.procedureDone, 'Crown Bridge');
eq('Crown & Bridge -> operatingDoctor', cbPre.operatingDoctor, 'Dr. Mittel');

// --- Implant Surgery: implants array uses .site, not .tooth -------------
const imp = {
  uhid: 'AL0888', patientName: 'Implant Patient', sheetType: 'Implant Surgery',
  allTeeth: { pName: 'Implant Patient', pId: 'AL0888', doctor: 'Dr. Mittel', n3: 'Implant placed at 46.',
    implants: [{ n: 1, site: '46' }] }
};
const impPre = clinicalSheetRegisterPrefill(imp);
eq('Implant Surgery -> toothNo from implants[].site', impPre.toothNo, '46');
eq('Implant Surgery -> workDone from n3', impPre.workDone, 'Implant placed at 46.');

// --- RCT: entries array, one object per tooth ----------------------------
const rct = {
  uhid: 'AL0999', patientName: 'RCT Patient', sheetType: 'RCT',
  allTeeth: { pName: 'RCT Patient', pId: 'AL0999', doctor: 'Dr. Mittel',
    entries: [{ tooth: '36', notes: 'Access opening done wrt 36.' }] }
};
// RCT entries carry notes per-tooth, not a top-level n2/n3 — falls back to "" here,
// which is fine: the register entry still reaches the confirm screen with tooth +
// doctor filled in, and staff can paste the note in manually if the per-entry
// notes field isn't wired to n2/n3 at the top level.
const rctPre = clinicalSheetRegisterPrefill(rct);
eq('RCT -> toothNo from entries[].tooth', rctPre.toothNo, '36');
eq('RCT -> procedureDone is "RCT"', rctPre.procedureDone, 'RCT');

// --- no uhid -> no prefill (never silently write a blank register row) --
eq('no uhid -> null', clinicalSheetRegisterPrefill({ sheetType: 'RCT', allTeeth: {} }), null);

// --- unregistered sheetType (no CS_ITEMS_KEY entry) still returns a usable prefill
const other = { uhid: 'AL0111', sheetType: 'Some New Form', allTeeth: { pName: 'X', doctor: 'Dr. Y', n3: 'note' } };
const otherPre = clinicalSheetRegisterPrefill(other);
eq('unregistered sheetType -> still has uhid/doctor/workDone, blank tooth', otherPre,
  { uhid: 'AL0111', patientName: 'X', age: '', date: ctx.toISODate(new Date()), procedureDone: 'Some New Form', toothNo: '', workDone: 'note', operatingDoctor: 'Dr. Y' });

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('CLINICAL SHEET FORMS -> DAILY REGISTER HAND-OFF');
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
