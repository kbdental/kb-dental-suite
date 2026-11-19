// "Need a tooth grid in / Bleeding on Probing / Gum Recession / Furcation /
//  Mobility / Parafunctional Habits / Parafunctional / Wasting Disease /
//  Abrasion / Attrition / Abfraction / Erosion"
//
// These findings are always ABOUT teeth. Answered into a free "Area..."
// box they got written "36", "tooth 36", "#36" and "36,37" by four people
// in one week -- four spellings of one answer, none of which can be
// counted, charted, or carried onto a sheet later.
//
// Two things here are easy to get wrong and both are silent:
//
//   the stored list   the clinic pressed "Load the clinic's findings" long
//                     before this existed, so its nine rows say "present".
//                     The stored list beats the seed. Ship only a seed
//                     change and nothing happens on the clinic's screen,
//                     and the only remedy would be re-loading the list --
//                     throwing away every finding edited since.
//
//   fast taps         three teeth tapped quickly on an iPad land in one
//                     React batch. Each tap computing its answer from the
//                     same stale list means two of the three teeth are
//                     silently dropped.
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

// ── which findings get the grid ────────────────────────────────────────
const ctx = { String, Array, Object, console };
vm.createContext(ctx);
vm.runInContext('const CLINICAL_TOOTH_KEYS = '
  + /const CLINICAL_TOOTH_KEYS = (\[[\s\S]*?\]);/.exec(html)[1] + ';\n'
  + fnOf('clinicalExamIsToothGrid')
  + '\nthis.grid = clinicalExamIsToothGrid; this.KEYS = CLINICAL_TOOTH_KEYS;', ctx);

eq('the nine findings that are about teeth', ctx.KEYS.slice().sort(),
   ['abfraction', 'abrasion', 'attrition', 'bleedingProbing', 'erosion', 'furcation',
    'gumRecession', 'mobility', 'parafunctional']);

ok('a row set to the grid in Master gets it', ctx.grid({ kind: 'teeth', key: 'anything' }));
// The clinic's own stored rows, saved as plain present rows before the
// grid existed. This is the case that matters today.
ok('and so does a stored present row that is one of the nine',
   ctx.grid({ kind: 'present', key: 'mobility' }));
ok('a present row with no kind written at all counts too',
   ctx.grid({ key: 'erosion' }));
ok('an ordinary present finding keeps its Area box',
   !ctx.grid({ kind: 'present', key: 'swelling' }));
// A finding somebody deliberately reshaped stays what they made it.
['healthy', 'check', 'text'].forEach(k =>
  ok('a finding turned into "' + k + '" is not dragged onto a grid',
     !ctx.grid({ kind: k, key: 'mobility' })));
ok('and nothing at all does not throw', !ctx.grid(null));
ok('nor a row with no key', !ctx.grid({ kind: 'present' }));

// ── drawn, stored and printed ──────────────────────────────────────────
ok('the care plan picks the grid row for those findings',
   /const Row = healthy \? HRow : \(clinicalExamIsToothGrid\(r\) \? ToothPRow : PRow\);/.test(html));
ok('a grid row is still listed under Present where a screen splits by kind',
   /kind === "present" \? \(k === "present" \|\| k === "teeth"\) : k === kind/.test(html));
ok('Master offers the grid as a shape',
   /\["teeth",\s*"Present, on a tooth grid"\]/.test(html));
// It writes into `area`, which is the slot a present answer already uses,
// so every sheet that prints findings keeps working untouched.
ok('the grid writes into the same slot a present answer always used',
   /return \{ \.\.\.base, area: next\.join\(", "\) \};/.test(html));
// The batching fix. Without it the setter takes a value computed from a
// stale read and two of three taps vanish.
ok('the plan\'s setter takes a function of what is already stored',
   /\[k\]: typeof v === "function" \? v\(p\[k\]\) : v/.test(html));
