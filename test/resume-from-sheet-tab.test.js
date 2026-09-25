// Checks the fix for: a patient treated before the structured record existed
// had their work written to the form's flat tab ("RCT", "Crown & Bridge", ...)
// and never to the Clinical Sheets JSON record. The app showed those rows, so
// the data plainly existed — but the forms resume from the JSON record, so
// reopening one gave a blank form and the earlier visit looked lost.
// Real case: AL0810 had two RCT rows on file and getClinicalSheets returned
// null, so the form opened empty every time.
//
// Two halves:
//   csRecordFromSheetRows  maps the flat tab's human-readable columns back onto
//                          the record keys, taking identity from the loaded
//                          patient rather than from the rows.
//   the RCT tooth chart    marks the teeth that already have a record, and says
//                          so when an entry cannot refill the form's controls.

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbsheettab-'));

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) =>
  checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// ── the mapper, lifted straight out of index.html ─────────────────────────
function loadMapper() {
  const src =
    html.slice(html.indexOf('const CS_ITEM_ID_FIELD'), html.indexOf('async function mergeClinicalSheet')) +
    html.slice(html.indexOf('const CS_RECORD_TAB'), html.indexOf('// ── Read-only saved-record viewer'));
  const ctx = {
    fmtDMY: input => {
      if (!input) return '';
      if (typeof input === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(input.trim())) return input.trim();
      const d = new Date(input);
      if (isNaN(d.getTime())) return String(input);
      return String(d.getDate()).padStart(2, '0') + '/' +
             String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

function extractRct() {
  const m = /const RCT_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('RCT_FORM_B64 not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'rct.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

// AL0810's two real rows, shape and all — including the row whose name
// disagrees with its UHID.
const RCT_ROWS = [
  {
    _rowIndex: 546, Timestamp: '2026-08-31T11:32:29.547Z', UHID: 'AL0810',
    'Patient Name': 'Priyanaka nagar', Age: '46', Gender: 'Female',
    'Tooth No.': '47', 'Visit Date': '2026-08-30T18:30:00.000Z', Doctor: 'Dr.  Manika Mittel',
    'No. of Canals': '3', 'Instrument Used': 'Endomotor, Apex Locator, Rotary Files',
    'Irrigant Used': 'Normal Saline, Sodium Hypochloride', 'Sealer Used': 'Endomethasone',
    'Apical Seal': 'Yes', 'Rubber Dam': '', 'Complications': '',
  },
  {
    _rowIndex: 547, Timestamp: '2026-09-01T07:19:26.166Z', UHID: 'AL0810',
    'Patient Name': 'P. K. Roy', Age: '82', Gender: 'Male',
    'Tooth No.': '24', 'Visit Date': '2026-08-31T18:30:00.000Z', Doctor: 'Dr. Manika Mittel',
    'No. of Canals': '2', 'Instrument Used': 'Endomotor, Apex Locator, Rotary Files',
    'Irrigant Used': 'Normal Saline, Sodium Hypochloride', 'Sealer Used': 'Endomethasone',
    'Apical Seal': 'Yes',
  },
];

(async () => {
  const ctx = loadMapper();
  const pat = { uhid: 'AL0810', name: 'P K Roy', age: '82', gender: 'Male' };
  const rec = ctx.csRecordFromSheetRows('rct', RCT_ROWS, pat);

  ok('a record is recovered from the flat tab rows', !!rec, rec && Object.keys(rec));
  eq('both treated teeth come back', (rec.entries || []).map(e => e.tooth), ['47', '24']);
  eq('each tooth keeps its own visit date',
    (rec.entries || []).map(e => e.date), ['31/08/2026', '01/09/2026']);
  eq('the column labels map onto the record keys', rec.entries[0].canals, '3');
  eq('and so do the longer ones', rec.entries[1].irrig, 'Normal Saline, Sodium Hypochloride');
  eq('an empty column is left out rather than stored blank', 'rd' in rec.entries[0], false);
  eq('the origin is flagged', rec.__fromSheetTab, 'RCT');

  // The row named for a different patient must not rename the record.
  eq('the patient name comes from the loaded patient, not the rows', rec.pName, 'P K Roy');
  eq('so does the age', rec.age, '82');
  eq('and the UHID', rec.pId, 'AL0810');

  // Nothing to recover must stay nothing, not an empty shell.
  eq('no rows means no record', ctx.csRecordFromSheetRows('rct', [], pat), null);
  eq('rows with no tooth and no answers mean no record',
    ctx.csRecordFromSheetRows('rct', [{ UHID: 'AL0810', Timestamp: 'x' }], pat), null);

  // Crown & Bridge splits its answers between the case and the tooth.
  const cb = ctx.csRecordFromSheetRows('crown', [{
    UHID: 'AD0502', 'Patient Name': 'Reena Rai', 'Tooth No.': '23–25',
    'Visit Date': '2026-08-29T18:30:00.000Z', Doctor: 'Dr. Manika',
    Shade: 'D2', Material: 'Monolith Zirconia', Laboratory: 'K.B Denarts',
    'Insert Date': '2026-09-07T18:30:00.000Z',
  }], { uhid: 'AD0502', name: 'Reena Rai' });
  eq('crown case answers land at the top level', [cb.shade, cb.material, cb.labName],
    ['D2', 'Monolith Zirconia', 'K.B Denarts']);
  eq('crown tooth answers land on the tooth', cb.teeth[0].tooth, '23–25');
  eq('a date column is formatted, not left as an ISO stamp', cb.insertDate, '08/09/2026');

  // ── the RCT tooth chart ─────────────────────────────────────────────────
  const file = extractRct();
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + file);
  await page.waitForTimeout(400);

  await page.evaluate(r => window.postMessage({ type: 'KB_CLINICAL_RECORD', record: r }, '*'), rec);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('toothBtn').click());
  await page.waitForTimeout(200);

  const marked = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.ft.has')).map(b => b.dataset.n));
  // The chart is laid out by arch, so the marks come back in FDI order, not
  // in the order the record happens to list them.
  eq('only the treated teeth are marked on the chart', (await marked()).slice().sort(), ['24', '47']);

  const tip = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ft')).find(x => x.dataset.n === '24');
    return b.title;
  });
  ok('the marked tooth says when it was treated', /01\/09\/2026/.test(tip), tip);

  ok('the chart carries a key explaining the mark',
    await page.evaluate(() => !!document.querySelector('.ftkey')), null);

  // Picking a tooth recovered from the flat tab: there is no field state to
  // load, so it has to say so rather than leave a blank form.
  const msgFor = async tooth => {
    await page.evaluate(t => {
      const b = Array.from(document.querySelectorAll('.ft')).find(x => x.dataset.n === t);
      b.click();
    }, tooth);
    await page.evaluate(() => document.getElementById('modalConfirm').click());
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const el = document.getElementById('tplMsg');
      return el && el.style.display !== 'none' ? el.textContent : '';
    });
  };
  const msg24 = await msgFor('24');
  ok('picking a recovered tooth names the date it was treated', /01\/09\/2026/.test(msg24), msg24);
  ok('and does not claim it was loaded for you to continue',
    !/loaded for you to continue/.test(msg24), msg24);

  // A tooth whose entry carries the form's own state still restores properly —
  // the existing behaviour must not have been traded away for the above.
  await page.evaluate(() => window.postMessage({
    type: 'KB_CLINICAL_RECORD',
    record: { entries: [{ tooth: '36', date: '05/09/2026', raw: { n2: 'Obturation done.', groups: {} } }] },
  }, '*'));
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById('toothBtn').click());
  await page.waitForTimeout(150);
  eq('the chart follows a newly loaded record', await marked(), ['36']);
  const msg36 = await msgFor('36');
  ok('a tooth with saved field state is still loaded to continue',
    /loaded for you to continue/.test(msg36), msg36);
  eq('and its saved note is back in the form',
    await page.evaluate(() => document.getElementById('n2').value), 'Obturation done.');

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RESUME A RECORD THAT ONLY EXISTS IN THE FLAT SHEET TAB');
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
