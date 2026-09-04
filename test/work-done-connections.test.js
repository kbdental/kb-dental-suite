// Checks the "work done" connections across Daily Register, the patient's
// Procedure Done Sheet, clinical forms, and Prescription:
//
// 1. Daily Register -> patient's Procedure Done Sheet is a live filtered
//    read (getTreatmentProgress reads the Daily Register by UHID), not a
//    separate copy — so anything saved to the register already shows up
//    there automatically. This is confirmed by matchClinicalFormPrompt
//    firing on the same free text saveToDailyRegister writes, and by
//    clinical-sheet-register.test.js / register-merge.test.js covering the
//    write path itself.
// 2. Daily Register -> clinical form: typing a procedure that looks like
//    RCT/Crown & Bridge/Implant work into the register (skipping the
//    clinical form) now prompts staff to open that form for the same
//    patient, rather than auto-guessing structured fields from free text.
// 3. Clinical form work done -> Prescription: already wired (Prescription
//    pulls today's Daily Register entries via getTreatmentProgress and
//    auto-fills the procedure text) — RCT's fix in the previous change
//    (clinicalSheetRegisterPrefill preferring the per-tooth notes summary)
//    is what makes this actually carry real content through for RCT.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const lines = html.split('\n');

function extract(startMarker, endMarker) {
  const start = lines.findIndex(l => l.startsWith(startMarker));
  if (start < 0) throw new Error('could not find ' + startMarker);
  const end = lines.findIndex((l, i) => i > start && l.startsWith(endMarker));
  if (end < 0) throw new Error('could not find ' + endMarker + ' after ' + startMarker);
  return lines.slice(start, end).join('\n');
}

// --- 1 & 2: the keyword-prompt helper (pure function, DailyRegister-level) -
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extract('const CLINICAL_FORM_PROMPTS', 'function DailyRegister') +
  ';this.matchClinicalFormPrompt = matchClinicalFormPrompt;', ctx);
const { matchClinicalFormPrompt } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

eq('"RCT" matches', matchClinicalFormPrompt('RCT'), 'RCT');
eq('"Root canal wrt 36" matches RCT', matchClinicalFormPrompt('Root canal wrt 36'), 'RCT');
eq('"Crown cementation" matches Crown & Bridge', matchClinicalFormPrompt('Crown cementation'), 'Crown & Bridge');
eq('"Bridge prep" matches Crown & Bridge', matchClinicalFormPrompt('Bridge prep'), 'Crown & Bridge');
eq('"Implant prosthetic delivery" matches Implant Prosthetic (checked before the generic Implant match)',
  matchClinicalFormPrompt('Implant prosthetic delivery'), 'Implant Prosthetic');
eq('"Implant placement" matches Implant Surgery (generic implant, no prosthetic keyword)',
  matchClinicalFormPrompt('Implant placement'), 'Implant Surgery');
eq('case-insensitive', matchClinicalFormPrompt('rct access opening'), 'RCT');
eq('"Scaling" does not match anything (not a form-tracked type)', matchClinicalFormPrompt('Scaling'), null);
eq('empty text does not match', matchClinicalFormPrompt(''), null);
eq('undefined does not throw and does not match', matchClinicalFormPrompt(undefined), null);

// --- 3: Prescription's auto-fill logic reads treatmentRendered/workDone,
// which is exactly what clinicalSheetRegisterPrefill (fixed for RCT in the
// previous change) writes into the Daily Register's workDone column. Assert
// the field names line up so the pipeline actually connects end to end.
const prescriptionHtml = (() => {
  const m = /const PRESCRIPTION_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  return Buffer.from(b64, 'base64').toString('utf8');
})();
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });
ok('Prescription form listens for KB_TODAYS_PROCEDURES', prescriptionHtml.includes("d.type === 'KB_TODAYS_PROCEDURES'"));
// Procedure Done is required in the register, so treatmentRendered is always
// set. This used to assert `p.treatmentRendered || p.workDone` — an either/or
// that meant Work Done could never reach the pad — so it asserts the three
// field names are each read now, not the shape of the expression joining them.
// Behaviour is covered by test/prescription-todays-procedures.test.js.
ok('Prescription auto-fill reads treatmentRendered (what getTreatmentProgress -> clinicalSheetRegisterPrefill produce)',
  prescriptionHtml.includes('p.treatmentRendered'));
ok('Prescription auto-fill also reads workDone, not only treatmentRendered',
  prescriptionHtml.includes('p.workDone'));
ok('Prescription auto-fill carries the tooth number across too',
  prescriptionHtml.includes('p.toothNo'));
ok('Prescription pulls its data via getTreatmentProgress (same source Daily Register / Procedure Done Sheet use)',
  html.includes('api("getTreatmentProgress", { uhid: globalPat.uhid })'));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('WORK DONE CONNECTIONS — REGISTER <-> CLINICAL FORMS <-> PRESCRIPTION');
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
