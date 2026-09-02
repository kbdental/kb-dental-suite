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
// RCT's per-tooth entry carries its own rich "notes" summary (built from
// anaesthesia/WL/instrumentation/complications/etc. in collectCurrentTooth())
// — that's the ONLY place RCT's actual work done lives, since staff never
// type the same thing again into the top-level Step 2/3 free-text notes.
// It has to win over t.n3/t.n2 or the register's Work Done column comes
// back blank for every RCT visit.
const rct = {
  uhid: 'AL0999', patientName: 'RCT Patient', sheetType: 'RCT',
  allTeeth: { pName: 'RCT Patient', pId: 'AL0999', doctor: 'Dr. Mittel', n2: '', n3: '',
    entries: [{ tooth: '36', notes: 'Access opening done wrt 36.' }] }
};
const rctPre = clinicalSheetRegisterPrefill(rct);
eq('RCT -> toothNo from entries[].tooth', rctPre.toothNo, '36');
eq('RCT -> procedureDone is "RCT"', rctPre.procedureDone, 'RCT');
eq('RCT -> workDone from the per-tooth entry\'s own notes summary', rctPre.workDone, 'Access opening done wrt 36.');

// A top-level n2/n3 (typed separately from the per-tooth summary) is still
// the fallback when the entry itself has no notes — never silently drop it.
const rctNoEntryNotes = clinicalSheetRegisterPrefill({
  uhid: 'AL0999', sheetType: 'RCT',
  allTeeth: { doctor: 'Dr. Mittel', n3: 'Typed separately in Step 2.', entries: [{ tooth: '36' }] }
});
eq('RCT -> falls back to n3 when the entry has no notes of its own', rctNoEntryNotes.workDone, 'Typed separately in Step 2.');

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
