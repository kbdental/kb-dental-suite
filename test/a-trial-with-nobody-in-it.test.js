// "duplicate the app such that if I give to somebody for trial my patient
//  data is not there ... an empty app with just the master filled in"
//  "I need a separate link for that"
//
// Two halves.
//
// THE LINK. The trial is its own page, trial/index.html, not a ?clinic= on
// the clinic's own. Today the URL is the only thing between a stranger and
// the live patient list -- only Master and Reports ask for a password -- so
// a trial link that differed from the clinic's by one query parameter would
// hand over the clinic's address with it. This page carries ONE instance
// and does not contain the clinic's /exec URLs at all.
//
// It is generated from index.html, so it cannot drift behind the app: the
// test regenerates it and compares byte for byte.
//
// THE DATA. A copy of the spreadsheet is emptied by a function that keeps
// the master lists BY NAME and clears everything else. That way round
// because a tab nobody listed is far more likely to be a record of
// something than a list of options, and the one mistake that cannot be
// undone is leaving a patient in.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the page is generated, and in sync ──────────────────────────────────
const builder = require(path.join(REPO, 'tools/build-trial.js'));
const onDisk = fs.readFileSync(builder.OUT, 'utf8');
const rebuilt = builder.build();
eq('the trial page is exactly what the builder produces', rebuilt === onDisk, true);
ok('and it is built from the app itself, not kept as a second copy',
   fs.existsSync(path.join(REPO, 'tools/build-trial.js')), '');

// ── it cannot reach the clinic's books ──────────────────────────────────
const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const clinicUrls = [...new Set([...src.matchAll(/AKfycb[A-Za-z0-9_-]+/g)].map(m => m[0]))];
eq('the clinic has backends of its own to leak', clinicUrls.length >= 2, true);
eq('and not one of them is in the trial page',
   clinicUrls.filter(u => onDisk.indexOf(u) >= 0), []);

