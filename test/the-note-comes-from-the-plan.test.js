// "in daily register entry if we are directly entering in daily register on
//  choosing the procedure done can the corresponding template drop down
//  appear so we can select an move forward"
//
// A register entry made at the desk had a free textarea for Work Done, so
// the note was typed from memory -- which is how one treatment ends up
// worded five different ways across a year of records. The notes are
// written once, in Master, and the clinical note plan already says which of
// them each treatment is made of. The CGHS prescription has offered them
// for a while; the register, where most entries are actually made, did not.
//
// Plan Normal here, Plan CGHS there, off ONE function -- because two
// screens answering the same question in two places is the thing that
// drifts.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const fnOf = (name) => {
  const a = html.indexOf('function ' + name + '(');
  return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
};

// ── one function, two screens ──────────────────────────────────────────
ok('there is one place that answers "what does the plan say this is made of"',
   /function clinicalNoteOptions\(treatment, templates, plan, which, vals\)/.test(html), '');
eq('and it is the only place the plan rows are filtered by which plan',
   (html.match(/filter\(r => r && String\(r\.plan\) === which\)/g) || []).length, 1);
ok('the CGHS prescription asks it for Plan CGHS',
   /clinicalNoteOptions\(nameOf\(x\), templates, plan, "CGHS"/.test(html), '');
ok('and the daily register for Plan Normal',
   /clinicalNoteOptions\(nProcedureDone, noteTpls, notePlan, "Normal"/.test(html), '');
// Both lists are read through the master-list cache, not fetched per screen.
ok('the note library is a cached master list', /const useNoteTemplates = \(\) => useMasterList/.test(html), '');
ok('and so is the plan', /const useNotePlan = \(\) => useMasterList/.test(html), '');

// ── the function itself ────────────────────────────────────────────────
const ctx = { String, Object, Array, console };
vm.createContext(ctx);
vm.runInContext(fnOf('cghsFillTokens') + fnOf('cghsTemplateFor')
  + 'const CGHS_TPL_STOP = ' + /const CGHS_TPL_STOP = (\[[\s\S]*?\]);/.exec(html)[1] + ';\n'
  + fnOf('clinicalTemplateRefs') + fnOf('clinicalNoteOptions')
  + '\nthis.opts = clinicalNoteOptions;', ctx);

const TPL = [
  { situation: 'RCT - Access Opening', concise: 'Access opening done wrt {tooth} under LA.',
    comprehensive: 'Access cavity prepared wrt {tooth} under 2% lignocaine, pulp extirpated.',
    hindi: '', text: 'Access cavity prepared wrt {tooth}.' },
  { situation: 'RCT - Obturation', concise: 'Obturation completed wrt {tooth}.',
    comprehensive: 'Obturation completed wrt {tooth} by lateral condensation.',
    hindi: 'रूट कैनाल भरा गया।', text: 'Obturation completed wrt {tooth}.' },
  { situation: 'Scaling', concise: 'Ultrasonic scaling done.',
    comprehensive: 'Full-mouth ultrasonic scaling and polishing done.', hindi: '',
    text: 'Full-mouth ultrasonic scaling and polishing done.' }
];
const PLAN = [
  { plan: 'Normal', treatment: 'Root Canal Treatment',
    templates: 'RCT - Access Opening → RCT - Obturation' },
  { plan: 'CGHS', treatment: 'Root Canal Treatment', templates: 'RCT - Obturation' },
  { plan: 'Normal', treatment: 'Scaling', templates: 'Scaling' }
];

let o = ctx.opts('Root Canal Treatment', TPL, PLAN, 'Normal', { tooth: '36' });
eq('the plan\'s steps are offered, at both lengths and in Hindi where it exists',
   o.map(x => x.label),
   ['RCT - Access Opening · Type 1 (Concise)', 'RCT - Access Opening · Type 2 (Comprehensive)',
    'RCT - Obturation · Type 1 (Concise)', 'RCT - Obturation · Type 2 (Comprehensive)',
    'RCT - Obturation · Hindi']);
eq('with the tooth already written in', o[0].text, 'Access opening done wrt 36 under LA.');
// The same treatment, the other plan: a different list. That is the whole
// reason the plan is keyed by plan.
eq('the other plan is a different answer, for the same treatment',
   ctx.opts('Root Canal Treatment', TPL, PLAN, 'CGHS', { tooth: '36' }).map(x => x.label),
   ['RCT - Obturation · Type 1 (Concise)', 'RCT - Obturation · Type 2 (Comprehensive)',
    'RCT - Obturation · Hindi']);
eq('nothing named, nothing offered', ctx.opts('', TPL, PLAN, 'Normal', {}).length, 0);
// A treatment the plan has not been filled in for still offers something.
eq('a treatment the plan does not list falls back to the name it matches',
   ctx.opts('Scaling - Full Mouth', TPL, [], 'Normal', {}).map(x => x.label),
   ['Type 1 (Concise)', 'Type 2 (Comprehensive)']);
eq('and a treatment nothing matches offers an empty list, not a blank box',
   ctx.opts('Orthodontic Retainer', TPL, [], 'Normal', {}).length, 0);

// ── drawn, in the real app ─────────────────────────────────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1150 } });
  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
  });
  await page.route('**script.google.com/**', r => {
    const body = r.request().postData() || r.request().url();
    let out = { success: true };
    if (/getClinicalNoteTemplates/.test(body)) out = { success: true, templates: TPL };
    else if (/getClinicalNotePlan/.test(body)) out = { success: true, rows: PLAN };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2200);
  await page.getByText('Records', { exact: false }).first().click();
  await page.waitForTimeout(700);
  await page.getByText('Daily Register', { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('button', { hasText: /New Entry/ }).first().click();
  await page.waitForTimeout(900);

  const noteSel = () => page.locator('select[data-kb-reg-note]');
  eq('with nothing named yet there is no dropdown to puzzle over', await noteSel().count(), 0);

  // What the plan is filed under, offered while the procedure is typed --
  // so what is typed matches, and the notes below actually appear.
  const suggestions = await page.$$eval('#kbRegProcedures option', e => e.map(o => o.value));
  eq('the procedure box suggests what the plan and the library know',
     suggestions, ['Root Canal Treatment', 'Scaling', 'RCT - Access Opening',
                   'RCT - Obturation']);

  await page.locator('input[placeholder="e.g. 26, 46"]').first().fill('36');
  await page.locator('input[list="kbRegProcedures"]').first().fill('Root Canal Treatment');
  await page.waitForTimeout(350);
  eq('naming the procedure brings up its notes', await noteSel().count(), 1);
  eq('which are the ones Plan Normal lists for it',
     await noteSel().first().evaluate(e => Array.from(e.options).map(o => o.textContent)),
     ['Pick the note from the plan (5)…',
      'RCT - Access Opening · Type 1 (Concise)', 'RCT - Access Opening · Type 2 (Comprehensive)',
      'RCT - Obturation · Type 1 (Concise)', 'RCT - Obturation · Type 2 (Comprehensive)',
      'RCT - Obturation · Hindi']);

  const box = () => page.locator('textarea[placeholder="Describe what was done..."]').first().inputValue();
  await noteSel().first().selectOption({ index: 1 });
  await page.waitForTimeout(200);
  eq('picking one writes it into Work Done, with the tooth filled in',
     await box(), 'Access opening done wrt 36 under LA.');
  // Two things done in one visit build the note up. Replacing would throw
  // away the first, and a register entry is the record of the whole visit.
  await noteSel().first().selectOption({ index: 4 });
  await page.waitForTimeout(200);
  eq('picking a second adds it on its own line rather than replacing the first',
     await box(),
     'Access opening done wrt 36 under LA.\nObturation completed wrt 36 by lateral condensation.');
  ok('and the dropdown goes back to its prompt, so the same note can be picked twice',
     await noteSel().first().inputValue() === '', '');

  // Still a textarea: a dropdown that replaced typing would take away the
  // last word on the clinic's own record.
  await page.locator('textarea[placeholder="Describe what was done..."]').first()
    .fill('Access opening done wrt 36. Patient advised to return in 2 days.');
  await page.waitForTimeout(150);
  eq('what is picked can still be typed over',
     await box(), 'Access opening done wrt 36. Patient advised to return in 2 days.');

  // A procedure the plan does not know leaves the box alone and offers
  // nothing, rather than an empty dropdown.
  await page.locator('input[list="kbRegProcedures"]').first().fill('Consultation');
  await page.waitForTimeout(300);
  eq('a procedure nothing matches offers no dropdown at all', await noteSel().count(), 0);

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
