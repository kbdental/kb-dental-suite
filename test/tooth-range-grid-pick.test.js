// Picking a range straight off the grid: arm "Pick range on grid", click one
// end, click the other, and the span between them is selected. The picked
// range is a starting point — individual teeth stay clickable afterwards so a
// case that is not exactly a clean span can still be corrected by hand.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbgrid-'));

function extract(constName, file) {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = new RegExp('const ' + constName + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(constName + ' not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, file);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const clickTooth = (page, n) => page.evaluate(num => {
  const b = Array.from(document.querySelectorAll('.ft')).find(x => parseInt(x.dataset.n, 10) === num);
  if (!b) throw new Error('no tooth button ' + num);
  b.click();
}, n);

const armPicker = page => page.evaluate(() => document.getElementById('pickRange').click());
const clearAll = page => page.evaluate(() => document.getElementById('clearSel').click());

const state = page => page.evaluate(() => ({
  selected: Array.from(document.querySelectorAll('.ft.sel')).map(b => parseInt(b.dataset.n, 10)),
  message: (document.getElementById('rangeMsg') || {}).textContent || '',
  from: document.getElementById('rangeFrom').value,
  to: document.getElementById('rangeTo').value,
  pickLabel: document.getElementById('pickRange').textContent,
  armed: Array.from(document.querySelectorAll('.ft'))
    .filter(b => (b.style.outline || '').indexOf('dashed') >= 0)
    .map(b => parseInt(b.dataset.n, 10)),
}));

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];

  for (const [label, constName] of [
    ['Crown & Bridge', 'CROWN_BRIDGE_B64'],
    ['Implant Prosthetic', 'IMP_PROSTHETIC_B64'],
  ]) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    await page.goto('file://' + extract(constName, constName + '.html'));
    await page.waitForTimeout(250);

    // --- picking a span across the midline, entirely on the grid ------------
    await armAndCheck();
    async function armAndCheck() {
      await armPicker(page);
      const armed = await state(page);
      ok(label + ' — arming prompts for the first tooth', /first tooth/i.test(armed.message), armed.message);
      ok(label + ' — the button offers a way out', /cancel/i.test(armed.pickLabel), armed.pickLabel);
    }

    await clickTooth(page, 43);
    let s = await state(page);
    eq(label + ' — first click arms that tooth, selects nothing yet', s.selected, []);
    eq(label + ' — the armed end is marked on the grid', s.armed, [43]);
    ok(label + ' — prompts for the other end', /other end/i.test(s.message), s.message);
    eq(label + ' — From box mirrors the first click', s.from, '43');

    await clickTooth(page, 33);
    s = await state(page);
    eq(label + ' — second click fills the span across the midline',
      s.selected, [43, 42, 41, 31, 32, 33]);
    eq(label + ' — To box mirrors the second click', s.to, '33');
    eq(label + ' — nothing is left armed', s.armed, []);
    ok(label + ' — picking mode ends after the span', /pick range/i.test(s.pickLabel), s.pickLabel);
    ok(label + ' — says the range can still be adjusted', /add or remove/i.test(s.message), s.message);

    // --- "an option to change if something need be" -------------------------
    await clickTooth(page, 34);
    s = await state(page);
    eq(label + ' — a tooth can be added to a picked range',
      s.selected, [43, 42, 41, 31, 32, 33, 34]);
    await clickTooth(page, 41);
    s = await state(page);
    eq(label + ' — a tooth can be removed from a picked range',
      s.selected, [43, 42, 31, 32, 33, 34]);

    // --- same span, picked the other way round ------------------------------
    await clearAll(page);
    await armPicker(page);
    await clickTooth(page, 33);
    await clickTooth(page, 43);
    s = await state(page);
    eq(label + ' — picking right-to-left gives the same span',
      s.selected, [43, 42, 41, 31, 32, 33]);

    // --- one tooth twice is just that tooth ---------------------------------
    await clearAll(page);
    await armPicker(page);
    await clickTooth(page, 36);
    await clickTooth(page, 36);
    s = await state(page);
    eq(label + ' — the same tooth twice selects only it', s.selected, [36]);

    // --- crossing jaws keeps the first end armed instead of guessing --------
    await clearAll(page);
    await armPicker(page);
    await clickTooth(page, 43);
    await clickTooth(page, 13);
    s = await state(page);
    eq(label + ' — an upper end after a lower one selects nothing', s.selected, []);
    ok(label + ' — explains both ends must share a jaw', /same jaw/i.test(s.message), s.message);
    eq(label + ' — the first end stays armed for a retry', s.armed, [43]);
    await clickTooth(page, 41);
    s = await state(page);
    eq(label + ' — retrying on the right jaw completes the span', s.selected, [43, 42, 41]);

    // --- cancelling leaves the selection alone ------------------------------
    await clearAll(page);
    await clickTooth(page, 46);
    await armPicker(page);
    await armPicker(page);
    s = await state(page);
    eq(label + ' — cancelling picking keeps what was already selected', s.selected, [46]);
    eq(label + ' — cancelling disarms', s.armed, []);

    // --- typing into From/To still works ------------------------------------
    await clearAll(page);
    await page.evaluate(() => {
      document.getElementById('rangeFrom').value = '46';
      document.getElementById('rangeTo').value = '44';
      document.getElementById('applyRange').click();
    });
    s = await state(page);
    eq(label + ' — typed ranges still apply', s.selected, [46, 45, 44]);

    await page.close();
  }

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('TOOTH RANGE — PICKED ON THE GRID, THEN ADJUSTABLE BY HAND');
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
