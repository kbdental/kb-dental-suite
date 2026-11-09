// "I want that all the details you have given in Plan CGHS should come in
//  prescription when we select from endorsement ie they should dropdown and
//  we select"
//
// Plan CGHS already says what each treatment is made of -- which clinical
// notes belong under it. The prescription was guessing instead: it matched
// the treatment's NAME against the template library and prefilled the one
// closest hit. One note, take it or type over it.
//
// So every endorsed line now carries the plan's own list, to pick from. The
// plan is the source; the name match is only the fallback for a treatment
// the plan has not been filled in for yet.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const fnOf = (name) => {
  const a = html.indexOf('function ' + name + '(');
  return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });

  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", TODAY="09/11/2026";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    const usePadMargins = () => ({});
    const cghsEsc = (v) => String(v === undefined || v === null ? "" : v)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cghsPadCss = () => "";
    const calcAge = () => "54";
    const fmtDMY = (d) => d ? String(d).split("-").reverse().join("/") : "";
    const toISODate = () => "2026-11-09";
    const signatureLine = () => "Dr. Someone";
    const CghsLines = () => null;
    const cghsPrint = () => {};
    window.__templates = [];
    const api = (action) => Promise.resolve(action === "getClinicalNoteTemplates"
      ? { success: true, templates: window.__templates } : { success: false });
  ` });
  // The reference splitter is the plan's own, not a copy: the plan cell
  // reads "Flap Surgery -> Suture Removal", and a test with its own idea of
  // how that splits proves nothing about the screen.
  await page.addScriptTag({ content: fnOf('clinicalTemplateRefs') });
  await page.addScriptTag({ content: cut('// ── Stage 2: the prescription ─', 'function CghsBill(') });

  const LINES = [
    { at: 0, code: 'DP007', qty: 2, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Flap Surgery- Per Tooth', tooth: '16, 26' }, card: null },
    { at: 1, code: 'DP001', qty: 1, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Scaling', tooth: 'Full Mouth' }, card: null },
    { at: 2, code: 'DX900', qty: 1, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Orthodontic Retainer', tooth: '' }, card: null }
  ];
  // The library carries both lengths and, where it has been written, Hindi.
  const TPL = [
    { situation: 'Flap Surgery', category: 'Periodontics',
      concise: 'Flap surgery wrt {tooth}, debridement, sutured.',
      comprehensive: 'Full-thickness flap raised wrt {tooth} under LA, root surfaces debrided, sutured.',
      hindi: 'मसूड़ों का ऑपरेशन किया गया।',
      text: 'Full-thickness flap raised wrt {tooth} under LA, root surfaces debrided, sutured.' },
    { situation: 'Suture Removal', category: 'Minor Surgery',
      concise: 'Sutures removed wrt {tooth}, healing satisfactory.',
      comprehensive: 'Sutures removed wrt {tooth}. Healing satisfactory, no signs of infection.',
      hindi: '', text: 'Sutures removed wrt {tooth}. Healing satisfactory, no signs of infection.' },
    { situation: 'Scaling', category: 'Periodontics',
      concise: 'Ultrasonic scaling done.', comprehensive: 'Full-mouth ultrasonic scaling and polishing done.',
      hindi: '', text: 'Full-mouth ultrasonic scaling and polishing done.' },
    { situation: 'Oral Prophylaxis', category: 'Periodontics',
      concise: 'Oral prophylaxis done.', comprehensive: 'Oral prophylaxis done.',
      hindi: '', text: 'Oral prophylaxis done.' }
  ];
  // Two plans share the sheet. Only the CGHS one belongs on a CGHS
  // prescription: the Normal plan is what the cash patient is handed.
  const PLAN = [
    { plan: 'CGHS', treatment: 'Flap Surgery', category: 'Periodontics',
      templates: 'Flap Surgery → Suture Removal' },
    { plan: 'Normal', treatment: 'Scaling', category: 'Periodontics',
      templates: 'Oral Prophylaxis' }
  ];

  const mount = async (plan) => {
    await page.evaluate(({ lines, templates, plan }) => {
      window.__templates = templates;
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(CghsPrescription, {
        key: String(Math.random()),
        pat: { uhid: 'AL1010', name: 'Santosh Kumar', dob: '1972-04-03' },
        lines: lines, plan: plan
      }), root);
    }, { lines: LINES, templates: TPL, plan });
    await page.waitForTimeout(140);
  };
  const picks = () => page.$$eval('select[data-kb-plan-pick]',
    els => els.map(e => ({ line: e.getAttribute('data-kb-plan-pick'),
                           options: Array.from(e.options).map(o => o.textContent) })));
  const boxes = () => page.$$eval('textarea', els => els.map(e => e.value));

  await mount(PLAN);
  let p = await picks();

  // Three endorsed lines; the third names nothing the plan or the library
  // knows, so it gets a box to type in and no empty dropdown.
  eq('a dropdown appears only where there is something to pick', p.length, 2);
  eq('the first is against the flap surgery line', p[0].line, 'Flap Surgery- Per Tooth');

  // "Flap Surgery- Per Tooth" is the rate-card name; the plan is filed under
  // "Flap Surgery". That is the normal case on this sheet, not the exception.
  eq('the plan row is found through the rate-card wording', p[0].options, [
    'Pick from the plan (5)…',
    'Flap Surgery · Type 1 (Concise)',
    'Flap Surgery · Type 2 (Comprehensive)',
    'Flap Surgery · Hindi',
    'Suture Removal · Type 1 (Concise)',
    'Suture Removal · Type 2 (Comprehensive)'
  ]);
  ok('a template with no Hindi written yet is not offered in Hindi',
     p[0].options.indexOf('Suture Removal · Hindi') < 0, JSON.stringify(p[0].options));

  // The second line's only plan row is a Normal one.
  eq('the other plan is not offered on a CGHS prescription',
     p[1].options.indexOf('Oral Prophylaxis · Type 1 (Concise)') < 0, true);
  eq('it falls back to the template that matches the name', p[1].options, [
    'Pick from the plan (2)…',
    'Type 1 (Concise)',
    'Type 2 (Comprehensive)'
  ]);

  // Picking is the whole point: the detail has to change to what was picked.
  let vals = await boxes();
  eq('the box starts on the concise note, as it printed before', vals[0],
     'Flap surgery wrt 16, 26, debridement, sutured.');

  await page.locator('select[data-kb-plan-pick]').first().selectOption({ index: 5 });
  await page.waitForTimeout(100);
  vals = await boxes();
  eq('what is picked lands in the box, with the teeth filled in', vals[0],
     'Sutures removed wrt 16, 26. Healing satisfactory, no signs of infection.');
  eq('and the other lines are left alone', vals[1], 'Ultrasonic scaling done.');

  await page.locator('select[data-kb-plan-pick]').first().selectOption({ index: 3 });
  await page.waitForTimeout(100);
  vals = await boxes();
  eq('the Hindi version can be picked too', vals[0], 'मसूड़ों का ऑपरेशन किया गया।');

  // Still a textarea underneath: a dropdown that replaced typing would take
  // away the doctor's last word on their own sheet.
  await page.locator('textarea').first().fill('Flap surgery wrt 16, 26. Reviewed.');
  await page.waitForTimeout(80);
  vals = await boxes();
  eq('and it can still be typed over afterwards', vals[0], 'Flap surgery wrt 16, 26. Reviewed.');
  eq('the dropdown goes back to its prompt, so the same note can be picked twice',
     (await picks())[0].options[0], 'Pick from the plan (5)…');

  // No plan read at all -- an older backend, or the sheet not filled in.
  await mount([]);
  p = await picks();
  eq('with no plan it still offers what the name matches', p.length, 2);
  eq('and the first is the two lengths of the matching template', p[0].options, [
    'Pick from the plan (3)…',
    'Type 1 (Concise)',
    'Type 2 (Comprehensive)',
    'Hindi'
  ]);
  eq('nothing threw', errors, []);
  await browser.close();

  // ── and the plan is actually read, where the document is opened ───────
  const recs = cut('function CghsRecords(', '// ── Stage 2: the prescription ─');
  ok('the screen reads Plan CGHS', /api\("getClinicalNotePlan"\)/.test(recs), '');
  ok('and hands it to the prescription',
     /CghsPrescription, \{ pat: pat, lines: e\.approved, plan: notePlan \}/.test(recs), '');

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
