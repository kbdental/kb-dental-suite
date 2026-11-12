// "ONLY 2 doctors showing in doctor dropdown"
//
// Two, because the Implant Surgery form ships a <select id="pDoc"> with two
// names typed into its own markup. The app is supposed to replace them with
// Master's list; when that list never arrives the form keeps what it was
// built with and says nothing, so the box looks answered and the record is
// signed by whoever was written into the file.
//
// Why it never arrived: KB_LIST_CACHE cached an EMPTY list. [] is truthy, so
// one read that failed, or landed before the backend was ready, was kept for
// the rest of the session and never tried again. Every master list in the
// app shared that -- doctors, payment modes, treatments, all of them.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the cache, run ──────────────────────────────────────────────────────
{
  const ctx = { React: null, console };
  let calls = 0;
  let answer = { success: true, doctors: [] };
  const hooks = [];
  ctx.React = {
    useState: (init) => {
      const slot = { v: typeof init === 'function' ? init() : init };
      hooks.push(slot);
      return [slot.v, (x) => { slot.v = x; }];
    },
    useEffect: (fn) => { fn(); }
  };
  ctx.api = () => { calls++; return Promise.resolve(answer); };
  vm.createContext(ctx);
  vm.runInContext(cut('const KB_LIST_CACHE = {};', 'const usePaymentModes =')
    + '\nthis.useMasterList = useMasterList; this.CACHE = KB_LIST_CACHE;', ctx);

  const run = () => { hooks.length = 0; return ctx.useMasterList('getDoctorDetailsList', 'doctors'); };

  run();                              // first mount: the answer is empty
  eq('an empty answer is asked for once', calls, 1);
  // The whole bug in one line: the next mount must ask again.
  run();
  eq('and asked for again next time, not remembered as the answer', calls, 2);
  ok('nothing empty is kept in the cache', !ctx.CACHE['getDoctorDetailsList'],
     JSON.stringify(ctx.CACHE['getDoctorDetailsList']));

  answer = { success: true, doctors: [{ name: 'Dr. A' }, { name: 'Dr. B' }, { name: 'Dr. C' }] };
  run();
  eq('so a real answer is still reached', calls, 3);
}
{
  // But a real list IS kept, or every screen pays for the same six words.
  const ctx = { console };
  let calls = 0;
  ctx.React = {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn) => { fn(); }
  };
  ctx.api = () => { calls++; return Promise.resolve({ success: true, modes: ['Cash', 'UPI'] }); };
  vm.createContext(ctx);
  vm.runInContext(cut('const KB_LIST_CACHE = {};', 'const usePaymentModes =')
    + '\nthis.useMasterList = useMasterList; this.CACHE = KB_LIST_CACHE;', ctx);
  ctx.useMasterList('getPaymentModesList', 'modes');
  ctx.CACHE['getPaymentModesList'] = ['Cash', 'UPI'];   // as the fetch would
  ctx.useMasterList('getPaymentModesList', 'modes');
  eq('a list that has something in it is fetched once and shared', calls, 1);
}

