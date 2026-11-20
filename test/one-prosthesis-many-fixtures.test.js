// "how do we write the size of implant in this please tell or suggest how
//  will it be entered in case of bridge, as in full mouth also this
//  problem of entering has to be sorted out / for a full arch implant"
//
// The row is headed "one row per implant" and carries one Size box. But a
// bridge over 34-36 sits on TWO fixtures, at 34 and 36, with a pontic at
// 35 -- and a full arch on four to six, which in All-on-4 are rarely the
// same size, the distal ones being tilted and longer. Put the span on one
// row and there is one Size box for several fixtures, and a fixture
// implied at 35 where there is none.
//
// The form already treats the prosthesis as ONE thing: shade, type,
// material and crown type are recorded once, not per site. Only the span
// had nowhere to go. So:
//
//   the fixtures   one row each, each with its own site and size, which
//                  is what the heading always promised
//   the prosthesis its span, pontic and unit count, recorded once
//
// And {tooth} in a note about the prosthesis means the SPAN, because that
// is what the prosthesis covers.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const decode = (name) => {
  const a = html.indexOf('const ' + name + ' =');
  return Buffer.from(html.slice(a, html.indexOf(';\n', a) + 1)
    .match(/"([A-Za-z0-9+/=]*)"/g).map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');
};
const FORM = decode('IMP_PROSTHETIC_B64');

// ── it has to survive leaving the screen ───────────────────────────────
// A field that is typed and then lost on the next visit is worse than no
// field, so every path that carries the rest of the form carries this.
ok('the span boxes are saved with the form\'s other text',
   /class="ii" id="spanTeeth"/.test(FORM) && /class="ii" id="spanPontic"/.test(FORM)
   && /class="ii" id="spanUnits"/.test(FORM));
ok('and the span choice with its other button groups',
   /"abutMat", "spanType"\]/.test(FORM));
ok('it goes onto the saved record',
   /spanType:ga\('spanType'\),spanTeeth:gv\('spanTeeth'\),spanPontic:gv\('spanPontic'\),spanUnits:gv\('spanUnits'\)/.test(FORM));
ok('and comes back off it',
   /setGroup\('spanType',rec\.spanType\)/.test(FORM) && /setText\('spanPontic',rec\.spanPontic\)/.test(FORM));
ok('the work-done sheet prints it', /\["spanTeeth", "Teeth Covered"\]/.test(FORM));
ok('and the form\'s own summary shows it', /sv\('spanTeeth'\)/.test(FORM));
// Implant Surgery is one implant per site by design and is left alone.
ok('the surgery form is not given a span it has no use for',
   decode('IMP_SURGERY_B64').indexOf('spanTeeth') < 0);

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
  const file = path.join(REPO, 'test', '.tmp-arch-form.html');
  fs.writeFileSync(file, build('IMP_PROSTHETIC_B64', 'imp_prosth'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + file);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.postMessage({ type: 'KB_TEMPLATES', templates: [
    { situation: 'Implant Impression', text: 'Impression taken wrt {tooth}.' }] }, '*'));
  await page.waitForTimeout(250);

  // ── a full arch: four fixtures, one row each, each its own size ──────
  const SITES = [['34', '4.0 x 10 mm'], ['32', '3.75 x 13 mm'],
                 ['42', '3.75 x 13 mm'], ['44', '4.0 x 10 mm']];
  for (let i = 0; i < SITES.length; i++) {
    if (i) {
      await page.evaluate(() => {
        const a = [...document.querySelectorAll('button')].find(x => /Add Implant/i.test(x.textContent));
        if (a) a.click();
      });
      await page.waitForTimeout(200);
    }
    await page.evaluate(([t, sz, idx]) => {
      const btn = [...document.querySelectorAll('button[id^="tbtn_"]')][idx];
      btn.click();
      const all = [...document.querySelectorAll('#uJ button,#lJ button')];
      const x = all.find(y => y.textContent.trim() === t); if (x) x.click();
      document.getElementById('modalConfirm').click();
      const s = document.getElementById('size_' + btn.getAttribute('data-rowid'));
      if (s) s.value = sz;
    }, [SITES[i][0], SITES[i][1], i]);
    await page.waitForTimeout(200);
  }
  const rows = await page.evaluate(() => [...document.querySelectorAll('button[id^="tbtn_"]')].map(b => ({
    site: b.textContent.trim(),
    size: (document.getElementById('size_' + b.getAttribute('data-rowid')) || {}).value
  })));
  eq('four fixtures, one row each', rows.length, 4);
  eq('each against its own site', rows.map(r => r.site),
     ['Tooth 34', 'Tooth 32', 'Tooth 42', 'Tooth 44']);
  // The whole point: in All-on-4 the distal fixtures are tilted and longer,
  // and one Size box for the arch would lose that for good.
  eq('and each with its own size', rows.map(r => r.size),
     ['4.0 x 10 mm', '3.75 x 13 mm', '3.75 x 13 mm', '4.0 x 10 mm']);

  const toothBox = async () => {
    await page.evaluate(() => {
      const s = document.getElementById('cnTplSelect');
      s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true }));
      s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(350);
    return page.evaluate(() => {
      const f = [...document.querySelectorAll('#cnTplFields [data-tpl-field]')]
        .find(x => x.dataset.tplField === 'tooth');
      return f ? f.value : null;
    });
  };

  // Before any span is set, the note falls back to the fixture row.
  eq('with no span yet, the note still answers off the row', await toothBox(), '44');

  // ── full arch ────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const g = document.getElementById('spanType');
    const b = [...g.querySelectorAll('.btn')].find(x => /Full Arch .* Lower/i.test(x.textContent));
    if (b) b.click();
    document.getElementById('spanUnits').value = '12';
  });
  await page.waitForTimeout(250);
  eq('a full arch says so, rather than listing four fixtures',
     await toothBox(), 'full arch — lower');

  // ── a bridge ─────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const g = document.getElementById('spanType');
    const b = [...g.querySelectorAll('.btn')].find(x => x.textContent.trim() === 'Bridge');
    if (b) b.click();
    document.getElementById('spanTeeth').value = '34–36';
    document.getElementById('spanPontic').value = '35';
  });
  await page.waitForTimeout(250);
  eq('a bridge takes the span that was typed', await toothBox(), '34–36');

  await page.evaluate(() => document.getElementById('cnTplInsertBtn').click());
  await page.waitForTimeout(250);
  const note = await page.evaluate(() => {
    const t = [...document.querySelectorAll('textarea')].find(x => x.value.trim());
    return t ? t.value : '';
  });
  eq('and the record says what the prosthesis covers',
     note, 'Impression taken wrt 34–36.');

  // Clearing the span hands the question back to the fixture row rather
  // than leaving the last answer behind.
  await page.evaluate(() => {
    document.getElementById('spanTeeth').value = '';
    const g = document.getElementById('spanType');
    g.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
  });
  await page.waitForTimeout(250);
  eq('clearing the span gives the question back to the row', await toothBox(), '44');

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
