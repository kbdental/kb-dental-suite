// "I want the doctor name in end with a box for signature in the
//  treatment done sheet" / "that signature has to be digital as the
//  progress notes is not to be printed instead it has to go as a pdf
//  document"
//
// Treatment Progress Notes had no doctor on it anywhere and nothing to
// sign: S.No., Date, Tooth, Treatment, Clinical Notes, Payment, Amount.
// A year of visits and the sheet never said who did any of it.
//
// And it is not printed. It goes out as a PDF, so a ruled box for an ink
// signature is a box that stays empty for good. The doctors' signatures
// are already drawn once and kept in Master -> Clinic -> Doctors, and
// were reaching no sheet at all: the Procedure Done Sheet has carried a
// per-row signature box since before this, and nothing has ever filled
// it, because nothing sets sigDataUrl.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 300) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

const fnOf = (name) => {
  const a = html.indexOf('function ' + name + '(');
  return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
};
const ctx = { String, Object, Array, Number, Math, Date, console,
  window: { LOGO_B64: '' }, TP_PCSS: '',
  fmtDMY: (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
                   return m ? m[3] + '/' + m[2] + '/' + m[1] : '21/11/2026'; } };
vm.createContext(ctx);
vm.runInContext(fnOf('cghsEsc') + fnOf('kbBulletCell') + fnOf('kbTeethInLine')
  + fnOf('kbSplitVisitRows') + fnOf('kbProgressSigner') + fnOf('buildProgressNotesHTML')
  + '\nthis.build = buildProgressNotesHTML; this.signer = kbProgressSigner;', ctx);

const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const E = (over) => Object.assign({ date: '2024-05-01', toothNo: '37',
  treatmentRendered: 'Restoration', clinicalNotes: 'Composite done wrt 37.',
  doctor: 'Dr. Manika Mittel', paymentMode: 'UPI', amountReceived: 1200 }, over || {});

// ── who signs ──────────────────────────────────────────────────────────
// The sheet can span a year of visits by several doctors. The Doctor
// column says who did each; the foot is the document being signed off.
{
  eq('the doctor of the most recent entry signs',
     ctx.signer([E({ doctor: 'Dr. A' }), E({ doctor: 'Dr. B' })], {}).doctor, 'Dr. B');
  eq('their saved signature is found by name',
     ctx.signer([E()], { 'Dr. Manika Mittel': SIG }).dataUrl, SIG);
  eq('and is empty when none has been drawn yet',
     ctx.signer([E()], {}).dataUrl, '');
  // One signature must not look like a claim on another doctor's work.
  eq('a sheet with other doctors on it says so', ctx.signer(
     [E({ doctor: 'Dr. A' }), E({ doctor: 'Dr. B' })], {}).others, 1);
  eq('and one with a single doctor does not',
     ctx.signer([E(), E()], {}).others, 0);
  eq('entries with no doctor named leave nobody to sign',
     ctx.signer([E({ doctor: '' })], {}), null);
  eq('nor does an empty sheet', ctx.signer([], {}), null);
  eq('and a missing list does not throw', ctx.signer(null, null), null);
}

// ── the sheet ──────────────────────────────────────────────────────────
{
  const out = ctx.build({ name: 'Kamal Chawla', uhid: 'AH0507' },
    [E(), E({ date: '2024-05-06', toothNo: '42', treatmentRendered: 'RCT',
              clinicalNotes: 'Obturation done wrt 42.', paymentMode: '', amountReceived: 0 })],
    { 'Dr. Manika Mittel': SIG });

  ok('there is a Doctor column now', /<th style="width:78pt">Doctor<\/th>/.test(out));
  ok('and every line names who did it',
     (out.match(/Dr\. Manika Mittel/g) || []).length >= 3, out.match(/Dr\. Manika Mittel/g));
  // The whole point of the second request.
  ok('the signature is drawn in, not left as a box to fill',
     out.indexOf('<img src="' + SIG) >= 0);
  ok('under a heading saying whose it is', /Signature of the Doctor/.test(out));
  ok('with the name and the date beneath it',
     /Dr\. Manika Mittel &nbsp;\|&nbsp; Date: /.test(out));
  // The total spans the columns it did before, one more of them now.
  ok('the total still reaches across to the amount',
     /colspan="7"[^>]*>Total Amount Received/.test(out));
  ok('and is what was actually paid', /₹1,200/.test(out));
}
{
  // A doctor who has not drawn one yet gets told where to, rather than a
  // blank space nobody can explain later.
  const out = ctx.build({ name: 'X', uhid: 'Y' }, [E()], {});
  ok('no signature saved says so on the sheet',
     /No signature saved for this doctor/.test(out));
  ok('and points at where it is drawn', /Master &rarr; Clinic &rarr; Doctors/.test(out));
  ok('the doctor is still named', out.indexOf('Dr. Manika Mittel') >= 0);
}
{
  // Nothing to sign is not a signature block.
  const out = ctx.build({ name: 'X', uhid: 'Y' }, [], {});
  ok('an empty sheet carries no signature block',
     !/Signature of the Doctor/.test(out));
  ok('but still prints', out.indexOf('TREATMENT PROGRESS NOTES') >= 0 || out.length > 200);
}

// ── and the screen hands the signatures over ───────────────────────────
ok('the screen reads the saved signatures', /api\("getSignatures"\)/.test(html));
eq('and gives them to the sheet everywhere it is built',
   (html.match(/buildProgressNotesHTML\(pat, progressRows, sigs\)/g) || []).length, 3);

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
