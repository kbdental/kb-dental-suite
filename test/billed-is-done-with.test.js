// "what has been billed should not be clickable again" and
// "when we give a print from there for the endorsement old which have
//  already been complete also get printed which is wrong ... in records
//  under CGHS in endorsement please give a print button so that we select
//  and those only get printed"
//
// Two faults with one cause: the endorsement is built from the TREATMENT
// PLAN, and a plan carries every treatment the patient has ever had.
//
// So printing it put work finished months ago -- already endorsed, done
// and claimed -- onto a fresh request to the Wellness Centre. And a line
// that had been billed was still an ordinary row: tickable, untickable,
// editable, removable. Untick and re-tick it and it goes through the
// prescription and the bill a second time, which against a panel is not an
// untidy screen but a double claim.
//
// A billed line is therefore read-only, and the print is of the lines that
// have been PICKED.
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

// ── one builder, handed the rows ────────────────────────────────────────
// The Records copy used to print nothing at all (showPrint: false) and the
// plan's copy printed everything. One function now, taking the rows it is
// to print, so the two documents cannot say different things.
ok('the endorsement document is built in one place',
   /function buildEndorsementHTML\(endRows, patPanel, panelPat\)/.test(html), '');
ok('and the Treatment Plan prints through it',
   /const buildEndHTML = \(\) => buildEndorsementHTML\(endRows, patPanel, panelPat\);/.test(html), '');
