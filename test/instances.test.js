// One app, several books. An instance is a separate spreadsheet with its own
// Apps Script deployment, chosen by ?clinic=<id>. The property that matters is
// not that switching works — it is that it can never go wrong quietly: an
// unknown or unconfigured instance must refuse to load rather than fall
// through to the main clinic's book, and any non-main instance must say so on
// screen, because the app is otherwise identical.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(REPO, 'index.html');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// The app pulls React off a CDN this sandbox blocks, so the React tree never
// mounts here. Everything below is about the instance layer, which runs in a
// plain <script> before that — so it is fully exercised either way.
const state = (page) => page.evaluate(() => ({
  id: window.KB_INSTANCE_ID,
  label: window.KB_INSTANCE && window.KB_INSTANCE.label,
  url: window.KB_INSTANCE && window.KB_INSTANCE.scriptUrl,
  clinic: window.CLINIC && window.CLINIC.name,
  title: document.title,
  bodyText: document.body.innerText.slice(0, 400),
}));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await browser.newContext();

  const open = async (qs) => {
    const page = await ctx.newPage();
    await page.goto(FILE + qs);
    await page.waitForTimeout(350);
    const s = await state(page);
    await page.close();
    return s;
  };

  // --- default: unchanged behaviour, no query string needed ---------------
  const main = await open('');
  eq('no query string means the main clinic', main.id, 'main');
  eq('the main clinic keeps its own letterhead', main.clinic, 'K.B. Dental Clinic');
  ok('the main clinic has its backend URL', /script\.google\.com/.test(main.url || ''), main.url);
  eq('and its title is untouched', main.title, 'K.B. Dental Clinical Suite');

  const explicit = await open('?clinic=main');
  eq('asking for main explicitly is the same thing', explicit.url, main.url);

  // --- an unconfigured instance must REFUSE, not fall through -------------
  const emp = await open('?clinic=empanelled');
  ok('an instance with no backend does not load the app',
    /not connected yet/i.test(emp.bodyText), emp.bodyText);
  ok('it says plainly that nothing was touched',
    /never write into another clinic|not open/i.test(emp.bodyText), emp.bodyText);
  ok('it never adopts the main clinic\'s backend URL',
    !(emp.url && /script\.google\.com/.test(emp.url)), emp.url);
  ok('it offers a way back', /Back to the main clinic/i.test(emp.bodyText), emp.bodyText);

  // --- an unknown id must refuse too, not silently become main ------------
  const bogus = await open('?clinic=doesnotexist');
  ok('an unknown instance refuses to load',
    /Unknown instance/i.test(bogus.bodyText), bogus.bodyText);
  ok('an unknown instance does not become the main clinic',
    bogus.id !== 'main', bogus.id);
  ok('and says nothing was touched',
    /no data has been touched/i.test(bogus.bodyText), bogus.bodyText);

  // An id from a URL is untrusted text; it is echoed back, so it must not be
  // able to create elements. It appearing as inert text is the correct outcome.
  const hostile = await ctx.newPage();
  const fired = [];
  hostile.on('dialog', d => { fired.push('dialog'); d.dismiss(); });
  await hostile.goto(FILE + '?clinic=' + encodeURIComponent('<img src=x onerror=alert(1)>'));
  await hostile.waitForTimeout(350);
  const injected = await hostile.evaluate(() => ({
    imgs: document.querySelectorAll('img').length,
    text: document.body.innerText.slice(0, 200),
  }));
  await hostile.close();
  eq('a hostile instance id creates no elements', injected.imgs, 0);
  eq('and executes nothing', fired, []);
  ok('it is shown as plain text instead', /Unknown instance/.test(injected.text), injected.text);

  // --- the source contract the above relies on ----------------------------
  ok('SCRIPT_URL comes from the selected instance, not a literal',
    /const SCRIPT_URL = \(window\.KB_INSTANCE/.test(html));
  ok('no second hardcoded backend URL remains',
    (html.match(/script\.google\.com\/macros/g) || []).length === 1,
    (html.match(/script\.google\.com\/macros/g) || []).length);
  ok('a non-main instance carries a badge for the sidebar',
    /badge: "EMPANELLED"/.test(html));
  ok('the sidebar renders that badge',
    /window\.KB_INSTANCE\.badge && React\.createElement/.test(html));

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('INSTANCES — SEPARATE BOOKS, AND NO QUIET FALL-THROUGH');
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
