// The tooth picker's "Apply Range" used to filter teeth NUMERICALLY between
// the two ends. FDI numbers do not run along the arch, so 43 -> 33 (a short
// anterior span crossing the midline: 43,42,41,31,32,33) came back as
// 33,34,35,36,37,38,41,42,43 — most of the lower arch. These drive the real
// picker in both forms that have one.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrange-'));

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

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

// The picker lives in a modal; open it however the form exposes it, then read
// the selection straight off the highlighted buttons in DOM (arch) order.
async function applyRange(page, from, to) {
  return page.evaluate(({ from, to }) => {
    document.getElementById('rangeFrom').value = String(from);
    document.getElementById('rangeTo').value = String(to);
    document.getElementById('applyRange').click();
    return {
      selected: Array.from(document.querySelectorAll('.ft.sel')).map(b => parseInt(b.dataset.n, 10)),
      message: (document.getElementById('rangeMsg') || {}).textContent || '',
    };
  }, { from, to });
}

async function run(page) {
  const out = {};

  // --- the reported case ---------------------------------------------------
  out.acrossMidline = await applyRange(page, 43, 33);

  // --- same span entered the other way round -------------------------------
  await page.evaluate(() => document.getElementById('clearSel').click());
  out.reversed = await applyRange(page, 33, 43);

  // --- an ordinary posterior span that does not cross the midline ----------
  await page.evaluate(() => document.getElementById('clearSel').click());
  out.posterior = await applyRange(page, 46, 44);

  // --- upper arch, across the midline --------------------------------------
  await page.evaluate(() => document.getElementById('clearSel').click());
  out.upper = await applyRange(page, 13, 23);

  // --- a single tooth ------------------------------------------------------
  await page.evaluate(() => document.getElementById('clearSel').click());
  out.single = await applyRange(page, 36, 36);

  // --- upper to lower is not a real prosthesis -----------------------------
  await page.evaluate(() => document.getElementById('clearSel').click());
  out.crossArch = await applyRange(page, 13, 43);

  return out;
}

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];

  for (const [label, constName] of [
    ['Crown & Bridge', 'CROWN_BRIDGE_B64'],
    ['Implant Prosthetic', 'IMP_PROSTHETIC_B64'],
  ]) {
    const file = extract(constName, constName + '.html');
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    await page.goto('file://' + file);
    await page.waitForTimeout(250);

    const r = await run(page);

    eq(label + ' — 43 to 33 walks the arch across the midline',
      r.acrossMidline.selected, [43, 42, 41, 31, 32, 33]);
    eq(label + ' — 43 to 33 does not sweep in 34..38 (the reported bug)',
      r.acrossMidline.selected.filter(n => n >= 34 && n <= 38), []);
    eq(label + ' — 33 to 43 gives the same span',
      r.reversed.selected, [43, 42, 41, 31, 32, 33]);
    eq(label + ' — 46 to 44 is a plain posterior span',
      r.posterior.selected, [46, 45, 44]);
    eq(label + ' — 13 to 23 crosses the upper midline',
      r.upper.selected, [13, 12, 11, 21, 22, 23]);
    eq(label + ' — a single tooth selects only itself',
      r.single.selected, [36]);
    eq(label + ' — upper-to-lower selects nothing',
      r.crossArch.selected, []);
    checks.push({
      name: label + ' — upper-to-lower explains why instead of failing silently',
      ok: /same arch/i.test(r.crossArch.message),
      got: r.crossArch.message, want: 'a same-arch message',
    });

    // Every range must be a contiguous run of the real arch.
    const contiguous = (sel, arch) => {
      if (!sel.length) return true;
      const i = arch.indexOf(sel[0]);
      return sel.every((n, k) => arch[i + k] === n);
    };
    checks.push({
      name: label + ' — selection is a contiguous run of the lower arch',
      ok: contiguous(r.acrossMidline.selected, LOWER) && contiguous(r.posterior.selected, LOWER),
      got: r.acrossMidline.selected, want: 'contiguous',
    });
    checks.push({
      name: label + ' — upper selection is a contiguous run of the upper arch',
      ok: contiguous(r.upper.selected, UPPER),
      got: r.upper.selected, want: 'contiguous',
    });

    await page.close();
  }

  checks.push({ name: 'no uncaught page errors', ok: errors.length === 0, got: errors, want: [] });
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('TOOTH RANGE — FOLLOWS THE ARCH, NOT THE NUMBERS');
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