ok('and the grid uses that form rather than a value',
   /onChange\(prev => \{/.test(html));

// The seed, for a clinic loading the list fresh.
{
  const seed = /const CLINICAL_EXAM_SEED = (\[[\s\S]*?\n\]);/.exec(html);
  ok('there is a seed to read', !!seed);
  const rows = new Function('return ' + seed[1])();
  const teeth = rows.filter(r => r[2] === 'teeth').map(r => r[3]).sort();
  eq('the seed puts the same nine on the grid', teeth, ctx.KEYS.slice().sort());
}

// ── in the real app, off the clinic's OWN stored list ──────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
// Every one of the nine stored the old way, plus an ordinary present
// finding that must NOT get a grid.
const FINDINGS = [
  ['Gum Assessment', 'Bleeding on Probing', 'present', 'bleedingProbing'],
  ['Gum Assessment', 'Gum Recession', 'present', 'gumRecession'],
  ['Gum Assessment', 'Furcation', 'present', 'furcation'],
  ['Gum Assessment', 'Mobility', 'present', 'mobility'],
  ['Parafunctional Habits', 'Parafunctional', 'present', 'parafunctional'],
  ['Wasting Disease', 'Abrasion', 'present', 'abrasion'],
  ['Wasting Disease', 'Attrition', 'present', 'attrition'],
  ['Wasting Disease', 'Abfraction', 'present', 'abfraction'],
  ['Wasting Disease', 'Erosion', 'present', 'erosion'],
  ['Extra-Oral Check', 'Swelling', 'present', 'swelling']
].map(r => ({ section: r[0], finding: r[1], kind: r[2], key: r[3] }));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* */' });
  });
  await page.route('**script.google.com/**', r => {
    const body = r.request().postData() || r.request().url();
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(/getClinicalExaminationList/.test(body)
        ? { success: true, findings: FINDINGS } : { success: true }) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2300);
  await page.getByText('Care Plan', { exact: false }).first().click();
  await page.waitForTimeout(1400);
  for (const label of ['2', 'Examination', 'Next']) {
    const l = page.locator('button', { hasText: new RegExp('^' + label) }).first();
    if (await l.count()) { await l.click().catch(() => {}); await page.waitForTimeout(700); break; }
  }

  // Helpers that work on the finding's own row, by its label.
  await page.evaluate(() => {
    window.__box = (name) => {
      const l = [...document.querySelectorAll('div')].filter(d => d.firstElementChild
        && d.firstElementChild.textContent.trim() === name);
      return l.length ? l[l.length - 1].parentElement : null;
    };
    window.__tick = (name) => {
      const b = window.__box(name); if (!b) return false;
      const cb = b.querySelector('input[type=checkbox]');
      if (cb && !cb.checked) cb.click();
      return true;
    };
    window.__teeth = (name) => {
      const b = window.__box(name); if (!b) return -1;
      return [...b.querySelectorAll('button')].filter(x => /^\d{2}$/.test(x.textContent.trim())).length;
    };
    // The LABEL row only. The grid's own 32 buttons are in a sibling, and
    // reading the whole box drags every tooth number in after the answer.
    window.__reads = (name) => {
      const l = [...document.querySelectorAll('div')].filter(d => d.firstElementChild
        && d.firstElementChild.textContent.trim() === name);
      return l.length ? l[l.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
    };
  });

  // Before ticking there is no grid: the question is "is it present".
  eq('an unticked finding shows no grid', await page.evaluate(() => window.__teeth('Mobility')), 0);

  for (const name of ['Mobility', 'Parafunctional', 'Attrition', 'Swelling']) {
    await page.evaluate(n => window.__tick(n), name);
    await page.waitForTimeout(220);
  }
  // A full FDI grid is 32 teeth.
  for (const name of ['Mobility', 'Parafunctional', 'Attrition']) {
    eq('ticking ' + name + ' opens a full tooth grid',
       await page.evaluate(n => window.__teeth(n), name), 32);
  }
  // And the one that is not about teeth is left alone.
  eq('an ordinary present finding still gets no grid',
     await page.evaluate(() => window.__teeth('Swelling')), 0);

  // Three taps in ONE tick, the way they arrive from a fast hand.
  await page.evaluate(() => {
    const b = window.__box('Mobility');
    ['36', '37', '46'].forEach(t => {
      const btn = [...b.querySelectorAll('button')].find(x => x.textContent.trim() === t);
      if (btn) btn.click();
    });
  });
  await page.waitForTimeout(400);
  eq('three quick taps keep all three teeth',
     await page.evaluate(() => window.__reads('Mobility')),
     'MobilityPresent ✓Tooth 36, 37, 46');

  // Tapping a tooth again takes it off.
  await page.evaluate(() => {
    const b = window.__box('Mobility');
    [...b.querySelectorAll('button')].find(x => x.textContent.trim() === '37').click();
  });
  await page.waitForTimeout(300);
  eq('and tapping one again takes it off',
     await page.evaluate(() => window.__reads('Mobility')),
     'MobilityPresent ✓Tooth 36, 46');

  // Each finding keeps its own teeth.
  await page.evaluate(() => {
    const b = window.__box('Attrition');
    [...b.querySelectorAll('button')].find(x => x.textContent.trim() === '11').click();
  });
  await page.waitForTimeout(300);
  eq('one finding\'s teeth do not leak into another',
     [await page.evaluate(() => window.__reads('Attrition')),
      await page.evaluate(() => window.__reads('Mobility'))],
     ['AttritionPresent ✓Tooth 11', 'MobilityPresent ✓Tooth 36, 46']);

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
})();
