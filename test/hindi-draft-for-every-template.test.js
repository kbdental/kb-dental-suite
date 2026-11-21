// "yes draft the hindi for all 156 templates"
//
// The Hindi column on the clinical note templates shipped empty: a toggle
// with nothing behind it prints English. 156 drafts are carried in the page
// and loaded into the sheet in one press, so the toggle has something to
// say on every template rather than on the handful somebody got round to.
//
// The first drafts were written as WHAT THE PATIENT IS TOLD HAPPENED, on
// the reasoning that the English is clinical shorthand. Read back, that
// was the wrong trade: "BMP completed wrt {tooth} in {canals} with
// {system}, {Canal}= ({WL}/{MAF}), irrigated with {irrigants} {n} \u00d7 {min}
// min" came out as "the canals were cleaned and medicine was put in", and
// everything that makes it a note was gone. Three of them had also
// invented a token the English does not have, which prints as a blank
// line on the patient's own sheet because nothing fills it.
//
// So the rule is now: the Hindi is the CONCISE line, in Hindi. Same facts
// in the same order, the same {tokens} and no others, the same [optional
// parts] in the same places. The wording is the Hindi a dentist speaks --
// Devanagari with the dental terms as they are said at the chair -- not
// terms translated into words nobody uses.
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

// \u2500\u2500 the Hindi carries the concise line, and only it \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Only {simpleTokens} are filled in at print time; a brace group with
// spaces or slashes in it is a choice for the dentist to edit and is left
// alone. So those are what must line up.
const simple = (v) => [...String(v || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]);

// A token in the Hindi that the concise line has no value for prints as a
// blank line on the patient's sheet. Three drafts did exactly this -- a
// {days} on a root coverage and a suture removal, a {teeth} on the T-Scan
// balancing -- and nothing on either screen would ever have shown it.
const invented = [];
SEED.forEach(r => {
  const have = simple(r[2]);
  const extra = simple(HI[r[1]]).filter(t => have.indexOf(t) < 0);
  if (extra.length) invented.push(r[1] + ' ' + JSON.stringify(extra));
});
eq('no Hindi draft asks for something the English cannot fill in', invented, []);

// And the other way: a token the concise fills in and the Hindi leaves out
// is a fact the Hindi reader is not told.
const dropped = [];
SEED.forEach(r => {
  const hi = simple(HI[r[1]]);
  const lost = simple(r[2]).filter(t => hi.indexOf(t) < 0);
  if (lost.length) dropped.push(r[1] + ' ' + JSON.stringify(lost));
});
eq('and none of them drops one the English fills in', dropped, []);

// The square brackets mark the parts to delete when they do not apply.
// They have to mark the same parts in both, or deleting one on the sheet
// leaves the other language saying it happened.
const brackets = [];
SEED.forEach(r => {
  const n = (v) => (String(v || '').match(/\[/g) || []).length;
  if (n(r[2]) !== n(HI[r[1]])) brackets.push(r[1] + ' EN ' + n(r[2]) + ' / HI ' + n(HI[r[1]]));
});
eq('the optional parts are the same parts in both languages', brackets, []);

// Nothing left unclosed: a stray brace reaches the paper as a brace.
const unbalanced = Object.keys(HI).filter(k => {
  const c = (ch) => (HI[k].match(new RegExp('\\' + ch, 'g')) || []).length;
  return c('{') !== c('}') || c('[') !== c(']');
});
eq('every brace and bracket is closed', unbalanced, []);

// The terms a dentist reads out as letters stay as letters, in both.
const acronyms = [];
SEED.forEach(r => {
  ['IOPA', 'OPG', 'CBCT', 'HPE', 'DSRP', 'TENS'].forEach(a => {
    if (new RegExp('\\b' + a + '\\b').test(r[2]) && String(HI[r[1]]).indexOf(a) < 0)
      acronyms.push(r[1] + ' ' + a);
  });
});
eq('IOPA is still IOPA in the Hindi', acronyms, []);

// The clinical content is the point of the rewrite. These are the lines
// that lost the most, so they are the ones worth naming.
[['BMP', ['{canals}', '{system}', '{WL}', '{MAF}', '{irrigants}', '{min}', '{dressing}', 'IOPA']],
 ['Composite \u2013 Posterior', ['{class}', '{surfaces}', '{matrix}', '{liner}', '{composite}', '{shade}', '{technique}']],
 ['Single Visit RCT', ['{canals}', '{method}', '{system}', '{MAF}', '{irrigants}', '{sealer}', 'IOPA']],
 ['Implant Placement', ['{brand}', '{size}', '{guide}', '{torque}']]
].forEach(([name, parts]) => {
  const missingParts = parts.filter(p => String(HI[name] || '').indexOf(p) < 0);
  eq('the Hindi for ' + name + ' says what was actually done', missingParts, []);
});

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
