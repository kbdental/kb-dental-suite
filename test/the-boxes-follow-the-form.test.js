// "the details entered in the form are not coming so in the templates when
//  we insert notes there is no tooth nuber, no details get recorded"
//  "see step 4 empty"
//
// The boxes under a chosen clinical note template were resolved ONCE, at
// the instant the template was chosen, by each form's own change handler.
//
// Choose the template first -- which is what you do working down the page,
// because the picker is at the bottom of it -- and every box is empty,
// because nothing on the form has been answered yet. Fill the form in
// afterwards and they stay empty: nothing re-reads them, and choosing the
// same template again fires no change event, so there was no way to
// refresh them at all. What got inserted was the template with its blanks
// still in braces -- "BMP done wrt {tooth}. {canals} canals." -- no tooth
// number, no detail, and nothing on screen saying why.
//
// The boxes follow the form now. What this file holds is the two rules
// that keep that from becoming its own bug:
//
//   never over typed text   a dentist who corrects a box has said
//                           something the form does not know
//   but clear a stale one   a value read off the form that the form no
//                           longer gives is worse than an empty box
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── every form gets it, not just the one it was reported on ────────────
ok('the fix lives in the tail every work-done form is given',
   /const KB_FORM_NOTE_FIX = "/.test(html));
ok('and RCT is given it too, which has a tail of its own',
   /let add = KB_FORM_NOTE_FIX;/.test(html));
{
  const forms = (html.match(/kbFormWithTail\(b64decode\(/g) || []).length;
  ok('and it reaches every form that is built through the injector',
     forms >= 18, forms + ' forms');
}

// ── the form, built exactly as the app builds it ───────────────────────
const buildForm = () => {
  const ctx = { window: { LOGO_B64: '' }, atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    Uint8Array, TextDecoder, console, String, Object, Array };
  vm.createContext(ctx);
  const pick = (n) => { const a = html.indexOf('const ' + n + ' ='); return html.slice(a, html.indexOf(';\n', a) + 1); };
  vm.runInContext(pick('KB_FORM_BRIDGE_FOR') + pick('KB_FORM_TAIL_FOR') + pick('KB_FORM_TAIL')
    + pick('KB_FORM_BRIDGE') + pick('KB_FORM_NOTE_FIX') + pick('RCT_FORM_B64')
    + html.slice(html.indexOf('function kbFormWithTail('), html.indexOf('function b64decode('))
    + html.slice(html.indexOf('function b64decode('), html.indexOf('function getCRMUrl('))
    + "\nthis.out = kbFormWithTail(b64decode(RCT_FORM_B64), 'rct');", ctx);
  return ctx.out;
};
const formHtml = buildForm();
ok('the built form carries the resolver', formHtml.indexOf('cnResolveValue = function') >= 0);

const TPL = { situation: 'BMP', category: 'RCT',
  text: 'BMP done wrt {tooth}. {canals} canals. Instrument: {instrument}. '
      + 'Irrigated with {irrigants}. Medicament: {medicament}.' };

(async () => {
  const file = path.join(REPO, 'test', '.tmp-rct-form.html');
  fs.writeFileSync(file, formHtml);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + file);
  await page.waitForTimeout(600);
  await page.evaluate(t => window.postMessage({ type: 'KB_TEMPLATES', templates: [t] }, '*'), TPL);
  await page.waitForTimeout(300);

  const read = () => page.evaluate(() =>
    [...document.querySelectorAll('#cnTplFields [data-tpl-field]')].map(f => [f.dataset.tplField, f.value]));
  const chooseTemplate = () => page.evaluate(() => {
    const s = document.getElementById('cnTplSelect');
    s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const fillForm = () => page.evaluate(() => {
    const tb = [...document.querySelectorAll('[data-n]')].find(x => x.dataset.n === '44');
    if (tb) tb.click();
    ['MB', 'DB', 'P'].forEach(c => {
      const b = document.querySelector('[data-canal="' + c + '"]'); if (b) b.click();
    });
    const clickIn = (id, re) => {
      const g = document.getElementById(id); if (!g) return;
      const b = [...g.querySelectorAll('.btn')].find(x => new RegExp(re, 'i').test(x.textContent));
      if (b) b.click();
    };
    clickIn('rotSys', 'ProTaper'); clickIn('irrigS', 'NaOCl'); clickIn('icM2', 'Calcipex|Calcium|CaOH');
  });

  // ── the order that was broken ────────────────────────────────────────
  await chooseTemplate();
  await page.waitForTimeout(250);
  eq('choosing the template on an empty form gives empty boxes',
     (await read()).map(x => x[1]), ['', '', '', '', '']);

  await fillForm();
  await page.waitForTimeout(600);
  const after = Object.fromEntries(await read());
  eq('and filling the form in afterwards now fills them',
     [after.tooth, after.canals], ['44', '3 (MB, DB, P)']);
  ok('including the ones read off the form\'s own pill groups',
     after.instrument && after.irrigants && after.medicament, JSON.stringify(after));

  // What the dentist actually ends up with.
  await page.evaluate(() => document.getElementById('cnTplInsertBtn').click());
  await page.waitForTimeout(250);
  const note = await page.evaluate(() => document.getElementById('n4').value);
  eq('and the inserted note carries the detail, not braces', note,
     'BMP done wrt 44. 3 (MB, DB, P) canals. Instrument: ProTaper Gold. '
     + 'Irrigated with NaOCl 3%. Medicament: Calcipex.');
  ok('with nothing left unfilled', note.indexOf('{') < 0, note);
  // Inserting clears the picker on purpose, so it plainly offers the next
  // job -- see more-than-one-job-in-a-sitting.test.js. The boxes go with
  // it, so they are chosen afresh for what follows.
  eq('and inserting clears the picker, boxes and all',
     await page.evaluate(() => document.querySelectorAll('#cnTplFields [data-tpl-field]').length), 0);
  await chooseTemplate();
  await page.waitForTimeout(300);
  eq('choosing it again brings the boxes back, filled from the form',
     (Object.fromEntries(await read())).canals, '3 (MB, DB, P)');

  // ── what the dentist types is theirs ─────────────────────────────────
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('#cnTplFields [data-tpl-field]')]
      .find(x => x.dataset.tplField === 'irrigants');
    f.value = 'NaOCl 5.25% and 17% EDTA';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  // Something else on the form moves, which re-reads every box.
  await page.evaluate(() => {
    const b = document.querySelector('[data-canal="ML"]'); if (b) b.click();
  });
  await page.waitForTimeout(600);
  const typed = Object.fromEntries(await read());
  eq('a box the dentist typed in is not written over',
     typed.irrigants, 'NaOCl 5.25% and 17% EDTA');
  eq('while the rest keep following the form',
     typed.canals, '4 (MB, DB, P, ML)');

  // ── a stale answer is worse than an empty box ────────────────────────
  await page.evaluate(() => {
    ['MB', 'DB', 'P', 'ML'].forEach(c => {
      const b = document.querySelector('[data-canal="' + c + '"]'); if (b) b.click();
    });
  });
  await page.waitForTimeout(600);
  const cleared = Object.fromEntries(await read());
  eq('taking the canals off the form empties the box it filled', cleared.canals, '');
  eq('but what was typed survives even that',
     cleared.irrigants, 'NaOCl 5.25% and 17% EDTA');

  // ── and a way to say "no, take the form's answer" ────────────────────
  ok('there is a refill button beside Insert',
     await page.evaluate(() => !!document.getElementById('kbCnRefill')));
  eq('it sits next to Insert, not somewhere else on the page',
     await page.evaluate(() => {
       const b = document.getElementById('kbCnRefill');
       return !!(b && b.previousElementSibling && b.previousElementSibling.id === 'cnTplInsertBtn');
     }), true);
  await page.evaluate(() => {
    const b = document.querySelector('[data-canal="MB"]'); if (b) b.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('kbCnRefill').click());
  await page.waitForTimeout(300);
  const refilled = Object.fromEntries(await read());
  eq('refilling takes the form\'s answer over the typed one',
     refilled.irrigants, 'NaOCl 3%');
  eq('and the rest with it', refilled.canals, '1 (MB)');
  // Having been refilled, a box is the form's again, not the dentist's.
  await page.evaluate(() => {
    const b = document.querySelector('[data-canal="DB"]'); if (b) b.click();
  });
  await page.waitForTimeout(600);
  eq('and it goes on following the form afterwards',
     (Object.fromEntries(await read())).canals, '2 (MB, DB)');

  eq('nothing threw', errors, []);
  await browser.close();
  try { fs.unlinkSync(file); } catch (e) {}

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
})();
