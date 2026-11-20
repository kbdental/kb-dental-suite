// "i do not find scope of inserting more than one template if I have done
//  more than one job in a single sitting"
//
// A second template could always be inserted -- pick another, press Insert
// again -- but nothing on the screen said so. The picker stayed on the
// template just used, so it read as a finished, one-shot action, and
// pressing Insert again silently appended the same sentence twice.
//
// And the lines were joined with a SPACE. That is the part that mattered
// beyond the form: the daily register, the case paper and the progress
// notes split a visit into a row per thing done BY LINE. Joined with a
// space there is one line, so a two-job visit could never be split into
// its two boxes however carefully those sheets were written. The feature
// was shipped and could not fire.
//
// One line per insert, then. The last block here runs the real splitter
// over the real note the form produces, so the two halves cannot drift.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const buildForm = (which) => {
  const ctx = { window: { LOGO_B64: '' }, atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    Uint8Array, TextDecoder, console, String, Object, Array };
  vm.createContext(ctx);
  const pick = (n) => { const a = html.indexOf('const ' + n + ' ='); return html.slice(a, html.indexOf(';\n', a) + 1); };
  vm.runInContext(pick('KB_FORM_BRIDGE_FOR') + pick('KB_FORM_TAIL_FOR') + pick('KB_FORM_TAIL')
    + pick('KB_FORM_BRIDGE') + pick('KB_FORM_NOTE_FIX') + pick(which[0])
    + html.slice(html.indexOf('function kbFormWithTail('), html.indexOf('function b64decode('))
    + html.slice(html.indexOf('function b64decode('), html.indexOf('function getCRMUrl('))
    + "\nthis.out = kbFormWithTail(b64decode(" + which[0] + "), '" + which[1] + "');", ctx);
  return ctx.out;
};

