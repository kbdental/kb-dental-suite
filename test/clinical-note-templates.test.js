// "delete the clinical notes template and Rename the treatment notes
//  template as Clinical Notes template"
//
// There is ONE list. The clinic's 188 notes went in beside the older set
// while they were looked over; they replace it now, under the name
// everything already calls it.
//
// Three things have to hold, and the second and third are the ones with
// teeth:
//   1. the 188 notes are the list, filed under the clinic's own departments
//   2. the older set is moved aside, NOT deleted -- it is their own writing
//      and nobody asked for it to be destroyed
//   3. every form that picks templates by department still finds some: the
//      new departments are not the old ones, and three forms named a
//      category that no longer exists

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
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

// ── one button, not two ─────────────────────────────────────────────────
{
  const notes = html.slice(html.indexOf('{ id:"notes", label:"Notes", subtabs:['),
                           html.indexOf('{ id:"accounts", label:"Accounts"'));
  ok('the Notes group was found', notes.length > 60, notes.length);
  ok('Clinical Note Templates is there',
     /\{ id:"templates",\s*label:"Clinical Note Templates" \}/.test(notes), notes);
  ok('and there is no second templates button beside it',
     !/treatmentNotes/.test(html) && !/Treatment Note Templates/.test(html), notes);
  ok('the post-op lists were not displaced',
     /id:"medInstructions"/.test(notes) && /id:"medNotes"/.test(notes), notes);
}
ok('nothing is left of the second list in the page',
   !/treatmentTemplates/.test(html) && !/TREATMENT_TEMPLATE_CATEGORIES/.test(html)
   && !/saveTreatmentNoteTemplates/.test(html) && !/getTreatmentNoteTemplates/.test(html));
ok('nor in the backend, beyond the one line that renames the sheet',
   !/TreatmentNoteTemplates/.test(gs) &&
   (gs.match(/Treatment Note Templates/g) || []).length === 1 &&
   /var carried = ss\.getSheetByName\("Treatment Note Templates"\);/.test(gs));
ok('the editor is back to one set of categories',
   /const CATS = CLINICAL_TEMPLATE_CATEGORIES;/.test(html) &&
   !/categories:/.test(html.slice(html.indexOf('templates: () => React.createElement(TemplateListEditor'),
                                  html.indexOf('templates: () => React.createElement(TemplateListEditor') + 400)));

