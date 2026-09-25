// A multi-visit record used to answer only "what is the state of this case".
// It could not answer "what did we do last time", because the merge replaces
// an earlier visit's value with a later one and keeps no trace of either the
// change or the day it happened. Two things are checked here:
//
//   1. A tooth keeps the date it was FIRST treated. The merge used to let a
//      return visit overwrite it, so a crown started in September and fitted
//      in October read as though the whole thing happened in October.
//   2. Every save appends to a `visits` log — the date, the doctor, which
//      fields were recorded that day and on which teeth — while leaving the
//      merged record itself exactly as it was.
//
// The log rides inside the existing JSON blob, so no backend change and no
// clinic redeploy is involved.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('const CS_ITEMS_KEY');
const to = html.indexOf('// A clinical record sheet holds four teeth');
if (from < 0 || to < 0) { console.error('could not locate mergeClinicalSheet'); process.exit(1); }

// `existing` stands in for whatever is already on file for this patient.
function mergeWith(existing) {
  const ctx = {
    api: async (action) => {
      if (action === 'getClinicalSheets') {
        return existing ? { success: true, allTeeth: existing } : { success: true, allTeeth: null };
      }
      throw new Error('unexpected api call: ' + action);
    },
    fmtDMY: () => '31/12/2026',
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(from, to), ctx);
  return record => ctx.mergeClinicalSheet({ uhid: 'AL0777', sheetType: 'Crown Bridge', allTeeth: record });
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

(async () => {
  // Visit 1, 1 September — anaesthesia and the crown prep on tooth 16.
  const v1 = {
    pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Garima',
    anaType: 'Lignocaine', marginType: 'Chamfer', shade: '—', labName: '—',
    teeth: [{ n: 1, tooth: '16', date: '01/09/2026' }],
  };
  const after1 = await mergeWith(null)(v1);

  eq('visit 1 is logged', (after1.visits || []).length, 1);
  eq('visit 1 carries the date the tooth was treated', after1.visits[0].date, '01/09/2026');
  eq('visit 1 lists what was recorded', after1.visits[0].fields, ['anaType', 'marginType']);
  eq('visit 1 names the tooth', after1.visits[0].items, ['16']);
  eq('visit 1 names the doctor', after1.visits[0].doctor, 'Dr. Garima');

  // Saved again the same sitting, after filling one more box. Staff save
  // several times a visit; that must not read as several visits.
  const after1b = await mergeWith(after1)({ ...v1, gingivaLevel: 'Sub-gingival' });
  eq('a second save the same day stays one visit', (after1b.visits || []).length, 1);
  eq('the extra field joins that same visit',
    after1b.visits[0].fields, ['anaType', 'marginType', 'gingivaLevel']);

  // Visit 2, 1 October — shade and lab, same tooth, nothing else touched.
  const after2 = await mergeWith(after1b)({
    pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Garima',
    anaType: '—', marginType: '—', shade: 'A2', labName: 'Ceramco',
    teeth: [{ n: 1, tooth: '16', date: '01/10/2026' }],
  });

  eq('visit 2 is its own entry', (after2.visits || []).length, 2);
  eq('visit 2 is numbered', after2.visits[1].n, 2);
  eq('visit 2 is dated', after2.visits[1].date, '01/10/2026');
  eq('visit 2 lists only what visit 2 recorded', after2.visits[1].fields, ['shade', 'labName']);

  // The whole point of the merge is still intact.
  eq('visit 1 anaesthesia survives into the merged record', after2.anaType, 'Lignocaine');
  eq('visit 2 lab reaches the merged record', after2.labName, 'Ceramco');

  // The date fix.
  eq('tooth 16 keeps the date it was first treated', after2.teeth[0].date, '01/09/2026');
  eq('tooth 16 also records when it was last seen', after2.teeth[0].lastVisit, '01/10/2026');

  // Visit 3, 20 October — fitting, and a second tooth joins the case.
  const after3 = await mergeWith(after2)({
    pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Viveyk',
    insertDate: '20/10/2026',
    teeth: [{ n: 1, tooth: '16', date: '20/10/2026' }, { n: 2, tooth: '26', date: '20/10/2026' }],
  });

  eq('visit 3 is its own entry', (after3.visits || []).length, 3);
  eq('visit 3 records the fitting', after3.visits[2].fields, ['insertDate']);
  eq('visit 3 names both teeth', after3.visits[2].items, ['16', '26']);
  eq('visit 3 names the doctor who did it', after3.visits[2].doctor, 'Dr. Viveyk');
  eq('the new tooth is dated from the visit that added it', after3.teeth[1].date, '20/10/2026');
  eq('the original tooth still reads from September', after3.teeth[0].date, '01/09/2026');

  // A save that records nothing new must not invent a visit.
  const after4 = await mergeWith(after3)({
    pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Viveyk', anaType: '—', teeth: [],
  });
  eq('a save with nothing new does not add a visit', (after4.visits || []).length, 3);

  // Identity is not a clinical finding — a record opened on a patient whose
  // name was corrected must not log that as a visit's worth of treatment.
  const after5 = await mergeWith(after3)({
    pName: 'Test Patient Renamed', pId: 'AL0777', doctor: 'Dr. Viveyk',
    teeth: [{ n: 1, tooth: '16', date: '25/10/2026' }],
  });
  eq('a name change is not logged as a finding', after5.visits[3].fields, []);

  // Records saved before this existed have no log; that must read as "no
  // history yet", not as a crash.
  const legacy = { pName: 'Old', pId: 'AL0777', anaType: 'Lignocaine', teeth: [{ n: 1, tooth: '16', date: '01/01/2026' }] };
  const afterLegacy = await mergeWith(legacy)({
    pName: 'Old', pId: 'AL0777', shade: 'A3', teeth: [{ n: 1, tooth: '16', date: '02/02/2026' }],
  });
  eq('a record with no earlier log starts one', (afterLegacy.visits || []).length, 1);
  eq('and the pre-existing tooth date is left alone', afterLegacy.teeth[0].date, '01/01/2026');

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('VISIT HISTORY — WHAT WAS RECORDED, ON WHICH VISIT');
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
})();
