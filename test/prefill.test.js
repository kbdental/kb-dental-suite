// Unit test for registerPrefill — the function that turns a saved clinical
// form into a pre-filled Daily Register entry. Extracted from index.html and
// exercised against the real field names each form's save action sends.

const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const REG_FIELD = {');
const end = html.indexOf('function App()', start);
if (start < 0 || end < 0) { console.error('could not locate registerPrefill'); process.exit(1); }
let src = html.slice(start, end);
// Drop the RegisterConfirm component — it needs React; we only want the
// pure prefill logic.
src = src.slice(0, src.indexOf('// Shown after a clinical form saves'));

const ctx = { toISODate: d => d.toISOString().slice(0, 10) };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.registerPrefill = registerPrefill;', ctx);
const registerPrefill = ctx.registerPrefill;

// Field names taken from the real save actions in Code.gs.
const CASES = [
  { name: 'Scaling', d: { fields: {
      uhid: 'AL0777', patientName: 'Asha Rao', age: '42',
      polishingDone: 'Yes', operator: 'Dr. Manika Mittel',
      remarks: 'Full mouth scaling completed, moderate calculus.' } },
    want: { procedureDone: '', toothNo: '', workDone: 'Full mouth scaling completed, moderate calculus.', operatingDoctor: 'Dr. Manika Mittel' } },

  { name: 'Pedo', d: { fields: {
      uhid: 'AL0801', patientName: 'Yohaan A', toothSite: '54,55',
      procedure: 'Pulpotomy', doctor: 'Dr. Viveyk Mittel',
      remarks: 'Pulpotomy done wrt 54, Metapex placed.' } },
    want: { procedureDone: 'Pulpotomy', toothNo: '54,55', workDone: 'Pulpotomy done wrt 54, Metapex placed.', operatingDoctor: 'Dr. Viveyk Mittel' } },

  { name: 'Pathology', d: { fields: {
      uhid: 'AL0900', patientName: 'Ravi K', sampleSite: '36',
      testAdvised: 'Biopsy', remarks: 'Sample sent to lab.' } },
    want: { procedureDone: 'Biopsy', toothNo: '36', workDone: 'Sample sent to lab.', operatingDoctor: '' } },

  { name: 'Radiology (findingsSummary, no remarks)', d: { fields: {
      uhid: 'AL0901', patientName: 'Sita M', siteTeeth: 'Full Mouth',
      testAdvised: 'OPG', findingsSummary: 'No periapical pathology seen.' } },
    want: { procedureDone: 'OPG', toothNo: 'Full Mouth', workDone: 'No periapical pathology seen.', operatingDoctor: '' } },

  { name: 'Lab Log', d: { fields: {
      uhid: 'AL0902', patientName: 'Kiran S', toothSite: '46',
      workType: 'Zirconia Crown', remarks: 'Sent to KBDA, shade A2.' } },
    want: { procedureDone: 'Zirconia Crown', toothNo: '46', workDone: 'Sent to KBDA, shade A2.', operatingDoctor: '' } },

  { name: 'form label fallback when no procedure field', d: {
      formLabel: 'TM Joint', fields: {
        uhid: 'AL0903', patientName: 'Nita P', remarks: 'Clicking on right side.' } },
    want: { procedureDone: 'TM Joint', toothNo: '', workDone: 'Clicking on right side.', operatingDoctor: '' } },

  { name: 'blank/whitespace fields are skipped, not chosen', d: { fields: {
      uhid: 'AL0904', patientName: 'Om V',
      procedure: '   ', procedureDone: 'Extraction',
      remarks: '   ', notes: 'Tooth removed uneventfully.' } },
    want: { procedureDone: 'Extraction', workDone: 'Tooth removed uneventfully.' } },
];

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('registerPrefill — DAILY REGISTER PREFILL UNIT TEST');
console.log('='.repeat(78));

for (const c of CASES) {
  const got = registerPrefill(c.d);
  const bad = [];
  for (const [k, v] of Object.entries(c.want)) {
    if (got[k] !== v) bad.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(got[k])}`);
  }
  if (bad.length) { fail++; console.log('  FAIL  ' + c.name); bad.forEach(b => console.log('          ' + b)); }
  else { pass++; console.log('  PASS  ' + c.name); }
}

// A form with no UHID must not offer a register entry at all.
const noUhid = registerPrefill({ fields: { patientName: 'No Id' } });
if (noUhid === null) { pass++; console.log('  PASS  no UHID -> no register prompt'); }
else { fail++; console.log('  FAIL  no UHID should return null, got ' + JSON.stringify(noUhid)); }

console.log('='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
