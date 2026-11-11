// "Can you see the discrepencies in the sheets they should be alike" /
// "There is no complete tab also"
//
// Three different endings were in use.
//
//   RCT              Complete header, Work Done Sheet, Work Done Summary.
//                    The sheet drew from what is IN THE FORM, so it always
//                    had something to show. The summary was a note ending in
//                    a signature line.
//   Implant x2,      The same two tabs, but the sheet read ONLY the record
//   Crown & Bridge   already saved to Google Sheets -- so a form filled in
//                    and not yet saved said "No work done sheet saved for
//                    this patient yet" while RCT, at the same moment on the
//                    same patient, drew a sheet. Their summary was a grid of
//                    every field, with no signature line.
//   The other 14     Nothing at all. No Complete header, no tabs, no work
//                    done sheet. Their only print button printed the
//                    data-entry screen.
//
// Now there is one ending, written once in index.html and added to each form
// as its page is built. The fourteen get the whole thing; the three wizards
// get the engine and a bridge onto the panes they already have, keeping
// their richer saved-record sheet where there is one. RCT is untouched: it
// is the shape everything else was matched to.
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

// ── the ending is written once, not eighteen times ──────────────────────
ok('there is one shared ending', /const KB_FORM_TAIL = "/.test(html), '');
ok('and one bridge for the forms that already had panes',
   /const KB_FORM_BRIDGE = "/.test(html), '');

// Build the pages the way the app does, with the real injector.
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

const blobOf = (name) => {
  const i = html.indexOf('const ' + name + ' =');
  const j = html.indexOf('\n\n', i);
  return [...html.slice(i, j).matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join('');
};

// Every form, its id as the app knows it, and the document code its sheet
// prints in the corner. Read against the app's own tables below, so a form
// added to one and not the other is a failure rather than a silent gap.
const FLAT = [
  ['RESTORATION_FORM_B64', 'restoration', 'Restoration', 'WD-05'],
  ['ORTHODONTICS_FORM_B64', 'orthodontics', 'Orthodontics', 'WD-06'],
  ['ORTHOPROGRESS_FORM_B64', 'orthoProgress', 'Ortho Progress', 'WD-07'],
  ['DENTURE_FORM_B64', 'denture', 'Denture', 'WD-08'],
  ['PEDO_FORM_B64', 'pedo', 'Pedo', 'WD-09'],
  ['TMJOINT_FORM_B64', 'tmJoint', 'TM Joint', 'WD-10'],
  ['PATHOLOGY_FORM_B64', 'pathology', 'Pathology', 'WD-11'],
  ['RADIOLOGY_FORM_B64', 'radiology', 'Radiology', 'WD-12'],
  ['RADIOGRAPH_FORM_B64', 'radiograph', 'Radiograph', 'WD-13'],
  ['LOCALANESTHESIA_FORM_B64', 'localAnesthesia', 'Local Anesthesia', 'WD-14'],
  ['INTRAORAL_FORM_B64', 'intraOral', 'Intra Oral Scan', 'WD-15'],
  ['SCALING_FORM_B64', 'scaling', 'Scaling', 'WD-16'],
  ['MINORSURGERY_FORM_B64', 'minorSurgery', 'Minor Surgery', 'WD-17'],
  ['LABLOG_FORM_B64', 'labLog', 'Lab Log', 'WD-18']
];
const WIZARDS = [
  ['IMP_SURGERY_B64', 'imp_surgery', 'Implant Surgery', 'WD-02'],
  ['IMP_PROSTHETIC_B64', 'imp_prosth', 'Implant Prosthetic', 'WD-03'],
  ['CROWN_BRIDGE_B64', 'crown', 'Crown & Bridge', 'WD-04']
];

eq('fourteen forms had no ending and now get the whole one', FLAT.length, 14);
eq('and three had one that did not match', WIZARDS.length, 3);

// Both tables in the page have to agree with this one, or a form gets the
// wrong name printed on its sheet.
const tbl = (name) => new Function(cut('const ' + name + ' = {', '\n};') + '\n};\nreturn ' + name + ';')();
const TAIL_FOR = tbl('KB_FORM_TAIL_FOR'), BRIDGE_FOR = tbl('KB_FORM_BRIDGE_FOR');
eq('every single-page form is in the table', FLAT.filter(f => !TAIL_FOR[f[1]]).map(f => f[1]), []);
eq('under the right name and code',
   FLAT.filter(f => TAIL_FOR[f[1]][0] !== f[2] || TAIL_FOR[f[1]][1] !== f[3]).map(f => f[1]), []);
eq('every wizard is in the bridge table', WIZARDS.filter(f => !BRIDGE_FOR[f[1]]).map(f => f[1]), []);
// RCT is the shape the rest were matched to, so it must not be rewritten.
ok('RCT is left alone', !TAIL_FOR.rct && !BRIDGE_FOR.rct, '');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kbforms-'));

  // Fills a form the way a dentist starts one: the patient, a few buttons,
  // a few boxes. Then reads back what the two tabs say.
  const openAndFill = async (name, fid) => {
    const file = path.join(dir, fid + '.html');
    fs.writeFileSync(file, ctx.kbFormWithTail(ctx.b64decode(blobOf(name)), fid));
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String((e && e.message) || e)));
    await page.goto('file://' + file);
    await page.waitForTimeout(500);
    await page.fill('#pName', 'Santosh Kumar').catch(() => {});
    await page.fill('#pId', 'AL1010').catch(() => {});
    await page.fill('#pAge', '54').catch(() => {});
    const btns = await page.$$('.card .btn');
    for (let k = 0; k < Math.min(4, btns.length); k++) await btns[k].click({ timeout: 1500 }).catch(() => {});
    const boxes = await page.$$('.card input[type=text]');
    for (let k = 0; k < Math.min(2, boxes.length); k++) await boxes[k].fill('Recorded').catch(() => {});
    await page.waitForTimeout(400);
    return { page, errs };
  };
  // A single-page form now carries the wizards' step bar: the form, then a
  // tick and Summary. The ending lives on the Summary step, as it does on
  // RCT, so the form itself is not pushed down the page by it.
  const toSummary = async (page) => {
    const bar = await page.$('.kbwd-steps .tab[data-kbwd-step=summary]');
    if (bar) { await bar.click(); await page.waitForTimeout(350); }
    return !!bar;
  };
  const textOf = (page, sel) =>
    page.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');

  // ── the fourteen that had nothing ─────────────────────────────────────
  for (const [name, fid, label, code] of FLAT) {
    const { page, errs } = await openAndFill(name, fid);

    const steps = await page.$$eval('.kbwd-steps .tab', e => e.map(x => x.textContent.trim()));
    ok(fid + ': has a step bar like the wizards',
       steps.length === 2 && /Summary$/.test(steps[1]), JSON.stringify(steps));
    ok(fid + ': whose first step is the form itself',
       steps[0] && steps[0].indexOf(label + ' Record') >= 0, JSON.stringify(steps));
    ok(fid + ': ending in a tick, not a number', /\u2713/.test(steps[1] || ''), JSON.stringify(steps));
    // Entry is untouched: the form is what opens, not the summary.
    ok(fid + ': the form is what opens',
       await page.evaluate(() => {
         const m = document.querySelector('.main'), k = document.getElementById('kbwd');
         return !!m && m.style.display !== 'none' && !!k && k.style.display === 'none';
       }), '');
    ok(fid + ': and the Summary step opens the ending', await toSummary(page), '');

    const bar = await textOf(page, '.kbwd-bar');
    ok(fid + ': has the Complete header', /COMPLETE/.test(bar), bar);
    ok(fid + ': named for the form', bar.indexOf(label + ' Summary') >= 0, bar);

    const tabs = await page.$$eval('.kbwd-tab', e => e.map(x => x.textContent.trim()));
    ok(fid + ': has both tabs',
       tabs.length === 2 && /Work Done Sheet/.test(tabs[0]) && /Work Done Summary/.test(tabs[1]),
       JSON.stringify(tabs));
    eq(fid + ': there is a Print Work Done Sheet button',
       await page.$$eval('[data-kbwd-print]', e => e.length > 0), true);

    const summary = await textOf(page, '#kbwdSummaryBody');
    ok(fid + ': the summary is the note, with the clinic on it',
       /K\.B\. Dental Clinic/.test(summary) && /Work Done/.test(summary), summary.slice(0, 160));
    ok(fid + ': and it ends in a signature line',
       /Signature of Attending Doctor/.test(summary), summary.slice(-120));
    ok(fid + ': with the patient named', /Santosh Kumar/.test(summary) && /AL1010/.test(summary),
       summary.slice(0, 160));

    await page.click('.kbwd-tab[data-kbwd-tab=sheet]').catch(() => {});
    await page.waitForTimeout(250);
    const sheet = await textOf(page, '#kbwdSheetBody');
    ok(fid + ': the sheet is on the clinic letterhead',
       /C\. A\. R\. E\. S\./.test(sheet) && /DILSHAD GARDEN/.test(sheet), sheet.slice(0, 160));
    ok(fid + ': titled for this form',
       sheet.toUpperCase().indexOf(label.toUpperCase() + ' WORK-DONE SHEET') >= 0, sheet.slice(0, 220));
    ok(fid + ': carrying its document code', sheet.indexOf('KBDC/FORMS/' + code) >= 0, sheet.slice(0, 220));
    ok(fid + ': with the patient on it', /Santosh Kumar/.test(sheet) && /AL1010/.test(sheet), sheet.slice(0, 200));
    ok(fid + ': and a signature line', /Signature of Attending Doctor/.test(sheet), '');
    // The emoji belong on screen, not on a sheet a panel may read.
    ok(fid + ': no emoji in the printed headings',
       !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sheet), sheet.slice(0, 200));
    eq(fid + ': nothing threw', errs, []);
    await page.close();
  }

  // ── the three that had the wrong one ──────────────────────────────────
  for (const [name, fid, label, code] of WIZARDS) {
    const { page, errs } = await openAndFill(name, fid);
    // Walk to the Summary step, which is where both panes live.
    const steps = await page.$$('.step, .stp, [data-step], .wtab, .tab');
    for (const st of steps) await st.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(700);

    const summary = await textOf(page, '#summaryContent');
    ok(fid + ': the summary is now the note, not the field grid',
       /K\.B\. Dental Clinic/.test(summary) && /Work Done/.test(summary), summary.slice(0, 200));
    ok(fid + ': and it ends in a signature line',
       /Signature of Attending Doctor/.test(summary), summary.slice(-140));
    // That signature line is the whole difference from what was there before.
    ok(fid + ': the old field grid is gone', !/AGE \/ GENDER/.test(summary), summary.slice(0, 200));

    const tab = await page.$('.stab[data-sumtab=clinRec]');
    if (tab) { await tab.click({ force: true, timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
    const sheet = await textOf(page, '#clinRecContent');
    // The complaint exactly: a filled form that said nothing was saved.
    ok(fid + ': a filled form no longer says nothing is saved',
       !/No work done sheet saved for this patient yet/.test(sheet), sheet.slice(0, 160));
    ok(fid + ': it draws the same letterhead sheet',
       /C\. A\. R\. E\. S\./.test(sheet) && /DILSHAD GARDEN/.test(sheet), sheet.slice(0, 160));
    ok(fid + ': titled for this form',
       sheet.toUpperCase().indexOf(label.toUpperCase() + ' WORK-DONE SHEET') >= 0, sheet.slice(0, 220));
    ok(fid + ': carrying its document code', sheet.indexOf('KBDC/FORMS/' + code) >= 0, sheet.slice(0, 200));
    eq(fid + ': nothing threw', errs, []);
    await page.close();
  }

  // ── RCT, which was already right, is not touched ──────────────────────
  {
    const file = path.join(dir, 'rct.html');
    const built = ctx.kbFormWithTail(ctx.b64decode(blobOf('RCT_FORM_B64')), 'rct');
    fs.writeFileSync(file, built);
    ok('RCT gets no tail added', built.indexOf('data-kbwd-tab') < 0, '');
    ok('and keeps its own Work Done Sheet tab', /data-sumtab="clinRec"/.test(built), '');
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
