// "it is how the prescription is printed all in one paragraph where earlier
//  it was stated that it has to come as per the tooth number in different
//  boxes"
//
// A visit is recorded as one entry. Finish the obturation on 16 and prepare
// 14 for a crown in the same sitting and that entry carries tooth "16, 14"
// and both notes, one line each, because that is how they were picked off
// the plan. Printed straight it was a single row: a comma-joined tooth cell
// and one unbroken paragraph. A case paper is read tooth by tooth, so each
// thing done needs its own box.
//
// What this file pins down is WHEN to split, because the two failure modes
// are opposite and both are worse than the merged row:
//
//   splitting too little   the 16/14 visit stays one paragraph
//   splitting too much     one composite restoration across 37 and 36
//                          becomes two rows, or a paragraph somebody typed
//                          by hand is chopped at its line breaks
//
// So: by note line, and only when the lines name DIFFERENT teeth.
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

const fnOf = (name) => {
  const a = html.indexOf('function ' + name + '(');
  if (a < 0) throw new Error('no function ' + name);
  return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
};

const ctx = { String, Object, Array, Number, console };
vm.createContext(ctx);
vm.runInContext(fnOf('kbTeethInLine') + fnOf('kbSplitVisitRows')
  + '\nthis.teeth = kbTeethInLine; this.split = kbSplitVisitRows;', ctx);

// ── reading a tooth out of a line ──────────────────────────────────────
// The clinic's own wording, off the case papers.
eq('after wrt, with a hash', ctx.teeth('Flowable Genial Composite restoration done under isolation wrt #46, 47 occlusally'),
   ['46', '47']);
eq('after wrt, without one', ctx.teeth('Obturation completed wrt 36 by lateral condensation.'), ['36']);
eq('two teeth joined by an ampersand',
   ctx.teeth('Tooth preparation for Zirconium crown done wrt #14 & #17 ,Digital scan recorded.'),
   ['14', '17']);
eq('a hash on its own', ctx.teeth('Cervical abrasion wrt #14, #15, #23, #24'), ['14', '15', '23', '24']);
// The one that makes a naive scan useless.
eq('a canal length is not a tooth',
   ctx.teeth('Obturation done in 3 canals MB=16mm-25/04 & DB=17mm-25/04, P=17.5mm-25/06'), []);
eq('nor is a date', ctx.teeth('Reviewed on 25/03/25, healing satisfactory.'), []);
eq('nor a number with no tooth about it', ctx.teeth('Patient advised to return in 2 days.'), []);
eq('a sentence after the tooth does not drag its numbers in',
   ctx.teeth('Composite restoration wrt 36. Review in 7 days, 2 visits.'), ['36']);
eq('the deciduous notation the clinic writes', ctx.teeth('Grade 1 mobility wrt 8E'), ['8E']);
eq('nothing named reads as nothing', ctx.teeth('Oral prophylaxis done.'), []);

// ── when to split ──────────────────────────────────────────────────────
// The case paper that prompted this.
const VISIT = {
  date: '2025-04-01', toothNo: '16, 14', doctor: 'Dr. Viveyk Mittel',
  treatmentRendered: 'RCT - Obturation, Tooth Preparation',
  clinicalNotes: 'Obturation done in 3 canals MB=16mm-25/04 with endomethasone, '
    + 'GIC base placed, composite buildup done, occlusally adjusted wrt #16.\n'
    + 'Tooth preparation for Zirconium crown done wrt #14, digital scan sent to lab. Shade A-2.',
  paymentMode: 'UPI', amountReceived: 4500
};
{
  const r = ctx.split([VISIT]);
  eq('two things done, two rows', r.length, 2);
  eq('each against its own tooth', r.map(x => x.toothNo), ['16', '14']);
  eq('and carrying only its own note',
     r.map(x => x.clinicalNotes.slice(0, 22)),
     ['Obturation done in 3 c', 'Tooth preparation for ']);
  ok('with the second note nowhere in the first row',
     r[0].clinicalNotes.indexOf('Zirconium') < 0, r[0].clinicalNotes);
  eq('the procedure label is split too, where the counts line up',
     r.map(x => x.treatmentRendered), ['RCT - Obturation', 'Tooth Preparation']);
  // The patient paid once.
  eq('the money is on the first row and nowhere else',
     r.map(x => x.amountReceived), [4500, '']);
  eq('and so is the payment mode', r.map(x => x.paymentMode), ['UPI', '']);
  eq('the date and the doctor are on both',
     [r[1].date, r[1].doctor], ['2025-04-01', 'Dr. Viveyk Mittel']);
}

