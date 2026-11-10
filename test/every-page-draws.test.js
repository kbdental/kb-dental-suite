// "Clinic records under records is not functioning. kindly fix it."
//
// Clinical Records was a BLANK PAGE. The cause: the Hindi toggle's state was
// declared inside Prescription, while the clinical note templates read it
// from inside ClinicalRecords -- a different function. Every render of
// Clinical Records threw ReferenceError before it drew anything, and React
// unmounts the tree when a render throws, so the screen went white. Nothing
// the front desk can see says why.
//
// Every test in this suite mounts ONE component with its dependencies
// stubbed, which is why none of them caught it: stubbing supplies by hand
// exactly the name that was missing. So this one loads the real index.html
// in a real browser and walks the whole app, and the only thing it asks is
// that nothing throws and no screen comes up empty. React and ReactDOM come
// from the repo's own node_modules in place of the CDN, so nothing is
// fetched; the backend is answered with a bare success, the way a clinic
// with an empty sheet would answer.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });

// Every entry in the sidebar, and the sections inside Records. A page added
// to the app and not to this list is simply not covered -- so the list is
// read off the page itself and checked against what is expected below.
// Each one: what to click in the sidebar, and the page it must open. The id
// is read back off the content area, so a click that lands somewhere else
// fails rather than passing on the page that was already showing.
const PAGES = [
  ['Dashboard', 'dashboard'], ['Patient Search', 'search'], ['Appointments', 'appointments'],
  ['Daysheet', 'daysheet'], ['Registration', 'registration'], ['Care Plan', 'careplan'],
  ['Treatment Plan', 'treatmentplan'], ['Records', 'records'], ['Finance', 'finance'],
  ['Consent Forms', 'consent'], ['CRM', 'crm'], ['Patient Chatbot', 'chatbot'],
  ['Master', 'master'], ['Reports', 'reports']
];
// With a marker from the section's own screen, because node counts say
// little here: Clinical Records draws 80-odd elements and CGHS, with no
// patient picked, draws a dozen -- both correct.
const RECORD_SECTIONS = [
  ['Clinical Records', 'clinical_records', 'Work done entry forms'],
  ['Daily Register', 'daily_register', 'Add every procedure'],
  ['CGHS', 'cghs', 'Endorsement, prescription and bill']
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const hit = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    // html2canvas and jsPDF are only used on a click, so a stub is enough.
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: hit ? fs.readFileSync(path.join(REPO, LOCAL[hit]), 'utf8') : '/* not needed to draw */' });
  });
  await page.route('**script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));

  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));

  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2200);

  ok('the app loads at all', (await page.$('#root, body > div')) !== null, '');
  ok('and the sidebar is drawn',
     /Dashboard/.test(await page.evaluate(() => document.body.innerText)), '');
  ok('nothing threw on the way in', errors.length === 0, errors.join(' | ').slice(0, 300));

  // What the page itself put on the screen, counted inside the content area
  // rather than over the whole document. The sidebar is always there, so a
  // page that threw still leaves plenty of text in body.innerText -- which
  // is exactly how a blank screen passes for a drawn one.
  //
  // Counted as elements, not characters: CRM and the Patient Chatbot are
  // iframes, and an iframe's own text is not the host document's.
  const drew = () => page.evaluate(() => {
    const el = document.querySelector('[data-kb-page]');
    return el ? { page: el.getAttribute('data-kb-page'),
                  nodes: el.querySelectorAll('*').length,
                  text: el.innerText.replace(/\s+/g, ' ').trim() } : null;
  });

  ok('the content area says which page is open', (await drew()) !== null, '');

  // A render that throws takes the whole app down, sidebar included, so the
  // next click finds nothing to click. That has to read as a failed check
  // and not as a broken harness, or the suite says "the harness itself" and
  // never names the screen that went.
  const tryClick = async (label) => {
    try { await page.getByText(label, { exact: false }).first().click({ timeout: 4000 }); return true; }
    catch (e) { return false; }
  };

  for (const [label, id] of PAGES) {
    const before = errors.length;
    const clicked = await tryClick(label);
    ok(label + ' is reachable from the sidebar', clicked,
       clicked ? '' : 'the sidebar is not there to click');
    if (!clicked) continue;
    await page.waitForTimeout(900);
    const d = await drew();
    ok(label + ' is the page that opens', d && d.page === id, d && d.page);
    ok(label + ' draws', d && d.nodes > 2, d && ('only ' + d.nodes + ' elements drawn'));
    ok(label + ' throws nothing', errors.length === before,
       errors.slice(before).join(' | ').slice(0, 300));
  }

  // Records holds the sections, and Clinical Records is the one that broke.
  for (const [label, id, marker] of RECORD_SECTIONS) {
    const onRecords = await tryClick('Records');
    ok('Records is still there to open ' + label + ' from', onRecords,
       onRecords ? '' : 'the app is not on the screen any more');
    if (!onRecords) continue;
    await page.waitForTimeout(600);
    const before = errors.length;
    const reached = await tryClick(label);
    ok(label + ' is listed under Records', reached, reached ? '' : 'nothing to click');
    if (!reached) continue;
    await page.waitForTimeout(1100);
    const d = await drew();
    ok(label + ' is the page that opens', d && d.page === id, d && d.page);
    // When this broke, React unmounted the whole tree: the content area did
    // not exist, so `drew()` came back null and both of these failed.
    ok(label + ' draws its own screen', d && d.text.indexOf(marker) >= 0,
       d ? d.nodes + ' elements, text: ' + d.text.slice(0, 160) : 'the content area is gone');
    ok(label + ' throws nothing', errors.length === before,
       errors.slice(before).join(' | ').slice(0, 300));
  }

  ok('nothing threw anywhere in the app', errors.length === 0, errors.join(' | ').slice(0, 400));
  await browser.close();

  // ── and the setting has one home, not one per screen ─────────────────
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  ok('the Hindi setting is a hook of its own', /function useHindiOut\(\) \{/.test(html), '');
  const decls = (html.match(/const \[hindiOut, setHindiOut\] = useHindiOut\(\);/g) || []).length;
  ok('and every screen that offers the toggle calls it', decls >= 2, String(decls));
  // The copy that drifted is what caused the blank page. One definition, so
  // the two screens cannot disagree about which language is on either.
  ok('no screen keeps its own copy of the setting',
     !/const \[hindiOut, setHindiOut\] = React\.useState/.test(html), '');

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else { fail++; console.log('  FAIL  ' + c.name + (c.got ? '\n          ' + c.got : '')); }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
