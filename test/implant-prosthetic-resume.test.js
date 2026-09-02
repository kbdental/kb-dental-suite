// Checks that a multi-visit prosthetic case can be resumed: the impression
// visit records anaesthesia/investigation/impression details; a later visit
// needs to see all of that and continue with prosthesis specs/lab dates
// rather than starting blank. Same fix as Crown & Bridge and Implant Surgery.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbipr-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const IMP_PROSTHETIC_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('IMP_PROSTHETIC_B64 not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'ip.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const SAVED_RECORD = {
  pName: 'Test Patient', pId: 'AL0999', doctor: 'Dr. Viveyk',
  anaType: 'Mepivacaine', anaQty: '1.5', anaMethod: 'Both',
  investigation: 'OPG',
  finalImp: 'Digital Scan', trayUsed: 'Custom Tray',
  biteType: 'Resin (Jet Bite)',
  n1: 'Impression taken, bite registered.',
  implants: [{ n: 1, site: '36', date: '20/08/2026' }]
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
  const visible = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.style.display !== 'none';
  }, id);

  eq('anaesthesia type restored', await active('anaType'), ['Mepivacaine']);
  eq('anaesthesia quantity restored', await value('anaQty'), '1.5');
  eq('anaesthesia method restored', await active('anaMethod'), ['Both']);
  eq('investigation restored', await active('investGrp'), ['OPG']);
  eq('impression restored', await active('finalImp'), ['Digital Scan']);
  eq('tray restored', await active('trayUsed'), ['Custom Tray']);
  eq('bite restored', await active('biteType'), ['Resin (Jet Bite)']);
  eq('impression-step notes restored', await value('n1'), 'Impression taken, bite registered.');

  const toothLabel = await page.evaluate(() => {
    const btn = document.querySelector('[id^="tbtn_"]');
    return btn ? btn.textContent.trim() : null;
  });
  eq('implant site restored as an editable row', toothLabel, 'Tooth 36');
  const rowCount = await page.evaluate(() => document.querySelectorAll('#impTbody tr').length);
  eq('exactly one row — the resumed site, no extra blank row alongside it', rowCount, 1);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT PROSTHETIC — RESUMING A MULTI-VISIT CASE');
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