// ── it still saves the way every other list does ────────────────────────
ok('the screen writes the clinical list',
   /templates: \(\) => React\.createElement\(TemplateListEditor, \{\s*items:clinicalTemplates,[\s\S]{0,400}?saveTemplates\(/.test(html));
ok('through persist, not by hand',
   /const saveTemplates = \(arr\) => persist\("saveClinicalNoteTemplates", \{ templates: JSON\.stringify\(arr\) \}, arr, setClinicalTemplates, clinicalTemplates\);/.test(html));
{
  const master = html.slice(html.indexOf('apiBatch([\n      "getTreatmentsMaster"'));
  const asked = master.slice(0, master.indexOf(']'));
  ok('it is read in the batch', /"getClinicalNoteTemplates"/.test(asked), asked);
  const names = (asked.match(/"([^"]+)"/g) || []).length;
  const landed = (/\.then\(\(\[([^\]]+)\]/.exec(master) || [, ''])[1]
    .split(',').map(x => x.trim()).filter(Boolean);
  eq('every list asked for has somewhere to land', names, landed.length);
}

// ── the clinic's 188 notes are the list ─────────────────────────────────
const seedSrc = gs.slice(gs.indexOf('var CLINICAL_NOTE_SEED = ['),
                         gs.indexOf('];', gs.indexOf('var CLINICAL_NOTE_SEED = [')) + 2);
const SEED = vm.runInNewContext(seedSrc + '\nCLINICAL_NOTE_SEED');
const CATS = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')))
  + '\nCLINICAL_TEMPLATE_CATEGORIES');

eq('every note the clinic sent is there', SEED.length, 188);
ok('each is a department, a treatment and the note',
   SEED.every(r => r.length === 3 && r.every(x => typeof x === 'string' && x.trim())),
   JSON.stringify(SEED.find(r => r.length !== 3 || r.some(x => typeof x !== 'string' || !x.trim()))));
eq('filed under the clinic\'s own fourteen departments', CATS.length, 14);
ok('and every note falls under one the editor offers',
   SEED.every(r => CATS.indexOf(r[0]) >= 0),
   JSON.stringify([...new Set(SEED.filter(r => CATS.indexOf(r[0]) < 0).map(r => r[0]))]));
ok('the departments the old list had no room for are among them',
   ['General / Consultation', 'TMJ / Occlusion', 'RCT / Endodontics', 'Denture', 'Cosmetic']
     .every(c => CATS.indexOf(c) >= 0), JSON.stringify(CATS));
ok('a treatment may have several notes to choose from',
   SEED.filter(r => r[1] === 'Consultation').length > 1);

// ── every form still finds templates ────────────────────────────────────
// This is the part a rename quietly breaks. The forms pick by department,
// three of them named a department that no longer exists, and the picker
// would simply have come up empty with nothing on screen to say why.
{
  const forms = html.slice(html.indexOf('{ id:"rct",'), html.indexOf('{ id:"labLog",') + 500);
  const used = [];
  const re = /id:"(\w+)"[^\n]*?templateCategory:"([^"]*)"/g;
  let m;
  while ((m = re.exec(forms))) used.push({ form: m[1], cat: m[2] });
  ok('every form was read', used.length >= 18, used.length);
  const orphans = used.filter(x => x.cat !== '*' && CATS.indexOf(x.cat) < 0);
  eq('no form asks for a department that does not exist', orphans, []);
  // And asking is not enough: there has to be something to show.
  const empty = used.filter(x => x.cat !== '*' && !SEED.some(r => r[0] === x.cat));
  eq('and every one of them has notes to offer', empty, []);
  // The three that moved, named so a later edit cannot undo them by accident.
  const catOf = (id) => (used.find(x => x.form === id) || {}).cat;
  eq('RCT follows its department', catOf('rct'), 'RCT / Endodontics');
  eq('Minor Surgery follows its department', catOf('minorSurgery'), 'Minor Oral Surgery');
  eq('Denture follows its department', catOf('denture'), 'Denture');
  // The forms that show everything must keep showing everything.
  eq('the three catch-all forms are untouched',
     used.filter(x => x.cat === '*').map(x => x.form).sort(),
     ['labLog', 'localAnesthesia', 'tmJoint']);
}

// ── the sheet, run ──────────────────────────────────────────────────────
const SRC = gs.slice(gs.indexOf('// ── Clinical note templates ─'),
                     gs.indexOf('function getPatientOutstanding(p) {'));
ok('the sheet code was found', /function clinicalTplSheet_/.test(SRC), SRC.length);

const makeSheet = (name, rows) => ({
  name: name, _rows: (rows || []).map(r => r.slice()), _max: 26,
  getName() { return this.name; },
  setName(n) { this.name = n; },
  getLastRow() { return this._rows.length; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  getMaxColumns() { return this._max; },
  insertColumnsAfter(a, h) { this._max += h; },
  getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
  getRange(row, col, nr, nc) {
    const sh = this;
    return {
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const r = sh._rows[row - 1 + i] || [], v = [];
          for (let j = 0; j < nc; j++) v.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
          out.push(v);
        }
        return out;
      },
      setValues: (vals) => {
        vals.forEach((v, i) => {
          while (sh._rows.length < row + i) sh._rows.push([]);
          v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
        });
      }
    };
  },
  appendRow(r) { this._rows.push(r.slice()); },
  clearContents() { this._rows = []; }
});

const book = (sheets) => {
  const list = sheets.slice();
  const ss = {
    getSheetByName: (n) => list.find(x => x.name === n) || null,
    insertSheet: (n) => { const sh = makeSheet(n, []); list.push(sh); return sh; },
    _sheets: list
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    getSheet: (n) => ss.getSheetByName(n) || ss.insertSheet(n),
    ensureGridWidth_: (sh, n) => { if (n > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns()); },
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'not a list' }; } },
    CLINICAL_NOTE_SEED: SEED,
    Date, String, JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.get = getClinicalNoteTemplates; this.save = saveClinicalNoteTemplates;', ctx);
  return { ctx, ss };
};

const OLD_HEAD = ['Situation', 'Template Text', 'Category', 'Updated At'];
const oldSet = () => makeSheet('Clinical Note Templates',
  [OLD_HEAD, ['RCT Access', 'Access opening done.', 'RCT', '2025-01-01'],
             ['Denture Try-in', 'Try-in done.', 'Prosthodontics', '2025-01-01']]);
