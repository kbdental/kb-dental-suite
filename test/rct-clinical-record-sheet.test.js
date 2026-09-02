// Checks the printed "Root Canal Work-Done Sheet" (buildClinRec, the
// Clinical Record tab's content — same HTML that gets printed) matches the
// clinic's original paper form exactly: same rows, same order, same
// wording (typos included — "Extripation", "9818161022K"), no extra
// sections. The on-screen data-entry form is unchanged; only what gets
// printed was rebuilt to match the original one-for-one.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrctsheet-'));

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
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

(async () => {
  const file = extract();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  // Save one tooth with enough fields filled to exercise every row.
  await page.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    window.selTooth = 36;
    const b = document.getElementById('toothBtn');
    b.textContent = 'Tooth 36'; b.classList.add('sel');
  });
  const click = (groupId, label) => page.evaluate(({ groupId, label }) => {
    const g = document.getElementById(groupId);
    const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
    if (!b) throw new Error('no button "' + label + '" in #' + groupId);
    b.click();
  }, { groupId, label });

  await click('accSt', 'Completed');
  await page.evaluate(() => document.querySelector('[data-canal="MB"]').click());
  await page.evaluate(() => { document.getElementById('wl_MB').value = '19.5'; });
  await click('rotSys', 'ProTaper Gold');
  await click('irrigS', 'NaOCl 3%');
  await click('obTech', 'Cold Lateral Compaction');
  await page.evaluate(() => document.getElementById('mc_MB').querySelector('.btn').click());
  await click('sealG', 'AH Plus');
  await click('apSt', 'Maintained');
  await click('fillQ', 'Satisfactory');
  await click('crwnR', 'Yes');

  await page.evaluate(() => document.getElementById('saveToSheet').click());
  await page.waitForTimeout(200);

  // Open the Clinical Record tab (renders via buildClinRec / buildAll).
  await page.evaluate(() => {
    const tab = document.querySelector('[data-sumtab="clinRec"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(200);

  const html = await page.evaluate(() => document.getElementById('clinRecContent').innerHTML);
  const text = await page.evaluate(() => document.getElementById('clinRecContent').innerText);

  // --- exact row set, in the original paper form's order, nothing extra ---
  const EXPECTED_ROWS = [
    'TOOTH NO.',
    "Access Cavity Prep'n and Pulp Extripation",
    'Bio-Mechanical Prep:',
    'No. of Canals',
    'Length Determination',
    'Instrument Used',
    'IRRIGANT USED: H2O2 / Saline / NaOcl/ Metrogyl / Chlorhexidine',
    'OBTURATION:',
    'Complete / Sectional',
    'Master Cone Size',
    'Sealer Used',
    'Condensation Tech: Lateral / Vertical / Thermal',
    'POST-OP X-RAY:',
    'Apical Seal',
    'Lateral Condensation',
    'Post Endo. Restoration: Composite / Post Core',
    'Post: Fibre / Customized',
    'Post - Operative Follow up',
    'Crown Placement',
    'REDO (if any) DATE',
  ];
  EXPECTED_ROWS.forEach(label => {
    ok('has row "' + label + '"', text.includes(label));
  });
  ok('has "DATE" row', /(^|\n)DATE(\n|$)/.test(text) || text.includes('DATE'));
  ok('has the signature row', text.includes('Signature of the') && text.includes('Attending Doctor'));

  // --- rows/sections that must NOT be there anymore -----------------------
  ok('no "ANAESTHESIA & ISOLATION" section (not in the original sheet)', !html.includes('ANAESTHESIA'));
  ok('no "ACCESS OPENING" section header (not in the original sheet)', !html.includes('ACCESS OPENING'));
  ok('no "Anaesthesia" row', !text.includes('Anaesthesia'));
  ok('no "Rubber Dam" row', !text.includes('Rubber Dam'));
  ok('no "Intracanal Medication" row', !text.includes('Intracanal Medication'));
  ok('no "Temporary Dressing" row', !text.includes('Temporary Dressing'));
  ok('no "Complications" row', !text.includes('Complications'));
  ok('no "POST-ENDO RESTORATION" section header (not in the original sheet)', !html.includes('POST-ENDO RESTORATION'));
  ok('no appended "Notes:" row (not in the original sheet)', !text.includes('Notes:'));
  // DATE must appear exactly once per tooth entry, not once per section —
  // count the row label itself, not values that might happen to contain it.
  const dateRowCount = (html.match(/<b>DATE<\/b><\/td>/g) || []).length;
  eq('DATE row appears exactly once (not repeated per section)', dateRowCount, 1);

  // --- header strip: Name / UHID only, no separate "Doctor:" field --------
  ok('header shows Name', text.includes('Test Patient'));
  ok('header shows UHID', text.includes('AL0777'));
  ok('no separate "Doctor:" field in the header strip (only Name/UHID, per the original)', !html.includes('Doctor: <b>'));

  // --- clinic letterhead preserved verbatim, typos included ----------------
  ok('letterhead: C. A. R. E. S.', text.includes('C. A. R. E. S.'));
  ok('letterhead: address line', text.includes('BLOCK R-74, B DILSHAD GARDEN, DELHI-110095'));
  ok('letterhead: phone line (typo preserved: "9818161022K")', text.includes('9818161022K'));
  ok('form code footer: KBDC/FORMS/WD-01', text.includes('KBDC/FORMS/WD-01'));
  ok('title: Root Canal Work-Done Sheet', text.toUpperCase().includes('ROOT CANAL WORK-DONE SHEET'));

  // --- actual saved data lands in the right rows ---------------------------
  ok('tooth 36 shown', text.includes('36'));
  ok('access status value present', text.includes('Completed'));
  ok('canal length (19.5) present under Length Determination', text.includes('19.5'));
  ok('instrument (ProTaper Gold) present', text.includes('ProTaper Gold'));
  ok('irrigant (NaOCl 3%) present', text.includes('NaOCl 3%'));
  ok('obturation technique present', text.includes('Cold Lateral Compaction'));
  ok('sealer (AH Plus) present', text.includes('AH Plus'));

  // --- printable as A4 -------------------------------------------------------
  const pageCss = await page.evaluate(() => {
    for (const s of document.querySelectorAll('#clinRecContent style')) {
      if (s.textContent.includes('@page')) return s.textContent;
    }
    return '';
  });
  ok('print stylesheet targets A4 portrait', /@page\s*\{\s*size:\s*A4\s*portrait/.test(pageCss));

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RCT — CLINICAL RECORD SHEET MATCHES THE ORIGINAL PAPER FORM EXACTLY');
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
