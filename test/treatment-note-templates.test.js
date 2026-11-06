// "now i would like to add the treatment note templates under notes by
//  making a new button"
//
// A second book of templates, beside the clinical ones and not inside them.
// A clinical note is what was done in the chair, written on a form; a
// treatment note is what is said about the treatment itself. One list
// holding both would mean every form offering both and the clinic reading
// past half of them to find the half it wanted.
//
// Nothing uses these yet -- that is the next prompt. What matters today is
// that what is typed in survives, and that it cannot land in the clinical
// list or overwrite it.
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

// ── the button, under Notes, beside the clinical one ────────────────────
{
  const notes = html.slice(html.indexOf('{ id:"notes", label:"Notes", subtabs:['),
                           html.indexOf('{ id:"accounts", label:"Accounts"'));
  ok('the Notes group was found', notes.length > 100, notes.length);
  ok('there is a Treatment Note Templates button',
     /\{ id:"treatmentNotes",\s*label:"Treatment Note Templates" \}/.test(notes), notes);
  ok('it sits next to the clinical one',
     notes.indexOf('id:"templates"') < notes.indexOf('id:"treatmentNotes"'), notes);
  ok('and the clinical one is still there',
     /\{ id:"templates",\s*label:"Clinical Note Templates" \}/.test(notes), notes);
  ok('the post-op lists were not displaced',
     /id:"medInstructions"/.test(notes) && /id:"medNotes"/.test(notes), notes);
}

