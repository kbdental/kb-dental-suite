// "in both screen shots can you see i selected range and it is coming
//  1 teeth only"
//
// An implant row can cover several sites -- a bridge over 34, 35 and 36 is
// ONE row, labelled "34-36" on the button it was picked with. The row keeps
// all of them in data-teeth, and ALSO keeps data-tooth, the first one, from
// before a row could hold more than one.
//
// The form's own resolver read data-tooth. So a three-tooth span went into
// the clinical note as "34": the note said an impression was taken of one
// tooth while three were in the mouth, and nothing on the screen disagreed,
// because the row above still read "34-36".
//
// The summary on the very same form already preferred data-teeth. The note
// did not. That is the whole bug.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const NOTE_FIX = (() => {
  const a = html.indexOf('const KB_FORM_NOTE_FIX =');
  const lit = html.slice(a, html.indexOf('";\n', a) + 2);
  return new Function('return ' + lit.slice(lit.indexOf('=') + 1).trim().replace(/;$/, ''))();
})();
ok('a span is read off the row, not off its first tooth',
   /function fromImplantRow\(tok\)/.test(NOTE_FIX));
// The form's own answer for {tooth} is the first tooth and is NOT empty, so
// asked first it would win every time and the fix would do nothing.
ok('and it is asked before the form\'s own table, which would otherwise win',
   NOTE_FIX.indexOf('try { v = fromImplantRow(tok); if (v) return v; } catch (e) {}')
   < NOTE_FIX.indexOf('try { if (orig) v = String(orig(tok)'));
ok('a row holding one tooth is left to the form to answer',
   /if \(many\.length < 2\) return "";/.test(NOTE_FIX));

const build = (name, id) => {
  const ctx = { window: { LOGO_B64: '' }, atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    Uint8Array, TextDecoder, console, String, Object, Array };
  vm.createContext(ctx);
  const pick = (n) => { const a = html.indexOf('const ' + n + ' ='); return html.slice(a, html.indexOf(';\n', a) + 1); };
  vm.runInContext(pick('KB_FORM_BRIDGE_FOR') + pick('KB_FORM_TAIL_FOR') + pick('KB_FORM_TAIL')
    + pick('KB_FORM_BRIDGE') + pick('KB_FORM_NOTE_FIX') + pick(name)
    + html.slice(html.indexOf('function kbFormWithTail('), html.indexOf('function b64decode('))
    + html.slice(html.indexOf('function b64decode('), html.indexOf('function getCRMUrl('))
    + "\nthis.out = kbFormWithTail(b64decode(" + name + "), '" + id + "');", ctx);
  return ctx.out;
};

(async () => {
  const file = path.join(REPO, 'test', '.tmp-span-form.html');
  fs.writeFileSync(file, build('IMP_PROSTHETIC_B64', 'imp_prosth'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const errors = [];

  const run = async (teeth) => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await page.goto('file://' + file);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.postMessage({ type: 'KB_TEMPLATES', templates: [
      { situation: 'Implant Impression', text: 'Impression taken wrt {tooth}.' }] }, '*'));
    await page.waitForTimeout(250);
    const row = await page.evaluate((ts) => {
      const btn = document.querySelector('button[id^="tbtn_"]');
      btn.click();
      const all = [...document.querySelectorAll('#uJ button,#lJ button')];
      ts.forEach(t => { const x = all.find(y => y.textContent.trim() === t); if (x) x.click(); });
      document.getElementById('modalConfirm').click();
      const b = document.querySelector('button[id^="tbtn_"]');
      return { label: b.textContent.trim(), teeth: b.getAttribute('data-teeth'),
               tooth: b.getAttribute('data-tooth') };
    }, teeth);
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const s = document.getElementById('cnTplSelect');
      s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const f = [...document.querySelectorAll('#cnTplFields [data-tpl-field]')]
        .find(x => x.dataset.tplField === 'tooth');
      return f ? f.value : null;
    });
    await page.evaluate(() => document.getElementById('cnTplInsertBtn').click());
    await page.waitForTimeout(250);
    const note = await page.evaluate(() => {
      const t = [...document.querySelectorAll('textarea')].find(x => x.value.trim());
      return t ? t.value : '';
    });
    await page.close();
    return { row, box, note };
  };

  // A run of three. This is the one that was reported.
  {
    const r = await run(['34', '35', '36']);
    eq('the row keeps all three, and its first as well',
       [r.row.teeth, r.row.tooth], ['34,35,36', '34']);
    eq('and the note takes the span, not the first of it', r.box, '34–36');
    eq('so the record says what was done', r.note, 'Impression taken wrt 34–36.');
    eq('which is word for word what the row says', r.box, r.row.label);
  }
  // Two sites with a gap: a run would be wrong, so the row lists them.
  {
    const r = await run(['34', '36']);
    eq('a gapped pair is listed rather than spanned', r.box, '34, 36');
    eq('and reaches the note that way', r.note, 'Impression taken wrt 34, 36.');
  }
  // One tooth: the form already answered this correctly and must keep doing so.
  {
    const r = await run(['34']);
    eq('one tooth still answers as one tooth', r.box, '34');
    eq('with no "Tooth " prefix dragged in off the button label',
       r.note, 'Impression taken wrt 34.');
  }

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
