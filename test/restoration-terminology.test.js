// Restoration terminology brought up to date: a restoration meant to last is
// Definitive, not "Permanent", and one meant to be replaced is Provisional,
// not "Temporary". Cervical abrasion is a cervical lesion the clinic restores
// and had no Cavity Class to record it under, so it went unrecorded or landed
// in Class V, which is not the same thing.
//
// Two things are deliberately NOT changed, and the checks below hold them
// still:
//   RCT's "Temporary Dressing" row and its "Temp Dressing & Intracanal
//   Medication" card — an inter-appointment dressing is not a restoration.
//   RCT's Cavity Class list — Cervical Abrasion was asked for in the
//   Restoration form only.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbterm-'));

function decode(blob, file) {
  const m = new RegExp('const ' + blob + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(blob + ' not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const text = Buffer.from(b64, 'base64').toString('utf8');
  const p = path.join(OUT, file);
  fs.writeFileSync(p, text);
  return { text, file: p };
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const options = (text, id) => {
  const m = new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(text);
  return m ? [...m[1].matchAll(/<option[^>]*>([^<]*)</g)].map(o => o[1].trim()).filter(v => v && !v.startsWith('—')) : null;
};
const buttons = (text, group) =>
  [...text.matchAll(new RegExp('data-ss="' + group + '">([^<]*)<', 'g'))].map(b => b[1].trim());

(async () => {
  const resto = decode('RESTORATION_FORM_B64', 'resto.html');
  const rct = decode('RCT_FORM_B64', 'rct.html');

  // ── Restoration form ────────────────────────────────────────────────────
  eq('Type of Restoration reads Provisional / Definitive',
    options(resto.text, 'restoType'), ['Provisional', 'Definitive']);

  eq('Cavity Class offers Cervical Abrasion after Class V',
    buttons(resto.text, 'cavCl'),
    ['Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Cervical Abrasion']);

  // ── RCT ─────────────────────────────────────────────────────────────────
  eq('the RCT restoration row reads Provisional Restoration',
    /<div class="fl">Provisional Restoration<\/div>/.test(rct.text), true);
  eq('and so does the card above it, rather than disagreeing with the row',
    /Medicament &amp; Provisional Restoration/.test(rct.text), true);
  eq('nothing in RCT still says "Temp Restoration"', /Temp Restoration/.test(rct.text), false);

  // Held still on purpose.
  eq('RCT keeps its Temporary Dressing row', /<div class="fl">Temporary Dressing<\/div>/.test(rct.text), true);
  eq('and its dressing card', /Temp Dressing &amp; Intracanal Medication/.test(rct.text), true);
  eq('RCT Cavity Class is untouched — Cervical Abrasion was for Restoration only',
    buttons(rct.text, 'cavCl'), ['Class I', 'Class II', 'Class III', 'Class IV', 'Class V']);

  // ── and the new choices actually record ─────────────────────────────────
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];

  // The form only posts its record when it can see a parent that is not itself.
  const hostPath = path.join(OUT, 'host.html');
  fs.writeFileSync(hostPath, `<!DOCTYPE html><html><body>
    <iframe src="resto.html" style="width:100%;height:900px;border:0;"></iframe>
    <script>
      window.__posted = null;
      window.addEventListener('message', function(e){
        if (e.data && e.data.type === 'KB_SAVE_RECORD') {
          window.__posted = e.data;
          e.source.postMessage({ type:'KB_SAVE_RESULT', token:e.data.token, ok:true }, '*');
        }
      });
    </script></body></html>`);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + hostPath);
  await page.waitForTimeout(900);
  const f = page.frames().find(fr => fr.url().endsWith('/resto.html'));

  const picked = await f.evaluate(() => {
    const sel = document.getElementById('restoType');
    sel.value = 'Definitive';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const cav = Array.from(document.querySelectorAll('[data-ss="cavCl"]'))
      .find(b => b.textContent.trim() === 'Cervical Abrasion');
    cav.click();
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('pName').value = 'Test Patient';
    return { type: sel.value, cavActive: cav.classList.contains('active') };
  });
  eq('Definitive can be chosen', picked.type, 'Definitive');
  eq('Cervical Abrasion can be chosen', picked.cavActive, true);

  await f.evaluate(() => document.getElementById('saveBtn').click());
  await page.waitForTimeout(500);
  const posted = await page.evaluate(() => window.__posted);
  eq('the record was posted', !!posted, true);
  eq('and it carries Definitive', posted && posted.fields && posted.fields.restoType, 'Definitive');
  eq('and Cervical Abrasion as the cavity class',
    posted && posted.fields && posted.fields.cavityClass !== undefined
      ? posted.fields.cavityClass
      : (posted && posted.fields && posted.fields.cavCl),
    'Cervical Abrasion');

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RESTORATION TERMINOLOGY — PROVISIONAL / DEFINITIVE, CERVICAL ABRASION');
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
