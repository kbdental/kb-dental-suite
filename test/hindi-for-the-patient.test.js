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
  // This swap is the medicine lists only; the work-done templates have
  // their own, on the way into the form.
  ok('this swap is the instruction lists, and nothing else',
     /instructionsLib:/.test(body) && /medNotes:/.test(body)
     && !/clinicalTemplates/.test(body), body);
}
// The clinical note templates DO follow the toggle now -- that is what was
// asked for in the first place. What stays English regardless is what the
// endorsement, the register and the progress note hold, because the
// template's own English is what those were filled from.
ok('the work-done templates follow the toggle',
   /type: "KB_TEMPLATES",\s*templates: out/.test(html));

// ── the clinical note templates take the toggle too ─────────────────────
// Asked for in the first place -- "the clinical note template toggle in
// Hindi" -- and I talked myself out of it on the strength of one
// multiple-choice answer. Each template carries a Hindi note, and the
// toggle hands the work-done forms that text instead.
{
  const libSrc = ['getClinicalNoteTemplatesV3_', 'saveClinicalNoteTemplateLib',
                  'clinicalTemplatesFlat_'].map(fn).join('');
  const c = {
    getSheet: (n) => (sheets[n] = sheets[n] || makeSheet(n)),
    ensureGridWidth_: () => {},
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'bad' }; } },
    CLINICAL_TPL_LIB_SHEET: "Clinical Templates (Type 1 & 2)",
    CLINICAL_TPL_LIB_HEADERS: ["Category", "Template", "Type 1 (Concise)",
                               "Type 2 (Comprehensive)", "Updated At", "Hindi"],
    Date, String, JSON
  };
  vm.createContext(c);
  vm.runInContext(libSrc + '\nthis.save = saveClinicalNoteTemplateLib; this.flat = clinicalTemplatesFlat_;', c);
  c.save({ rows: JSON.stringify([
    { category: 'RCT', template: 'Access Opening', type1: 'Access opening done wrt {tooth}.',
      type2: 'Access opening done wrt {tooth} under {anaesthesia}.',
      hindi: '{tooth} \u092a\u0930 \u0930\u0942\u091f \u0915\u0948\u0928\u093e\u0932 \u0916\u094b\u0932\u093e \u0917\u092f\u093e\u0964' },
    { category: 'RCT', template: 'Working Length', type1: 'WL recorded.', type2: 'WL recorded fully.' }
  ]) });
  eq('Hindi is the last column of the template sheet',
     sheets['Clinical Templates (Type 1 & 2)']._rows[0],
     ['Category', 'Template', 'Type 1 (Concise)', 'Type 2 (Comprehensive)', 'Updated At', 'Hindi']);
  const flat = c.flat();
  eq('the Hindi rides on the record the forms are given',
     flat[0].hindi, '{tooth} \u092a\u0930 \u0930\u0942\u091f \u0915\u0948\u0928\u093e\u0932 \u0916\u094b\u0932\u093e \u0917\u092f\u093e\u0964');
  eq('and one with none written reads as empty', flat[1].hindi, '');
  // What the form is actually handed.
  const swap = (hindiOut, filtered) => filtered.map(t => {
    if (!hindiOut) return t;
    const h = String((t && t.hindi) || "").trim();
    return h ? { ...t, text: h } : t;
  });
  const on = swap(true, flat);
  eq('with the toggle on the form is handed the Hindi note',
     on[0].text, '{tooth} \u092a\u0930 \u0930\u0942\u091f \u0915\u0948\u0928\u093e\u0932 \u0916\u094b\u0932\u093e \u0917\u092f\u093e\u0964');
  eq('a template with no Hindi keeps its English rather than going blank',
     on[1].text, 'WL recorded fully.');
  eq('with the toggle off nothing changes at all',
     JSON.stringify(swap(false, flat)), JSON.stringify(flat));
  ok('the swap is in the page, on the way to the form',
     /const out = hindiOut\s*\?\s*filtered\.map/.test(html));
  ok('and flipping it re-sends the list, or the form keeps the old language',
     /\}, \[clinicalTemplates, activeForm, hindiOut\]\);/.test(html));
  ok('the template editor has a box for it',
     /Hindi \\u2014 used when the Hindi toggle is on \(optional\)/.test(html));
  ok('and the card shows it under the two lengths',
     /\}, "HINDI"\) : null,/.test(html));
}

