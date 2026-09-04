// Drives the rebuilt Implant Surgery form in a real browser.
//
// Anaesthesia and Investigation were pulled out into their own sections
// (matching RCT/Crown & Bridge), Investigation switched from a free-for-all
// multi-select with a None toggle to a single-choice group with the same
// three options as those forms, and the implant brand list was replaced.
// Tooth site stays per-implant, as it was.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbis-'));

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

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  const click = (groupId, label) => page.evaluate(({ groupId, label }) => {
    const g = document.getElementById(groupId);
    const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
    if (!b) throw new Error('no button "' + label + '" in #' + groupId);
    b.click();
  }, { groupId, label });

  // --- Anaesthesia and Investigation are now their own sections, in step 1 -
  const step1Headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#p1 .ch')).map(h => h.textContent.trim()));
  eq('step 1 has Implant Details, Anaesthesia, and Investigation as separate cards',
    step1Headers, ['🔩 Implant Details — one row per implant', '💉 Anaesthesia', '🩻 Investigation']);

  const step3Headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#p3 .ch')).map(h => h.textContent.trim()));
  eq('Investigation no longer appears in the old Follow-up step',
    step3Headers.some(h => h.includes('Investigation')), false);

  // --- Investigation is single-choice, matching the reference Google Form --
  const investOpts = await page.evaluate(() =>
    Array.from(document.getElementById('investGrp').querySelectorAll('.btn')).map(b => b.textContent.trim()));
  eq('investigation options match the reference form', investOpts,
    ['RVG', 'OPG', 'None', 'Other']);

  await click('investGrp', 'RVG');
  await click('investGrp', 'OPG');
  const investActive = await page.evaluate(() =>
    Array.from(document.getElementById('investGrp').querySelectorAll('.btn.active')).map(b => b.textContent.trim()));
  eq('investigation is single-choice, not multi-select', investActive, ['OPG']);

  // --- "On -1 Abutment" matches the reference form's literal wording -------
  const coverOpts = await page.evaluate(() =>
    Array.from(document.getElementById('coverType').querySelectorAll('.btn')).map(b => b.textContent.trim()));
  eq('cover over implant includes "On -1 Abutment" (space before hyphen)', coverOpts.includes('On -1 Abutment'), true);

  // --- Treating Doctor is marked required, matching the reference form -----
  const docLabel = await page.evaluate(() => document.querySelector('#pDoc').closest('.pf').querySelector('label').textContent.trim());
  eq('treating doctor label is required', docLabel, 'Treating Doctor *');

  // --- brand list -----------------------------------------------------------
  const brandOpts = await page.evaluate(() => {
    const sel = document.querySelector('[id^="brand_"]');
    return Array.from(sel.options).map(o => o.textContent.trim()).filter(Boolean);
  });
  eq('implant brand list matches the new spec', brandOpts,
    ['Select…', 'Nobel Active', 'Nobel CC', 'Straumann', 'Alpha Bio', 'Ifix', 'Osstem', 'Norris', 'MIS', 'Nobel Replace (tri-channel)']);

  // --- what actually gets saved ---------------------------------------------
  await page.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('anaQty').value = '1.8';
  });
  await click('anaType', 'Articaine');
  await click('anaMethod', 'Block');

  await page.evaluate(() => document.querySelector('[data-goto="4"]').click());
  await page.waitForTimeout(150);
  const summary = await page.evaluate(() => document.getElementById('summaryContent').innerText);
  const has = (label, text) => eq('summary shows ' + label, summary.includes(text), true);
  has('anaesthesia with quantity and method', 'Articaine (1.8 ml) / Block');
  has('investigation', 'OPG');

  // --- reaching the summary via the tab rebuilds it, not just via Continue -
  await click('anaMethod', 'Infiltration');
  await page.evaluate(() => document.querySelector('.tab[data-tab="1"]').click());
  await page.evaluate(() => document.querySelector('.tab[data-tab="4"]').click());
  await page.waitForTimeout(150);
  const summary2 = await page.evaluate(() => document.getElementById('summaryContent').innerText);
  eq('summary reached via tab reflects the latest change, not a stale build',
    summary2.includes('Articaine (1.8 ml) / Infiltration'), true);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT SURGERY FORM — SEPARATE ANAESTHESIA/INVESTIGATION, NEW BRANDS');
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
