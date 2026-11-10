// "yes draft the hindi for all 156 templates"
//
// The Hindi column on the clinical note templates shipped empty: a toggle
// with nothing behind it prints English. 156 drafts are carried in the page
// and loaded into the sheet in one press, so the toggle has something to
// say on every template rather than on the handful somebody got round to.
//
// Drafted as WHAT THE PATIENT IS TOLD HAPPENED. The English notes are
// clinical shorthand -- irrigant names, file sizes, canal lengths -- which
// is the medico-legal record and means nothing read out to a patient. The
// tooth and the counts are kept; the instrument minutiae are not.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 400) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const ctx = { String, Object, Array };
vm.createContext(ctx);
vm.runInContext(cut('const CLINICAL_NOTE_TEMPLATE_SEED = [', 'const CLINICAL_NOTE_PLAN_SEED = [')
  + cut('const CLINICAL_TEMPLATE_HINDI = {', 'const CLINICAL_PLAN_NAMES')
  + '\nthis.SEED = CLINICAL_NOTE_TEMPLATE_SEED; this.HI = CLINICAL_TEMPLATE_HINDI;', ctx);
const { SEED, HI } = ctx;

const names = SEED.map(r => r[1]);
const devanagari = /[ऀ-ॿ]/;

eq('all 156 templates are in the page', names.length, 156);
eq('and there is a Hindi draft for each one', Object.keys(HI).length, 156);

const missing = names.filter(n => !HI[n]);
eq('no template is left without one', missing, []);

const stray = Object.keys(HI).filter(k => names.indexOf(k) < 0);
eq('and no draft belongs to a template that does not exist', stray, []);

const notHindi = Object.keys(HI).filter(k => !devanagari.test(HI[k]));
eq('every draft is actually in Hindi', notHindi, []);

const tooShort = Object.keys(HI).filter(k => String(HI[k]).trim().length < 12);
eq('and none of them is a stub', tooShort, []);

// Which tooth, which arch, and for how long: without those the patient is
// told something was done to nothing in particular, or is sent home with no
// idea how long to keep doing it. Canal counts, file sizes, irrigants and
// the date are deliberately not in this list -- they are the record's
// business, not the patient's, and the date is printed on the sheet.
const KEEP = ['tooth', 'teeth', 'arch', 'quadrant', 'region', 'days', 'hours'];
const dropped = [];
SEED.forEach(r => {
  const want = [];
  String(r[2] + ' ' + r[3]).replace(/\{([^}]+)\}/g, (m, t) => {
    if (KEEP.indexOf(String(t).trim().toLowerCase()) >= 0 && want.indexOf(m) < 0) want.push(m);
    return m;
  });
  const lost = want.filter(t => String(HI[r[1]] || '').indexOf(t) < 0);
  if (lost.length) dropped.push(r[1] + ' ' + JSON.stringify(lost));
});
eq('which tooth, which arch and for how long survive into the Hindi', dropped, []);

// ── and it can be got into the sheet ───────────────────────────────────
const editor = cut('function ClinicalTemplateLibEditor(', 'function ClinicalPlanEditor(');
ok('the editor offers to fill the blank Hindi cells in one press',
   /Fill in the Hindi draft \(/.test(editor), '');
ok('from the drafts, and only where the cell is still blank',
   /!txt\(r\.hindi\)\.trim\(\) && CLINICAL_TEMPLATE_HINDI\[txt\(r\.template\)\]/.test(editor), '');
ok('and it saves them, rather than only showing them',
   /onSave\(all\.map\(r =>/.test(editor), '');
// A press that quietly rewrites a Hindi line the doctor typed is worse than
// no button at all.
ok('a cell that already has Hindi in it is left alone',
   !/\{ \.\.\.r, hindi: CLINICAL_TEMPLATE_HINDI\[txt\(r\.template\)\] \} : r\)\)[\s\S]{0,40}force/.test(editor), '');

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
