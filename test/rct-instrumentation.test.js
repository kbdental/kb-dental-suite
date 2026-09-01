// Checks four RCT form additions:
// 1. Instrumentation: a free-text "Instrument" field alongside Instrument
//    Retrieved/Bypass, plus a new "Gutta Percha Removed" yes/no.
// 2. Complications: an "Other" toggle that reveals a free-text line, and
//    that text folds into the saved complication string.
// 3. Biomechanical Prep -> Intracanal Medicament gains "Calcipex".
// 4. A New RCT / Re-RCT choice at the very start of Access Opening.
//
// All four are also checked to survive getAllState()/applyState() (the
// resume mechanism from the earlier multi-visit work), since a new field
// that only exists in the DOM but isn't captured/restored would silently
// vanish on a later visit.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrcti-'));

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
  const isVisible = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.classList.contains('show');
  }, id);

  // --- 4. New RCT / Re-RCT sits at the very top of Access Opening --------
  const firstCardHeader = await page.evaluate(() => document.querySelector('#p1 .card .ch').textContent);
  eq('Procedure Type is the first card in Access Opening', firstCardHeader, '🦷 Procedure Type');
  await click('rctType', 'Re-RCT');
  eq('Re-RCT selectable', await active('rctType'), ['Re-RCT']);

  // --- 1. Instrumentation: Instrument text field + Gutta Percha Removed --
  await page.evaluate(() => { document.getElementById('instrUsed').value = '25/.06 rotary'; });
  await click('instrRetr', 'Yes');
  await click('instrByp', 'No');
  await click('gpRem', 'Yes');
  eq('Gutta Percha Removed selectable', await active('gpRem'), ['Yes']);

  // --- 2. Complications: "Other" reveals a text line ----------------------
  eq('Other complication line hidden before Other is picked', await isVisible('compOtherBox'), false);
  await click('compG', 'Other');
  eq('Other complication line appears once Other is picked', await isVisible('compOtherBox'), true);
  await page.evaluate(() => { document.getElementById('compOtherTxt').value = 'Instrument fractured mid-canal'; });

  // --- 3. Calcipex in Biomechanical Prep's Intracanal Medicament ----------
  await click('icM2', 'Calcipex');
  eq('Calcipex selectable in step-2 medicament', await active('icM2'), ['Calcipex']);

  // --- everything survives a real save + reopen (the multi-visit resume
  // path from the earlier work) — pick tooth 36 and save, then reopen the
  // form fresh, feed it the saved record, and re-pick tooth 36. A field that
  // only exists in the DOM but isn't captured/restored would come back blank.
  await page.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    window.selTooth = 36;
    const b = document.getElementById('toothBtn');
    b.textContent = 'Tooth 36'; b.classList.add('sel');
  });
  await page.evaluate(() => document.getElementById('saveToSheet').click());
  await page.waitForTimeout(150);

  const collected = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('kb_rct_sheet') || '{}').entries[0]);
  eq('printed record: rctType included', collected.rctType, 'Re-RCT');
  eq('printed record: instrument text folded into instr', /Instrument: 25\/\.06 rotary/.test(collected.instr), true);
  eq('printed record: old GP removed folded into instr', /Old GP removed/i.test(collected.instr), true);
  eq('printed record: complication text folded into comps', /Instrument fractured mid-canal/.test(collected.comps), true);

  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(String(e.message)));
  await page2.goto('file://' + file);
  await page2.waitForTimeout(200);
  await page2.evaluate((rec) => {
    window.postMessage({ type: 'KB_CLINICAL_RECORD', record: rec }, '*');
  }, { entries: [collected] });
  await page2.waitForTimeout(100);
  await page2.evaluate(() => { window.selTooth = 36; });
  await page2.evaluate(() => document.getElementById('modalConfirm').click());
  await page2.waitForTimeout(150);

  const active2 = groupId => page2.evaluate(g =>
    Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), groupId);
  const isVisible2 = id => page2.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.classList.contains('show');
  }, id);

  eq('rctType restored on resume', await active2('rctType'), ['Re-RCT']);
  eq('gpRem restored on resume', await active2('gpRem'), ['Yes']);
  eq('instrUsed text restored on resume',
    await page2.evaluate(() => document.getElementById('instrUsed').value), '25/.06 rotary');
  eq('compOtherTxt restored on resume',
    await page2.evaluate(() => document.getElementById('compOtherTxt').value), 'Instrument fractured mid-canal');
  eq('Other complication line re-shown on resume', await isVisible2('compOtherBox'), true);
  eq('Calcipex restored on resume', await active2('icM2'), ['Calcipex']);

  eq('no uncaught page errors (visit 1)', errors, []);
  eq('no uncaught page errors (resume)', errors2, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RCT — INSTRUMENTATION, COMPLICATIONS OTHER, CALCIPEX, NEW/RE-RCT');
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
