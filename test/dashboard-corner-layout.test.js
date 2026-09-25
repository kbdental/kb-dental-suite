// The follow-ups pill and the Birthdays card are both corner widgets. They
// used to position themselves independently — the pill dropped 42px when there
// were birthdays, which landed it on the first name of the open card. This
// renders the real dashboard markup and checks their boxes never overlap,
// collapsed or open.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });

// Pull the two components out of index.html and run them for real, rather than
// reimplementing their markup here (which would test nothing).
function sliceFn(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('not found: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error('end not found after ' + startMarker);
  return html.slice(a, b);
}

const birthdaySrc = sliceFn('function BirthdayCorner({ birthdays }) {', '\nfunction ');
const rowSrc = sliceFn('  // One right-anchored row holding both corner widgets.', '  /*#__PURE__*/React.createElement("div", {\n    style: {\n      fontSize: 13,');

const page_html = `
<div id="root"></div>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // React/ReactDOM from the repo's node_modules, so nothing is fetched.
  const react = fs.readFileSync(path.join(REPO, 'node_modules/react/umd/react.production.min.js'), 'utf8');
  const reactDom = fs.readFileSync(path.join(REPO, 'node_modules/react-dom/umd/react-dom.production.min.js'), 'utf8');

  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: react });
  await page.addScriptTag({ content: reactDom });

  await page.evaluate(({ birthdaySrc, rowSrc }) => {
    window.BGS = '#F8FAFC'; window.T = '#0891B2'; window.TM = '#67E8F9'; window.TL = '#E0F7FA';
    const BGS = window.BGS, T = window.T, TM = window.TM, TL = window.TL;
    window.CLINIC = { name: 'K.B. Dental Clinic' };
    eval(birthdaySrc);
    window.BirthdayCorner = BirthdayCorner;

    const birthdays = [
      { name: 'Devyani Gupta', uhid: 'AA0503', mobile: '9811111111' },
      { name: 'Amita Jain', uhid: 'AG0811', mobile: '9812222222' },
      { name: 'Manish Gupta', uhid: 'AD0622', mobile: '9813333333' },
      { name: 'Amit parihar', uhid: 'AB0806', mobile: '9814444444' },
      { name: 'Krishan singh', uhid: 'AC0101', mobile: '9815555555' },
    ];
    const birthdaysLoading = false, followUpsLoading = false, followUpCount = 112;
    const onNavigate = () => {};

    const rowEl = eval('(' + rowSrc.trim().replace(/,\s*$/, '') + ')');
    ReactDOM.createRoot(document.getElementById('root')).render(rowEl);
  }, { birthdaySrc, rowSrc });

  await page.waitForTimeout(400);

  const boxes = async () => page.evaluate(() => {
    const pill = Array.from(document.querySelectorAll('button'))
      .find(b => /follow-up/.test(b.textContent));
    const cake = Array.from(document.querySelectorAll('button'))
      .find(b => /today/.test(b.textContent));
    const card = Array.from(document.querySelectorAll('div'))
      .find(d => /Birthdays Today/.test(d.textContent) && d.style.width === '230px');
    const r = el => el ? el.getBoundingClientRect() : null;
    return { pill: r(pill), cake: r(cake), card: r(card) };
  });

  const overlaps = (a, b) => !!a && !!b &&
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // --- collapsed: pill beside the cake button ------------------------------
  let b = await boxes();
  ok('the follow-ups pill renders', !!b.pill, b.pill);
  ok('the birthdays button renders', !!b.cake, b.cake);
  ok('collapsed: they do not overlap', !overlaps(b.pill, b.cake),
    { pill: b.pill, cake: b.cake });
  ok('collapsed: they share the same top edge (a row, not stacked)',
    b.pill && b.cake && Math.abs(b.pill.top - b.cake.top) < 2,
    { pillTop: b.pill && b.pill.top, cakeTop: b.cake && b.cake.top });
  ok('collapsed: the pill sits to the LEFT of the birthdays button',
    b.pill && b.cake && b.pill.right <= b.cake.left + 1,
    { pillRight: b.pill && b.pill.right, cakeLeft: b.cake && b.cake.left });

  // --- open: the card expands and must still not be covered ---------------
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button'))
      .find(x => /today/.test(x.textContent)).click();
  });
  await page.waitForTimeout(300);
  b = await boxes();
  ok('opening shows the birthdays card', !!b.card, b.card);
  ok('open: the pill does not cover the card (the reported bug)',
    !overlaps(b.pill, b.card), { pill: b.pill, card: b.card });
  ok('open: the pill is still left of the card',
    b.pill && b.card && b.pill.right <= b.card.left + 1,
    { pillRight: b.pill && b.pill.right, cardLeft: b.card && b.card.left });

  // The first name must be fully visible — that is what was obscured.
  const firstNameClear = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div'))
      .find(d => d.textContent === 'Devyani Gupta');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, topmostIsTheName: el.contains(mid) || mid === el };
  });
  ok('open: the first birthday name is not behind anything',
    firstNameClear && firstNameClear.topmostIsTheName, firstNameClear);

  ok('nothing stays pinned below the other (no stacked top offset)',
    !/top: \(birthdays\.length>0 \? 58 : 16\)/.test(html));
  ok('no uncaught page errors', errors.length === 0, errors);

  await page.screenshot({
    path: '/tmp/claude-0/-home-user-kb-dental-suite/a8ab906e-fa14-50f4-bd87-ced6ef7fc38f/scratchpad/corner-open.png',
    clip: { x: 900, y: 0, width: 500, height: 420 },
  });

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('DASHBOARD CORNER — FOLLOW-UPS PILL BESIDE BIRTHDAYS, NEVER OVER IT');
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