const instances = (() => {
  const a = onDisk.indexOf('window.KB_INSTANCES = {');
  return onDisk.slice(a, onDisk.indexOf('\n};', a));
})();
ok('the trial page lists one instance', /trial: \{/.test(instances), '');
ok('and neither of the clinic\'s', !/main: \{|empanelled: \{/.test(instances), instances.slice(0, 200));
ok('its backend comes from config.js, not from the page',
   /window\.KB_TRIAL_SCRIPT_URL/.test(instances), '');
ok('which the page loads', /<script src="\.\/config\.js"><\/script>/.test(onDisk), '');
ok('no query string means the trial, since "main" is not an instance here',
   /var id = "trial";/.test(onDisk) && /\.get\("clinic"\) \|\| "trial";/.test(onDisk), '');
// The clinic's own page is untouched.
ok('the clinic\'s own page still opens on the clinic', /var id = "main";/.test(src), '');
ok('and still has both its books', /main: \{[\s\S]{0,400}empanelled: \{/.test(src), '');

// ── the emptying function ───────────────────────────────────────────────
const fn = (name) => {
  const a = gs.indexOf('function ' + name + '(');
  return gs.slice(a, gs.indexOf('\n}', a) + 2) + '\n';
};
ok('the backend offers it', /function emptyThisCopyForTrial\(\)/.test(gs), '');

// Every name on the keep list must be a tab the code actually opens: a
// typo here is a master list silently wiped.
const keepCtx = {};
vm.createContext(keepCtx);
vm.runInContext(gs.slice(gs.indexOf('var TRIAL_KEEP_TABS = ['),
                         gs.indexOf('\n];', gs.indexOf('var TRIAL_KEEP_TABS = [')) + 3)
  + '\nthis.KEEP = TRIAL_KEEP_TABS;', keepCtx);
const opened = new Set();
[...gs.matchAll(/getSheet\(\s*"([^"]+)"\s*\)/g)].forEach(m => opened.add(m[1]));
[...gs.matchAll(/^var ([A-Z_0-9]+) *= *"([^"]+)";/gm)].forEach(m => {
  if (new RegExp('getSheet\\(\\s*' + m[1] + '\\s*\\)').test(gs)) opened.add(m[2]);
});
eq('no name on the keep list is a typo', keepCtx.KEEP.filter(k => !opened.has(k)), []);
// The lists a clinic would be furious to lose.
['Doctor Details', 'Treatments Master', 'Medicines Master', 'Clinical Note Templates',
 'Panels', 'Panel Rates', 'Clinic Profile', 'Working Days'].forEach(n =>
  ok('the trial keeps ' + n, keepCtx.KEEP.indexOf(n) >= 0, ''));
// And the ones that are the whole point of doing this.
['Registrations', 'Appointments', 'Daily Register', 'Care Plans', 'Treatment Plans',
 'Treatment Cases', 'Consents', 'Patient Documents', 'CGHS Bills', 'Pending'].forEach(n =>
  ok(n + ' is not kept', keepCtx.KEEP.indexOf(n) < 0, ''));
// A signature is not a thing to hand to somebody trying the software out.
ok('and neither is the doctors\' signature image',
   keepCtx.KEEP.indexOf('Signatures') < 0, '');

// Run it, against a book that is neither of the clinic's.
const makeSheet = (name, rows) => ({
  _name: name, _rows: rows.map(r => r.slice()),
  getName() { return this._name; },
  getLastRow() { return this._rows.length; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  getRange(row, col, nr, nc) {
    const sh = this;
    return { getValues: () => {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const s = sh._rows[row - 1 + i] || [];
        const line = [];
        for (let j = 0; j < nc; j++) line.push(s[col - 1 + j] === undefined ? '' : s[col - 1 + j]);
        out.push(line);
      }
      return out;
    } };
  },
  deleteRows(at, n) { this._rows.splice(at - 1, n); }
});
const run = (bookId, financeId) => {
  const sheets = [
    makeSheet('Registrations', [['UHID', 'Name'], ['AL1010', 'Santosh Kumar'], ['AL1011', 'A N Other']]),
    makeSheet('Appointments', [['Date', 'UHID'], ['01/05/2026', 'AL1010']]),
    makeSheet('Daily Register', [['Date', 'UHID', 'Procedure'], ['01/05/2026', 'AL1010', 'RCT']]),
    makeSheet('Signatures', [['Doctor', 'Signature'], ['Dr. A', 'data:image/png;base64,AAA']]),
    makeSheet('Doctor Details', [['Name', 'Phone'], ['Dr. A', '99999'], ['Dr. B', '88888']]),
    makeSheet('Treatments Master', [['Treatment', 'Fee'], ['RCT', '5000']]),
    makeSheet('Clinic Profile', [['Key', 'Value'], ['name', 'A Clinic']]),
    // A tab nobody put on either list. It holds records, so it goes.
    makeSheet('Some Tab Added Later', [['UHID', 'Thing'], ['AL1010', 'x']]),
    // The flat clinical tab: header is the clinic's column layout, kept.
    makeSheet('RCT', [['UHID', 'Tooth No.', 'Visit Date'], ['AL1010', '36', '01/05/2026']])
  ];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getId: () => bookId, getName: () => 'A Copy', getSheets: () => sheets }) },
    MAIN_PMS_SHEET_ID: /var MAIN_PMS_SHEET_ID = "([^"]+)"/.exec(gs)[1],
    PANEL_PMS_SHEET_ID: /var PANEL_PMS_SHEET_ID = "([^"]+)"/.exec(gs)[1],
    getFinanceSheetId: () => financeId,
    Logger: { log: () => {} },
    Math, String, Object, Array, console
  };
  vm.createContext(ctx);
  vm.runInContext(gs.slice(gs.indexOf('var TRIAL_KEEP_TABS = ['),
                           gs.indexOf('\n];', gs.indexOf('var TRIAL_KEEP_TABS = [')) + 3)
    + fn('trialClearTab_') + fn('emptyThisCopyForTrial')
    + '\nthis.go = emptyThisCopyForTrial;', ctx);
  return { res: ctx.go(), sheets };
};

const MAIN = /var MAIN_PMS_SHEET_ID = "([^"]+)"/.exec(gs)[1];
const PANEL = /var PANEL_PMS_SHEET_ID = "([^"]+)"/.exec(gs)[1];

