// The clinic printed the Root Canal Work-Done Sheet and reported "no change at
// all". They were right: the sheet is built by buildClinRec INSIDE the RCT
// form, and the earlier work had rewritten a different builder used by another
// screen. This covers the one that actually prints.
//
// Two faults in it. It ran a fixed four columns, one per tooth, padded with
// blanks — so one tooth wasted three quarters of the page, and a treatment
// spread over three appointments printed under a single date. And it set the
// table in 9.5px then shrank the whole sheet to 81%, printing at about 7.7px.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbclinrec-'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + String(detail).slice(0, 200) : '')); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const RCT_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'rct.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  const formFile = extract();
  await page.goto('file://' + formFile);
  await page.waitForTimeout(300);

  const openTab = () => page.evaluate(() => {
    const t = document.querySelector('[data-sumtab="clinRec"]');
    if (t) t.click();
  });
  async function render(entries) {
    await page.evaluate(e => localStorage.setItem('kb_rct_sheet_UNKNOWN', JSON.stringify({ entries: e })), entries);
    await page.reload();
    await page.waitForTimeout(300);
    await openTab();
    await page.waitForTimeout(200);
  }

  // A tooth treated across three appointments, exactly the case that printed
  // as one column with the last visit's date on it.
  await render([{
    tooth: '46', course: 1, status: 'open', pName: 'Test Patient', pId: 'AL1001',
    doctor: 'Dr. Viveyk', date: '01/09/2026',
    visits: [
      { date: '01/09/2026', tooth: '46', access: 'Completed / Vital', canals: '3 (MB, ML, D)' },
      { date: '18/09/2026', tooth: '46', obtuCS: 'Complete', sealer: 'AH Plus' },
      { date: '05/10/2026', tooth: '46', rest: 'Ivoclar', crown: 'Advised' },
    ],
  }]);
  const html = await page.evaluate(() => document.getElementById('clinRecContent').innerHTML);

  // The heart of it: each date against the work done on it.
  ['01/09/2026', '18/09/2026', '05/10/2026'].forEach(d =>
    ok('the sheet carries ' + d, html.indexOf(d) >= 0));
  ok("the first visit's canals are printed", /3 \(MB, ML, D\)/.test(html));
  ok("the second visit's sealer is printed", /AH Plus/.test(html));
  ok("the third visit's restoration is printed", /Ivoclar/.test(html));

  // Three visits, three columns — not four padded ones.
  const cells = await page.evaluate(() => {
    const rows = document.querySelectorAll('#clinRecContent tr');
    for (const r of rows) {
      const first = r.querySelector('td');
      if (first && /DATE/.test(first.textContent)) return r.querySelectorAll('td').length;
    }
    return -1;
  });
  eq('the date row has one cell per visit, plus its label', cells, 4);

  // Readability: the shrink is gone and the type is up.
  ok('the sheet is no longer shrunk to 81%', !/zoom:0\.81/.test(html));
  ok('and the table is not set in 9.5px', !/font-size:9\.5px/.test(html));
  ok('cells are set at a readable size', /font-size:12\.5px/.test(html));

  // A single visit must fill the sheet rather than hide in a quarter of it.
  await render([{ tooth: '36', date: '05/10/2026',
    visits: [{ date: '05/10/2026', tooth: '36', access: 'Completed / Vital' }] }]);
  const single = await page.evaluate(() => {
    const rows = document.querySelectorAll('#clinRecContent tr');
    for (const r of rows) {
      const first = r.querySelector('td');
      if (first && /DATE/.test(first.textContent)) return r.querySelectorAll('td').length;
    }
    return -1;
  });
  eq('one visit makes one column, not four', single, 2);

  // A record saved before the visit log must still print.
  await render([{ tooth: '11', date: '02/05/2026', access: 'Completed / Non-vital' }]);
  const legacy = await page.evaluate(() => document.getElementById('clinRecContent').innerHTML);
  ok('a record from before the visit log still prints', /02\/05\/2026/.test(legacy));
  ok('with its work on it', /Completed \/ Non-vital/.test(legacy));

  eq('no uncaught page errors', errors, []);
  await browser.close();

  console.log('==============================================================================');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('==============================================================================');
  process.exit(fail ? 1 : 0);
})();