// One restoration across two teeth is ONE thing done. Screenshot 1 and 3
// print it as one row, and so must we.
{
  const one = { date: '2025-04-01', toothNo: '37, 36', treatmentRendered: 'Restoration - Composite',
    clinicalNotes: 'Occlusal pits and marginal caries excavated, composite restoration '
      + 'with isolation done wrt 37, 36.', amountReceived: 0 };
  const r = ctx.split([one]);
  eq('one procedure across two teeth stays one row', r.length, 1);
  eq('with the tooth cell as it was written', r[0].toothNo, '37, 36');
  ok('and the same object, not a copy with fields moved about', r[0] === one);
}
{
  // Two lines, same tooth: still one thing being described.
  const same = { toothNo: '46', clinicalNotes: 'Caries excavated wrt 46.\nComposite placed wrt 46.' };
  eq('two lines about one tooth stay one row', ctx.split([same]).length, 1);
}
{
  // A paragraph typed by hand. No teeth line by line, so nothing to split on.
  const typed = { toothNo: '21', clinicalNotes: 'Patient reports sensitivity.\n'
    + 'Advised desensitising paste.\nTo review after two weeks.' };
  eq('a hand-typed paragraph is left exactly as written', ctx.split([typed]).length, 1);
}
{
  eq('one line is one row', ctx.split([{ toothNo: '11', clinicalNotes: 'Scaling done wrt 11.' }]).length, 1);
  eq('an entry with no note at all still prints', ctx.split([{ toothNo: '11' }]).length, 1);
  eq('nothing in, nothing out', ctx.split([]).length, 0);
  eq('and a missing list does not throw', ctx.split(null).length, 0);
}
{
  // Three lines, three teeth, and a label that does NOT split evenly: every
  // row keeps the whole label rather than being mislabelled with another
  // row's procedure.
  const three = { toothNo: '16, 14, 11', treatmentRendered: 'Multiple',
    clinicalNotes: 'A wrt 16.\nB wrt 14.\nC wrt 11.' };
  const r = ctx.split([three]);
  eq('three things, three rows', r.map(x => x.toothNo), ['16', '14', '11']);
  eq('and no row is given another row\'s procedure name',
     r.map(x => x.treatmentRendered), ['Multiple', 'Multiple', 'Multiple']);
}
{
  // A line with no tooth of its own falls back to the entry's tooth cell
  // rather than printing an empty box.
  const mixed = { toothNo: '16, 14', clinicalNotes: 'Obturation wrt 16.\nIOPA made.\nCrown prep wrt 14.' };
  eq('a line naming no tooth keeps the visit\'s own tooth cell',
     ctx.split([mixed]).map(x => x.toothNo), ['16', '16, 14', '14']);
}

// ── and the sheets actually use it ─────────────────────────────────────
ok('the Procedure Done Sheet splits its entries',
   /const rows = kbSplitVisitRows\(entries, \["workDone", "clinicalNotes"\]\)\.map/.test(html));
ok('the Procedure Form with Fee Received splits its procedures',
   /const procRows = kbSplitVisitRows\(procedures, \["treatmentRendered", "clinicalNotes"\]\)\.map/.test(html));
ok('and the Treatment Progress Notes split theirs',
   /const rows = kbSplitVisitRows\(entries, \["clinicalNotes", "workDone"\]\)\.map/.test(html));

// Printed, for real: the row count and the total have to agree.
{
  const pctx = {
    String, Object, Array, Number, Math, Date, console,
    window: { LOGO_B64: 'data:image/png;base64,AA' },
    TP_PCSS: '', fmtDMY: (d) => '01/04/2025'
  };
  vm.createContext(pctx);
  vm.runInContext(fnOf('cghsEsc') + fnOf('kbBulletCell') + fnOf('kbTeethInLine')
    + fnOf('kbSplitVisitRows') + fnOf('kbProgressSigner') + fnOf('buildProgressNotesHTML')
    + '\nthis.build = buildProgressNotesHTML;', pctx);
  const out = pctx.build({ name: 'Altaf Ahmed Sikunder', uhid: 'AH0713' }, [VISIT]);
  // One S.No. cell per body row; the header and the total row have none.
  const bodyRows = (out.match(/class="sno"/g) || []).length - 1;
  eq('the printed sheet has a row per thing done, not per visit', bodyRows, 2);
  ok('the first box is the obturation, against 16',
     />16<\/td>[\s\S]{0,120}RCT - Obturation/.test(out), out.slice(out.indexOf('<tbody>'), out.indexOf('<tbody>') + 400));
  ok('the second is the crown prep, against 14',
     />14<\/td>[\s\S]{0,120}Tooth Preparation/.test(out));
  ok('the paragraph is broken up, so neither box holds both notes',
     !/Obturation done in 3 canals[\s\S]{0,400}Tooth preparation for Zirconium/.test(out));
  // Splitting a row must not split the money.
  ok('and the total is what the patient actually paid, once',
     /Total Amount Received<\/td><td class="amt">₹4,500</.test(out),
     (out.match(/Total Amount Received[\s\S]{0,80}/) || [])[0]);
}