// The four forms with a template picker. All four get the same handling,
// and they name their notes box differently -- n3 or n4 -- so it is found
// by where it sits, not by what it is called.
['RCT_FORM_B64', 'IMP_SURGERY_B64', 'IMP_PROSTHETIC_B64', 'CROWN_BRIDGE_B64'].forEach(n => {
  const a = html.indexOf('const ' + n + ' =');
  const d = Buffer.from(html.slice(a, html.indexOf(';\n', a) + 1)
    .match(/"([A-Za-z0-9+/=]*)"/g).map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');
  ok(n.replace('_B64', '') + ' has the picker this covers', d.indexOf('cnTplInsertBtn') >= 0);
});
// Asserted against the DECODED script, which is what actually runs in the
// form -- the copy in index.html is an escaped string literal.
const NOTE_FIX = (() => {
  const a = html.indexOf('const KB_FORM_NOTE_FIX =');
  const lit = html.slice(a, html.indexOf('";\n', a) + 2);
  return new Function('return ' + lit.slice(lit.indexOf('=') + 1).trim().replace(/;$/, ''))();
})();
ok('the injected script parses on its own', (() => {
  try { new Function(NOTE_FIX.replace(/^<script>/, '').replace(/<\/script>\s*$/, '')); return true; }
  catch (e) { return false; }
})());
ok('the notes box is found by where it sits, not by its name',
   /card \? card\.querySelector\("textarea"\) : null/.test(NOTE_FIX));
ok('the form\'s own one-shot handler is taken over whole',
   /e\.stopImmediatePropagation\(\);/.test(NOTE_FIX));
ok('and each insert goes on its own line',
   /ta\.value = had \? \(had \+ "\\n" \+ text\) : text;/.test(NOTE_FIX));

(async () => {
  const file = path.join(REPO, 'test', '.tmp-multi-form.html');
  fs.writeFileSync(file, buildForm(['RCT_FORM_B64', 'rct']));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + file);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.postMessage({ type: 'KB_TEMPLATES', templates: [
    { situation: 'BMP', text: 'BMP done wrt {tooth}, {canals} canals.' },
    { situation: 'Obturation', text: 'Obturation completed wrt {tooth}.' },
    { situation: 'Crown Prep', text: 'Tooth preparation for crown done wrt {tooth}.' }
  ] }, '*'), null);
  await page.waitForTimeout(300);

  const tooth = (n) => page.evaluate(v => {
    const b = [...document.querySelectorAll('[data-n]')].find(x => x.dataset.n === v);
    if (b) b.click();
  }, String(n));
  const canals = () => page.evaluate(() => ['MB', 'DB', 'P'].forEach(c => {
    const b = document.querySelector('[data-canal="' + c + '"]'); if (b) b.click();
  }));
  const insert = async (i) => {
    await page.evaluate(v => {
      const s = document.getElementById('cnTplSelect');
      s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true }));
    }, i);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('cnTplInsertBtn').click());
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      notes: document.getElementById('n4').value,
      picker: document.getElementById('cnTplSelect').value,
      said: (document.getElementById('kbCnSaid') || {}).textContent || ''
    }));
  };

  await tooth(44); await canals();
  await page.waitForTimeout(400);

  const one = await insert(0);
  eq('the first job goes in', one.notes, 'BMP done wrt 44, 3 (MB, DB, P) canals.');
  // The whole complaint: nothing said a second was possible.
  eq('and the picker clears, so it plainly offers another', one.picker, '');
  ok('with a word saying a second job can be added too',
     /more than one job/i.test(one.said), one.said);

  const two = await insert(1);
  eq('the second goes on its OWN LINE, not onto the end of the first',
     two.notes, 'BMP done wrt 44, 3 (MB, DB, P) canals.\nObturation completed wrt 44.');
  ok('and it says how many are on the note', /2 on the note/.test(two.said), two.said);

  // Pressing Insert on the same template again used to double the sentence.
  const dup = await insert(1);
  eq('the same sentence twice is refused, not appended',
     dup.notes, 'BMP done wrt 44, 3 (MB, DB, P) canals.\nObturation completed wrt 44.');
  ok('and says why', /already in the notes/i.test(dup.said), dup.said);

  // But the same PROCEDURE on another tooth is a different job.
  await tooth(46);
  await page.waitForTimeout(350);
  const other = await insert(2);
  eq('the same template on another tooth is a job of its own', other.notes,
     'BMP done wrt 44, 3 (MB, DB, P) canals.\nObturation completed wrt 44.\n'
     + 'Tooth preparation for crown done wrt 46.');

  // A blank stays visible rather than going out as a silent gap.
  await page.evaluate(() => {
    const s = document.getElementById('cnTplSelect');
    s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('#cnTplFields [data-tpl-field]')]
      .find(x => x.dataset.tplField === 'canals');
    if (f) { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('cnTplInsertBtn').click());
  await page.waitForTimeout(250);
  const withBlank = await page.evaluate(() => document.getElementById('n4').value);
  ok('an unfilled blank stays visible as its token',
     withBlank.indexOf('{canals}') >= 0, withBlank);

  const finalNote = await page.evaluate(() => document.getElementById('n4').value);
  eq('nothing threw', errors, []);
  await browser.close();
  try { fs.unlinkSync(file); } catch (e) {}

  // ── and the sheets can now split what the form writes ────────────────
  // The real splitter, over the real note the real form just produced.
  {
    const fnOf = (name) => {
      const a = html.indexOf('function ' + name + '(');
      return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
    };
    const sctx = { String, Object, Array, Number, console };
    vm.createContext(sctx);
    vm.runInContext(fnOf('kbTeethInLine') + fnOf('kbSplitVisitRows')
      + '\nthis.split = kbSplitVisitRows;', sctx);
    const rows = sctx.split([{ date: '2026-11-20', toothNo: '44, 46',
      treatmentRendered: 'RCT, Crown Prep', clinicalNotes: finalNote }]);
    ok('the note the form writes splits into a row per job',
       rows.length >= 3, rows.length + ' rows');
    eq('each against the tooth its own line names',
       rows.map(r => r.toothNo).slice(0, 3), ['44', '44', '46']);
  }

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
