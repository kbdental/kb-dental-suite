// Checks that a multi-visit implant case can be resumed: the surgery visit
// records anaesthesia, osteotomy, and the implant's brand/lot/serial; a later
// visit needs to see all of that and continue with torque/cover/investigation
// rather than starting blank. Same fix as Crown & Bridge, applied here.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbisr-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const IMP_SURGERY_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('IMP_SURGERY_B64 not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'is.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const SAVED_RECORD = {
  pName: 'Test Patient', pId: 'AL0888', doctor: 'Dr. Viveyk',
  anaType: 'Articaine', anaQty: '1.7', anaMethod: 'Block',
  invest: 'RVG',
  osteoType: 'Surgical', addProc: 'None', graft: 'Autogenous',
  provType: 'Not Placed',
  n2: 'Implant placed, primary stability good.',
  implants: [{ n: 1, site: '46', brand: 'Osstem', size: '4.3x11.5mm', ref: 'REF-99', lot: 'LOT-12', serial: 'SN-01' }]
};

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  await page.evaluate((rec) => {
    window.postMessage({ type: 'KB_CLINICAL_RECORD', record: rec }, '*');
  }, SAVED_RECORD);
  await page.waitForTimeout(200);

  const active = groupId => page.evaluate(g =>
    Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), groupId);
  const value = id => page.evaluate(i => { const el = document.getElementById(i); return el ? el.value : null; }, id);

  eq('anaesthesia type restored', await active('anaType'), ['Articaine']);
  eq('anaesthesia quantity restored', await value('anaQty'), '1.7');
  eq('anaesthesia method restored', await active('anaMethod'), ['Block']);
  eq('investigation restored', await active('investGrp'), ['RVG']);
  eq('osteotomy type restored', await active('osteoType'), ['Surgical']);
  eq('additional procedures restored', await active('addProc'), ['None']);
  eq('graft (multi-select) restored', await active('graftGrp'), ['Autogenous']);
  eq('provisional prosthesis restored', await active('provType'), ['Not Placed']);
  eq('notes from the surgery visit restored', await value('n2'), 'Implant placed, primary stability good.');

  const row = await page.evaluate(() => {
    const btn = document.querySelector('[id^="tbtn_"]');
    const id = btn ? btn.id.replace('tbtn_', '') : null;
    if (!id) return null;
    return {
      tooth: btn.textContent.trim(),
      brand: document.getElementById('brand_' + id) && document.getElementById('brand_' + id).value,
      size: document.getElementById('size_' + id) && document.getElementById('size_' + id).value,
      ref: document.getElementById('ref_' + id) && document.getElementById('ref_' + id).value,
      lot: document.getElementById('lot_' + id) && document.getElementById('lot_' + id).value,
      serial: document.getElementById('serial_' + id) && document.getElementById('serial_' + id).value
    };
  });
  eq('implant site restored', row && row.tooth, 'Tooth 46');
  eq('implant brand restored', row && row.brand, 'Osstem');
  eq('implant size restored', row && row.size, '4.3x11.5mm');
  eq('implant ref no. restored', row && row.ref, 'REF-99');
  eq('implant lot no. restored', row && row.lot, 'LOT-12');
  eq('implant register serial no. restored', row && row.serial, 'SN-01');

  const rowCount = await page.evaluate(() => document.querySelectorAll('#impTbody tr').length);
  eq('exactly one row — the resumed implant, no extra blank row alongside it', rowCount, 1);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT SURGERY — RESUMING A MULTI-VISIT CASE');
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