// ── the forms do not pretend their built-in names are Master's ─────────
const fix = (() => {
  const a = html.indexOf('const KB_FORM_NOTE_FIX = ');
  const b = html.indexOf(';\n\n// Puts the tail in front of </body>', a);
  return JSON.parse(html.slice(a + 'const KB_FORM_NOTE_FIX = '.length, b));
})();
ok('the forms notice whether Master\'s list ever arrived',
   /window\.applyMasterDoctors = function\(list, selected\)\{[\s\S]{0,120}arrived = true/.test(fix), '');
ok('and say so beside the box when it did not',
   /Master's doctor list did not load/.test(fix), '');
ok('naming them as the form\'s own, not the clinic\'s',
   /form's built-in names/.test(fix), '');

// Which forms ship names of their own, so it is known what the fallback is.
const blobOf = (name) => {
  const i = html.indexOf('const ' + name + ' =');
  const j = html.indexOf('\n\n', i);
  const b64 = [...html.slice(i, j).matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join('');
  return Buffer.from(b64, 'base64').toString('utf8');
};
const shipped = (src) => {
  const m = /id="pDoc"[^>]*>([\s\S]*?)<\/select>/.exec(src);
  return m ? [...m[1].matchAll(/<option[^>]*>([^<]*)/g)].map(x => x[1].trim()) : [];
};
const impl = shipped(blobOf('IMP_SURGERY_B64'));
eq('Implant Surgery ships two names of its own — the two that showed', impl.length, 2);
ok('which is why it looked like a short list and not a missing one',
   impl.every(n => /^Dr\b/.test(n)), JSON.stringify(impl));

// ── and the sender still waits for the list ────────────────────────────
const senders = (html.match(/const sendDoctorsToForm = async \(uhid\) => \{[\s\S]*?\n  \};/g) || []);
eq('both senders exist', senders.length, 2);
senders.forEach((src, i) => ok('sender ' + (i + 1) + ' re-reads the list while it waits',
  /for \(let i = 0; i < 40; i\+\+\) \{[\s\S]*?const list = getDoctors\(\);/.test(src), ''));

(async () => {
  // Drawn: a form handed a real list shows all of it, not two.
  const ctx2 = {
    window: { LOGO_B64: '' }, atob: (x) => Buffer.from(x, 'base64').toString('binary'),
    Uint8Array, TextDecoder: require('util').TextDecoder, console
  };
  vm.createContext(ctx2);
  vm.runInContext(cut('const KB_FORM_TAIL = ', 'function getCRMUrl')
    .replace(/^const /gm, 'var ')
    .replace('function kbFormWithTail', 'var kbFormWithTail = function')
    .replace(/^function b64decode/m, 'var b64decode = function'), ctx2);

  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kbdoc-'));
  const file = path.join(dir, 'imp.html');
  fs.writeFileSync(file, ctx2.kbFormWithTail(ctx2.b64decode(
    (() => {
      const i = html.indexOf('const IMP_SURGERY_B64 =');
      const j = html.indexOf('\n\n', i);
      return [...html.slice(i, j).matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join('');
    })()), 'imp_surgery'));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String((e && e.message) || e)));
  await page.goto('file://' + file);
  await page.waitForTimeout(700);

  eq('before Master answers, the form shows what it was built with',
     await page.$$eval('#pDoc option', e => e.length), 2);

  await page.evaluate(() => {
    window.postMessage({ type: 'KB_DOCTORS',
      doctors: ['Dr. A Sharma', 'Dr. B Rao', 'Dr. C Iyer', 'Dr. D Khan', 'Dr. E Bose'],
      selected: 'Dr. C Iyer' }, '*');
  });
  await page.waitForTimeout(400);
  const opts = await page.$$eval('#pDoc option', e => e.map(o => o.textContent.trim()));
  eq('once it answers, every doctor is in the box', opts.length, 5);
  eq('and the one treating today is the one chosen',
     await page.$eval('#pDoc', e => e.value), 'Dr. C Iyer');
  ok('the built-in names are gone', opts.indexOf('Dr. Viveyk') < 0, JSON.stringify(opts));
  ok('and nothing warns, because the list did arrive',
     !(await page.$('#kbwdDocWarn')), '');
  eq('nothing threw', errs, []);
  await browser.close();

  // ── and the app actually sends it, with no patient loaded ────────────
  // This is what kept the list out of the forms. sendDoctorsToForm was
  // called from inside sendPatientToForm, which returns early when there is
  // no patient -- so a form opened blank, or opened before a patient was
  // picked, never received Master's list and kept the names in its own
  // markup. Who works at the clinic does not depend on who is in the chair.
  const LOCAL = {
    'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
    'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
  };
  const DOCTORS = ['Dr. A Mittel', 'Dr. B Malik', 'Dr. C Sharma', 'Dr. D Taneja',
    'Dr. E Apoorva', 'Dr. F Singh', 'Dr. G Mathur', 'Dr. H Gogia', 'Dr. I Mittel']
    .map(n => ({ name: n, phone: '', email: '', role: 'Doctor' }));
  const app = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const p3 = await app.newPage({ viewport: { width: 1500, height: 1050 } });
  await p3.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
  });
  await p3.route('**script.google.com/**', r => {
    const body = r.request().postData() || r.request().url();
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(/getDoctorDetailsList/.test(body)
        ? { success: true, doctors: DOCTORS } : { success: true }) });
  });
  const appErrs = [];
  p3.on('pageerror', e => appErrs.push(String((e && e.message) || e)));
  await p3.goto('file://' + path.join(REPO, 'index.html'));
  await p3.waitForTimeout(2200);
  await p3.getByText('Records', { exact: false }).first().click();
  await p3.waitForTimeout(600);
  await p3.getByText('Clinical Records', { exact: false }).first().click();
  await p3.waitForTimeout(1000);
  await p3.getByText('Root Canal Work Done', { exact: false }).first().click();
  await p3.waitForTimeout(900);
  const blankBtn = p3.locator('button', { hasText: /Open Blank Form/ }).first();
  ok('a form can be opened with no patient', await blankBtn.count() > 0, '');
  if (await blankBtn.count()) await blankBtn.click();
  await p3.waitForTimeout(4000);
  let inForm = [];
  try { inForm = await p3.frameLocator('iframe').locator('#pDoc option').allTextContents(); }
  catch (e) { inForm = ['(no frame)']; }
  eq('every doctor in Master reaches the form, with no patient loaded', inForm.length, 9);
  ok('and they are Master\'s names, not the form\'s own',
     inForm.indexOf('Dr. A Mittel') >= 0 && inForm.indexOf('Dr. Viveyk') < 0, JSON.stringify(inForm));
  eq('nothing threw in the app', appErrs, []);
  await app.close();

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
