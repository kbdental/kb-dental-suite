// "When we try making a prescription specifically in multi visit treatments
//  I do not have a date insertion option which I would like to have before
//  every step" / "please give it before every treatment" / "More important
//  for CGHS"
//
// The CGHS prescription carried ONE date, at the top of the sheet. That is
// right for a single sitting and wrong for everything else. A course of
// treatment is endorsed once and carried out over weeks -- the flap surgery
// in one visit, the sutures out in the next, the crown a fortnight later --
// and a sheet that dates all of it to the day it was printed states, on a
// panel document, that work happened on a day it did not.
//
// So every treatment carries its own date: in front of it on the screen,
// and in a column before it on the paper. Untouched, a line follows the
// date at the top, which is what a one-sitting sheet needs and means
// nothing has to be typed twice.
//
// And a date per treatment is still not enough, because a treatment is not
// always one visit. An RCT is endorsed as ONE line and carried out in
// three sittings -- access opening on the 7th, preparation on the 9th,
// obturation on the 14th -- so each endorsed treatment holds a list of
// sittings, each with its own date and its own note. One sitting prints
// exactly as it always did; several print the span on the row and each
// sitting dated underneath it.
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
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });

  // The real component, with only its surroundings stubbed. What is printed
  // is captured rather than sent to a printer.
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
    window.__printed = "";
    const cghsPrint = (h) => { window.__printed = h; };
    window.__templates = [];
    const api = (action) => Promise.resolve(action === "getClinicalNoteTemplates"
      ? { success: true, templates: window.__templates } : { success: false });
  ` });
  await page.addScriptTag({ content: fnOf('clinicalTemplateRefs') });
  await page.addScriptTag({ content: cut('// ── Stage 2: the prescription ─', 'function CghsBill(') });

  // A course of treatment, as it is endorsed: three treatments, carried out
  // on three different days.
  const LINES = [
    { at: 0, code: 'DP007', qty: 2, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Flap Surgery- Per Tooth', tooth: '16, 26' }, card: null },
    { at: 1, code: 'DP014', qty: 1, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Suture Removal', tooth: '16, 26' }, card: null },
    { at: 2, code: 'DP021', qty: 1, amt: 0, rate: 0, priced: true,
      r: { procedure: 'Crown', tooth: '16' }, card: null }
  ];
  const TPL = [
    { situation: 'Flap Surgery', category: 'Periodontics',
      concise: 'Flap surgery wrt {tooth}, debridement, sutured.',
      comprehensive: 'Full-thickness flap raised wrt {tooth} under LA, sutured.',
      hindi: '', text: 'Full-thickness flap raised wrt {tooth} under LA, sutured.' },
    { situation: 'Suture Removal', category: 'Minor Surgery',
      concise: 'Sutures removed wrt {tooth}, healing satisfactory.',
      comprehensive: 'Sutures removed wrt {tooth}. Healing satisfactory.',
      hindi: '', text: 'Sutures removed wrt {tooth}. Healing satisfactory.' }
  ];

  await page.evaluate(({ lines, templates }) => {
    window.__templates = templates;
    ReactDOM.render(React.createElement(CghsPrescription, {
      pat: { uhid: 'AL1010', name: 'Santosh Kumar', dob: '1972-04-03' },
      lines: lines, plan: []
    }), document.getElementById('root'));
  }, { lines: LINES, templates: TPL });
  await page.waitForTimeout(200);

  const lineDates = () => page.$$eval('input[data-kb-line-date]',
    els => els.map(e => ({ line: e.getAttribute('data-kb-line-date'), value: e.value })));
  const topDate = page.locator('input[type="date"]').first();

  let d = await lineDates();
  eq('every treatment has a date of its own', d.length, 3);
  eq('named for the treatment it sits in front of',
     d.map(x => x.line), ['Flap Surgery- Per Tooth', 'Suture Removal', 'Crown']);
  eq('and each starts on the date at the top, so a one-sitting sheet needs no typing',
     d.map(x => x.value), ['2026-11-09', '2026-11-09', '2026-11-09']);

  // Moving the sheet's date moves the lines that have not been given one.
  await topDate.fill('2026-11-10');
  await page.waitForTimeout(120);
  eq('a line with no date of its own follows the sheet',
     (await lineDates()).map(x => x.value), ['2026-11-10', '2026-11-10', '2026-11-10']);

  // The whole point: three treatments, three days.
  await page.locator('input[data-kb-line-date]').nth(1).fill('2026-11-17');
  await page.locator('input[data-kb-line-date]').nth(2).fill('2026-12-01');
  await page.waitForTimeout(140);
  d = await lineDates();
  eq('each treatment can be dated to the day it was done',
     d.map(x => x.value), ['2026-11-10', '2026-11-17', '2026-12-01']);

  // And moving the sheet's date now leaves them where they were put.
  await topDate.fill('2026-11-11');
  await page.waitForTimeout(120);
  eq('a treatment given its own date keeps it',
     (await lineDates()).map(x => x.value), ['2026-11-11', '2026-11-17', '2026-12-01']);

  // A way back, or a date typed by mistake is stuck there.
  const resets = page.locator('button', { hasText: /Same as sheet/ });
  eq('the two that were changed offer a way back', await resets.count(), 2);
  await resets.first().click();
  await page.waitForTimeout(120);
  eq('and taking it puts the line back on the sheet\'s date',
     (await lineDates()).map(x => x.value), ['2026-11-11', '2026-11-11', '2026-12-01']);
  eq('leaving the other where it was put', await resets.count(), 1);

  // ── the paper ────────────────────────────────────────────────────────
  await page.locator('button', { hasText: /Print Prescription/ }).first().click();
  await page.waitForTimeout(250);
  const printed = await page.evaluate(() => window.__printed || '');
  ok('the printed sheet has a Date column', /<th[^>]*>Date<\/th>/.test(printed),
     printed.slice(printed.indexOf('<thead'), printed.indexOf('</thead>')));
  // Before the treatment, because that is the order it is read in: on this
  // day, this was done.
  const head = printed.slice(printed.indexOf('<thead'), printed.indexOf('</thead>'));
  const cols = [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
  eq('in front of the treatment, not after it',
     cols, ['Sn', 'Date', 'Code', 'Treatment Advised', 'Tooth Number', 'No. of Units']);
  const body = printed.slice(printed.indexOf('<tbody>'), printed.indexOf('</tbody>'));
  const dates = [...body.matchAll(/<tr><td class="c">\d+<\/td><td class="c">([^<]*)<\/td>/g)].map(m => m[1]);
  eq('and every treatment prints the day it was done',
     dates, ['11/11/2026', '11/11/2026', '01/12/2026']);
  // The detail paragraph sits under the whole row, so it has to stretch one
  // column further now. Left at four it would pull the table apart.
  ok('the detail under a treatment still spans the row',
     /colspan="5"/.test(body), body.slice(0, 300));
  ok('and the detail is still there', /Flap surgery wrt 16, 26/.test(body), '');

  // ── a treatment that took three visits ───────────────────────────────
  // The RCT the whole thing was asked for: one endorsed line, three
  // sittings, three dates. Start again so the state is clean.
  await page.evaluate(() => ReactDOM.unmountComponentAtNode(document.getElementById('root')));
  await page.evaluate(({ lines, templates, plan }) => {
    window.__templates = templates;
    ReactDOM.render(React.createElement(CghsPrescription, {
      pat: { uhid: 'AL1010', name: 'Santosh Kumar', dob: '1972-04-03' },
      lines: lines, plan: plan
    }), document.getElementById('root'));
  }, {
    lines: [{ at: 0, code: 'DP023', qty: 1, amt: 0, rate: 0, priced: true,
              r: { procedure: 'Root Canal Treatment- Posterior', tooth: '36' }, card: null }],
    templates: [
      { situation: 'RCT - Access Opening', concise: 'Access opening done wrt {tooth} under LA.',
        comprehensive: 'Access cavity prepared wrt {tooth}, pulp extirpated.', hindi: '',
        text: 'Access cavity prepared wrt {tooth}.' },
      { situation: 'RCT - Biomechanical Preparation', concise: 'BMP done wrt {tooth}.',
        comprehensive: 'Bio-mechanical preparation completed wrt {tooth}.', hindi: '',
        text: 'Bio-mechanical preparation completed wrt {tooth}.' },
      { situation: 'RCT - Obturation', concise: 'Obturation completed wrt {tooth}.',
        comprehensive: 'Obturation completed wrt {tooth} by lateral condensation.', hindi: '',
        text: 'Obturation completed wrt {tooth}.' }
    ],
    plan: [{ plan: 'CGHS', treatment: 'Root Canal Treatment',
             templates: 'RCT - Access Opening \u2192 RCT - Biomechanical Preparation \u2192 RCT - Obturation' }]
  });
  await page.waitForTimeout(300);

  eq('a treatment starts as one sitting, the way it always was',
     await page.locator('input[data-kb-line-date]').count(), 1);
  ok('and the plan lists the three steps it is made of',
     (await page.locator('select[data-kb-plan-pick]').first()
       .evaluate(e => Array.from(e.options).map(o => o.textContent))).length === 7, '');

  // Sitting 1 on the 7th.
  await page.locator('select[data-kb-plan-pick]').first().selectOption({ index: 1 });
  await page.locator('input[data-kb-line-date]').first().fill('2026-11-07');
  await page.waitForTimeout(150);
  // Sitting 2 on the 9th.
  await page.locator('button', { hasText: /Add a sitting/ }).first().click();
  await page.waitForTimeout(150);
  await page.locator('input[data-kb-line-date]').nth(1).fill('2026-11-09');
  await page.locator('select[data-kb-plan-pick]').nth(1).selectOption({ index: 3 });
  await page.waitForTimeout(150);
  // Sitting 3 on the 14th.
  await page.locator('button', { hasText: /Add a sitting/ }).first().click();
  await page.waitForTimeout(150);
  await page.locator('input[data-kb-line-date]').nth(2).fill('2026-11-14');
  await page.locator('select[data-kb-plan-pick]').nth(2).selectOption({ index: 5 });
  await page.waitForTimeout(250);

  eq('three sittings, three dates',
     await page.$$eval('input[data-kb-line-date]', e => e.map(x => x.value)),
     ['2026-11-07', '2026-11-09', '2026-11-14']);
  eq('each with the step that was done at it',
     await page.$$eval('textarea', e => e.map(x => x.value)),
     ['Access opening done wrt 36 under LA.',
      'BMP done wrt 36.',
      'Obturation completed wrt 36.']);
  // Numbered on screen, or three identical date boxes say nothing about
  // which visit is which.
  const screen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('and they are numbered', /SITTING 1 . DATE/i.test(screen) && /SITTING 3 . DATE/i.test(screen),
     screen.slice(0, 300));

  await page.locator('button', { hasText: /Print Prescription/ }).first().click();
  await page.waitForTimeout(300);
  const rct = await page.evaluate(() => window.__printed || '');
  const rctBody = rct.slice(rct.indexOf('<tbody>'), rct.indexOf('</tbody>'));
  // Still ONE endorsed line: the panel endorsed one RCT, and the bill will
  // bill one. The sittings are what is written under it.
  eq('the course of treatment is still one endorsed line',
     (rctBody.match(/Root Canal Treatment- Posterior/g) || []).length, 1);
  ok('whose Date cell spans the first visit to the last',
     /07\/11\/2026 \u2013 14\/11\/2026/.test(rctBody), rctBody.slice(0, 400));
  const under = [...rctBody.matchAll(/<b>(\d{2}\/\d{2}\/\d{4})<\/b> \u2014 <span[^>]*>([^<]*)</g)]
    .map(m => [m[1], m[2]]);
  eq('and every sitting is listed under it, dated', under,
     [['07/11/2026', 'Access opening done wrt 36 under LA.'],
      ['09/11/2026', 'BMP done wrt 36.'],
      ['14/11/2026', 'Obturation completed wrt 36.']]);

  // ── written up out of order ───────────────────────────────
  // A dentist writing up a finished course often enters the obturation
  // first and adds the earlier sittings after it. Taken in the order they
  // were typed, the span said the course began on the day it ended -- on
  // a document that goes to the panel.
  await page.locator('input[data-kb-line-date]').nth(0).fill('2026-11-14');
  await page.locator('input[data-kb-line-date]').nth(1).fill('2026-11-07');
  await page.locator('input[data-kb-line-date]').nth(2).fill('2026-11-20');
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: /Print Prescription/ }).first().click();
  await page.waitForTimeout(250);
  const outOfOrder = await page.evaluate(() => window.__printed || '');
  const cellOf = (h) => {
    const m = /<tr><td class="c">1<\/td><td class="c">([^<]*)<\/td>/.exec(h);
    return m ? m[1] : '';
  };
  eq('the span runs from the earliest visit to the latest, not first-typed to last',
     cellOf(outOfOrder), '07/11/2026 \u2013 20/11/2026');
  // Two sittings, the later one typed first: the range must not read
  // backwards.
  await page.locator('button', { hasText: /^\u2715$/ }).last().click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: /Print Prescription/ }).first().click();
  await page.waitForTimeout(250);
  eq('and never backwards', cellOf(await page.evaluate(() => window.__printed || '')),
     '07/11/2026 \u2013 14/11/2026');
  // Put the third back for the checks below.
  await page.locator('button', { hasText: /Add a sitting/ }).first().click();
  await page.waitForTimeout(150);
  await page.locator('input[data-kb-line-date]').nth(2).fill('2026-11-14');
  await page.locator('select[data-kb-plan-pick]').nth(2).selectOption({ index: 5 });
  await page.waitForTimeout(200);

  // A sitting added by mistake can go.
  await page.locator('button', { hasText: /^\u2715$/ }).last().click();
  await page.waitForTimeout(200);
  eq('a sitting can be removed again',
     await page.locator('input[data-kb-line-date]').count(), 2);
  ok('and the first one cannot, because it is the treatment itself',
     await page.locator('button', { hasText: /^\u2715$/ }).count() === 2, '');

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