// It must be impossible to run this on the clinic's own book.
const onMain = run(MAIN, MAIN);
eq('it refuses on the clinic\'s own book', onMain.res.success, false);
eq('and nothing is touched there',
   onMain.sheets.find(s => s._name === 'Registrations')._rows.length, 3);
eq('it refuses on the empanelled book too', run(PANEL, PANEL).res.success, false);
// A copy whose finance property still points at the clinic's file would
// otherwise have its money emptied out of the real one.
eq('and when the money is kept in another file', run('copy-1', 'somewhere-else').res.success, false);

const done = run('copy-1', 'copy-1');
eq('on a copy it runs', done.res.success, true);
const tab = (n) => done.sheets.find(s => s._name === n);
eq('the patients are gone', tab('Registrations')._rows.map(r => r[0]), ['UHID']);
eq('the appointments too', tab('Appointments')._rows.length, 1);
eq('and the day book', tab('Daily Register')._rows.length, 1);
eq('and the signatures', tab('Signatures')._rows.map(r => r[0]), ['Doctor']);
// The header row stays, so the trial writes into the clinic's own columns.
eq('each cleared tab keeps the columns it had',
   tab('RCT')._rows, [['UHID', 'Tooth No.', 'Visit Date']]);
// Default-deny: a tab nobody classified is cleared, not kept.
eq('a tab nobody listed is cleared rather than kept',
   tab('Some Tab Added Later')._rows.length, 1);
// And the setup survives.
eq('the doctors stay', tab('Doctor Details')._rows.length, 3);
eq('the fee schedule stays', tab('Treatments Master')._rows.length, 2);
eq('the clinic profile stays', tab('Clinic Profile')._rows.length, 2);
eq('it says how much it cleared and how much it kept',
   [done.res.cleared > 0, done.res.kept > 0], [true, true]);

// ── the page, opened ────────────────────────────────────────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const open = async (configUrl, query) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbtrial-'));
    fs.copyFileSync(builder.OUT, path.join(dir, 'index.html'));
    fs.writeFileSync(path.join(dir, 'config.js'),
      'window.KB_TRIAL_SCRIPT_URL = ' + JSON.stringify(configUrl) + ';\n');
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const asked = [];
    await page.route('**cdnjs.cloudflare.com/**', r => {
      const u = r.request().url();
      const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
      return r.fulfill({ status: 200, contentType: 'application/javascript',
        body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
    });
    await page.route('**script.google.com/**', r => {
      asked.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(String((e && e.message) || e)));
    await page.goto('file://' + path.join(dir, 'index.html') + (query || ''));
    await page.waitForTimeout(2200);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    return { page, text, asked, errs };
  };

  // Not connected yet: it says so and opens nothing.
  const blank = await open('');
  ok('with no backend set it says it is not connected',
     /is not connected yet/.test(blank.text), blank.text.slice(0, 160));
  eq('and asks the backend for nothing at all', blank.asked, []);
  ok('and does not draw the app', !/Dashboard/.test(blank.text), blank.text.slice(0, 160));
  await blank.page.close();

  // Connected: the app opens, and talks only to the trial's own backend.
  const TRIAL_URL = 'https://script.google.com/macros/s/TRIALONLYxxxxxxxxxxxxxxxxxxxx/exec';
  const live = await open(TRIAL_URL);
  ok('with a backend set the app opens', /Dashboard/.test(live.text), live.text.slice(0, 160));
  ok('and it is marked as the trial', /TRIAL|Trial/.test(live.text), live.text.slice(0, 200));
  ok('every request goes to the trial\'s own backend',
     live.asked.length > 0 && live.asked.every(u => u.indexOf('TRIALONLY') >= 0),
     JSON.stringify(live.asked.slice(0, 2)));
  eq('and none to the clinic\'s',
     live.asked.filter(u => clinicUrls.some(c => u.indexOf(c) >= 0)), []);
  eq('nothing threw', live.errs, []);
  await live.page.close();

  // The way back that must not exist.
  const back = await open(TRIAL_URL, '?clinic=main');
  ok('asking this page for the main clinic gets an unknown instance',
     /Unknown instance/.test(back.text), back.text.slice(0, 160));
  eq('and it asks nobody for anything', back.asked, []);
  await back.page.close();

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
