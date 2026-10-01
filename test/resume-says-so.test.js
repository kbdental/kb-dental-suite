// "Records as earlier required also still have no options for continuing
// filling on next appointment."
//
// The continuing already worked: all three of these forms call
// populateFormFromRecord when the parent sends the patient's saved record,
// and it refills the controls. What it did not do was SAY so. A form that
// silently fills itself looks exactly like a form that kept yesterday's
// values, so there was no way to tell a saved record was being continued —
// which is indistinguishable, from the chair, from the feature not existing.
//
// This drives each real form in a browser and checks what it tells the user.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const blob = (name) => {
  const m = new RegExp(name + '\\s*=\\s*((?:"[^"]*"\\s*\\+?\\s*)+);').exec(html);
  return Buffer.from((m[1].match(/"([^"]*)"/g) || [])
    .map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');
};

const FORMS = [
  ['Implant Surgery', 'IMP_SURGERY_B64'],
  ['Crown & Bridge', 'CROWN_BRIDGE_B64'],
  ['Implant Prosthetic', 'IMP_PROSTHETIC_B64'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

  for (const [label, name] of FORMS) {
    const form = blob(name);
    const file = path.join(os.tmpdir(), 'kb-resume-' + name + '.html');
    fs.writeFileSync(file, form);
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    await page.goto('file://' + file);
    await page.waitForTimeout(400);

    // Nothing has been sent yet: a form that has not resumed must not claim to.
    const before = await page.evaluate(() =>
      !!document.getElementById('kbResumeBanner'));
    eq(label + ': says nothing before a record arrives', before, false);

    // Exactly how the app delivers it.
    await page.evaluate(() => window.postMessage({
      type: 'KB_CLINICAL_RECORD',
      record: { pName: 'Test Patient', pId: 'AL0801', date: '14/09/2026' }
    }, '*'));
    await page.waitForTimeout(400);

    const banner = await page.evaluate(() => {
      const el = document.getElementById('kbResumeBanner');
      return el ? { text: el.textContent, visible: el.offsetHeight > 0 } : null;
    });
    ok(label + ': says a saved record is being continued',
      banner && /[Cc]ontinuing this patient/.test(banner.text), banner && banner.text);
    ok(label + ': names the visit it is continuing from',
      banner && banner.text.indexOf('14/09/2026') >= 0, banner && banner.text);
    ok(label + ': and the message is actually on screen',
      banner && banner.visible, banner);

    await page.close();
    fs.unlinkSync(file);
  }

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('A FORM THAT RESUMES A RECORD SAYS SO');
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
})();
