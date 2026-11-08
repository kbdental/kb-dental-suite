// "yes the line items should be editable in both"
//
// The prescription and the bill are printed from the endorsement, and until
// now the lines on them could only be read. A code the Wellness Centre
// wants written differently, a tooth corrected at the chair, a rate the
// panel pays this year -- all of it meant going back to the endorsement.
//
// Three things have to hold, and the last two are the ones with teeth:
//   1. every cell the document prints is a field
//   2. what is typed is what PRINTS -- screen and paper cannot disagree
//   3. on the bill, what is typed is what is SAVED, and the total follows
//      it, or the register holds a different bill from the one handed over
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// Amount is never a field: it is rate times units, and a figure somebody
// can type over a sum that does not add up is worse than no figure.
ok('Amount is left computed, not typed over',
   /showAmount \? React\.createElement\("td", \{ style:\{ \.\.\.cell, textAlign:"right", fontWeight:700 \} \},\s*x\.priced \? Number\(x\.amt\)/.test(html));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0", TODAY="08/11/2026";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    const usePadMargins = () => ({});
    const cghsEsc = (v) => String(v === undefined || v === null ? "" : v)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cghsPadCss = () => "";
    const calcAge = () => "54";
    const fmtDMY = (d) => d ? String(d).split("-").reverse().join("/") : "";
    const toISODate = () => "2026-11-08";
    const signatureLine = () => "Dr. Someone";
    const rupeesInWords = (n) => "Rupees " + n + " Only.";
    window.__printed = null; window.__sent = null;
    const cghsPrint = (h) => { window.__printed = h; };
    const api = (action, payload) => {
      if (action === "getClinicalNoteTemplates") return Promise.resolve({ success:true, templates:[] });
      if (action === "saveCghsBill") { window.__sent = payload; return Promise.resolve({ success:true, billNo:"2026110007" }); }
      return Promise.resolve({ success:false });
    };
  ` });
  await page.addScriptTag({ content:
    html.slice(html.indexOf('// ── Stage 2: the prescription ─'),
               html.indexOf('function EndorsementView(')) });

  const LINES = [
    { at: 0, code: 'DP007', qty: 2, rate: 300, amt: 600, priced: true,
      r: { procedure: 'Flap Surgery- Per Tooth', tooth: '16, 26' }, card: null },
    { at: 1, code: 'DP001', qty: 1, rate: 150, amt: 150, priced: true,
      r: { procedure: 'Scaling', tooth: 'Full Mouth' }, card: null }
  ];
  const PAT = { uhid: 'AL1010', name: 'Santosh Kumar', dob: '1972-04-03',
                address: 'B-12, Lajpat Nagar' };

  const mount = (what) => page.evaluate(({ what, LINES, PAT }) => {
    window.__printed = null; window.__sent = null;
    const root = document.getElementById('root');
    ReactDOM.render(null, root);
    ReactDOM.render(React.createElement(what === 'bill' ? CghsBill : CghsPrescription,
      what === 'bill'
        ? { key: String(Math.random()), pat: PAT, panel: 'CGHS', card: '20542260',
            holder: 'Pensioner', lines: LINES }
        : { key: String(Math.random()), pat: PAT, lines: LINES }), root);
  }, { what, LINES, PAT });

  // Typed the way a person types it: React tracks the value, so assigning
  // .value and firing an event updates the DOM and not the state.
  const type = (sel, nth, value) => page.evaluate(({ sel, nth, value }) => {
    const el = document.querySelectorAll(sel)[nth];
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel, nth, value });
  const cells = () => page.$$eval('table input', els => els.map(e => e.value));
  const text = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());

  // ── the prescription ──────────────────────────────────────────────────
  await mount('prescription');
  await page.waitForTimeout(150);
  eq('every printed cell on the prescription is a field',
     await cells(), ['DP007', 'Flap Surgery- Per Tooth', '16, 26', '2',
                     'DP001', 'Scaling', 'Full Mouth', '1']);
  ok('and the date is one too', await page.locator('input[type=date]').count() > 0);

  await type('table input', 0, 'DP007A');
  await type('table input', 2, '16, 26, 36');
  await type('table input', 3, '3');
  await page.waitForTimeout(100);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => /Print Prescription/.test(b.innerText)).click());
  await page.waitForTimeout(120);
  let printed = await page.evaluate(() => window.__printed);
  ok('what was typed is what prints: the code',
     /DP007A/.test(printed) && !/DP007<\/td>/.test(printed), String(printed).slice(0, 200));
  ok('the tooth numbers', /16, 26, 36/.test(printed), '');
  ok('and the units', /<td class="c">3<\/td>/.test(printed), '');
  ok('the line left alone is unchanged', /DP001/.test(printed) && /Scaling/.test(printed), '');

  // ── the bill ──────────────────────────────────────────────────────────
  await mount('bill');
  await page.waitForTimeout(150);
  eq('the bill adds the rate to the fields',
     await cells(), ['DP007', 'Flap Surgery- Per Tooth', '16, 26', '2', '300',
                     'DP001', 'Scaling', 'Full Mouth', '1', '150']);
  ok('the total starts from the endorsement', /750/.test(await text()), await text());

  // A rate the panel pays this year, and a unit count corrected.
  await type('table input', 4, '350');
  await type('table input', 8, '2');
  await page.waitForTimeout(120);
  // 350 x 2 = 700 on the first line, 150 x 2 = 300 on the second.
  ok('the total follows what was typed', /1,?000/.test(await text()), await text());

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => /Issue|Bill No/.test(b.innerText) && /Issue/.test(b.innerText)).click());
  await page.waitForTimeout(150);
  const sent = await page.evaluate(() => window.__sent);
  ok('the bill was sent', !!sent, JSON.stringify(sent));
  eq('and the amount saved is the edited one', Number(sent.amount), 1000);
  {
    const saved = JSON.parse(sent.lines);
    eq('the saved lines carry the edits', saved.map(l => [l.rate, l.qty, l.amount]),
       [[350, 2, 700], [150, 2, 300]]);
    eq('with nothing else disturbed', saved.map(l => l.code), ['DP007', 'DP001']);
  }

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => /Print Bill/.test(b.innerText)).click());
  await page.waitForTimeout(120);
  printed = await page.evaluate(() => window.__printed);
  ok('the printed bill shows the edited rate and amount',
     /350/.test(printed) && /700/.test(printed), String(printed).slice(0, 200));
  ok('and the edited total in figures and words',
     /1,?000/.test(printed) && /Rupees 1000 Only\./.test(printed), '');

  // The endorsement itself is not touched: this is the document, not the plan.
  ok('nothing is written back to the endorsement',
     !/onSave|setRows/.test(html.slice(html.indexOf('function CghsBill('),
                                       html.indexOf('function CghsLines('))));

  eq('nothing threw', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else {
      fail++;
      console.log('  FAIL  ' + c.name +
        (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
         : c.got !== undefined ? '\n          ' + String(c.got).slice(0, 300) : ''));
    }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
