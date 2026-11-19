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
  vm.runInContext(fnOf('kbTeethInLine') + fnOf('kbSplitVisitRows') + fnOf('buildProgressNotesHTML')
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

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
