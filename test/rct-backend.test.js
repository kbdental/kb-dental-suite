// Checks the fix for: the RCT form's "Save to Sheet" button wrote only to
// localStorage — nothing entered there ever reached the backend, so it
// never appeared in the patient's clinical record and never reached the
// Daily Register. This drives the real form in a browser and checks it now
// posts KB_SAVE_CLINICAL_SHEET to its parent window.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbrct-'));

function extractRctForm() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const RCT_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('could not find RCT_FORM_B64 in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  fs.writeFileSync(path.join(OUT, 'rct.html'), Buffer.from(b64, 'base64'));
}

(async () => {
  extractRctForm();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

  // A host page with the form in an iframe — window.parent !== window is
  // what postClinicalSheet checks before it will send anything.
  const hostPath = path.join(OUT, 'host.html');
  fs.writeFileSync(hostPath, `<!DOCTYPE html><html><body>
    <iframe id="f" src="rct.html" style="width:100%;height:800px;border:0;"></iframe>
    <script>
      window.__posted = null;
      window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'KB_SAVE_CLINICAL_SHEET') {
          window.__posted = e.data;
          e.source.postMessage({ type: 'KB_SAVE_RESULT', token: e.data.token, ok: true }, '*');
        }
      });
    </script>
  </body></html>`);

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + hostPath);
  await page.waitForTimeout(200);
  const frame = page.frames().find(f => f.url().endsWith('rct.html'));

  await frame.evaluate(() => {
    document.getElementById('pName').value = 'Test Patient';
    document.getElementById('pId').value = 'AL0777';
    // Same as clicking a tooth number on the chart — selTooth is what
    // gates the "Save to Sheet" button and feeds collectCurrentTooth().
    window.selTooth = 36;
  });
  await frame.evaluate(() => document.getElementById('saveToSheet').click());
  await page.waitForTimeout(300);

  const posted = await page.evaluate(() => window.__posted);

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  check('KB_SAVE_CLINICAL_SHEET was posted to the parent', !!posted, posted);
  if (posted) {
    check('uhid is the entered UHID', posted.uhid === 'AL0777', posted.uhid);
    check('sheetType is "RCT"', posted.sheetType === 'RCT', posted.sheetType);
    check('allTeeth.entries has one tooth entry', Array.isArray(posted.allTeeth && posted.allTeeth.entries) && posted.allTeeth.entries.length === 1, posted.allTeeth && posted.allTeeth.entries);
  }
  check('no uncaught page errors', errors.length === 0, errors);

  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('RCT FORM -> BACKEND SAVE (KB_SAVE_CLINICAL_SHEET)');
  console.log('='.repeat(78));
  let pass = 0, fail = 0;
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name + (c.ok ? '' : `\n          got: ${JSON.stringify(c.detail)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
