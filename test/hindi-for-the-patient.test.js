// "can we make the clinical note template toggle in Hindi everywhere so that
//  we can use where ever required" ... "Plan also"
//
// Settled first: Hindi on the PATIENT-FACING text only -- the clinical
// record stays English, because that is the medico-legal document -- and the
// toggle changes what is INSERTED AND PRINTED, not merely what this screen
// shows. A reading aid the paper never sees would not be worth having.
//
// So three lists carry a Hindi version: patient instructions, post-op
// instructions, and the plan treatments (a plan is handed to the patient).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 300) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

// ── the three stores keep it ────────────────────────────────────────────
const sheets = {};
const makeSheet = (name) => ({
  name: name, _rows: [], _max: 26,
  getLastRow() { return this._rows.length; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  getMaxColumns() { return this._max; },
  insertColumnsAfter(a, h) { this._max += h; },
  getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
  getRange(row, col, nr, nc) {
    const sh = this;
    return { getValues: () => [], setValues: (vals) => {
      vals.forEach((v, i) => {
        while (sh._rows.length < row + i) sh._rows.push([]);
        v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
      });
    } };
  },
  appendRow(r) { this._rows.push(r.slice()); },
  clearContents() { this._rows = []; }
});
// Each function on its own: a wider slice drags in code that runs at
// definition and needs half of Apps Script to exist.
const fn = (name) => {
  const a = gs.indexOf('function ' + name + '(');
  const b = gs.indexOf('\n}', a);
  return gs.slice(a, b + 2) + '\n';
};
const src = ['getMedicineInstructionsList', 'saveMedicineInstructionsList',
             'getMedicineNotesList', 'saveMedicineNotesList',
             'getClinicalNotePlan', 'saveClinicalNotePlan'].map(fn).join('');
const ctx = {
  getSheet: (n) => (sheets[n] = sheets[n] || makeSheet(n)),
  ensureGridWidth_: () => {},
  parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'bad' }; } },
  CLINICAL_PLAN_HEADERS: ["Plan", "Plan Treatment", "Category", "Templates", "Updated At", "Hindi"],
  CLINICAL_PLAN_SHEET: "Clinical Note Plan",
  Date, String, JSON
};
vm.createContext(ctx);
vm.runInContext(src
  + '\nthis.getInstr = getMedicineInstructionsList; this.saveInstr = saveMedicineInstructionsList;'
  + ' this.getNotes = getMedicineNotesList; this.saveNotes = saveMedicineNotesList;'
  + ' this.getPlan = getClinicalNotePlan; this.savePlan = saveClinicalNotePlan;', ctx);

{
  ctx.saveInstr({ instructions: JSON.stringify([
    { situation: 'Oral Hygiene', text: 'Brush twice daily.', category: 'Oral Hygiene',
      hindi: 'दिन में दो बार ब्रश करें।' },
    { situation: 'Diet', text: 'Avoid hot food.', category: 'Diet' }
  ]) });
  const got = ctx.getInstr().instructions;
  eq('a patient instruction keeps its Hindi', got[0].hindi,
     'दिन में दो बार ब्रश करें।');
  eq('and one written without it reads as empty, not missing', got[1].hindi, '');
  eq('the English is untouched', got.map(x => x.text), ['Brush twice daily.', 'Avoid hot food.']);
  // Appended, never inserted: the three columns before it are read by
  // position and every row already written would shift under them.
  eq('Hindi is the last column', sheets['Medicine Instructions']._rows[0],
     ['Situation', 'Instruction', 'Category', 'Updated At', 'Hindi']);
}

{
  ctx.saveNotes({ medNotes: JSON.stringify([
    { text: 'Avoid hot food for 24 hours.', hindi: '24 घंटे गरम न खाएं।' },
    'Do not rinse today.'
  ]) });
  const r = ctx.getNotes();
  // The prescription form reads medNotes as plain strings and it is a
  // base64 blob, so that shape must not change. The Hindi rides alongside.
  eq('post-op notes still come back as plain strings for the form',
     r.medNotes, ['Avoid hot food for 24 hours.', 'Do not rinse today.']);
  eq('with the pairs alongside', r.medNotesLib,
     [{ text: 'Avoid hot food for 24 hours.', hindi: '24 घंटे गरम न खाएं।' },
      { text: 'Do not rinse today.', hindi: '' }]);
  ok('a bare string already in the sheet still saves',
     sheets['Medicine Notes']._rows[2][0] === 'Do not rinse today.',
     JSON.stringify(sheets['Medicine Notes']._rows));
}

