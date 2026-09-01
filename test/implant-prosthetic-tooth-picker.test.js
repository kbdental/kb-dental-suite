// Implant Prosthetic's tooth picker used to be single-tooth only (like
// Implant Surgery), while Crown & Bridge supported picking multiple teeth
// individually or via a From/To range. This checks Implant Prosthetic now
// matches Crown & Bridge exactly: click multiple teeth, apply a range,
// Clear All, and the row button shows the same "Tooth N" / "N–M" / "N, M, P"
// label format.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbiptp-'));

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

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  const openModal = () => page.evaluate(() => document.querySelector('#impTbody .tbtn').click());
  const clickTooth = (n) => page.evaluate((n) => document.querySelector('.ft[data-n="' + n + '"]').click(), n);
  const rowText = () => page.evaluate(() => document.querySelector('#impTbody .tbtn').textContent.trim());
  const modalTitle = () => page.evaluate(() => document.querySelector('.modal h3').textContent);
  const hasRangeControls = () => page.evaluate(() =>
    !!document.getElementById('rangeFrom') && !!document.getElementById('rangeTo') &&
    !!document.getElementById('applyRange') && !!document.getElementById('clearSel'));

  eq('modal title matches Crown & Bridge\'s "Select Tooth / Range"', await modalTitle(), '🦷 Select Tooth / Range — FDI Notation');
  eq('modal has range + clear-all controls, same as Crown & Bridge', await hasRangeControls(), true);

  // --- multi-select individual teeth ---------------------------------
  await openModal();
  await clickTooth(16);
  await clickTooth(14);
  await page.evaluate(() => document.getElementById('modalConfirm').click());
  eq('picking two non-adjacent teeth shows a comma list, like Crown & Bridge', await rowText(), '14, 16');

  // --- apply a range ----------------------------------------------------
  await openModal();
  await page.evaluate(() => document.getElementById('clearSel').click());
  await page.evaluate(() => { document.getElementById('rangeFrom').value = '35'; document.getElementById('rangeTo').value = '37'; });
  await page.evaluate(() => document.getElementById('applyRange').click());
  await page.evaluate(() => document.getElementById('modalConfirm').click());
  eq('a consecutive range collapses to "N–M", like Crown & Bridge', await rowText(), '35–37');

  // --- single tooth still shows "Tooth N" -------------------------------
  await openModal();
  await page.evaluate(() => document.getElementById('clearSel').click());
  await clickTooth(46);
  await page.evaluate(() => document.getElementById('modalConfirm').click());
  eq('a single tooth still reads "Tooth N"', await rowText(), 'Tooth 46');

  // --- the underlying site data reflects the full multi-tooth selection --
  await openModal();
  await page.evaluate(() => document.getElementById('clearSel').click());
  await clickTooth(21);
  await clickTooth(22);
  await page.evaluate(() => document.getElementById('modalConfirm').click());
  const collected = await page.evaluate(() => document.querySelector('#impTbody .tbtn').dataset.teeth);
  eq('the row tracks every selected tooth, not just the first', collected, '21,22');

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT PROSTHETIC — TOOTH PICKER MATCHES CROWN & BRIDGE');
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
