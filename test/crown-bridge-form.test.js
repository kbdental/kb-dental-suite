// Drives the rebuilt Crown & Bridge form in a real browser.
//
// The rebuild moved Anaesthesia and Investigations out of the per-tooth row
// into their own sections (as the RCT form does), added the preparation and
// retraction fields, and reordered the steps so preparation and impression
// both come before provisionals. Two of the new fields are conditional —
// cord size only applies to a cord, bite material only to a registered bite —
// and those are the parts most likely to break quietly, so they are what this
// leans on hardest.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbcb-'));

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

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  // Clicks a button by its visible label inside a given group.
  const click = (groupId, label) => page.evaluate(({ groupId, label }) => {
    const g = document.getElementById(groupId);
    const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
    if (!b) throw new Error('no button "' + label + '" in #' + groupId);
    b.click();
  }, { groupId, label });

  const visible = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.style.display !== 'none';
  }, id);

  // --- step order: preparation and impression before provisionals ---------
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.tab')).map(t => t.textContent.replace(/^[0-9✓]/, '').trim()));
  eq('five steps, ending in Summary', tabs.length, 5);
  eq('step order puts preparation and impression before provisionals', tabs,
    ['Tooth & Anaesthesia', 'Preparation', 'Impression', 'Provisional & Lab', 'Summary']);

  // --- the per-tooth table now carries only tooth and date ----------------
  const cols = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#toothTable thead th')).map(t => t.textContent.trim()).filter(Boolean));
  eq('tooth table no longer holds Investigations / Anaesthesia / Instruments',
    cols, ['#', 'Tooth / Range', 'Date']);

  // --- new option sets ----------------------------------------------------
  const opts = id => page.evaluate(i =>
    Array.from(document.getElementById(i).querySelectorAll('.btn')).map(b => b.textContent.trim()), id);
  eq('margin types', await opts('marginType'),
    ['Shoulder', 'Chamfer', 'Knife Edge', 'Buccal Shoulder with Lingual Chamfer']);
  eq('gingiva levels', await opts('gingivaLevel'),
    ['Supra-gingival', 'Sub-gingival', 'At Gingival Level']);
  eq('flexistrip', await opts('flexistrip'), ['Used', 'Not Used']);
  eq('retraction', await opts('retraction'), ['Cord', 'Astringent Gel']);
  eq('cord sizes', await opts('cordSize'), ['000', '00', '0', '1', '2']);
  eq('tray now includes Triple Tray', await opts('trayUsed'),
    ['Stock Tray', 'Custom Tray', 'Triple Tray']);
  eq('bite material, matching the reference form (no more yes/no gate)',
    await opts('biteType'), ['Resin (Jet Bite)', 'Wax']);
  eq('local anesthesia matches the reference form', await opts('localAnes'),
    ['Nerve Block', 'Infiltration', 'Not Used']);

  // --- conditional: cord size ---------------------------------------------
  eq('cord size hidden before a retraction is chosen', await visible('cordSizeRow'), false);
  await click('retraction', 'Cord');
  eq('cord size appears for Cord', await visible('cordSizeRow'), true);
  await click('cordSize', '00');
  await click('retraction', 'Astringent Gel');
  eq('cord size hidden again for Astringent Gel', await visible('cordSizeRow'), false);

  // --- what actually gets saved -------------------------------------------
  await page.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('anaQty').value = '1.8';
  });
  await click('anaType', 'Lignocaine');
  await click('anaMethod', 'Infiltration');
  await click('invGrp', 'RVG');
  await click('marginType', 'Chamfer');
  await click('gingivaLevel', 'Sub-gingival');
  await click('flexistrip', 'Used');
  await click('retraction', 'Cord');
  await click('cordSize', '1');
  await click('biteType', 'Resin (Jet Bite)');
  await click('trayUsed', 'Triple Tray');
  await click('localAnes', 'Nerve Block');

  // collect() is closure-scoped, so read what the summary renders instead.
  await page.evaluate(() => {
    document.querySelector('[data-goto="5"]').click();
  });
  await page.waitForTimeout(150);
  const summary = await page.evaluate(() => document.getElementById('summaryContent').innerText);

  const has = (label, text) => eq('summary shows ' + label, summary.includes(text), true);
  has('anaesthesia with quantity', 'Lignocaine (1.8 ml) / Infiltration');
  has('investigations', 'RVG');
  has('margin and gingiva', 'Chamfer / Sub-gingival');
  has('flexistrip', 'Used');
  has('retraction with cord size', 'Cord (size 1)');
  has('bite material', 'Resin (Jet Bite)');
  has('tray', 'Triple Tray');
  has('local anesthesia', 'Nerve Block');

  // A cord size chosen and then abandoned must not be reported.
  await page.evaluate(() => {
    const g = document.getElementById('retraction');
    Array.from(g.querySelectorAll('.btn')).find(b => b.textContent.trim() === 'Astringent Gel').click();
    document.querySelector('[data-goto="5"]').click();
  });
  await page.waitForTimeout(150);
  const summary2 = await page.evaluate(() => document.getElementById('summaryContent').innerText);
  eq('an abandoned cord size is not carried into the record',
    /size 1/.test(summary2), false);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('CROWN & BRIDGE FORM — REBUILT LAYOUT AND NEW FIELDS');
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
