// "Backfill of pre-2026-11-10 RCT / implant / crown records into the flat
//  tabs, so the RCT tab shows your history and not only new visits."
//
// The four wizard forms save a patient's whole course of treatment as one
// cell of JSON. Since 11 Nov 2026 the same save ALSO writes each visit out
// flat, into the tab the clinic actually reads. Everything saved before that
// is safe and unreadable: the "RCT" tab fills from that day and shows none
// of the years behind it.
//
// Nothing but a one-off can fix that, and the one thing it must not do is
// re-derive the columns. If the backfilled rows were built by a second copy
// of the rules, the history and tomorrow's visits would disagree about what
// a visit looks like -- in the same tab, under the same headers. So the
// backend only hands the records back, and the app projects each one through
// csFlatRowsFromRecord, the same function a save uses.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the backend hands the records back, and changes nothing ─────────────
ok('the backend offers the history', /case "listClinicalSheetRecords":/.test(gs), '');

const fn = (name) => {
  const a = gs.indexOf('function ' + name + '(');
  return gs.slice(a, gs.indexOf('\n}', a) + 2) + '\n';
};
// A tab is a list of rows. Only getRange and getLastRow are needed, and
// every write is counted so it can be shown that none happened.
let writes = 0;
const makeTab = (rows) => ({
  _rows: rows.map(r => r.slice()),
  getLastRow() { return this._rows.length; },
  getRange(row, col, nr, nc) {
    const sh = this;
    return {
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const src = sh._rows[row - 1 + i] || [];
          const line = [];
          for (let j = 0; j < nc; j++) line.push(src[col - 1 + j] === undefined ? '' : src[col - 1 + j]);
          out.push(line);
        }
        return out;
      },
      setValues: () => { writes++; }
    };
  },
  appendRow() { writes++; }
});

const rec = (uhid, name, type, when, obj) => [uhid, name, type, JSON.stringify(obj), when];
const course = (tooth) => ({ pId: 'X', pName: 'X', entries: [{ tooth, n: 1, date: '01/05/2026' }] });
const TABS = {
  'Clinical Sheets - RCT': makeTab([
    ['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At'],
    rec('KB0003', 'C', 'RCT', '2026-07-01', course('46')),
    rec('KB0001', 'A', 'RCT', '2026-06-01', course('36'))
  ]),
  // The shared tab as it was before the split: one record never re-saved
  // since, plus an older copy of a record the form's own tab now holds.
  'Clinical Sheets': makeTab([
    ['UHID', 'Patient Name', 'Sheet Type', 'All Teeth Data', 'Saved At'],
    rec('KB0002', 'B', 'RCT', '2026-02-01', course('11')),
    rec('KB0001', 'A', 'RCT', '2026-01-01', course('OLD')),
    rec('KB0009', 'I', 'Crown Bridge', '2026-03-01', course('21'))
  ]),
  'Clinical Sheets - Implant Surgery': makeTab([]),
  'Clinical Sheets - Implant Prosthetic': makeTab([]),
  'Clinical Sheets - Crown Bridge': makeTab([])
};
const back = {
  getClinicalSheet: (name) => TABS[name] || makeTab([]),
  safeParseJSON: (v) => { try { return JSON.parse(v); } catch (e) { return null; } },
  String, Object, Array, JSON, Math, parseInt, console
};
vm.createContext(back);
vm.runInContext(
  gs.slice(gs.indexOf('var CLINICAL_SHEETS_SHARED_TAB'), gs.indexOf('function clinicalSheetTabName_'))
  + fn('clinicalSheetTabName_') + fn('listClinicalSheetRecords')
  + '\nthis.list = listClinicalSheetRecords;', back);

let r = back.list({ sheetType: 'RCT', offset: 0, limit: 2 });
eq('every RCT record on file is counted, wherever it sits', r.total, 3);
eq('a page holds what was asked for', r.records.length, 2);
eq('and says where the next one starts', r.next, 2);
eq('in a fixed order, so paging cannot skip or repeat a patient',
   r.records.map(x => x.uhid), ['KB0001', 'KB0002']);
