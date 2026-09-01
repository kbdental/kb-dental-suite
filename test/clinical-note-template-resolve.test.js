// Checks a real bug: choosing a Clinical Note Template asked staff to
// retype data already on screen (implant brand/size, tooth number), because
// cnResolveValue() only looked for a single top-level element by that id —
// which doesn't exist for per-row table fields (implant brand/size/ref/lot/
// serial) or for tooth selection done through the row's tooth-picker modal
// (Crown & Bridge uses selTeeth/dataset.teeth, not the RCT-style selTooth
// global; Implant Surgery/Prosthetic's selTooth resets once the modal
// closes). cnResolveValue now falls back to the most recently added row.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbtpl-'));

function extract(constName, outName) {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = new RegExp('const ' + constName + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(constName + ' not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, outName);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

async function withPage(file, fn) {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + file);
  await page.waitForTimeout(200);
  await fn(page);
  await browser.close();
  return errors;
}

const postTemplates = (page, templates) => page.evaluate((templates) => {
  window.postMessage({ type: 'KB_TEMPLATES', templates }, '*');
}, templates);

const pickTemplate = (page, selectId) => page.evaluate((selectId) => {
  const sel = document.getElementById(selectId);
  sel.value = '0';
  sel.dispatchEvent(new Event('change'));
}, selectId);

const fieldValues = (page, fieldsId) => page.evaluate((fieldsId) => {
  const out = {};
  document.querySelectorAll('#' + fieldsId + ' [data-tpl-field]').forEach(f => { out[f.dataset.tplField] = f.value; });
  return out;
}, fieldsId);

(async () => {
  // --- Implant Surgery: brand/size/tooth resolved off the last added row ---
  {
    const file = extract('IMP_SURGERY_B64', 'is.html');
    const errors = await withPage(file, async (page) => {
      await postTemplates(page, [{ situation: 'Implant Placed', text: 'Implant placed at tooth {tooth}, {brand} {size}.', category: 'Implant Surgery' }]);
      // Every form starts with one row already present — click its own
      // tooth button, exactly as staff would.
      await page.evaluate(() => document.querySelector('#impTbody .tbtn').click());
      await page.evaluate(() => { window.selTooth = 46; document.getElementById('modalConfirm').click(); });
      await page.evaluate(() => {
        const row = document.querySelector('#impTbody tr');
        row.querySelector('[id^="brand_"]').value = 'Nobel Active';
        row.querySelector('[id^="size_"]').value = '4.3x10';
      });
      await pickTemplate(page, 'cnTplSelect');
      const vals = await fieldValues(page, 'cnTplFields');
      eq('implant surgery: tooth auto-resolved from the row just added', vals.tooth, '46');
      eq('implant surgery: brand auto-resolved from the row just added', vals.brand, 'Nobel Active');
      eq('implant surgery: size auto-resolved from the row just added', vals.size, '4.3x10');
    });
    eq('implant surgery: no page errors', errors, []);
  }

  // --- Implant Prosthetic: tooth resolved off the last added row -----------
  {
    const file = extract('IMP_PROSTHETIC_B64', 'ip.html');
    const errors = await withPage(file, async (page) => {
      await postTemplates(page, [{ situation: 'Prosthetic Delivered', text: 'Prosthesis delivered at tooth {tooth}.', category: 'Implant Prosthetic' }]);
      // Implant Prosthetic's tooth picker now matches Crown & Bridge's
      // multi-select/range modal (selTeeth, not a bare window.selTooth) —
      // pick a tooth the same way staff would, by clicking it in the grid.
      await page.evaluate(() => document.querySelector('#impTbody .tbtn').click());
      await page.evaluate(() => document.querySelector('.ft[data-n="36"]').click());
      await page.evaluate(() => document.getElementById('modalConfirm').click());
      await pickTemplate(page, 'cnTplSelect');
      const vals = await fieldValues(page, 'cnTplFields');
      eq('implant prosthetic: tooth auto-resolved from the row just added', vals.tooth, '36');
    });
    eq('implant prosthetic: no page errors', errors, []);
  }

  // --- Crown & Bridge: tooth (via selTeeth/dataset.teeth) and material -----
  {
    const file = extract('CROWN_BRIDGE_B64', 'cb.html');
    const errors = await withPage(file, async (page) => {
      await postTemplates(page, [{ situation: 'Crown Cemented', text: 'Crown cemented on tooth {tooth}, material {material}.', category: 'Crown & Bridge' }]);
      await page.evaluate(() => document.querySelector('#toothTbody .tbtn').click());
      await page.evaluate(() => document.querySelector('[data-n="16"]').click());
      await page.evaluate(() => document.getElementById('modalConfirm').click());
      await page.evaluate(() => {
        document.querySelector('#matGrp .btn').click(); // PFM
      });
      await pickTemplate(page, 'cnTplSelect');
      const vals = await fieldValues(page, 'cnTplFields');
      eq('crown & bridge: tooth auto-resolved from the row just added', vals.tooth, '16');
      eq('crown & bridge: material auto-resolved from the top-level group', vals.material, 'PFM');
    });
    eq('crown & bridge: no page errors', errors, []);
  }

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('CLINICAL NOTE TEMPLATES — AUTO-RESOLVING ALREADY-FILLED DATA');
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
