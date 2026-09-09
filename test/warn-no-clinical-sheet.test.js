// Nine of the ten most recent RCT / crown / implant patients had no clinical
// record at all: the treatment happened, the appointment was completed, the
// form was never saved, and nothing anywhere said so. The next visit then
// opens a blank form and the earlier work looks lost.
//
// Completing the appointment is the last moment anyone is still thinking about
// the visit, so that is where the warning goes. It never blocks the
// completion — the visit is already done — and it stays quiet whenever the
// work has been written down somewhere, because a warning that fires on
// already-recorded treatment is one staff learn to ignore.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('// sheetType is the label getClinicalSheets matches on');
const to = html.indexOf('function matchClinicalFormPrompt');
if (from < 0 || to < 0) { console.error('could not locate the clinical-form prompt block'); process.exit(1); }

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// `answers` decides what each lookup returns, so a case can be set up as
// "structured record exists", "only historical rows exist", or "nothing".
function load(answers) {
  const calls = [];
  const ctx = {
    api: async (action, params) => {
      calls.push(action + (params && params.sheetType ? ':' + params.sheetType : ''));
      if (typeof answers === 'function') return answers(action, params);
      return answers[action] !== undefined ? answers[action] : { success: true };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(from, to), ctx);
  ctx.__calls = calls;
  return ctx;
}

(async () => {
  const ctx = load({});

  // ── which form a booking calls for ──────────────────────────────────────
  const labelFor = t => { const f = ctx.clinicalFormFor(t); return f ? f.label : null; };

  eq('an RCT booking wants the RCT form', labelFor('RCT'), 'RCT');
  eq('so does a root canal by its long name', labelFor('Root Canal Treatment'), 'RCT');
  eq('crown cementation wants Crown & Bridge', labelFor('Crown Cementation'), 'Crown & Bridge');
  eq('implant surgery wants Implant Surgery', labelFor('Implant Surgery'), 'Implant Surgery');

  // The clinic books this as "Implant Prosthesis". Before this change it fell
  // through to the bare "implant" keyword and asked for the Implant Surgery
  // form — the wrong form, on every prosthetic visit.
  eq('implant prosthesis wants Implant Prosthetic', labelFor('Implant Prosthesis'), 'Implant Prosthetic');
  eq('and so does implant prosthetic', labelFor('Implant Prosthetic'), 'Implant Prosthetic');

  eq('a consultation wants no form', labelFor('Consultation'), null);
  eq('nor does scaling', labelFor('Scaling / Cleaning'), null);
  eq('nor does an empty booking', labelFor(''), null);

  // The sheet label is not always the form label — "Crown Bridge" has no
  // ampersand, and getClinicalSheets matches it exactly.
  eq('the crown form looks the record up as "Crown Bridge"',
    ctx.clinicalFormFor('Crown Cementation').sheetType, 'Crown Bridge');
  eq('and its historical rows live under "Crown & Bridge"',
    ctx.clinicalFormFor('Crown Cementation').tab, 'Crown & Bridge');

  // ── when to warn ────────────────────────────────────────────────────────
  const form = ctx.clinicalFormFor('RCT');

  const structured = load({
    getClinicalSheets: { success: true, allTeeth: { entries: [{ tooth: '24' }] } },
  });
  eq('a structured record means no warning',
    await structured.clinicalSheetMissing('AL0810', structured.clinicalFormFor('RCT')), false);
  eq('and the historical tab is not even consulted',
    structured.__calls.includes('getClinicalRecords'), false);

  // Filed under a different sheet label — still recorded, still no warning.
  const otherLabel = load((action, params) =>
    action === 'getClinicalSheets' && params.sheetType
      ? { success: true, allTeeth: null }
      : action === 'getClinicalSheets'
        ? { success: true, allTeeth: { entries: [{ tooth: '24' }] } }
        : { success: true, records: [] });
  eq('a record filed under another sheet label still counts',
    await otherLabel.clinicalSheetMissing('AL0810', form), false);

  // AL0810's real situation: nothing structured, but two rows in the flat tab.
  const onlyHistorical = load({
    getClinicalSheets: { success: true, allTeeth: null },
    getClinicalRecords: { success: true, records: [{ 'Tooth No.': '47' }, { 'Tooth No.': '24' }] },
  });
  eq('rows in the form’s own tab count as recorded',
    await onlyHistorical.clinicalSheetMissing('AL0810', form), false);

  // Nothing anywhere — this is the case worth interrupting for.
  const nothing = load({
    getClinicalSheets: { success: true, allTeeth: null },
    getClinicalRecords: { success: true, records: [] },
  });
  eq('nothing recorded anywhere warns', await nothing.clinicalSheetMissing('AL0810', form), true);

  // A failed lookup is not evidence of a missing record.
  const broken = load(() => { throw new Error('network'); });
  eq('a failed lookup stays quiet rather than crying wolf',
    await broken.clinicalSheetMissing('AL0810', form), false);
  const rejected = load({ getClinicalSheets: { success: false, error: 'AUTH_REQUIRED' } });
  eq('so does a rejected request',
    await rejected.clinicalSheetMissing('AL0810', form), false);

  // Nothing to check against.
  eq('no UHID means no warning', await nothing.clinicalSheetMissing('', form), false);
  eq('no matched form means no warning', await nothing.clinicalSheetMissing('AL0810', null), false);

  // ── the wiring is actually in place ─────────────────────────────────────
  const appts = html.slice(html.indexOf('function Appointments({'), html.indexOf('function Daysheet('));
  eq('Appointments receives setPage so the warning can link to the form',
    /function Appointments\(\{ globalPat, setGlobalPat, setPage \}\)/.test(appts), true);
  eq('completing an appointment triggers the check',
    /if \(status === "Completed"\) \{\s*\n\s*checkClinicalSheet\(/.test(appts), true);
  eq('so does closing a case-linked visit through the outcome popup',
    /checkClinicalSheet\(a\);/.test(appts), true);
  eq('the warning offers a way straight to the form',
    /Open the " \+ sheetWarn\.label \+ " form/.test(appts), true);
  eq('and can be dismissed', /"Not now"\)\)/.test(appts), true);
  eq('the app passes setPage down', /setGlobalPat: setGlobalPat,\s*\n\s*setPage: setPage/.test(html), true);
  // The visit must complete whether or not the record exists.
  eq('the check never gates the status update',
    /if \(status === "Completed"\) \{[\s\S]{0,200}?\}\n  \};/.test(appts), true);

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('WARN WHEN A COMPLETED VISIT HAS NO CLINICAL RECORD');
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