// ── it has a screen, and it is the one staff already know ───────────────
ok('the button renders the template editor',
   /treatmentNotes: \(\) => React\.createElement\(TemplateListEditor, \{\s*items:treatmentTemplates,/.test(html));
ok('adding, editing and removing all go to the treatment list',
   /onAdd:\(item\)=>saveTreatmentTemplates\(\[\.\.\.treatmentTemplates, item\]\)/.test(html) &&
   /onRemove:\(i\)=>saveTreatmentTemplates\(treatmentTemplates\.filter/.test(html) &&
   /onEdit:\(i,item\)=>saveTreatmentTemplates\(treatmentTemplates\.map/.test(html));
// The mistake that would be invisible on screen and permanent in the sheet.
ok('nothing on this screen writes to the clinical list',
   !/treatmentNotes: \(\) =>[\s\S]{0,700}saveTemplates\(/.test(html));
ok('and the clinical screen still writes to its own',
   /templates: \(\) => React\.createElement\(TemplateListEditor, \{\s*items:clinicalTemplates,[\s\S]{0,400}?saveTemplates\(/.test(html));

// ── saved through the same checked write as every other list ────────────
// persist puts the list back and says so if the sheet refuses it, instead of
// leaving it on screen to be lost at the next load.
ok('it is saved through persist, not by hand',
   /const saveTreatmentTemplates = \(arr\) => persist\("saveTreatmentNoteTemplates", \{ templates: JSON\.stringify\(arr\) \}, arr, setTreatmentTemplates, treatmentTemplates\);/.test(html));

// ── read in the one request the Master page already makes ───────────────
{
  const master = html.slice(html.indexOf('apiBatch([\n      "getTreatmentsMaster"'));
  const asked = master.slice(0, master.indexOf(']'));
  ok('it is asked for in the batch, not in a second round trip',
     /"getTreatmentNoteTemplates"/.test(asked), asked);
  const names = (asked.match(/"([^"]+)"/g) || []).length;
  const landed = (/\.then\(\(\[([^\]]+)\]/.exec(master) || [, ''])[1]
    .split(',').map(s => s.trim()).filter(Boolean);
  eq('every list asked for still has somewhere to land', names, landed.length);
  eq('and the new one is last, where it was added', landed[landed.length - 1], 'tnt');
  ok('a backend that has not been redeployed leaves it empty rather than breaking',
     /if \(tnt && tnt\.success\) setTreatmentTemplates\(tnt\.templates \|\| \[\]\);/.test(html));
}

// ── the sheet, run ──────────────────────────────────────────────────────
{
  const src = gs.slice(gs.indexOf('function getTreatmentNoteTemplates() {'),
                       gs.indexOf('function getPatientOutstanding(p) {'));
  ok('the two functions were found', /function saveTreatmentNoteTemplates/.test(src), src.length);

  const sheets = {};
  const makeSheet = (name) => ({
    name: name, _rows: [],
    getLastRow() { return this._rows.length; },
    getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
    getRange(row, col, nr, nc) {
      const sh = this;
      return {
        getValues: () => sh._rows.slice(row - 1, row - 1 + nr).map(r => r.slice(col - 1, col - 1 + nc)),
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
  const ctx = {
    getSheet: (n) => (sheets[n] = sheets[n] || makeSheet(n)),
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'not a list' }; } },
    // The real list, so the seeding is tested against what actually ships.
    TREATMENT_NOTE_SEED: vm.runInNewContext(
      gs.slice(gs.indexOf('var TREATMENT_NOTE_SEED = ['),
               gs.indexOf('];', gs.indexOf('var TREATMENT_NOTE_SEED = [')) + 2)
      + '\nTREATMENT_NOTE_SEED'),
    Date, String, JSON
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.get = getTreatmentNoteTemplates; this.save = saveTreatmentNoteTemplates;', ctx);

// ── the clinic's own 188 notes ──────────────────────────────────────────
// Sent as a spreadsheet, shipped in the backend: the same list has to be on
// both instances, and 188 long notes typed twice through a browser is a
// list typed wrong.
{
  const seed = gs.slice(gs.indexOf('var TREATMENT_NOTE_SEED = ['),
                        gs.indexOf('];', gs.indexOf('var TREATMENT_NOTE_SEED = [')) + 2);
  const rows = vm.runInNewContext(seed + '\nTREATMENT_NOTE_SEED');
  eq('every note the clinic sent is there', rows.length, 188);
  ok('each is a department, a treatment and the note',
     rows.every(r => r.length === 3 && r.every(x => typeof x === 'string')),
     JSON.stringify(rows.find(r => r.length !== 3 || r.some(x => typeof x !== 'string'))));
  ok('none of them is blank',
     rows.every(r => r[0].trim() && r[1].trim() && r[2].trim()),
     JSON.stringify(rows.find(r => !(r[0].trim() && r[1].trim() && r[2].trim()))));
  // Every department it files them under must be offered by the editor, or
  // a note lands under a heading the clinic cannot pick again.
  const cats = vm.runInNewContext(
    html.slice(html.indexOf('const TREATMENT_TEMPLATE_CATEGORIES = ['),
               html.indexOf(';', html.indexOf('const TREATMENT_TEMPLATE_CATEGORIES = [')))
    + '\nTREATMENT_TEMPLATE_CATEGORIES');
  eq('the departments are the clinic\'s own, not the clinical-note ones',
     cats.length, 14);
  ok('and every note falls under one of them',
     rows.every(r => cats.indexOf(r[0]) >= 0),
     JSON.stringify(rows.filter(r => cats.indexOf(r[0]) < 0).map(r => r[0])));
  ok('the ones the clinical list has no room for are among them',
     ['General / Consultation', 'TMJ / Occlusion', 'RCT / Endodontics', 'Denture', 'Cosmetic']
       .every(c => cats.indexOf(c) >= 0), JSON.stringify(cats));
  // A treatment can carry more than one note -- Consultation has fifteen --
  // so the list must not be deduplicated by name anywhere.
  const consult = rows.filter(r => r[1] === 'Consultation');
  ok('a treatment may have several notes to choose from', consult.length > 1, consult.length);
  ok('the editor is given these departments and not the clinical ones',
     /treatmentNotes: \(\) => React\.createElement\(TemplateListEditor, \{\s*items:treatmentTemplates,\s*categories:TREATMENT_TEMPLATE_CATEGORIES,/.test(html));
  ok('and the clinical editor still gets its own',
     /const CATS = \(categories && categories\.length\) \? categories : CLINICAL_TEMPLATE_CATEGORIES;/.test(html));
}

// ── seeded once, and only into a sheet nobody has touched ───────────────
{
  const sh = ctx.getSheet('Treatment Note Templates');
  const got = ctx.get();
  eq('an untouched sheet is filled with the clinic\'s list', got.templates.length, 188);
  eq('under the right headings', sh._rows[0],
     ['Situation', 'Template Text', 'Category', 'Updated At']);
  eq('the first one arrives whole',
     [got.templates[0].situation, got.templates[0].category, got.templates[0].text],
     ['Air Polishing', 'General / Consultation',
      'Full mouth air polishing done using {powderType} powder for extrinsic stain removal.']);
  eq('read again, it is not doubled', ctx.get().templates.length, 188);

  // The one that matters: a list the clinic deliberately empties stays
  // empty. Saving leaves a heading row, and only a sheet with no rows at
  // all seeds, so nothing is ever put back behind their back.
  ctx.save({ templates: JSON.stringify([]) });
  eq('a list cleared on purpose stays cleared', ctx.get().templates.length, 0);
  ctx.save({ templates: JSON.stringify([{ situation: 'Mine', text: 'My own note.', category: 'Denture' }]) });
  eq('and one the clinic wrote itself is what comes back',
     ctx.get().templates.map(t => t.situation), ['Mine']);
}

// A fresh sheet for the checks below.
delete sheets['Treatment Note Templates'];
ctx.get();
ctx.save({ templates: JSON.stringify([]) });
eq('an emptied sheet gives an empty list', ctx.get(), { success: true, templates: [] });

  const ITEMS = [
    { situation: 'Flap Surgery', text: 'Flap raised on {tooth}.', category: 'Periodontics' },
    { situation: 'Scaling', text: 'Scaling done.', category: '' }
  ];
  eq('a list is accepted', ctx.save({ templates: JSON.stringify(ITEMS) }), { success: true });
  eq('it comes back as it went in', ctx.get().templates, ITEMS);
  eq('and it is written to its own sheet, not the clinical one',
     Object.keys(sheets), ['Treatment Note Templates']);
  ok('the clinical sheet is never opened from here',
     !/getSheet\("Clinical Note Templates"\)/.test(src), src.slice(0, 200));
  eq('with a heading row', sheets['Treatment Note Templates']._rows[0],
     ['Situation', 'Template Text', 'Category', 'Updated At']);
  eq('and a row per template, with nothing left of the seed',
     sheets['Treatment Note Templates']._rows.length, 3);
  ok('each row is stamped',
     /^\d{4}-\d{2}-\d{2}T/.test(String(sheets['Treatment Note Templates']._rows[1][3])),
     String(sheets['Treatment Note Templates']._rows[1][3]));

  // Saving replaces the list, so removing one really removes it.
  ctx.save({ templates: JSON.stringify([ITEMS[1]]) });
  eq('a template removed on screen is gone from the sheet',
     ctx.get().templates.map(t => t.situation), ['Scaling']);
  eq('and nothing is left behind under it', sheets['Treatment Note Templates']._rows.length, 2);

  // Nonsense must not wipe the list.
  const before = ctx.get().templates;
  const bad = ctx.save({ templates: 'not json at all' });
  eq('rubbish is refused', bad.success, false);
  eq('and the list is left exactly as it was', ctx.get().templates, before);

  eq('a row with no situation is skipped on the way out',
     (function () {
       sheets['Treatment Note Templates']._rows.push(['', 'orphaned text', '', '']);
       return ctx.get().templates.length;
     })(), 1);
}

// ── and it is routed ────────────────────────────────────────────────────
ok('both actions are routed',
   /case "getTreatmentNoteTemplates":\s+return getTreatmentNoteTemplates\(\);/.test(gs) &&
   /case "saveTreatmentNoteTemplates": return saveTreatmentNoteTemplates\(p\);/.test(gs));
ok('the clinical routes are untouched',
   /case "getClinicalNoteTemplates":\s+return getClinicalNoteTemplates\(\);/.test(gs) &&
   /case "saveClinicalNoteTemplates": return saveClinicalNoteTemplates\(p\);/.test(gs));
ok('the backend that has them is there to deploy',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-06e',
   (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [])[1]);

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