// ── the daily register: pointers, not a paragraph ──────────────────────
// "even in daily register I want separate procedures done in one day must
//  come as pointers and not like paragraphs"
//
// The register is one row per visit by design -- it is a day's log, not a
// treatment record -- so the fix there is not more rows but a list inside
// the cell.
{
  const bctx = { String, Object, Array, console };
  vm.createContext(bctx);
  vm.runInContext(fnOf('cghsEsc') + fnOf('kbBulletCell') + '\nthis.b = kbBulletCell;', bctx);
  const li = (s) => '<li style="margin-bottom:1.5pt">' + s + '</li>';
  const ul = (...xs) => '<ul style="margin:0;padding-left:11pt">' + xs.map(li).join('') + '</ul>';

  eq('two things done come out as two pointers',
     bctx.b('Obturation done wrt 16.\nCrown prep done wrt 14.'),
     ul('Obturation done wrt 16.', 'Crown prep done wrt 14.'));
  eq('and the procedures they were filed under, the same way',
     bctx.b('RCT - Obturation, Tooth Preparation', 'comma'),
     ul('RCT - Obturation', 'Tooth Preparation'));
  // A list drawn round a single note is noise.
  eq('one thing done stays a plain line', bctx.b('Scaling done wrt 11.'), 'Scaling done wrt 11.');
  eq('and one procedure likewise', bctx.b('Restoration - Composite', 'comma'),
     'Restoration - Composite');
  eq('an empty cell still reads as empty', bctx.b(''), '\u2014');
  eq('nothing at all does too', bctx.b(null), '\u2014');
  eq('a trailing comma makes no empty pointer', bctx.b('Scaling,', 'comma'), 'Scaling,');
  eq('blank lines between notes make none either',
     bctx.b('A wrt 16.\n\n\nB wrt 14.'), ul('A wrt 16.', 'B wrt 14.'));
  // The cell used to be interpolated raw. A list of them must not be.
  eq('and what goes in a pointer is escaped',
     bctx.b('A <b>x</b> wrt 16.\nB & C wrt 14.'),
     ul('A &lt;b&gt;x&lt;/b&gt; wrt 16.', 'B &amp; C wrt 14.'));
}
ok('the printed register uses it for Work Done',
   /line-height:1\.4">\$\{kbBulletCell\(e\.workDone\)\}<\/td>/.test(html));
ok('and for Procedure Done, which holds several names in one field',
   /<td>\$\{kbBulletCell\(e\.procedureDone, "comma"\)\}<\/td>/.test(html));

// ── three things on ONE tooth: new line, bullet each ───────────────────
// "if under a date there are 3-4 treatments ven for the same tooth it
//  should start from a new line and should have bullets to start with"
//  "so in register also start with a bullet"
//  "even in prescription separate it by bullets"
//
// Splitting into rows only happens where the lines name DIFFERENT teeth --
// one restoration across 37 and 36 is one thing done and must stay one
// row. But three things done to tooth 36 in one sitting are three lines
// inside that row, and dropped into a cell as text they run together into
// a paragraph. So inside the cell they are bullets.
{
  const nctx = { React: { createElement: (t, p, ...c) => ({ t, p, c: c.flat() }) },
                 String, Object, Array, console };
  vm.createContext(nctx);
  vm.runInContext(fnOf('KbNoteLines') + '\nthis.R = KbNoteLines;', nctx);
  const kind = (o) => o.t;
  const texts = (o) => o.c.map(x => (x && x.c) ? x.c[0] : x);

  const three = nctx.R({ text: 'A wrt 36.\nB wrt 36.\nC wrt 36.' });
  eq('three things on one tooth become a list', kind(three), 'ul');
  eq('one bullet each', texts(three), ['A wrt 36.', 'B wrt 36.', 'C wrt 36.']);
  // A bullet drawn round a single note is noise.
  eq('one thing stays a plain line', kind(nctx.R({ text: 'A wrt 36.' })), 'div');
  eq('nothing recorded still shows something',
     texts(nctx.R({ text: '' })), ['\u2014']);
  eq('and the register\'s procedure column splits on its commas',
     texts(nctx.R({ text: 'RCT - Obturation, Crown Prep', on: 'comma' })),
     ['RCT - Obturation', 'Crown Prep']);
  eq('but not a single procedure that happens to have none',
     kind(nctx.R({ text: 'Restoration - Composite', on: 'comma' })), 'div');
}
// Every sheet that shows a visit's notes, on paper...
ok('the Procedure Done Sheet bullets them',
   /\$\{kbBulletCell\(e\.workDone \|\| e\.clinicalNotes\)\}/.test(html));
ok('the Procedure & Fee Sheet too',
   /\$\{kbBulletCell\(e\.treatmentRendered \|\| e\.clinicalNotes\)\}/.test(html));
ok('and the Progress Notes', /\$\{kbBulletCell\(e\.clinicalNotes\)\}/.test(html));
// ...and on screen, where the same list is read.
eq('both on-screen tables use the same renderer',
   (html.match(/React\.createElement\(KbNoteLines, \{ text:/g) || []).length, 2);
ok('the register screen bullets its work done',
   /React\.createElement\(KbNoteLines,\{text:e\.workDone,size:12\}\)/.test(html));
ok('and its procedures, on the commas',
   /React\.createElement\(KbNoteLines,\{text:e\.procedureDone,size:12,on:"comma"\}\)/.test(html));
// The prescription's Case Paper, which is the sheet the patient keeps.
{
  const a = html.indexOf('const PRESCRIPTION_FORM_B64 =');
  const rx = Buffer.from(html.slice(a, html.indexOf(';\n', a) + 1)
    .match(/"([A-Za-z0-9+/=]*)"/g).map(s2 => s2.slice(1, -1)).join(''), 'base64').toString('utf8');
  ok('the case paper bullets a cell with several notes in it',
     /function bullets\(s\)\{/.test(rx));
  ok('and uses it for the comments', /bullets\(r\.comments\)/.test(rx));
  ok('including the row a doctor typed by hand', /bullets\(gv\('notes'\)\)/.test(rx));
  const fctx = { String, Array, console };
  vm.createContext(fctx);
  const fnIn = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    return src.slice(i, src.indexOf('\n}', i) + 2) + '\n';
  };
  vm.runInContext(fnIn(rx, 'esc') + fnIn(rx, 'bullets') + '\nthis.b = bullets;', fctx);
  ok('three notes on one tooth come out as three bullets',
     (fctx.b('A wrt 36.\nB wrt 36.\nC wrt 36.').match(/<li/g) || []).length === 3);
  eq('one note stays a sentence', fctx.b('A wrt 36.'), 'A wrt 36.');
  eq('and nothing stays a dash', fctx.b(''), '\u2014');
  ok('what goes in a bullet is escaped',
     fctx.b('A <b>x</b>.\nB & C.').indexOf('&lt;b&gt;') >= 0);
}

// ── the Procedure Done Sheet gets a column for the tooth ───────────────
// "why is the tooth number coming under doctor name"
//
// Because the table had four columns and none of them was for a tooth, so
// it was tucked under the doctor's name in small grey type -- the first
// thing looked for on a line of this sheet, put in the last place anybody
// would look. The printed sheet did not carry it at all.
ok('the screen gives the tooth a column of its own',
   /\["S\.No\.", "Date", "Tooth", "Procedure \/ Work Done", "Doctor"\]/.test(html));
ok('and no longer hides it under the doctor',
   !/"Tooth: "\+e\.toothNo/.test(html));
ok('the screen splits a visit into a row per thing done, like the sheets',
   /kbSplitVisitRows\(entries, \["clinicalNotes", "workDone"\]\)\.map\(\(e, i\) => \{/.test(html));
ok('and the printed sheet has the column too',
   /<th style="width:46pt;text-align:center">Tooth<\/th>/.test(html));
ok('with the empty-state spanning all five columns now',
   /colspan="5"[^`]*No entries recorded/.test(html));
{
  // Printed, for real: a visit over two teeth becomes two rows, each with
  // its own tooth and its own sentence.
  const fnOf = (name) => {
    const a = html.indexOf('function ' + name + '(');
    return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
  };
  const pctx = { String, Object, Array, Number, Math, Date, console,
    window: { LOGO_B64: '' }, TP_PCSS: '',
    fmtDMY: (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); 
                     return m ? m[3] + '/' + m[2] + '/' + m[1] : '\u2014'; } };
  vm.createContext(pctx);
  vm.runInContext(fnOf('cghsEsc') + fnOf('kbBulletCell') + fnOf('kbTeethInLine')
    + fnOf('kbSplitVisitRows') + fnOf('buildProcedureDoneHTML')
    + '\nthis.build = buildProcedureDoneHTML;', pctx);
  const out = pctx.build({ name: 'Kamal Chawla', uhid: 'AH0507' }, [
    { date: '2024-05-01', doctor: 'Dr. Manika Mittel', toothNo: '37, 47',
      workDone: 'Cervical caries excavated, composite restoration done wrt 37.\n'
              + 'Advised FMA with dental implant wrt 47.' }]);
  const bodyRows = (out.match(/class="sno"/g) || []).length - 1;
  eq('one visit over two teeth prints as two rows', bodyRows, 2);
  ok('the first against 37', />37<\/td>[\s\S]{0,160}composite restoration/.test(out));
  ok('the second against 47', />47<\/td>[\s\S]{0,160}dental implant/.test(out));
  ok('and neither row carries the other\'s sentence',
     !/composite restoration[\s\S]{0,200}dental implant[\s\S]{0,60}<\/td>/.test(out));
}

// ── and the prescription, which is the one that matters ────────────────
// The Case Paper is the sheet the patient walks out with. It is built
// inside the prescription form -- a base64 blob of its own -- so the rule
// lives there a second time, and has to be held to the same behaviour.
const form = (() => {
  const a = html.indexOf('const PRESCRIPTION_FORM_B64 =');
  const end = html.indexOf(';\n', a);
  const b64 = html.slice(a, end + 1).match(/"([A-Za-z0-9+/=]*)"/g)
    .map(x => x.slice(1, -1)).join('');
  return Buffer.from(b64, 'base64').toString('utf8');
})();

ok('the form keeps the entries, not just the line they are flattened into',
   /TODAYS_PROCS = procs;/.test(form));
ok('and the printed table is built from them',
   /var pr = typedOver \? \[\] : procRowsForPrint\(TODAYS_PROCS\);/.test(form));
ok('a doctor who types over the box gets what they typed, as one row',
   /var typedOver = !!\(tch && tch\.dataset && tch\.dataset\.touched\);/.test(form));
ok('and the cells are escaped, which one hand-typed row never needed',
   /function esc\(s\)\{/.test(form) && /esc\(r\.procedure \|\| '—'\)/.test(form));
// The comments cell goes through bullets(), which escapes each line.
ok('the comments cell escapes every line it bullets',
   /bullets\(r\.comments\)/.test(form) && /'<li style="margin-bottom:1\.5pt;">' \+ esc\(x\)/.test(form));

{
  const fctx = { String, Object, Array, Number, console };
  vm.createContext(fctx);
  const fnIn = (src, name) => {
    const a = src.indexOf('function ' + name + '(');
    return src.slice(a, src.indexOf('\n}', a) + 2) + '\n';
  };
  vm.runInContext(fnIn(form, 'teethInLine') + fnIn(form, 'procRowsForPrint')
    + '\nthis.rows = procRowsForPrint;', fctx);

  const r = fctx.rows([{ toothNo: '16, 14', doctor: 'Dr. Viveyk Mittel',
    treatmentRendered: 'RCT - Obturation, Tooth Preparation',
    workDone: 'Obturation done in 3 canals MB=16mm-25/04, occlusally adjusted wrt #16.\n'
      + 'Tooth preparation for Zirconium crown done wrt #14, scan sent to lab.' }]);
  eq('the case paper gets a row per thing done', r.length, 2);
  eq('each against its own tooth', r.map(x => x.teeth), ['16', '14']);
  eq('and named for its own procedure',
     r.map(x => x.procedure), ['RCT - Obturation', 'Tooth Preparation']);
  ok('the canal length is still not read as a tooth', r[0].teeth === '16', r[0].teeth);
  eq('the doctor is carried onto every row',
     r.map(x => x.doctor), ['Dr. Viveyk Mittel', 'Dr. Viveyk Mittel']);

  // Same guard as the sheets: one procedure over two teeth is one row.
  const one = fctx.rows([{ toothNo: '37, 36', doctor: 'Dr. Manika Mittel',
    treatmentRendered: 'Restoration - Composite',
    workDone: 'Occlusal pits and marginal caries excavated, composite restoration '
      + 'with isolation done wrt 37, 36.' }]);
  eq('one restoration across two teeth stays one row on the case paper', one.length, 1);
  eq('with the tooth cell as the register has it', one[0].teeth, '37, 36');

  eq('nothing logged today prints nothing from here', fctx.rows([]).length, 0);
  eq('and a missing list does not throw', fctx.rows(null).length, 0);
}

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