ok('the record comes back parsed, whole', r.records[0].allTeeth &&
   r.records[0].allTeeth.entries && r.records[0].allTeeth.entries[0].tooth === '36',
   JSON.stringify(r.records[0].allTeeth));
// Both tabs hold KB0001. The form's own tab is the one the form saves to.
ok('where both tabs hold a patient, the form\'s own tab is the one read',
   r.records[0].allTeeth.entries[0].tooth === '36', '');

const r2 = back.list({ sheetType: 'RCT', offset: 2, limit: 2 });
eq('the last page finishes the list', r2.records.map(x => x.uhid), ['KB0003']);
eq('and says there is no next', r2.next, null);
eq('a crown record is not handed back as an RCT one',
   back.list({ sheetType: 'RCT' }).records.filter(x => x.uhid === 'KB0009').length, 0);
eq('and is found under its own type',
   back.list({ sheetType: 'Crown Bridge' }).records.map(x => x.uhid), ['KB0009']);
eq('a request with no type is refused rather than guessed at',
   back.list({}).success, false);
eq('reading the history writes nothing', writes, 0);
// One cell can hold years of treatment, so a page is small and bounded.
eq('a page is bounded however much is asked for',
   back.list({ sheetType: 'RCT', limit: 9999 }).records.length <= 25, true);

