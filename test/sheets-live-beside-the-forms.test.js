// "now please shuft all the work done sheets under Sheets alongside forms as
//  in screenshot and rename the sheet to work done sheet and it be removed
//  for print from the forms summary only visbility no print"
//
// Three things.
//
// The work done sheets were reachable only from inside a form, on its
// Summary step, and the Sheets tab beside Forms held a different thing
// entirely -- a per-tooth report that covered six of the eighteen. A sheet
// is a document about the patient, so it belongs beside the forms: the same
// eighteen cards, opening the sheet rather than the form.
//
// The tab is named for what is under it: Work Done Sheet.
//
// And printing happens there, once, rather than from a button on every
// form's Summary printing a slightly different thing. A form's Summary is
// for looking at what has been entered.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the tab, and what is under it ───────────────────────────────────────
const section = cut('[{id:"forms",label:', '].map(s =>');
ok('the second tab is named for what it holds', /Work Done Sheet/.test(section), section);
ok('and no longer just "Sheets"', !/label:"[^"]*\bSheets\b/.test(section), section);

const records = cut('function ClinicalRecords({ globalPat, setGlobalPat }) {', 'function Prescription(');
ok('the Work Done Sheet tab draws the same card grid as Forms',
   /section === "sheets" && \(sheetFor/.test(records), '');
ok('from the one form list, so the two grids cannot drift apart',
   (records.match(/FORMS\.map\(form => React\.createElement\("div", \{/g) || []).length === 2, '');
ok('a card opens that form\'s sheet', /onClick:\(\)=>handleSheetCardClick\(form\.id\)/.test(records), '');
ok('and asks for a patient the way a form does',
   /setPendingForm\(\{ id: formId, open: "sheet" \}\)/.test(records), '');
ok('the loader knows which of the two was wanted',
   /if \(want\.open === "sheet"\) setSheetFor\(want\.id\);/.test(records), '');
ok('and there is a way back to the other seventeen',
   /All work done sheets/.test(records), '');
// The per-tooth report the old tab held covered six forms. It is no longer
// wired to anything; the sheet view it was replaced by covers all eighteen.
ok('the old six-form report is no longer reachable',
   !/React\.createElement\(ClinicalSheets, /.test(html), '');

// ── a form's Summary shows, it does not print ───────────────────────────
const tail = (() => {
  const a = html.indexOf('const KB_FORM_TAIL = ');
  const b = html.indexOf(';\n\n// Which form, and the document code', a);
  return JSON.parse(html.slice(a + 'const KB_FORM_TAIL = '.length, b));
})();
eq('the shared ending has no print button at all',
   (tail.match(/data-kbwd-print/g) || []).length, 0);
ok('and says where the sheet is printed from',
   /Clinical Records &rarr; Work Done Sheet/.test(tail), '');
ok('the Treatment complete tick stays', /id="kbwdDone"/.test(tail), '');

const fix = (() => {
  const a = html.indexOf('const KB_FORM_NOTE_FIX = ');
  const b = html.indexOf(';\n\n// Puts the tail in front of </body>', a);
  return JSON.parse(html.slice(a + 'const KB_FORM_NOTE_FIX = '.length, b));
})();
ok('RCT\'s own sheet prints are hidden too',
   /"printClin", "printLet"/.test(fix), '');
// The single-page forms' own Print prints the form they are on. Different
// thing, and it stays -- hiding it by name would have taken that too.
ok('but not the forms\' own Print, which prints the form',
   !/"printBtn"/.test(fix), '');

const bridge = (() => {
  const a = html.indexOf('const KB_FORM_BRIDGE = ');
  const b = html.indexOf(';\n\n// The three wizards whose sheet', a);
  return JSON.parse(html.slice(a + 'const KB_FORM_BRIDGE = '.length, b));
})();
ok('on the three wizards, whose header Print IS the sheet print, it goes',
   /getElementById\("printBtn"\)[\s\S]{0,60}display = "none"/.test(bridge), '');

// ── drawn, in the real app ──────────────────────────────────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
  });
  await page.route('**script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2200);
  await page.getByText('Records', { exact: false }).first().click();
  await page.waitForTimeout(700);
  await page.getByText('Clinical Records', { exact: false }).first().click();
  await page.waitForTimeout(1100);

  const tabs = await page.$$eval('[data-kb-page] button',
    e => e.map(x => x.innerText.trim()).filter(t => /Forms|Sheet/.test(t)).slice(0, 2));
  eq('the two tabs read Forms and Work Done Sheet',
     tabs.map(t => t.replace(/^\S+\s/, '')), ['Forms', 'Work Done Sheet']);

  await page.getByText('Work Done Sheet', { exact: false }).first().click();
  await page.waitForTimeout(800);
  const grid = await page.evaluate(() => {
    const el = document.querySelector('[data-kb-page]');
    return (el && el.innerText.replace(/\s+/g, ' ')) || '';
  });
  // Every form has a card, each one saying what it opens.
  eq('there is a card for all eighteen',
     (grid.match(/Work Done Sheet/g) || []).length >= 18, true);
  ['RCT', 'Implant Surgery', 'Crown & Bridge', 'Scaling', 'Lab Log', 'Ortho Progress Visit']
    .forEach(n => ok('the ' + n + ' sheet is on the page', grid.indexOf(n) >= 0, ''));
  eq('nothing threw', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else {
      fail++;
      console.log('  FAIL  ' + c.name +
        (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
         : c.got ? '\n          ' + c.got : ''));
    }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
