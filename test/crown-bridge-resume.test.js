// Checks the fix for: a multi-visit procedure (crown prep this visit,
// impression next visit, insertion the visit after) had no way to continue
// where a previous visit left off — reopening the form always started blank,
// so staff either re-typed everything or left later steps unfilled.
//
// Drives the real Crown & Bridge form in a browser: sends it a KB_CLINICAL_RECORD
// message (exactly what the parent app sends on open, for a patient with an
// existing saved record) and checks the form actually loads that data into
// its fields instead of only showing it in the read-only Clinical Record tab.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbcbr-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const CROWN_BRIDGE_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('CROWN_BRIDGE_B64 not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'cb.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// A saved record as it would come back from the backend: visit 1 recorded
// anaesthesia, investigation, and prep for tooth 16; visit 2 (today) needs to
// pick that tooth back up and continue into impression/lab.
const SAVED_RECORD = {
  pName: 'Test Patient', pId: 'AL0777', doctor: 'Dr. Viveyk',
  anaType: 'Lignocaine', anaQty: '1.8', anaMethod: 'Infiltration',
  investigations: 'RVG',
  marginType: 'Chamfer', gingivaLevel: 'Sub-gingival', flexistrip: 'Used',
  retraction: 'Cord', cordSize: '1',
  provType: 'Protemp', provInsertDate: '20/08/2026',
  shade: 'A2', prosType: 'Bridge', material: 'PFM',
  labName: '—', sendDate: '—',
  n2: 'Prep and provisional done, patient tolerated well.',
  teeth: [{ n: 1, tooth: '16', date: '20/08/2026' }]
};

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  // Exactly what the parent posts on open for a patient with a saved record.
  await page.evaluate((rec) => {
    window.postMessage({ type: 'KB_CLINICAL_RECORD', record: rec }, '*');
  }, SAVED_RECORD);
  await page.waitForTimeout(200);

  const active = groupId => page.evaluate(g =>
    Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), groupId);
  const value = id => page.evaluate(i => { const el = document.getElementById(i); return el ? el.value : null; }, id);
  const visible = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.style.display !== 'none';
  }, id);

  eq('anaesthesia type restored', await active('anaType'), ['Lignocaine']);
  eq('anaesthesia quantity restored', await value('anaQty'), '1.8');
  eq('anaesthesia method restored', await active('anaMethod'), ['Infiltration']);
  eq('investigation restored', await active('invGrp'), ['RVG']);
  eq('margin type restored', await active('marginType'), ['Chamfer']);
  eq('gingiva level restored', await active('gingivaLevel'), ['Sub-gingival']);
  eq('flexistrip restored', await active('flexistrip'), ['Used']);
  eq('retraction restored', await active('retraction'), ['Cord']);
  eq('cord size row becomes visible again since retraction is Cord', await visible('cordSizeRow'), true);
  eq('cord size restored', await active('cordSize'), ['1']);
  eq('provisional prosthesis (multi-select) restored', await active('provGrp'), ['Protemp']);
  // <input type="date"> always reports its value in ISO, regardless of the
  // dd/mm/yyyy format the sheet stores it in.
  eq('provisional insertion date restored', await value('provInsertDate'), '2026-08-20');
  eq('shade restored', await value('shadeVal'), 'A2');
  eq('prosthesis type (multi-select) restored', await active('prosType'), ['Bridge']);
  eq('material restored', await active('matGrp'), ['PFM']);
  eq('notes from the previous visit restored, so nothing is lost by continuing',
    await value('n2'), 'Prep and provisional done, patient tolerated well.');

  // Fields the earlier visit never answered stay editable, not locked with a
  // "—" placeholder value.
  eq('lab name left blank, not literally "—"', await value('labName'), '');

  // The existing tooth appears as a ready-made row, not a blank one staff
  // would have to fill in from scratch.
  const toothLabel = await page.evaluate(() => {
    const btn = document.querySelector('[id^="tbtn_"]');
    return btn ? btn.textContent.trim() : null;
  });
  eq('tooth 16 appears pre-loaded as an editable row', toothLabel, 'Tooth 16');
  const rowCount = await page.evaluate(() => document.querySelectorAll('#toothTbody tr').length);
  eq('exactly one row — the resumed tooth, no extra blank row alongside it', rowCount, 1);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('CROWN & BRIDGE — RESUMING A MULTI-VISIT TOOTH');
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
