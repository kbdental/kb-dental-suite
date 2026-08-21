// Checks the two compliance questions on the Daily Register.
//
// "Initial Assessment Done" and "Care Plan Documented" used to be answered
// "Yes" by the backend whenever the app omitted them, which no caller sent —
// so every row claimed both without anyone having said so. The app now asks,
// and must send whatever was answered, including nothing.
//
// This mounts the real RegisterConfirm component out of index.html with a
// stubbed api(), drives the buttons, and asserts what reaches the wire.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');

// The component and its two dependencies, lifted verbatim from index.html.
function extractComponent() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const from = html.indexOf('const REG_FIELD = {');
  const to = html.indexOf('function App()', from);
  if (from < 0 || to < 0) throw new Error('could not locate RegisterConfirm in index.html');
  return html.slice(from, to);
}

const HARNESS = `<!doctype html>
<html><body><div id="root"></div>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
</body></html>`;

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // React from a CDN will not load in a sandbox with no network, so serve the
  // copies Playwright already has on disk via a route stub instead.
  // Resolved by path, not require.resolve: React 18 ships UMD builds but does
  // not list them under "exports", so a subpath require fails.
  const reactPath = path.join(REPO, 'node_modules/react/umd/react.production.min.js');
  const reactDomPath = path.join(REPO, 'node_modules/react-dom/umd/react-dom.production.min.js');
  await page.route('**/react@18/umd/**', r =>
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(reactPath, 'utf8') }));
  await page.route('**/react-dom@18/umd/**', r =>
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(reactDomPath, 'utf8') }));

  await page.setContent(HARNESS);
  await page.waitForFunction(() => window.React && window.ReactDOM);

  await page.evaluate(src => {
    // Minimum the component closes over.
    window.T = '#0078B4'; window.TL = '#DCF4FB'; window.BORDER = '#e5e5e0'; window.BGS = '#f5f5f0';
    window.toISODate = d => d.toISOString().slice(0, 10);
    window.__sent = null;
    window.api = (action, payload) => { window.__sent = { action, payload }; return Promise.resolve({ success: true }); };
    // eslint-disable-next-line no-eval
    (0, eval)(src + ';window.RegisterConfirm = RegisterConfirm;');
  }, extractComponent());

  async function mount() {
    await page.evaluate(() => {
      window.__sent = null;
      const root = document.getElementById('root');
      root.innerHTML = '';
      window.__root = ReactDOM.createRoot(root);
      window.__root.render(React.createElement(window.RegisterConfirm, {
        entry: { uhid: 'AL0777', patientName: 'Test Patient', age: '42', date: '2026-08-21',
                 procedureDone: 'Scaling', toothNo: '', workDone: 'Full mouth scaling.',
                 operatingDoctor: 'Dr. Manika Mittel' },
        onCancel: () => {}, onSaved: () => { window.__saved = true; }
      }));
    });
    await page.waitForTimeout(250);
  }

  // Clicks the labelled button under a question, then confirms.
  async function answerAndConfirm(answers) {
    await mount();
    for (const [question, choice] of Object.entries(answers)) {
      const clicked = await page.evaluate(({ question, choice }) => {
        const blocks = Array.from(document.querySelectorAll('div'));
        const label = blocks.find(d => d.textContent.trim() === question &&
          d.style.textTransform === 'uppercase');
        if (!label) return false;
        const group = label.parentElement;
        const btn = Array.from(group.querySelectorAll('button'))
          .find(b => b.textContent.trim() === choice);
        if (!btn) return false;
        btn.click();
        return true;
      }, { question, choice });
      if (!clicked) throw new Error(`could not find "${choice}" under "${question}"`);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Add to Register').click();
    });
    await page.waitForTimeout(250);
    return page.evaluate(() => window.__sent);
  }

  const checks = [];
  const eq = (name, got, want) => checks.push({ name, ok: got === want, got, want });

  // 1. Untouched — both must go as empty strings, not "Yes", and not absent.
  let sent = await answerAndConfirm({});
  eq('untouched -> initialAssessment is ""', sent.payload.initialAssessment, '');
  eq('untouched -> carePlanDocumented is ""', sent.payload.carePlanDocumented, '');
  checks.push({ name: 'untouched -> both keys are present on the payload',
    ok: 'initialAssessment' in sent.payload && 'carePlanDocumented' in sent.payload,
    got: Object.keys(sent.payload).filter(k => /Assessment|carePlan/.test(k)).join(','), want: 'both' });

  // 2. Answered Yes / No — each must travel as given.
  sent = await answerAndConfirm({ 'Initial Assessment Done': 'Yes', 'Care Plan Documented': 'No' });
  eq('answered Yes -> "Yes"', sent.payload.initialAssessment, 'Yes');
  eq('answered No  -> "No"', sent.payload.carePlanDocumented, 'No');

  // 3. "No" must survive rather than being treated as unset.
  sent = await answerAndConfirm({ 'Initial Assessment Done': 'No' });
  eq('answered No alone -> "No"', sent.payload.initialAssessment, 'No');

  // 4. Answer then take it back — must return to unanswered.
  sent = await answerAndConfirm({ 'Initial Assessment Done': 'Yes' });
  eq('sanity: Yes stuck before retracting', sent.payload.initialAssessment, 'Yes');
  sent = await answerAndConfirm({ 'Initial Assessment Done': 'Yes' });
  await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('div'))
      .find(d => d.textContent.trim() === 'Initial Assessment Done' && d.style.textTransform === 'uppercase');
    Array.from(label.parentElement.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Not answered').click();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'Add to Register').click());
  await page.waitForTimeout(250);
  sent = await page.evaluate(() => window.__sent);
  eq('retracted to Not answered -> ""', sent.payload.initialAssessment, '');

  // 5. The rest of the entry still goes with it.
  eq('still sends the action', sent.action, 'saveToDailyRegister');
  eq('still sends workDone', sent.payload.workDone, 'Full mouth scaling.');

  await browser.close();

  console.log('\n' + '='.repeat(72));
  console.log('DAILY REGISTER COMPLIANCE QUESTIONS');
  console.log('='.repeat(72));
  let fail = 0;
  for (const c of checks) {
    if (!c.ok) fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
  }
  if (errors.length) { console.log('\n  JS errors: ' + errors.join(' | ')); fail += errors.length; }
  console.log('='.repeat(72));
  console.log(`  ${checks.length - fail} passed, ${fail} failed`);
  console.log('='.repeat(72) + '\n');
  process.exit(fail ? 1 : 0);
})();
