// Checks that RCT — the one multi-visit form left out of the earlier resume
// fix, because what it saved per tooth was a pre-joined summary string
// ("Articaine (Block)"), not the individual field selections — can now
// actually be reloaded and continued.
//
// collectCurrentTooth() now also captures a `raw` blob (the form's own
// getAllState()) alongside the existing summary fields, and picking a tooth
// that already has a saved entry restores that raw state into the form's
// actual controls, not just a read-only summary.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrctr-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const RCT_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('RCT_FORM_B64 not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'rct.html');
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
  const active = groupId => page.evaluate(g =>
    Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), groupId);
  const value = id => page.evaluate(i => { const el = document.getElementById(i); return el ? el.value : null; }, id);

  // --- visit 1: pick tooth 36, fill in access-opening step, save ------------
  await page.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('pDate').value = '2026-08-20';
    // Same as picking tooth 36 in the FDI modal.
    window.selTooth = 36;
    const b = document.getElementById('toothBtn');
    b.textContent = 'Tooth 36'; b.classList.add('sel');
  });
  await click('anaType', 'Lignocaine');
  await click('anaMethod', 'Block');
  await click('rdGrp', 'Yes');
  await click('accSt', 'Completed');
  await page.evaluate(() => { document.getElementById('n1').value = 'Access opening done, canals located.'; });
  // Select two canals — this drives rebuildWL()/rebuildObTable(), which is
  // exactly the dynamic-DOM part a restore has to regenerate before it can
  // set per-canal values.
  await page.evaluate(() => {
    document.querySelector('[data-canal="MB"]').click();
    document.querySelector('[data-canal="DB"]').click();
  });
  await page.evaluate(() => { document.getElementById('wl_MB').value = '19.5'; });

  await page.evaluate(() => document.getElementById('saveToSheet').click());
  await page.waitForTimeout(150);

  // --- simulate reopening the form for the same patient on a later visit ---
  // (a fresh page load, then the parent posting the patient's saved record,
  // exactly as it does on open)
  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(String(e.message)));
  await page2.goto('file://' + file);
  await page2.waitForTimeout(200);

  // Pull out what visit 1 actually saved, the same way the parent would read
  // it back from the sheet, and hand it to the fresh page as the existing record.
  const savedEntries = await page.evaluate(() => JSON.parse(localStorage.getItem('kb_rct_sheet') || '{}').entries);
  eq('visit 1 saved exactly one entry, for tooth 36', savedEntries && savedEntries.map(e => e.tooth), ['36']);

  await page2.evaluate((rec) => {
    window.postMessage({ type: 'KB_CLINICAL_RECORD', record: rec }, '*');
  }, { entries: savedEntries });
  await page2.waitForTimeout(100);

  // Today's date, set fresh on this visit — must NOT be overwritten by the
  // resumed tooth's old visit date.
  await page2.evaluate(() => { document.getElementById('pDate').value = '2026-08-27'; });

  // Pick tooth 36 again — the same tooth visit 1 was working on.
  await page2.evaluate(() => { window.selTooth = 36; });
  await page2.evaluate(() => document.getElementById('modalConfirm').click());
  await page2.waitForTimeout(150);

  const active2 = groupId => page2.evaluate(g =>
    Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), groupId);
  const value2 = id => page2.evaluate(i => { const el = document.getElementById(i); return el ? el.value : null; }, id);

  eq('anaesthesia type restored on resume', await active2('anaType'), ['Lignocaine']);
  eq('anaesthesia method restored', await active2('anaMethod'), ['Block']);
  eq('rubber dam restored', await active2('rdGrp'), ['Yes']);
  eq('access status restored', await active2('accSt'), ['Completed']);
  eq('step 1 notes restored', await value2('n1'), 'Access opening done, canals located.');

  const canalsSelected = await page2.evaluate(() =>
    Array.from(document.querySelectorAll('[data-canal].active')).map(b => b.dataset.canal).sort());
  eq('the two selected canals are restored', canalsSelected, ['DB', 'MB']);
  eq('working length for canal MB restored (the dynamic per-canal DOM was rebuilt first)',
    await value2('wl_MB'), '19.5');

  eq("today's date was NOT overwritten by the resumed tooth's old visit date",
    await value2('pDate'), '2026-08-27');
  eq('patient name untouched by the resume (only tooth-level fields are restored)',
    await value2('pName'), '');

  eq('no uncaught page errors on visit 1', errors, []);
  eq('no uncaught page errors on visit 2 (resume)', errors2, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RCT — RESUMING A MULTI-VISIT TOOTH');
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