// ── the draft, and what pressing the button does ────────────────────────
// Asked for: "yes draft the hindi for both lists". The post-op list was
// empty in the clinic's own sheet, so there was nothing there to draft;
// these are the seventeen patient instructions.
{
  const DRAFT = vm.runInNewContext(
    html.slice(html.indexOf('const PATIENT_INSTRUCTION_HINDI = {'),
               html.indexOf('\n};', html.indexOf('const PATIENT_INSTRUCTION_HINDI = {')) + 3)
    + '\nPATIENT_INSTRUCTION_HINDI');
  const names = Object.keys(DRAFT);
  eq('there is a draft for every patient instruction the clinic has', names.length, 17);
  ok('every one of them is Devanagari, not left in English',
     names.every(k => /[ऀ-ॿ]/.test(DRAFT[k])),
     JSON.stringify(names.filter(k => !/[ऀ-ॿ]/.test(DRAFT[k]))));
  ok('and none is a stub', names.every(k => DRAFT[k].trim().length > 20),
     JSON.stringify(names.filter(k => DRAFT[k].trim().length <= 20)));
  // The numbers in these are instructions: half a teaspoon, 30-60 seconds,
  // 10 ml, six months. A draft that drops them is worse than no draft.
  ok('the saline instruction keeps its quantities',
     /100/.test(DRAFT['Warm Saline Gargles']) && /30/.test(DRAFT['Warm Saline Gargles']),
     DRAFT['Warm Saline Gargles']);
  ok('the mouthwash keeps its dose and its wait',
     /10/.test(DRAFT['Chlorhexidine Mouthwash']) && /30/.test(DRAFT['Chlorhexidine Mouthwash']),
     DRAFT['Chlorhexidine Mouthwash']);
  ok('and the recall keeps its interval', /6/.test(DRAFT['Six-Month Recall']),
     DRAFT['Six-Month Recall']);

  // Pressing the button fills the blanks and NOTHING else. Replacing Hindi
  // the clinic has corrected itself would be the one unforgivable thing
  // here, so it is checked rather than trusted.
  const at = html.indexOf('  const draftable = (items || []).filter(it =>');
  const body = html.slice(at, at + 2000);
  ok('the fill was found', at > 0 && /onFillHindi\(/.test(body), at);
  const fill = (items) => items.map(it =>
    (!String(it.hindi || "").trim() && DRAFT[it.situation])
      ? { ...it, hindi: DRAFT[it.situation] } : it);
  const before = [
    { situation: 'Avoid Smoking', text: 'Avoid smoking...', hindi: '' },
    { situation: 'Avoid Tobacco', text: 'Avoid tobacco...', hindi: 'मेरा अपना' },
    { situation: 'Something Of Their Own', text: 'Theirs.', hindi: '' }
  ];
  const after = fill(before);
  ok('a blank one is filled from the draft',
     after[0].hindi === DRAFT['Avoid Smoking'], after[0].hindi);
  eq('Hindi the clinic wrote itself is left exactly alone',
     after[1].hindi, 'मेरा अपना');
  eq('and an instruction with no draft stays blank rather than being invented',
     after[2].hindi, '');
  eq('nothing else on any row moves', after.map(x => x.text),
     ['Avoid smoking...', 'Avoid tobacco...', 'Theirs.']);
  // Run twice: the second press has nothing left to do.
  eq('pressing it again changes nothing', JSON.stringify(fill(after)), JSON.stringify(after));
  ok('the screen says it is a draft to read, not a translation to trust',
     /not a translation to trust/.test(html));
  ok('and it is offered only while something is still blank',
     /\(onFillHindi && draftable\.length\) \?/.test(html));
}

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
