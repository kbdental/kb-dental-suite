// "all data entered in the form is not coming at the notes point and this
//  was earlier also noted and asked for correction"
//
// Pick a clinical note template on a form and it shows a box per blank. Only
// {tooth} and whatever the form's own short alias table happened to name were
// filled; the rest came up empty with the answers sitting on screen a few
// inches above, and the dentist retyped them.
//
// Every form shipped its own cnResolveValue(), each looking up ONE element by
// id through a hand-written alias table. {irrigants} missed because the alias
// said "irrigant". {canals} missed because no element has that id. The
// working lengths missed because they live in a table, not a labelled row.
//
// The replacement keeps each form's table -- it encodes real knowledge --
// then does what a person does when the id does not match: reads the LABELS.
// "Irrigants Used" answers {irrigants} in any form, with no table to keep.
// Anything still unknown is left blank on purpose: these are editable boxes,
// and a blank beats a confident wrong guess in a medico-legal note.
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

// ── it reaches every form, RCT included ─────────────────────────────────
ok('the fix is written once', /const KB_FORM_NOTE_FIX = "/.test(html), '');
const injector = cut('function kbFormWithTail(html, formId) {', '\n}');
ok('and every form gets it, with or without a tail',
   /let add = KB_FORM_NOTE_FIX;/.test(injector), injector.slice(0, 200));
ok('RCT is built through the injector too',
   /kbFormWithTail\(b64decode\(RCT_FORM_B64\), "rct"\)/.test(html), '');

const ctx = {
  window: { LOGO_B64: 'data:image/png;base64,AAA' },
  atob: (x) => Buffer.from(x, 'base64').toString('binary'),
  Uint8Array, TextDecoder: require('util').TextDecoder, console
};
vm.createContext(ctx);
vm.runInContext(cut('const KB_FORM_TAIL = ', 'function getCRMUrl')
  .replace(/^const /gm, 'var ')
  .replace('function kbFormWithTail', 'var kbFormWithTail = function')
  .replace(/^function b64decode/m, 'var b64decode = function'), ctx);

const build = (name, fid) => {
  const i = html.indexOf('const ' + name + ' =');
  const j = html.indexOf('\n\n', i);
  const b64 = [...html.slice(i, j).matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join('');
  return ctx.kbFormWithTail(ctx.b64decode(b64), fid);
};

// The closing tag is the trap. A literal </script> inside the injected
// string ends the page's own script block; escaped twice, the tag written
// into the form is "<\/script>", which never closes anything and swallows
// the rest of the document. It must be a real tag in the built form, and
// never a real tag in index.html.
const builtRct = build('RCT_FORM_B64', 'rct');
ok('the built form has a real closing tag', builtRct.indexOf('<\\/script>') < 0,
   builtRct.slice(-120));
ok('and ends where it should', /<\/script>\s*<\/body>\s*<\/html>\s*$/.test(builtRct),
   builtRct.slice(-80));

(async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kbnote-'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });

  // ── RCT, the form it was reported on ──────────────────────────────────
  const file = path.join(dir, 'rct.html');
  fs.writeFileSync(file, builtRct);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String((e && e.message) || e)));
  await page.goto('file://' + file);
  await page.waitForTimeout(600);

  ok('the better resolver is installed',
     await page.evaluate(() => typeof window.cnResolveValue === 'function'), '');

  // Fill it the way the dentist had: canals picked, lengths measured, files
  // used, irrigants and instrument chosen.
  await page.evaluate(() => {
    const first = (sel) => { const e = document.querySelector(sel); if (e) e.click(); };
    document.querySelectorAll('[data-canal]').forEach((c, i) => { if (i < 3) c.click(); });
    first('#irrigS .btn');
    first('#rotSys .btn');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelectorAll('[id^="wl_"]').forEach((el, i) => {
      el.value = String(17 + i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.querySelectorAll('[id^="sG_"]').forEach(g => { const b = g.querySelector('.btn'); if (b) b.click(); });
  });
  await page.waitForTimeout(300);

  const canals = await page.evaluate(() => document.querySelectorAll('[id^="wl_"]').length);
  eq('three canals are on the form to read', canals, 3);

  const ask = (toks) => page.evaluate(t => {
    const out = {};
    t.forEach(k => { try { out[k] = window.cnResolveValue(k) || ''; } catch (e) { out[k] = 'ERR ' + e.message; } });
    return out;
  }, toks);

  const got = await ask(['canals', 'Canal', 'WL', 'size', 'MAF', 'irrigants', 'instrument', 'system', 'n']);

  // The one that was plainly on screen and plainly blank: the alias said
  // "irrigant", the template says {irrigants}.
  eq('a plural token finds the singular field', got['irrigants'], 'NaOCl 3%');
  // The printed sheet writes it as a count, so the note should too.
  eq('the canal count reads the way the sheet prints it', got['canals'], '3 (MB, ML, DB)');
  // ...while {Canal}=({WL}/{MAF}) wants the canals themselves, not the count.
  eq('and the canals themselves are not the count', got['Canal'], 'MB, ML, DB');
  eq('the working lengths come off the table', got['WL'], 'MB 17mm, ML 18mm, DB 19mm');
  ok('and so do the files used', /MB S1/.test(got['size']), got['size']);
  eq('the file sequence answers MAF too', got['MAF'], got['size']);
  ok('the instrument is found', got['instrument'].length > 0, got['instrument']);
  eq('and a token the form knows under another name', got['system'], got['instrument']);
  // Not everything can be known, and guessing into a clinical note is worse
  // than a blank the dentist fills in.
  eq('a token nothing answers is left blank', got['n'], '');

  // A token matching no label at all must not grab a nearby row.
  const stray = await ask(['zzzzz', 'somethingNobodyRecords']);
  eq('an unknown token takes nothing', [stray['zzzzz'], stray['somethingNobodyRecords']], ['', '']);
  eq('nothing threw on RCT', errs, []);
  await page.close();

  // ── and it works on a form built quite differently ────────────────────
  for (const [blob, fid, prep, token, want] of [
    ['SCALING_FORM_B64', 'scaling',
     () => { const e = document.querySelector('#instrumentUsed .btn'); if (e) e.click(); },
     'instrument', true],
    ['PATHOLOGY_FORM_B64', 'pathology',
     () => {
       const rows = document.querySelectorAll('.fr');
       for (const r of rows) {
         const l = r.querySelector('.fl');
         if (l && /type of sample/i.test(l.textContent)) {
           const b = r.querySelector('.btn'); if (b) { b.click(); return; }
           const i = r.querySelector('input'); if (i) { i.value = 'Swab'; i.dispatchEvent(new Event('input', { bubbles: true })); }
         }
       }
     },
     'sample', true]
  ]) {
    const f = path.join(dir, fid + '.html');
    fs.writeFileSync(f, build(blob, fid));
    const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const e2 = [];
    p2.on('pageerror', e => e2.push(String((e && e.message) || e)));
    await p2.goto('file://' + f);
    await p2.waitForTimeout(500);
    ok(fid + ': the resolver is installed too',
       await p2.evaluate(() => typeof window.cnResolveValue === 'function'), '');
    await p2.evaluate(prep);
    await p2.waitForTimeout(250);
    const v = await p2.evaluate(t => { try { return window.cnResolveValue(t) || ''; } catch (e) { return 'ERR'; } }, token);
    ok(fid + ': {' + token + '} is answered from the form', want ? v.length > 0 : v === '', JSON.stringify(v));
    eq(fid + ': nothing threw', e2, []);
    await p2.close();
  }

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