ok('as does Records, with the picked lines and nothing else',
   /buildEndorsementHTML\(\s*\n?\s*e\.endRows\.filter\(x => pickList\.indexOf\(x\.at\) >= 0\)/.test(html), '');

{
  // Module-level helpers the builder shares with every other document.
  const ctx = { window: { CLINIC: {} }, String, Object, Array, JSON, console,
    calcAge: () => '54', TODAY: '14/11/2026', signatureLine: () => 'Dr. Someone' };
  vm.createContext(ctx);
  vm.runInContext(cut('function buildEndorsementHTML(', '\nfunction TreatmentPlan')
    + '\nthis.build = buildEndorsementHTML;', ctx);
  const row = (at, code, proc, tooth) => ({ at, code, qty: 1, r: { procedure: proc, tooth } });
  const all = [row(0, 'DP030', 'RCT - single rooted', '36'),
               row(1, 'DP007', 'Flap Surgery', '16'),
               row(2, 'DP001', 'Scaling', 'Full Mouth')];
  const whole = ctx.build(all, 'CGHS', { name: 'Santosh Kumar', uhid: 'AL1010' });
  ['RCT - single rooted', 'Flap Surgery', 'Scaling'].forEach(n =>
    ok('given every line it prints ' + n, whole.indexOf(n) >= 0, ''));
  // The whole point: handed one line it prints one line.
  const one = ctx.build([all[1]], 'CGHS', { name: 'Santosh Kumar', uhid: 'AL1010' });
  ok('given one line it prints that one', one.indexOf('Flap Surgery') >= 0, '');
  eq('and not the finished work either side of it',
     ['RCT - single rooted', 'Scaling'].filter(n => one.indexOf(n) >= 0), []);
  eq('the patient and the panel are still on it',
     [one.indexOf('Santosh Kumar') >= 0, one.indexOf('CGHS') >= 0], [true, true]);
}

// ── the bill stamps what it claimed ─────────────────────────────────────
ok('issuing a bill says which lines it carried',
   /if \(onBilled\) onBilled\(rows\.map\(x => x\.at\), res\.billNo, date\);/.test(html), '');
ok('and Records hands that to the plan', /onBilled: e\.markBilled/.test(html), '');
ok('which writes it onto the row and saves at once, so the lock survives a reload',
   /const markBilled = async \(ats, billNo, when\) => \{[\s\S]*?api\("saveTreatmentPlan"/.test(html), '');
// A second bill must not rewrite which bill claimed a line.
ok('a line already billed is never restamped',
   /\(want\.indexOf\(i\) >= 0 && !r\.endBilled\)/.test(html), '');

// ── drawn, and locked ───────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:14px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f6f7f5", TODAY="14/11/2026";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    const ToothChart = () => null;
    const SaveBtn = () => null;
  `});
  await page.addScriptTag({ content: cut('function EndorsementView(', '\n// ═══') });

  // One line billed in September, one endorsed and waiting, one new.
  const ROWS = [
    { at: 0, code: 'DP030', qty: 1, amt: 900, rate: 900, priced: true,
      r: { procedure: 'RCT - single rooted', tooth: '36', endApproved: true,
           endBilled: { no: 'KB/2026/0007', date: '12/09/2026' } }, card: null },
    { at: 1, code: 'DP007', qty: 2, amt: 1200, rate: 600, priced: true,
      r: { procedure: 'Flap Surgery', tooth: '16, 26', endApproved: true }, card: null },
    { at: 2, code: '', qty: 1, amt: 0, rate: 0, priced: false,
      r: { procedure: 'Scaling', tooth: 'Full Mouth' }, card: null }
  ];
  const mount = (picked) => page.evaluate(({ rows, picked }) => {
    window.__active = 'untouched'; window.__setField = null; window.__removed = null;
    const root = document.getElementById('root');
    ReactDOM.render(null, root);
    ReactDOM.render(React.createElement(EndorsementView, {
      showApproved: true, showPick: true, picked: picked,
      onPick: (at, on) => { window.__lastPick = [at, on]; },
      onPickAll: (on) => { window.__lastAll = on; },
      pat: { uhid: 'AL1010', name: 'Santosh Kumar' }, panel: 'CGHS', recordedPanel: 'CGHS',
      panels: ['CGHS'], card: 'X1', holder: 'Pensioner',
      onPanel: () => {}, onCard: () => {}, onHolder: () => {}, onSavePanel: () => {},
      rates: [], ratesMsg: '',
      rows: rows, total: 2100, missing: 1, approvedCount: 2, approvedTotal: 2100,
      setCode: () => {}, setRowField: (at, f, v) => { window.__setField = [at, f, v]; },
      setProcedure: () => {}, active: null, setActive: (at) => { window.__active = at; },
      onTooth: () => {}, onRegion: () => {}, onRange: () => {},
      onAdd: () => {}, onRemove: (at) => { window.__removed = at; },
      onSave: () => {}, onPreview: () => {}, onPrint: () => {}
    }), root);
  }, { rows: ROWS, picked });

  await mount([1, 2]);
  await page.waitForTimeout(250);

  const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  let t = await text();

  // There IS a print button here now. There was none.
  ok('Records has a print button on the endorsement', /Print Endorsement/.test(t), t.slice(0, 200));
  ok('and it counts what it will print', /Print Endorsement \(2\)/.test(t), t.slice(0, 200));
  ok('saying so in words beside it', /2 of 3 line\(s\) will print/.test(t), t.slice(0, 300));
  ok('and that the billed one is left off', /1 already billed, left off/.test(t), t.slice(0, 300));

  // The billed line, on the line itself rather than only in a tooltip.
  ok('the billed line says when it was billed and on which bill',
     /Billed 12\/09\/2026 . KB\/2026\/0007/.test(t), t.slice(0, 400));

  // Every control on it is dead.
  const firstRowInputs = await page.$$eval('tbody tr:first-child input:not([type=checkbox])',
    e => e.map(x => x.readOnly || x.disabled));
  eq('every box on a billed line is read-only', firstRowInputs, [true, true, true, true, true]);
  const firstRowBoxes = await page.$$eval('tbody tr:first-child input[type=checkbox]',
    e => e.map(x => ({ checked: x.checked, disabled: x.disabled })));
  eq('its Endorsed tick is ticked and cannot be unticked',
     firstRowBoxes, [{ checked: true, disabled: true }]);
  ok('and it has no print tick at all, since a claimed line is not being asked about',
     firstRowBoxes.length === 1, JSON.stringify(firstRowBoxes));

  // Clicking it must do nothing: the chart above edits whichever line is
  // active, so a billed line becoming active is a billed line being edited.
  await page.locator('tbody tr').first().click();
  await page.waitForTimeout(120);
  eq('clicking a billed line selects nothing', await page.evaluate(() => window.__active), 'untouched');
  await page.locator('tbody tr').nth(1).click();
  await page.waitForTimeout(120);
  eq('while a live line still selects', await page.evaluate(() => window.__active), 1);

  // It cannot be taken off the plan either -- the bill is with the panel.
  eq('a billed line shows a lock where the remove button is',
     await page.$$eval('tbody tr td:last-child', e => e.map(x => x.innerText.trim())),
     ['\u{1F512}', '×', '×']);
  eq('and nothing was removed by looking at it',
     await page.evaluate(() => window.__removed), null);

  // The live lines are still live.
  const liveInputs = await page.$$eval('tbody tr:nth-child(2) input:not([type=checkbox])',
    e => e.map(x => x.readOnly || x.disabled));
  eq('a line that has not been billed is still editable', liveInputs, [false, false, false, false, false]);

  // Picking.
  // click, not uncheck: the box is controlled by `picked`, and this stub
  // only records the ask rather than feeding new state back -- which is
  // exactly how the real screen keeps the two in step.
  await page.locator('tbody tr:nth-child(3) input[type=checkbox]').first().click();
  await page.waitForTimeout(120);
  eq('unticking a line asks for it to be dropped from the print',
     await page.evaluate(() => window.__lastPick), [2, false]);
  await page.locator('thead input[type=checkbox]').first().click();
  await page.waitForTimeout(120);
  ok('and the header tick picks or clears them all in one go',
     typeof (await page.evaluate(() => window.__lastAll)) === 'boolean', '');

  // Nothing ticked: printing a request with no treatment on it is not a
  // thing to let happen quietly.
  await mount([]);
  await page.waitForTimeout(250);
  t = await text();
  ok('with nothing ticked it says what to do', /Tick the lines to print/.test(t), t.slice(0, 250));
  eq('and will not print', await page.$eval('button:has-text("Print Endorsement")', e => e.disabled), true);

  // Every line billed: there is nothing to ask the Wellness Centre.
  await page.evaluate(() => { window.__allBilled = true; });
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
