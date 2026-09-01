// A single-select button, once clicked by mistake, used to stay stuck
// active forever — no way to undo it without reloading the form. Every
// clinical form's click handler now treats clicking an already-active
// single-select (data-ss) button as a deselect, same fix already verified
// for RCT in rct-unclick-and-filesequence.test.js. This checks the same
// behavior lands correctly across the rest of the forms, including the
// three with a special "None" toggle (Crown & Bridge, Implant Surgery) and
// the one using a single-line click handler (Implant Prosthetic).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbunclick-'));

function extract(constName) {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = new RegExp('const ' + constName + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(constName + ' not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, constName + '.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// Every clinical form has at least one single-select (data-ss) button
// group somewhere in its markup (visibility/which step it's on doesn't
// matter — a direct .click() reaches it regardless), so pick the first one
// in each form generically rather than hardcoding a group id per form.
const FORMS = [
  'DENTURE_FORM_B64', 'PEDO_FORM_B64', 'RESTORATION_FORM_B64', 'ORTHODONTICS_FORM_B64',
  'IMP_PROSTHETIC_B64', 'IMP_SURGERY_B64', 'CROWN_BRIDGE_B64', 'TMJOINT_FORM_B64',
  'PATHOLOGY_FORM_B64', 'RADIOLOGY_FORM_B64', 'RADIOGRAPH_FORM_B64', 'LOCALANESTHESIA_FORM_B64',
  'INTRAORAL_FORM_B64', 'SCALING_FORM_B64', 'MINORSURGERY_FORM_B64', 'LABLOG_FORM_B64', 'ORTHOPROGRESS_FORM_B64',
];

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

  for (const form of FORMS) {
    const file = extract(form);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto('file://' + file);
    await page.waitForTimeout(200);

    const found = await page.evaluate(() => {
      const g = Array.from(document.querySelectorAll('[id]')).find(el =>
        el.classList.contains('bg') && el.querySelector('.btn[data-ss]'));
      if (!g) return null;
      return { group: g.id, label: g.querySelector('.btn[data-ss]').textContent.trim() };
    });
    if (!found) { eq(form + ': has a single-select group to test', false, true); await page.close(); continue; }
    const { group, label } = found;

    const click = () => page.evaluate(({ group, label }) => {
      const g = document.getElementById(group);
      const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
      b.click();
    }, { group, label });
    const active = () => page.evaluate(g =>
      Array.from(document.getElementById(g).querySelectorAll('.btn.active')).map(b => b.textContent.trim()), group);

    await click();
    eq(form + ': selected on first click', await active(), [label]);
    await click(); // click the same button again
    eq(form + ': unclicking the active button clears the selection', await active(), []);
    await click();
    eq(form + ': re-selectable after being cleared', await active(), [label]);

    eq(form + ': no uncaught page errors', errors, []);
    await page.close();
  }

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('UNCLICK TO DESELECT — ACROSS FORMS');
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
