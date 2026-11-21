// "In CGHS prescription there is no option to save what all we have
//  entered need a save button and also need a search button with date
//  option so that later if required we can get it and if required take a
//  print out"
//
// A prescription was printed once and existed nowhere else. The panel
// queries a bill three months on, the patient loses the sheet, a course
// runs over three visits and the last needs the first one's wording -- and
// every time it had to be rebuilt from the endorsement by hand.
//
// Two things decide whether this is worth having:
//
//   the reprint   a sheet pulled back out must be the sheet that was
//                 signed. So the DOCUMENT is saved, not a summary of it,
//                 and the same builder prints the live one and the saved
//                 one. Two builders would drift the first time either was
//                 touched.
//
//   the search    a read must not bring the tab into being. A clinic that
//                 has saved nothing gets an empty list, not a new tab in
//                 its spreadsheet.
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
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 400) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

// ── the sheet ──────────────────────────────────────────────────────────
const makeSheet = (name) => ({
  name: name, _rows: [],
  getName() { return this.name; },
  getLastRow() { return this._rows.length; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  getRange(row, col, nr, nc) {
    const sh = this;
    return { getValues: () => {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const r = sh._rows[row - 1 + i] || [], v = [];
        for (let j = 0; j < nc; j++) v.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
        out.push(v);
      }
      return out;
    } };
  },
  // Google Sheets parses "2026-11-14" on write and hands back a DATE, not
  // the text that went in. The stub does the same, or a search that works
  // here fails on the clinic's sheet and nowhere else.
  appendRow(r) {
    this._rows.push(r.map(function (v, i) {
      return (i === 1 && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
        ? new Date(v + 'T00:00:00Z') : v;
    }));
  }
});

const load = () => {
  const a = gs.indexOf('// ── Saved CGHS prescriptions ─');
  const b = gs.indexOf('function saveScaling(p) {');
  const tabs = {}, created = [];
  const ctx = {
    String, Object, Array, Number, Math, Date, JSON, parseInt, console,
    getClinicalSheet: (n) => { if (!tabs[n]) { tabs[n] = makeSheet(n); created.push(n); } return tabs[n]; },
    getClinicalSheetIfExists_: (n) => tabs[n] || null,
    // The real one, so the stub cannot paper over a date it mishandles.
    formatDateISO: null
  };
  vm.createContext(ctx);
  // formatDateISO out of Code.gs itself, not a stand-in.
  vm.runInContext(gs.slice(gs.indexOf('function formatDateISO(val) {'),
                           gs.indexOf('\n}', gs.indexOf('function formatDateISO(val) {')) + 2)
    + '\nthis.formatDateISO = formatDateISO;', ctx);
  ctx.formatDateISO = ctx.formatDateISO;
  vm.runInContext(gs.slice(a, b)
    + '\nthis.save = saveCghsPrescription; this.list = listCghsPrescriptions;'
    + '\nthis.HEADERS = CGHS_RX_HEADERS; this.SHEET = CGHS_RX_SHEET;', ctx);
  return { ctx, tabs, created };
};

// ── nothing saved yet ──────────────────────────────────────────────────
{
  const { ctx, created } = load();
  const r = ctx.list({ from: '2026-01-01', to: '2026-12-31' });
  eq('a clinic that has saved nothing gets an empty list', [r.success, r.prescriptions], [true, []]);
  // The thing that is easy to get wrong and invisible when you do.
  eq('and searching creates no tab in its spreadsheet', created, []);
}

// ── what will not be saved ─────────────────────────────────────────────
{
  const { ctx, created } = load();
  const a = ctx.save({ document: '{"rows":[]}' });
  eq('a prescription with no patient is refused', a.success, false);
  ok('and says why', /patient/i.test(a.error), a.error);
  const b = ctx.save({ uhid: 'AH0713' });
  eq('an empty prescription is refused too', b.success, false);
  ok('and says why', /nothing/i.test(b.error), b.error);
  eq('neither made a tab', created, []);
}

// ── saving ─────────────────────────────────────────────────────────────
const DOC = JSON.stringify({ date: '2026-11-14',
  pat: { name: 'Altaf Ahmed Sikunder', uhid: 'AH0713', dob: '1972-04-03' },
  rows: [{ code: 'DP007', name: 'Flap Surgery- Per Tooth', tooth: '16, 26', qty: 2,
           sits: [{ date: '2026-11-07', text: 'Flap raised wrt 16, 26 under LA.' },
                  { date: '2026-11-14', text: 'Sutures removed wrt 16, 26.' }] }] });
{
  const { ctx, tabs } = load();
  eq('a prescription saves', ctx.save({ uhid: 'ah0713', patientName: 'Altaf Ahmed Sikunder',
    date: '2026-11-14', treatments: 'Flap Surgery- Per Tooth', teeth: '16, 26',
    sittings: '2', document: DOC }).success, true);
  const sh = tabs[ctx.SHEET];
  eq('under a heading row', sh._rows[0], ctx.HEADERS);
  eq('with the columns the clinic reads',
     [String(sh._rows[1][1]).slice(0, 15)].concat(sh._rows[1].slice(2, 7)),
     [String(new Date('2026-11-14T00:00:00Z')).slice(0, 15),
      'AH0713', 'Altaf Ahmed Sikunder', 'Flap Surgery- Per Tooth', '16, 26', '2']);
  // Typed in lower case at the desk, filed in upper so a later search finds it.
  eq('the UHID is filed the way it is searched', sh._rows[1][2], 'AH0713');
  eq('and the document itself is the last column', sh._rows[1][7], DOC);
  ok('with the moment it was saved', /^\d{4}-\d{2}-\d{2}T/.test(String(sh._rows[1][0])), sh._rows[1][0]);

  ctx.save({ uhid: 'AH0713', date: '2026-11-15', document: DOC });
  eq('a second one is appended, not written over the first', sh._rows.length, 3);
  eq('and the heading is written once', sh._rows.filter(r => r[0] === 'Saved At').length, 1);
}

// ── finding one again ──────────────────────────────────────────────────
{
  const { ctx } = load();
  const add = (uhid, date) => ctx.save({ uhid, patientName: uhid, date, document: DOC });
  add('AH0713', '2026-11-01'); add('AI0311', '2026-11-10');
  add('AH0713', '2026-11-14'); add('AH0713', '2026-12-02');

  const dates = (p) => ctx.list(p).prescriptions.map(r => r.date);
  // The one wanted again is nearly always the last one made.
  eq('newest first', dates({}), ['2026-12-02', '2026-11-14', '2026-11-10', '2026-11-01']);
  eq('one patient only', dates({ uhid: 'AH0713' }), ['2026-12-02', '2026-11-14', '2026-11-01']);
  eq('typed in lower case finds it too', dates({ uhid: 'ah0713' }).length, 3);
  // "1st to the 14th" means the 14th.
  eq('both ends of the range are included',
     dates({ from: '2026-11-01', to: '2026-11-14' }),
     ['2026-11-14', '2026-11-10', '2026-11-01']);
  eq('a from on its own', dates({ from: '2026-11-14' }), ['2026-12-02', '2026-11-14']);
  eq('a to on its own', dates({ to: '2026-11-01' }), ['2026-11-01']);
  eq('and the two together with a patient',
     dates({ uhid: 'AH0713', from: '2026-11-02', to: '2026-11-30' }), ['2026-11-14']);
  eq('a range with nothing in it finds nothing', dates({ from: '2027-01-01' }), []);

  // The bug this guards: the Date column comes back as a Date object, and
  // read as text it reads "Mon Nov 10" -- larger than any `to` a search can
  // carry, so every row was filtered out and a full tab searched as empty.
  eq('a date the sheet stored as a DATE is still searched as a date',
     dates({ to: '2026-11-10' }), ['2026-11-10', '2026-11-01']);
  const one = ctx.list({ uhid: 'AI0311' }).prescriptions[0];
  eq('a found row carries what is needed to list it',
     [one.uhid, one.patientName, one.date], ['AI0311', 'AI0311', '2026-11-10']);
  ok('with the date in the shape the screen formats', /^\d{4}-\d{2}-\d{2}$/.test(one.date), one.date);
  eq('and the document, so it can be printed', JSON.parse(one.document).pat.uhid, 'AH0713');
}
{
  // A row saved with no date cannot be ruled IN by a date search, but must
  // still be findable by the patient.
  const { ctx } = load();
  ctx.save({ uhid: 'AH0713', document: DOC });
  eq('a row with no date is not swept into a date range',
     ctx.list({ from: '2026-01-01', to: '2026-12-31' }).prescriptions.length, 0);
  eq('but is still found by the patient', ctx.list({ uhid: 'AH0713' }).prescriptions.length, 1);
}
{
  const { ctx } = load();
  for (let i = 0; i < 260; i++) ctx.save({ uhid: 'AH0713', date: '2026-11-14', document: DOC });
  eq('a search cannot be asked for the whole sheet at once',
     ctx.list({ limit: 9999 }).prescriptions.length, 200);
  eq('and a smaller limit is honoured', ctx.list({ limit: 3 }).prescriptions.length, 3);
}

// ── the printed sheet, live and saved, off ONE builder ─────────────────
ok('the printer takes a payload rather than the editor\'s state',
   /function buildCghsRxHTML\(rx, pad\)/.test(html));
ok('the live sheet goes through it',
   /const build = \(\) => buildCghsRxHTML\(payload\(\), pad\);/.test(html));
ok('and so does a saved one',
   /cghsPrint\(buildCghsRxHTML\(rx, pad\)\);/.test(html));
eq('which is the only builder there is',
   (html.match(/function buildCghsRxHTML\(/g) || []).length, 1);
{
  const fnOf = (name) => {
    const a = html.indexOf('function ' + name + '(');
    return html.slice(a, html.indexOf('\n}\n', a) + 3) + '\n';
  };
  const pctx = { String, Object, Array, Number, Math, Date, console,
    TODAY: '19/11/2026',
    fmtDMY: (d) => { const s = String(d || ''); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
                     return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; },
    calcAge: () => '54', signatureLine: () => 'Dr. Viveyk Mittel',
    cghsPadCss: () => '', cghsEsc: (v) => String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    cghsBlankTokens: (t) => String(t || '').replace(/\{\w+\}/g, '__________') };
  vm.createContext(pctx);
  vm.runInContext(fnOf('buildCghsRxHTML') + '\nthis.go = buildCghsRxHTML;', pctx);

  const out = pctx.go(JSON.parse(DOC), null);
  ok('the saved sheet carries its patient', out.indexOf('Altaf Ahmed Sikunder') >= 0);
  ok('and its treatment, code, tooth and units',
     out.indexOf('Flap Surgery- Per Tooth') >= 0 && out.indexOf('DP007') >= 0
     && out.indexOf('16, 26') >= 0, out.slice(out.indexOf('<tbody>'), out.indexOf('<tbody>') + 400));
  // Two sittings: the row shows the span, each visit its own dated line.
  ok('two sittings print as the span they ran over',
     out.indexOf('07/11/2026 – 14/11/2026') >= 0,
     (out.match(/\d\d\/\d\d\/\d{4}[^<]*/g) || []).join(' | '));
  ok('with each visit on its own dated line',
     /<b>07\/11\/2026<\/b>[\s\S]{0,40}Flap raised/.test(out)
     && /<b>14\/11\/2026<\/b>[\s\S]{0,40}Sutures removed/.test(out));

  // One sitting reads as a sentence, with no date repeated in front of it.
  const single = pctx.go({ date: '2026-11-14', pat: { name: 'A', uhid: 'X' },
    rows: [{ code: 'C', name: 'Scaling', tooth: '', qty: 1,
             sits: [{ date: '', text: 'Ultrasonic scaling done.' }] }] }, null);
  ok('one sitting needs no date in front of it',
     single.indexOf('Ultrasonic scaling done.') >= 0 && !/<b>14\/11\/2026<\/b> —/.test(single));
  ok('and an empty tooth cell still prints something', single.indexOf('—') >= 0);
  // A prescription is a blank form where a token was never filled in.
  ok('an unfilled token prints as a blank to write on',
     pctx.go({ date: '2026-11-14', pat: {}, rows: [{ code: '', name: 'X', tooth: '', qty: 1,
       sits: [{ date: '', text: 'Done wrt {tooth}.' }] }] }, null).indexOf('__________') >= 0);
  // Nothing at all must not throw: the screen opens before a patient loads.
  ok('an empty payload does not throw', typeof pctx.go({}, null) === 'string');
  ok('nor does nothing at all', typeof pctx.go(null, null) === 'string');
}

// ── the screen ─────────────────────────────────────────────────────────
ok('there is a Save button', /\\uD83D\\uDCBE Save Prescription/.test(html)
   || html.indexOf('💾 Save Prescription') >= 0);
ok('and a way to look for one', html.indexOf('Saved Prescriptions') >= 0);
ok('the search is a screen of its own', /function CghsRxSearch\(/.test(html));
ok('it sends the document, not a summary of it',
   /document: JSON\.stringify\(rx\)/.test(html));
ok('a patient must be loaded before anything is filed',
   /if \(!rx\.pat\.uhid\)/.test(html));
ok('an empty prescription is not filed either', /if \(!rx\.rows\.length\)/.test(html));
// A row an older page wrote that cannot be read back must say so, not
// print a blank sheet over the clinic's pad.
ok('a document that cannot be read back is said so rather than printed blank',
   /could not be read back/.test(html));
ok('the search defaults to the last month',
   /30 \* 24 \* 60 \* 60 \* 1000/.test(html));
ok('and to the patient on screen',
   /const u = pat && pat\.uhid \? pat\.uhid : "";/.test(html) && /setFindUhid\(u\);/.test(html));

// The page must ask for the backend that has these two calls.
ok('the page asks for a backend new enough to answer',
   /const KB_BACKEND_BUILD_REQUIRED = "2026-11-20"/.test(html));
ok('and the backend says it is', /var BACKEND_BUILD = "2026-11-20"/.test(gs));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
