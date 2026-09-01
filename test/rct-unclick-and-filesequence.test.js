// Two checks:
// 1. File Sequence (the per-canal button group in Biomechanical Prep) gains
//    the rotary taper/size options (20/04, 20/06, 25/04, 25/06, 30/04, 30/06)
//    alongside the existing S1/SX/S2/F1-F5.
// 2. Single-select (data-ss) button groups are reversible: clicking an
//    already-active button now deselects it instead of leaving it stuck
//    active forever once picked by mistake. Clicking a *different* button in
//    the group still swaps the selection as before.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrctu-'));

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

  // --- 1. File Sequence gains the new taper/size options -----------------
  await page.evaluate(() => document.querySelector('[data-canal="MB"]').click());
  const seqOptions = await page.evaluate(() =>
    Array.from(document.getElementById('sG_MB').querySelectorAll('.btn')).map(b => b.textContent.trim()));
  eq('File Sequence lists S1..F5 plus the new taper/size options', seqOptions,
    ['S1', 'SX', 'S2', 'F1', 'F2', 'F3', 'F4', 'F5', '20/04', '20/06', '25/04', '25/06', '30/04', '30/06']);
  await click('sG_MB', '25/06');
  eq('a taper/size option is selectable in File Sequence', await active('sG_MB'), ['25/06']);

  // --- 2. Single-select groups can be unclicked ---------------------------
  await click('anaType', 'Lignocaine');
  eq('anaType selected on first click', await active('anaType'), ['Lignocaine']);
  await click('anaType', 'Lignocaine'); // click the same, already-active button again
  eq('clicking the active button again clears the selection (mis-click undo)', await active('anaType'), []);
  await click('anaType', 'Articaine');
  await click('anaType', 'Mepivacaine'); // clicking a *different* button still swaps as before
  eq('clicking a different button still swaps the selection', await active('anaType'), ['Mepivacaine']);

  // A data-tc reveal hides again when its trigger is unclicked.
  await click('rdGrp', 'No');
  eq('reason box shown after picking No', await page.evaluate(() => document.getElementById('rdNo').classList.contains('show')), true);
  await click('rdGrp', 'No'); // unclick
  eq('rdGrp cleared by unclicking No', await active('rdGrp'), []);
  eq('reason box hides again once No is unclicked', await page.evaluate(() => document.getElementById('rdNo').classList.contains('show')), false);

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RCT — FILE SEQUENCE OPTIONS + UNCLICK TO DESELECT');
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