const carried = () => makeSheet('Treatment Note Templates',
  [OLD_HEAD].concat(SEED.map(r => [r[1], r[2], r[0], '2026-11-06'])));

// A book that has both: the clinic deployed the last build and opened the
// page, so the 188 are in under the name they were first given.
{
  const { ctx, ss } = book([oldSet(), carried()]);
  const got = ctx.get();
  eq('the clinic\'s list is what comes back', got.templates.length, 188);
  eq('and it is now the clinical note templates',
     ss._sheets.map(x => x.name).sort(),
     ['Clinical Note Templates', 'Clinical Note Templates (replaced)']);
  // The one that must not go wrong.
  const kept = ss.getSheetByName('Clinical Note Templates (replaced)');
  eq('the older set is kept, not deleted', kept._rows.length, 3);
  eq('exactly as it was', kept._rows[1][0], 'RCT Access');
  eq('the heading row is marked, so this only happens once',
     ss.getSheetByName('Clinical Note Templates')._rows[0], 
     ['Situation', 'Template Text', 'Category', 'Updated At', 'v2']);
  eq('read again nothing moves', ctx.get().templates.length, 188);
  eq('and nothing is renamed a second time', ss._sheets.length, 2);
}

// A book where the page was never opened, so only the older set exists.
{
  const { ctx, ss } = book([oldSet()]);
  const got = ctx.get();
  eq('the older set is still moved aside', 
     ss._sheets.map(x => x.name).sort(),
     ['Clinical Note Templates', 'Clinical Note Templates (replaced)']);
  eq('and the clinic\'s list is seeded in its place', got.templates.length, 188);
  eq('the older set is intact',
     ss.getSheetByName('Clinical Note Templates (replaced)')._rows[1][0], 'RCT Access');
  eq('none of the old templates leak into the new list',
     got.templates.filter(t => t.situation === 'RCT Access').length, 0);
}

// A book that has been through this before: nothing to do at all.
{
  const current = makeSheet('Clinical Note Templates',
    [['Situation', 'Template Text', 'Category', 'Updated At', 'v2'],
     ['Mine', 'My own note.', 'Denture', '2026-11-07', '']]);
  const { ctx, ss } = book([current, makeSheet('Clinical Note Templates (replaced)', [OLD_HEAD])]);
  eq('a list already in place is left exactly alone', ctx.get().templates.length, 1);
  eq('and is not reseeded', ctx.get().templates[0].situation, 'Mine');
  eq('nothing is renamed', ss._sheets.map(x => x.name).sort(),
     ['Clinical Note Templates', 'Clinical Note Templates (replaced)']);
}

// An archive name already taken: the second one does not overwrite the first.
{
  const { ctx, ss } = book([oldSet(), carried(),
    makeSheet('Clinical Note Templates (replaced)', [OLD_HEAD, ['Older still', 'x', 'RCT', '']])]);
  ctx.get();
  eq('an earlier archive is not written over',
     ss.getSheetByName('Clinical Note Templates (replaced)')._rows[1][0], 'Older still');
  ok('and the newer one gets a name of its own',
     !!ss.getSheetByName('Clinical Note Templates (replaced 2)'),
     JSON.stringify(ss._sheets.map(x => x.name)));
}

// A list the clinic empties on purpose stays empty.
{
  const { ctx } = book([carried()]);
  ctx.get();
  ctx.save({ templates: JSON.stringify([]) });
  eq('cleared on purpose, it stays cleared', ctx.get().templates.length, 0);
  ctx.save({ templates: JSON.stringify([{ situation: 'Mine', text: 'My own note.', category: 'Denture' }]) });
  eq('and what they write themselves is what comes back',
     ctx.get().templates.map(t => t.situation), ['Mine']);
  const before = ctx.get().templates;
  eq('rubbish is refused', ctx.save({ templates: 'not json' }).success, false);
  eq('and the list is left as it was', ctx.get().templates, before);
}

// ── routed, and the second pair is gone ─────────────────────────────────
ok('the clinical routes are there',
   /case "getClinicalNoteTemplates":\s+return getClinicalNoteTemplates\(\);/.test(gs) &&
   /case "saveClinicalNoteTemplates": return saveClinicalNoteTemplates\(p\);/.test(gs));
ok('and the treatment-note routes are gone',
   !/case "getTreatmentNoteTemplates"/.test(gs) && !/case "saveTreatmentNoteTemplates"/.test(gs));
ok('the backend that does this is there to deploy',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-06f',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [])[1]);

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