// ── the app projects them through the same code a save uses ─────────────
const records = cut('function ClinicalRecords({ globalPat, setGlobalPat }) {', 'function Prescription(');
ok('the backfill reads the history', /api\("listClinicalSheetRecords"/.test(records), '');
ok('and projects each record through the save\'s own function',
   /csFlatRowsFromRecord\(formId, rec\.allTeeth\)/.test(records), '');
// The backend knows the column HEADERS -- it set the tabs up -- but it must
// not know how a record becomes rows. That rule lives in one place.
ok('with no second copy of that rule in the backend',
   !/csFlatRowsFromRecord|CS_FORM_CONFIG/.test(gs), '');
ok('and sends the rows where a save sends them',
   /apiPost\("appendClinicalRecordRows"/.test(records), '');
ok('carrying the key columns, so a second run corrects instead of repeating',
   /keyColumns: JSON\.stringify\(flat\.keyColumns\)/.test(records), '');
ok('it covers all four of the forms that save this way',
   /Object\.entries\(CS_FORM_BY_SHEET_TYPE\)/.test(records), '');
ok('and pages through rather than asking for everything at once',
   /offset = res\.next/.test(records), '');

// ── drawn and run, in the real app ──────────────────────────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
// Two patients of RCT history, saved the old way, one of them with two
// visits on one tooth -- which is the whole point: a course of treatment,
// not a row.
const HISTORY = {
  RCT: [
    { uhid: 'KB0001', name: 'A', sheetType: 'RCT', savedAt: '2026-05-01', allTeeth: {
        pId: 'KB0001', pName: 'A', doctor: 'Dr. A Mittel',
        entries: [{ tooth: '36', n: 1, date: '01/05/2026', instr: 'ProTaper Gold',
          visits: [{ date: '01/05/2026', ana: 'LA 2% lignocaine', rd: 'Yes' },
                   { date: '09/05/2026', obtuCS: 'Complete', mcSz: '25/.04' }] }] } },
    { uhid: 'KB0002', name: 'B', sheetType: 'RCT', savedAt: '2026-06-02', allTeeth: {
        pId: 'KB0002', pName: 'B',
        entries: [{ tooth: '11', n: 1, date: '02/06/2026', ana: 'LA' }] } }
  ]
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const posted = [];
  await page.route('**cdnjs.cloudflare.com/**', rt => {
    const u = rt.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return rt.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
  });
  await page.route('**script.google.com/**', rt => {
    const req = rt.request();
    const body = req.postData() || req.url();
    let out = { success: true };
    if (/listClinicalSheetRecords/.test(body)) {
      const m = /sheetType=([^&]*)/.exec(req.url());
      const type = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      const all = HISTORY[type] || [];
      const off = parseInt((/offset=(\d+)/.exec(req.url()) || [0, 0])[1], 10) || 0;
      const slice = all.slice(off, off + 8);
      out = { success: true, total: all.length, offset: off,
              next: off + slice.length < all.length ? off + slice.length : null, records: slice };
    } else if (/appendClinicalRecordRows/.test(body)) {
      let p = {};
      try { p = JSON.parse(body); } catch (e) {}
      let rows = [];
      try { rows = JSON.parse(p.rows || '[]'); } catch (e) {}
      posted.push({ tab: p.tabName, keyColumns: JSON.parse(p.keyColumns || '[]'), rows });
      out = { success: true, written: rows.length, updated: 0, skipped: 0 };
    }
    return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2200);
  await page.getByText('Records', { exact: false }).first().click();
  await page.waitForTimeout(700);
  await page.getByText('Clinical Records', { exact: false }).first().click();
  await page.waitForTimeout(1100);
  await page.getByText('Work Done Sheet', { exact: false }).first().click();
  await page.waitForTimeout(800);

  const txt = () => page.evaluate(() => {
    const el = document.querySelector('[data-kb-page]');
    return (el && el.innerText.replace(/\s+/g, ' ')) || '';
  });
  let t = await txt();
  ok('the backfill is offered where the sheets are', /History into the sheet tabs/i.test(t),
     t.slice(0, 200));
  ok('and says it can be run again safely', /corrected, not repeated/i.test(t), '');
  const btn = page.locator('button', { hasText: /Fill the sheet tabs from history/ }).first();
  eq('there is one button to press', await btn.count(), 1);
  await btn.click();
  await page.waitForTimeout(4000);
  t = await txt();

  eq('each patient\'s record is sent once', posted.length, 2);
  eq('into the tab the clinic reads', posted.map(p => p.tab), ['RCT', 'RCT']);
  // The course of treatment becomes one row per VISIT, which is what the tab
  // has a row for. A patient with two appointments on one tooth is two rows.
  eq('a course of treatment becomes one row per visit',
     posted[0].rows.length, 2);
  eq('both rows carry the tooth the work was on',
     posted[0].rows.map(x => x['Tooth No.']), ['36', '36']);
  eq('each row carries its own visit date',
     posted[0].rows.map(x => x['Visit Date']), ['01/05/2026', '09/05/2026']);
  eq('and what was done that day, under the column it belongs in',
     [posted[0].rows[0]['Anaesthesia'], posted[0].rows[1]['Obturation (Complete/Sectional)']],
     ['LA 2% lignocaine', 'Complete']);
  ok('a visit carries nothing from the other one',
     !posted[0].rows[0]['Obturation (Complete/Sectional)'] && !posted[0].rows[1]['Anaesthesia'],
     JSON.stringify(posted[0].rows));
  ok('and what holds for the whole course is on every row of it',
     posted[0].rows.every(x => x['Instrument Used'] === 'ProTaper Gold'),
     JSON.stringify(posted[0].rows));
  ok('the patient is named on every row', posted[0].rows.every(x => x.UHID === 'KB0001'), '');
  eq('and the rows are keyed on the visit, so a re-run corrects them',
     posted[0].keyColumns, ['UHID', 'Visit Date', 'Tooth No.']);

  ok('the report says what happened, tab by tab', /RCT: 2 patient\(s\) read/.test(t), t.slice(0, 400));
  ok('and says nothing was found where nothing was',
     /Implant Surgery: no records on file/.test(t), '');

  // Run it again: the same rows, which is what makes it safe. The backend
  // decides what to do with them -- it matches on the key columns.
  const first = JSON.stringify(posted);
  posted.length = 0;
  await page.locator('button', { hasText: /Fill the sheet tabs from history/ }).first().click();
  await page.waitForTimeout(4000);
  eq('running it twice sends exactly the same rows', JSON.stringify(posted), first);

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
