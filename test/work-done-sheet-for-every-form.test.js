// "I had requested you earlier also that I wanted Work done sheet that is
//  there in the RCT form for all the forms but seeing nothing has been built"
//
// Correct, and the earlier work is why it looked built. CS_RECORD_TAB was
// filled in for all eighteen forms, which made each form's past rows show up
// -- but View Records routed on `form.sheetType`, which only RCT, Implant
// Surgery, Implant Prosthetic and Crown & Bridge carry. The other fourteen
// went to GenericRecordsView: a two-column dump of every column against its
// value, no letterhead, no A4 layout, no Print button. Nothing you could put
// in a file or hand to a patient.
//
// The printable sheet was never form-specific. printSheetRecord builds it
// from the tab's OWN column headers -- the site column, the date column, then
// every header that has something in it, four visits to a page, in the house
// A4 layout. It was one routing line away from working for all eighteen.
//
// So this checks the two things that were actually wrong: that every form
// reaches the sheet, and that the sheet it reaches is the printable one.
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

// ── the routing, which is what was broken ───────────────────────────────
const shell = cut('    // Iframe form (RCT / Implant / Crown)', 'const SUITE_CONFIGS');
ok('View Records no longer asks whether the form has a structured record',
   !/viewMode === "records" && globalPat && globalPat\.uhid && form\.sheetType/.test(shell), '');
