// Every "Other" choice in the clinical forms now has somewhere to say what the
// other thing was. Before this, picking "Other" for a suture material or for
// the anaesthetic recorded the bare word "Other" and the actual detail was
// lost — the surgeon had no way to write it down at all.
//
// Two shapes are covered:
//   Implant Surgery  saves a JSON record blob, so "sutureOther" is its own key.
//   The small forms  are written by fixed field maps in Code.gs, so a new key
//                    would need a backend paste and a clinic redeploy to land
//                    anywhere. Their specify text is folded into the value it
//                    qualifies instead — "Other — Xylocaine 2%".

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbother-'));

function extract(blob, file) {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = new RegExp('const ' + blob + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(blob + ' not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, file);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

// A host page, because the forms only post their record when they can see a
// parent window different from themselves.
function host(childFile) {
  const p = path.join(OUT, 'host-' + childFile);
  fs.writeFileSync(p, `<!DOCTYPE html><html><body>
    <iframe id="f" src="${childFile}" style="width:100%;height:900px;border:0;"></iframe>
    <script>
      window.__posted = null;
      window.addEventListener('message', function(e){
        var t = e.data && e.data.type;
        if (t === 'KB_SAVE_RECORD' || t === 'KB_SAVE_CLINICAL_SHEET') {
          window.__posted = e.data;
          e.source.postMessage({ type:'KB_SAVE_RESULT', token:e.data.token, ok:true }, '*');
        }
      });
    </script>
  </body></html>`);
  return p;
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) =>
  checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const visible = (frame, id) => frame.evaluate(i => {
  const el = document.getElementById(i);
  return !!el && el.style.display !== 'none';
}, id);

const setVal = (frame, id, v) => frame.evaluate(({ id, v }) => {
  const el = document.getElementById(id);
  if (!el) throw new Error('no field ' + id);
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { id, v });

const clickOpt = (frame, groupId, label) => frame.evaluate(({ groupId, label }) => {
  const g = document.getElementById(groupId);
  if (!g) throw new Error('no group ' + groupId);
  const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
  if (!b) throw new Error('no option "' + label + '" in #' + groupId);
  b.click();
}, { groupId, label });

// The four small forms whose anaesthetic dropdown offers "Other".
const SMALL = [
  { blob: 'LOCALANESTHESIA_FORM_B64', file: 'la.html',      label: 'Local Anesthesia' },
  { blob: 'DENTURE_FORM_B64',         file: 'denture.html', label: 'Denture' },
  { blob: 'MINORSURGERY_FORM_B64',    file: 'minor.html',   label: 'Minor Surgery' },
  { blob: 'PEDO_FORM_B64',            file: 'pedo.html',    label: 'Pedo' },
];

(async () => {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];

  // ── Implant Surgery — suture material ───────────────────────────────────
  {
    extract('IMP_SURGERY_B64', 'impsurg.html');
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push('impsurg: ' + e.message));
    await page.goto('file://' + host('impsurg.html'));
    await page.waitForTimeout(900);
    const f = page.frames().find(fr => fr.url().endsWith('/impsurg.html'));

    eq('Implant Surgery: suture specify box hidden at rest',
      await visible(f, 'sutureOtherRow'), false);

    await clickOpt(f, 'suturePlaced', 'Placed');
    eq('Implant Surgery: still hidden for a listed material',
      await visible(f, 'sutureOtherRow'), false);

    await clickOpt(f, 'sutureType', 'Other');
    eq('Implant Surgery: choosing "Other" reveals the specify box',
      await visible(f, 'sutureOtherRow'), true);

    await clickOpt(f, 'sutureType', 'Silk');
    eq('Implant Surgery: choosing a listed material hides it again',
      await visible(f, 'sutureOtherRow'), false);

    await clickOpt(f, 'sutureType', 'Other');
    await clickOpt(f, 'suturePlaced', 'Not Placed');
    eq('Implant Surgery: no suture at all hides the specify box too',
      await visible(f, 'sutureOtherRow'), false);

    // Round trip: the text must reach the saved record and the printed sheet.
    // "Other" is still the chosen material here — clicking it again would
    // unclick it, which is how these single-select groups work.
    await clickOpt(f, 'suturePlaced', 'Placed');
    eq('Implant Surgery: the box comes back with the material still chosen',
      await visible(f, 'sutureOtherRow'), true);
    await setVal(f, 'sutureOther', 'Polypropylene 5-0');
    await setVal(f, 'sutureBrand', 'Ethicon');
    await setVal(f, 'sutureSize', '5-0');
    await setVal(f, 'pId', 'AL0777');
    await setVal(f, 'pName', 'Test Patient');
    await f.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForTimeout(400);

    const posted = await page.evaluate(() => window.__posted);
    ok('Implant Surgery: the record was posted to the parent', !!posted, posted && posted.type);
    const rec = posted && (posted.allTeeth || posted.fields || {});
    eq('Implant Surgery: sutureOther is saved in the record',
      rec && rec.sutureOther, 'Polypropylene 5-0');

    // Tab 4 is the Clinical Record summary — opening it rebuilds the sheet the
    // clinic prints, so this is the printed line, not a stand-in for it.
    const summary = await f.evaluate(() => {
      const tab = document.querySelector('.tab[data-tab="4"]');
      if (!tab) throw new Error('no summary tab');
      tab.click();
      return document.getElementById('summaryContent').innerText;
    });
    const sutureLine = (summary.split('\n').find(l => /Polypropylene/.test(l)) || '').trim();
    ok('Implant Surgery: the printed Suture line names the material',
      /Polypropylene 5-0/.test(summary), sutureLine || summary.slice(0, 120));
    ok('Implant Surgery: the printed Suture line still shows brand and size',
      /Ethicon/.test(summary) && /5-0/.test(summary), sutureLine);
    await page.close();
  }

  // ── The small forms — anaesthetic ───────────────────────────────────────
  for (const form of SMALL) {
    extract(form.blob, form.file);
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(form.label + ': ' + e.message));
    await page.goto('file://' + host(form.file));
    await page.waitForTimeout(900);
    const f = page.frames().find(fr => fr.url().endsWith('/' + form.file));

    eq(form.label + ': L.A. specify box hidden at rest',
      await visible(f, 'laTypeOtherRow'), false);

    await setVal(f, 'laType', 'Septanest');
    eq(form.label + ': still hidden for a listed anaesthetic',
      await visible(f, 'laTypeOtherRow'), false);

    await setVal(f, 'laType', 'Other');
    eq(form.label + ': choosing "Other" reveals the specify box',
      await visible(f, 'laTypeOtherRow'), true);

    await setVal(f, 'laTypeOther', 'Xylocaine 2%');
    await setVal(f, 'pId', 'AL0777');
    await setVal(f, 'pName', 'Test Patient');
    await f.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForTimeout(400);

    const posted = await page.evaluate(() => window.__posted);
    ok(form.label + ': the record was posted to the parent', !!posted, posted && posted.type);
    eq(form.label + ': the specify text is folded into the saved L.A. value',
      posted && posted.fields && posted.fields.laType, 'Other — Xylocaine 2%');

    // A listed anaesthetic must not pick up the stale specify text.
    await setVal(f, 'laType', 'Septanest');
    await page.evaluate(() => { window.__posted = null; });
    await f.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForTimeout(400);
    const posted2 = await page.evaluate(() => window.__posted);
    eq(form.label + ': a listed anaesthetic is saved unchanged',
      posted2 && posted2.fields && posted2.fields.laType, 'Septanest');

    // Local Anesthesia also has "Other Block" under Technique.
    if (form.blob === 'LOCALANESTHESIA_FORM_B64') {
      eq('Local Anesthesia: block specify box hidden at rest',
        await visible(f, 'techniqueOtherRow'), false);
      await clickOpt(f, 'technique', 'Infiltration');
      eq('Local Anesthesia: still hidden for a named technique',
        await visible(f, 'techniqueOtherRow'), false);
      await clickOpt(f, 'technique', 'Other Block');
      eq('Local Anesthesia: choosing "Other Block" reveals the specify box',
        await visible(f, 'techniqueOtherRow'), true);

      await setVal(f, 'techniqueOther', 'Gow-Gates');
      await page.evaluate(() => { window.__posted = null; });
      await f.evaluate(() => document.getElementById('saveBtn').click());
      await page.waitForTimeout(400);
      const posted3 = await page.evaluate(() => window.__posted);
      eq('Local Anesthesia: the block text is folded into the saved technique',
        posted3 && posted3.fields && posted3.fields.technique, 'Other Block — Gow-Gates');
    }
    await page.close();
  }

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('"OTHER" ALWAYS HAS A FREE-TEXT BOX (SUTURE MATERIAL, ANAESTHETIC, BLOCK)');
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
