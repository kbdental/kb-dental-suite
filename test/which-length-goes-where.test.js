// "Now please remove the comprehensive clinical notes templates they are
//  not required"
//
// There were two lengths per template, split by purpose: the concise line
// printed on the prescription pad, the comprehensive paragraph saved into
// the daily register, the progress note and the procedure-done sheet. That
// was asked for, built, and used -- and then keeping 156 pairs of notes in
// step cost more than the second one earned, so the clinic asked for it to
// go.
//
// One note per template now. It prints AND it is saved.
//
// What this file guards is the part that is easy to get wrong: removing a
// field from an editor must not remove it from the sheet. The Type 2
// column is still read, still written back on every save, and still
// carried untouched through the row editor -- so the writing is all there
// and the decision can be undone. A save that dropped it would be
// irreversible, and silently so.
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
  // A template whose concise line nobody has written, with only the long
  // form in the sheet.
  { category: 'RCT', template: 'Working Length', type1: '', type2: 'WL recorded wrt {tooth} at {length}mm.' },
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
vm.runInContext(src + '\nthis.saveLib = saveClinicalNoteTemplateLib;'
  + '\nthis.readLib = getClinicalNoteTemplatesV3_;'
  + '\nthis.getTpl = getClinicalNoteTemplates;', ctx);
ctx.saveLib({ rows: JSON.stringify(LIB) });
const out = ctx.getTpl().templates;

// One pick per procedure, as before -- the clinician never chose a length,
// and now there is none to choose.
eq('one entry per template', out.length, 3);
eq('named for the procedure, with no length in the name',
   out.map(t => t.situation), ['Access Opening', 'Flap Surgery', 'Working Length']);
ok('a template with nothing written is not offered',
   !out.some(t => t.situation === 'Empty'), JSON.stringify(out.map(t => t.situation)));

// ── one note, and it is the concise one ─────────────────────────────────
// `text` is what the eighteen work-done forms insert, and therefore what
// is SAVED into the register, the progress note and the procedure-done
// sheet. It is now the short line.
eq('what the forms insert -- and so what is stored -- is the concise note',
   out[0].text, 'Access opening done wrt {tooth}.');
eq('and the prescription is handed the very same text',
   out.map(t => t.concise), out.map(t => t.text));
eq('no second length is offered under any name',
   out.filter(t => 'comprehensive' in t || 'type2' in t), []);
eq('the department rides along, because the forms filter on it',
   out.map(t => t.category), ['RCT', 'Periodontics', 'RCT']);

// A template with only the long form written must still insert something.
eq('with no concise line written, the long one is used rather than nothing',
   [out[2].text, out[2].concise],
   ['WL recorded wrt {tooth} at {length}mm.', 'WL recorded wrt {tooth} at {length}mm.']);

// ── the column survives, so this is reversible ──────────────────────────
// The editor stopped showing Type 2. If that had also stopped it being
// written, the first save after the change would have blanked 156
// paragraphs with no way back.
eq('the comprehensive column is still read off the sheet unchanged',
   ctx.readLib().map(r => r.type2),
   [LIB[0].type2, LIB[1].type2, LIB[2].type2, '']);
ok('and the save still writes it, so a round trip does not lose it',
   /r\.type1 \|\| "", r\.type2 \|\| ""/.test(gs), 'saveClinicalNoteTemplateLib');
eq('the heading is still there, so the column keeps its place',
   /"Type 2 \(Comprehensive\)"/.test(gs), true);
{
  // Round trip twice: save what was read back, and nothing moves.
  const again = ctx.readLib();
  ctx.saveLib({ rows: JSON.stringify(again) });
  eq('saving what the editor loaded leaves every paragraph where it was',
     ctx.readLib().map(r => r.type2), again.map(r => r.type2));
}
// The editor edits a COPY of the whole row, which is what carries a field
// it no longer shows. Spread it field by field and Type 2 would fall out.
ok('the row editor opens on a copy of the whole row',
   /const startEdit = \(at\) => \{ setEditAt\(at\); setDraft\(\{ \.\.\.all\[at\] \}\); \};/.test(html));
ok('and no box in the editor writes to it any more',
   !/type2: e\.target\.value/.test(html));

// ── the dropdown ────────────────────────────────────────────────────────
{
  const fnOf = (name) => {
    const a = html.indexOf('function ' + name + '(');
    return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
  };
  const pctx = { String, Array, Object };
  vm.createContext(pctx);
  vm.runInContext('const CGHS_TPL_STOP = '
      + /const CGHS_TPL_STOP = (\[[\s\S]*?\]);/.exec(html)[1] + ';\n'
    + fnOf('cghsFillTokens') + fnOf('cghsTemplateFor')
    + fnOf('clinicalTemplateRefs') + fnOf('clinicalNoteOptions')
    + '\nthis.pick = cghsTemplateFor; this.fill = cghsFillTokens;'
    + '\nthis.opts = clinicalNoteOptions;', pctx);
  const hit = pctx.pick('Flap Surgery- Per Tooth', out);
  eq('the rate-card name finds the one template', (hit || {}).situation, 'Flap Surgery');
  eq('the prescription prints the concise line',
     pctx.fill(hit.concise, { tooth: '16, 26' }), 'Flap raised wrt 16, 26.');
  eq('and the record keeps that same line, not a paragraph',
     pctx.fill(hit.text, { tooth: '16, 26' }), 'Flap raised wrt 16, 26.');

  // What the chair actually sees: one entry per template the plan names.
  const plan = [{ plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth',
                  templates: 'Flap Surgery' }];
  const labels = pctx.opts('Flap Surgery- Per Tooth', out, plan, 'CGHS', { tooth: '16' })
    .map(o => o.label);
  eq('one entry, named for the template, with no length to choose between',
     labels, ['Flap Surgery']);
  // Nothing BUILDS such a label any more. The page still knows how to
  // strip one off a name saved under the old scheme, and that lives in a
  // comment and a regex, which is why the comments come out first.
  const code = html.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok('nothing in the page builds a label naming a length',
     !/"[^"]*Type [12] \((Concise|Comprehensive)\)/.test(code),
     (code.match(/"[^"]*Type [12] \((Concise|Comprehensive)\)/) || [])[0]);
}

// ── and the forms are fed that list unchanged ───────────────────────────
ok('the work-done forms are fed the same list, filtered by department',
   /const filtered = form && form\.templateCategory[\s\S]{0,400}clinicalTemplates\.filter\(t => t\.category === form\.templateCategory\)/.test(html));
ok('and it is the templates the backend derived, not a second copy',
   /api\("getClinicalNoteTemplates"\)\.then\(res => \{ if \(res\.success && res\.templates\) setClinicalTemplates\(res\.templates\); \}\);/.test(html));
ok('the register still reads the form\'s own notes field',
   /workDone:\s+\["remarks", "notes", "clinicalNotes"/.test(html));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