ok('every form goes to the work done sheet',
   /viewMode === "records" && globalPat && globalPat\.uhid\s*\n?\s*\? React\.createElement\("div"[\s\S]{0,200}ClinicalSheetRecordView/.test(shell), '');
// The dump it used to fall back to is gone, not merely bypassed: a dead
// component in a file this size is the next person's wrong turn.
ok('the plain key-and-value dump is gone', !/GenericRecordsView/.test(html), '');

// The button that opens it is on every form's toolbar, gated only on there
// being a patient -- not on which form it is. SUITE_CONFIGS is empty, so
// `isSuite` is never true and the toolbar is the same on all eighteen.
const toolbar = cut('      !isSuite && globalPat && globalPat.uhid && React.createElement("div", {',
                    '    // Iframe form (RCT / Implant / Crown)');
ok('View Records is offered on every form, once a patient is open',
   /"\uD83D\uDCCB View Records"|"\u{1F4CB} View Records"|View Records/u.test(toolbar), '');
ok('and nothing about the form decides whether it is offered',
   !/sheetType|tabName/.test(toolbar), toolbar.slice(0, 200));

// Every form the app offers, read off the form list so a nineteenth cannot
// be added without this noticing it has no tab to build a sheet from.
const formsBlock = html.slice(html.indexOf('const FORMS = ['));
const FORM_IDS = [...formsBlock.slice(0, formsBlock.indexOf('\n  ];'))
  .matchAll(/\bid:"(\w+)",\s*label:"/g)].map(m => m[1]);
eq('all eighteen forms are accounted for', FORM_IDS.length, 18);

const TABS = new Function(cut('const CS_RECORD_TAB = {', '\n};') + '\n};\nreturn CS_RECORD_TAB;')();
eq('and every one of them names the tab its sheet is built from',
   FORM_IDS.filter(id => !TABS[id] || !TABS[id].tab), []);
eq('with a date column, which is what orders the visits',
   FORM_IDS.filter(id => !TABS[id].date), []);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });

  await page.addScriptTag({ content: `
    const T="#0078B4", TL="#DCF4FB", BORDER="#e5e5e0", BGS="#f5f5f0";
    const CR_PAGE_CSS = "";
    const KB_LETTERHEAD = "";
    const fmtDMY = (v) => String(v||"").slice(0,10).split("-").reverse().join("/");
    // The print window is the deliverable, so it is captured rather than opened.
    window.__printed = null;
    window.open = () => ({ document: { write: h => { window.__printed = h; }, close(){} },
                           focus(){}, print(){} });
    window.__rows = {};        // tabName -> { records, headers }
    window.__asked = [];
    const api = (action, p) => {
      window.__asked.push(action + (p && p.tabName ? ":" + p.tabName : ""));
      if (action === "getClinicalRecords") {
        const r = window.__rows[p.tabName];
        return Promise.resolve(r ? { success:true, records:r.records, headers:r.headers }
                                 : { success:true, records:[], headers:[] });
      }
      // No structured record for anyone: that is the state of fourteen of the
      // eighteen forms, and the four others for a patient whose work predates it.
      return Promise.resolve({ success:true });
    };
  ` });
  await page.addScriptTag({ content:
    cut('const CS_ITEM_ID_FIELD = {', 'function ClinicalSheetRecordView(') });
  await page.addScriptTag({ content: fnOf('ClinicalSheetRecordView') });
  // The printer and its A4 house layout, which sit further down the page than
  // the slice above reaches.
  // pH draws the clinic's letterhead at the top of every printed page.
  for (const f of ['pH', 'crEscape', 'crPage', 'crOpenPrint', 'printSheetRecord', 'printClinicalRecord'])
    await page.addScriptTag({ content: fnOf(f) });

  // Two visits on one site, the way a real tab holds them: the headers are
  // the clinic's own words, and a column nobody filled in is left out.
  const mount = async (formId, tab, siteCol, dateCol) => {
    await page.evaluate(({ formId, tab, siteCol, dateCol }) => {
      const headers = ['Timestamp', 'UHID', 'Patient Name', 'Age', 'Gender', 'Doctor']
        .concat(siteCol ? [siteCol] : []).concat([dateCol,
          'What Was Done', 'Material Used', 'Clinical Notes', 'Nobody Filled This In']);
      const row = (site, when, done) => {
        const r = { Timestamp: '2026-11-01T09:00:00Z', UHID: 'AL1010',
          'Patient Name': 'Santosh Kumar', Age: '54', Gender: 'Male', Doctor: 'Dr. K. B.',
          'What Was Done': done, 'Material Used': 'As charted',
          'Clinical Notes': 'Reviewed, patient comfortable.', 'Nobody Filled This In': '' };
        if (siteCol) r[siteCol] = site;
        r[dateCol] = when;
        return r;
      };
      window.__rows = {}; window.__printed = null; window.__asked = [];
      window.__rows[tab] = { headers: headers, records: [
        row('16', '2026-10-02', 'First visit on this site'),
        row('16', '2026-10-20', 'Second visit on this site')
      ] };
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(ClinicalSheetRecordView, {
        key: formId, formId: formId, sheetType: undefined, uhid: 'AL1010',
        onNewEntry: () => {}
      }), root);
    }, { formId, tab, siteCol, dateCol });
    await page.waitForTimeout(200);
  };
  const screen = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());

  // Every form, driven from the app's own table rather than a list retyped here.
  for (const id of FORM_IDS) {
    const cfg = TABS[id];
    await mount(id, cfg.tab, cfg.col, cfg.date);
    const t = await screen();

    ok(id + ': the sheet has a Print Work Done Sheet button',
       /Print Work Done Sheet/.test(t), t.slice(0, 160));
    ok(id + ': what was recorded is on it',
       /First visit on this site/.test(t) && /Second visit on this site/.test(t), t.slice(0, 200));
    // Shouted on screen, because the section heading is upper-cased by CSS.
    ok(id + ': it says which tab it came from',
       t.toUpperCase().indexOf(('Recorded in the sheet — ' + cfg.tab).toUpperCase()) >= 0,
       t.slice(0, 200));
    ok(id + ': a column nobody filled in is left off',
       !/nobody filled this in/i.test(t), '');
    // Scaling and TM Joint record the mouth, so they have no site column and
    // must not draw an empty row for one.
    if (cfg.col) ok(id + ': the site is a row of its own',
      t.toUpperCase().indexOf(cfg.col.toUpperCase()) >= 0, t.slice(0, 200));

    // And it prints -- the A4 house sheet, not the screen.
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => /Print Work Done Sheet/.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(120);
    const out = await page.evaluate(() => window.__printed || '');
    // Escaped the way it reaches the page: "Crown & Bridge" prints as
    // "Crown &amp; Bridge", and a test that forgets that fails on one form.
    const titled = cfg.tab.replace(/&/g, '&amp;') + ' Work Done';
    ok(id + ': printing produces a work done sheet',
       out.indexOf(titled) >= 0, out.slice(0, 200));
    ok(id + ': with the patient on it',
       /Santosh Kumar/.test(out) && /AL1010/.test(out), out.slice(0, 200));
    ok(id + ': and a document code of its own',
       /KBDC\/FORMS\/[A-Z-]+/.test(out), (out.match(/KBDC[^<"]*/) || [''])[0]);
  }

  // A patient with nothing on this form yet: it has to say so, and name the
  // form in the clinic's words. It used to print the internal id.
  await page.evaluate(() => {
    window.__rows = {};
    const root = document.getElementById('root');
    ReactDOM.render(null, root);
    ReactDOM.render(React.createElement(ClinicalSheetRecordView, {
      key: 'empty', formId: 'orthoProgress', sheetType: undefined, uhid: 'AL1010',
      onNewEntry: () => {}
    }), root);
  });
  await page.waitForTimeout(250);
  const empty = await screen();
  ok('a form with nothing on it says so rather than spinning',
     /Nothing recorded yet for this patient/.test(empty), empty.slice(0, 200));
  ok('and names the form the way the clinic does',
     /Orthodontics Progress/.test(empty) && !/orthoProgress/.test(empty), empty.slice(0, 220));

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