{
  ctx.savePlan({ rows: JSON.stringify([
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT', templates: 'Access Opening',
      hindi: 'रूट कैनाल — पहला चरण' }
  ]) });
  eq('a plan treatment keeps the Hindi a patient reads',
     ctx.getPlan().rows[0].hindi, 'रूट कैनाल — पहला चरण');
}

ok('the backend that stores it is there to deploy',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-08e',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [])[1]);

// ── the toggle changes what the FORM is given ───────────────────────────
{
  const body = html.slice(html.indexOf('  const hindiOf = (v) => {'),
                          html.indexOf('  const sendMedListsToForm = () => {'));
  ok('the swap was found', /const outLists = \(\) =>/.test(body), body.length);
  const run = (hindiOut, medLists) => {
    const c = { hindiOut, medLists, String, Object };
    vm.createContext(c);
    vm.runInContext(body + '\nthis.out = outLists();', c);
    return c.out;
  };
  const LISTS = {
    dosages: ['1-0-1'], frequencies: [], durations: [], instructions: [],
    instructionsLib: [
      { situation: 'Oral Hygiene', text: 'Brush twice daily.', hindi: 'ब्रश करें।' },
      { situation: 'Diet', text: 'Avoid hot food.', hindi: '' }
    ],
    medNotes: ['Avoid hot food for 24 hours.', 'Do not rinse today.'],
    medNotesLib: [
      { text: 'Avoid hot food for 24 hours.', hindi: 'गरम न खाएं।' },
      { text: 'Do not rinse today.', hindi: '' }
    ]
  };

  const off = run(false, LISTS);
  eq('with Hindi off the form gets exactly what it always got',
     [off.instructionsLib[0].text, off.medNotes],
     ['Brush twice daily.', ['Avoid hot food for 24 hours.', 'Do not rinse today.']]);

  const on = run(true, LISTS);
  // This is the whole point: the form inserts and prints what it is given,
  // so giving it Hindi is what puts Hindi on the paper -- with nothing
  // changed inside the form, which is a base64 blob.
  eq('with Hindi on the instruction text handed over is Hindi',
     on.instructionsLib[0].text, 'ब्रश करें।');
  eq('and so is the post-op note', on.medNotes[0], 'गरम न खाएं।');
  // Nothing goes blank for want of a translation.
  eq('an instruction with no Hindi yet keeps its English',
     on.instructionsLib[1].text, 'Avoid hot food.');
  eq('and so does a post-op note', on.medNotes[1], 'Do not rinse today.');
  eq('the situation titles are left alone, because they are not read aloud',
     on.instructionsLib.map(x => x.situation), ['Oral Hygiene', 'Diet']);
  eq('and the lists that are not patient-facing are untouched',
     on.dosages, ['1-0-1']);
}

ok('the toggle is on the form toolbar, where the prescription is written',
   /onClick: \(\) => setHindiOut\(!hindiOut\)/.test(html));
ok('and re-sends the lists when it changes, or the form would keep the old ones',
   /React\.useEffect\(\(\) => \{ sendMedListsToForm\(\); \}, \[medLists, hindiOut\]\);/.test(html));
// The two instances share one browser origin, so an unscoped key would set
// the empanelled clinic's language from the main one.
ok('the remembered setting is scoped to the instance',
   /localStorage\.getItem\(lsKey\("kbHindiOut"\)\)/.test(html) &&
   /localStorage\.setItem\(lsKey\("kbHindiOut"\)/.test(html));

// ── and the clinical record stays English ───────────────────────────────
// What the work-done forms insert, and therefore what the daily register
// and the progress notes keep, is the clinical note library -- which the
// toggle does not touch.
{
  const body = html.slice(html.indexOf('  const outLists = () => {'),
                          html.indexOf('  const sendMedListsToForm = () => {'));
  ok('the swap touches only the two patient-facing lists',
     /instructionsLib:/.test(body) && /medNotes:/.test(body)
     && !/clinicalTemplates/.test(body), body);
}
ok('the work-done templates are sent without regard to the toggle',
   /type: "KB_TEMPLATES",\s*templates: filtered/.test(html));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
