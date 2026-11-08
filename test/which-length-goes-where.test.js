// "when prescription is fired for print only the concise template is needed
//  but when putting the data in daily register or progress notes or
//  procedure done sheet and everywhere we save i need the comprehensive one
//  (same template as concise one used) to be stored"
//
// Which length is wanted is not a decision to make twice at the chair. It
// follows from what the text is FOR:
//
//   saved    the daily register, the progress note, the procedure-done
//            sheet -- the full record, because it has to stand on its own
//            years later, read by somebody else
//   printed  the prescription -- the concise line, because a paragraph
//            under every item on a pad is unreadable
//
// And it must be the SAME template either way: the clinician picks the
// procedure once, and the two lengths are two faces of that one pick.
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

// ── what the backend hands out ──────────────────────────────────────────
const LIB = [
  { category: 'RCT', template: 'Access Opening',
    type1: 'Access opening done wrt {tooth}.',
    type2: 'Access opening done wrt {tooth} under {anaesthesia}, irrigated with {irrigants}.' },
  { category: 'Periodontics', template: 'Flap Surgery',
    type1: 'Flap raised wrt {tooth}.',
    type2: 'Flap raised wrt {tooth} under {anaesthesia}, sutured, review in 7 days.' },
  // A template nobody has written the long form of yet.
  { category: 'RCT', template: 'Working Length', type1: 'WL recorded wrt {tooth}.', type2: '' },
  // And one with neither, which must not reach a dropdown at all.
  { category: 'RCT', template: 'Empty', type1: '', type2: '' }
];

const src = gs.slice(gs.indexOf('// ── Three things, kept apart ─'),
                     gs.indexOf('function getPatientOutstanding(p) {'));
const sheets = {};
const makeSheet = (name) => ({
  name: name, _rows: [], _max: 26,
  getName() { return this.name; }, setName(n) { this.name = n; },
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
const ss = { getSheetByName: (n) => sheets[n] || null,
             insertSheet: (n) => (sheets[n] = makeSheet(n)), _sheets: sheets };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  getSheet: (n) => sheets[n] || ss.insertSheet(n),
  ensureGridWidth_: (sh, n) => { if (n > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns()); },
  parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'bad' }; } },
  CLINICAL_NOTE_SEED: [], Date, String, JSON, Math
};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.saveLib = saveClinicalNoteTemplateLib; this.getTpl = getClinicalNoteTemplates;', ctx);
ctx.saveLib({ rows: JSON.stringify(LIB) });
const out = ctx.getTpl().templates;

// One pick, not two. Offering both lengths in the dropdown made the
// clinician choose twice for one procedure.
eq('one entry per template, not one per length', out.length, 3);
eq('named for the procedure, with no length in the name',
   out.map(t => t.situation), ['Access Opening', 'Flap Surgery', 'Working Length']);
ok('a template with neither length written is not offered',
   !out.some(t => t.situation === 'Empty'), JSON.stringify(out.map(t => t.situation)));

// `text` is what the eighteen forms insert, and therefore what is SAVED.
eq('what the forms insert -- and so what is stored -- is the full record',
   out[0].text,
   'Access opening done wrt {tooth} under {anaesthesia}, irrigated with {irrigants}.');
eq('and it is never the concise one where the full one exists',
   out.filter(t => t.comprehensive.trim() && t.text === t.concise && t.concise !== t.comprehensive), []);
eq('both lengths ride along for whoever needs the other',
   [out[1].concise, out[1].comprehensive],
   ['Flap raised wrt {tooth}.', 'Flap raised wrt {tooth} under {anaesthesia}, sutured, review in 7 days.']);
eq('the department rides along too, because the forms filter on it',
   out.map(t => t.category), ['RCT', 'Periodontics', 'RCT']);

// A template with no long form must still insert something.
eq('with no comprehensive written, the concise one is stored rather than nothing',
   [out[2].text, out[2].comprehensive], ['WL recorded wrt {tooth}.', 'WL recorded wrt {tooth}.']);

// ── the printed prescription takes the other one ────────────────────────
ok('the prescription asks for the concise length',
   /return cghsFillTokens\(t\.concise \|\| t\.text, \{/.test(html));
ok('and says why, where somebody might change it back',
   /The CONCISE length, deliberately/.test(html));

// Run, so the two are not merely declared different.
{
  const pctx = { String, Array, Object };
  vm.createContext(pctx);
  vm.runInContext(html.slice(html.indexOf('const CGHS_TPL_STOP = ['),
                             html.indexOf('function CghsPrescription('))
    + '\nthis.pick = cghsTemplateFor; this.fill = cghsFillTokens;', pctx);
  const hit = pctx.pick('Flap Surgery- Per Tooth', out);
  eq('the rate-card name finds the one template', (hit || {}).situation, 'Flap Surgery');
  eq('the prescription prints the concise line',
     pctx.fill(hit.concise, { tooth: '16, 26' }), 'Flap raised wrt 16, 26.');
  eq('while the record keeps the full one',
     pctx.fill(hit.text, { tooth: '16, 26', anaesthesia: '2% lignocaine' }),
     'Flap raised wrt 16, 26 under 2% lignocaine, sutured, review in 7 days.');
  // The same template either way: the clinician picked a procedure once.
  ok('both come from one pick', hit.concise !== hit.comprehensive
     && pctx.pick('Flap Surgery- Per Tooth', out) === hit);
}

// ── and the forms are fed that list unchanged ───────────────────────────
// Whatever the dropdown inserts is what the daily register's Work Done
// column, the progress note and the procedure-done sheet all read back.
ok('the work-done forms are fed the same list, filtered by department',
   /const filtered = form && form\.templateCategory[\s\S]{0,400}clinicalTemplates\.filter\(t => t\.category === form\.templateCategory\)/.test(html));
ok('and it is the templates the backend derived, not a second copy',
   /api\("getClinicalNoteTemplates"\)\.then\(res => \{ if \(res\.success && res\.templates\) setClinicalTemplates\(res\.templates\); \}\);/.test(html));
// The daily register reads what the form saved, so nothing extra is needed
// there -- but if that ever stops being true this is where to look.
ok('the register still reads the form\'s own notes field',
   /workDone:\s+\["remarks", "notes", "clinicalNotes"/.test(html));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
